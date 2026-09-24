#!/usr/bin/env node
/**
 * The bin entry. Parses flags, runs the collector, prints one screen (spec §4) and owns the exit
 * code: non-zero only when nothing at all could be written (spec §4) or the flags are wrong.
 */
import { HELP, parseArgs } from './cli/args.js';
import { COMMIT, VERSION, selfSha256 } from './lib/version.js';

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`terum-skills-report: ${parsed.error}\n\n${HELP}`);
    return 2;
  }
  if (parsed.options.help) { process.stdout.write(HELP); return 0; }
  if (parsed.options.version) {
    process.stdout.write(`terum-skills-report ${VERSION} (sha256 ${await selfSha256()}, commit ${COMMIT})\n`);
    return 0;
  }
  // 0.0.1 is the placeholder that holds the npm name (walk D3). It writes nothing.
  process.stderr.write(`terum-skills-report ${VERSION}: this placeholder release collects nothing. Use a 1.x release.\n`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
