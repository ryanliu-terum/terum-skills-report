/**
 * Linked scripts (spec §2.2): files a skill references outside its own folder, found by resolving
 * path-shaped tokens in the skill's Markdown against the skill folder, its base (project root or
 * plugin root) and `~/.claude`. This is a heuristic and it will miss some; every reference that
 * could not be resolved is recorded so the eval marks the skill *not evaluable* instead of guessing.
 *
 * Two guards keep this inside the folders the spec names: a resolved path must lie inside the base
 * it was resolved against (so `../.env` cannot climb out), and `.env` files are never copied at all
 * (spec §2.6).
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Copier } from './copier.js';
import { displayPath } from './discover.js';
import type { Home } from './home.js';
import type { CopiedExtra, Report, SkillEntry } from './report.js';

/** `https://…` and `file://…` are links, not files on this machine. */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * A path-shaped token: an optional prefix (`~`, `.`, `..`, a drive letter, `$CLAUDE_PLUGIN_ROOT`),
 * at least one separator, and a file extension that starts with a letter. `docs/spec.md`,
 * `./scripts/run.sh`, `.claude/workflows/x.js`, `$CLAUDE_PLUGIN_ROOT/scripts/g.py`, `C:\x\y.ps1`.
 */
const SEGMENT = '[A-Za-z0-9_.-]+';
/** The last segment may be a dotfile (`.env`, `.eslintrc.json`): a name of any length, then `.ext`. */
const LAST_SEGMENT = '[A-Za-z0-9_.-]*\\.[A-Za-z][A-Za-z0-9]{0,7}';
const PREFIX = '(?:\\$\\{?CLAUDE_PLUGIN_ROOT\\}?|~|\\.\\.?|[A-Za-z]:)?';
const PATH_TOKEN = new RegExp(`(?<![A-Za-z0-9_@:])(${PREFIX}(?:[\\\\/]${SEGMENT})*[\\\\/]${LAST_SEGMENT}|${SEGMENT}(?:[\\\\/]${SEGMENT})*[\\\\/]${LAST_SEGMENT})(?![A-Za-z0-9_])`, 'g');

const PLUGIN_ROOT = /^\$\{?CLAUDE_PLUGIN_ROOT\}?/;

export function pathTokens(text: string): string[] {
  const seen = new Set<string>();
  const cleaned = text.replace(URL, ' ');
  for (const match of cleaned.matchAll(PATH_TOKEN)) {
    const token = match[1]!.replace(/[.,;:)]+$/, '');
    if (token.length > 0) seen.add(token);
  }
  return [...seen];
}

const isDotEnv = (path: string): boolean => /^\.env(\..*)?$/.test(basename(path));

