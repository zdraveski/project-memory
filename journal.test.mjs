// Self-check for journal.mjs: capped, redacted entries merged into one file
// per day. Run: node journal.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, storeFor } from './harness.mjs';

const { home } = tempHome('jr-test-');
const { entryOf, render, parseDay, record, dayFile, days } = await import('./journal.mjs');
const dir = storeFor(home, 'C:\\journal-selftest');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const stripe = (kind, mode) => [kind, mode, '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
const T = 'C:\\x\\projects\\C--proj\\0123456789abcdef.jsonl';
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
  assert.deepStrictEqual(parseDay(render(f)).entries[0], f);
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

console.log(`journal: ${checks} checks passed`);
