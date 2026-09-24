import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli/args.js';

describe('parseArgs', () => {
  it('defaults: usage on, everything else off', () => {
    const parsed = parseArgs([]);
    expect(parsed).toEqual({ ok: true, options: { json: false, usage: true, includeHooks: false, includeClaudeMd: false, hashLabels: false, help: false, version: false } });
  });

  it('reads every flag in both spellings of --out', () => {
    for (const argv of [['--out', 'x/y'], ['--out=x/y']]) {
      const parsed = parseArgs([...argv, '--no-usage', '--include-hooks', '--include-claude-md', '--hash-labels', '--json']);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.options).toMatchObject({ out: 'x/y', usage: false, includeHooks: true, includeClaudeMd: true, hashLabels: true, json: true });
    }
  });

  it('refuses an unknown flag, a stray argument, and --out without a value', () => {
    expect(parseArgs(['--upload'])).toEqual({ ok: false, error: 'unknown flag --upload' });
    expect(parseArgs(['now'])).toEqual({ ok: false, error: 'unexpected argument now' });
    expect(parseArgs(['--out'])).toEqual({ ok: false, error: '--out needs a folder path' });
    expect(parseArgs(['--out', '--json'])).toEqual({ ok: false, error: '--out needs a folder path' });
  });
});
