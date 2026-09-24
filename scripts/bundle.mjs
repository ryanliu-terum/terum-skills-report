#!/usr/bin/env node
// Bundle src/index.ts into the one file that ships: dist/index.js. No sourcemap, no minify, so the
// engineer who reads the published file reads the same shape of code that is in this repo.
// The version and source commit are baked in at build time; the bundle's own sha256 is computed at
// run time from the file that is actually running (spec §5.1).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unknown'; }
}

const result = await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(root, 'dist', 'index.js'),
  sourcemap: false,
  minify: false,
  legalComments: 'inline',
  logLevel: 'silent',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(commit()),
  },
});
for (const warning of result.warnings) console.error(`bundle: ${warning.text}`);

const out = await readFile(join(root, 'dist', 'index.js'), 'utf8');
const first = out.split('\n', 1)[0];
if (first !== '#!/usr/bin/env node') {
  console.error(`dist/index.js lost its shebang (first line was ${JSON.stringify(first)}).`);
  process.exit(1);
}
// The offline promise, checked on the artifact and not only on the sources (spec §5.2).
const forbidden = /from\s+["'](node:)?(http|https|http2|net|tls|dns|dgram)["']/;
if (forbidden.test(out)) {
  console.error('dist/index.js imports a network module; the collector must be offline.');
  process.exit(1);
}
console.error(`Bundled dist/index.js (${out.length} bytes, ${out.split('\n').length} lines)`);
