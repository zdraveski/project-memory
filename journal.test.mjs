// Self-check for journal.mjs: capped, redacted entries merged into one file
// per day. Run: node journal.test.mjs
import fs, { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, storeFor, tool, slug, quick, fastClock } from './harness.mjs';

const { home, env } = tempHome('jr-test-');
const { entryOf, render, parseDay, record, dayFile, days, write, sweep, backfill, entries, forget, summary, firstDay } = await import('./journal.mjs');
const { local, withLock } = await import('./store.mjs');
const dir = storeFor(home, 'C:\\journal-selftest');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const throws = (f) => { try { f(); return false; } catch { return true; } };

const stripe = (kind, mode) => [kind, mode, '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
const T = '/x/projects/C--proj/0123456789abcdef.jsonl';
const turn = (over) => ({ at: '2026-10-28 14:05', ask: 'a question', raw: 'a question', did: 'an answer', changed: [], ran: [], id: 'u-1', branch: 'main', cwd: 'C:\\proj', ...over });
const day = (at = '2026-10-28') => readFileSync(dayFile(dir, at), 'utf8');

{
  const e = entryOf(turn({ ask: 'q'.repeat(5000), did: 'h'.repeat(5000) + 't'.repeat(5000),
    changed: Array.from({ length: 30 }, (_, i) => `C:\\proj\\f${i}.js`), ran: Array.from({ length: 25 }, (_, i) => `cmd${i}`) }), T);
  ok(e.asked.length === 2000 && e.asked.endsWith('…'), `ask capped at 2000 (got ${e.asked.length})`);
  // A reply's end says what was done and why: a long one keeps both ends.
  ok(e.answered === 'h'.repeat(4000) + ' … ' + 't'.repeat(2000), `a reply over 6000 keeps its first 4000 and its last 2000 (got ${e.answered.length}: ${e.answered.slice(3995, 4010)})`);
  ok(entryOf(turn({ did: 'a'.repeat(6000) }), T).answered.length === 6000, 'a reply of 6000 is kept whole');
  ok(e.changed.length === 20 && e.changed[19] === 'f29.js' && e.changed[0] === 'f10.js', `last 20 files, relative to cwd (got ${e.changed[0]}..${e.changed[19]})`);
  ok(e.ran.length === 20 && e.ran[0] === 'cmd5' && e.ran[19] === 'cmd24', `last 20 commands (got ${e.ran})`);
  ok(entryOf(turn({ ran: ['x'.repeat(1000)] }), T).ran[0].length === 400, 'a command capped at 400');
  ok(e.s === '01234567' && e.t === 'C--proj/0123456789abcdef', `conversation tag and t from the path (got ${e.s} ${e.t})`);
  // Redacted before the cut, so no half of a key is left at either end; and
  // no half of an emoji, which reads back as U+FFFD and no longer matches.
  const k = stripe('sk', 'live'), at = (n, tail) => entryOf(turn({ did: 'x'.repeat(n) + ` ${k} ` + 'y'.repeat(tail) }), T).answered;
  for (const [n, tail] of [[3990, 5000], [5000, 1980]]) ok(![k.slice(0, 9), k.slice(-9)].some((p) => at(n, tail).includes(p)), `a key across a cut is redacted whole (got ${at(n, tail).slice(3985, 4030)})`);
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const head = entryOf(turn({ did: 'a'.repeat(3999) + '😀'.repeat(2000) }), T).answered, tail = entryOf(turn({ did: 'a'.repeat(7001) + '😀' + 'b'.repeat(1999) }), T).answered;
  ok(!lone.test(head) && !lone.test(tail), 'no half of an emoji at either cut');
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
  // The turn that ran forget: its listing, saved as the reply, held what it removed.
  const f = entryOf(turn({ ask: 'forget the zebra', did: 'these would go: the zebra policy', changed: ['C:\\proj\\a'],
    ran: ['node "C:/p/memory.mjs" forget zebra --session x', ...Array.from({ length: 20 }, (_, i) => `ls ${i}`)] }), T);
  ok(f.asked === '[private]' && f.answered === '[private]' && !f.changed.length && !f.ran.length,
    `a turn that ran forget, even before its last 20 commands, keeps none of its words (got ${JSON.stringify(f)})`);
  // Which commands are a forget: handoff-log's FORGETS, checked in its suite.
  ok(entryOf(turn({ ran: ['node memory.mjs search forget'] }), T).asked === 'a question', 'a turn that ran no forget is kept');
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
  const jm = join(dir, 'journal.md'), text = () => readFileSync(jm, 'utf8');
  ok(text().includes('description: "Every exchange in this project, one file per day in journal/; search it before saying something was never done or decided"\n') && /^  tier: hot$/m.test(text()), 'journal.md is a hot note');
  const mine = text().replace('Every exchange', 'My own words');
  writeFileSync(jm, mine);
  record(dir, T, [turn({ at: '2026-10-26 23:59', id: 'u-older' })]);
  ok(text() === mine, 'an existing journal.md is never rewritten, not even when an older day turns up');
  // A journal.md that cannot be written costs the pin, not the entry.
  const bad = storeFor(home, 'C:\\journal-nopin');
  mkdirSync(join(bad, 'journal.md'), { recursive: true });
  ok(record(bad, T, [turn()]) === 1 && readFileSync(dayFile(bad, '2026-10-28'), 'utf8').includes('a question'), 'a pin that fails does not fail the record');
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

{
  // Saved through a Markdown formatter (Prettier, markdownlint --fix): a blank
  // line after each marker and each heading. Read as prose, its words were out
  // of reach of search, forget and a sweep, and the next Stop wrote them twice.
  const f = dayFile(dir, '2026-11-10'), code = (t) => (t.match(/4417/g) || []).length;
  record(dir, T, [turn({ at: '2026-11-10 09:00', id: 'p-1', ask: 'the door code is 4417', raw: 'the door code is 4417' }), turn({ at: '2026-11-10 09:30', id: 'p-2' })]);
  writeFileSync(f, readFileSync(f, 'utf8').replace(/(-->\n)(## .*\n)/g, '$1\n$2\n'));
  const p = parseDay(readFileSync(f, 'utf8'));
  ok(p.prose === '' && p.entries.length === 2 && p.entries[0].asked === 'the door code is 4417' && p.entries[0].s === '01234567' && p.entries[1].answered === 'an answer',
    `a formatted day file parses to its entries, whole, and no prose (got ${JSON.stringify(p)})`);
  record(dir, T, [turn({ at: '2026-11-10 09:00', id: 'p-1', ask: 'the door code is 4417', raw: 'the door code is 4417' })]);
  ok(code(readFileSync(f, 'utf8')) === 1, 'the next record adds no second copy');
  forget(dir, ['4417'], { apply: true });
  ok(code(readFileSync(f, 'utf8')) === 0, 'and forget reaches it');
}
{
  // A note written under an entry stays under it, as the day is rewritten
  // around it, and goes up to the entry before when its own entry goes.
  const f = dayFile(dir, '2026-11-11'), put = (id, at, did) => turn({ id, at: `2026-11-11 ${at}`, ask: `deploy ${id}`, raw: `deploy ${id}`, did });
  record(dir, T, [put('n-1', '09:00', 'deployed'), put('n-2', '10:00', 'deployed to prod')]);
  writeFileSync(f, readFileSync(f, 'utf8').replace('# Journal 2026-11-11\n\n', '# Journal 2026-11-11\n\nOn top.\n\n')
    .replace('**Answered:** deployed\n', '**Answered:** deployed\nNOTE A: staging broke an hour later.\n\nrolled back by hand\n')
    .replace('**Answered:** deployed to prod', '**Answered:** deployed to prod\nNOTE B: this one was fine.'));
  record(dir, T, [put('n-0', '08:00', 'ready'), put('n-3', '11:00', 'changelog written'), put('n-2', '10:00', 'deployed to prod, checked')]);
  const t = readFileSync(f, 'utf8'), at = (s) => t.indexOf(s);
  ok(at('On top.') < at('j:n-0 ') && at('j:n-0 ') < at('j:n-1 ') && at('j:n-1 ') < at('NOTE A') && at('NOTE A') < at('rolled back by hand') && at('rolled back by hand') < at('j:n-2 ')
    && at('j:n-2 ') < at('NOTE B') && at('NOTE B') < at('j:n-3 ') && at('deployed to prod, checked') > 0, `each note stays under its entry (got ${t})`);
  ok(record(dir, T, [put('n-1', '09:00', 'deployed')]) === 0 && readFileSync(f, 'utf8') === t, 'and reads back as it was written');
  forget(dir, ['deploy n-1'], { apply: true });
  const u = readFileSync(f, 'utf8');
  ok(!u.includes('j:n-1 ') && u.indexOf('j:n-0 ') < u.indexOf('NOTE A') && u.indexOf('NOTE A') < u.indexOf('j:n-2 '), `a note whose entry goes stays, under the entry before (got ${u})`);
}

{
  // A note added in the Windows code page (PowerShell 5.1's Add-Content): read
  // as UTF-8 and written back, its accented letters were U+FFFD for good.
  const d = storeFor(home, 'C:\\journal-ansi'), f = dayFile(d, '2026-11-12'), failed = join(d, 'journal', '.failed'), P = '/x/projects/C--proj/aaaaaaaa.jsonl';
  record(d, T, [turn({ at: '2026-11-12 09:00', id: 'w-1', ask: 'the zebra', raw: 'the zebra' })]);
  record(d, P, [turn({ at: '2026-11-12 09:30', id: 'a-1' })]);
  appendFileSync(f, Buffer.from('\nNote: café supplier José confirmed\n', 'latin1'));
  const bytes = readFileSync(f), others = () => days(d).filter((x) => x !== '2026-11-12').map((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries.map((e) => e.key).join()).join();
  write(d, T, [turn({ at: '2026-11-11 10:00', id: 'w-0' }), turn({ at: '2026-11-12 10:00', id: 'w-2' }), turn({ at: '2026-11-13 10:00', id: 'w-3' })], { quiet: false, hush: false });
  let fl = ''; try { fl = readFileSync(failed, 'utf8'); } catch {}
  ok(readFileSync(f).equals(bytes) && others() === 'w-0,w-3' && fl.includes('2026-11-12.md') && summary(d).failed?.includes('not UTF-8'),
    `a day file not in UTF-8 is left as it is, the other days are written, and status says why (got ${others()}; ${fl})`);
  record(d, P, [turn({ at: '2026-11-11 11:00', id: 'w-4' })]);
  ok(throws(() => sweep(d, 'aaaaaaaa')) && others() === 'w-0,w-3' && readFileSync(f).equals(bytes), 'a sweep leaves it too, after the other days, and says so');
  const failedForget = [], r = forget(d, ['zebra'], { apply: true, failed: failedForget });
  ok(r.matched.length === 1 && !r.removed.length && readFileSync(f).equals(bytes) && failedForget.some((x) => x.path === f), `forget leaves it, and names it (got ${JSON.stringify(failedForget)})`);
}
{
  // A time that won't parse (a transcript another tool wrote) made the day file
  // NaN-NaN-Na.md, which nothing lists: no search, forget or sweep reached it.
  const d = storeFor(home, 'C:\\journal-nan'), now = local().slice(0, 10);
  record(d, T, [turn({ at: 'NaN-NaN-NaN NaN:NaN', id: 'nan-1' }), turn({ at: '12026-10-29 10:00', id: 'nan-2' })]);
  ok(days(d).join() === now && parseDay(readFileSync(dayFile(d, now), 'utf8')).entries.length === 2 && readFileSync(dayFile(d, now), 'utf8').includes(`d:${now} -->`),
    `a turn whose time won't parse is journaled on the day it was read (got ${days(d)})`);
}

// The sink: a conversation already private writes nothing; the Stop that marks
// it takes back what it wrote, from every day.
{
  write(dir, T, [turn({ at: '2026-10-31 09:00', id: 'q-1' })], { quiet: true, hush: false });
  ok(!days(dir).includes('2026-10-31'), 'a conversation already private writes no entry');
  const S = join(home, 'aaaaaaaa-0000-4000-8000-000000000000.jsonl'), O = '/x/projects/C--proj/bbbbbbbb.jsonl';
  record(dir, S, [turn({ at: '2026-11-05 10:00', id: 's-1' }), turn({ at: '2026-11-06 12:30', id: 's-2' })]);
  record(dir, O, [turn({ at: '2026-11-06 12:40', id: 'o-1' })]);
  const keys = (d) => parseDay(day(d)).entries.map((e) => e.key).join();
  const n = sweep(dir, 'aaaaaaaa');
  ok(n === 2 && keys('2026-11-06') === 'o-1' && !existsSync(dayFile(dir, '2026-11-05')) && !days(dir).includes('2026-11-05'),
    `the sweep takes the conversation's entries from every day, another's stay, and a day it leaves empty goes (got ${n}, ${keys('2026-11-06')}, ${days(dir)})`);
}

// --- the Stop hook, as Claude Code runs it -----------------------------------
const TIER = tool('memory-tier.mjs');
const scwd = 'C:\\journal-stop-selftest', proj = join(home, '.claude', 'projects', slug(scwd)), sdir = join(proj, 'memory');
mkdirSync(proj, { recursive: true });
const sid = (c) => `${c.repeat(8)}-0000-4000-8000-000000000000`;
const tp = (id) => join(proj, `${id}.jsonl`);
let uuid = 0;
const rec = (type, id, ts, text, cwd = scwd) => JSON.stringify({ type, uuid: `${id.slice(0, 8)}-${++uuid}`, sessionId: id, cwd, gitBranch: 'feat/journal', timestamp: ts,
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
  let off = ''; try { off = readFileSync(join(home, '.claude', 'projects', '.memory-off'), 'utf8'); } catch {}
  ok(!existsSync(sdir) && off.split(/\r?\n/).includes(X.slice(0, 8)),
    `auto memory off writes no journal and makes no store, only the conversation's tag beside the projects (got ${JSON.stringify(off)})`);
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
  // Resumed with auto memory on, a conversation once held with it off is still
  // not journaled: its first Stop with memory on journaled every turn of it.
  const failed = join(sdir, 'journal', '.failed');
  writeFileSync(failed, '{"at":"2026-10-28T09:00:00Z","error":"left alone"}');
  say(X, '2026-10-28T10:01:00Z', 'asked with memory back on', 'answered');
  stop(X);
  ok(!of(X).length && readFileSync(failed, 'utf8').includes('left alone'),
    `a conversation once held with auto memory off writes no entry once memory is on, and clears no failure (got ${JSON.stringify(of(X))})`);
  rmSync(failed);
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
  // Begun in New York at 20:30, marked private once the laptop said Berlin:
  // there the conversation began a day later, and its first day was kept.
  const Z = sid('z'), zone = (tz, f) => { process.env.TZ = tz; try { return f(); } finally { delete process.env.TZ; } };
  say(Z, '2026-10-29T00:30:00Z', 'the biopsy came back', 'next: a referral');
  zone('America/New_York', () => stop(Z));
  const was = of(Z).length;
  say(Z, '2026-10-29T02:00:00Z', '<private-session> from here on', 'understood');
  zone('Europe/Berlin', () => stop(Z));
  ok(was === 1 && !of(Z).length, `a mark typed after a time-zone change takes back the conversation's first day too (got ${was}, ${JSON.stringify(of(Z))})`);
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
if (!quick) {
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
{
  // A <private-session> mark further back than the Stop's read: the turn that
  // typed it got no Stop (Escape, an API error), and 600 KB of a tool's output
  // came after it. The next Stop looks at the whole transcript, once, and
  // journals nothing; nor is the turn written to handoff.md (P1 hunt, 2026-10-29).
  const P = sid('p');
  say(P, '2026-10-28T12:00:00Z', '<private-session> read the payroll export');
  appendFileSync(tp(P), JSON.stringify({ type: 'user', uuid: 'p-big', sessionId: P, cwd: scwd, timestamp: '2026-10-28T12:00:30Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(600_000) }] } }) + '\n');
  say(P, '2026-10-28T12:01:00Z', 'so what is Alice Smith salary', 'Alice Smith earns 184,000');
  // What an import wrote of it before goes too.
  record(sdir, tp(P), [turn({ at: '2026-10-28 11:00', id: 'p-imported' })]);
  stop(P);
  let tags = ''; try { tags = readFileSync(join(sdir, '.private-sessions'), 'utf8'); } catch {}
  ok(!of(P).length && tags.split(/\r?\n/).includes(P.slice(0, 8)) && !readFileSync(join(sdir, 'handoff.md'), 'utf8').includes('Alice'),
    `a mark further back than the Stop's read keeps the conversation out of the journal and handoff.md (got ${JSON.stringify(of(P))}; ${JSON.stringify(tags)})`);
}
{
  // Marked by a writer that took nothing back (the compaction gate's handoff
  // has no journal sink), and its next Stop's read short of the mark: what it
  // wrote before goes all the same (P1 hunt, 2026-10-29).
  const Q = sid('q'), failed = join(sdir, 'journal', '.failed');
  say(Q, '2026-10-28T13:00:00Z', 'the root password policy', 'rotate monthly');
  stop(Q);
  const was = of(Q).length;
  appendFileSync(join(sdir, '.private-sessions'), `${Q.slice(0, 8)}\n`);
  say(Q, '2026-10-28T13:05:00Z', 'ok next thing', 'sure');
  stop(Q);
  ok(was === 1 && !of(Q).length, `a conversation marked by a writer that took nothing back loses its entries at its next Stop (got ${was}, ${of(Q).length})`);
  // Once: a later Stop reads no day for it (one that won't read would fail it).
  const bad = dayFile(sdir, '2026-11-20');
  mkdirSync(bad, { recursive: true });
  say(Q, '2026-10-28T13:10:00Z', 'and another', 'fine');
  stop(Q);
  ok(!existsSync(failed), `a conversation swept once is not swept at every Stop (got ${existsSync(failed) ? readFileSync(failed, 'utf8') : ''})`);
  rmSync(bad, { recursive: true });
}

// --- backfill: the conversations still on disk, a few a Stop -----------------
const projects = join(home, '.claude', 'projects');
const ago = (h) => (Date.now() - h * 3600e3) / 1000;   // utimes takes seconds
// A conversation last written `h` hours ago, in Claude Code's folder for `cwd`.
function old(cwd, id, h, asks) {
  const p = join(projects, slug(cwd), `${id}.jsonl`);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, asks.map((a, i) => [rec('user', id, `2026-09-01T10:0${i}:00Z`, a, cwd), rec('assistant', id, `2026-09-01T10:0${i}:30Z`, `${a}: done`, cwd)].join('\n')).join('\n') + '\n');
  utimesSync(p, ago(h), ago(h));
  return p;
}
// A repository (as storeOf finds one) and its store.
const repo = (name) => {
  const r = join(home, 'work', name), d = join(projects, slug(r), 'memory');
  mkdirSync(join(r, '.git'), { recursive: true }); mkdirSync(d, { recursive: true });
  return [r, d];
};
const asks = (d) => days(d).flatMap((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries).map((e) => e.asked).sort();
const listed = (d) => readFileSync(join(d, 'journal', '.imported'), 'utf8').split('\n').filter(Boolean);
// Time enough for every import: under six suites at once, 150 ms took two of three.
const fill = (d, o) => withLock(d, () => backfill(d, { budgetMs: 60e3, ...o }));
// The store's transcripts are looked at once in half an hour, by the time the last look wrote.
const looked = (d, ms) => writeFileSync(join(d, 'journal', '.looked'), String(ms));
const due = (d) => looked(d, Date.now() - 3600e3);
{
  const [r, d] = repo('bf');
  const b = old(r, sid('b'), 40, ['b1']);
  old(r, sid('a'), 50, ['a1', 'a2']); old(r, sid('c'), 30, ['c1']); old(join(r, 'web'), sid('e'), 20, ['e1']);
  old(r, sid('f'), 0, ['f1']);
  const one = fill(d, { budgetMs: 0 });
  ok(one.imported === 1 && one.left === 3 && asks(d).join() === 'a1,a2', `out of time, a Stop still imports one conversation, the oldest (got ${JSON.stringify(one)}, ${asks(d)})`);
  for (let i = 0; i < 5 && fill(d).left; i++);
  ok(asks(d).join() === 'a1,a2,b1,c1,e1' && listed(d).length === 4,
    `backfill imports old transcripts once: every quiet conversation, a subfolder's too, none still running, one line each (got ${asks(d)}; ${listed(d).length} lines)`);
  const text = () => days(d).map((x) => readFileSync(dayFile(d, x), 'utf8')).join() + listed(d).join();
  due(d);
  const before = text(), again = fill(d);
  ok(again.imported === 0 && again.left === 0 && text() === before, `one more Stop changes nothing (got ${JSON.stringify(again)})`);

  // Grown since its import: read again once quiet, never while running, never
  // for the Stop it is the transcript of, and not before the list is due.
  appendFileSync(b, rec('user', sid('b'), '2026-09-02T10:00:00Z', 'b2', r) + '\n' + rec('assistant', sid('b'), '2026-09-02T10:00:30Z', 'b2: done', r) + '\n');
  due(d);
  ok(fill(d).imported === 0 && !asks(d).includes('b2'), 'a grown transcript still running is left to its own Stop');
  utimesSync(b, ago(1), ago(1));
  ok(fill(d).imported === 0 && !asks(d).includes('b2'), 'between looks, a listed transcript is not looked at');
  due(d);
  ok(fill(d, { skip: b }).imported === 0 && !asks(d).includes('b2'), "nor read again for the Stop it is the transcript of");
  due(d);
  const grown = fill(d);
  ok(grown.imported === 1 && asks(d).includes('b2') && listed(d).length === 4 && listed(d).includes(`${slug(r)}/${sid('b')} ${statSync(b).size}`),
    `quiet again, its new turns are journaled and its one line updated (got ${JSON.stringify(grown)}, ${listed(d)})`);

  // Between looks not even a new conversation is looked at. A look drops the
  // line of a transcript gone from disk (Claude Code deletes them after a month).
  old(r, sid('g'), 5, ['g1']);
  rmSync(join(projects, slug(join(r, 'web')), `${sid('e')}.jsonl`));
  ok(fill(d).imported === 0 && !asks(d).includes('g1'), 'between looks, not even a new conversation is looked at');
  due(d);
  const look = fill(d);
  ok(look.imported === 1 && asks(d).includes('g1') && asks(d).includes('e1') && listed(d).length === 4 && !listed(d).some((l) => l.includes(sid('e'))),
    `the next look imports it, and drops the line of the transcript gone, not its entries (got ${JSON.stringify(look)}, ${listed(d)})`);
  // A folder that won't list (here a file by a subfolder's name) prunes nothing.
  const broken = join(projects, `${slug(r)}-broken`), lines = listed(d).join();
  writeFileSync(broken, '');
  rmSync(join(projects, slug(r), `${sid('g')}.jsonl`));
  due(d); fill(d);
  ok(listed(d).join() === lines, `a look whose listing failed drops no line (got ${listed(d)})`);
  rmSync(broken);
}
{
  // Between looks the list is not even read: its length costs an idle Stop nothing.
  const [r, d] = repo('idle'), list = join(d, 'journal', '.imported'), failed = join(d, 'journal', '.failed');
  old(r, sid('a'), 30, ['idle']);
  mkdirSync(list, { recursive: true });   // a list no read can take
  looked(d, Date.now());
  const idle = fill(d);
  ok(idle.imported === 0 && !existsSync(failed), `between looks the list is not read at all (got ${JSON.stringify(idle)})`);
  due(d); fill(d);
  ok(existsSync(failed), 'a look reads it (and here fails on it, and says so)');
}
{
  const [r, d] = repo('kill');
  const ps = ['a', 'b', 'c', 'e'].map((c, i) => old(r, sid(c), 40 - i, [`k${c}`]));
  mkdirSync(join(d, 'journal'));
  // A pass killed after its first import: the list it wrote is no look, and
  // the next Stop goes on (by the list's mtime, it waited half an hour).
  writeFileSync(join(d, 'journal', '.imported'), `${slug(r)}/${sid('a')} ${statSync(ps[0]).size}\n`);
  const got = fill(d);
  ok(got.imported === 3 && asks(d).join() === 'kb,kc,ke' && listed(d).length === 4, `backfill resumes after a kill, at the next Stop: only the other three are imported (got ${JSON.stringify(got)}, ${asks(d)})`);
}
{
  // A clock set back after a look (a VM restored, NTP) dated the look ahead,
  // and no Stop imported until real time caught up; a transcript too.
  const [r, d] = repo('ahead'), p = old(r, sid('a'), 30, ['written ahead']);
  mkdirSync(join(d, 'journal'));
  looked(d, Date.now() + 3 * 86400e3);
  utimesSync(p, (Date.now() + 3 * 86400e3) / 1000, (Date.now() + 3 * 86400e3) / 1000);
  ok(fill(d).imported === 1 && asks(d).join() === 'written ahead', `a look or a transcript dated ahead is no reason to wait (got ${asks(d)})`);
  old(r, sid('b'), 30, ['after a garbled look']);
  writeFileSync(join(d, 'journal', '.looked'), 'not a time');
  ok(fill(d).imported === 1, 'a look time that will not read is no look');
}
{
  // Out of time, a Stop tells no more transcripts' store (a read of each one's
  // head: ~1 s for a home folder's month) than it imports.
  const [r, d] = repo('lazy');
  old(r, sid('a'), 30, ['ours']);
  for (const c of ['b', 'c', 'e']) old(`${r}-x${c}`, sid(c), 20, ['theirs']);
  const one = fill(d, { budgetMs: 0 });
  ok(one.imported === 1 && one.left === 3 && listed(d).length === 1 && summary(d).left === 0, `out of time, the other heads wait for the next Stop; status counts none of them as left (got ${JSON.stringify(one)}, ${listed(d)}, ${summary(d).left})`);
  const rest = fill(d);
  ok(rest.imported === 0 && rest.left === 0 && listed(d).filter((l) => l.endsWith(' other')).length === 3 && asks(d).join() === 'ours', `which the next reads (got ${JSON.stringify(rest)}, ${listed(d)})`);
}
{
  // A transcript that won't read (EACCES: one a `sudo claude` run left owned by
  // root) is listed as failed, with its size, and read again only once it
  // grows: retried at every look, it failed at every look.
  const [r, d] = repo('unread'), p = old(r, sid('u'), 2, ['readable at last']), open = fs.openSync;
  const line = () => listed(d).find((l) => l.startsWith(`${slug(r)}/${sid('u')} `)) ?? '';
  fs.openSync = (q, ...a) => { if (q === p) throw Object.assign(new Error(`EACCES: permission denied, open '${q}'`), { code: 'EACCES' }); return open(q, ...a); };
  syncBuiltinESMExports();
  let first, again;
  try { first = fill(d); due(d); again = fill(d); } finally { fs.openSync = open; syncBuiltinESMExports(); }
  ok(first.imported === 0 && line() === `${slug(r)}/${sid('u')} ${statSync(p).size} failed`, `it is listed as failed, with its size (got ${JSON.stringify(first)}, ${line()})`);
  ok(again.left === 0 && summary(d).left === 0 && summary(d).failed?.startsWith('backfill: EACCES'), `the next look leaves it, and status still names the failure (got ${JSON.stringify(again)}, ${summary(d).failed})`);
  appendFileSync(p, rec('user', sid('u'), '2026-09-02T10:00:00Z', 'one more', r) + '\n' + rec('assistant', sid('u'), '2026-09-02T10:00:30Z', 'done', r) + '\n');
  utimesSync(p, ago(2), ago(2)); due(d);
  ok(fill(d).imported === 1 && asks(d).join() === 'one more,readable at last' && !line().endsWith(' failed'), `grown, it is read again (got ${asks(d)}, ${line()})`);
}
{
  const [r, d] = repo('hush');
  old(r, sid('a'), 30, ['marked private']); old(r, sid('b'), 20, ['<private-session> from here on']); old(r, sid('c'), 10, ['an open one']);
  writeFileSync(join(d, '.private-sessions'), `${sid('a').slice(0, 8)}\n`);
  fill(d);
  ok(asks(d).join() === 'an open one', `backfill skips a private conversation, in the list or marked in its transcript (got ${asks(d)})`);
}
{
  // A <private-session> typed while the plugin was off: the import that reads it
  // marks the conversation and takes back what it wrote, as its Stop would have.
  const [r, d] = repo('late'), L = sid('l'), p = old(r, L, 30, ['said before the mark']);
  record(d, p, [turn({ at: '2026-09-01 12:00', id: 'l-live' })]);
  // And its entries in handoff.md, through handoff's own removal; another's stay.
  writeFileSync(join(d, 'handoff.md'), `---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** 2026-09-01 12:00 [${L.slice(0, 8)}]: said before the mark\n  **did:** noted\n`
    + '- **asked** 2026-09-01 12:05 [kkkkkkkk]: another conversation\n  **did:** kept\n<!-- auto:end -->\n');
  appendFileSync(p, rec('user', L, '2026-09-01T10:05:00Z', '<private-session> from here on', r) + '\n');
  utimesSync(p, ago(1), ago(1));
  const before = asks(d).join();
  fill(d);
  let tags = ''; try { tags = readFileSync(join(d, '.private-sessions'), 'utf8'); } catch {}
  ok(before === 'a question' && !asks(d).length && tags.split(/\r?\n/).includes(L.slice(0, 8)),
    `a mark the backfill finds removes the conversation's earlier entries and marks it (got ${before}; ${asks(d)}; ${JSON.stringify(tags)})`);
  const hd = readFileSync(join(d, 'handoff.md'), 'utf8');
  ok(!hd.includes('said before the mark') && hd.includes('another conversation'), `and takes its entries out of handoff.md, no other's (got ${hd})`);
}
{
  // A worktree outside the repository's folder: Claude Code keeps its
  // conversations in a folder named for the worktree, which storeOf maps to the
  // repository's store. Once a live Stop records one there, the import looks in
  // that folder too: 27 of one machine's transcripts were never imported (R30).
  const [r, d] = repo('wtmain'), w = join(home, 'trees', 'feature'), gd = join(r, '.git', 'worktrees', 'feature'), V = sid('v');
  mkdirSync(gd, { recursive: true }); mkdirSync(w, { recursive: true });
  writeFileSync(join(w, '.git'), `gitdir: ${gd}\n`); writeFileSync(join(gd, 'commondir'), '../..\n'); writeFileSync(join(gd, 'gitdir'), join(w, '.git') + '\n');
  old(w, sid('x'), 30, ['asked in the worktree']);
  fill(d);
  const before = asks(d).join(), live = join(projects, slug(w), `${V}.jsonl`);
  writeFileSync(live, rec('user', V, '2026-10-28T09:00:00Z', 'live in the worktree', w) + '\n' + rec('assistant', V, '2026-10-28T09:00:30Z', 'ok', w) + '\n');
  spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: w, transcript_path: live, session_id: V, hook_event_name: 'Stop' }) });
  due(d); fill(d);
  ok(before === '' && asks(d).join() === 'asked in the worktree,live in the worktree', `a worktree's folder is imported from once a live Stop records there (got ${before}; ${asks(d)})`);
}
{
  // The conversations a live Stop looked at whole lose their line once their
  // transcript is gone, as the import's list does.
  const [r, d] = repo('checked'), list = join(d, 'journal', '.checked');
  old(r, sid('a'), 30, ['still here']);
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(list, `${slug(r)}/${sid('a')} 10\n${slug(r)}/${sid('z')} 10 swept\n`);
  fill(d);
  ok(readFileSync(list, 'utf8') === `${slug(r)}/${sid('a')} 10\n`, `a look drops the line of a looked-at conversation gone from disk (got ${JSON.stringify(readFileSync(list, 'utf8'))})`);
}
{
  // Imported before its memory-off tag (a start the tag missed), a
  // conversation loses what was imported at its next Stop (P1 hunt, 2026-10-29).
  const [r, d] = repo('lateoff'), id = sid('o'), p = old(r, id, 30, ['my diagnosis came back']);
  fill(d);
  const was = asks(d).join();
  appendFileSync(join(projects, '.memory-off'), `${id.slice(0, 8)}\n`);
  appendFileSync(p, rec('user', id, '2026-09-02T10:00:00Z', 'and the note to HR', r) + '\n' + rec('assistant', id, '2026-09-02T10:00:30Z', 'drafted', r) + '\n');
  spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: r, transcript_path: p, session_id: id, hook_event_name: 'Stop' }) });
  ok(was === 'my diagnosis came back' && !asks(d).length, `a late memory-off tag takes back what an import wrote (got ${was}; ${asks(d)})`);
}
{
  const [r, d] = repo('mine');
  old(r, sid('a'), 30, ['ours']);
  // A folder named like a subfolder's, of a project beside this one; and one
  // named like nothing of this project's.
  const theirs = old(`${r}-other`, sid('b'), 20, ['theirs']);
  old(join(home, 'work', 'far'), sid('c'), 10, ['far']);
  fill(d);
  ok(asks(d).join() === 'ours', `another store's transcript is never imported (got ${asks(d)})`);
  ok(listed(d).length === 2 && listed(d).includes(`${slug(r)}-other/${sid('b')} ${statSync(theirs).size} other`),
    `it is listed as another's, so no Stop opens it again, and no other project's folder is looked in (got ${listed(d)})`);
}
{
  const [r, d] = repo('off'), held = old(r, sid('6'), 30, ['held with memory off']);
  old(r, sid('7'), 20, ['held with memory on']);
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: r, transcript_path: held, session_id: sid('6'), hook_event_name: 'Stop' }) }); }
  finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  fill(d);
  ok(asks(d).join() === 'held with memory on', `a conversation held with auto memory off is never imported, and another is (got ${asks(d)})`);
}
{
  const [r, d] = repo('fails'), day1 = dayFile(d, local('2026-09-01T10:00:00Z')), failed = join(d, 'journal', '.failed');
  old(r, sid('8'), 30, ['imported at last']);
  mkdirSync(day1, { recursive: true });
  const got = fill(d);
  let fl = null; try { fl = JSON.parse(readFileSync(failed, 'utf8')); } catch {}
  ok(got.imported === 0 && got.left === 1 && Date.parse(fl?.at) && fl.error.startsWith('backfill: '),
    `a backfill that throws is kept in .failed, the conversation left for later (got ${JSON.stringify(got)}, ${JSON.stringify(fl)})`);
  // The live write and the backfill each clear and replace their own line only:
  // the next reply cleared a backfill that kept failing, and status said nothing.
  const lines = () => { try { return readFileSync(failed, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  write(d, T, [turn({ at: '2026-10-28 09:00', id: 'live-1' })], { quiet: false, hush: false });
  ok(lines().length === 1 && lines()[0].includes('"error":"backfill: '), `a live write that goes through keeps the backfill's failure (got ${lines()})`);
  const day2 = dayFile(d, '2026-10-27');
  mkdirSync(day2, { recursive: true });
  write(d, T, [turn({ at: '2026-10-27 09:00', id: 'live-2' })], { quiet: false, hush: false });
  ok(lines().length === 2 && !lines()[0].includes('backfill: ') && lines()[1].includes('"error":"backfill: ') && /^EISDIR.*; backfill: /.test(summary(d).failed),
    `a live write's failure keeps the backfill's, newest first, and status names both (got ${lines()}; ${summary(d).failed})`);
  rmSync(day1, { recursive: true });
  ok(fill(d).imported === 0, 'a failed look waits for the next look, not the next Stop');
  due(d);
  ok(fill(d).imported === 1 && lines().length === 1 && !lines()[0].includes('backfill: '), `the next import that goes through clears its own failure, not the live write's (got ${lines()})`);
  rmSync(day2, { recursive: true });
  write(d, T, [turn({ at: '2026-10-27 09:00', id: 'live-2' })], { quiet: false, hush: false });
  ok(!existsSync(failed) && asks(d).join() === 'a question,a question,imported at last', `and the next live write that goes through clears the rest (got ${asks(d)})`);
  writeFileSync(failed, JSON.stringify({ at: new Date().toISOString(), error: 'the live write failed' }));
  old(r, sid('9'), 10, ['one more']);
  due(d);
  ok(fill(d).imported === 1 && existsSync(failed), "an import clears its own failure only, never the live write's");
}
{
  // Imported, a turn whose time won't parse takes its transcript's: the day it was last written.
  const [r, d] = repo('nan'), p = join(projects, slug(r), `${sid('n')}.jsonl`);
  writeFileSync(p, rec('user', sid('n'), '2026-10-29 garbage', 'asked at no time', r) + '\n' + rec('assistant', sid('n'), '2026-10-29 garbage', 'answered', r) + '\n');
  utimesSync(p, ago(50), ago(50));
  fill(d);
  const was = local(Date.now() - 50 * 3600e3).slice(0, 10);
  ok(days(d).join() === was && asks(d).join() === 'asked at no time', `an imported turn whose time won't parse is journaled on its transcript's day (got ${days(d)}, want ${was})`);
}
// The Stop, as Claude Code runs it, on a conversation with a 70 MB tool result.
if (!quick) {
  const [r, d] = repo('huge'), H = sid('h'), S = sid('s'), p = join(projects, slug(r), `${H}.jsonl`), ps = join(projects, slug(r), `${S}.jsonl`);
  const [pre, post] = JSON.stringify({ type: 'user', uuid: 'h-big', sessionId: H, cwd: r, timestamp: '2026-09-03T10:01:00Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '@' }] } }).split('@');
  writeFileSync(p, rec('user', H, '2026-09-03T10:00:00Z', 'before the flood', r) + '\n' + pre);
  const mb = 'x'.repeat(1 << 20);
  for (let i = 0; i < 70; i++) appendFileSync(p, mb);
  appendFileSync(p, post + '\n' + rec('assistant', H, '2026-09-03T10:02:00Z', 'read it', r) + '\n'
    + rec('user', H, '2026-09-03T10:03:00Z', 'after the flood', r) + '\n' + rec('assistant', H, '2026-09-03T10:03:30Z', 'calm', r) + '\n');
  utimesSync(p, ago(2), ago(2));
  writeFileSync(ps, rec('user', S, '2026-10-28T12:00:00Z', 'now', r) + '\n' + rec('assistant', S, '2026-10-28T12:00:30Z', 'ok', r) + '\n');
  const t0 = Date.now();
  const out = spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: r, transcript_path: ps, session_id: S, hook_event_name: 'Stop' }), encoding: 'utf8' });
  const ms = Date.now() - t0, line = listed(d).find((l) => l.startsWith(`${slug(r)}/${H} `)) ?? '';
  ok(ms < 3000 && out.stdout === '' && line === `${slug(r)}/${H} ${statSync(p).size}` && asks(d).includes('before the flood') && asks(d).includes('after the flood'),
    `backfill keeps to its budget on a huge transcript: the Stop takes ${ms} ms, says nothing, passes over the 70 MB line unread and journals the turns before and after it (got ${line}; ${asks(d)}; ${out.stdout})`);
}
// A transcript of any size is read whole, not only its last 64 MB: in
// segments (1 KB here for 64 MB), each cut at a prompt so no exchange is
// split, a segment past the budget a Stop, the next look going on from where
// the last stopped. An exchange longer than a segment is read in several.
const exchange = (id, r, i, reply = `answer ${i} ${'z'.repeat(100)}`) => {
  const at = (s) => `2026-09-01T10:${String(i).padStart(2, '0')}:${s}Z`;
  return rec('user', id, at('00'), `question ${i}`, r) + '\n' + rec('assistant', id, at('30'), reply, r) + '\n';
};
const small = { segment: 1024, budgetMs: 0 };
{
  const [r, d] = repo('whole'), W = sid('w'), p = join(projects, slug(r), `${W}.jsonl`);
  const tool = (c) => JSON.stringify({ type: 'assistant', uuid: `w-t${c}`, sessionId: W, cwd: r, timestamp: '2026-09-01T10:05:10Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `ls ${c} ${'q'.repeat(150)}` } }] } }) + '\n';
  // Exchange 5 is longer than a segment: four commands, then its reply.
  writeFileSync(p, Array.from({ length: 12 }, (_, i) => i === 5 ? exchange(W, r, 5, 'a first look').replace(/\n$/, '\n' + [1, 2, 3, 4].map(tool).join('')) + rec('assistant', W, '2026-09-01T10:05:50Z', 'the final word', r) + '\n' : exchange(W, r, i)).join(''));
  utimesSync(p, ago(2), ago(2));
  const line = () => listed(d).find((l) => l.startsWith(`${slug(r)}/${W} `)) ?? '';
  const one = fill(d, small);
  ok(one.imported === 1 && one.left === 1 && new RegExp(` ${statSync(p).size} at \\d+$`).test(line()) && asks(d)[0] === 'question 0' && asks(d).length < 12,
    `out of time after a segment: its first exchange is journaled, and the list says where the next segment starts (got ${JSON.stringify(one)}, ${line()}, ${asks(d)})`);
  for (let i = 0; i < 40 && fill(d, small).left; i++);
  const es = days(d).flatMap((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries), five = es.find((e) => e.asked === 'question 5');
  ok(es.length === 12 && es.every((e) => e === five || e.answered.startsWith(`answer ${e.asked.split(' ')[1]} `)) && line() === `${slug(r)}/${W} ${statSync(p).size}`,
    `Stop by Stop, every exchange is journaled whole, and the list says the transcript is read (got ${es.map((e) => `${e.asked}: ${e.answered.slice(0, 9)}`)}; ${line()})`);
  ok(five?.answered === 'the final word' && five.ran.length === 4 && five.ran.every((c, k) => c.startsWith(`ls ${k + 1} `)),
    `an exchange longer than a segment keeps its last reply and every command, from every part (got ${JSON.stringify(five)})`);
}
{
  // A <private-session> mark anywhere is found before anything of the
  // conversation is recorded: in its first segment only (out of the last
  // 64 MB, the tail read never saw it), or in its last, segments after the first.
  for (const [where, c, at] of [['first', 'm', 1], ['last', 'n', 11]]) {
    const [r, d] = repo(`mark-${where}`), M = sid(c), p = join(projects, slug(r), `${M}.jsonl`);
    const xs = Array.from({ length: 12 }, (_, i) => exchange(M, r, i));
    xs.splice(at, 0, rec('user', M, '2026-09-01T10:30:00Z', '<private-session> from here on', r) + '\n');
    writeFileSync(p, xs.join('')); utimesSync(p, ago(2), ago(2));
    record(d, p, [turn({ at: '2026-09-01 08:00', id: `${c}-live` })]);
    for (let i = 0; i < 40 && fill(d, small).left; i++);
    let tags = ''; try { tags = readFileSync(join(d, '.private-sessions'), 'utf8'); } catch {}
    ok(!asks(d).length && tags.split(/\r?\n/).includes(M.slice(0, 8)), `a mark in the ${where} segment keeps the whole conversation out, and takes back what it wrote (got ${asks(d)})`);
  }
}
{
  // One look imports a bounded number of turns, the rest at the next: a
  // transcript of 49,053 short turns held the store's lock 18 s, and a
  // parallel session's handoff was skipped (P1 hunt, 2026-10-29).
  const [r, d] = repo('many'), Y = sid('y'), p = join(projects, slug(r), `${Y}.jsonl`), few = { turns: 5, budgetMs: 0 };
  writeFileSync(p, Array.from({ length: 12 }, (_, i) => exchange(Y, r, i)).join(''));
  utimesSync(p, ago(2), ago(2));
  const one = fill(d, few), line = () => listed(d).find((l) => l.startsWith(`${slug(r)}/${Y} `)) ?? '';
  ok(one.imported === 1 && one.left === 1 && asks(d).length === 5 && / at \d+$/.test(line()), `a look imports at most its turns, and says where the rest start (got ${JSON.stringify(one)}, ${asks(d).length}, ${line()})`);
  for (let i = 0; i < 10 && fill(d, few).left; i++);
  const es = days(d).flatMap((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries);
  ok(es.length === 12 && es.every((e) => e.answered.startsWith(`answer ${e.asked.split(' ')[1]} `)) && line() === `${slug(r)}/${Y} ${statSync(p).size}`,
    `look by look, every turn is imported whole, once (got ${es.length}; ${line()})`);
}

// entries(): the days in range, both bounds inclusive ("what did we do on the
// 10th" is since = until); a day outside is never opened, one inside that
// will not read is named and the rest still come back.
{
  const d = storeFor(home, 'C:\\entries-selftest');
  mkdirSync(join(d, 'journal'), { recursive: true });
  for (const at of ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']) writeFileSync(dayFile(d, at), `# Journal ${at}\n\n${render(entryOf(turn({ at: `${at} 09:00`, id: at }), T))}\n`);
  mkdirSync(dayFile(d, '2026-10-08'));   // a day file that cannot be read
  const of = (range) => { const failed = []; return entries([d], { ...range, failed }).map((e) => e.day).join() + (failed.length ? ` failed ${failed.map((f) => f.path).join()}` : ''); };
  ok(of({ since: '2026-10-10', until: '2026-10-10' }) === '2026-10-10', `a single day, since = until (got ${of({ since: '2026-10-10', until: '2026-10-10' })})`);
  ok(of({ since: '2026-10-10', until: '2026-10-11' }) === '2026-10-10,2026-10-11', `both bounds kept, the day just outside each left out (got ${of({ since: '2026-10-10', until: '2026-10-11' })})`);
  ok(of({ since: '2026-10-09' }) === '2026-10-09,2026-10-10,2026-10-11,2026-10-12', `a day outside the range is never opened (got ${of({ since: '2026-10-09' })})`);
  ok(of({ until: '2026-10-09' }) === `2026-10-09 failed ${dayFile(d, '2026-10-08')}`, `a day inside it that will not read is named, the rest kept (got ${of({ until: '2026-10-09' })})`);
  const e = entries([d], { since: '2026-10-12' })[0];
  ok(e.day === '2026-10-12' && e.path === dayFile(d, '2026-10-12') && e.dir === d && e.asked === 'a question', `an entry carries its day, file and store (got ${JSON.stringify(e)})`);
}

{
  // status and the briefing tell a day with an entry by its marker line, not by
  // parsing every day (status read a year of them, ~30 MB, each time): a day
  // file of its heading alone, or of a note alone, is no day.
  const d = storeFor(home, 'C:\\journal-summary');
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(dayFile(d, '2026-10-01'), '# Journal 2026-10-01\n');
  writeFileSync(dayFile(d, '2026-10-02'), '# Journal 2026-10-02\n\nOnly a note.\n');
  record(d, T, [turn({ at: '2026-10-03 09:00', id: 's-1' }), turn({ at: '2026-10-03 10:00', id: 's-2' })]);
  writeFileSync(dayFile(d, '2026-10-04'), readFileSync(dayFile(d, '2026-10-03'), 'utf8').replace(/\n/g, '\r\n').replaceAll('2026-10-03', '2026-10-04'));
  const s = summary(d), size = statSync(dayFile(d, '2026-10-03')).size + statSync(dayFile(d, '2026-10-04')).size;
  ok(s.first === '2026-10-03' && s.days === 2 && s.bytes === size && firstDay(d) === '2026-10-03', `only days with an entry count, a CRLF one too (got ${JSON.stringify(s)}, ${firstDay(d)})`);
}

// forget(): every term in one of an entry's fields, in any case, within the
// dates; nothing goes without apply. What went stays gone: recorded again, or
// read again by a backfill, a forgotten entry is not brought back.
{
  const d = storeFor(home, 'C:\\forget-selftest'), O = '/x/projects/C--proj/bbbbbbbb.jsonl', list = join(d, 'journal', '.forgotten');
  const put = (at, id, ask, t = T) => record(d, t, [turn({ at, id, ask, raw: ask })]);
  put('2026-10-20 09:00', 'f-1', 'the Zebra eats mango'); put('2026-10-20 09:05', 'f-2', 'the zebra policy');
  put('2026-10-21 09:00', 'f-3', 'mango again'); put('2026-10-21 10:00', 'f-4', 'mango elsewhere', O);
  const f20 = dayFile(d, '2026-10-20');
  writeFileSync(f20, readFileSync(f20, 'utf8').replace('# Journal 2026-10-20\n\n', '# Journal 2026-10-20\n\nMy own note.\n\n'));
  const text = () => days(d).map((x) => readFileSync(dayFile(d, x), 'utf8')).join('\0'), before = text();
  const hits = (terms, o) => forget(d, terms, o).matched.map((e) => e.key).join();
  ok(hits(['ZEBRA', 'mango']) === 'f-1', `every term must match, in any case (got ${hits(['ZEBRA', 'mango'])})`);
  ok(hits(['mango'], { since: '2026-10-21' }) === 'f-3,f-4' && hits(['mango'], { until: '2026-10-20' }) === 'f-1',
    `only entries within the dates match (got ${hits(['mango'], { since: '2026-10-21' })}; ${hits(['mango'], { until: '2026-10-20' })})`);
  ok(hits([], { conversation: 'bbbbbbbb' }) === 'f-4', `--conversation alone matches that conversation's entries (got ${hits([], { conversation: 'bbbbbbbb' })})`);
  ok(hits([], { keys: ['f-2'] }) === 'f-2' && hits(['mango'], { keys: ['f-2', 'f-3'] }) === 'f-3', `keys pick those entries, with the other filters (got ${hits([], { keys: ['f-2'] })}; ${hits(['mango'], { keys: ['f-2', 'f-3'] })})`);
  ok(text() === before && !existsSync(list), 'without apply nothing goes');
  mkdirSync(join(d, '.lock'));   // another hook's; waited out on a fast clock under --mutant
  const busy = (quick ? fastClock : (f) => f())(() => forget(d, ['mango'], { apply: true }));
  rmSync(join(d, '.lock'), { recursive: true });
  ok(busy === null && text() === before && !existsSync(list), `while another holds the store's lock, nothing goes (got ${JSON.stringify(busy)})`);
  const r = forget(d, ['mango'], { until: '2026-10-20', apply: true });
  ok(r.removed.map((e) => e.key).join() === 'f-1' && hits(['zebra']) === 'f-2' && readFileSync(f20, 'utf8').includes('My own note.'), `with apply the matches go, and a note written by hand stays (got ${r.removed}, ${hits(['zebra'])})`);
  writeFileSync(list, readFileSync(list, 'utf8').replace(/\n/g, ' \r\n'));   // as an editor may save it: CRLF, a space left after the key
  ok(record(d, T, [turn({ at: '2026-10-20 09:00', id: 'f-1', ask: 'the Zebra eats mango' })]) === 0 && hits(['mango'], { until: '2026-10-20' }) === '',
    'a forgotten turn recorded again stays gone');
  forget(d, ['mango'], { apply: true });
  ok(!existsSync(dayFile(d, '2026-10-21')) && days(d).join() === '2026-10-20', `a day forget leaves empty goes, one with a note stays (got ${days(d)})`);
  record(d, T, [turn({ at: '2026-10-20 09:00', id: 'f-1', ask: 'the Zebra eats mango' }), turn({ at: '2026-10-21 09:00', id: 'f-3', ask: 'mango again' })]);
  ok(hits(['mango']) === '', `a second forget keeps the first one's keys (got ${hits(['mango'])})`);
  forget(d, ['zebra'], { apply: true });
  ok(!hits(['zebra']) && readFileSync(f20, 'utf8').includes('My own note.'), 'a day left with only a note written by hand stays');
}
{
  // A day that changed under each of its three writes keeps its entries, and
  // forget says so: what it returns as removed is what went. The other writer
  // is simulated here, just before each write of that day lands.
  const d = storeFor(home, 'C:\\forget-busy'), f21 = dayFile(d, '2026-10-21');
  record(d, T, [turn({ at: '2026-10-20 09:00', id: 'b-1', ask: 'mango one' }), turn({ at: '2026-10-21 09:00', id: 'b-2', ask: 'mango two' })]);
  const read = fs.readFileSync;
  fs.readFileSync = (p, ...a) => { if (p === f21 && existsSync(`${p}.tmp${process.pid}`)) appendFileSync(p, '\nanother writer'); return read(p, ...a); };
  syncBuiltinESMExports();
  let r; try { r = forget(d, ['mango'], { apply: true }); } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
  ok(r.matched.length === 2 && r.removed.map((e) => e.key).join() === 'b-1' && parseDay(readFileSync(f21, 'utf8')).entries.length === 1 &&
    readFileSync(join(d, 'journal', '.forgotten'), 'utf8').includes('b-2'), `what forget says went is what went (got ${JSON.stringify(r?.removed)})`);
}
{
  // A day the disk refuses (read-only, held open) keeps its entries and is
  // named; the days after it still go. Thrown, it was a stack trace after half the work.
  const d = storeFor(home, 'C:\\forget-refused'), f21 = dayFile(d, '2026-10-21'), failed = [];
  record(d, T, [turn({ at: '2026-10-20 09:00', id: 'r-1', ask: 'mango one' }), turn({ at: '2026-10-21 09:00', id: 'r-2', ask: 'mango two' }), turn({ at: '2026-10-22 09:00', id: 'r-3', ask: 'mango three' })]);
  const rename = fs.renameSync;
  fs.renameSync = (a, b) => { if (b === f21) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return rename(a, b); };
  syncBuiltinESMExports();
  let r; try { r = forget(d, ['mango'], { apply: true, failed }); } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  ok(r.removed.map((e) => e.key).join() === 'r-1,r-3' && parseDay(readFileSync(f21, 'utf8')).entries.length === 1 && JSON.stringify(failed) === JSON.stringify([{ path: f21, code: 'EPERM', write: true }]),
    `a day that cannot be written keeps its entries and is named; the days after it still go (got ${JSON.stringify(r?.removed?.map((e) => e.key))}, ${JSON.stringify(failed)})`);
}
{
  const [r, d] = repo('forget'), p = old(r, sid('a'), 30, ['the zebra eats mango', 'the zebra policy']);
  fill(d);
  const gone = forget(d, ['mango'], { apply: true }).removed.length;
  appendFileSync(p, rec('user', sid('a'), '2026-09-02T10:00:00Z', 'one more', r) + '\n' + rec('assistant', sid('a'), '2026-09-02T10:00:30Z', 'one more: done', r) + '\n');
  utimesSync(p, ago(1), ago(1)); due(d);
  const again = fill(d);
  ok(gone === 1 && again.imported === 1 && asks(d).join() === 'one more,the zebra policy',
    `a backfill reading the conversation again brings no forgotten entry back (got ${gone}, ${JSON.stringify(again)}, ${asks(d)})`);
}

console.log(`journal: ${checks} checks passed`);
