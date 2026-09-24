/**
 * From parsed transcripts to the three usage tables (spec §3.1). Which tokens a firing owns is
 * locked (walk D2): the exchange it fired in, from the firing to the next message a person typed,
 * plus the work of any subagent launched inside that window, joined by `agentId`. A turn is one
 * model response (one API call). Session ids are hashed with a per-run salt that is never written.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { CsvValue } from '../csv.js';
import { reason, type Problem } from '../home.js';
import type { SkillEntry, UsageSummary } from '../report.js';
import { addUsage, parseTranscript, ZERO, type Event, type Usage } from './transcripts.js';

export interface SubagentWork { usage: Usage; turns: number }

export interface SessionInput {
  /** Session id as Claude Code names it (the file stem). Hashed before anything is written. */
  sessionId: string;
  events: Event[];
  /** Nested subagent transcripts by agentId. */
  subagents: Map<string, SubagentWork>;
}

export interface SessionRow extends Record<string, CsvValue> { session_id: string; day: string; turns: number; human_messages: number; interruptions: number; skill_fires: number; distinct_skills: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number; minutes: number; subagent_sessions: number }
export interface FiringRow extends Record<string, CsvValue> { firing_id: string; session_id: string; day: string; skill: string; source: string; invoked_by: 'model' | 'human'; model: string; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number; turns_after: number; tool_errors_after: number; interrupted_after: number; refired_in_session: boolean }
export interface SummaryRow extends Record<string, CsvValue> { skill: string; source: string; fires: number; fires_by_model: number; fires_by_human: number; sessions: number; first_day: string; last_day: string; avg_tokens_per_fire: number; skill_text_tokens: number }

export const day = (ts: string): string => (ts.length >= 10 ? ts.slice(0, 10) : '');

export class SessionHasher {
  private readonly salt = randomBytes(16);
  hash(sessionId: string): string { return createHash('sha256').update(this.salt).update(sessionId).digest('hex').slice(0, 16); }
}

/** Where a skill name was found among the copied skills, or `unknown`. */
export function sourceLookup(skills: readonly SkillEntry[]): (name: string) => { source: string; textChars: number } {
  const byName = new Map<string, { sources: string[]; textChars: number }>();
  for (const skill of skills) {
    const entry = byName.get(skill.name) ?? { sources: [], textChars: skill.skillTextChars };
    if (!entry.sources.includes(skill.source)) entry.sources.push(skill.source);
    entry.textChars = Math.max(entry.textChars, skill.skillTextChars);
    byName.set(skill.name, entry);
  }
  return (name) => { const e = byName.get(name); return e === undefined ? { source: 'unknown', textChars: 0 } : { source: e.sources.join('|'), textChars: e.textChars }; };
}

interface Firing { kind: 'D1' | 'D2'; skill: string; index: number; ts: string; model: string; messageId: string | undefined }

