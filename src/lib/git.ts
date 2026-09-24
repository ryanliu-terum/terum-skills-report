/**
 * Git metadata per copied skill file (spec §2.5): first commit date, last commit date and the
 * number of distinct authors as an integer. No names, no emails. This is the only file that spawns
 * a program (eslint enforces it), every spawn carries a deadline, and a failure is recorded per
 * file and never fatal (spec §5.6).
 */
import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import type { Problem } from './home.js';
import type { GitFacts, Report, SkillEntry } from './report.js';

/** Five seconds is generous for `git log` on one file; a hung spawn must not hold the run. */
export const GIT_DEADLINE_MS = 5_000;
const CONCURRENCY = 4;

export interface GitRunner { (args: string[], cwd: string): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> }

/**
 * A git error names the file it choked on, in whatever spelling git chose, and that spelling may
 * not be one the output scrubber knows (Windows 8.3 short names against long names). Paths are
 * cut out of the reason before it is recorded; the file is already named by its output path.
 */
export const withoutPaths = (message: string): string => message
  // A quoted path may contain spaces (`'C:/Users/Ryan Liu/x'`): take the whole quote.
  .replace(/'[^']*[\\/][^']*'|"[^"]*[\\/][^"]*"/g, (q) => `${q[0]}<path>${q[0]}`)
  .replace(/(?:[A-Za-z]:)?(?:\.\.?)?(?:[\\/][^\s'":]*)+/g, '<path>')
  .replace(/\s+/g, ' ').trim() || 'git failed';

export const realGit: GitRunner = (args, cwd) => new Promise((done) => {
  execFile('git', ['--no-optional-locks', ...args], {
    cwd,
    timeout: GIT_DEADLINE_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
  }, (error, stdout, stderr) => {
    if (error === null) { done({ ok: true, stdout }); return; }
    const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (e.code === 'ENOENT') { done({ ok: false, reason: 'git is not installed' }); return; }
    if (e.killed === true || e.signal === 'SIGKILL') { done({ ok: false, reason: `git took longer than ${GIT_DEADLINE_MS / 1000}s` }); return; }
    done({ ok: false, reason: withoutPaths(stderr.toString().trim().split('\n')[0] ?? e.message) });
  });
});

/** `git log` dates and authors for one path, already known to be inside `repoRoot`. */
export function parseLog(stdout: string): GitFacts | undefined {
  const dates: string[] = [];
  const authors = new Set<string>();
  for (const line of stdout.split('\n')) {
    const [date, author] = line.trim().split('\u001f');
    if (date === undefined || date.length < 10) continue;
    dates.push(date.slice(0, 10));
    if (author !== undefined && author.length > 0) authors.add(author.toLowerCase());
  }
  if (dates.length === 0) return undefined;
  dates.sort();
  return { outputPath: '', firstCommit: dates[0]!, lastCommit: dates[dates.length - 1]!, authors: authors.size };
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]!); }
  });
  await Promise.all(workers);
}

export async function collectGit(skills: readonly SkillEntry[], report: Report, git: GitRunner = realGit): Promise<void> {
  const facts: GitFacts[] = [];
  const problems: Problem[] = [];
  const rootByDir = new Map<string, string | undefined>();
  let gitMissing = false;

  const repoRootOf = async (dir: string, where: string): Promise<string | undefined> => {
    if (rootByDir.has(dir)) return rootByDir.get(dir);
    const result = await git(['rev-parse', '--show-toplevel'], dir);
    if (!result.ok && result.reason === 'git is not installed') gitMissing = true;
    // Not a repository is the ordinary case and says nothing. Any other failure (a timeout,
    // `dubious ownership` on a share) is recorded, or the manifest would imply the folder was checked.
    else if (!result.ok && !/not a git repository/i.test(result.reason)) problems.push({ where, reason: result.reason });
    const root = result.ok ? resolve(result.stdout.trim()) : undefined;
    rootByDir.set(dir, root);
    return root;
  };

  for (const skill of skills) {
    if (gitMissing) break;
    const root = await repoRootOf(skill.diskPath, skill.outputDir);
    if (root === undefined) continue; // not inside a repository, or recorded above
    const files = skill.files.map((outputPath) => ({ outputPath, disk: resolve(skill.diskPath, ...outputPath.slice(skill.outputDir.length + 1).split('/')) }));
    await mapWithConcurrency(files, CONCURRENCY, async ({ outputPath, disk }) => {
      // The file is named relative to its own folder, which is the spawn's cwd: git resolves it
      // itself, so the repository root's spelling (long or 8.3 on Windows) never has to match ours.
      // `:(literal)` keeps a name with `*`, `?` or `[` from being read as a pattern.
      const result = await git(['log', '--follow', '--format=%aI%x1f%aE', '--', `:(literal)${basename(disk)}`], dirname(disk));
      if (!result.ok) { problems.push({ where: outputPath, reason: result.reason }); return; }
      const parsed = parseLog(result.stdout);
      if (parsed === undefined) { problems.push({ where: outputPath, reason: 'not committed' }); return; }
      facts.push({ ...parsed, outputPath });
    });
  }
  if (gitMissing) problems.push({ where: 'git', reason: 'git is not installed; no commit dates or author counts' });
  facts.sort((a, b) => a.outputPath.localeCompare(b.outputPath));
  problems.sort((a, b) => a.where.localeCompare(b.where));
  report.git.push(...facts);
  report.gitProblems.push(...problems);
}
