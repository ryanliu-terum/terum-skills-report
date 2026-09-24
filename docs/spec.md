# Skills report collector — one offline command a customer engineer runs and reads

**Status:** LOCKED rev 2 (rev 2: the five §11 forks and the §2.4 opt-ins resolved in the
2026-09-24 decision walk, `docs/decision-walk.md`;
rev 1 Ryan, 2026-09-24, in session with Claude). Ready for a cross-model spec audit, then build.
Supersedes the collection half of the Claude Doc *Skills Audit Collection Plan* (2026-09-23);
that document's sales framing, objection handling and report rules still stand and are
referenced here, not restated. Everything marked **locked** was decided by Ryan in the
2026-09-23 or 2026-09-24 sessions; everything marked **[default]** is a choice made here that
Ryan has not ruled on and can be overturned in a decision walk (§11).

**North Star.** *A customer engineer can read everything that leaves their machine, in ten
minutes, in a folder they can open with a text editor and a spreadsheet.* Every other rule in
this spec is downstream of that sentence.

**Where this lives.** A new, separate repository and npm package, not a verb of
`terum-skills` (§8). This spec sits in the terum-skills planning folder only because that is
where the team's specs are; it moves with the new repo when the repo exists.

---

## 1. What this is

Terum offers a company that uses Claude Code a free report on its skills: an inventory,
what is stale or duplicated, whether each skill fires when it should, how each skill performs
against a plain agent on the same task, and what the bad ones cost in engineering time and
spend. The eval half runs on Terum's machines with the `terum-skills` eval engine. This spec
covers only the collection half: how the customer's skills and usage numbers get to us.

**The ask (locked, 2026-09-24).** Ten minutes from each of three engineers, ideally the
heaviest Claude Code users. Each pastes one command. It writes a folder to their desktop.
They open it, delete anything they do not want to send, zip it themselves, and send it
however they normally share files. Nothing else. No install, no account, no network.

This replaces the 2026-09-23 plan's one-tech-lead default. The reasoning: the earlier plan
collected extracts from session logs, which are sensitive enough that one trusted person
was the most anyone would agree to. This plan collects skill files plus counts derived
locally from logs, which an engineer can verify by eye, so three participants is a realistic
ask and gives us personal skills and a usage sample across three machines instead of one.

**What the three bundles buy the report.** Committed skills come from any one of them.
Personal skills, and which skills actually fire, come only from the machines they are on.
Three is a sample; the report says so and labels every team-wide number as extrapolated
(locked, 2026-09-23).

## 2. What is collected

Three groups leave the machine. Two more are read locally and leave only as counts. One
group never leaves.

### 2.1 Skill files (leave as-is)

Every skill folder Claude Code can load on that machine, copied whole:

| Source | Location read | How found |
|---|---|---|
| Home skills | `~/.claude/skills/<name>/` | direct |
| Project skills | `<project>/.claude/skills/<name>/` | project paths are the keys of `projects` in `~/.claude.json`, which lists every folder Claude Code has been opened in on that machine (verified 2026-09-24: 10 entries locally) |
| Plugin skills | `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/` | `~/.claude/plugins/installed_plugins.json` lists each plugin as `name@marketplace` with `version`, `installPath` and `scope`; `enabledPlugins` in `~/.claude/settings.json` says which are on |

Plugin skills are third-party in most cases. We record name, marketplace, version and
enabled state for every plugin, and copy the skill folders too, because the trigger eval
needs the full catalogue the model chooses from (§9). A plugin skill that scores badly gets
a different recommendation from a home skill: replace or disable, not edit.

Also copied, because skills point at them and the eval cannot run a skill whose helpers are
missing:

- Slash commands in `~/.claude/commands/` and `<project>/.claude/commands/`.
- Agent definitions in `~/.claude/agents/` and `<project>/.claude/agents/`.

### 2.2 Linked scripts (leave as-is, after redaction, opt-out per file)

