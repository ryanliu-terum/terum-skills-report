import { describe, expect, it } from 'vitest';
import { isLiteralValue, looksSecretName, redact } from '../lib/redact.js';
import { PLANTED } from './fixture.js';

const lineCount = (s: string): number => s.split('\n').length;

describe('looksSecretName', () => {
  it('finds a keyword at a word boundary in every common spelling', () => {
    for (const name of ['api_key', 'apiKey', 'APIKEY', 'AUTH_TOKEN', 'passwd', 'password', 'Authorization', 'my-secret-key', 'db.password', 'credentials', 'token', 'x_pwd', 'SECRET_KEY_BASE', 'client_secret'])
      expect(looksSecretName(name), name).toBe(true);
  });
  it('leaves ordinary words alone', () => {
    for (const name of ['author', 'authors', 'keyboard', 'monkey', 'tokenize', 'tokenizer', 'hockey', 'keynote', 'description', 'name', 'authority'])
      expect(looksSecretName(name), name).toBe(false);
  });
});

describe('isLiteralValue', () => {
  it('rejects variable reads, placeholders, paths, words, constant names and calls', () => {
    for (const v of ['$ANTHROPIC_API_KEY', '${TOKEN}', '${{ secrets.NPM_TOKEN }}', 'os.environ["X"]', 'process.env.X', '<your-token>', 'your-api-key-here', 'changeme', '***', 'xxx', 'true', 'null', 'abc', '$(cat file)', '%TOKEN%', '{{ token }}', '[REDACTED:x]', 'os.getenv("K")',
      // Measured false alarms from real skills (2026-09-24): code words, types, counts, constants.
      'string', 'compact', 'Bearer', 'RAW_TOKEN_PATTERN', 'MAX_TOKENS_X', 'scale_type', 'dimKey', '4096', 'getToken()', 'readToken(file)', '/run/secrets/pw', './keys/dev.pem', 'C:\\keys\\x.p12', 'the auth flow for admins', 'Authentication tokens issued by the server'])
      expect(isLiteralValue(v), v).toBe(false);
  });
  it('accepts secret-shaped literals: eight characters with a digit, or sixteen without', () => {
    for (const v of ['hunter22', 'PlantedHunter2Pass', 'v4lu3-here', 'abcdef0123456789', 'correcthorsebatterystaple', 'correct horse battery staple 9', 'dGhpcyBpcyBhIHNlY3JldA==', 'p@ssw0rd!'])
      expect(isLiteralValue(v), v).toBe(true);
  });
});

