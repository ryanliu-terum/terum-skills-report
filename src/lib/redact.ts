/**
 * Redaction (spec §5.4, walk D4). Two tests on literal values only:
 *
 * 1. A value with a known shape: Anthropic, OpenAI, GitHub, AWS and Slack keys, signed web tokens
 *    (three base64url segments starting `eyJ`), private-key blocks, the password inside a
 *    `scheme://user:password@host` URL, and email addresses (identity, spec §5.5).
 * 2. A secret-shaped literal assigned to a name that contains key, secret, token, password,
 *    passwd, credential or auth at a word boundary (`api_key`, `apiKey`, `AUTH_TOKEN`,
 *    `Authorization:`), through `=`, `:=`, `:`, `=>`, a `--password value` flag, or a YAML block
 *    scalar (`password: |` with the value on the next lines). Reading a variable (`$X`,
 *    `${{ secrets.X }}`, `os.environ[...]`, `process.env.X`) is never flagged, and neither is a
 *    placeholder like `<your-key>`, a path, a URL, a type name or a code word.
 *
 * Only the value span is replaced, with `[REDACTED:<rule>]`; the name, the rest of the line and the
 * file's line count are kept. Private-key body lines and block-scalar lines are replaced one for
 * one. The report carries file, line, rule, name and a hint that holds no characters of the value:
 * for a shape rule its fixed prefix, otherwise the length.
 *
 * The shapes are our own regular expressions, written from the vendors' documented prefixes. The
 * spec named gitleaks's rule set as a candidate to vendor; its rules are MIT-licensed, but the
 * shapes the spec lists fit in a page and are easier for the engineer to read here.
 */
import type { RedactResult } from './copier.js';

interface ShapeRule { rule: string; pattern: RegExp; prefix: string; group?: number }

/** Order matters: `sk-ant-` must be taken by the Anthropic rule before the OpenAI rule sees `sk-`. */
const SHAPES: readonly ShapeRule[] = [
  { rule: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, prefix: 'sk-ant-' },
  { rule: 'openai-key', pattern: /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, prefix: 'sk-' },
  { rule: 'github-token', pattern: /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g, prefix: 'gh*_' },
  { rule: 'aws-access-key', pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g, prefix: 'AKIA' },
  { rule: 'slack-token', pattern: /xox[abposr]-[A-Za-z0-9-]{10,}/g, prefix: 'xox?-' },
  { rule: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, prefix: 'eyJ' },
  // `postgres://app:hunter22pass@db/app`: the password between the first `:` after the user and the `@`.
  { rule: 'url-credentials', pattern: /(?<=:\/\/[^\s:@/]{1,64}:)([^\s@/]{1,256})(?=@)/g, prefix: '://user:' },
  // Not a secret, but identity: spec §5.5 allows no email anywhere in the bundle, and skills carry
  // `author:` lines. `git@github.com:org/repo` (scp form, a colon after the host) is left alone.
  { rule: 'email', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-]|:[A-Za-z0-9])/g, prefix: '' },
];

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;

/**
 * The spec's list plus `apikey`, `pwd`, `authorization`, `bearer`. Plurals are left out on
 * purpose: `tokens`, `keys` and `secrets` name counts, maps and containers in code far more often
 * than one secret value (`max_tokens = 4096`, `keys: string[]`); `credentials` stays because it
 * routinely names a single `user:password` string.
 */
const KEYWORDS = ['apikey', 'key', 'secret', 'token', 'password', 'passwd', 'pwd', 'credential', 'credentials', 'auth', 'authorization', 'bearer'];

const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);
const isLower = (c: string | undefined): boolean => c !== undefined && c >= 'a' && c <= 'z';
const isUpper = (c: string | undefined): boolean => c !== undefined && c >= 'A' && c <= 'Z';

/**
 * Does `name` contain a keyword at a word boundary? `api_key`, `apiKey`, `AUTH_TOKEN`, `passwd`
 * and `Authorization` do; `keyboard`, `author`, `tokenize` and `monkey` do not.
 */
export function looksSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const keyword of KEYWORDS) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(keyword, from);
      if (at < 0) break;
      from = at + 1;
      const before = name[at - 1];
      const first = name[at];
      const after = name[at + keyword.length];
      const startsWord = at === 0 || !isLetter(before) || (isLower(before) && isUpper(first));
      const endsWord = after === undefined || !isLetter(after) || isUpper(after);
      if (startsWord && endsWord) return true;
    }
  }
  return false;
}