Files a skill references outside its own folder: workflow scripts, shell scripts, Python
helpers, schema files. Found by resolving path-shaped tokens in the skill text (relative
paths, `.claude/workflows/x.js`, `scripts/x.sh`, `$CLAUDE_PLUGIN_ROOT/...`) against the
skill's folder, its project root, and the home `.claude` folder. This is a heuristic and it
will miss some. Every reference the collector could not resolve is listed in the manifest
as *referenced, not found* so the eval marks the skill *not evaluable* instead of guessing.

Scripts are the most likely place for internal hostnames and credentials, so they get the
redaction pass (§5.4) and appear in `FLAGGED.md` by file and line.

### 2.3 Usage, derived locally from session transcripts (leave as counts only)

Claude Code writes one JSONL transcript per session under
`~/.claude/projects/<project-slug>/<session-id>.jsonl`, with subagent transcripts nested
under `<session-id>/subagents/`. The collector reads them all, locally, and writes three CSV
tables. **No transcript content leaves.** The terminal and the manifest both say, in these
words (locked, 2026-09-24):

> From sessions we gathered how often each skill was invoked. No raw session logs are sent
> out. All session logs were read locally, just for skill usage.

That sentence is also a constraint: every column in the usage tables must describe a skill
firing or the session it happened in. A column that is not about skill usage means the
sentence is no longer true and may not be added without changing it.

Fields read from each record, all verified against a local transcript on 2026-09-24:

| Purpose | Field |
|---|---|
| Model chose the skill (detector D1) | assistant record, `message.content[]` block with `type: "tool_use"` and `name: "Skill"`; skill name is `input.skill` |
| Human typed the slash command (detector D2) | user record whose text carries `<command-name>/name</command-name>`; Claude Code's own commands are excluded by list |
| Tokens | `message.usage.input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` |
| Model | `message.model` |
| Day | `timestamp`, truncated to the date |
| Session | `sessionId`, hashed (§5.5) |
| Subagent work | `isSidechain`, plus the nested `subagents/` files |
| Injected skill body, not a human message | `isMeta: true` |
| Eval and subagent noise | `userType` other than the interactive value (the existing terum-skills scanner filters on this field; 155 of 168 Skill records on one machine were `sdk-cli`) |
| Tool error after a firing | tool_result block with `is_error: true` (present in 60 local transcripts) |
| Human interrupted the model | text block `[Request interrupted by user]` or `[Request interrupted by user for tool use]` (present in 7 local transcripts) |
| Claude Code version and platform | `version` on each record; `cwd` shape tells Windows from POSIX without recording the path |

Both detectors are needed. A slash-invoked skill writes no `Skill` record at all; that was
measured in the terum-skills usage work on 2026-09-15 and is the reason the existing scanner
has two detectors. The collector copies that scanner (§8.3).

### 2.4 Environment facts (leave as names and versions)

- Claude Code version, operating system, shell, Node version.
- MCP server **names** only, from `mcpServers` in `~/.claude.json` and each project's entry.
  No command lines, no arguments, no environment variables.
- Hook **event names** from `hooks` in `~/.claude/settings.json`. The hook commands
  themselves are opt-in **(off by default, locked, walk D6)**; they are the largest hidden token cost in many
  sessions and without them the report misattributes that spend to skills, but they carry
  paths.
- Project `CLAUDE.md` and rule files, opt-in **(off by default, locked, walk D7)**. They shape how a skill
  behaves; without them the eval runs the skill in a vacuum. Sensitive, so off by default.

### 2.5 Git metadata per skill file (leave as dates and counts)

For every copied skill file inside a git repository: first commit date, last commit date,
number of distinct authors as an integer. No author names or emails. Every `git` spawn
carries a deadline and a failure is recorded per file, never fatal.

### 2.6 Never collected

Prompts, replies, tool output, file contents seen by the model, source code from their
repos, `.env` files, MCP configuration, permission lists, the transcript files themselves,
and the skill body as it appears inside a transcript (we already have it from the file).
Nothing outside the folders named in §2.1 to §2.5 is opened.

