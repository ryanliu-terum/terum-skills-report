import { describe, expect, it } from 'vitest';
import { collectGit, parseLog, type GitRunner } from '../lib/git.js';
import type { Report, SkillEntry } from '../lib/report.js';

const skill = (name: string, diskPath: string, files: string[]): SkillEntry => ({
  name, source: 'home', readFrom: `~/.claude/skills/${name}`, outputDir: `skills/home/${name}`, files: files.map((f) => `skills/home/${name}/${f}`), contentHash: 'h', skillTextChars: 1, skipped: [], diskPath, baseDir: diskPath,
});
const report = (): Report => ({ git: [], gitProblems: [] } as unknown as Report);

describe('parseLog', () => {
  it('returns the first and last date and the distinct author count, never an author', () => {
    const out = ['2026-09-01T10:00:00+02:00\u001fA@x.test', '2026-08-01T10:00:00Z\u001fb@x.test', '2026-08-15T00:00:00Z\u001fa@X.TEST', ''].join('\n');
    expect(parseLog(out)).toEqual({ outputPath: '', firstCommit: '2026-08-01', lastCommit: '2026-09-01', authors: 2 });
    expect(JSON.stringify(parseLog(out))).not.toContain('x.test');
  });
  it('is undefined for an untracked file', () => {
    expect(parseLog('')).toBeUndefined();
  });
});

describe('collectGit', () => {
  it('records a timeout, an untracked file and a missing git as problems, never throws', async () => {
    const calls: string[][] = [];
    const fake: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { ok: true, stdout: '/repo\n' };
      const file = args[args.length - 1]!;
      if (file.endsWith('slow.md')) return { ok: false, reason: 'git took longer than 5s' };
      if (file.endsWith('new.md')) return { ok: true, stdout: '' };
      return { ok: true, stdout: '2026-09-01T00:00:00Z\u001fa@x\n2026-09-02T00:00:00Z\u001fb@x\n' };
    };
    const r = report();
    await collectGit([skill('s', '/repo/.claude/skills/s', ['SKILL.md', 'slow.md', 'new.md'])], r, fake);
    expect(r.git).toEqual([{ outputPath: 'skills/home/s/SKILL.md', firstCommit: '2026-09-01', lastCommit: '2026-09-02', authors: 2 }]);
    expect(r.gitProblems).toEqual([
      { where: 'skills/home/s/new.md', reason: 'not committed' },
      { where: 'skills/home/s/slow.md', reason: 'git took longer than 5s' },
    ]);
    // Paths are always behind `--`, so a file named like an option cannot become one.
    for (const args of calls.filter((a) => a[0] === 'log')) expect(args[args.length - 2]).toBe('--');
  });

  it('skips a skill that is not inside a repository, records any other rev-parse failure, and says once when git is missing', async () => {
    const r = report();
    await collectGit([skill('s', '/nowhere/s', ['SKILL.md'])], r, async () => ({ ok: false, reason: 'fatal: not a git repository' }));
    expect(r.git).toEqual([]);
    expect(r.gitProblems).toEqual([]);
    const slow = report();
    await collectGit([skill('s', '/share/s', ['SKILL.md'])], slow, async () => ({ ok: false, reason: 'git took longer than 5s' }));
    expect(slow.gitProblems).toEqual([{ where: 'skills/home/s', reason: 'git took longer than 5s' }]);
    const r2 = report();
    await collectGit([skill('a', '/x/a', ['SKILL.md']), skill('b', '/x/b', ['SKILL.md'])], r2, async () => ({ ok: false, reason: 'git is not installed' }));
    expect(r2.gitProblems).toEqual([{ where: 'git', reason: 'git is not installed; no commit dates or author counts' }]);
  });
});

describe('withoutPaths', () => {
  it('cuts every path out of a git message in either spelling', async () => {
    const { withoutPaths } = await import('../lib/git.js');
    expect(withoutPaths("fatal: ../../../RYANLI~1/AppData/x/SKILL.md: '../../x/SKILL.md' is outside repository at 'C:/Users/Ryan Liu/AppData/x'")).toBe("fatal: <path>: '<path>' is outside repository at '<path>'");
    expect(withoutPaths('fatal: not a git repository (or any of the parent directories): .git')).toBe('fatal: not a git repository (or any of the parent directories): .git');
    expect(withoutPaths('')).toBe('git failed');
  });
});