/**
 * Is this literal shaped like a secret? Variable reads, placeholders, paths, URLs, type names,
 * constant names and ordinary words are not. What passes: at least eight characters with a digit
 * (`hunter22`, `abcd1234efgh`), or at least sixteen without one (`correcthorsebatterystaple`).
 * Measured on this machine's 117 skills on 2026-09-24: the plain rule flagged 338 lines, every
 * one a code word (`key: string`, `const key = 'compact'`, `max_tokens = 4096`); this rule keeps
 * the fixture's planted secrets and drops those.
 */
export function isLiteralValue(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false;
  if (/^[$%{<([`]/.test(v)) return false;
  if (/environ|getenv|process\.env|secrets\.|vars\.|\$\{|\$\(/i.test(v)) return false;
  if (/^(your|changeme|change-me|xxx|\*\*\*|\.\.\.|example|placeholder|dummy|redacted|\[redacted)/i.test(v)) return false;
  if (/^[*x#._-]+$/i.test(v)) return false;
  if (/^(\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(v) || /:\/\//.test(v)) return false; // a path or a URL
  const hasDigit = /\d/.test(v);
  if (!hasDigit && v.length < 16) return false; // a word: `compact`, `string`, `Bearer`
  if (!hasDigit && /\s/.test(v)) return false; // prose: `"the auth flow for admins"`
  if (!hasDigit && /^[A-Z][A-Z]*(?:_[A-Z]+)+$/.test(v)) return false; // a CONSTANT_NAME
  if (/^[A-Za-z_][A-Za-z0-9_.]*\(/.test(v)) return false; // a call: `getToken(`
  return true;
}

/** `name = value`, `name: value`, `name := value`, `'name' => value`; the value is quoted or runs to whitespace, comma, semicolon or ampersand. */
const ASSIGNMENT = /([A-Za-z_][A-Za-z0-9_.-]*)["']?[ \t]*(?::=|=>|=|:)(?!=)[ \t]*("([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^\s,;'"`&]+))/g;
/** `--password hunter22x1`, `--api-key=…`, and `.netrc`'s `password hunter22x1`. */
const FLAG = /(?:^|[\s"'])(--?(?:password|passwd|pwd|token|secret|api-?key|auth|key)|password|passwd)[ \t=]+("([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,;'"`&]+))/g;
/** YAML block scalar indicators: the value is on the following, more indented lines. */
const BLOCK_SCALAR = /^[|>][+-]?\d?$/;
/** Beyond this the name rule's scan is quadratic; the shape rules still run on such a line. */
const NAME_RULE_LINE_CAP = 20_000;

const lengthHint = (value: string): string => `${value.length} chars`;

/** The variable name to the left of a shape match, when the match sits on the right of `name=` or `name:`. */
function nameBefore(line: string, index: number): string {
  const left = line.slice(0, index);
  // `DATABASE_URL=postgres://app:` before a url-credentials match: the scheme and user are skipped.
  const match = /([A-Za-z_][A-Za-z0-9_.-]*)["']?[ \t]*(?::=|=>|=|:)[ \t]*(?:Bearer[ \t]+|Basic[ \t]+)?["'`]?(?:[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)?$/i.exec(left);
  return match?.[1] ?? '';
}

const indentOf = (line: string): number => /^[ \t]*/.exec(line)![0].length;

export function redact(text: string): RedactResult {
  const lines = text.split('\n');
  const redactions: RedactResult['redactions'] = [];
  let inKey: { start: number; body: number } | undefined;
  let inBlock: { start: number; indent: number; name: string; body: number } | undefined;

  const closeBlock = (): void => {
    if (inBlock === undefined) return;
    redactions.push({ line: inBlock.start, rule: 'named-secret', name: inBlock.name, hint: `block scalar, ${inBlock.body} line${inBlock.body === 1 ? '' : 's'}` });
    inBlock = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const lineNo = i + 1;
    const crlf = line.endsWith('\r') ? '\r' : '';

    if (inKey !== undefined) {
      if (PRIVATE_KEY_END.test(line)) {
        redactions.push({ line: inKey.start, rule: 'private-key', name: '', hint: `${inKey.body} body line${inKey.body === 1 ? '' : 's'}` });
        inKey = undefined;
      } else {
        lines[i] = `[REDACTED:private-key]${crlf}`;
        inKey.body++;
      }
      continue;
    }
    if (inBlock !== undefined) {
      if (line.trim().length > 0 && indentOf(line) > inBlock.indent) {
        lines[i] = `${line.slice(0, indentOf(line))}[REDACTED:named-secret]${crlf}`;
        inBlock.body++;
        continue;
      }
      if (line.trim().length === 0) continue; // a blank line inside the block
      closeBlock();
    }
    if (PRIVATE_KEY_BEGIN.test(line)) {
      const begin = PRIVATE_KEY_BEGIN.exec(line)!;
      const afterBegin = begin.index + begin[0].length;
      const end = PRIVATE_KEY_END.exec(line);
      if (end !== null && end.index > afterBegin) {
        // A key folded onto one line with literal `\n`.
        lines[i] = `${line.slice(0, afterBegin)}[REDACTED:private-key]${line.slice(end.index)}`;
        redactions.push({ line: lineNo, rule: 'private-key', name: '', hint: `${end.index - afterBegin} chars on one line` });
        continue;
      }
      inKey = { start: lineNo, body: 0 };
      if (line.slice(afterBegin).trim().length > 0) {
        lines[i] = `${line.slice(0, afterBegin)}[REDACTED:private-key]${crlf}`;
        inKey.body++;
      }
      continue;
    }

    for (const shape of SHAPES) {
      shape.pattern.lastIndex = 0;
      line = line.replace(shape.pattern, (value: string, ...rest: unknown[]) => {
        // With a capture group the offset is the second-to-last argument, not the second.
        const offset = rest[rest.length - 2] as number;
        redactions.push({ line: lineNo, rule: shape.rule, name: nameBefore(line, offset), hint: shape.prefix.length > 0 ? `${shape.prefix}… (${lengthHint(value)})` : lengthHint(value) });
        return `[REDACTED:${shape.rule}]`;
      });
    }

    if (line.length > NAME_RULE_LINE_CAP) { lines[i] = line; continue; }

    const spans: { start: number; end: number; name: string; value: string }[] = [];
    ASSIGNMENT.lastIndex = 0;
    for (let match = ASSIGNMENT.exec(line); match !== null; match = ASSIGNMENT.exec(line)) {
      const name = match[1]!;
      // An innocent name (`https:` in a URL) must not swallow a `token=` further along its value.
      if (!looksSecretName(name)) { ASSIGNMENT.lastIndex = match.index + name.length + 1; continue; }
      const raw = match[2]!;
      const quoted = match[3] ?? match[4] ?? match[5];
      let value = quoted ?? match[6]!;
      let start = match.index + match[0].length - raw.length + (quoted !== undefined ? 1 : 0);
      let end = start + value.length;
      if (quoted === undefined && BLOCK_SCALAR.test(value) && line.slice(end).trim().length === 0) {
        inBlock = { start: lineNo, indent: indentOf(line), name, body: 0 };
        break;
      }
      // `Authorization: Bearer <token>`, `Basic <base64>`: the secret is the token after the scheme word, whatever its shape.
      let scheme = false;
      if (quoted === undefined && /^(Bearer|Basic|Token)$/i.test(value)) {
        const rest = /^[ \t]+([^\s,;'"`&]+)/.exec(line.slice(end));
        if (rest !== null) { start = end + rest[0].length - rest[1]!.length; value = rest[1]!; end = start + value.length; scheme = true; }
      }
      if (value.startsWith('[REDACTED:')) continue; // a shape rule already took it
      if (scheme ? value.length < 8 || /^[$%{<([`]/.test(value) : !isLiteralValue(value)) continue;
      spans.push({ start, end, name, value });
    }
    FLAG.lastIndex = 0;
    for (let match = FLAG.exec(line); match !== null; match = FLAG.exec(line)) {
      const raw = match[2]!;
      const quoted = match[3] ?? match[4];
      const value = quoted ?? match[5]!;
      const start = match.index + match[0].length - raw.length + (quoted !== undefined ? 1 : 0);
      if (value.startsWith('[REDACTED:') || !isLiteralValue(value)) continue;
      if (spans.some((s) => start < s.end && start + value.length > s.start)) continue;
      spans.push({ start, end: start + value.length, name: match[1]!, value });
    }
    if (spans.length > 0) {
      spans.sort((a, b) => a.start - b.start);
      let out = '';
      let cursor = 0;
      for (const span of spans) {
        redactions.push({ line: lineNo, rule: 'named-secret', name: span.name, hint: lengthHint(span.value) });
        out += `${line.slice(cursor, span.start)}[REDACTED:named-secret]`;
        cursor = span.end;
      }
      line = out + line.slice(cursor);
    }
    lines[i] = line;
  }
  closeBlock();
  if (inKey !== undefined) redactions.push({ line: inKey.start, rule: 'private-key', name: '', hint: `${inKey.body} body line${inKey.body === 1 ? '' : 's'}, no END line` });
  redactions.sort((a, b) => a.line - b.line);
  return { text: lines.join('\n'), redactions };
}