## 3. The output folder

One folder on the desktop, dated. Nothing in it needs a tool to open.

```
terum-skills-report-2026-09-24/
├── MANIFEST.md        read this first: what is inside, in plain English, with counts
├── manifest.json      the same, machine-readable, with a sha256 per file
├── FLAGGED.md         every line redacted, by file and line, for the engineer to confirm
├── collector.txt      collector version, its sha256, source commit, exact command, time
├── skills/
│   ├── home/<skill-name>/...
│   ├── project-<label>/<skill-name>/...
│   └── plugin-<marketplace>-<plugin>@<version>/<skill-name>/...
├── linked/
│   └── <label>/<path inside repo>
├── commands/ agents/
└── usage/
    ├── summary.csv
    ├── firings.csv
    └── sessions.csv
```

**MANIFEST.md** says: how many skills from which locations, written as `~/.claude/skills`
and a project label, never a full path; which linked files were copied and which skill asked
for them; which references were not found; which transcript folders were read, the date
range, session and firing counts, files skipped; the §2.3 sentence followed by the exact
columns; what was redacted; what was not read; and how to remove something (delete the file
or row; the per-file hashes let us tell a deliberate deletion from a broken bundle).

**No pack step (locked, 2026-09-24).** An earlier draft had a second command to re-zip and
re-hash after edits. The manifest's per-file hashes already make an engineer's deletion
unambiguous on our side, and the zip's own checksum bought nothing when the file is handed
to us directly. The engineer zips the folder with the operating system. Mac's hidden
`__MACOSX` folder and Windows's extra nesting level are ignored on receipt.

### 3.1 The CSV columns

```
summary.csv    one row per skill
  skill, source, fires, fires_by_model, fires_by_human, sessions,
  first_day, last_day, avg_tokens_per_fire, skill_text_tokens

firings.csv    one row per skill firing
  firing_id, session_id, day, skill, source, invoked_by, model,
  input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
  turns_after, tool_errors_after, interrupted_after, refired_in_session

sessions.csv   one row per session, including sessions with no skill firing
  session_id, day, turns, human_messages, interruptions, skill_fires, distinct_skills,
  input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, minutes, subagent_sessions
```

`session_id` is a hash. `day` is a date. `human_messages` and `interruptions` are the two
content-free measures of human time and frustration; `minutes` measures the machine.
`subagent_sessions` counts the nested transcripts folded into the session's token totals.

Which tokens `firings.csv` attributes to a firing is **locked (walk D2)**: *the turn in which it
fired*, from the firing to the next record that is a human message, with `isMeta` and
tool-result records not counting as human, plus the work of any subagent launched inside that
window, attached by `agentId` (each nested transcript carries the parent `sessionId` and an
`agentId`; the parent record that launched it carries the same id and sits inside a turn).

## 4. What the command prints

One screen. Every count has a source line the engineer can check against a folder they can
open. Partial results are printed with counts, never dropped. The last lines are the promise.

```
$ npx -y terum-skills-report@1.0.0

terum-skills-report 1.0.0  (sha256 3f9c…a1e2, source: github.com/<org>/terum-skills-report @ 8d21f0c)
Runs offline. Nothing is sent anywhere. You review the folder, then zip and send it yourself.

Reading
  ~/.claude/skills                      14 skills
  ~/dev/api/.claude/skills               6 skills
  ~/dev/web/.claude/skills               3 skills   (2 identical to ~/.claude/skills copies)
  ~/.claude/plugins                      9 skills from 3 plugins
  ~/.claude/commands, .claude/agents      5 commands, 2 agents referenced by skills
  ~/.claude/projects                    212 sessions, 2026-08-26 to 2026-09-24
                                          3 files skipped: could not parse
  From sessions we gathered how often each skill was invoked.
  No raw session logs are sent out. All session logs were read locally, just for skill usage.

Skills found            23   (21 unique by content)
Linked scripts           7   copied   2 referenced but not found   (listed in MANIFEST.md)
Skill firings          418   across 131 sessions
Redacted lines           3   in 2 files   (see FLAGGED.md)

Written to  ~/Desktop/terum-skills-report-2026-09-24/
  MANIFEST.md   read this first
  FLAGGED.md    3 redactions to confirm
  skills/  linked/  commands/  agents/  usage/summary.csv  usage/firings.csv  usage/sessions.csv

Next
  Open the folder. Delete anything you do not want to send.
  Zip the folder and send it to your Terum contact.
  This tool has not sent anything and will not. Nothing was installed or changed on this machine.
```