/** Both tables' rows for one session. Exported for tests: it is the whole definition of a firing's cost. */
export function sessionRows(input: SessionInput, hasher: SessionHasher, lookup: ReturnType<typeof sourceLookup>): { session: SessionRow; firings: FiringRow[] } {
  const { events, subagents } = input;
  const hashed = hasher.hash(input.sessionId);
  const usageById = new Map<string, Usage>();
  const modelById = new Map<string, string>();
  const firings: Firing[] = [];
  let humans = 0;
  let interruptions = 0;
  let firstTs = '';
  let lastTs = '';

  for (const [index, event] of events.entries()) {
    if (event.ts.length > 0) { if (firstTs === '' || event.ts < firstTs) firstTs = event.ts; if (event.ts > lastTs) lastTs = event.ts; }
    if (event.type === 'assistant') {
      if (event.usage !== undefined) usageById.set(event.messageId, event.usage);
      if (event.model.length > 0 && !modelById.has(event.messageId)) modelById.set(event.messageId, event.model);
      for (const skill of event.skillCalls) firings.push({ kind: 'D1', skill, index, ts: event.ts, model: event.model, messageId: event.messageId });
    } else if (event.type === 'human') {
      humans++;
      for (const skill of event.commands) firings.push({ kind: 'D2', skill, index, ts: event.ts, model: '', messageId: undefined });
    } else if (event.type === 'interruption') interruptions++;
  }

  const humanIndexes = events.map((e, i) => (e.type === 'human' ? i : -1)).filter((i) => i >= 0);
  const nextHuman = (after: number): number => humanIndexes.find((i) => i > after) ?? events.length;

  const firingRows: FiringRow[] = [];
  firings.forEach((firing, n) => {
    const end = nextHuman(firing.index);
    const ids = new Set<string>();
    if (firing.messageId !== undefined) ids.add(firing.messageId);
    let turnsAfter = 0;
    let errors = 0;
    let interrupted = 0;
    let model = firing.model;
    let usage = ZERO;
    for (let i = firing.index; i < end; i++) {
      const e = events[i]!;
      if (e.type === 'assistant') {
        if (i > firing.index && !ids.has(e.messageId) && e.usage !== undefined) turnsAfter++;
        if (i > firing.index && e.messageId !== firing.messageId) ids.add(e.messageId);
        if (model === '' && e.model.length > 0) model = e.model;
      } else if (e.type === 'tool_result') {
        if (i > firing.index) errors += e.errors;
        for (const agentId of e.agentIds) {
          const work = subagents.get(agentId);
          if (work === undefined) continue;
          usage = addUsage(usage, work.usage);
          turnsAfter += work.turns;
        }
      } else if (e.type === 'interruption' && i > firing.index) interrupted++;
    }
    for (const id of ids) usage = addUsage(usage, usageById.get(id) ?? ZERO);
    const refired = firings.some((other, m) => m !== n && other.skill === firing.skill && other.index > firing.index);
    firingRows.push({
      firing_id: `${hashed}-${n + 1}`,
      session_id: hashed,
      day: day(firing.ts),
      skill: firing.skill,
      source: lookup(firing.skill).source,
      invoked_by: firing.kind === 'D1' ? 'model' : 'human',
      model,
      input_tokens: usage.input,
      cache_read_tokens: usage.cacheRead,
      cache_write_tokens: usage.cacheWrite,
      output_tokens: usage.output,
      turns_after: turnsAfter,
      tool_errors_after: errors,
      interrupted_after: interrupted,
      refired_in_session: refired,
    });
  });

  let sessionUsage = ZERO;
  for (const u of usageById.values()) sessionUsage = addUsage(sessionUsage, u);
  let turns = usageById.size;
  for (const work of subagents.values()) { sessionUsage = addUsage(sessionUsage, work.usage); turns += work.turns; }
  const minutes = firstTs !== '' && lastTs !== '' ? Math.round((Date.parse(lastTs) - Date.parse(firstTs)) / 60_000) : 0;
  const session: SessionRow = {
    session_id: hashed,
    day: day(firstTs),
    turns,
    human_messages: humans,
    interruptions,
    skill_fires: firings.length,
    distinct_skills: new Set(firings.map((f) => f.skill)).size,
    input_tokens: sessionUsage.input,
    cache_read_tokens: sessionUsage.cacheRead,
    cache_write_tokens: sessionUsage.cacheWrite,
    output_tokens: sessionUsage.output,
    minutes: Number.isFinite(minutes) ? minutes : 0,
    subagent_sessions: subagents.size,
  };
  return { session, firings: firingRows };
}

export function summaryRows(firings: readonly FiringRow[], lookup: ReturnType<typeof sourceLookup>): SummaryRow[] {
  const bySkill = new Map<string, FiringRow[]>();
  for (const f of firings) { const list = bySkill.get(f.skill) ?? []; list.push(f); bySkill.set(f.skill, list); }
  return [...bySkill.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([skill, rows]) => {
    const days = rows.map((r) => r.day).filter((d) => d.length > 0).sort();
    const tokens = rows.reduce((sum, r) => sum + r.input_tokens + r.cache_read_tokens + r.cache_write_tokens + r.output_tokens, 0);
    const found = lookup(skill);
    return {
      skill,
      source: found.source,
      fires: rows.length,
      fires_by_model: rows.filter((r) => r.invoked_by === 'model').length,
      fires_by_human: rows.filter((r) => r.invoked_by === 'human').length,
      sessions: new Set(rows.map((r) => r.session_id)).size,
      first_day: days[0] ?? '',
      last_day: days[days.length - 1] ?? '',
      avg_tokens_per_fire: Math.round(tokens / rows.length),
      skill_text_tokens: Math.ceil(found.textChars / 4),
    };
  });
}

export interface ScanResult {
  summary: UsageSummary;
  sessions: SessionRow[];
  firings: FiringRow[];
  claudeCodeVersion: string | undefined;
}

function subagentWork(text: string): SubagentWork {
  const parsed = parseTranscript(text, true);
  let usage = ZERO;
  let turns = 0;
  for (const e of parsed.events) if (e.type === 'assistant' && e.usage !== undefined) { usage = addUsage(usage, e.usage); turns++; }
  return { usage, turns };
}

