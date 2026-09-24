/**
 * Copies one file from disk into the output: reads it, decides text or binary, runs the redaction
 * pass on text (spec §5.4), and hands the result to `Output`, which scrubs identity and hashes.
 * A file that cannot be copied is a recorded reason, never an exception (spec §5.6).
 */
import { readFile, stat } from 'node:fs/promises';
import type { Output } from './output.js';
import type { Redaction, Report } from './report.js';

/** Larger than this and it is not a skill file; a video or a model dump is skipped and listed. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RedactResult { text: string; redactions: { line: number; rule: string; name: string; hint: string }[] }
export type Redactor = (text: string) => RedactResult;

export type CopyOutcome =
  | { ok: true; outputPath: string; sha256: string; bytes: number; textChars: number | undefined; redactions: number }
  | { ok: false; reason: string };

/** A NUL byte in the first 8 KiB means binary: copied as bytes, not scanned, and listed as such. */
export const looksBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0);

export class Copier {
  constructor(private readonly output: Output, private readonly report: Report, private readonly redact: Redactor) {}

  async copy(diskPath: string, outputPath: string): Promise<CopyOutcome> {
    let size: number;
    try {
      const info = await stat(diskPath);
      if (!info.isFile()) return { ok: false, reason: 'not a regular file' };
      size = info.size;
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (size > MAX_FILE_BYTES) return { ok: false, reason: `${size} bytes, over the ${MAX_FILE_BYTES / 1024 / 1024} MiB limit` };
    let bytes: Buffer;
    try { bytes = await readFile(diskPath); }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) }; }

    if (looksBinary(bytes)) {
      const written = await this.output.writeBytes(outputPath, bytes);
      this.report.unscanned.push(outputPath);
      return { ok: true, outputPath, sha256: written.sha256, bytes: written.bytes, textChars: undefined, redactions: 0 };
    }
    const text = bytes.toString('utf8');
    const result = this.redact(text);
    const redactions: Redaction[] = result.redactions.map((r) => ({ outputPath, ...r }));
    this.report.redactions.push(...redactions);
    const written = await this.output.writeText(outputPath, result.text);
    return { ok: true, outputPath, sha256: written.sha256, bytes: written.bytes, textChars: text.length, redactions: redactions.length };
  }
}
