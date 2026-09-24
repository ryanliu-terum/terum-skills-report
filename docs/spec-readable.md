> readable companion to .planning/specs/2026-09-24-skills-report-collector.md

## 1. What this is

A small command a customer's engineer pastes into a terminal. It gathers that engineer's
Claude Code skills, the helper scripts those skills call, and counts of how often each skill
was used, and writes all of it into one folder on their desktop that they can read, edit and
zip themselves. Terum then evaluates those skills and sends the company a free report on
which skills are stale, duplicated, misfiring or wasting engineering time and money.

## 2. What it does

### The offer, and what we ask of the customer

Terum's free "skills report" needs two things from a customer: their skill files, so we can
run our evaluations on them, and numbers on how often each skill fires, so the report can
talk about cost and time rather than just quality. The ask is ten minutes each from three
engineers, ideally the heaviest Claude Code users. Each one runs a single command, looks at
the folder it produced, deletes anything they do not want to send, zips the folder with the
operating system, and sends it to us however they normally share files. There is nothing
to install, no account to make, and the command never connects to the network.

An earlier plan asked one tech lead instead of three engineers, because that plan pulled
extracts out of session logs, which felt sensitive. This plan pulls skill files plus counts
an engineer can check by eye, so asking three people is realistic, and three machines give
us personal skills and a usage sample that one machine cannot.

### Which git repository the command runs in

Two different answers, because there are two sides.

**Where the code lives.** In a brand-new public repository and npm package, named `terum-skills-report`, separate from the `terum-skills` repository. The reason is that the
customer's engineer is expected to read the code before running it, and `terum-skills` is
tens of thousands of lines with login, team and git machinery. The collector should be a
few hundred lines in one bundled JavaScript file. The spec is filed in the `terum-skills`
planning folder only because that is where the team keeps specs; it moves when the new
repository exists.

**Where it runs on the customer's machine.** It does not run "in" any repository. The
engineer types `npx -y terum-skills-report@1.0.0` from any terminal. npx downloads that exact
version into npm's own cache folder and runs it from there. The command ignores the folder
the terminal happens to be in. It finds everything it needs starting from the engineer's
home folder, and it discovers their project repositories from a list Claude Code itself
keeps, so it works the same whether the engineer runs it from their home folder, a project,
or the desktop.

### Every folder the command touches

Read only, under the home folder:

- `~/.claude/skills/`, `~/.claude/commands/`, `~/.claude/agents/`: the engineer's personal
  skills, slash commands and agent definitions. Copied whole into the output.
- `~/.claude/settings.json`: read for which plugins are enabled and for the names of hook
  events. The hook commands themselves are only copied if the engineer passes a flag.
- `~/.claude.json`: Claude Code's own list of every project folder it has been opened in,
  plus the names of connected MCP servers. Only the folder paths and server names are used.
- `~/.claude/plugins/installed_plugins.json` and `~/.claude/plugins/cache/`: which plugins
  are installed, their versions, and the skill folders that ship inside them.
- `~/.claude/projects/`: the session transcripts, one file per session, with subagent
  transcripts nested one level deeper. Every file is read locally and turned into counts.
  No transcript content is copied out.

Read only, inside each project repository that Claude Code has been opened in:

- `<project>/.claude/skills/`, `<project>/.claude/commands/`, `<project>/.claude/agents/`.
- Any file a skill points at by path, such as a workflow script or a shell helper, resolved
  against the skill folder, the project root and the home `.claude` folder. Only files a
  skill actually names are opened.
- `git log` is run inside the repository for each copied skill file, to get first and last
  commit dates and a count of distinct authors. It is a read-only git command with a time
  limit. No author names are kept.
- Optionally, if the engineer passes a flag: the project's `CLAUDE.md` and rule files.

Written:

- One folder, `~/Desktop/terum-skills-report-<date>/`, or wherever `--out` points. Nothing else.
  No settings changed, no hook added, no background process, nothing on the PATH.

One honest footnote: npx keeps a copy of the downloaded package in npm's cache folder under
the home directory, as it does for anything run through npx. The command itself installs
nothing, but "nothing left behind" should be said with that caveat.

### What leaves the machine

Three groups leave as files, two leave only as numbers, one never leaves.

**Leaves as files.** Every skill folder Claude Code can load, copied whole: personal skills,
project skills, and the skills bundled inside installed plugins. Plugin skills are copied
too because the trigger test needs the full menu the model chooses from, and a bad plugin
skill gets a different fix (replace or disable, not edit). Also copied: slash commands and
agent definitions, and the helper scripts skills reference. Every reference the command
could not find is listed in the manifest as "referenced, not found", so the evaluation later
marks that skill "not evaluable" rather than guessing.