describe('redact', () => {
  it('replaces each known shape with its rule name and keeps the rest of the line', () => {
    // The planted values from the fixture: shaped like the real thing, recognisably fake.
    const input = [
      `A=${PLANTED.anthropicKey}`,
      `B=${PLANTED.openaiKey}`,
      `C=${PLANTED.githubToken}`,
      `D=${PLANTED.awsKey}`,
      `E=${PLANTED.slackToken}`,
      `F=${PLANTED.jwt}`,
    ].join('\n');
    const { text, redactions } = redact(input);
    expect(text.split('\n')).toEqual(['A=[REDACTED:anthropic-key]', 'B=[REDACTED:openai-key]', 'C=[REDACTED:github-token]', 'D=[REDACTED:aws-access-key]', 'E=[REDACTED:slack-token]', 'F=[REDACTED:jwt]']);
    expect(redactions.map((r) => [r.line, r.rule, r.name])).toEqual([[1, 'anthropic-key', 'A'], [2, 'openai-key', 'B'], [3, 'github-token', 'C'], [4, 'aws-access-key', 'D'], [5, 'slack-token', 'E'], [6, 'jwt', 'F']]);
    for (const r of redactions) expect(r.hint).toMatch(/^.{6}… \(\d+ chars\)$/);
    expect(text).not.toContain('PLANTED');
  });

  it('replaces email addresses, which are identity, and leaves scp-style git remotes and npm scopes alone', () => {
    const { text, redactions } = redact('author: Some One <some.one+tag@example.co.uk>\nclone git@github.com:org/repo.git\nnpm i @anthropic-ai/sdk\nmail me at someone@example.com.');
    expect(text).toBe('author: Some One <[REDACTED:email]>\nclone git@github.com:org/repo.git\nnpm i @anthropic-ai/sdk\nmail me at [REDACTED:email].');
    expect(redactions.map((r) => [r.line, r.rule])).toEqual([[1, 'email'], [4, 'email']]);
  });

  it('replaces only the value of a literal assigned to a secret-looking name', () => {
    const cases: [string, string][] = [
      ['password: PlantedHunter2Pass', 'password: [REDACTED:named-secret]'],
      ['passwd:hunter22', 'passwd:[REDACTED:named-secret]'],
      ['export API_KEY="abcd1234efgh"', 'export API_KEY="[REDACTED:named-secret]"'],
      ["const apiKey = 'v4lu3-here';", "const apiKey = '[REDACTED:named-secret]';"],
      ['TOKEN := "abc12345"', 'TOKEN := "[REDACTED:named-secret]"'],
      ['my-secret-key: v4lu3-here # comment', 'my-secret-key: [REDACTED:named-secret] # comment'],
      ['curl https://x.test/api?token=abc12345&y=1', 'curl https://x.test/api?token=[REDACTED:named-secret]&y=1'],
      ['-H "Authorization: Bearer opaque-token-value-1"', '-H "Authorization: Bearer [REDACTED:named-secret]"'],
      ['{"client_secret": "s3cr3tvalue"}', '{"client_secret": "[REDACTED:named-secret]"}'],
    ];
    for (const [input, expected] of cases) {
      const { text, redactions } = redact(input);
      expect(text, input).toBe(expected);
      expect(redactions, input).toHaveLength(1);
      expect(redactions[0]!.rule).toBe('named-secret');
      expect(redactions[0]!.hint).toMatch(/^.{2}… \(\d+ chars\)$/);
    }
  });

  it('never flags a variable read, a placeholder, a comparison or an innocent name', () => {
    const untouched = [
      'echo "$ANTHROPIC_API_KEY"',
      'KEY = os.environ["OPENAI_API_KEY"]',
      'const token = process.env.TOKEN;',
      'api_key: ${{ secrets.API_KEY }}',
      'token: <your-token>',
      'password: ****',
      'AUTH_MODE=$MODE',
      'author=someone',
      'keyboard: qwerty',
      'if (token == "abc12345") {',
      'tokenizer: tiktoken',
      'description: The auth flow',
      'secret: true',
      'PASSWORD=',
      'key: string;',
      "const key = 'compact';",
      'MAX_TOKENS = 4096',
      'accessorKey: "dimKey",',
      'const TOKENS = RAW_TOKEN_PATTERN;',
      'tokens_out = total_tokens_out',
      'password: /run/secrets/pw',
      'const token = getToken(session);',
      'X-API-Key: equal to the header name',
    ];
    for (const line of untouched) {
      const { text, redactions } = redact(line);
      expect(text, line).toBe(line);
      expect(redactions, line).toEqual([]);
    }
  });

  it('replaces private-key body lines one for one and keeps the line count', () => {
    const input = ['before', '-----BEGIN RSA PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC-PLANTED', 'AgEAAoIBAQC', '-----END RSA PRIVATE KEY-----', 'after'].join('\n');
    const { text, redactions } = redact(input);
    expect(lineCount(text)).toBe(lineCount(input));
    expect(text.split('\n')).toEqual(['before', '-----BEGIN RSA PRIVATE KEY-----', '[REDACTED:private-key]', '[REDACTED:private-key]', '-----END RSA PRIVATE KEY-----', 'after']);
    expect(redactions).toEqual([{ line: 2, rule: 'private-key', name: '', hint: '2 body lines' }]);
  });

  it('handles a key block with no END line and one folded onto a single line', () => {
    const open = redact('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nmore');
    expect(open.text).toBe('-----BEGIN OPENSSH PRIVATE KEY-----\n[REDACTED:private-key]\n[REDACTED:private-key]');
    expect(open.redactions[0]!.hint).toContain('no END line');
    const folded = redact('KEY="-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----"');
    expect(folded.text).toBe('KEY="-----BEGIN PRIVATE KEY-----[REDACTED:private-key]-----END PRIVATE KEY-----"');
  });

  it('keeps CRLF line endings and line count on Windows-style files', () => {
    const input = 'a\r\npassword: hunter22\r\nb\r\n';
    const { text } = redact(input);
    expect(text).toBe('a\r\npassword: [REDACTED:named-secret]\r\nb\r\n');
  });

  it('handles two secrets on one line and a shape inside a named assignment without double-redacting', () => {
    const { text, redactions } = redact(`export A=${PLANTED.anthropicKey} B=hunter22 password=hunter23`);
    expect(text).toBe('export A=[REDACTED:anthropic-key] B=hunter22 password=[REDACTED:named-secret]');
    expect(redactions.map((r) => r.rule)).toEqual(['anthropic-key', 'named-secret']);
    const both = redact(`OPENAI_API_KEY = "${PLANTED.openaiKey}"`);
    expect(both.text).toBe('OPENAI_API_KEY = "[REDACTED:openai-key]"');
    expect(both.redactions).toHaveLength(1);
  });
});
