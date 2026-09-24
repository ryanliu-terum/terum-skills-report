/**
 * Copies one file from disk into the output: reads it, decides text or binary, runs the redaction
 * pass on text (spec §5.4), and hands the result to `Output`, which scrubs identity and hashes.
 * A file that cannot be copied or written is a recorded reason, never an exception (spec §5.6).
 */
import { readFile, stat } from 'node:fs/promises';
import { errorCode } from './home.js';
import type { Output } from './output.js';
import type { Redaction, Report } from './report.js';

/** Larger than this and it is not a skill file; a video or a model dump is skipped and listed. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RedactResult { text: string; redactions: { line: number; rule: string; name: string; hint: string }[] }
export type Redactor = (text: string) => RedactResult;

export type CopyOutcome =
  | { ok: true; outputPath: string; sha256: string; bytes: number; textChars: number | undefined; redactions: number }
  | { ok: false; reason: string };

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be';

/**
 * UTF-16 text has a NUL in every other byte, so a NUL test alone would call a PowerShell script
 * saved by Windows binary and copy it unscanned (review finding, 2026-09-24). A byte-order mark
 * decides first; without one, NULs on every other byte in the sample mean UTF-16.
 */
export function detectEncoding(bytes: Buffer): TextEncoding | 'binary' {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf16be';
  const sample = bytes.subarray(0, 8192);
  if (!sample.includes(0)) return 'utf8';
  let oddNul = 0;
  let evenNul = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) { if (i % 2 === 1) oddNul++; else evenNul++; }
  const pairs = Math.floor(sample.length / 2);
  if (pairs >= 8 && oddNul >= pairs * 0.6 && evenNul <= pairs * 0.1) return 'utf16le';
  if (pairs >= 8 && evenNul >= pairs * 0.6 && oddNul <= pairs * 0.1) return 'utf16be';
  return 'binary';
}

const swap = (bytes: Buffer): Buffer => { const out = Buffer.from(bytes); out.swap16(); return out; };

export function decode(bytes: Buffer, encoding: TextEncoding): string {
  if (encoding === 'utf8') return bytes.toString('utf8');
  const body = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) ? bytes.subarray(2) : bytes;
  const even = body.length % 2 === 0 ? body : body.subarray(0, body.length - 1);
  return (encoding === 'utf16le' ? even : swap(even)).toString('utf16le');
}

/** Re-encodes redacted text in the file's own encoding, with a byte-order mark for UTF-16, so the script still runs. */
export function encode(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf8') return Buffer.from(text, 'utf8');
  const body = Buffer.from(text, 'utf16le');
  return encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : Buffer.concat([Buffer.from([0xfe, 0xff]), swap(body)]);
}

export class Copier {
  constructor(private readonly output: Output, private readonly report: Report, private readonly redact: Redactor) {}

  async copy(diskPath: string, outputPath: string): Promise<CopyOutcome> {
    let size: number;
    try {
      const info = await stat(diskPath);
      if (!info.isFile()) return { ok: false, reason: 'not a regular file' };
      size = info.size;
    } catch (error) {
      return { ok: false, reason: `could not read (${errorCode(error)})` };
    }
    if (size > MAX_FILE_BYTES) return { ok: false, reason: `${size} bytes, over the ${MAX_FILE_BYTES / 1024 / 1024} MiB limit` };
    let bytes: Buffer;
    try { bytes = await readFile(diskPath); }
    catch (error) { return { ok: false, reason: `could not read (${errorCode(error)})` }; }

    const encoding = detectEncoding(bytes);
    try {
      if (encoding === 'binary') {
        const written = await this.output.writeBytes(outputPath, bytes);
        this.report.unscanned.push(outputPath);
        return { ok: true, outputPath, sha256: written.sha256, bytes: written.bytes, textChars: undefined, redactions: 0 };
      }
      const text = decode(bytes, encoding);
      const result = this.redact(text);
      const redactions: Redaction[] = result.redactions.map((r) => ({ outputPath, ...r }));
      const scrubbed = this.output.scrubber.scrub(result.text);
      const written = encoding === 'utf8' ? await this.output.writeText(outputPath, scrubbed) : await this.output.writeBytes(outputPath, encode(scrubbed, encoding));
      this.report.redactions.push(...redactions);
      return { ok: true, outputPath, sha256: written.sha256, bytes: written.bytes, textChars: text.length, redactions: redactions.length };
    } catch (error) {
      // A quarantined copy, a path too long for this Windows, a full disk: this file is listed, the run goes on.
      return { ok: false, reason: `could not write (${errorCode(error)})` };
    }
  }
}
