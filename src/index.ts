#!/usr/bin/env node
/**
 * The bin entry. Parses flags, runs the collector, prints one screen (spec §4) and owns the exit
 * code: non-zero only when nothing at all could be written (spec §4) or the flags are wrong.
 */
import { homedir, hostname, release } from 'node:os';
import { HELP, parseArgs } from './cli/args.js';
import { renderJson, renderScreen } from './lib/screen.js';
import { COMMIT, VERSION, selfSha256 } from './lib/version.js';
import { run } from './run.js';

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`terum-skills-report: ${parsed.error}\n\n${HELP}`);
    return 2;
  }
  if (parsed.options.help) { process.stdout.write(HELP); return 0; }
  const sha256 = await selfSha256();
  if (parsed.options.version) {
    process.stdout.write(`terum-skills-report ${VERSION} (sha256 ${sha256}, commit ${COMMIT})\n`);
    return 0;
  }
  const { SHELL, PSModulePath, ComSpec } = process.env;
  let result;
  try {
    result = await run({
      home: homedir(),
      hostname: hostname(),
      platform: { platform: process.platform, release: release(), nodeVersion: process.version, env: { SHELL, PSModulePath, ComSpec } },
      argv,
      options: parsed.options,
      now: new Date(),
      version: VERSION,
      commit: COMMIT,
      sha256,
    });
  } catch (error) {
    // The one fatal case (spec §4): the output folder itself could not be written.
    process.stderr.write(`terum-skills-report: could not write the output folder: ${error instanceof Error ? error.message : String(error)}\nNothing was sent anywhere.\n`);
    return 1;
  }
  process.stdout.write(parsed.options.json ? renderJson(result.report) : renderScreen(result.report));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
