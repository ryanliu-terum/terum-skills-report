/**
 * Names that never leave, whatever folder they sit in or what references them (spec §2.6). One
 * list, used by every copy path: skill folders, commands, agents, CLAUDE.md and linked files.
 * The review of 2026-09-24 found the list applied to linked files only, so a `.env` inside a
 * skill folder shipped; the standalone test says a rule that is right for one path is right for
 * all of them.
 */
import { basename } from 'node:path';

export function neverCollected(path: string, includeClaudeMd: boolean): string | undefined {
  const lower = basename(path).toLowerCase();
  if (/^\.env(\..*)?$/.test(lower)) return '.env files are never collected';
  if (lower === 'settings.json' || lower === 'settings.local.json' || lower === '.claude.json' || lower === '.mcp.json') return 'settings and MCP configuration are never collected';
  if (lower === '.credentials.json' || lower === 'credentials.json' || lower === '.netrc' || lower === '_netrc' || lower === '.npmrc' || lower === '.pypirc' || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(lower) || /\.(pem|key|p12|pfx|keystore|jks|ppk)$/.test(lower)) return 'credential and key files are never collected';
  if (/\.jsonl$/.test(lower)) return 'session transcripts are never collected';
  if (/\.log$/.test(lower)) return 'log files are never collected';
  if (/\.pyc$|\.pyo$/.test(lower)) return 'compiled Python carries source paths and is never collected';
  if (!includeClaudeMd && (lower === 'claude.md' || lower === 'claude.local.md')) return 'CLAUDE.md is not collected without --include-claude-md';
  return undefined;
}

/** Folders never copied from inside a skill: dependency trees, repositories, virtual environments, caches. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.cache']);
