/**
 * Hand-written argument parsing (spec §8.2): the surface is seven flags and small enough that a
 * dependency would be more to read than this file.
 */

export interface CliOptions {
  /** Output folder; defaults to `~/Desktop/terum-skills-report-<date>/`. */
  out?: string;
  /** Print the summary as one JSON object instead of the screen. */
  json: boolean;
  /** Read session transcripts for usage counts (spec §2.3, walk D1). `--no-usage` turns it off. */
  usage: boolean;
  /** Include hook command lines from settings.json (spec §2.4, walk D6). */
  includeHooks: boolean;
  /** Include project CLAUDE.md and rule files (spec §2.4, walk D7). */
  includeClaudeMd: boolean;
  /** Label projects by a hash of their path instead of the folder name (spec §5.5, walk D5). */
  hashLabels: boolean;
  help: boolean;
  version: boolean;
}

export type ParsedArgs = { ok: true; options: CliOptions } | { ok: false; error: string };

export const HELP = `terum-skills-report

Gathers your Claude Code skills, the scripts they reference and locally derived usage counts into
one folder on your desktop. Runs offline. You review the folder, then zip and send it yourself.

Usage: npx -y terum-skills-report@<version> [flags]

  --out <dir>          write here instead of ~/Desktop/terum-skills-report-<date>/
  --no-usage           do not read session transcripts (the manifest says so)
  --include-hooks      include hook command lines from settings.json (off by default)
  --include-claude-md  include project CLAUDE.md and rule files (off by default)
  --hash-labels        name projects by a hash instead of the folder name
  --json               print the summary as one JSON object
  --version            print the version
  --help               this text
`;

type BooleanFlag = 'json' | 'includeHooks' | 'includeClaudeMd' | 'hashLabels' | 'help' | 'version';
const BOOLEAN_FLAGS: Record<string, BooleanFlag> = {
  '--json': 'json',
  '--include-hooks': 'includeHooks',
  '--include-claude-md': 'includeClaudeMd',
  '--hash-labels': 'hashLabels',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: CliOptions = { json: false, usage: true, includeHooks: false, includeClaudeMd: false, hashLabels: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--no-usage') { options.usage = false; continue; }
    if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? argv[++i] : arg.slice('--out='.length);
      if (value === undefined || value.length === 0 || value.startsWith('--')) return { ok: false, error: '--out needs a folder path' };
      options.out = value;
      continue;
    }
    const key = BOOLEAN_FLAGS[arg];
    if (key !== undefined) { options[key] = true; continue; }
    return { ok: false, error: arg.startsWith('-') ? `unknown flag ${arg}` : `unexpected argument ${arg}` };
  }
  return { ok: true, options };
}