If the transcripts folder is missing, the usage section says so, the CSVs are written with
headers only, and the manifest records *no session data on this machine*. If a folder cannot
be read, it is listed with the reason. The exit code is non-zero only when nothing at all
could be written.

`--json` prints the same summary as one object, for our own test runs. `--out <dir>`
overrides the desktop. `--include-hooks`, `--include-claude-md` turn on the §2.4 opt-ins.

## 5. Collector rules

These are the properties the 2026-09-23 plan committed to and this spec keeps (locked).

### 5.1 Pinned version, verifiable source

The command names an exact version, never `latest`. The property this protects: the
version the engineer read is the version that runs. With `latest`, anyone holding the npm
account can swap the code between review and run. Releases are published with npm
provenance so the package links to the exact source commit, and `collector.txt` records
version, sha256 and commit.

### 5.2 Offline, no footprint

No network access during the run: no telemetry, no update check, no upload. Nothing is
installed, no hook or settings change, no background process, and nothing is left behind
except the output folder. A pasted command that does any of those looks like a
supply-chain attack, and should.

### 5.3 Short enough to read

The published bundle is a single JavaScript file a senior engineer can read in a sitting.
Dependencies are kept to what cannot be written in a page (§8.2). The repo is public.

### 5.4 Redaction with a report (locked, walk D4)

Every copied file is scanned with two tests, both on **literal values only**: a value with a
known shape from a published pattern set (gitleaks's rules are the candidate; check licence
before vendoring: Anthropic `sk-ant-`, OpenAI `sk-`, GitHub `ghp_`, AWS `AKIA`, Slack `xoxb-`,
signed web tokens `eyJ`, private-key blocks), or a name containing key, secret, token, password,
passwd, credential or auth followed by `=` or `:` and a literal. Reading a variable
(`$ANTHROPIC_API_KEY`, `os.environ[...]`, `process.env.X`) is never flagged. **Only the value
span is replaced**, with `[REDACTED:<rule>]`; the variable name, the line, and the file's line
count are kept, and private-key body lines are replaced one for one. `FLAGGED.md` records file,
line, rule, variable name and a recognisable hint (prefix and length), never the value.
Redaction is never the only defence: the engineer reviews the folder before zipping, and the
manifest says that a secret with no known shape under an innocent name is not caught. A
redacted script may no longer run in the eval; that skill is then reported *not evaluable*, not
scored.

### 5.5 No identity in the bundle

No username, hostname, machine id, email or full home path anywhere, including inside
`manifest.json`. Session ids are hashed with a per-run salt written nowhere, so two bundles
cannot be joined on sessions. Project labels are the folder's base name **(locked, walk D5)**, with `--hash-labels` for a
customer who asks; a repo name is not personal identity and the report's ownership finding needs it. Paths in the manifest are written
relative to `~` or to the project label. The report promises team-level findings only
(locked, 2026-09-23); the bundle is built so we could not break that promise by accident.

### 5.6 Every failure is counted, none is fatal

A transcript that will not parse, a git command that times out, a referenced script that is
not there, a folder without read permission: each is recorded with a reason and a count in
the manifest and on the screen. The run continues. A number that implies fuller coverage
than was read is the one thing the manifest must never print.

## 6. Coverage limits the report must state

- **About one month of usage.** Claude Code prunes transcripts at roughly 30 days by
  default; the customer may have changed that either way. The manifest's date range is the
  window, and the report says so.
