// Self-check for journal.mjs: capped, redacted entries merged into one file
// per day. Run: node journal.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, storeFor, tool, slug } from './harness.mjs';

const { home, env } = tempHome('jr-test-');
const { entryOf, render, parseDay, record, dayFile, days, write, sweep } = await import('./journal.mjs');
const { local } = await import('./store.mjs');
const dir = storeFor(home, 'C:\\journal-selftest');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const stripe = (kind, mode) => [kind, mode, '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
const T = '/x/projects/C--proj/0123456789abcdef.jsonl';
const turn = (over) => ({ at: '2026-10-28 14:05', ask: 'a question', raw: 'a question', did: 'an answer', changed: [], ran: [], id: 'u-1', branch: 'main', cwd: 'C:\\proj', ...over });
const day = (at = '2026-10-28') => readFileSync(dayFile(dir, at), 'utf8');

{
  const e = entryOf(turn({ ask: 'q'.repeat(5000), did: 'a'.repeat(9000),
    changed: Array.from({ length: 30 }, (_, i) => `C:\\proj\\f${i}.js`), ran: Array.from({ length: 15 }, (_, i) => `cmd${i}`) }), T);
  ok(e.asked.length === 2000 && e.asked.endsWith('…'), `ask capped at 2000 (got ${e.asked.length})`);
  ok(e.answered.length === 3000, `reply capped at 3000 (got ${e.answered.length})`);
  ok(e.changed.length === 20 && e.changed[19] === 'f29.js' && e.changed[0] === 'f10.js', `last 20 files, relative to cwd (got ${e.changed[0]}..${e.changed[19]})`);
  ok(e.ran.length === 10 && e.ran[0] === 'cmd5' && e.ran[9] === 'cmd14', `last 10 commands (got ${e.ran})`);
  ok(entryOf(turn({ ran: ['x'.repeat(500)] }), T).ran[0].length === 200, 'a command capped at 200');
  ok(e.s === '01234567' && e.t === 'C--proj/0123456789abcdef', `conversation tag and t from the path (got ${e.s} ${e.t})`);
}
{
  const k = stripe('sk', 'live');
  const e = entryOf(turn({ ask: `use ${k}`, did: `saw ${k}`, changed: [`C:\\proj\\${k}.txt`], ran: [`curl -H ${k}`] }), T);
  for (const [f, v] of [['asked', e.asked], ['answered', e.answered], ['changed', e.changed[0]], ['ran', e.ran[0]]])
    ok(!v.includes(k) && v.includes('[redacted]'), `${f} redacted (got ${v})`);
}
{
  const e = entryOf(turn({ raw: 'secret <private>x</private>', ask: 'secret', did: 'reply', changed: ['C:\\proj\\a'], ran: ['ls'] }), T);
  ok(e.answered === '[private]' && !e.changed.length && !e.ran.length, 'a private turn keeps no answer, files or commands');
}
{
  const e = entryOf(turn({ changed: ['C:\\proj\\a.js', 'D:\\o\\b.js'], ran: ['ls', 'git status'] }), T);
  assert.deepStrictEqual(parseDay(render(e)).entries[0], e); checks++;
  const f = entryOf(turn({ id: '', branch: '' }), T);
  assert.deepStrictEqual(parseDay(render(f)).entries[0], f); checks++;
  ok(!render(f).includes('branch') && !render(f).includes('**Changed') && !render(f).includes('**Ran'), 'no branch, Changed or Ran when empty');
}
{
  ok(record(dir, T, [turn()]) === 1, 'a new turn counts one');
  ok(record(dir, T, [turn()]) === 0, 'the same turn counts none');
  ok(parseDay(day()).entries.length === 1, 'one entry per key');
  ok(record(dir, T, [turn({ did: 'new answer' })]) === 1, 'a changed answer counts one');
  const es = parseDay(day()).entries;
  ok(es.length === 1 && es[0].answered === 'new answer', 'the answer replaced in place');
}
{
  record(dir, T, [turn({ at: '2026-10-27 23:59', id: 'u-late' })]);
  ok(day('2026-10-27').includes('u-late') && !day().includes('u-late'), "an entry belongs to the day its turn started");
  ok(days(dir).join() === '2026-10-27,2026-10-28', `days lists the day files (got ${days(dir)})`);
}
{
  record(dir, T, [turn({ at: '2026-10-29 14:07', id: 'a' })]);
  record(dir, T, [turn({ at: '2026-10-29 14:05', id: 'b' })]);
  const es = parseDay(day('2026-10-29')).entries;
  ok(es[0].key === 'b' && es[1].key === 'a', `sorted by time (got ${es.map((e) => e.key)})`);
}
{
  const f = dayFile(dir, '2026-10-28');
  writeFileSync(f, readFileSync(f, 'utf8').replace('# Journal 2026-10-28\n\n', '# Journal 2026-10-28\n\nMy own note.\n\n') + '\n<!-- j:broken -->\n');
  record(dir, T, [turn({ id: 'u-2', at: '2026-10-28 15:00' })]);
  const d = day(), p = parseDay(d);
  ok(d.includes('My own note.') && d.includes('<!-- j:broken -->'), 'hand-written text and a broken marker survive');
  ok(p.entries.length === 2 && new Set(p.entries.map((e) => e.key)).size === 2, 'one entry per key after the merge');
  ok(record(dir, T, []) === 0, 'no turns, no change');
}
{
  const a = entryOf(turn({ id: '' }), T).key, b = entryOf(turn({ id: '' }), T).key;
  ok(a === b && a.startsWith('01234567 2026-10-28 14:05 '), `a key-less turn gets a stable key (got ${a})`);
  ok(entryOf(turn({ id: '', raw: 'other' }), T).key !== a, 'the key follows the text');
}

for (const [name, mark] of [['CRLF', (t) => t.replace(/\n/g, '\r\n')], ['BOM', (t) => '\uFEFF' + t]]) {
  const f = dayFile(dir, '2026-10-30');
  record(dir, T, [turn({ at: '2026-10-30 10:00', id: 'c-1' })]);
  writeFileSync(f, mark(readFileSync(f, 'utf8')));
  ok(parseDay(readFileSync(f, 'utf8')).entries.length === 1 && parseDay(readFileSync(f, 'utf8')).prose === '', `a ${name} day file parses to its entry and no prose`);
  record(dir, T, [turn({ at: '2026-10-30 10:00', id: 'c-1' })]);
  ok(parseDay(readFileSync(f, 'utf8')).entries.length === 1, `re-recording in a ${name} day file adds no copy`);
  writeFileSync(f, '');
}

// The sink: a conversation already private writes nothing; the Stop that marks
// it takes back what it wrote, from the day it began on.
{
  write(dir, T, [turn({ at: '2026-10-31 09:00', id: 'q-1' })], { quiet: true, hush: false });
  ok(!days(dir).includes('2026-10-31'), 'a conversation already private writes no entry');
  const S = join(home, 'aaaaaaaa-0000-4000-8000-000000000000.jsonl'), O = '/x/projects/C--proj/bbbbbbbb.jsonl';
  writeFileSync(S, JSON.stringify({ type: 'queue-operation', timestamp: new Date(2026, 10, 6, 12).toISOString() }) + '\n');
  record(dir, S, [turn({ at: '2026-11-05 10:00', id: 's-1' }), turn({ at: '2026-11-06 12:30', id: 's-2' })]);
  record(dir, O, [turn({ at: '2026-11-06 12:40', id: 'o-1' })]);
  const keys = (d) => parseDay(day(d)).entries.map((e) => e.key).join();
  const n = sweep(dir, 'aaaaaaaa', S);
  ok(n === 1 && keys('2026-11-06') === 'o-1' && keys('2026-11-05') === 's-1', `the sweep takes the conversation's entries from the day it began on, and opens no day before (got ${n}, ${keys('2026-11-06')}, ${keys('2026-11-05')})`);
  ok(sweep(dir, 'aaaaaaaa') === 1 && keys('2026-11-05') === '', 'with no transcript to read, the sweep goes through every day');
}

// --- the Stop hook, as Claude Code runs it -----------------------------------
const TIER = tool('memory-tier.mjs');
const scwd = 'C:\\journal-stop-selftest', proj = join(home, '.claude', 'projects', slug(scwd)), sdir = join(proj, 'memory');
mkdirSync(proj, { recursive: true });
const sid = (c) => `${c.repeat(8)}-0000-4000-8000-000000000000`;
const tp = (id) => join(proj, `${id}.jsonl`);
let uuid = 0;
const rec = (type, id, ts, text) => JSON.stringify({ type, uuid: `${id.slice(0, 8)}-${++uuid}`, sessionId: id, cwd: scwd, gitBranch: 'feat/journal', timestamp: ts,
  message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] } });