**Leaves as numbers.** From the transcripts, three spreadsheet files. One row per skill
with total fires, fires chosen by the model versus typed by a human, sessions touched, first
and last day seen, average tokens per fire, and the size of the skill text. One row per
firing with the day, skill, how it was invoked, model, the four token counts, how many turns
followed, how many tool errors and interruptions followed, and whether the same skill fired
again in that session. One row per session, including sessions where no skill fired, with
turn count, how many messages the human typed, interruptions, token totals, minutes, and how
many subagent transcripts were folded in. Session ids are hashed. Dates have no time of
day. From git, dates and an author count per skill file. From the environment, Claude Code
version, operating system, shell, Node version, MCP server names, hook event names.

The terminal and the manifest both carry this exact sentence: "From sessions we gathered how
often each skill was invoked. No raw session logs are sent out. All session logs were read
locally, just for skill usage." The spec treats that sentence as a rule: every column in the
usage tables must be about a skill firing or the session it happened in, or the sentence
stops being true.

**Never leaves.** Prompts, replies, tool output, file contents the model saw, source code,
`.env` files, MCP configuration, permission lists, the transcript files, and the skill text
as it appeared inside a transcript. Nothing outside the folders listed above is opened.

### How the transcripts are read

Claude Code records a skill firing in two different ways. When the model chooses a skill,
the transcript has a tool call named `Skill`. When a human types the slash command, there is
no such record at all, only the command name inside the human's message. The command looks
for both, and excludes Claude Code's own built-in commands by a fixed list. It skips records
that came from evaluation runs and subagents by a field Claude Code sets, not by guessing
from paths. Token counts, model name and timestamp come from fields on each assistant
record. A human interruption shows up as a fixed marker string in the transcript, and a
failed tool call carries an error flag. All of these field names were checked against real
transcripts on a Terum machine on 2026-09-24.

Which tokens count as "belonging" to a firing is settled: the exchange the skill fired in,
meaning everything from the firing until the next message the human typed, plus the work of
any helper the skill launched in that window. Helpers link back to the firing by an id both
records carry, so this is exact, not a guess from timestamps.

### What the engineer sees

One screen. It names the version and its checksum and source commit. It lists each folder
it read with a count beside it. It prints the sentence about sessions. It gives totals for
skills, linked scripts, firings and redacted lines. It names the output folder and its
contents, then says: open the folder, delete anything you do not want to send, zip it, send
it. The last line says the tool has not sent anything and will not.

Inside the folder, `MANIFEST.md` is the file to read first: what is inside with counts,
which linked files were copied and which skill asked for them, which transcript folders were
read over what date range, what was redacted, what was not read, and how to remove
something. `FLAGGED.md` lists every line the command redacted, by file and line, so the
engineer can confirm it caught the right thing. `manifest.json` is the machine-readable twin
with a checksum for every file. If the engineer deletes a file, the checksum list tells us
it was deliberate, not a broken zip.

### Rules the command obeys

- It runs an exact version, never "latest", so the code the engineer read is the code that
  runs. Releases are published with npm provenance, which ties the package to its source
  commit.
- No network access at all during the run.
- In a copied file, a value that looks like a key, token or password is replaced with a
  placeholder, and only the value: the variable name and the line stay. `FLAGGED.md` lists the
  file, line, rule, variable name and a short hint. Reading a variable such as
  `$ANTHROPIC_API_KEY` is never touched. The engineer's own review is the second line of defence.
- No username, hostname, machine id or full home path appears anywhere in the output.
  Session ids are hashed with a salt that is not saved, so two engineers' bundles cannot be
  joined by session.
- Every failure is counted and printed, and none stops the run. An unreadable transcript, a
  git command that times out, a missing script: each gets a count and a reason.

### Limits the final report must state

Only about a month of usage, because Claude Code deletes transcripts after roughly thirty
days by default. Whether a firing was relevant or wasted is not measured, because that
needs the prompt. Three machines is a sample, and team totals are extrapolated. Skills that
only work inside the customer's repository or need a tool we do not have are reported as
"not evaluable", never folded into pass or fail.

### What people supply by hand

The manager: how the company pays for Claude Code, headcount using it, an hourly engineer
cost, and which coding agents are in use. Each engineer: which skills they trust and avoid,
and which only make sense inside their repository.

### Our side, briefly

Three zips arrive. We verify each file against the manifest, mark deleted files as removed
by the engineer, deduplicate identical skills across bundles by content hash, and run the
`terum-skills` evaluations in a throwaway machine with no personal credentials and Terum's
own capture hooks off. We need a one-page data-handling agreement before collection, and we
must disclose that skill text passes through Anthropic during evaluation.

## 3. Decisions made

- **Three engineers, not one tech lead.** Skill files are easy to approve by eye, so the
  friction that justified one person no longer applies, and three machines give personal
  skills and a usage sample.