- **Relevance of a firing is not measured.** Telling a good fire from a wasted one needs the
  prompt, which is content and stays home. The trigger eval on the skill text is the
  substitute and uses generated prompts, not their traffic. A later version could have the
  collector ask the engineer's own Claude Code to label each firing locally and emit only the
  yes/no counts; not in version one.
- **Three machines.** Team totals are extrapolated from three bundles and labelled so.
- **Repo-bound skills.** A skill that only makes sense inside their repository, or needs an
  MCP server we do not have, is *not evaluable* in our sandbox. It is reported as its own
  category, never folded into pass or fail counts.

## 7. What the humans supply

Not collected by the command; asked for on the same page as the command.

**From the manager.** How they pay for Claude Code (pay-as-you-go tokens convert to dollars;
seat plans do not, and there the cost of a wasteful skill is rate limits and time, so the
headline changes shape); headcount using Claude Code; a loaded hourly engineer cost, or the
report shows the arithmetic with a blank; which coding agents are in use (Codex skills live
elsewhere and version one does not see them).

**From each engineer, two questions.** Which skills they trust and which they avoid, as the
only check we have on whether the eval agrees with the people who live with the skills. Which
skills only make sense inside their repo, so a repo-bound skill is not misreported as broken.

## 8. Packaging

### 8.1 A new repo and package, not a terum-skills verb (Ryan, 2026-09-24)

The customer reads the code. `terum-skills` is tens of thousands of lines with login, team
and git machinery; the collector should be a few hundred. The cost is copying two modules
from terum-skills (§8.3) and living with two copies until both stabilise, at which point the
parser can be extracted into a small shared package. That extraction is a follow-up, not a
prerequisite.

Package name: **locked (walk D3)** `terum-skills-report`. The 2026-09-23 plan decided not to lead
with the word *audit* in the offer, and the engineer typing the command is the person whose trust
we most need. All three of `terum-skills-report`, `terum-skills-report` and `terum-collect`
returned not-found on npm on 2026-09-24; re-check before publishing.

### 8.2 Stack

TypeScript, Node 20 or newer, bundled by esbuild to one file, tests in vitest, CI running
typecheck and tests on push, release by tag with `npm publish --provenance`. Runtime
dependencies: one small zero-dependency zip library only if the folder must be zipped by the
tool, which §3 says it need not be, so **[default] none**. Argument parsing is small enough to
write by hand. The customer must have Node installed; engineers using Claude Code usually do,
but the native installer no longer requires it, so a fallback (a single-file binary) is a
noted risk, not version-one scope.

### 8.3 Reuse from terum-skills

Copied with a comment naming the origin file and commit:

- `src/lib/usage/transcripts.ts` (157 lines): the two-detector firing scanner, the
  `sdk-cli` noise filter by field, the builtin-command exclusion list, and the one-level
  transcript glob. The copy adds token, model, timestamp and nested-subagent reading, which
  the original deliberately omits.
- The turn machine from `src/lib/misses/harvest.ts`: what is a human message, what is
  injected (`isMeta`), what is a tool result. This is what `turns_after`, `human_messages`
  and `interruptions` are counted with.
- The skill-folder inspection from `src/lib/local-skills.ts` where it applies; the project
  list comes from `~/.claude.json` instead of the terum-skills config.

## 9. Our side of the pipe (interface only; separate spec)

Three zips arrive. We unzip, drop `__MACOSX` and nesting, verify each file against
`manifest.json`, mark manifest-listed files that are absent as *removed by engineer*, and
deduplicate skills across bundles by content hash. Skills then go to the `terum-skills` eval
engine, run in an isolated environment (§10). The report follows the 2026-09-23 rules:
headline in engineering hours and monthly spend with the arithmetic shown, tokens as
supporting evidence, team-level only, measured separated from extrapolated, *not evaluable*
as its own category, and before/after for the three worst skills.