const say = (id, ts, ask, reply) => appendFileSync(tp(id), [rec('user', id, ts, ask), ...(reply ? [rec('assistant', id, ts, reply)] : [])].join('\n') + '\n');
const payload = (id, last) => JSON.stringify({ cwd: scwd, transcript_path: tp(id), session_id: id, hook_event_name: 'Stop', last_assistant_message: last });
const stop = (id, last) => spawnSync(process.execPath, [TIER, '--stop'], { env, input: payload(id, last), encoding: 'utf8' });
const stopNow = (id) => new Promise((done) => { const c = spawn(process.execPath, [TIER, '--stop'], { env, stdio: ['pipe', 'ignore', 'ignore'] }); c.on('exit', done); c.stdin.end(payload(id)); });
const of = (id) => days(sdir).flatMap((d) => parseDay(readFileSync(dayFile(sdir, d), 'utf8')).entries).filter((e) => e.s === id.slice(0, 8));
const [A, B, C, D, X] = ['1', '2', '3', '4', '5'].map(sid);
{
  say(X, '2026-10-28T09:00:00Z', 'asked with memory off', 'answered');
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { stop(X); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  ok(!existsSync(join(sdir, 'journal')), 'auto memory off writes no journal');
}
{
  const ts = '2026-10-28T10:00:00Z';
  say(A, ts, 'first question', 'first answer');
  stop(A);
  const es = parseDay(readFileSync(dayFile(sdir, local(ts)), 'utf8')).entries;
  ok(es.length === 1 && es[0].asked === 'first question' && es[0].answered === 'first answer' && es[0].branch === 'feat/journal',
    `a reply leaves one journal entry, with the request, the reply and the branch (got ${JSON.stringify(es)})`);
}
{
  say(A, '2026-10-28T10:05:00Z', 'second question');
  stop(A, 'the reply Claude Code passed');
  const e = of(A).find((x) => x.asked === 'second question');
  ok(e?.answered === 'the reply Claude Code passed', `the reply Claude Code passes is the one journaled (got ${e?.answered})`);
  const f = dayFile(sdir, local('2026-10-28T10:05:00Z')), old = new Date('2026-01-01T00:00:00Z'), before = readFileSync(f, 'utf8');
  utimesSync(f, old, old);
  stop(A, 'the reply Claude Code passed');
  ok(readFileSync(f, 'utf8') === before && statSync(f).mtimeMs === old.getTime(), 'a second Stop on the same turn changes nothing');
}
{
  say(B, '2026-10-28T10:10:00Z', 'a normal turn', 'a normal reply');
  stop(B);
  ok(of(B).length === 1, `a normal turn is journaled (got ${of(B).length})`);
  say(B, '2026-10-28T10:12:00Z', '<private-session> from here on', 'understood');
  stop(B);
  ok(of(B).length === 0 && of(A).length === 2, `a private session writes nothing and removes what it wrote, and no other's (got ${of(B).length}, ${of(A).length})`);
}
{
  const ts = '2026-11-02T12:00:00Z', f = dayFile(sdir, local(ts)), failed = join(sdir, 'journal', '.failed');
  mkdirSync(f, { recursive: true });
  say(A, ts, 'third question', 'third answer');
  stop(A);
  let fl = null; try { fl = JSON.parse(readFileSync(failed, 'utf8')); } catch {}
  ok(fl && Date.parse(fl.at) && fl.error && readFileSync(join(sdir, 'handoff.md'), 'utf8').includes('third question'),
    `a failing journal write is kept and the handoff still written (got ${JSON.stringify(fl)})`);
  rmSync(f, { recursive: true });
  stop(A);
  ok(!existsSync(failed) && of(A).some((e) => e.asked === 'third question'), 'the next good write clears it');
}
{
  for (let i = 0; i < 10; i++) {
    const ts = `2026-10-28T11:${String(i).padStart(2, '0')}:00Z`;
    for (const id of [C, D]) say(id, ts, `${id.slice(0, 1)} question ${i}`, `answer ${i}`);
    await Promise.all([stopNow(C), stopNow(D)]);
  }
  // A Stop that found the lock held is caught up by the next: one more each.
  stop(C); stop(D);
  for (const id of [C, D]) {
    const es = of(id);
    ok(es.length === 10 && new Set(es.map((e) => e.key)).size === 10 && new Set(es.map((e) => e.asked)).size === 10,
      `parallel Stops lose no entry and write none twice (got ${es.length} for ${id.slice(0, 8)})`);
  }
}

console.log(`journal: ${checks} checks passed`);
