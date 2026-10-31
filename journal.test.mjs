// Self-check for journal.mjs: capped, redacted entries merged into one file
// per day. Run: node journal.test.mjs
import fs, { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { tempHome, storeFor, tool, slug, quick, fastClock } from './harness.mjs';

const { home, env } = tempHome('jr-test-');
const { entryOf, render, parseDay, record, dayFile, days, write, sweep, backfill, entries, forget, summary, firstDay, due: isDue, IMPORT_SEGMENT } = await import('./journal.mjs');
const { ACTIVE, TAIL } = await import('./handoff-log.mjs');
const { local, withLock } = await import('./store.mjs');
const dir = storeFor(home, 'C:\\journal-selftest');
// A test that sets TZ puts back this: assigning, because deleting TZ leaves the zone on the last one set (Node 24 on Windows).
const TZ0 = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  // A note shaped like a field, written under an entry, was read as that field:
  // it overwrote the entry's, and the next write lost the note. Only a field
  // the entry has not had yet, in render order, is one.
  const f = dayFile(dir, '2026-11-14'), t = turn({ at: '2026-11-14 10:00', id: 'fn-1', did: 'the cache key' });
  record(dir, T, [t]);
  appendFileSync(f, '\n**Answered:** CORRECTION by me: it was the DNS, not the cache\n**Asked:** and a second note\n');
  const e = parseDay(readFileSync(f, 'utf8')).entries[0];
  ok(e.answered === 'the cache key' && e.after === '**Answered:** CORRECTION by me: it was the DNS, not the cache\n**Asked:** and a second note',
    `a field the entry had already is a note under it (got ${JSON.stringify(e)})`);
  record(dir, T, [t, turn({ at: '2026-11-14 11:00', id: 'fn-2' })]);
  ok(readFileSync(f, 'utf8').includes('CORRECTION by me') && readFileSync(f, 'utf8').includes('and a second note'), 'and the next write keeps it');
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
  // Nothing to write, nothing to fail: the same turn again faulted every Stop.
  write(d, T, [turn({ at: '2026-11-12 09:00', id: 'w-1', ask: 'the zebra', raw: 'the zebra' })], { quiet: false, hush: false });
  ok(!existsSync(failed) && readFileSync(f).equals(bytes), `a turn with nothing to change on a day not in UTF-8 is no failure (got ${existsSync(failed) && readFileSync(failed, 'utf8')})`);
  record(d, P, [turn({ at: '2026-11-11 11:00', id: 'w-4' })]);
  ok(throws(() => sweep(d, 'aaaaaaaa')) && others() === 'w-0,w-3' && readFileSync(f).equals(bytes), 'a sweep leaves it too, after the other days, and says so');
  const failedForget = [], r = forget(d, ['zebra'], { apply: true, failed: failedForget });
  ok(r.matched.length === 1 && !r.removed.length && readFileSync(f).equals(bytes) && failedForget.some((x) => x.path === f), `forget leaves it, and names it (got ${JSON.stringify(failedForget)})`);
}
{
  // A day saved as UTF-16 (PowerShell 5.1's Out-File) parsed as a day with no
  // entry, and search and status said nothing of it: named, as a day that
  // will not open is (final review, 2026-10-29).
  const d = storeFor(home, 'C:\\journal-utf16'), f = dayFile(d, '2026-11-03'), failed = [];
  record(d, T, [turn({ at: '2026-11-03 09:00', id: 'u16-1', ask: 'the wide day' }), turn({ at: '2026-11-04 09:00', id: 'u16-2', ask: 'the narrow day' })]);
  writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(readFileSync(f, 'utf8'), 'utf16le')]));
  const es = entries([d], { failed }), dir5 = dayFile(d, '2026-11-05');
  mkdirSync(dir5);
  const s = summary(d);
  ok(es.map((e) => e.key).join() === 'u16-2' && JSON.stringify(failed) === JSON.stringify([{ path: f, code: 'not UTF-8' }]) && s.unread?.join('|') === `${f}: not UTF-8|${dir5}: EISDIR` && s.days === 1,
    `a day not in UTF-8 is named by search, and status names it and a day that will not read (got ${JSON.stringify(failed)}, ${JSON.stringify(s)})`);
}
{
  // A turn dated a day off after a time-zone change, recorded again (a backfill
  // of a grown conversation), was in two days: record() keeps a key once a
  // day. It leaves the day beside (final review, 2026-10-29); a note stays.
  const d = storeFor(home, 'C:\\journal-zone'), keys = (x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries.map((e) => e.key).join();
  record(d, T, [turn({ at: '2026-11-01 22:00', id: 'z-0', ask: 'an earlier turn' }), turn({ at: '2026-11-01 23:30', id: 'z-1', ask: 'the zone turn' })]);
  appendFileSync(dayFile(d, '2026-11-01'), '\nMy note on the zone turn.\n');
  record(d, T, [turn({ at: '2026-11-02 00:30', id: 'z-1', ask: 'the zone turn' })]);
  record(d, T, [turn({ at: '2026-10-31 23:00', id: 'z-0', ask: 'an earlier turn' })]);
  ok(keys('2026-11-02') === 'z-1' && keys('2026-10-31') === 'z-0' && keys('2026-11-01') === '' && readFileSync(dayFile(d, '2026-11-01'), 'utf8').includes('My note on the zone turn.'),
    `a key recorded on a day leaves the days beside it, its note kept (got ${days(d).map((x) => `${x}: ${keys(x)}`)})`);
  // That is only a clean-up: a day beside it that won't read (here a folder)
  // fails nothing, so the Stop whose write landed reports no failure.
  mkdirSync(dayFile(d, '2026-11-09'));
  let threw = null;
  try { record(d, T, [turn({ at: '2026-11-10 09:00', id: 'z-2', ask: 'beside a folder' })]); } catch (e) { threw = e.code || e.message; }
  ok(threw === null && keys('2026-11-10') === 'z-2', `a day beside it that won't read fails no record (got ${threw}, ${keys('2026-11-10')})`);
}
{
  // A path is cut relative to the turn's folder in any case only where the
  // disk ignores case (Windows, macOS): on Linux /home/USER is another folder.
  const real = process.platform, on = (platform) => {
    Object.defineProperty(process, 'platform', { value: platform });
    try { return entryOf(turn({ cwd: '/home/user', changed: ['/home/USER/x.txt', '/home/user/y.txt'] }), T).changed.join(); }
    finally { Object.defineProperty(process, 'platform', { value: real }); }
  };
  ok(on('linux') === '/home/USER/x.txt,y.txt' && on('darwin') === 'x.txt,y.txt' && on('win32') === 'x.txt,y.txt', `case folded on Windows and macOS only (got ${on('linux')}; ${on('darwin')}; ${on('win32')})`);
}
{
  // R33: a private sweep stopped short by a day not in UTF-8 is done again at
  // every write until it goes through, its failure shown until then. Never
  // redone, the conversation's entries stayed for good.
  const d = storeFor(home, 'C:\\journal-owed'), f = dayFile(d, '2026-09-01'), failed = join(d, 'journal', '.failed'), owed = join(d, 'journal', '.sweeps');
  const P = '/x/projects/C--proj/aaaaaaaa.jsonl', Q = '/x/projects/C--proj/cccccccc.jsonl', note = Buffer.from('\nNote: caf\xE9\n', 'latin1');
  const holds = () => readFileSync(f, 'utf8').includes('my biopsy');
  record(d, P, [turn({ at: '2026-09-01 10:00', id: 'p-1', ask: 'my biopsy result', raw: 'my biopsy result' }), turn({ at: '2026-09-03 10:00', id: 'p-2' })]);
  appendFileSync(f, note);
  write(d, P, [], { quiet: true, hush: true });   // the Stop of the turn that typed the mark
  write(d, Q, [turn({ at: '2026-09-02 09:00', id: 'q-1' })], { quiet: false, hush: false });   // another conversation's
  ok(holds() && !existsSync(dayFile(d, '2026-09-03')) && summary(d).failed?.includes('not UTF-8') && readFileSync(owed, 'utf8') === 'aaaaaaaa 2026-09-01\n',
    `until the day is fixed, every write tries the sweep again and says it failed; the days after it are swept, and only it is owed (got ${summary(d).failed}; ${readFileSync(owed, 'utf8')})`);
  // Only that day, at every write: each owed sweep read every day file at
  // every Stop, 1.4-1.7 s for three on a year of journal; nor does the
  // conversation's own next Stop sweep every day again (review, 2026-10-29).
  const bad = dayFile(d, '2026-09-05');
  mkdirSync(bad, { recursive: true });   // a day no sweep can read
  write(d, P, [], { quiet: true, hush: false });
  write(d, Q, [turn({ at: '2026-09-02 09:01', id: 'q-0' })], { quiet: false, hush: false });
  ok(readFileSync(owed, 'utf8') === 'aaaaaaaa 2026-09-01\n', `an owed sweep reads its own day again, no other (got ${JSON.stringify(readFileSync(owed, 'utf8'))})`);
  rmSync(bad, { recursive: true });
  // Fixed as an editor that took it for the code page does: saved whole as
  // UTF-8, every heading's `·` is `Â·`, and the entries' headings still read.
  writeFileSync(f, readFileSync(f, 'latin1'));
  write(d, Q, [turn({ at: '2026-09-02 09:05', id: 'q-2' })], { quiet: false, hush: false });
  ok(!holds() && !existsSync(failed) && !existsSync(owed) && readFileSync(f, 'utf8').includes('café'), 'the first write after the fix finishes it, and clears the failure');
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
{
  // A transcript outside the projects folder names no folder for the import to look in.
  const d = storeFor(home, 'C:\\journal-far');
  write(d, T, [turn({ at: '2026-10-31 10:00', id: 'far-1' })], { quiet: false, hush: false });
  ok(days(d).join() === '2026-10-31' && !existsSync(join(d, 'journal', '.folders')), `a live write of a transcript outside the projects folder notes no folder (got ${days(d)})`);
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
// A Stop takes ~0.1 s; one that loops (a mutant's) is killed after a minute, and its test fails (R12).
const hung = (what) => new Error(`a Stop did not finish in 60 s (${what}): it loops`);
const stop = (id, last) => { const r = spawnSync(process.execPath, [TIER, '--stop'], { env, input: payload(id, last), encoding: 'utf8', timeout: 60e3 }); if (r.error?.code === 'ETIMEDOUT' || r.signal) throw hung(r.error?.code ?? r.signal); return r; };
const stopNow = (id) => new Promise((done) => { const c = spawn(process.execPath, [TIER, '--stop'], { env, stdio: ['pipe', 'ignore', 'ignore'], timeout: 60e3 }); c.on('exit', (code, signal) => { if (signal) throw hung(signal); done(code); }); c.stdin.end(payload(id)); });
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
  // Swept once: the Stop after the marking one, its mark still in that Stop's
  // read, reads no journal day again (each swept every day: 1.5 s a Stop with
  // three years of journal).
  say(B, '2026-10-28T10:14:00Z', 'still private', 'ok');
  const counter = join(home, 'count-day-reads.mjs');
  writeFileSync(counter, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readFileSync; let n = 0;\n" +
    "fs.readFileSync = (p, ...a) => { if (/journal[\\\\/]\\d{4}-\\d\\d-\\d\\d\\.md$/.test(String(p))) n++; return read(p, ...a); };\nsyncBuiltinESMExports();\nprocess.on('exit', () => process.stderr.write(`${n} day reads`));\n");
  const again = spawnSync(process.execPath, ['--import', pathToFileURL(counter).href, TIER, '--stop'], { env, input: payload(B), encoding: 'utf8' });
  ok(again.stderr.endsWith('0 day reads'), `the Stop after a private mark sweeps no journal day again (got ${again.stderr.slice(-40)})`);
}
{
  // Begun in New York at 20:30, marked private once the laptop said Berlin:
  // there the conversation began a day later, and its first day was kept.
  const Z = sid('z'), zone = (tz, f) => { process.env.TZ = tz; try { return f(); } finally { process.env.TZ = TZ0; } };
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
{
  // The look past the Stop's read goes on from where the last stopped, once
  // more has been written than a Stop's read covers: looked at once, a mark
  // typed later in a turn that got no Stop, with 600 KB after it, was missed
  // when the read had no turn of handoff.md's to reach back to (review, 2026-10-29).
  const L = sid('l'), list = join(sdir, 'journal', '.checked'), flood = (ts) => appendFileSync(tp(L), JSON.stringify({ type: 'user', uuid: `l-big-${ts}`, sessionId: L, cwd: scwd, timestamp: ts,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(600_000) }] } }) + '\n');
  const line = () => readFileSync(list, 'utf8').split('\n').find((l) => l.startsWith(`${slug(scwd)}/${L} `));
  say(L, '2026-10-28T14:00:00Z', 'the first question', 'the first answer');
  flood('2026-10-28T14:00:30Z');
  say(L, '2026-10-28T14:01:00Z', 'the second question', 'the second answer');
  stop(L);
  const first = line();
  ok(first === `${slug(scwd)}/${L} ${statSync(tp(L)).size}` && of(L).length === 1, `a look that finds no mark says how far it read (got ${first}, ${of(L).length})`);
  say(L, '2026-10-28T14:02:00Z', 'a third question', 'a third answer');
  stop(L);
  ok(line() === first && of(L).length === 2, `a Stop whose read covers what came since looks at nothing (got ${line()}, ${of(L).length})`);
  say(L, '2026-10-28T14:03:00Z', '<private-session> from here on');
  flood('2026-10-28T14:03:30Z');
  say(L, '2026-10-28T14:04:00Z', 'so what is the vault passphrase', 'it is hunter2-staple');
  rmSync(join(sdir, 'handoff.md'));   // a fourth session's turns pushed this one's out
  stop(L);
  let tags = '', hd = ''; try { tags = readFileSync(join(sdir, '.private-sessions'), 'utf8'); hd = readFileSync(join(sdir, 'handoff.md'), 'utf8'); } catch {}
  ok(!of(L).length && tags.split(/\r?\n/).includes(L.slice(0, 8)) && !hd.includes('hunter2'),
    `a mark typed after the first look, further back than the read, keeps the conversation out (got ${JSON.stringify(of(L))}; ${JSON.stringify(tags)})`);
}
{
  // F6: marked private and swept, its tag then lost from .private-sessions (1,000 newer private conversations
  // push it out; here the list is rewritten without it, as 1,000 marks take 3.5 s), then resumed with more than
  // a Stop's read between the mark and a new turn. Its ` swept` line skipped the look past the read, and the
  // turn went into the journal, handoff.md and the next startup briefing.
  const Y = sid('ya'), y = Y.slice(0, 8), list = join(sdir, '.private-sessions'), hf = join(sdir, 'handoff.md');
  const tags = () => (existsSync(list) ? readFileSync(list, 'utf8') : '').split(/\r?\n/);
  say(Y, '2026-10-28T16:00:00Z', 'a normal question', 'a normal answer');
  stop(Y);
  say(Y, '2026-10-28T16:01:00Z', '<private-session> from here on', 'understood');
  stop(Y);
  const swept = readFileSync(join(sdir, 'journal', '.checked'), 'utf8').split(/\r?\n/).includes(`${slug(scwd)}/${Y} 0 swept`), was = tags().includes(y);
  writeFileSync(list, tags().filter((t) => t && t !== y).join('\n') + '\n');
  // An entry recorded after the sweep, by a Stop before this fix, goes too (mutant bce69c577aa4).
  record(sdir, tp(Y), [turn({ at: '2026-10-28 16:01', id: 'ya-leaked', ask: 'leaked before the fix' })]);
  // Now, so a leaked turn would be the briefing's last session (it names one of the last 7 days).
  const now = new Date(Date.now() - 60e3).toISOString();
  appendFileSync(tp(Y), JSON.stringify({ type: 'user', uuid: 'ya-big', sessionId: Y, cwd: scwd, timestamp: now,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(TAIL + 100_000) }] } }) + '\n');
  say(Y, now, 'so what is the vault code', 'it is walrus-4417');
  rmSync(hf);   // other sessions' turns, newer than this one's
  stop(Y);
  const journal = days(sdir).map((d) => readFileSync(dayFile(sdir, d), 'utf8')).join(''), hd = existsSync(hf) ? readFileSync(hf, 'utf8') : '';
  const brief = spawnSync(process.execPath, [tool('handoff-log.mjs'), '--print'], { env, encoding: 'utf8', timeout: 60e3,
    input: JSON.stringify({ cwd: scwd, session_id: sid('yb'), hook_event_name: 'SessionStart', source: 'startup' }) }).stdout ?? '';
  const leaked = ['journal', 'handoff.md', 'briefing'].filter((_, i) => /vault code|walrus/.test([journal, hd, brief][i]));
  ok(swept && was && !leaked.length && tags().includes(y),
    `a private conversation whose tag was lost, resumed past a Stop's read, stays out and is tagged again (got swept ${swept}, tagged ${was}, leaked into ${leaked}, tagged again ${tags().includes(y)})`);
  ok(!of(Y).length, `and what was recorded of it after its sweep goes (got ${of(Y).map((e) => e.asked)})`);
}
{
  // R36: forget takes the exchange out of handoff.md too (the next startup's
  // briefing printed it), and the next Stop of its conversation, which reads
  // it again, does not put it back (final review, 2026-10-29).
  const J = sid('j'), hd = () => readFileSync(join(sdir, 'handoff.md'), 'utf8');
  say(J, '2026-10-28T15:00:00Z', 'the walrus budget is 900', 'noted the walrus budget');
  say(J, '2026-10-28T15:05:00Z', 'the seal plan', 'drafted the seal plan');
  stop(J);
  const had = hd().includes('walrus') && hd().includes('the seal plan'), r = forget(sdir, ['walrus'], { apply: true }), after = hd();
  say(J, '2026-10-28T15:10:00Z', 'what next', 'the otter review');
  stop(J);
  ok(had && r.removed.length === 1 && !after.includes('walrus') && after.includes('the seal plan') && !hd().includes('walrus') && hd().includes('the otter review') && !of(J).some((e) => e.asked.includes('walrus')),
    `forget takes the exchange out of handoff.md, and the next Stop of its conversation does not put it back (got ${had}, ${after}, ${hd()})`);
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
  // A transcript that won't open (EACCES: one a `sudo claude` run left owned by
  // root) is listed as failed, with its size and the time, and tried again
  // once it grows or a day later: retried at every look, it failed at every
  // look, and never retried, one held open for a moment (EBUSY) was never
  // imported. Its failure stays in status while one is listed so.
  const [r, d] = repo('unread'), p = old(r, sid('u'), 2, ['readable at last']), open = fs.openSync, list = join(d, 'journal', '.imported');
  const line = () => listed(d).find((l) => l.startsWith(`${slug(r)}/${sid('u')} `)) ?? '';
  fs.openSync = (q, ...a) => { if (q === p) throw Object.assign(new Error(`EACCES: permission denied, open '${q}'`), { code: 'EACCES' }); return open(q, ...a); };
  syncBuiltinESMExports();
  let first, again;
  try { first = fill(d); old(r, sid('w'), 2, ['another one']); due(d); again = fill(d); } finally { fs.openSync = open; syncBuiltinESMExports(); }
  ok(first.imported === 0 && new RegExp(`^${slug(r)}/${sid('u')} ${statSync(p).size} failed \\d+$`).test(line()), `it is listed as failed, with its size and the time (got ${JSON.stringify(first)}, ${line()})`);
  ok(again.imported === 1 && again.left === 0 && summary(d).left === 0 && summary(d).failed?.startsWith('backfill: EACCES'),
    `the next look leaves it and imports another, and status still names the failure (got ${JSON.stringify(again)}, ${summary(d).failed})`);
  writeFileSync(list, readFileSync(list, 'utf8').replace(/ failed \d+$/m, ` failed ${Date.now() - 25 * 3600e3}`));
  due(d);
  ok(fill(d).imported === 1 && asks(d).join() === 'another one,readable at last' && !line().includes(' failed') && !summary(d).failed,
    `a day later it is tried again, not grown: imported, and the failure cleared (got ${asks(d)}, ${line()}, ${summary(d).failed})`);
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
  appendFileSync(live, rec('user', V, '2026-10-28T09:05:00Z', 'again in the worktree', w) + '\n' + rec('assistant', V, '2026-10-28T09:05:30Z', 'ok', w) + '\n');
  spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: w, transcript_path: live, session_id: V, hook_event_name: 'Stop' }) });
  due(d); fill(d);
  const noted = readFileSync(join(d, 'journal', '.folders'), 'utf8');
  ok(noted === `${slug(w)}\n`, `a folder is noted once, and stays while it holds this store's conversations (got ${JSON.stringify(noted)})`);
}
{
  // A private conversation's Stop in a worktree folder not yet noted notes it:
  // no look listed the folder, so its ` swept` line went at every look and it
  // was swept again at each. A noted folder gone from disk, or holding only
  // another store's conversations, leaves the list (review, 2026-10-29).
  const [r, d] = repo('wtquiet'), w = join(home, 'trees', 'quiet'), gd = join(r, '.git', 'worktrees', 'quiet'), K = sid('k');
  mkdirSync(gd, { recursive: true }); mkdirSync(w, { recursive: true });
  writeFileSync(join(w, '.git'), `gitdir: ${gd}\n`); writeFileSync(join(gd, 'commondir'), '../..\n'); writeFileSync(join(gd, 'gitdir'), join(w, '.git') + '\n');
  const live = join(projects, slug(w), `${K}.jsonl`), list = join(d, 'journal', '.checked'), noted = join(d, 'journal', '.folders');
  mkdirSync(dirname(live), { recursive: true });
  writeFileSync(live, rec('user', K, '2026-10-28T09:00:00Z', '<private-session> in the worktree', w) + '\n' + rec('assistant', K, '2026-10-28T09:00:30Z', 'ok', w) + '\n');
  spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: w, transcript_path: live, session_id: K, hook_event_name: 'Stop' }) });
  due(d); fill(d);
  let lines = ''; try { lines = readFileSync(list, 'utf8'); } catch {}
  ok(lines.includes(`${slug(w)}/${K} 0 swept\n`), `a quiet conversation's swept line outlives a look (got ${JSON.stringify(lines)})`);
  const far = join(home, 'work', 'far-noted');
  old(far, sid('d'), 10, ['far']);
  appendFileSync(noted, `${slug(far)}\n`);
  rmSync(join(projects, slug(w)), { recursive: true });
  due(d); fill(d); due(d); fill(d);
  ok(readFileSync(noted, 'utf8').trim() === '', `a noted folder gone from disk, or of another store's conversations only, leaves the list (got ${JSON.stringify(readFileSync(noted, 'utf8'))})`);
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
if (process.platform === 'win32') {
  // A Stop's line spelt as its payload spelt the folder (`c--x`, the disk
  // `C--x`) is the same conversation's: dropped, every look swept it again.
  const [r, d] = repo('casekey'), list = join(d, 'journal', '.checked'), line = `${slug(r).toUpperCase()}/${sid('a')} 10\n`;
  old(r, sid('a'), 30, ['still here']);
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(list, line);
  fill(d);
  ok(readFileSync(list, 'utf8') === line, `a look keeps a line whose folder is spelt in another case (got ${JSON.stringify(readFileSync(list, 'utf8'))})`);
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
  // Tagged with no Stop of its own to follow (a memory-off Stop tags it and
  // exits; the compaction gate's handoff marks it private and the user quits):
  // the import that meets it takes back what it wrote, and a private one's
  // lines in handoff.md, once. It listed the transcript as read (review, 2026-10-29).
  for (const [c, how] of [['i', 'held with auto memory off'], ['j', 'marked private']]) {
    const [r, d] = repo(`nostop-${c}`), id = sid(c), p = old(r, id, 30, ['said before the tag']), failed = join(d, 'journal', '.failed');
    const more = (ask) => { appendFileSync(p, rec('user', id, '2026-09-02T10:00:00Z', ask, r) + '\n' + rec('assistant', id, '2026-09-02T10:00:30Z', 'ok', r) + '\n'); utimesSync(p, ago(1), ago(1)); due(d); };
    fill(d);
    const was = asks(d).join();
    writeFileSync(join(d, 'handoff.md'), `---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** 2026-09-01 10:00 [${id.slice(0, 8)}]: said before the tag\n  **did:** noted\n`
      + '- **asked** 2026-09-01 12:05 [kkkkkkkk]: another conversation\n  **did:** kept\n<!-- auto:end -->\n');
    appendFileSync(c === 'i' ? join(projects, '.memory-off') : join(d, '.private-sessions'), `${id.slice(0, 8)}\n`);
    more('the turn that tagged it');
    fill(d);
    const hd = readFileSync(join(d, 'handoff.md'), 'utf8');
    ok(was === 'said before the tag' && !asks(d).length && hd.includes('another conversation') && (c === 'i' || !hd.includes('said before the tag')),
      `a conversation ${how}, its tag followed by no Stop of its own, loses what an import wrote at the next look (got ${was}; ${asks(d)}; ${hd})`);
    // Once: a later look reads no day for it (one that won't read would fail it).
    const bad = dayFile(d, '2026-11-20');
    mkdirSync(bad, { recursive: true });
    more('and another');
    fill(d);
    ok(!existsSync(failed), `a conversation ${how} swept once is not swept at every look (got ${existsSync(failed) ? readFileSync(failed, 'utf8') : ''})`);
    rmSync(bad, { recursive: true });
  }
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
  // A Stop or a few: the look for a mark keeps to the budget, a segment past it.
  const whole = `${slug(r)}/${H} ${statSync(p).size}`, line = () => { try { return listed(d).find((l) => l.startsWith(`${slug(r)}/${H} `)) ?? ''; } catch { return ''; } };
  let ms = 0, out = '';
  for (let i = 0; i < 5 && line() !== whole; i++) {
    const t0 = Date.now();
    out += spawnSync(process.execPath, [TIER, '--stop'], { env, input: JSON.stringify({ cwd: r, transcript_path: ps, session_id: S, hook_event_name: 'Stop' }), encoding: 'utf8' }).stdout;
    ms = Math.max(ms, Date.now() - t0);
  }
  ok(ms < 3000 && out === '' && line() === whole && asks(d).includes('before the flood') && asks(d).includes('after the flood'),
    `backfill keeps to its budget on a huge transcript: no Stop takes over ${ms} ms, none says anything, and the 70 MB line is passed over unread, the turns before and after it journaled (got ${line()}; ${asks(d)}; ${out})`);
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
  const line = () => listed(d).find((l) => l.startsWith(`${slug(r)}/${W} `)) ?? '', size = statSync(p).size;
  // The look for a mark comes first, and keeps to the budget too: a segment a
  // Stop, how far it got in the list, nothing recorded before it ends.
  const one = fill(d, small), far = Number(/ (\d+) at 0$/.exec(line())?.[1]);
  ok(one.imported === 1 && one.left === 1 && far > 0 && far < size && !asks(d).length,
    `out of time after a segment looked at for a mark, nothing is recorded yet, and the list says how far the look got (got ${JSON.stringify(one)}, ${line()}, ${asks(d)})`);
  const lines = [];
  for (let i = 0; i < 60 && fill(d, small).left; i++) lines.push(line());
  ok(lines.some((l) => new RegExp(` ${size} at [1-9]\\d*$`).test(l)), `then the import goes on a segment a Stop, from where the last stopped (got ${lines})`);
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
  // The text search for a mark finds a quoted one too, and turns() tells: a tag
  // in a tool's output or an agent's report is not the user's, and the
  // conversation is imported. One typed full-width, or split by a zero-width
  // space, is the user's, and keeps the conversation out.
  const quoted = (id, r) => JSON.stringify({ type: 'user', uuid: `${id.slice(0, 4)}-tr`, sessionId: id, cwd: r, timestamp: '2026-09-01T10:00:40Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'grep found <private-session> in notes.md' }] } }) + '\n'
    + rec('user', id, '2026-09-01T10:01:00Z', '<task-notification>the agent wrote <private-session> in its report</task-notification>', r) + '\n';
  for (const [c, typed, how] of [['q', null, 'quoted'], ['f', '＜private-session＞ from here', 'full-width'], ['k', '<private​-session> from here', 'zero-width split']]) {
    const [r, d] = repo(`tag-${c}`), Z = sid(c), p = join(projects, slug(r), `${Z}.jsonl`);
    writeFileSync(p, exchange(Z, r, 0) + (typed ? rec('user', Z, '2026-09-01T10:01:00Z', typed, r) + '\n' : quoted(Z, r)) + exchange(Z, r, 2));
    utimesSync(p, ago(2), ago(2));
    fill(d);
    ok(typed ? !asks(d).length : asks(d).join() === 'question 0,question 2', `a ${how} tag ${typed ? 'keeps the conversation out' : 'is no mark: the conversation is imported'} (got ${asks(d)})`);
  }
}
{
  // A look that read a transcript for a mark and then could not import it
  // (here its day is a folder) keeps how far it looked: the next look reads
  // it for a mark no more.
  const [r, d] = repo('throws'), V = sid('v'), p = join(projects, slug(r), `${V}.jsonl`), day1 = dayFile(d, local('2026-09-01T10:00:00Z'));
  writeFileSync(p, exchange(V, r, 0)); utimesSync(p, ago(2), ago(2));
  mkdirSync(day1, { recursive: true });
  fill(d);
  ok(listed(d).includes(`${slug(r)}/${V} ${statSync(p).size} at 0`), `an import that throws keeps the look's end (got ${listed(d)})`);
  rmSync(day1, { recursive: true });
}
{
  // R33 for a mark an import finds: the sweep a day not in UTF-8 stopped is
  // done again at the next look, and its failure shown until then.
  const [r, d] = repo('owed'), M = sid('o'), p = join(projects, slug(r), `${M}.jsonl`), f = dayFile(d, '2026-09-01'), failed = join(d, 'journal', '.failed');
  const note = Buffer.from('\nNote: caf\xE9\n', 'latin1'), holds = () => readFileSync(f, 'utf8').includes('my biopsy');
  record(d, p, [turn({ at: '2026-09-01 08:00', id: 'o-live', ask: 'my biopsy', raw: 'my biopsy' })]);
  appendFileSync(f, note);
  writeFileSync(p, exchange(M, r, 0) + rec('user', M, '2026-09-01T10:30:00Z', '<private-session> from here on', r) + '\n');
  utimesSync(p, ago(2), ago(2));
  fill(d);
  ok(holds() && /^backfill: .*not UTF-8/.test(summary(d).failed), `a sweep an import could not finish says so (got ${summary(d).failed})`);
  const b = readFileSync(f);
  writeFileSync(f, Buffer.concat([b.subarray(0, b.length - note.length), Buffer.from('\nNote: café\n')]));
  utimesSync(p, new Date(), new Date());   // running again: no import this look, only the sweep owed
  due(d); fill(d);
  ok(!holds() && !existsSync(failed) && !existsSync(join(d, 'journal', '.sweeps')), `the next look finishes it, and clears the failure (got ${summary(d).failed})`);
}
{
  // A transcript whose last line is longer than a segment is read to its end:
  // its import never finished, and every Stop read it again under the lock.
  const [r, d] = repo('longtail'), L = sid('t'), p = join(projects, slug(r), `${L}.jsonl`);
  const big = JSON.stringify({ type: 'user', uuid: 'big-1', sessionId: L, cwd: r, timestamp: '2026-09-01T10:03:00Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }] } });
  writeFileSync(p, exchange(L, r, 0) + exchange(L, r, 1) + big + '\n');
  utimesSync(p, ago(2), ago(2));
  const got = fill(d, { segment: 1024 }), line = listed(d).find((l) => l.startsWith(`${slug(r)}/${L} `));
  ok(got.left === 0 && line === `${slug(r)}/${L} ${statSync(p).size}` && asks(d).join() === 'question 0,question 1',
    `a last line longer than a segment ends the import, not stalls it (got ${JSON.stringify(got)}, ${line}, ${asks(d)})`);
}
{
  // A transcript the version before R24 read only the last 64 MB of (` partial`)
  // is read again from its start.
  const [r, d] = repo('partial'), Pp = sid('p'), p = join(projects, slug(r), `${Pp}.jsonl`);
  writeFileSync(p, exchange(Pp, r, 0) + exchange(Pp, r, 1));
  utimesSync(p, ago(2), ago(2));
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(join(d, 'journal', '.imported'), `${slug(r)}/${Pp} ${statSync(p).size} partial\n`);
  const got = fill(d);
  ok(got.imported === 1 && asks(d).join() === 'question 0,question 1' && listed(d).join() === `${slug(r)}/${Pp} ${statSync(p).size}`,
    `a transcript read only in part before is read whole (got ${JSON.stringify(got)}, ${asks(d)}, ${listed(d)})`);
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
{
  // A sweep owed (its day not in UTF-8) is the live write's to report, which
  // tries it first at every Stop. Failed in a look too, it kept a first
  // import with work left to a look in half an hour, not every Stop; and
  // its line in status stayed after the day was fixed and a live write
  // finished the sweep (review, 2026-10-29).
  const [r, d] = repo('owedlook'), W = sid('w'), p = join(projects, slug(r), `${W}.jsonl`), f = dayFile(d, '2026-08-01'), failed = join(d, 'journal', '.failed');
  const Q = '/x/projects/C--proj/cccccccc.jsonl';
  record(d, T, [turn({ at: '2026-08-01 09:00', id: 'ow-1' })]);
  appendFileSync(f, Buffer.from('\nNote: caf\xE9\n', 'latin1'));
  write(d, T, [], { quiet: true, hush: true });
  writeFileSync(p, Array.from({ length: 12 }, (_, i) => exchange(W, r, i)).join(''));
  utimesSync(p, ago(2), ago(2));
  const few = { turns: 5, budgetMs: 0 }, one = fill(d, few), two = fill(d, few);
  ok(one.imported === 1 && one.left === 1 && two.imported === 1 && summary(d).failed?.includes('not UTF-8'),
    `a sweep owed slows no import: the next Stop goes on with it, and status still names the day (got ${JSON.stringify(one)}, ${JSON.stringify(two)}, ${summary(d).failed})`);
  for (let i = 0; i < 5 && fill(d, few).left; i++);
  due(d); fill(d);   // a look with nothing to import, the sweep still owed
  writeFileSync(f, readFileSync(f, 'latin1'));   // fixed
  write(d, Q, [turn({ at: '2026-08-02 09:00', id: 'ow-q' })], { quiet: false, hush: false });
  due(d); fill(d);
  ok(!existsSync(failed) && !existsSync(join(d, 'journal', '.sweeps')), `once the sweep is done, status names no failure (got ${existsSync(failed) && readFileSync(failed, 'utf8')})`);
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
// T's transcript is on disk, as a recorded turn's is: a key no transcript
// could bring back is not listed.
mkdirSync(join(projects, 'C--proj'), { recursive: true }); writeFileSync(join(projects, 'C--proj', '0123456789abcdef.jsonl'), '');
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
  // R36: forget takes its matches out of handoff.md too, by conversation and
  // minute: another conversation's exchange of that minute stays. A
  // handoff.md the disk refuses is named, as a day is.
  const d = storeFor(home, 'C:\\forget-handoff'), hf = join(d, 'handoff.md'), failed = [];
  record(d, T, [turn({ at: '2026-10-20 09:00', id: 'h-1', ask: 'mango one' }), turn({ at: '2026-10-20 09:05', id: 'h-2', ask: 'kiwi two' })]);
  const said = (at, ask, s = '01234567') => `- **asked** ${at} [${s}]: ${ask}\n  **did:** an answer`;
  writeFileSync(hf, `---\nname: handoff\n---\n\n<!-- auto:start -->\n_Written._\n\n${[said('2026-10-20 09:00', 'mango one'), said('2026-10-20 09:00', 'mango elsewhere', 'feedbeef'), said('2026-10-20 09:05', 'kiwi two')].join('\n')}\n<!-- auto:end -->\n`);
  forget(d, ['mango'], { apply: true });
  const hd = readFileSync(hf, 'utf8');
  ok(!hd.includes('mango one') && hd.includes('[feedbeef]: mango elsewhere') && hd.includes('[01234567]: kiwi two'), `forget takes its matches out of handoff.md, and only them (got ${hd})`);
  const rename = fs.renameSync;
  fs.renameSync = (a, b) => { if (b === hf) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return rename(a, b); };
  syncBuiltinESMExports();
  let r; try { r = forget(d, ['kiwi'], { apply: true, failed }); } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  ok(r.removed.map((e) => e.key).join() === 'h-2' && readFileSync(hf, 'utf8').includes('kiwi two') && JSON.stringify(failed) === JSON.stringify([{ path: hf, code: 'EPERM', write: true }]),
    `a handoff.md that cannot be written is named, and the journal's entries still go (got ${JSON.stringify(r?.removed?.map((e) => e.key))}, ${JSON.stringify(failed)})`);
}
{
  // .forgotten keeps only what could come back: a key whose transcript is
  // gone is never read again, so it is not listed, and goes at the next
  // forget. Forgetting everything listed every key, read at every Stop
  // (final review). An older line, its key alone, stays.
  const d = storeFor(home, 'C:\\forget-prune'), list = join(d, 'journal', '.forgotten'), gp = join(projects, 'C--prune', 'gone.jsonl'), hp = join(projects, 'C--prune', 'here.jsonl');
  mkdirSync(dirname(hp), { recursive: true }); writeFileSync(hp, ''); writeFileSync(gp, '');
  record(d, gp, [turn({ at: '2026-10-20 09:00', id: 'p-1', ask: 'mango gone' }), turn({ at: '2026-10-20 09:01', id: 'p-4', ask: 'kiwi gone' })]);
  record(d, hp, [turn({ at: '2026-10-20 09:05', id: 'p-2', ask: 'mango here' }), turn({ at: '2026-10-20 09:10', id: 'p-3', ask: 'kiwi here' })]);
  forget(d, ['mango'], { apply: true });
  const first = readFileSync(list, 'utf8');
  rmSync(gp); appendFileSync(list, 'p-old\n');
  forget(d, ['kiwi'], { apply: true });
  ok(first === 'p-1\tC--prune/gone\t2026-10-20 09:00\np-2\tC--prune/here\t2026-10-20 09:05\n' && readFileSync(list, 'utf8') === 'p-2\tC--prune/here\t2026-10-20 09:05\np-old\np-3\tC--prune/here\t2026-10-20 09:10\n',
    `forget lists a key with its conversation and time while its transcript is on disk, and only then (got ${JSON.stringify(first)}, ${JSON.stringify(readFileSync(list, 'utf8'))})`);
  ok(record(d, hp, [turn({ at: '2026-10-20 09:05', id: 'p-2', ask: 'mango here' })]) === 0, 'a listed key recorded again stays gone');
  // A transcript whose stat fails but for its absence (held, no access) keeps its keys.
  record(d, hp, [turn({ at: '2026-10-20 09:15', id: 'p-5', ask: 'plum here' })]);
  const stat = fs.statSync;
  fs.statSync = (p, ...a) => { if (String(p).endsWith('here.jsonl')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return stat(p, ...a); };
  syncBuiltinESMExports();
  try { forget(d, ['plum'], { apply: true }); } finally { fs.statSync = stat; syncBuiltinESMExports(); }
  ok(readFileSync(list, 'utf8') === 'p-2\tC--prune/here\t2026-10-20 09:05\np-old\np-3\tC--prune/here\t2026-10-20 09:10\np-5\tC--prune/here\t2026-10-20 09:15\n',
    `a transcript that will not stat keeps its keys listed (got ${JSON.stringify(readFileSync(list, 'utf8'))})`);
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

// --- edges of journal.mjs: what the automatic mutants of its comparisons and retries change -----
const tagsOf = (d) => { try { return readFileSync(join(d, '.private-sessions'), 'utf8').split(/\r?\n/); } catch { return []; } };
// A second writer, simulated: each time (up to `times`) our copy of `file` is about to be renamed
// over it, a line is appended to it, so the write loses. Returns how many copies were written.
const racing = (file, times, fn) => {
  const read = fs.readFileSync, write = fs.writeFileSync, tmp = `${file}.tmp${process.pid}`;
  let writes = 0, hit = 0;
  fs.writeFileSync = (p, ...a) => { if (p === tmp) writes++; return write(p, ...a); };
  fs.readFileSync = (p, ...a) => { if (p === file && hit < times && existsSync(tmp)) { hit++; appendFileSync(file, 'another writer\n'); } return read(p, ...a); };
  syncBuiltinESMExports();
  try { fn(); } finally { fs.readFileSync = read; fs.writeFileSync = write; syncBuiltinESMExports(); }
  return writes;
};
// fn with Date.now() returning `now` (a number, or a function of the moment).
const atClock = (now, fn) => { const was = Date.now; Date.now = typeof now === 'function' ? now : () => now; try { return fn(); } finally { Date.now = was; } };
const NOW = Math.floor(Date.now() / 1000) * 1000;
{
  // A path that is the turn's folder and its separator alone stays as it is.
  const ch = entryOf(turn({ changed: ['C:\\proj\\', 'C:\\proj\\a.js'], cwd: 'C:\\proj' }), T).changed;
  ok(ch.join('|') === 'C:\\proj\\|a.js', `only a path with a name after the folder is shortened (got ${ch})`);
  // A second heading under an entry is prose, not the entry's heading again.
  const two = parseDay('<!-- j:k1 t:t d:2026-10-28 -->\n## 09:00 · conversation aaaa · branch b1\n## 10:00 · conversation bbbb\n**Asked:** q').entries[0];
  ok(two.s === 'aaaa' && two.at === '2026-10-28 09:00' && two.branch === 'b1' && two.after?.includes('conversation bbbb'), `a second heading is a note, not the heading (got ${JSON.stringify(two)})`);
  // Entries of one minute go by key, whichever way they came.
  for (const ids of [['k-b', 'k-a'], ['k-a', 'k-b']]) {
    const o = storeFor(home, `C:\\order-${ids[0]}`);
    record(o, T, ids.map((id) => turn({ at: '2026-10-20 09:00', id })));
    const got = parseDay(readFileSync(dayFile(o, '2026-10-20'), 'utf8')).entries.map((e) => e.key).join();
    ok(got === 'k-a,k-b', `entries of one minute are in key order, from ${ids} (got ${got})`);
  }
  // due: the look is due exactly ACTIVE after the last one, in either direction; a time that will not read is no look.
  const dl = storeFor(home, 'C:\\due-edge'), lk = join(dl, 'journal', '.looked');
  mkdirSync(join(dl, 'journal'), { recursive: true }); writeFileSync(lk, '5000000');
  ok(isDue(dl, 5000000 + ACTIVE) && !isDue(dl, 5000000 + ACTIVE - 1) && isDue(dl, 5000000 - ACTIVE) && !isDue(dl, 5000000 - ACTIVE + 1), 'a look is due exactly ACTIVE after the last, and not a millisecond before');
  rmSync(lk); mkdirSync(lk);
  ok(isDue(dl) === true, 'a look time that will not read is no look: one is due');
  // A day that will not read is named with its error code.
  const dz = storeFor(home, 'C:\\entries-dir'), fl = [];
  mkdirSync(dayFile(dz, '2026-10-20'), { recursive: true });
  entries([dz], { failed: fl });
  ok(fl.length === 1 && fl[0].code === 'EISDIR', `a day that is a folder is named by its code (got ${JSON.stringify(fl)})`);
}
{
  // A write that loses to another writer is tried again, three times in all, and no more.
  const [, d] = repo('racing'), f20 = dayFile(d, '2026-10-20'), hp = join(projects, 'C--racing', 'here.jsonl'), list = join(d, 'journal', '.forgotten');
  mkdirSync(dirname(hp), { recursive: true }); writeFileSync(hp, '');
  const hs = entryOf(turn(), hp).s;
  record(d, hp, [turn({ at: '2026-10-20 09:00', id: 'rc-0', ask: 'mango zero' })]);
  ok(racing(f20, Infinity, () => record(d, hp, [turn({ at: '2026-10-20 09:05', id: 'rc-1' })])) === 3, 'record gives a day up after three writes that lost');
  writeFileSync(list, 'old-key\n');
  ok(racing(list, Infinity, () => forget(d, ['mango'], { apply: true })) === 3, 'forget gives the list of forgotten keys up after three writes that lost');
  // Once, though: the retry lists the key, or a Stop would put the entry back.
  record(d, hp, [turn({ at: '2026-10-21 09:00', id: 'rc-2', ask: 'kiwi two' })]);
  racing(list, 1, () => forget(d, ['kiwi'], { apply: true }));
  ok(readFileSync(list, 'utf8').split('\n').includes('rc-2\tC--racing/here\t2026-10-21 09:00'), `a forgotten key is listed although the first write lost (got ${JSON.stringify(readFileSync(list, 'utf8'))})`);
  record(d, hp, [turn({ at: '2026-10-20 09:10', id: 'rc-3' })]);
  ok(racing(f20, Infinity, () => sweep(d, hs)) === 3, 'a sweep gives a day up after three writes that lost');
}
{
  // The same for the lists a Stop keeps: the folders noted, and the conversations looked at.
  const [r, d] = repo('racing-lists'), fl = join(d, 'journal', '.folders'), ck = join(d, 'journal', '.checked');
  mkdirSync(join(d, 'journal'), { recursive: true }); writeFileSync(fl, 'C--elsewhere\n'); writeFileSync(ck, 'zz/yy 5\n');
  const out = (n) => { const p = join(projects, `C--racing-out-${n}`, `${n.repeat(8)}-0000.jsonl`); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, ''); return p; };
  const live = { quiet: false, hush: false };
  ok(racing(fl, Infinity, () => write(d, out('a'), [], live)) === 3, 'noting a folder is given up after three writes that lost');
  racing(fl, 1, () => write(d, out('b'), [], live));
  ok(readFileSync(fl, 'utf8').split('\n').includes('C--racing-out-b'), `a folder is noted although the first write lost (got ${JSON.stringify(readFileSync(fl, 'utf8'))})`);
  const mine = (n) => join(projects, slug(r), `${n.repeat(8)}-0000.jsonl`);
  ok(racing(ck, Infinity, () => write(d, mine('c'), [], { quiet: true, hush: true })) === 3, 'a sweep is listed as done after three writes that lost, and no more');
  racing(ck, 1, () => write(d, mine('e'), [], { quiet: true, hush: true }));
  ok(readFileSync(ck, 'utf8').includes(`${slug(r)}/${'e'.repeat(8)}-0000 0 swept`), `a sweep is listed although the first write lost (got ${JSON.stringify(readFileSync(ck, 'utf8'))})`);
}
{
  // A failure is kept even in a store that has no journal folder yet.
  const d = storeFor(home, 'C:\\fault-nodir'), p = join(projects, slug('C:\\fault-nodir'), 'gone.jsonl');
  write(d, p, Object.assign([], { whole: false }), { quiet: false, hush: false });
  let f = ''; try { f = readFileSync(join(d, 'journal', '.failed'), 'utf8'); } catch {}
  ok(f.includes('ENOENT'), `a failed write is kept in a store with no journal folder (got ${JSON.stringify(f)})`);
}
{
  // A conversation held with auto memory off is swept once: what an earlier look swept stays swept.
  const [r, d] = repo('offtwice'), id = sid('r'), p = old(r, id, 30, ['said before']);
  appendFileSync(join(projects, '.memory-off'), `${id.slice(0, 8)}\n`);
  const hf = join(d, 'handoff.md');
  writeFileSync(hf, `---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** 2026-09-01 10:00 [${id.slice(0, 8)}]: said before\n  **did:** noted\n<!-- auto:end -->\n`);
  fill(d);
  // Only a private conversation takes its lines out of handoff.md; one held with memory off keeps them.
  ok(readFileSync(hf, 'utf8').includes('said before') && !asks(d).length, 'a sweep for auto memory off leaves handoff.md alone');
  record(d, p, [turn({ at: '2026-09-02 10:00', id: 'ot-live', ask: 'journaled since' })]);
  appendFileSync(p, rec('user', id, '2026-09-02T10:00:00Z', 'more', r) + '\n' + rec('assistant', id, '2026-09-02T10:00:30Z', 'ok', r) + '\n');
  utimesSync(p, ago(1), ago(1)); due(d);
  fill(d);
  ok(asks(d).join() === 'journaled since', `a conversation swept for auto memory off is not swept again at the next look (got ${asks(d)})`);
  // ...unless a mark is typed after: swept again, whatever was swept before, and its lines leave handoff.md too.
  appendFileSync(p, rec('user', id, '2026-09-03T10:00:00Z', '<private-session> from here', r) + '\n');
  utimesSync(p, ago(1), ago(1)); due(d);
  fill(d);
  ok(!asks(d).length && !readFileSync(hf, 'utf8').includes('said before'), `a mark typed after a sweep for auto memory off sweeps again (got ${asks(d)}; ${readFileSync(hf, 'utf8')})`);
}
{
  // A Stop whose read stopped short looks for a mark in the rest only when more than TAIL bytes came since: exactly TAIL, its read covered them.
  const [r, d] = repo('tail');
  const stopAt = (c, size) => {
    const id = sid(c), p = join(projects, slug(r), `${id}.jsonl`), head = rec('user', id, '2026-10-28T14:05:00Z', '<private-session> x', r) + '\n';
    writeFileSync(p, head + ' '.repeat(size - head.length - 1) + '\n');
    write(d, p, Object.assign([turn({ at: '2026-10-28 14:05', id: `tl-${c}`, ask: `ask ${c}` })], { whole: false }), { quiet: false, hush: false });
    return statSync(p).size;
  };
  ok(stopAt('a', TAIL) === TAIL && asks(d).join() === 'ask a' && !tagsOf(d).includes('a'.repeat(8)), `exactly TAIL bytes since the last look are no reason to look again (got ${asks(d)})`);
  const failed = join(d, 'journal', '.failed');
  writeFileSync(failed, '{"at":"2026-10-28T09:00:00Z","error":"left over"}\n');
  stopAt('b', TAIL + 1);
  ok(asks(d).join() === 'ask a' && tagsOf(d).includes('b'.repeat(8)), `one byte more: the mark is found, the conversation is tagged private and journals nothing (got ${asks(d)}; ${tagsOf(d)})`);
  ok(!existsSync(failed), 'a Stop that took a conversation back has written all it had to: an earlier failure is cleared');
}
{
  // A mark in the second read of the look is found at a Stop too. The look's segment is 64 MB; here
  // each read returns at most 4 KB, as a disk may, and the file is over TAIL of short blank lines before the mark.
  const [r, d] = repo('bigmark'), id = sid('g'), p = join(projects, slug(r), `${id}.jsonl`);
  writeFileSync(p, rec('user', id, '2026-10-28T15:00:00Z', 'hello there', r) + '\n' + (' '.repeat(99) + String.fromCharCode(10)).repeat(TAIL / 100 + 100) + '\n' + rec('user', id, '2026-10-28T15:01:00Z', '<private-session> after the gap', r) + '\n');
  const read = fs.readSync;
  fs.readSync = (fd, buf, off, len, pos) => read(fd, buf, off, len > 4096 ? 4096 : len, pos);
  syncBuiltinESMExports();
  try { write(d, p, Object.assign([turn({ at: '2026-10-28 15:00', id: 'bg-1', ask: 'hello there' })], { whole: false }), { quiet: false, hush: false }); }
  finally { fs.readSync = read; syncBuiltinESMExports(); }
  ok(!asks(d).length && tagsOf(d).includes('g'.repeat(8)), `a mark in the second read of the look keeps the conversation out (got ${asks(d)}; ${tagsOf(d)})`);
  rmSync(p);
}
{
  // A junk line holding a later prompt's uuid is no cut point: the import goes on, it does not read the same segment again.
  const [r, d] = repo('junkuuid'), U = sid('j'), p = join(projects, slug(r), `${U}.jsonl`), xs = [0, 1, 2, 3].map((i) => exchange(U, r, i));
  const id = JSON.parse(xs[3].split('\n')[0]).uuid;
  writeFileSync(p, `"uuid":"${id}"\n` + xs.join('')); utimesSync(p, ago(2), ago(2));
  fill(d, { turns: 3, budgetMs: 300 });
  ok(asks(d).length === 4 && listed(d)[0].endsWith(` ${statSync(p).size}`), `a junk line with a later prompt's uuid does not stall the import (got ${asks(d)}, ${listed(d)})`);
}
{
  // Imports that hang on a clock: a failed transcript is tried again a day after, one still being written is left alone for ACTIVE.
  const [r, d] = repo('retry'), id = sid('y'), p = old(r, id, 30, ['x']), S = statSync(p).size, DAY = 24 * 3600e3;   // journal.mjs's RETRY (not exported)
  mkdirSync(join(d, 'journal'), { recursive: true });
  const left = () => atClock(NOW, () => summary(d).left), failedAt = (ms) => writeFileSync(join(d, 'journal', '.imported'), `${slug(r)}/${id} ${S} failed ${ms}\n`);
  failedAt(NOW - DAY + 1); const soon = left();
  failedAt(NOW - DAY); const day = left();
  ok(soon === 0 && day === 1, `a transcript that failed to open is tried again a day after, not a millisecond before (got ${soon}, ${day})`);
  const [r2, d2] = repo('active'), p2 = old(r2, sid('v'), 30, ['x']);
  const edge = (ms) => { const s = (NOW - ms) / 1000; utimesSync(p2, s, s); return atClock(NOW, () => summary(d2).left); };
  const young = edge(ACTIVE - 1000), exact = edge(ACTIVE);
  ok(young === 0 && exact === 1, `a transcript is left alone while it changed less than ACTIVE ago, not at ACTIVE (got ${young}, ${exact})`);
}
{
  // The budget is spent when the time passed is the budget: no further transcript, no further segment. The clock moves once an entry is written.
  const [r, d] = repo('budget'), clock = (dd) => () => NOW + (days(dd).length ? 100 : 0);
  old(r, sid('a'), 50, ['ba']); old(r, sid('b'), 40, ['bb']);
  withLock(d, () => atClock(clock(d), () => backfill(d, { budgetMs: 100 })));
  ok(asks(d).join() === 'ba', `a second transcript is not started once the budget is spent (got ${asks(d)})`);
  const [r2, d2] = repo('segbudget'), B = sid('c'), p = join(projects, slug(r2), `${B}.jsonl`);
  writeFileSync(p, Array.from({ length: 12 }, (_, i) => exchange(B, r2, i)).join('')); utimesSync(p, ago(2), ago(2));
  withLock(d2, () => atClock(clock(d2), () => backfill(d2, { budgetMs: 100, segment: 1024 })));
  ok(asks(d2).length > 0 && asks(d2).length < 12 && / at \d+$/.test(listed(d2)[0]), `the next segment is not read once the budget is spent (got ${asks(d2).length}, ${listed(d2)})`);
}
{
  // A line longer than a segment is passed over, to its end: what follows it is read.
  const [r, d] = repo('longline'), L = sid('l'), p = join(projects, slug(r), `${L}.jsonl`), seg = 1024;
  writeFileSync(p, exchange(L, r, 0) + 'J'.repeat(seg) + rec('user', L, '2026-09-01T10:01:00Z', 'inside the long line', r) + '\n' + exchange(L, r, 2));
  utimesSync(p, ago(2), ago(2));
  fill(d, { segment: seg });
  ok(asks(d).join() === 'question 0,question 2', `a line longer than a segment is passed over whole, and what comes after it is imported (got ${asks(d)})`);
}
{
  // The last line of a transcript counts without its newline: a reply, and a mark.
  const [r, d] = repo('nonl'), N = sid('n'), p = old(r, N, 30, ['first']);
  appendFileSync(p, rec('user', N, '2026-09-02T10:00:00Z', 'second', r) + '\n' + rec('assistant', N, '2026-09-02T10:00:30Z', 'second: done', r)); utimesSync(p, ago(2), ago(2));
  fill(d);
  const second = days(d).flatMap((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries).find((e) => e.asked === 'second');
  ok(second?.answered === 'second: done', `a reply on a last line with no newline is imported (got ${JSON.stringify(second)})`);
  const [r2, d2] = repo('nonl-mark'), M = sid('m'), p2 = old(r2, M, 30, ['before the mark']);
  appendFileSync(p2, rec('user', M, '2026-09-02T10:00:00Z', '<private-session> from here', r2)); utimesSync(p2, ago(2), ago(2));
  fill(d2);
  ok(!asks(d2).length && tagsOf(d2).includes('m'.repeat(8)), `a mark on a last line with no newline keeps the conversation out (got ${asks(d2)})`);
}
{
  // A transcript of exactly as many turns as the cap is imported whole.
  const [r, d] = repo('capexact'), C = sid('x'), p = join(projects, slug(r), `${C}.jsonl`);
  writeFileSync(p, [0, 1, 2].map((i) => exchange(C, r, i)).join('')); utimesSync(p, ago(2), ago(2));
  fill(d, { turns: 3 });
  ok(asks(d).join() === 'question 0,question 1,question 2' && !existsSync(join(d, 'journal', '.failed')), `as many turns as the cap are imported, with no failure (got ${asks(d)})`);
}
{
  // A noted folder that a look keeps whole is not rewritten (a CRLF list stays as the user left it).
  const [r, d] = repo('refold'), fl = join(d, 'journal', '.folders');
  mkdirSync(join(d, 'journal'), { recursive: true });
  const p = join(projects, 'C--refold-else', 'abcd.jsonl'); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, rec('user', 'abcd', '2026-09-01T10:00:00Z', 'x', r) + '\n');
  writeFileSync(fl, 'C--refold-else\r\n');
  fill(d);
  ok(readFileSync(fl, 'utf8') === 'C--refold-else\r\n', `a look that drops no noted folder does not rewrite the list (got ${JSON.stringify(readFileSync(fl, 'utf8'))})`);
}
{
  // Part B: the numbers. A file one letter past the folder and its separator is shortened; the key of
  // a turn with no id is twelve characters of hash; a line straight under a marker is a note.
  ok(entryOf(turn({ changed: ['C:\\proj\\a'], cwd: 'C:\\proj' }), T).changed[0] === 'a', 'a one-letter file in the folder is shortened to its name');
  const key = entryOf(turn({ id: '' }), T).key;
  ok(/^01234567 2026-10-28 14:05 [0-9a-f]{12}$/.test(key), `a turn with no id is keyed by twelve characters of hash (got ${key})`);
  const under = parseDay('<!-- j:k1 t:t d:2026-10-28 -->\na note straight under the marker').entries[0];
  ok(under.key === 'k1' && under.after === 'a note straight under the marker', `a line straight under a marker is its note (got ${JSON.stringify(under)})`);
}
{
  // A transcript listed as another store's, or one that failed to open, that has grown is read from nothing:
  // its first line (and the mark in it) too. A line ` partial` says nothing was read.
  const [r, d] = repo('otherlines'), I = sid('xa'), Z = sid('xb'), k = (c) => `${slug(r)}/${c}`;
  const p = join(projects, slug(r), `${I}.jsonl`), q = join(projects, slug(r), `${Z}.jsonl`);
  writeFileSync(p, exchange(I, r, 0) + exchange(I, r, 1));
  writeFileSync(q, rec('user', Z, '2026-09-01T10:00:00Z', '<private-session> from the start', r) + '\n' + exchange(Z, r, 0));
  utimesSync(p, ago(2), ago(2)); utimesSync(q, ago(2), ago(2));
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(join(d, 'journal', '.imported'), `${k(I)} 10 other\n${k(Z)} 10 other\n`);
  fill(d);
  ok(asks(d).join() === 'question 0,question 1', `a grown transcript once listed as another store's is imported from its first line (got ${asks(d)})`);
  ok(tagsOf(d).includes('xb'.repeat(4)), 'and its mark, in the first line, is found');
  const [r2, d2] = repo('partial-line'), P = sid('xc'), pp = old(r2, P, 30, ['x']);
  mkdirSync(join(d2, 'journal'), { recursive: true });
  writeFileSync(join(d2, 'journal', '.imported'), `${slug(r2)}/${P} ${statSync(pp).size} partial\n`);
  fill(d2);
  ok(asks(d2).join() === 'x', `a transcript listed ' partial' is read again, whatever its size (got ${asks(d2)})`);
}
{
  // Segments cut where a segment ends. A transcript without uuids is cut at the end of the whole lines: the
  // import goes on from there, exactly.
  const [r, d] = repo('cleancut'), U = sid('xd'), p = join(projects, slug(r), `${U}.jsonl`);
  const bare = (s) => s.split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); delete o.uuid; return JSON.stringify(o) + '\n'; }).join('');
  const xs = [0, 1, 2, 3].map((i) => bare(exchange(U, r, i))), two = Buffer.byteLength(xs[0] + xs[1]);
  writeFileSync(p, xs.join('')); utimesSync(p, ago(2), ago(2));
  withLock(d, () => atClock(() => NOW + (days(d).length ? 100 : 0), () => backfill(d, { budgetMs: 100, segment: two + 1 })));
  ok(asks(d).join() === 'question 0,question 1' && listed(d)[0].endsWith(` ${statSync(p).size} at ${two}`), `a segment of whole exchanges is read whole, and the next starts right after it (got ${asks(d)}, ${listed(d)})`);
}
{
  // A blank line first in a segment, with the exchange after it longer than a segment: the exchange is still read whole.
  const [r, d] = repo('blanklead'), B = sid('xe'), p = join(projects, slug(r), `${B}.jsonl`), seg = 1024;
  const tool = (c) => JSON.stringify({ type: 'assistant', uuid: `b-t${c}`, sessionId: B, cwd: r, timestamp: '2026-09-01T10:00:10Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `ls ${c} ${'q'.repeat(150)}` } }] } }) + '\n';
  const long = exchange(B, r, 0, 'a first look').replace(/\n$/, '\n' + [1, 2, 3, 4].map(tool).join('')) + rec('assistant', B, '2026-09-01T10:00:50Z', 'the final word', r) + '\n';
  writeFileSync(p, '\n' + long + exchange(B, r, 1)); utimesSync(p, ago(2), ago(2));
  ok(Buffer.byteLength(long) > 2 * seg, 'the fixture: an exchange longer than two segments');
  fill(d, { segment: seg, budgetMs: 4000 /* a bound, ~1000x the real cost; a loop spends all of it */ });
  const es = days(d).flatMap((x) => parseDay(readFileSync(dayFile(d, x), 'utf8')).entries);
  ok(es.length === 2 && es.find((e) => e.asked === 'question 0')?.answered === 'the final word', `an exchange after a blank line at a segment's start keeps its last reply (got ${es.map((e) => `${e.asked}: ${e.answered.slice(0, 20)}`)})`);
  // A segment that is a newline alone, the line after it longer than a segment: passed over, the import done (a hang spent the budget).
  const [r2, d2] = repo('blankonly'), C = sid('xf'), q = join(projects, slug(r2), `${C}.jsonl`);
  writeFileSync(q, '\n' + 'J'.repeat(seg + 5) + '\n' + exchange(C, r2, 0)); utimesSync(q, ago(2), ago(2));
  fill(d2, { segment: seg, budgetMs: 4000 /* a bound, ~1000x the real cost; a loop spends all of it */ });
  ok(asks(d2).join() === 'question 0' && listed(d2)[0].endsWith(` ${statSync(q).size}`), `a newline alone as a segment is passed, not read again for ever (got ${asks(d2)}, ${listed(d2)})`);
}
{
  // An exchange that ends where a segment ends, the next one longer than a segment: the import stops, when out of
  // time, at that next prompt -- not back at the start of the one it finished.
  const [r, d] = repo('endsat'), A = sid('xg'), p = join(projects, slug(r), `${A}.jsonl`);
  const line = (type, i, text, extra = {}) => JSON.stringify({ type, uuid: `e-${i}`, sessionId: A, cwd: r, timestamp: `2026-09-01T10:0${i % 10}:00Z`, ...extra,
    message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] } }) + '\n';
  const tool = (i) => JSON.stringify({ type: 'assistant', uuid: `e-${i}`, sessionId: A, cwd: r, timestamp: '2026-09-01T10:00:10Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `ls ${i} ${'q'.repeat(150)}` } }] } }) + '\n';
  const first = [line('user', 1, 'question first'), line('assistant', 2, 'a first look'), tool(3), line('assistant', 4, 'the final word')];
  const second = [line('user', 5, 'question second'), line('assistant', 6, 'a first look'), tool(7), line('assistant', 8, 'the end')];
  const sz = (...ls) => Buffer.byteLength(ls.join('')), seg = Math.max(sz(first[0], first[1]), sz(first[2], first[3]));
  ok(seg < sz(...first.slice(0, 3)) && seg < sz(first[2], first[3], second[0]) && seg < sz(...second.slice(0, 3)), 'the fixture: segments end at the first exchange\'s second reply and at its end');
  writeFileSync(p, [...first, ...second].join('')); utimesSync(p, ago(2), ago(2));
  withLock(d, () => atClock(() => NOW + (days(d).length ? 100 : 0), () => backfill(d, { budgetMs: 100, segment: seg })));
  ok(asks(d).join() === 'question first' && listed(d)[0].endsWith(` ${statSync(p).size} at ${sz(...first)}`), `out of time, the import goes on at the prompt after a finished exchange (got ${asks(d)}, ${listed(d)})`);
}
{
  // A line passed over is found to its end in 1 MB reads: a line of exactly a segment, then its newline first in a
  // read; and a line over several reads (here 16 bytes each) is not cut short.
  const [r, d] = repo('pastbuf'), L = sid('xh'), p = join(projects, slug(r), `${L}.jsonl`), seg = 1024;
  writeFileSync(p, exchange(L, r, 0) + 'J'.repeat(seg) + rec('user', L, '2026-09-01T10:01:00Z', 'inside the long line', r) + '\n' + rec('assistant', L, '2026-09-01T10:01:30Z', 'inside: done', r) + '\n' + 'J'.repeat(seg) + '\n' + exchange(L, r, 3));
  utimesSync(p, ago(2), ago(2));
  const alloc = Buffer.allocUnsafe, sizes = [];
  Buffer.allocUnsafe = (n, ...a) => { sizes.push(n); return alloc.call(Buffer, n === 1 << 20 ? 16 : n, ...a); };
  try { fill(d, { segment: seg, budgetMs: 4000 /* a bound, ~1000x the real cost; a loop spends all of it */ }); } finally { Buffer.allocUnsafe = alloc; }
  // The only observable for the buffer's size (mutant 0f3146e9b153): update with the constant in past().
  ok(sizes.includes(1 << 20), `a line is passed over in 1 MB reads (got ${[...new Set(sizes)]})`);
  ok(asks(d).join() === 'question 0,question 3', `a line passed over is passed to its end, the next one whole (got ${asks(d)})`);
}
{
  // backfill's answers: nothing due says so; an owed sweep that still fails clears no failure of the import's.
  const [r, d] = repo('notdue');
  fill(d);
  const again = fill(d);
  ok(again.imported === 0 && again.left === 0 && Object.keys(again).length === 2, `a look that is not due imports nothing and leaves nothing (got ${JSON.stringify(again)})`);
  const [r2, d2] = repo('owedkeep'), f = dayFile(d2, '2026-08-01'), failed = join(d2, 'journal', '.failed');
  record(d2, T, [turn({ at: '2026-08-01 09:00', id: 'ok-1' })]);
  appendFileSync(f, Buffer.from('\nNote: caf\xE9\n', 'latin1'));
  write(d2, T, [], { quiet: true, hush: true });   // the sweep it owes fails: the day is not UTF-8
  appendFileSync(failed, '{"at":"2026-08-01T09:00:00Z","error":"backfill: boom"}\n');
  fill(d2);   // nothing to import
  ok(readFileSync(failed, 'utf8').includes('backfill: boom'), `a look with nothing imported and a sweep still owed keeps the import's failure (got ${readFileSync(failed, 'utf8')})`);
  // summary: transcripts left are none when the list of them cannot be read.
  const [r3, d3] = repo('summ');
  mkdirSync(join(d3, 'journal', '.imported'), { recursive: true });
  ok(summary(d3).left === 0, `a list of transcripts that will not read leaves none (got ${summary(d3).left})`);
}
{
  // The turns before the cap-th can come from `head` (an exchange longer than a segment, carried over): that exchange
  // ending exactly where a segment ends, then a prompt whose first key is "uuid" (offset 1), with turns: 1. The cap holds.
  const [r, d] = repo('over1'), S = sid('xi'), p = join(projects, slug(r), `${S}.jsonl`);
  const msg = (type, text) => ({ role: type, content: type === 'user' ? text : [{ type: 'text', text }] });
  const line = (type, uuid, ts, text) => JSON.stringify({ type, uuid, sessionId: S, cwd: r, timestamp: ts, message: msg(type, text) }) + '\n';
  const first = (type, uuid, ts, text) => JSON.stringify({ uuid, type, sessionId: S, cwd: r, timestamp: ts, message: msg(type, text) }) + '\n';
  const tool = (i) => JSON.stringify({ type: 'assistant', uuid: `a-t${i}`, sessionId: S, cwd: r, timestamp: '2026-09-01T10:00:10Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `ls ${i} ${'q'.repeat(150)}` } }] } }) + '\n';
  const A = [line('user', 'a-1', '2026-09-01T10:00:00Z', 'question A'), tool(1), tool(2), tool(3), tool(4), line('assistant', 'a-9', '2026-09-01T10:00:50Z', 'answer A')];
  const rest = [first('user', 'b-1', '2026-09-01T10:01:00Z', 'question B'), line('assistant', 'b-2', '2026-09-01T10:01:30Z', 'answer B'),
    line('user', 'c-1', '2026-09-01T10:02:00Z', 'question C'), line('assistant', 'c-2', '2026-09-01T10:02:30Z', 'answer C'),
    line('user', 'd-1', '2026-09-01T10:03:00Z', 'question D'), line('assistant', 'd-2', '2026-09-01T10:03:30Z', 'answer D ' + 'z'.repeat(2000))];
  const ls = [...A, ...rest], ends = ls.map((_, i) => Buffer.byteLength(ls.slice(0, i + 1).join(''))), size = ends.at(-1), aEnd = ends[A.length - 1];
  const cut = (pos, s) => ends.filter((e) => e <= pos + s && e > pos).at(-1);
  const seg = Array.from({ length: 3000 }, (_, i) => i + 100).find((s) => { const e1 = cut(0, s); return e1 && e1 < aEnd && cut(e1, s) === aEnd && aEnd + s < size; });
  ok(seg, 'the fixture: a segment size whose second segment ends exactly at the first exchange end');
  writeFileSync(p, ls.join('')); utimesSync(p, ago(2), ago(2));
  withLock(d, () => atClock(() => NOW + (days(d).length ? 100 : 0), () => backfill(d, { budgetMs: 100, segment: seg, turns: 1 })));
  ok(asks(d).join() === 'question A' && listed(d)[0].endsWith(` at ${aEnd}`), `the cap of turns holds when the turn before it came from a carried-over exchange (got ${asks(d)}, ${listed(d)}, want at ${aEnd})`);
}
{
  // F6's import: a look found the mark and swept the conversation, its tag was then lost from .private-sessions
  // (1,000 newer private conversations; here the list is emptied), and it grew with no live Stop (the plugin
  // off). The next look goes on from where the last stopped, past the mark: its new turns stay out all the same.
  const [r, d] = repo('lostimport'), W = sid('yc'), p = join(projects, slug(r), `${W}.jsonl`);
  writeFileSync(p, exchange(W, r, 0) + rec('user', W, '2026-09-01T10:01:00Z', '<private-session> from here on', r) + '\n');
  utimesSync(p, ago(2), ago(2));
  fill(d);
  const was = tagsOf(d).includes('yc'.repeat(4)) && !asks(d).length;
  writeFileSync(join(d, '.private-sessions'), '');
  appendFileSync(p, exchange(W, r, 2)); utimesSync(p, ago(1), ago(1)); due(d);
  fill(d);
  // Nor is it tagged memory-off on the way (mutant 178d36804841): its live Stops would skip the look that tags it private again.
  let off = ''; try { off = readFileSync(join(projects, '.memory-off'), 'utf8'); } catch {}
  ok(was && !asks(d).length && !off.includes('yc'.repeat(4)), `a swept conversation whose tag was lost keeps out what it grew by with no live Stop (got ${was}, ${asks(d)}, memory-off ${off.includes('yc'.repeat(4))})`);
}

console.log(`journal: ${checks} checks passed`);