Two constraints the eval engine imposes on this report and must be true before a customer
sees one: the vocabulary-anchor and injected-SKILL.md fixes on `feat/eval-check-quality` have
to land, or findings will not survive the customer's tech lead reading the receipts; and
heavy skills whose machinery cannot run in our sandbox are *not evaluable*, not NEUTRAL.

## 10. Security and data handling on our side

Receiving skills is less dangerous than receiving logs, but not nothing.

- **We become a custodian of their internal material.** Scripts routinely carry internal
  hostnames, repo layouts, tool names and customer names. A one-page written agreement
  before collection: purpose-limited use, retention period, deletion date, no sharing, no
  training.
- **We run their code.** The eval gives their skill's scripts a shell. A well-meaning
  customer's script can still delete a path, phone home or read our credentials. Evals run in
  a throwaway VM or container with no personal credentials, never on a developer laptop.
- **Terum capture.** Running evals in a session with our Terum hooks active would write
  their skill text into our team's shared memory. Capture is off for those sessions, and
  their files never enter a tracked folder of any of our repositories or committed receipts.
- **Their text passes through Anthropic.** The eval sends their skill content through Claude
  Code. Disclosed up front; and our own account's data-use setting is confirmed before we
  promise anything about it.

## 11. Forks, resolved (decision walk 2026-09-24)

All five forks and both §2.4 opt-ins were walked on 2026-09-24; the ledger is
`docs/decision-walk.md`.

| # | Fork | Ruling | Walk |
|---|---|---|---|
| F1 | Which tokens belong to a firing | the turn it fired in, to the next human message; subagent work attached by `agentId` | D2 |
| F2 | Project labels | folder base name; `--hash-labels` on request | D5 |
| F3 | Redaction | replace the value only, never the name or line; report file, line, rule, name, hint | D4 |
| F4 | Package name | `terum-skills-report` | D3 |
| F5 | Usage collection | always on; `--no-usage` skips, and the manifest says so | D1 |
| — | Hook commands, project `CLAUDE.md` | off by default, flags to include | D6, D7 |

## 12. Effort

One person, prototype we can run on our own machines in about a week, customer-ready in two
to three. Reported as information; per the standing ruling it is not a reason to prefer a
less correct design.

| Piece | Effort |
|---|---|
| Repo, single-file bundle, tests, CI, provenance publishing | 0.5 day |
| Skill discovery: home, projects, plugins, commands, agents | 1 day |
| Linked scripts: resolve references, copy, record misses | 1 day |
| Usage rows: tokens, model, turns, interruptions, hashed sessions, subagents | 2 days |
| Redaction with report | 1 day |
| Git dates and author counts, deadlines on every spawn | 0.5 day |
| Manifest, CSVs, checksums, environment facts, terminal screen | 1 day |
| Windows and Mac testing, docs, security review | 2 to 3 days |

Hardest three: token attribution is a definition, not a parse (F1); linked-script discovery is
a heuristic that must report its misses; redaction has both false alarms and misses and is
never the only line of defence.

## 13. Verified versus estimated

**Verified on this machine, 2026-09-24:** transcript record and `usage` field names in §2.3;
the interruption marker strings and `is_error` flag exist in local transcripts; nested
subagent transcripts live under `<session>/subagents/` (582 locally); `~/.claude.json` holds
`projects` keyed by full path and `mcpServers` by name; `installed_plugins.json` shape and the
plugin cache layout; `settings.json` carries `enabledPlugins` and `hooks` by event name; the
terum-skills scanner's two detectors and `sdk-cli` filter; the three npm names returned
not-found.

**Estimated:** all counts in the sample screen; the effort table; that plugin skill folders
always sit at `<version>/skills/` (some cache entries are keyed by commit hash, not version);
that Claude Code's 30-day transcript pruning is the customer's setting; that engineers have
Node installed.

**Not yet checked:** whether `userType` is the right field name for the noise filter in the
current transcript format (the terum-skills scanner filters on a field measured in
September 2026; re-verify against the copy); gitleaks's licence for vendoring its rules;
how a skill's `$CLAUDE_PLUGIN_ROOT` references resolve for plugin skills.
