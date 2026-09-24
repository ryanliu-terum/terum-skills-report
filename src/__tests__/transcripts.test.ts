import { describe, expect, it } from 'vitest';
import { SessionHasher, sessionRows, sourceLookup } from '../lib/usage/rows.js';
import { parseTranscript } from '../lib/usage/transcripts.js';

const line = (record: unknown): string => JSON.stringify(record);
const cli = { entrypoint: 'cli', isSidechain: false, timestamp: '2026-09-20T10:00:00.000Z', sessionId: 's', version: '2.1.280' };
const usage = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 };

describe('parseTranscript', () => {
  it('keeps a person, drops headless and sidechain records, and counts bad lines', () => {
    const text = [
      line({ ...cli, type: 'user', message: { role: 'user', content: 'hi' }, promptSource: 'typed' }),
      line({ ...cli, entrypoint: 'sdk-cli', type: 'user', message: { role: 'user', content: 'eval prompt' } }),
      line({ ...cli, isSidechain: true, type: 'assistant', message: { id: 'm0', model: 'x', content: [], usage } }),
      line({ ...cli, type: 'assistant', message: { id: 'm1', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'hello' }], usage } }),
      'not json',
      '[1,2,3]',
      line({ type: 'file-history-snapshot' }),
    ].join('\n');
    const parsed = parseTranscript(text);
    expect(parsed.events.map((e) => e.type)).toEqual(['human', 'assistant']);
    expect(parsed).toMatchObject({ counted: 2, headless: 1, badLines: 2, records: 5, version: '2.1.280', sessionId: 's' });
  });

  it('keeps a record with no entrypoint field (older Claude Code) as a person', () => {
    const { entrypoint: _drop, ...old } = cli;
    void _drop;
    const parsed = parseTranscript(line({ ...old, type: 'user', message: { role: 'user', content: 'old style' } }));
    expect(parsed.events).toHaveLength(1);
  });

  it('records usage once per message id and every Skill call on every record', () => {
    const text = [
      line({ ...cli, type: 'assistant', message: { id: 'm1', model: 'a', content: [{ type: 'text', text: 't' }], usage } }),
      line({ ...cli, type: 'assistant', message: { id: 'm1', model: 'a', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'one' } }, { type: 'tool_use', name: 'Skill', input: { skill: 'two' } }], usage } }),
      line({ ...cli, type: 'assistant', message: { id: 'm2', model: 'b', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
    ].join('\n');
    const events = parseTranscript(text).events.filter((e) => e.type === 'assistant');
    expect(events.map((e) => e.type === 'assistant' && e.usage !== undefined)).toEqual([true, false, true]);
    expect(events.map((e) => (e.type === 'assistant' ? e.skillCalls : []))).toEqual([[], ['one', 'two'], []]);
    // No usage on the record at all: zero, not undefined, so the response still counts as a turn.
    expect(events[2]).toMatchObject({ usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } });
  });

  it('reads slash commands as a person with D2 firings, builtins removed, and injected text as nothing', () => {
    const text = [
      line({ ...cli, type: 'user', message: { role: 'user', content: '<command-message>x</command-message>\n<command-name>/decision-walk</command-name>\n<command-args>a b</command-args>' } }),
      line({ ...cli, type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /x\n\nskill body' }] } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: '<local-command-stdout></local-command-stdout>' } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<task-notification><task-id>abc</task-id></task-notification>' }] } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>only this</system-reminder>' }] } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'real words\n<system-reminder>appended</system-reminder>' }] } }),
    ].join('\n');
    const events = parseTranscript(text).events;
    expect(events).toEqual([
      { type: 'human', ts: cli.timestamp, commands: ['decision-walk'] },
      { type: 'human', ts: cli.timestamp, commands: [] },
      { type: 'human', ts: cli.timestamp, commands: [] },
    ]);
  });

  it('reads tool results with errors and launched subagents, and both interruption markers', () => {
    const text = [
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }, { type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a1b2c3d4e5f6 (internal)' }] }] }, toolUseResult: { agentId: 'a1b2c3d4e5f6' } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      line({ ...cli, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
    ].join('\n');
    expect(parseTranscript(text).events).toEqual([
      { type: 'tool_result', ts: cli.timestamp, errors: 1, agentIds: [] },
      { type: 'tool_result', ts: cli.timestamp, errors: 0, agentIds: ['a1b2c3d4e5f6'] },
      { type: 'interruption', ts: cli.timestamp },
      { type: 'interruption', ts: cli.timestamp },
    ]);
  });

  it('keeps sidechain records in a nested subagent transcript', () => {
    const parsed = parseTranscript(line({ ...cli, isSidechain: true, agentId: 'x', type: 'assistant', message: { id: 'm', model: 'a', content: [], usage } }), true);
    expect(parsed.events).toHaveLength(1);
  });
});