/** `inside(base, path)`: the resolved path is `base` or below it, never a sibling or a parent. */
function inside(base: string, path: string): boolean {
  const rel = relative(resolve(base), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

type Resolution =
  | { ok: true; disk: string; base: string; label: string }
  | { ok: false; reason: string };

async function isFile(path: string): Promise<boolean | 'folder'> {
  try { const s = await stat(path); return s.isFile() ? true : s.isDirectory() ? 'folder' : false; } catch { return false; }
}

async function resolveToken(token: string, skill: SkillEntry, home: Home, projectLabel: string | undefined): Promise<Resolution> {
  const claudeDir = home.claudeDir;
  const isPlugin = skill.source.startsWith('plugin-');
  const baseLabel = skill.source === 'home' ? 'home' : isPlugin ? skill.source : projectLabel ?? skill.source;

  if (PLUGIN_ROOT.test(token)) {
    if (!isPlugin) return { ok: false, reason: 'CLAUDE_PLUGIN_ROOT referenced outside a plugin' };
    const rest = token.replace(PLUGIN_ROOT, '').replace(/^[\\/]+/, '');
    const disk = join(skill.baseDir, ...rest.split(/[\\/]/));
    if (!inside(skill.baseDir, disk)) return { ok: false, reason: 'resolves outside the plugin folder' };
    const kind = await isFile(disk);
    return kind === true ? { ok: true, disk, base: skill.baseDir, label: skill.source } : { ok: false, reason: kind === 'folder' ? 'is a folder' : 'not found under the plugin folder' };
  }

  const expanded = token.startsWith('~') ? join(home.root, token.slice(1)) : token;
  if (isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded)) {
    const disk = resolve(expanded);
    if (inside(skill.baseDir, disk)) {
      const kind = await isFile(disk);
      return kind === true ? { ok: true, disk, base: skill.baseDir, label: baseLabel } : { ok: false, reason: kind === 'folder' ? 'is a folder' : 'not found' };
    }
    if (inside(claudeDir, disk)) {
      const kind = await isFile(disk);
      return kind === true ? { ok: true, disk, base: claudeDir, label: 'home' } : { ok: false, reason: kind === 'folder' ? 'is a folder' : 'not found' };
    }
    return { ok: false, reason: 'absolute path outside the project and ~/.claude; not opened' };
  }

  const parts = token.split(/[\\/]/);
  const attempts: { base: string; label: string }[] = [
    { base: skill.diskPath, label: baseLabel },
    { base: skill.baseDir, label: baseLabel },
    { base: claudeDir, label: 'home' },
  ];
  // `.claude/workflows/x.js` written from a home folder's point of view.
  if (parts[0] === '.claude') attempts.push({ base: home.root, label: 'home' });
  let sawFolder = false;
  let climbed = false;
  for (const attempt of attempts) {
    const disk = resolve(attempt.base, ...parts);
    if (!inside(attempt.base, disk)) { climbed = true; continue; }
    if (attempt.base === home.root && !inside(claudeDir, disk)) { climbed = true; continue; }
    const kind = await isFile(disk);
    if (kind === true) return { ok: true, disk, base: attempt.base === home.root ? claudeDir : attempt.base, label: attempt.label };
    if (kind === 'folder') sawFolder = true;
  }
  if (climbed) return { ok: false, reason: 'resolves outside the skill folder, its project and ~/.claude; not opened' };
  return { ok: false, reason: sawFolder ? 'is a folder' : 'not found in the skill folder, its project or ~/.claude' };
}

async function skillMarkdown(skill: SkillEntry): Promise<string> {
  const texts: string[] = [];
  for (const outputPath of skill.files) {
    const rel = outputPath.slice(skill.outputDir.length + 1);
    if (!rel.endsWith('.md')) continue;
    try { texts.push(await readFile(join(skill.diskPath, ...rel.split('/')), 'utf8')); } catch { /* copied a moment ago; if it vanished, the skill's own copy records that */ }
  }
  return texts.join('\n');
}

export async function collectLinked(skills: readonly SkillEntry[], home: Home, copier: Copier, report: Report): Promise<number> {
  const byDisk = new Map<string, CopiedExtra>();
  const labelByRoot = new Map(home.projects.map((p) => [p.root, p.label] as const));
  for (const skill of skills) {
    const projectLabel = labelByRoot.get(skill.baseDir);
    const text = await skillMarkdown(skill);
    for (const token of pathTokens(text)) {
      if (isDotEnv(token)) { report.linkedMisses.push({ skill: skill.name, source: skill.source, reference: token, reason: '.env files are never collected' }); continue; }
      const resolution = await resolveToken(token, skill, home, projectLabel);
      if (!resolution.ok) { report.linkedMisses.push({ skill: skill.name, source: skill.source, reference: token, reason: resolution.reason }); continue; }
      if (isDotEnv(resolution.disk)) { report.linkedMisses.push({ skill: skill.name, source: skill.source, reference: token, reason: '.env files are never collected' }); continue; }
      if (inside(skill.diskPath, resolution.disk)) continue; // already copied with the skill
      const existing = byDisk.get(resolution.disk);
      const who = `${skill.name} (${skill.source})`;
      if (existing !== undefined) { if (!existing.referencedBy!.includes(who)) existing.referencedBy!.push(who); continue; }
      const relInBase = relative(resolution.base, resolution.disk).split(sep).join('/');
      const outputPath = `linked/${resolution.label}/${relInBase}`;
      const outcome = await copier.copy(resolution.disk, outputPath);
      const readFrom = displayPath(home, resolution.disk);
      if (!outcome.ok) { report.linkedMisses.push({ skill: skill.name, source: skill.source, reference: token, reason: outcome.reason }); continue; }
      const extra: CopiedExtra = { kind: 'linked', source: resolution.label, readFrom, outputPath, referencedBy: [who] };
      byDisk.set(resolution.disk, extra);
      report.extras.push(extra);
    }
  }
  return byDisk.size;
}
