/**
 * Skill discovery (spec §2.1): every skill folder Claude Code can load on this machine, copied
 * whole, plus slash commands and agent definitions at home and project level, plus project
 * CLAUDE.md and rule files when asked. A skill folder is a folder that holds a SKILL.md.
 *
 * "Copied whole" still means within spec §2.6: the never-collected names are skipped and listed,
 * dependency and cache folders are skipped and listed, and a symbolic link is followed only when
 * its target stays inside the folder being copied.
 */
import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Copier } from './copier.js';
import { reason, sanitizeLabel, type Home, type Problem } from './home.js';
import { neverCollected, SKIPPED_FOLDERS } from './never.js';
import type { CopiedExtra, LocationCount, Report, SkillEntry } from './report.js';

export interface Root {
  /** `home`, `project-<label>` or `plugin-<marketplace>-<plugin>@<version>`. */
  source: string;
  /** The `.claude` folder (home or project) or the plugin's cache folder. */
  dir: string;
  /** What relative references in a skill resolve against besides the skill folder and `~/.claude`. */
  baseDir: string;
  /** Display form of `dir`: `~/.claude`, `~/dev/api/.claude`, `api/.claude`. */
  display: string;
}

/**
 * `~/...` for anything under home, `<label>/...` under a project outside home, else the folder's
 * own name. With `--hash-labels` a project under home is shown by its label too, because the
 * folder name is exactly what that flag hides.
 */
export function displayPath(home: Home, diskPath: string): string {
  const path = resolve(diskPath);
  const under = (base: string): string | undefined => {
    const rel = relative(base, path);
    return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split(sep).join('/');
  };
  const byLabel = (): string | undefined => {
    for (const project of home.projects) {
      const rel = under(project.root);
      if (rel !== undefined) return rel === '.' ? project.label : `${project.label}/${rel}`;
    }
    return undefined;
  };
  if (home.hashLabels) { const labelled = byLabel(); if (labelled !== undefined) return labelled; }
  const fromHome = under(home.root);
  if (fromHome !== undefined) return fromHome === '.' ? '~' : `~/${fromHome}`;
  return byLabel() ?? `[outside home]/${path.split(/[\\/]/).filter(Boolean).pop() ?? ''}`;
}

export function roots(home: Home): Root[] {
  const list: Root[] = [{ source: 'home', dir: home.claudeDir, baseDir: home.claudeDir, display: displayPath(home, home.claudeDir) }];
  for (const project of home.projects) {
    const dir = join(project.root, '.claude');
    list.push({ source: `project-${project.label}`, dir, baseDir: project.root, display: displayPath(home, dir) });
  }
  for (const plugin of home.plugins) {
    list.push({ source: sanitizeLabel(`plugin-${plugin.marketplace}-${plugin.name}@${plugin.version}`), dir: plugin.installPath, baseDir: plugin.installPath, display: displayPath(home, plugin.installPath) });
  }
  return list;
}

type FolderState = { state: 'scanned'; names: string[] } | { state: 'absent' } | { state: 'unreadable'; reason: string };

async function listFolder(dir: string): Promise<FolderState> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) { names.push(entry.name); continue; }
      // A symlinked skill folder (common on macOS) counts when it points at a folder.
      if (entry.isSymbolicLink()) { try { if ((await stat(join(dir, entry.name))).isDirectory()) names.push(entry.name); } catch { /* dangling link: not a skill */ } }
    }
    return { state: 'scanned', names: names.sort() };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', reason: reason(error) };
  }
}