describe('sessionRows', () => {
  const hasher = new SessionHasher();
  const lookup = sourceLookup([]);
  const t = (s: number): string => new Date(Date.UTC(2026, 8, 20, 10, 0, s)).toISOString();
  const u = (n: number) => ({ input: n, cacheWrite: 0, cacheRead: 0, output: 0 });

  it('a firing with no later human message owns the rest of the session; a typed command with no reply has no model', () => {
    const { session, firings } = sessionRows({
      sessionId: 'abc',
      events: [
        { type: 'human', ts: t(0), commands: ['typed-one'] },
        { type: 'human', ts: t(1), commands: [] },
        { type: 'assistant', ts: t(2), messageId: 'm1', model: 'x', usage: u(10), skillCalls: ['chosen'] },
        { type: 'assistant', ts: t(3), messageId: 'm2', model: 'x', usage: u(20), skillCalls: [] },
      ],
      subagents: new Map(),
    }, hasher, lookup);
    expect(firings.map((f) => [f.skill, f.invoked_by, f.model, f.input_tokens, f.turns_after, f.refired_in_session])).toEqual([
      ['typed-one', 'human', '', 0, 0, false],
      ['chosen', 'model', 'x', 30, 1, false],
    ]);
    expect(session).toMatchObject({ turns: 2, human_messages: 2, skill_fires: 2, distinct_skills: 2, input_tokens: 30, minutes: 0 });
    expect(firings[0]!.source).toBe('unknown');
  });

  it('two firings in one exchange both own it; a subagent launched outside any firing still counts for the session', () => {
    const subagents = new Map([['agentA', { usage: u(100), turns: 3 }], ['agentB', { usage: u(1000), turns: 1 }]]);
    const { session, firings } = sessionRows({
      sessionId: 'abc',
      events: [
        { type: 'human', ts: t(0), commands: [] },
        { type: 'assistant', ts: t(1), messageId: 'm1', model: 'x', usage: u(1), skillCalls: ['a', 'b'] },
        { type: 'tool_result', ts: t(2), errors: 0, agentIds: ['agentA'] },
        { type: 'assistant', ts: t(3), messageId: 'm2', model: 'x', usage: u(2), skillCalls: [] },
        { type: 'human', ts: t(60), commands: [] },
        { type: 'tool_result', ts: t(61), errors: 2, agentIds: ['agentB'] },
        { type: 'assistant', ts: t(120), messageId: 'm3', model: 'x', usage: u(4), skillCalls: [] },
      ],
      subagents,
    }, hasher, lookup);
    expect(firings.map((f) => [f.skill, f.input_tokens, f.turns_after, f.tool_errors_after])).toEqual([['a', 103, 4, 0], ['b', 103, 4, 0]]);
    expect(session).toMatchObject({ turns: 7, input_tokens: 1107, subagent_sessions: 2, minutes: 2 });
  });

  it('hashes session ids differently per run and never writes the raw id', () => {
    const a = new SessionHasher().hash('1f910c4b-0929-482f-8eb2-b215ca4a17a2');
    const b = new SessionHasher().hash('1f910c4b-0929-482f-8eb2-b215ca4a17a2');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});
