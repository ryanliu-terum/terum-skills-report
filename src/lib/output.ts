/**
 * The one door out. Every byte that lands in the output folder goes through `Output`, which
 * (1) scrubs identity from text (spec §5.5), (2) records a sha256 per file for manifest.json
 * (spec §3), and (3) builds in a `.partial` sibling and renames at the end, so a crash leaves a
 * folder that is visibly unfinished and never a folder that looks complete.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface WrittenFile {
  /** Path inside the output folder, forward slashes. */
  path: string;
  sha256: string;
  bytes: number;
}

/**
 * Windows keeps an 8.3 short name for every long folder name (`Ryan Liu` is also `RYANLI~1`), and
 * temp paths and some tools use it. There is no API to ask for it from Node, so the likely
 * spellings are derived: the first six letters and digits, upper-cased, then `~1` to `~4`. Only
 * segments that need a short name (over eight characters, or with a space or a dot) get one.
 */
export function shortNameSpellings(home: string): string[] {
  if (!/^[A-Za-z]:[\\/]/.test(home)) return [];
  const segments = home.split(/[\\/]/);
  const out: string[] = [];
  segments.forEach((segment, i) => {
    if (i === 0 || (segment.length <= 8 && !/[ .]/.test(segment))) return;
    const stem = segment.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
    if (stem.length === 0) return;
    for (let n = 1; n <= 4; n++) out.push([...segments.slice(0, i), `${stem}~${n}`, ...segments.slice(i + 1)].join('\\'));
  });
  return out;
}

/**
 * Replaces the home path (every spelling) with `~` and the hostname with a marker. This is the
 * last line, not the first: readers build paths relative to `~` or a label before they get here.
 */
export class Scrubber {
  private readonly homePatterns: RegExp[];
  private readonly hostPattern: RegExp | undefined;

  /** `homes`: every known spelling of the home folder (the path as given and its resolved real path). */
  constructor(homes: readonly string[], hostname: string) {
    const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const spellings = new Set<string>();
    for (const home of [...homes, ...homes.flatMap(shortNameSpellings)]) {
      const forward = home.replaceAll('\\', '/');
      const back = home.replaceAll('/', '\\');
      for (const s of [forward, back, back.replaceAll('\\', '\\\\'), `file:///${forward.replace(/^\//, '')}`]) spellings.add(s);
      if (forward.startsWith('/')) spellings.add(`file://${forward}`);
    }
    // Longest first so `C:\\Users\\x` wins over `C:\Users\x` inside JSON.
    const ordered = [...spellings].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
    // Windows paths are case-insensitive and users type them every which way.
    this.homePatterns = ordered.map((s) => new RegExp(escape(s), sep === '\\' ? 'gi' : 'g'));
    // Short hostnames are ordinary words; replacing them would corrupt prose. Five characters and a
    // word boundary keeps `dev` and `mac` alone while catching `ryans-macbook-pro`.
    this.hostPattern = hostname.length >= 5 ? new RegExp(`(?<![A-Za-z0-9-])${escape(hostname)}(?![A-Za-z0-9-])`, 'gi') : undefined;
  }

  scrub(text: string): string {
    let out = text;
    for (const pattern of this.homePatterns) out = out.replace(pattern, '~');
    if (this.hostPattern !== undefined) out = out.replace(this.hostPattern, '[REDACTED:hostname]');
    return out;
  }
}

export class Output {
  readonly final: string;
  readonly staging: string;
  readonly files: WrittenFile[] = [];
  private readonly seen = new Set<string>();

  constructor(final: string, readonly scrubber: Scrubber) {
    this.final = resolve(final);
    this.staging = `${this.final}.partial`;
  }

  /** Creates the staging folder. An old `.partial` from a crashed run is replaced. */
  async open(): Promise<void> {
    await rm(this.staging, { recursive: true, force: true });
    await mkdir(this.staging, { recursive: true });
  }

  /** A path inside the output; `relPath` uses forward slashes and never escapes the folder. */
  private target(relPath: string): string {
    const full = resolve(this.staging, ...relPath.split('/'));
    const rel = relative(this.staging, full);
    if (rel.startsWith('..') || rel.length === 0) throw new Error(`refusing to write outside the output folder: ${relPath}`);
    return full;
  }

  /** Text files: scrubbed, then hashed as written. */
  async writeText(relPath: string, text: string): Promise<WrittenFile> {
    return this.writeBytes(relPath, Buffer.from(this.scrubber.scrub(text), 'utf8'));
  }

  /** Bytes the caller has already prepared (a binary file, or text it scrubbed itself). */
  async writeBytes(relPath: string, bytes: Buffer): Promise<WrittenFile> {
    const full = this.target(relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    const record: WrittenFile = { path: relPath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    if (this.seen.has(relPath)) {
      const index = this.files.findIndex((f) => f.path === relPath);
      if (index >= 0) this.files[index] = record;
    } else {
      this.seen.add(relPath);
      this.files.push(record);
    }
    return record;
  }

  async mkdir(relPath: string): Promise<void> {
    await mkdir(this.target(relPath), { recursive: true });
  }

  /** Renames `.partial` to the final name. Only after everything, including the manifest, is written. */
  async close(): Promise<void> {
    await rename(this.staging, this.final);
  }
}

/** `<parent>/<name>`, or `<name>-2`, `<name>-3` when a folder by that name already exists. */
export async function unusedFolder(parent: string, name: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = join(parent, n === 1 ? name : `${name}-${n}`);
    try { await stat(candidate); } catch { return candidate; }
  }
}
