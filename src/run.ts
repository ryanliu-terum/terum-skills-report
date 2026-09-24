/**
 * The collector, one stage after another (spec §2, §3). Every stage records its failures on the
 * report and returns; nothing here throws for a bad file, a missing folder or a slow git. The only
 * exception is failing to create the output folder itself, which the bin reports and exits on.
 */
import { realpath } from 'node:fs';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { CliOptions } from './cli/args.js';
import { Copier } from './lib/copier.js';
import { toCsv, type CsvValue } from './lib/csv.js';
import { discover } from './lib/discover.js';
import { describeEnvironment, type Platform } from './lib/env.js';
import { collectGit } from './lib/git.js';
import { readHome } from './lib/home.js';
import { collectLinked } from './lib/linked.js';
import { redact } from './lib/redact.js';
import { CSV_COLUMNS, renderCollector, renderFlagged, renderManifest, renderManifestJson } from './lib/manifest.js';
import { Output, Scrubber, unusedFolder, type WrittenFile } from './lib/output.js';
import type { Report } from './lib/report.js';
import { scanTranscripts, sourceLookup, summaryRows } from './lib/usage/rows.js';

export interface RunOptions {
  /** The home folder. The CLI passes `os.homedir()`; tests pass a fixture. */
  home: string;
  hostname: string;
  platform: Platform;
  /** The flags as typed, for collector.txt. */
  argv: readonly string[];
  options: CliOptions;
  now: Date;
  version: string;
  commit: string;
  sha256: string;
}

export interface RunResult {
  report: Report;
  files: WrittenFile[];
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const { options } = opts;
  const home = await readHome(opts.home, { hashLabels: options.hashLabels });
  // The home folder has two spellings on Windows (8.3 short and long); tools report either.
  const realHome = await promisify(realpath.native)(opts.home).catch(() => opts.home);
  const scrubber = new Scrubber([opts.home, realHome], opts.hostname);

  const date = opts.now.toISOString().slice(0, 10);
  let desktopFallback = false;
  let final: string;
  if (options.out !== undefined) final = options.out;
  else {
    let desktop = join(opts.home, 'Desktop');
    if (!(await isDirectory(desktop))) { desktop = opts.home; desktopFallback = true; }
    final = await unusedFolder(desktop, `terum-skills-report-${date}`);
  }
  const output = new Output(final, scrubber);
  await output.open();

  const report: Report = {
    version: opts.version,
    commit: opts.commit,
    sha256: opts.sha256,
    command: ['terum-skills-report', ...opts.argv].join(' '),
    startedAt: opts.now.toISOString(),
    flags: { usage: options.usage, includeHooks: options.includeHooks, includeClaudeMd: options.includeClaudeMd, hashLabels: options.hashLabels },
    outputFolder: scrubber.scrub(output.final.replaceAll('\\', '/')),
    desktopFallback,
    skills: [],
    extras: [],
    linkedMisses: [],
    redactions: [],
    unscanned: [],
    git: [],
    gitProblems: [],
    usage: { status: options.usage ? 'no-session-data' : 'skipped-by-flag', projectFolders: 0, sessions: 0, headlessSessionsSkipped: 0, subagentTranscripts: 0, filesSkipped: [], linesSkipped: 0, firings: 0, sessionsWithFirings: 0, firstDay: undefined, lastDay: undefined },
    environment: describeEnvironment(home, opts.platform, undefined, new Map(), options.includeHooks),
    locations: [],
    problems: [...home.problems],
  };

  const copier = new Copier(output, report, redact);
  const { skills, pluginSkillCounts } = await discover(home, copier, report, { includeClaudeMd: options.includeClaudeMd });
  await collectLinked(skills, home, copier, report);
  await collectGit(skills, report);

  // Usage tables: headers always, rows when transcripts were read (spec §2.3, §4; walk D1).
  let claudeCodeVersion: string | undefined;
  let rows: { summary: Record<string, CsvValue>[]; firings: Record<string, CsvValue>[]; sessions: Record<string, CsvValue>[] } = { summary: [], firings: [], sessions: [] };
  if (options.usage) {
    const scanned = await scanTranscripts(join(home.claudeDir, 'projects'), skills);
    report.usage = scanned.summary;
    claudeCodeVersion = scanned.claudeCodeVersion;
    rows = { summary: summaryRows(scanned.firings, sourceLookup(skills)), firings: scanned.firings, sessions: scanned.sessions };
  }
  report.environment = describeEnvironment(home, opts.platform, claudeCodeVersion, pluginSkillCounts, options.includeHooks);

  await output.mkdir('skills');
  await output.mkdir('linked');
  await output.mkdir('commands');
  await output.mkdir('agents');
  for (const [name, columns] of Object.entries(CSV_COLUMNS)) await output.writeText(`usage/${name}.csv`, toCsv(columns, rows[name as keyof typeof rows]));

  await output.writeText('collector.txt', renderCollector(report));
  await output.writeText('FLAGGED.md', renderFlagged(report));
  // The manifest lists every file, so it is written last and lists itself by name only.
  const listed = [...output.files];
  await output.writeText('manifest.json', renderManifestJson(report, listed));
  await output.writeText('MANIFEST.md', renderManifest(report, [...output.files]));
  await output.close();
  return { report, files: output.files };
}