- **A new repository and package, not a `terum-skills` verb.** The customer reads the code;
  a few hundred lines is readable and tens of thousands is not. The cost is two copies of the
  transcript parser until it is extracted later.
- **Usage counts come from transcripts read locally; the transcripts never leave.** Without
  usage the report cannot talk about cost or time; with raw logs the ask becomes
  unacceptable. Counts are the middle.
- **No second "pack" command.** Per-file checksums in the manifest already make a deliberate
  deletion unambiguous, and a zip checksum bought nothing when the file is handed over
  directly. The engineer zips with the operating system.
- **Pinned version, never latest.** Otherwise the code could change between the engineer's
  review and their run.
- **Redact and report rather than only flag.** A missed flag is worse than a script we break
  and then mark not evaluable.
- **No identity in the bundle, hashed sessions, dates without times.** So the team-level-only
  promise cannot be broken by accident.
- **Every failure counted, none fatal.** A number that implies fuller coverage than was read
  is the one thing the output must never print.
- **Plugin skills are copied, not just listed.** The trigger test needs the whole menu the
  model picks from.
- **Hook commands and `CLAUDE.md` files are off by default.** Both would improve the
  evaluation, both carry paths and internal context, so they are flags.

## 4. Still to build

Everything. Nothing exists yet.

- New public repository, TypeScript, one-file bundle, tests, CI, tagged releases with
  provenance.
- Skill discovery across home, projects (from Claude Code's own project list), plugins,
  commands and agents.
- Linked-script discovery by resolving paths named in skill text, with misses recorded.
- Transcript reading: both firing detectors, tokens, model, day, hashed session, turns
  after, tool errors after, interruptions, refires, subagent folding.
- Secret redaction with a report.
- Git dates and author counts per skill file, with a time limit on every git call.
- The manifest, the flagged report, the three spreadsheets, checksums, environment facts,
  the terminal screen, and the `--json`, `--out`, `--include-hooks`, `--include-claude-md`
  flags.
- Windows and Mac testing, a security write-up, and the customer-facing page with the
  command and the questions for the manager and engineers.

Separately, and not in this spec: the receiving side that unzips, verifies, deduplicates,
runs evaluations and writes the report.

## 5. After you ship

- The five forks and two defaults were resolved in the 2026-09-24 decision walk and folded
  into the spec as rev 2: usage counts always on with a skip switch; a firing owns the exchange
  it fired in plus helper work attached by agent id; the package is `terum-skills-report`;
  redaction replaces only the secret's value and keeps the variable name; project labels are
  folder names with a hash switch; hook commands and project instruction files stay off by default.
- Sign a one-page data-handling agreement template before the first customer.
- Confirm our own Claude account's data-use setting before promising anything about
  Anthropic's handling of customer skill text.
- Set up the throwaway evaluation machine with Terum capture off.
- The evaluation fixes on the `feat/eval-check-quality` branch must land before a customer
  sees a report, or the findings will not survive their tech lead reading the receipts.
- Re-check the three candidate npm names before publishing.
- Later: extract the shared transcript parser into a small package used by both
  repositories; a locally computed "was this firing relevant" label; a single-file binary
  for engineers without Node.

## 6. Related specs

- Claude Doc "Skills Audit Collection Plan" (2026-09-23): the earlier plan this supersedes
  for collection; its sales framing, objections and report rules still apply.
- `.planning/specs/2026-09-15-eval-purpose-suites.md`: the evaluation engine's test design
  that the collected skills will be run through.
- The eval engine and eval generation specs referenced there: the "not evaluable" category
  and the vocabulary-anchor fixes this report depends on.

## 7. Sanity-check flags — where to look hard

- **Most questionable decision: copying the transcript parser into a second repository.
  6/10.** Two copies of a parser that must agree on what counts as a skill firing will drift,
  and the usage numbers in customer reports depend on it. The spec calls extraction a
  follow-up; it may need to be earlier.
- **Most likely to break: linked-script discovery.** Finding the scripts a skill references
  means guessing which strings in free text are paths. In the local `terum-skills` skills,
  references take several forms, including environment-variable prefixes for plugin skills,
  and the spec itself lists how those resolve as "not yet checked". Misses are reported, but
  a miss means a skill is marked not evaluable when it could have been.
- **Hardest to implement: the usage rows.** Turning transcripts into per-firing token counts
  needs a definition of a turn, folding in nested subagent transcripts, filtering evaluation
  and subagent noise, and doing it identically on Windows and Mac. The existing
  `terum-skills` scanner deliberately reads only four fields and stops one folder level deep,
  so most of this is new code, not a copy.
- **Least clear part: how far the secret-pattern list reaches. 4/10.** The spec names the
  shapes it catches and says an unknown-shaped secret under an innocent name is not caught,
  but the exact vendored rule set and its licence are still to be chosen, and that choice
  decides the false-alarm rate on customer scripts.
