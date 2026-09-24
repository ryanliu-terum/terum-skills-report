# Build notes

Decisions made while building against the locked spec (`docs/spec.md`, rev 2) and the decision
walk (`docs/decision-walk.md`). Each refines a rule the spec states in general terms, or records
what a real run on a Windows machine on 2026-09-24 (136 skills, 63 sessions) changed. None
reopens a walked fork. Where a note narrows what leaves the machine, §2.6 (never collected) and
§5.5 (no identity) won over the broader wording elsewhere.

## Resolved from spec §13 "not yet checked"

- **Noise filter field.** It is `entrypoint` (`cli` for a person at a terminal, `sdk-cli` for
  every eval sandbox and SDK run), not `userType`, which is `external` on both. Verified against
  current transcripts before any usage code was written. A record with no `entrypoint` at all
  predates the field and is kept.
- **gitleaks.** Not vendored. The seven shapes the spec names fit in a page of our own regular
  expressions (`src/lib/redact.ts`), which is easier for the engineer to read than a rule set.
- **`$CLAUDE_PLUGIN_ROOT`.** Resolved to the plugin's `installPath` from `installed_plugins.json`,
  with or without braces. Outside a plugin skill it is recorded as a miss.

## Usage rows (spec §2.3, §3.1)

- **A turn is one model response** (one API call), the meaning Claude Code itself gives the word.
  `turns` in `sessions.csv` counts them across the session, subagents included; `turns_after` in
  `firings.csv` counts them inside the firing's exchange after the firing.
- **Tokens are counted once per `message.id`.** Claude Code writes one assistant response as
  several records (a text block, a tool_use block) that all carry the same `usage`. Measured: 50
  records, 23 ids in one session.
- **A human message** is a user record that is not all tool results, not `isMeta`, not a harness
  task notification, and has text left after the system-reminder and command plumbing is
  removed. A typed slash command is a human message and a D2 firing. An interruption marker is
  counted as an interruption and does not open an exchange. `promptSource` is not required,
  so older transcripts without the field still split into exchanges.
- **Two skills that fire in one exchange both own it**, as the locked definition implies, so
  firing rows can overlap; session rows never do. The manifest says so under the columns.
- **`interrupted_after` is a count**, not a flag, for consistency with `interruptions`.
- **`refired_in_session`** is true when the same skill fires again later in the session.
- **`skill_text_tokens`** is an estimate at four characters per token; the manifest says so.
- **Subagent join.** The launching record is a user tool_result whose `toolUseResult.agentId`
  names `<session>/subagents/agent-<id>.jsonl`. A subagent launched outside any firing still
  counts for the session.
- **Transcript folder names and session file names are never written.** A project folder under
  `~/.claude/projects` is named after the project's full path with dashes, and a file after its
  session id. Skipped files are reported as `<folder n>/<hashed id>.jsonl`.
- **Headless transcripts** (every record `sdk-cli`) are counted and not read into rows.

## Linked scripts (spec §2.2 against §2.6)

- **Only `SKILL.md` is scanned for references.** Scanning every Markdown file in a skill found
  736 misses on one machine, most of them code examples in plugin reference documents.
- **Never copied, whatever references them:** `.env` files, `settings.json`,
  `settings.local.json`, `.claude.json`, `.mcp.json`, `.credentials.json`, SSH and key files,
  `.jsonl` transcripts, `.log` files, and `CLAUDE.md` without `--include-claude-md`. Before this
  rule the run copied `~/.claude/settings.json` (permissions and hooks) because five skills name
  it.
- **A project file is copied only from skill machinery folders** (`.claude/`, `scripts/`,
  `workflows/`, `hooks/`, `bin/`, `tools/`). A skill that mentions `lib/phase1.ts` or an API
  route file is pointing at application source, which §2.6 says never leaves; the reference is
  listed as *found, not copied* so the eval knows it exists.
- **Tokens with regex escapes** (`api\.cohere\.ai`) are not paths.
- **Guards:** a resolved path must lie inside the base it was resolved against, so `../.env`
  cannot climb out; absolute paths outside the project and `~/.claude` are not opened.

## Redaction (spec §5.4, walk D4)

- **A literal must be shaped like a secret**: at least eight characters with a digit, or sixteen
  without. Paths, URLs, constant names, calls, type names and short prose are not literals. The
  plain rule flagged 338 lines on one machine, every one a code word (`key: string`,
  `const key = 'compact'`, `max_tokens = 4096`); the shaped rule flags 29, all long code words.
  A wrong match still only costs one *not evaluable* skill, as the walk accepted.
- **Plural keywords are dropped** (`tokens`, `keys`, `secrets`, `passwords`): in code they name
  counts and containers. `credentials` stays; `apikey`, `pwd`, `authorization` and `bearer` are
  added; `Authorization: Bearer <token>` redacts the token, not the word.
- **Email addresses are a redaction rule.** §5.5 allows no email in the bundle and skills carry
  `author: Name <email>` lines. scp-style git remotes and npm scopes are left alone.
- **Hook commands take the redaction pass too** when `--include-hooks` is on. They are written
  into the manifest rather than copied as files, so they bypassed the copier; on one machine a hook
  command carried a `--secret-header "x-…-secret: <uuid>"` argument. Redactions there are listed
  in `FLAGGED.md` against `MANIFEST.md`, with the hook's position as the line.
- **Files over 2 MiB are not copied** and are listed; **binary files** (a NUL byte in the first
  8 KiB) are copied without a scan and listed as unscanned; `node_modules` and `.git` inside a
  skill folder are not copied and are listed.

## Identity (spec §5.5)

- **The home folder listed as a project** in `~/.claude.json` is skipped: its `.claude` is the
  home one and its base name is the username.
- **Every spelling of the home path** is scrubbed: as given, its resolved real path, forward and
  back slashes, JSON-escaped, `file://`, and the derived Windows 8.3 short names (`RYANLI~1`).
  The output folder and the command line in `collector.txt` are written in the resolved
  spelling, never as typed.
- **Hostnames of five characters or more** are replaced at word boundaries; shorter ones are
  ordinary words.
- **Git error messages** have their paths cut out before they are recorded, because git spells
  paths its own way.

## Screen and manifest (spec §3, §4)

- The output is built in a `.partial` sibling and renamed at the end, so a crash leaves a folder
  that is visibly unfinished. A folder that already exists gets `-2`, `-3`.
- Without a `Desktop` folder the output goes to the home folder and the screen says so.
- The exit code is non-zero only when the output folder itself cannot be written, or the flags
  are wrong.
