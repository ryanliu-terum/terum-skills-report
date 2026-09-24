/**
 * Where Claude Code keeps things, and the small JSON files the collector reads for structure
 * (spec §2.1, §2.4). Every read here is fail-open: a missing or malformed file is a recorded
 * problem and an empty result, never a crash (spec §5.6).
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export interface Problem {
  /** Written relative to `~` or to a project label; never a full path (spec §5.5). */
  where: string;
  reason: string;
}

export interface Project {
  /** Full path on disk. Used to read; never written to the output. */
  root: string;
  /** Folder base name, or a hash with `--hash-labels` (walk D5). Unique within a run. */
  label: string;
  /** MCP server names configured for this project in `~/.claude.json`. Names only (spec §2.4). */
  mcpServers: string[];
}

export interface PluginInstall {
  /** `name@marketplace` as installed_plugins.json keys it. */
  id: string;
  name: string;
  marketplace: string;
  version: string;
  /** Full path on disk of the plugin's cache folder. Never written out. */
  installPath: string;
  scope: string;
  enabled: boolean | undefined;
}

export interface Home {
  root: string;
  claudeDir: string;
  /** `~/.claude.json`: projects Claude Code has been opened in, MCP server names. */
  projects: Project[];
  mcpServers: string[];
  /** `~/.claude/settings.json`: hook event names, hook commands (only kept with a flag), enabled plugins. */
  hookEvents: string[];
  hookCommands: string[];
  plugins: PluginInstall[];
  problems: Problem[];
}

export const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function readJson(path: string, where: string, problems: Problem[]): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push({ where, reason: reason(error) });
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { problems.push({ where, reason: 'not a JSON object' }); return undefined; }
    return parsed as Record<string, unknown>;
  } catch (error) {
    problems.push({ where, reason: `could not parse: ${reason(error)}` });
    return undefined;
  }
}

const asObject = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

export const hashLabel = (path: string): string => createHash('sha256').update(path).digest('hex').slice(0, 12);

/**
 * Project labels are folder base names, made unique with `-2`, `-3` when two projects share one
 * (walk D5). With `--hash-labels` every label is the first 12 hex characters of a sha256 of the path.
 */
export function assignLabels(roots: readonly string[], hashLabels: boolean): Map<string, string> {
  const labels = new Map<string, string>();
  const used = new Set<string>();
  for (const root of roots) {
    const base = hashLabels ? hashLabel(root) : sanitizeLabel(basename(root)) || 'project';
    let label = base;
    for (let n = 2; used.has(label); n++) label = `${base}-${n}`;
    used.add(label);
    labels.set(root, label);
  }
  return labels;
}

/** A label becomes a folder name in the output; keep it to characters every filesystem accepts. */
export const sanitizeLabel = (name: string): string => name.replace(/[^A-Za-z0-9._@-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export async function readHome(root: string, options: { hashLabels: boolean }): Promise<Home> {
  const problems: Problem[] = [];
  const claudeDir = join(root, '.claude');
  const home: Home = { root, claudeDir, projects: [], mcpServers: [], hookEvents: [], hookCommands: [], plugins: [], problems };

  const config = await readJson(join(root, '.claude.json'), '~/.claude.json', problems);
  if (config !== undefined) {
    home.mcpServers = Object.keys(asObject(config['mcpServers']) ?? {}).sort();
    const projects = asObject(config['projects']) ?? {};
    const roots: string[] = [];
    const mcpByRoot = new Map<string, string[]>();
    for (const [path, entry] of Object.entries(projects)) {
      const projectRoot = resolve(path);
      if (roots.includes(projectRoot)) continue;
      if (!(await isDirectory(projectRoot))) continue; // a folder Claude Code once opened that no longer exists
      roots.push(projectRoot);
      mcpByRoot.set(projectRoot, Object.keys(asObject(asObject(entry)?.['mcpServers']) ?? {}).sort());
    }
    roots.sort();
    const labels = assignLabels(roots, options.hashLabels);
    home.projects = roots.map((projectRoot) => ({ root: projectRoot, label: labels.get(projectRoot)!, mcpServers: mcpByRoot.get(projectRoot) ?? [] }));
  }

  const settings = await readJson(join(claudeDir, 'settings.json'), '~/.claude/settings.json', problems);
  const enabled = asObject(settings?.['enabledPlugins']) ?? {};
  if (settings !== undefined) {
    const hooks = asObject(settings['hooks']) ?? {};
    home.hookEvents = Object.keys(hooks).sort();
    for (const event of home.hookEvents) {
      const matchers = hooks[event];
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const list = asObject(matcher)?.['hooks'];
        if (!Array.isArray(list)) continue;
        for (const hook of list) {
          const command = asObject(hook)?.['command'];
          if (typeof command === 'string') home.hookCommands.push(`${event}: ${command}`);
        }
      }
    }
  }

  const installed = await readJson(join(claudeDir, 'plugins', 'installed_plugins.json'), '~/.claude/plugins/installed_plugins.json', problems);
  const pluginMap = asObject(installed?.['plugins']) ?? {};
  const seenPaths = new Set<string>();
  for (const [id, entries] of Object.entries(pluginMap)) {
    const at = id.lastIndexOf('@');
    const name = at > 0 ? id.slice(0, at) : id;
    const marketplace = at > 0 ? id.slice(at + 1) : 'unknown';
    const list = Array.isArray(entries) ? entries : [entries];
    for (const raw of list) {
      const entry = asObject(raw);
      const installPath = entry?.['installPath'];
      if (typeof installPath !== 'string' || installPath.length === 0) { problems.push({ where: `plugin ${id}`, reason: 'no installPath in installed_plugins.json' }); continue; }
      const resolved = resolve(installPath);
      if (seenPaths.has(resolved)) continue; // one cache folder installed at two scopes
      seenPaths.add(resolved);
      const version = typeof entry?.['version'] === 'string' ? (entry['version'] as string) : 'unknown';
      const scope = typeof entry?.['scope'] === 'string' ? (entry['scope'] as string) : 'unknown';
      const flag = enabled[id];
      home.plugins.push({ id, name, marketplace, version, installPath: resolved, scope, enabled: typeof flag === 'boolean' ? flag : undefined });
    }
  }
  home.plugins.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  return home;
}