/**
 * Every transcript under `~/.claude/projects`: one level of project folders, `<session>.jsonl` in
 * each, and `<session>/subagents/*.jsonl` beside it. A missing root is *no session data*, not an
 * error. Every unreadable file is a recorded problem and the walk continues.
 */
export async function scanTranscripts(root: string, skills: readonly SkillEntry[]): Promise<ScanResult> {
  const summary: UsageSummary = { status: 'no-session-data', projectFolders: 0, sessions: 0, headlessSessionsSkipped: 0, subagentTranscripts: 0, filesSkipped: [], linesSkipped: 0, firings: 0, sessionsWithFirings: 0, firstDay: undefined, lastDay: undefined };
  const result: ScanResult = { summary, sessions: [], firings: [], claudeCodeVersion: undefined };
  let projects: string[];
  try { projects = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  catch { return result; }
  const hasher = new SessionHasher();
  const lookup = sourceLookup(skills);
  let latestVersionTs = '';
  // A project folder's name is the project's full path with dashes, and a file's name is its
  // session id: neither may be written (spec §5.5). Folders are numbered; files are hashed.
  let folderNo = 0;
  const problem = (file: string, why: string): void => { summary.filesSkipped.push({ where: `~/.claude/projects/<folder ${folderNo}>/${hasher.hash(basename(file, '.jsonl'))}.jsonl`, reason: why }); };

  for (const slug of projects) {
    folderNo++;
    const dir = join(root, slug);
    let names: string[];
    try { names = (await readdir(dir)).sort(); }
    catch (error) { summary.filesSkipped.push({ where: `~/.claude/projects/<folder ${folderNo}>`, reason: reason(error) }); continue; }
    const files = names.filter((n) => n.endsWith('.jsonl'));
    if (files.length === 0) continue;
    summary.projectFolders++;
    summary.status = 'read';
    for (const file of files) {
      const sessionId = basename(file, '.jsonl');
      let text: string;
      try { text = await readFile(join(dir, file), 'utf8'); }
      catch (error) { problem(file, reason(error)); continue; }
      const parsed = parseTranscript(text);
      summary.linesSkipped += parsed.badLines;
      if (parsed.records === 0) { problem(file, 'could not parse'); continue; }
      if (parsed.counted === 0) { if (parsed.headless > 0) summary.headlessSessionsSkipped++; else problem(file, 'no messages'); continue; }
      const subagents = new Map<string, SubagentWork>();
      const nested = join(dir, sessionId, 'subagents');
      let nestedFiles: string[] = [];
      try { nestedFiles = (await readdir(nested)).filter((n) => n.endsWith('.jsonl')).sort(); } catch { /* no subagents */ }
      for (const nestedFile of nestedFiles) {
        try {
          const work = subagentWork(await readFile(join(nested, nestedFile), 'utf8'));
          const agentId = nestedFile.replace(/^agent-/, '').replace(/\.jsonl$/, '');
          subagents.set(agentId, work);
          summary.subagentTranscripts++;
        } catch (error) { problem(`${sessionId}-subagent`, reason(error)); }
      }
      const rows = sessionRows({ sessionId: parsed.sessionId ?? sessionId, events: parsed.events, subagents }, hasher, lookup);
      result.sessions.push(rows.session);
      result.firings.push(...rows.firings);
      summary.sessions++;
      if (rows.firings.length > 0) summary.sessionsWithFirings++;
      summary.firings += rows.firings.length;
      const d = rows.session.day;
      if (d.length > 0) { if (summary.firstDay === undefined || d < summary.firstDay) summary.firstDay = d; if (summary.lastDay === undefined || d > summary.lastDay) summary.lastDay = d; }
      const lastEvent = parsed.events[parsed.events.length - 1];
      if (parsed.version !== undefined && lastEvent !== undefined && lastEvent.ts >= latestVersionTs) { latestVersionTs = lastEvent.ts; result.claudeCodeVersion = parsed.version; }
    }
  }
  result.sessions.sort((a, b) => a.day.localeCompare(b.day) || a.session_id.localeCompare(b.session_id));
  const order = new Map(result.sessions.map((s, i) => [s.session_id, i] as const));
  result.firings.sort((a, b) => (order.get(a.session_id) ?? 0) - (order.get(b.session_id) ?? 0) || Number(a.firing_id.split('-').pop()) - Number(b.firing_id.split('-').pop()));
  return result;
}

export type { Problem };
