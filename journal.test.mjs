// Self-check for journal.mjs: capped, redacted entries merged into one file
// per day. Run: node journal.test.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, storeFor, tool, slug } from './harness.mjs';

const { home, env } = tempHome('jr-test-');
const { entryOf, render, parseDay, record, dayFile, days, write, sweep, backfill, entries, forget } = await import('./journal.mjs');
const { local, withLock } = await import('./store.mjs');
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
const fill = (d, o) => withLock(d, () => backfill(d, o));
// The store's transcripts are looked at once in half an hour, by the list's age.
const due = (d) => utimesSync(join(d, 'journal', '.imported'), ago(1), ago(1));
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
  const idle = fill(d);
  ok(idle.imported === 0 && !existsSync(failed), `between looks the list is not read at all (got ${JSON.stringify(idle)})`);
  due(d); fill(d);
  ok(existsSync(failed), 'a look reads it (and here fails on it, and says so)');
}
{
  const [r, d] = repo('kill');
  const ps = ['a', 'b', 'c', 'e'].map((c, i) => old(r, sid(c), 40 - i, [`k${c}`]));
  mkdirSync(join(d, 'journal'));
  // A pass killed after its first import: the list it left is due within half an hour.
  writeFileSync(join(d, 'journal', '.imported'), `${slug(r)}/${sid('a')} ${statSync(ps[0]).size}\n`);
  due(d);
  const got = fill(d);
  ok(got.imported === 3 && asks(d).join() === 'kb,kc,ke' && listed(d).length === 4, `backfill resumes after a kill: only the other three are imported (got ${JSON.stringify(got)}, ${asks(d)})`);
}
{
  const [r, d] = repo('hush');
  old(r, sid('a'), 30, ['marked private']); old(r, sid('b'), 20, ['<private-session> from here on']); old(r, sid('c'), 10, ['an open one']);
  writeFileSync(join(d, '.private-sessions'), `${sid('a').slice(0, 8)}\n`);
  fill(d);
  ok(asks(d).join() === 'an open one', `backfill skips a private conversation, in the list or marked in its transcript (got ${asks(d)})`);
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
  rmSync(day1, { recursive: true });
  ok(fill(d).imported === 0, 'a failed look waits for the next look, not the next Stop');
  due(d);
  ok(fill(d).imported === 1 && !existsSync(failed) && asks(d).join() === 'imported at last', 'the next import that goes through clears it');
  writeFileSync(failed, JSON.stringify({ at: new Date().toISOString(), error: 'the live write failed' }));
  old(r, sid('9'), 10, ['one more']);
  due(d);
  ok(fill(d).imported === 1 && existsSync(failed), "an import clears its own failure only, never the live write's");
}
// The Stop, as Claude Code runs it, on a conversation with a 70 MB tool result.
{
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
  ok(ms < 3000 && out.stdout === '' && line.endsWith(' partial') && asks(d).includes('after the flood'),
    `backfill keeps to its budget on a huge transcript: the Stop takes ${ms} ms, says nothing, reads the last 64 MB and journals the turns after the output (got ${line}; ${out.stdout})`);
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
  ok(text() === before && !existsSync(list), 'without apply nothing goes');
  mkdirSync(join(d, '.lock'));   // another hook's
  const busy = forget(d, ['mango'], { apply: true });
  rmSync(join(d, '.lock'), { recursive: true });
  ok(busy === null && text() === before && !existsSync(list), `while another holds the store's lock, nothing goes (got ${JSON.stringify(busy)})`);
  const r = forget(d, ['mango'], { until: '2026-10-20', apply: true });
  ok(r.removed === 1 && hits(['zebra']) === 'f-2' && readFileSync(f20, 'utf8').includes('My own note.'), `with apply the matches go, and a note written by hand stays (got ${r.removed}, ${hits(['zebra'])})`);
  writeFileSync(list, readFileSync(list, 'utf8').replace(/\n/g, '\r\n'));   // as an editor may save it
  ok(record(d, T, [turn({ at: '2026-10-20 09:00', id: 'f-1', ask: 'the Zebra eats mango' })]) === 0 && hits(['mango'], { until: '2026-10-20' }) === '',
    'a forgotten turn recorded again stays gone');
  forget(d, ['mango'], { apply: true });
  record(d, T, [turn({ at: '2026-10-20 09:00', id: 'f-1', ask: 'the Zebra eats mango' }), turn({ at: '2026-10-21 09:00', id: 'f-3', ask: 'mango again' })]);
  ok(hits(['mango']) === '', `a second forget keeps the first one's keys (got ${hits(['mango'])})`);
}
{
  const [r, d] = repo('forget'), p = old(r, sid('a'), 30, ['the zebra eats mango', 'the zebra policy']);
  fill(d);
  const gone = forget(d, ['mango'], { apply: true }).removed;
  appendFileSync(p, rec('user', sid('a'), '2026-09-02T10:00:00Z', 'one more', r) + '\n' + rec('assistant', sid('a'), '2026-09-02T10:00:30Z', 'one more: done', r) + '\n');
  utimesSync(p, ago(1), ago(1)); due(d);
  const again = fill(d);
  ok(gone === 1 && again.imported === 1 && asks(d).join() === 'one more,the zebra policy',
    `a backfill reading the conversation again brings no forgotten entry back (got ${gone}, ${JSON.stringify(again)}, ${asks(d)})`);
}

console.log(`journal: ${checks} checks passed`);