const within = (base: string, path: string): boolean => { const rel = relative(base, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

/**
 * Every regular file under `dir` that may leave, relative and forward-slashed, with what was
 * skipped and why. `dir` itself may be a symlink; its target is the boundary links must stay in.
 */
export async function walkFiles(dir: string, display: string, includeClaudeMd: boolean): Promise<{ files: string[]; skipped: Problem[] }> {
  const files: string[] = [];
  const skipped: Problem[] = [];
  const boundary = await realpath(dir).catch(() => resolve(dir));
  const visit = async (sub: string): Promise<void> => {
    let entries;
    try { entries = await readdir(join(dir, sub), { withFileTypes: true }); }
    catch (error) { skipped.push({ where: `${display}/${sub}`, reason: reason(error) }); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      const where = `${display}/${rel}`;
      if (entry.isDirectory()) {
        if (SKIPPED_FOLDERS.has(entry.name)) { skipped.push({ where, reason: 'folder not copied' }); continue; }
        await visit(rel);
        continue;
      }
      const banned = neverCollected(entry.name, includeClaudeMd);
      if (banned !== undefined) { skipped.push({ where, reason: banned }); continue; }
      if (entry.isFile()) { files.push(rel); continue; }
      if (!entry.isSymbolicLink()) { skipped.push({ where, reason: 'not a regular file' }); continue; }
      try {
        const target = await realpath(join(dir, rel));
        if (!within(boundary, target)) { skipped.push({ where, reason: 'symbolic link points outside the folder, not followed' }); continue; }
        if ((await stat(target)).isFile()) files.push(rel);
        else skipped.push({ where, reason: 'symbolic link to a folder, not followed' });
      } catch { skipped.push({ where, reason: 'dangling symbolic link' }); }
    }
  };
  await visit('');
  return { files, skipped };
}

async function copySkill(root: Root, name: string, copier: Copier, report: Report, home: Home, includeClaudeMd: boolean): Promise<SkillEntry | undefined> {
  const diskPath = join(root.dir, 'skills', name);
  const readFrom = displayPath(home, diskPath);
  const outputDir = `skills/${root.source}/${sanitizeLabel(name) || 'skill'}`;
  const { files, skipped } = await walkFiles(diskPath, readFrom, includeClaudeMd);
  const copied: string[] = [];
  const hashes: string[] = [];
  let skillTextChars = 0;
  for (const rel of files) {
    const outcome = await copier.copy(join(diskPath, rel), `${outputDir}/${rel}`);
    if (!outcome.ok) { skipped.push({ where: `${readFrom}/${rel}`, reason: outcome.reason }); continue; }
    copied.push(outcome.outputPath);
    hashes.push(`${rel}\u0000${outcome.sha256}`);
    if (rel === 'SKILL.md') skillTextChars = outcome.textChars ?? 0;
  }
  if (copied.length === 0) { report.problems.push({ where: readFrom, reason: 'no file could be copied' }); return undefined; }
  return {
    name,
    source: root.source,
    readFrom,
    outputDir,
    files: copied,
    contentHash: createHash('sha256').update(hashes.sort().join('\n')).digest('hex'),
    skillTextChars,
    skipped,
    diskPath,
    baseDir: root.baseDir,
  };
}

async function copyExtras(root: Root, kind: 'command' | 'agent', copier: Copier, report: Report, home: Home, includeClaudeMd: boolean): Promise<number> {
  const folder = kind === 'command' ? 'commands' : 'agents';
  const dir = join(root.dir, folder);
  const listed = await listFolder(dir);
  if (listed.state === 'absent') return 0;
  if (listed.state === 'unreadable') { report.problems.push({ where: displayPath(home, dir), reason: listed.reason }); return 0; }
  const display = displayPath(home, dir);
  const { files, skipped } = await walkFiles(dir, display, includeClaudeMd);
  report.problems.push(...skipped);
  let count = 0;
  for (const rel of files) {
    // Claude Code loads Markdown here; anything else is listed, not copied (spec §5.6).
    if (!rel.endsWith('.md')) { report.problems.push({ where: `${display}/${rel}`, reason: `not a Markdown ${kind}; not copied` }); continue; }
    const outcome = await copier.copy(join(dir, rel), `${folder}/${root.source}/${rel}`);
    if (!outcome.ok) { report.problems.push({ where: `${display}/${rel}`, reason: outcome.reason }); continue; }
    const extra: CopiedExtra = { kind, source: root.source, readFrom: `${display}/${rel}`, outputPath: outcome.outputPath };
    report.extras.push(extra);
    count++;
  }
  return count;
}

/** Project CLAUDE.md, .claude/CLAUDE.md and .claude/rules/**.md; home ~/.claude/CLAUDE.md (walk D7, opt-in). */
async function copyClaudeMd(home: Home, copier: Copier, report: Report): Promise<void> {
  const targets: { source: string; base: string; candidates: string[] }[] = [{ source: 'home', base: home.root, candidates: [join('.claude', 'CLAUDE.md')] }];
  for (const project of home.projects) targets.push({ source: `project-${project.label}`, base: project.root, candidates: ['CLAUDE.md', join('.claude', 'CLAUDE.md')] });
  for (const target of targets) {
    const files: string[] = [];
    for (const candidate of target.candidates) { try { if ((await stat(join(target.base, candidate))).isFile()) files.push(candidate); } catch { /* absent */ } }
    const rulesDir = join(target.base, '.claude', 'rules');
    const rules = await listFolder(rulesDir);
    if (rules.state !== 'absent') {
      const { files: ruleFiles, skipped } = await walkFiles(rulesDir, displayPath(home, rulesDir), true);
      report.problems.push(...skipped);
      files.push(...ruleFiles.filter((f) => f.endsWith('.md')).map((f) => join('.claude', 'rules', f)));
    }
    for (const rel of files) {
      const outputPath = `claude-md/${target.source}/${rel.split(sep).join('/')}`;
      const outcome = await copier.copy(join(target.base, rel), outputPath);
      const readFrom = displayPath(home, join(target.base, rel));
      if (!outcome.ok) { report.problems.push({ where: readFrom, reason: outcome.reason }); continue; }
      report.extras.push({ kind: 'claude-md', source: target.source, readFrom, outputPath });
    }
  }
}

export interface Discovered {
  skills: SkillEntry[];
  /** Plugin cache folder → skills found, for the environment block. */
  pluginSkillCounts: Map<string, number>;
}

export async function discover(home: Home, copier: Copier, report: Report, options: { includeClaudeMd: boolean }): Promise<Discovered> {
  const skills: SkillEntry[] = [];
  const pluginSkillCounts = new Map<string, number>();
  const locations: LocationCount[] = [];
  let commands = 0;
  let agents = 0;
  let pluginSkills = 0;
  let pluginsWithSkills = 0;
  const homeHashes = new Set<string>();

  for (const root of roots(home)) {
    const skillsDir = join(root.dir, 'skills');
    const listed = await listFolder(skillsDir);
    const found: SkillEntry[] = [];
    if (listed.state === 'unreadable') report.problems.push({ where: displayPath(home, skillsDir), reason: listed.reason });
    if (listed.state === 'scanned') {
      for (const name of listed.names) {
        let marker;
        try { marker = await stat(join(skillsDir, name, 'SKILL.md')); } catch { continue; } // a folder without SKILL.md is not a skill
        if (!marker.isFile()) { report.problems.push({ where: displayPath(home, join(skillsDir, name)), reason: 'SKILL.md is not a regular file; not copied' }); continue; }
        const entry = await copySkill(root, name, copier, report, home, options.includeClaudeMd);
        if (entry !== undefined) found.push(entry);
      }
    }
    skills.push(...found);
    if (root.source === 'home') {
      for (const s of found) homeHashes.add(s.contentHash);
      locations.push({ location: `${root.display}/skills`, detail: listed.state === 'absent' ? 'not present' : `${found.length} skill${found.length === 1 ? '' : 's'}` });
    } else if (root.source.startsWith('project-')) {
      if (listed.state !== 'absent') {
        const identical = found.filter((s) => homeHashes.has(s.contentHash)).length;
        locations.push({ location: `${root.display}/skills`, detail: `${found.length} skill${found.length === 1 ? '' : 's'}${identical > 0 ? `   (${identical} identical to ~/.claude/skills copies)` : ''}` });
      }
    } else {
      pluginSkillCounts.set(root.dir, found.length);
      pluginSkills += found.length;
      if (found.length > 0) pluginsWithSkills++;
      if (listed.state === 'absent') {
        // The registry names a plugin whose cache folder is gone: say so, once, without a path.
        try { await stat(root.dir); } catch { report.problems.push({ where: root.display, reason: 'plugin folder listed in installed_plugins.json is not on disk' }); }
      }
    }
    if (root.source.startsWith('plugin-')) continue; // commands and agents are home and project level only (spec §2.1)
    commands += await copyExtras(root, 'command', copier, report, home, options.includeClaudeMd);
    agents += await copyExtras(root, 'agent', copier, report, home, options.includeClaudeMd);
  }
  if (home.plugins.length > 0) locations.push({ location: '~/.claude/plugins', detail: `${pluginSkills} skill${pluginSkills === 1 ? '' : 's'} from ${pluginsWithSkills} plugin${pluginsWithSkills === 1 ? '' : 's'}` });
  locations.push({ location: '~/.claude/commands, .claude/agents', detail: `${commands} command${commands === 1 ? '' : 's'}, ${agents} agent${agents === 1 ? '' : 's'}` });
  if (options.includeClaudeMd) await copyClaudeMd(home, copier, report);

  report.skills.push(...skills);
  report.locations.push(...locations);
  return { skills, pluginSkillCounts };
}
