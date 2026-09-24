---
title: skills report collector decision walk
date: 2026-09-24
north_star: Three engineers hand over their skills and honest usage numbers in ten minutes because they can see, in plain files, exactly what leaves their machine.
status: complete
deferred: []
---

# Skills report collector — Decision Walk

**North Star:** Three engineers hand over their skills and honest usage numbers in ten minutes because they can see, in plain files, exactly what leaves their machine.
**Field:** collecting files and usage counts from a customer's laptop for a free skills report. Watch words: "audit" (here, our offer's name, not an accounting review), "turn" (one exchange between a person and the model), "transcript" (Claude Code's saved record of a session), "hash" (a fixed-length fingerprint of a name that cannot be turned back into it).

Spec: `docs/spec.md` §11 forks F1–F5 and §2.4 opt-ins.

## Decision Ledger

| # | Decision | Impact | Importance | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|---|---|
| 1 | Usage counts: always on, or a flag (F5) | 6/10 | 6/10 | LOCK | Always read session records; `--no-usage` skips them and the manifest says so. | — |
| 2 | Which tokens belong to a firing (F1) | 7/10 | 6/10 | LOCK | The exchange it fired in, to the next human message; helper (subagent) work attached by agent id. | — |
| 3 | Package name (F4) | 6/10 | 5/10 | LOCK | `terum-skills-report`; matches the offer's name and reads as a report, not an inspection. | claim the npm name before build |
| 4 | Redaction: replace-and-report or flag-only (F3) | 5/10 | 4/10 | LOCK | Replace the secret value only, never the variable name or the line; report file, line, rule, name and a hint. | — |
| 5 | Project labels: folder name or hash (F2) | 3/10 | 3/10 | LOCK | Obvious — the report's ownership section needs the repo name; a hash gives nothing to hang a finding on. `--hash-labels` exists for a nervous customer. | — |
| 6 | Hook commands: off by default (§2.4) | 3/10 | 2/10 | LOCK | Obvious — hook commands carry paths, and the spec bans paths from the bundle by default. | — |
| 7 | Project CLAUDE.md files: off by default (§2.4) | 3/10 | 2/10 | LOCK | Obvious — project instructions are internal context, and the spec's default is that only skill material leaves. | — |

---

## Decision 1 — Usage counts: always on, or a flag (F5)

**Verdict: LOCK** · **Impact: 6/10** — shapes what the command opens on every customer machine and what every report can claim · **Importance: 6/10** — both options defensible; the wrong one loses the cost story or an engineer's trust

### Plain English
- **Where we are:** the command reads the engineer's saved session records to count skill firings and their cost. Those are the most private files on the machine; the rule is they are opened only to produce counts.
- **The question:** read them every run, or only when asked?
- **Options:**
  - **A — Always read, `--no-usage` to skip.** Counts on every run; the wary engineer has an exit. *(decides: cost and time in the report by default)*
  - **B — Only read with `--usage`.** Files-only default. *(decides: least-trusting engineer never sees the records touched; most reports arrive without cost numbers)*
- **Recommendation:** A. Without usage the report is an inventory, and the North Star names honest usage numbers as half of what we collect.
- **Impact (6/10):** every customer machine and every report claim · **Importance (6/10):** a real trade between the cost story and trust at the screen
- **The call:** Ryan, 2026-09-24: always read. Fits the North Star; the skip switch keeps the ask honest.

### Scores
| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A — always read, skip switch | 3 — spec §2.3 reads by default; Terum ruling 2026-09-24 accepted locally derived usage counts as a target | 1 — a skipped run writes header-only CSVs, the same path as a missing transcripts folder | the cost story sells the report |
| B — only with `--usage` | 1 — spec silent on a files-only default; the plan's headline needs hours and spend | 1 — same fallback | first customers refuse to let records be opened |

### Technical
- **Files / code paths:** transcript scanner and the three CSV writers behind one boolean; manifest records which way it ran so a files-only bundle is labelled, not mistaken for a machine with no sessions.
- **Migration / schema:** none.
- **Effort / blast radius:** a flag and a manifest line either way.
- **Grounding findings:** none — conceptual.

---

## Decision 2 — Which tokens belong to a firing (F1)

**Verdict: LOCK** · **Impact: 7/10** — the definition is baked into every bundle and report headline; changing it later makes old and new numbers incomparable · **Importance: 6/10** — the options produce very different numbers and a plausible person could pick any

### Plain English
- **Where we are:** each firings row says what a skill firing cost in tokens. Tokens are spent continuously, so a line must be drawn around the part that counts as the skill's. Helpers the skill launches (subagents) do work in separate records that link back to the parent by an agent id.
- **The question:** which tokens does a firing own?
- **Options:**
  - **A — The exchange it fired in.** From the firing to the next message the human types, plus helper work launched inside that window. Injected skill text and tool results do not count as the human speaking. *(decides: charged only for work it could have touched; a floor, never an accusation)*
  - **B — Until the next skill fires.** *(decides: long sessions inflate the number with unrelated work)*
  - **C — Rest of the session.** *(decides: a minute-one firing owns a two-hour session; two firings overlap)*
- **Recommendation:** A. The cost claim survives a sceptical tech lead only if every number is one they cannot argue down.
- **Impact (7/10):** every bundle and headline · **Importance (6/10):** very different numbers, all plausible
- **The call:** Ryan, 2026-09-24: A. Fits the North Star: the numbers stay honest.

### Scores
| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A — the exchange, helpers by agent id | 3 — spec §3.1 default; §5.6 never imply fuller coverage than was read | 2 — new turn-boundary logic; injected skill text mistaken for a human message closes the window early and undercounts | the report must survive a hostile reader |
| B — until next skill fires | 1 — spec silent; against §2.3's rule that every column describes a firing | 1 — simple scan | one skill per session |
| C — rest of session | 1 — same; overlapping ownership | 1 — simplest | nobody reads per-firing numbers |

### Technical
- **Files / code paths:** the turn machine copied from `src/lib/misses/harvest.ts` (human message = user record with `promptSource` and no `isMeta`; tool-result-only records are plumbing) defines the window. Helper transcripts at `<session>/subagents/agent-<id>.jsonl` carry `sessionId` and `agentId`; the parent record referencing that `agentId` sits inside a turn and places the helper's tokens.
- **Migration / schema:** the `firings.csv` columns are now fixed; `sessions.csv` gains `subagent_sessions`.
- **Effort / blast radius:** turn logic exists; the agent-id join is new, about a day inside the two-day usage estimate.
- **Grounding findings:** verified 2026-09-24 on this machine against a session with five helper launches; helper files carried the parent session id and an agent id, and the parent transcript referenced each agent id.

---

## Decision 3 — Package name (F4)

**Verdict: LOCK** · **Impact: 6/10** — a public package name is hard to move once it is in customer documents and pasted commands · **Importance: 5/10** — brand intent, which only Ryan holds; the code does not differ

### Plain English
- **Where we are:** the package name is the first word of ours the engineer reads. The 2026-09-23 decision named the offer a Skills Report or Health Check, not an audit, so the customer feels helped rather than judged.
- **The question:** what does the engineer type?
- **Options:**
  - **A — `terum-skills-report`.** Names what they get back. *(decides: matches the offer's name; reads as a report, not an inspection)*
  - **B — `terum-audit`.** Shorter. *(decides: honest to an engineer, but a forwarded command reads as being inspected)*
- **Recommendation:** A. The person typing is the person whose trust we most need, and length is not a cost when the command is pasted.
- **Impact (6/10):** every customer instruction points at the name · **Importance (5/10):** brand intent
- **The call:** Ryan, 2026-09-24: "report is better." Fits the North Star.

### Scores
| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A — `terum-skills-report` | 3 — Terum record 2026-09-23, present as a Skills Report or Health Check rather than lead with audit | 0 — a name | first impression outweighs brevity |
| B — `terum-audit` | 1 — that decision was about the offer's name; the spec carried this as a default only | 0 — a name | sales conversations already say audit |

### Technical
- **Files / code paths:** package name, the output folder `terum-skills-report-<date>/`, `collector.txt`, every command in the spec and the customer page. Spec §4, §8.1 and §3 need the rename in rev 2.
- **Migration / schema:** none.
- **Effort / blast radius:** none; a find-and-replace in the spec before build.
- **Grounding findings:** `terum-skills-report` returned not-found on npm 2026-09-24; re-check and publish a placeholder to hold it.

---

## Decision 4 — Redaction: replace-and-report or flag-only (F3)

**Verdict: LOCK** · **Impact: 5/10** — shapes what leaves on every run; the code is reversible, a leaked secret is not · **Importance: 4/10** — one option plainly safer; the loser costs a few not-evaluable skills

### Plain English
- **Where we are:** before a copied file goes into the folder, each line is checked against patterns for passwords, keys and tokens. Secrets never leave; the engineer's own review is the second line of defence, never the only one.
- **The question:** on a match, change the copy or only point at it?
- **Options:**
  - **A — Replace and report.** The matched value becomes a placeholder; `FLAGGED.md` lists it. *(decides: a secret the engineer misses in review still does not leave; a wrong match makes that skill not evaluable)*
  - **B — Flag only.** Copy untouched; the engineer edits by hand. *(decides: scripts arrive intact, but a skimmed-past secret is on our side)*
- **Recommendation:** A. A leaked credential is the customer's irreversible problem; a broken script is a skill honestly marked not evaluable.
- **Impact (5/10):** every run · **Importance (4/10):** mild preference
- **The call:** Ryan, 2026-09-24: A, refined. Replace the **value only**, never the variable name or the whole line. Detection is two tests on literal values: a known value shape from a published pattern list (Anthropic `sk-ant-`, OpenAI `sk-`, GitHub `ghp_`, AWS `AKIA`, Slack `xoxb-`, signed web tokens `eyJ`, private-key blocks), or a name containing key, secret, token, password, passwd, credential or auth followed by `=` or `:` and a literal. Reading a variable (`$ANTHROPIC_API_KEY`, `os.environ[...]`, `process.env.X`) is never flagged. Placeholder is `[REDACTED:<rule>]` in the value span; private-key body lines are replaced one for one so line numbers hold. `FLAGGED.md` records file, line, rule, variable name and a recognisable hint (prefix and length), never the value. A secret with no known shape and an innocent name is not caught; the manifest says so.

### Scores
| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A — replace value, report | 3 — spec §5.4 default; §2.6 secrets never collected; Terum ruling 2026-09-23, the collector itself excludes secrets | 2 — a false match on a value assigned to a name like `password` breaks a script that then reads not evaluable | a leaked secret is worse than a lost eval |
| B — flag only | 1 — relies on the human alone, against the 2026-09-23 ruling | 1 — no file change; failure is a missed line leaving | every script must arrive runnable |

### Technical
- **Files / code paths:** redaction pass over every copied file before it is written to the output folder; `FLAGGED.md` writer; manifest marks redacted files so the eval treats those skills as not evaluable.
- **Migration / schema:** none.
- **Effort / blast radius:** about a day; the pattern list is vendored from a published set (gitleaks is the candidate; licence to check), plus the name-based assignment rule and private-key blocks.
- **Grounding findings:** none — conceptual.

---

## Decision 5 — Project labels: folder name or hash (settled without asking)

**Verdict: LOCK** · **Impact: 3/10** — a label string in the manifest and folder names; re-running the command changes it · **Importance: 3/10** — mild preference; the loser costs one finding

Folder name picked, with a `--hash-labels` flag for a customer who asks, because the report's ownership and duplicates findings need to say which repository a skill lives in, and a repo name is not personal identity under the spec's no-identity rule.

| Option | Fit (0-4) | Bug risk (0-4) |
|---|---|---|
| Folder base name (picked) | 3 — matches the collection plan's report sections "inventory, ownership, duplicates" and spec §5.5 "project labels are the folder's base name" | 0 — a string swap |
| Hash | 1 — spec §5.5 bans username, hostname, machine id and home path, and is silent on repo names | 0 — a string swap |

### Technical
- **Files / code paths:** manifest writer, folder naming in `skills/project-<label>/` and `linked/<label>/`.
- **Effort / blast radius:** one function; the flag is a boolean.

---

## Decision 6 — Hook commands: off by default (settled without asking)

**Verdict: LOCK** · **Impact: 3/10** — one flag; reversible by re-running · **Importance: 2/10** — one option is plainly right

Off by default, on with `--include-hooks`, because hook command lines carry file paths and sometimes credentials, and the spec's no-identity and never-collected rules exclude paths and secrets by default; the eval loses some token attribution accuracy, which the report states.

| Option | Fit (0-4) | Bug risk (0-4) |
|---|---|---|
| Off by default, flag to include (picked) | 3 — spec §2.4 "the hook commands themselves are opt-in"; §2.6 never collects `.env` and configuration | 0 — a default |
| On by default | 1 — spec silent on hooks as a default target; §5.5 bans full home paths, which hook commands routinely contain | 0 — a default |

### Technical
- **Files / code paths:** settings reader; `hooks` key of `~/.claude/settings.json`, event names only unless flagged.

---

## Decision 7 — Project CLAUDE.md files: off by default (settled without asking)

**Verdict: LOCK** · **Impact: 3/10** — one flag · **Importance: 2/10** — one option is plainly right

Off by default, on with `--include-claude-md`, because project instruction files are internal context about the customer's codebase, and the 2026-09-24 ruling accepted skill files, referenced scripts, usage counts and limited environment metadata as the collection targets, not project instructions.

| Option | Fit (0-4) | Bug risk (0-4) |
|---|---|---|
| Off by default, flag to include (picked) | 3 — spec §2.4 "opt-in [default: off]"; Terum ruling 2026-09-24 on accepted collection targets | 0 — a default |
| On by default | 1 — spec silent; the eval benefits, but the ruling's target list does not include them | 0 — a default |

### Technical
- **Files / code paths:** project scanner; reads `<project>/CLAUDE.md` and `.claude/rules/` only when flagged.
