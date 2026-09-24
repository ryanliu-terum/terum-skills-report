# terum-skills-report

One offline command that gathers your Claude Code skills, the helper scripts they reference and
counts of how often each skill was used, and writes all of it to a folder on your desktop. You read
the folder, delete anything you do not want to send, zip it yourself and send it to your Terum
contact. Terum evaluates the skills and sends your company a free skills report.

```
npx -y terum-skills-report@1.0.0
```

The command names an exact version, never `latest`, so the code you read is the code that runs.
Releases are published with npm provenance, which links the published file to the source commit.

## What it does

- **Runs offline.** No telemetry, no update check, no upload. Nothing is installed or changed on
  your machine. The only footprint is npm's own download cache, as with anything run through npx.
- **Ignores the folder you run it in.** It starts from your home folder and finds your project
  repositories from the list Claude Code itself keeps in `~/.claude.json`.
- **Copies skill files.** `~/.claude/skills`, each project's `.claude/skills`, and the skills inside
  installed plugins, plus `commands/` and `agents/` at home and project level, plus files a skill
  references by path.
- **Reads session transcripts locally and writes counts only.** From `~/.claude/projects` it derives
  how often each skill fired, by whom, at what token cost, and per-session totals. No transcript
  content is copied. Session ids are hashed with a salt that is never written.
- **Redacts secrets and reports every redaction.** A value with a known shape (Anthropic, OpenAI,
  GitHub, AWS, Slack keys, signed web tokens, private-key blocks) or a literal assigned to a name
  like `password` or `api_key` is replaced with `[REDACTED:<rule>]`. Only the value is replaced; the
  variable name and the line stay. `FLAGGED.md` lists file, line, rule and name, never the value.
- **Leaves no identity in the output.** No username, hostname, machine id or full home path.
- **Counts every failure and stops for none.** An unreadable file, a git command that times out, a
  script that is not where a skill said: each is listed with a reason in `MANIFEST.md`.

## The output folder

```
~/Desktop/terum-skills-report-<date>/
├── MANIFEST.md        read this first: what is inside, in plain English, with counts
├── manifest.json      the same, machine-readable, with a sha256 per file
├── FLAGGED.md         every redaction, by file and line, for you to confirm
├── collector.txt      collector version, its sha256, source commit, exact command, time
├── skills/            home/, project-<label>/, plugin-<marketplace>-<plugin>@<version>/
├── linked/            scripts a skill references, by label
├── commands/ agents/
└── usage/             summary.csv, firings.csv, sessions.csv
```

## Flags

| Flag | Effect |
|---|---|
| `--out <dir>` | write somewhere other than the desktop |
| `--no-usage` | do not read session transcripts; the manifest says so |
| `--include-hooks` | include hook command lines from `settings.json` (off by default: they carry paths) |
| `--include-claude-md` | include project `CLAUDE.md` and rule files (off by default: internal context) |
| `--hash-labels` | name projects by a hash instead of the folder name |
| `--json` | print the summary as one JSON object |

## Verifying what you run

```
npm view terum-skills-report@1.0.0 dist.integrity
npm audit signatures
```

The published file is `dist/index.js`, one bundled JavaScript file with no dependencies. Its sha256
and source commit are printed on the first line of the run and written to `collector.txt`.

## Development

```
npm ci
npm run lint && npm run typecheck && npm test
npm run build            # dist/index.js
node dist/index.js --out /tmp/report
```

The contract is `docs/spec.md`; `docs/spec-readable.md` is its plain-English companion and
`docs/decision-walk.md` records every design fork and its ruling. Two modules are copied from
[terum-skills](https://github.com/ryanliu-terum/terum-skills) with their origin in a comment.

## Licence

Apache-2.0.
