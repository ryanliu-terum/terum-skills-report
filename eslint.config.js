// ESLint flat config.
//
// Two gates the collector's promises depend on live here, not in a paragraph (docs/spec.md §5.2):
//
// 1. OFFLINE. No source file may import a network module or call `fetch`. The run makes no network
//    call, and a rule catches a future import before a reviewer has to.
// 2. ONE PLACE SPAWNS. Only src/lib/git.ts may import child_process, and every spawn there carries a
//    deadline. Nothing else runs a program.
import tseslint from 'typescript-eslint';

const NETWORK_MODULES = '^(node:)?(http|https|http2|net|tls|dns|dgram|worker_threads|cluster)$';
const SPAWN_MODULES = '^(node:)?child_process$';

const OFFLINE = {
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { regex: NETWORK_MODULES, message: 'The collector is offline (spec §5.2). No network modules.' },
        { regex: SPAWN_MODULES, message: 'Only src/lib/git.ts spawns, with a deadline (spec §2.5).' },
      ],
    }],
    'no-restricted-globals': ['error',
      { name: 'fetch', message: 'The collector is offline (spec §5.2).' },
      { name: 'WebSocket', message: 'The collector is offline (spec §5.2).' },
      { name: 'XMLHttpRequest', message: 'The collector is offline (spec §5.2).' },
    ],
    'no-restricted-syntax': ['error',
      { selector: `ImportExpression[source.value=/${NETWORK_MODULES.replaceAll('/', '\\/')}/]`, message: 'The collector is offline (spec §5.2).' },
      { selector: `ImportExpression[source.value=/${SPAWN_MODULES}/]`, message: 'Only src/lib/git.ts spawns (spec §2.5).' },
      { selector: "CallExpression[callee.name='require']", message: 'ESM only; no require.' },
    ],
  },
};

// Tests may spawn the built bundle; the offline rule still applies to them.
const GIT_MAY_SPAWN = {
  files: ['src/lib/git.ts', 'src/**/__tests__/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ regex: NETWORK_MODULES, message: 'The collector is offline (spec §5.2). No network modules.' }],
    }],
    'no-restricted-syntax': ['error',
      { selector: `ImportExpression[source.value=/${NETWORK_MODULES.replaceAll('/', '\\/')}/]`, message: 'The collector is offline (spec §5.2).' },
    ],
  },
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'docs/**'] },
  ...tseslint.configs.recommended,
  OFFLINE,
  GIT_MAY_SPAWN,
];
