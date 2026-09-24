import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignLabels } from '../lib/home.js';
import { run, type RunOptions } from '../run.js';
import { buildFixture, PLANTED, type Fixture } from './fixture.js';

describe('assignLabels', () => {
  it('uses the folder name and disambiguates a second project with the same name', () => {
    const labels = assignLabels(['/a/api', '/b/api', '/c/web'], false);
    expect([...labels.values()]).toEqual(['api', 'api-2', 'web']);
  });
  it('uses a 12-character hash with --hash-labels', () => {
    const labels = assignLabels(['/a/api', '/b/api'], true);
    for (const label of labels.values()) expect(label).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set(labels.values()).size).toBe(2);
  });
});

describe('discovery flags', () => {
  let fixture: Fixture;
  const base = (out: string): RunOptions => ({
    home: fixture.home,
    hostname: PLANTED.hostname,
    platform: { platform: process.platform, release: '1', nodeVersion: process.version, env: {} },
    argv: [],
    options: { out, json: false, usage: false, includeHooks: false, includeClaudeMd: false, hashLabels: false, help: false, version: false },
    now: new Date('2026-09-24T12:00:00Z'),
    version: 't', commit: 'c', sha256: 's',
  });

  beforeAll(async () => { fixture = await buildFixture(); });
  afterAll(async () => { await rm(fixture.tmp, { recursive: true, force: true }); });

  it('--include-claude-md copies project CLAUDE.md under claude-md/<source>/ and says so', async () => {
    const out = join(fixture.home, 'Desktop', 'with-claude-md');
    const opts = base(out);
    opts.options.includeClaudeMd = true;
    const { report } = await run(opts);
    expect(report.extras.filter((e) => e.kind === 'claude-md').map((e) => e.outputPath)).toEqual(['claude-md/project-projA/CLAUDE.md']);
    expect(await readFile(join(out, 'claude-md', 'project-projA', 'CLAUDE.md'), 'utf8')).toContain(PLANTED.claudeMd);
    const manifest = await readFile(join(out, 'MANIFEST.md'), 'utf8');
    expect(manifest).not.toContain('were not read (pass `--include-claude-md`)');
  });

  it('--include-hooks puts hook commands in the manifest with the home path scrubbed', async () => {
    const out = join(fixture.home, 'Desktop', 'with-hooks');
    const opts = base(out);
    opts.options.includeHooks = true;
    const { report } = await run(opts);
    expect(report.environment.hookCommands).toEqual([`SessionStart: ${PLANTED.hookCommand} --start`, `Stop: ${PLANTED.hookCommand}`]);
    const manifest = await readFile(join(out, 'MANIFEST.md'), 'utf8');
    expect(manifest).toContain('hook commands (included by `--include-hooks`)');
    expect(manifest).not.toContain(fixture.home);
  });

  it('--hash-labels names project sources by hash, and --no-usage says so', async () => {
    const out = join(fixture.home, 'Desktop', 'hashed');
    const opts = base(out);
    opts.options.hashLabels = true;
    const { report } = await run(opts);
    const projectSources = [...new Set(report.skills.filter((s) => s.source.startsWith('project-')).map((s) => s.source))];
    expect(projectSources).toHaveLength(2);
    for (const source of projectSources) expect(source).toMatch(/^project-[0-9a-f]{12}$/);
    expect(report.usage.status).toBe('skipped-by-flag');
    const manifest = await readFile(join(out, 'MANIFEST.md'), 'utf8');
    expect(manifest).toContain('`--no-usage`');
    expect(manifest).not.toContain('projA');
  });
});
