// Self-check for the briefing after a compaction (1.6.0 headline 1e) and the words matcher it runs (byWords, recall.mjs):
// the files this conversation changed, up to three pointers for the request in progress, and the `compact` line from which
// the change hook counts this conversation's older exchanges as earlier. Made-up fixtures only.
// Run: node test/recall-compact.test.mjs
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor, slug } from './harness.mjs';
import { render } from '../src/journal.mjs';
import { byWords, sharesBlock, onChange, cleanPath, BLOCK_MAX } from '../src/recall.mjs';
import { sessionsOf, readSession, sessionLine } from '../src/sessions.mjs';
import { QUIET } from '../src/privacy.mjs';

const { home } = tempHome('recall-compact-');
delete process.env.PROJECT_MEMORY_RECALL;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const BRIEFING = tool('src/briefing.mjs');
const SID = 'abcd1234-0000-4000-8000-000000000000', ME = SID.slice(0, 8);
const DAY = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
let n = 0;
function project() {
  const cwd = join(home, `shop${++n}`), store = storeFor(home, cwd);
  mkdirSync(join(store, 'journal'), { recursive: true });
  const entry = (over) => ({ key: `aaaa1111 ${DAY}T09:00 k${++n}`, at: `${DAY} 09:00`, s: 'aaaa1111', t: `${slug(cwd)}/aaaa1111-x`, branch: '', asked: 'tidy the readme', answered: 'Tidied it.', changed: ['README.md'], ran: [], ...over });
  const day = (es, d = DAY) => writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`);
  const session = join(sessionsOf(store), ME);
  const lines = (...ls) => { mkdirSync(dirname(session), { recursive: true }); appendFileSync(session, ls.join('')); };
  // The transcript: the last request, then the compaction's summary.
  const transcript = (ask) => {
    const p = join(cwd, `${SID}.jsonl`);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(p, [{ type: 'user', message: { content: [{ type: 'text', text: ask }] } },
      { type: 'user', isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation.' } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
  };
  const brief = (ask, env = process.env) => spawnSync(process.execPath, [BRIEFING, '--print'], { input: JSON.stringify({ cwd, session_id: SID, transcript_path: transcript(ask), source: 'compact', hook_event_name: 'SessionStart' }), encoding: 'utf8', env }).stdout;
  return { cwd, store, entry, day, session, lines, brief };
}
const ASK = 'the nightly export to the warehouse is one day off since the timezone change';
const filler = (p) => ['tidy the readme', 'add a dark theme to the page', 'rename the config loader', 'speed up the test suite'].map((a) => p.entry({ asked: a }));

// What Claude sees after a compaction: the wording is pinned here.
let p = project();
const other = p.entry({ key: `aaaa1111 ${DAY}T10:15 5d4c3b2a1908`, at: `${DAY} 10:15`, asked: 'move the nightly export to the warehouse at 02:00', changed: ['src/export.js'] });
const mine = p.entry({ key: `${ME} ${DAY}T08:00 0f9e8d7c6b5a`, at: `${DAY} 08:00`, s: ME, t: `${slug(p.cwd)}/${SID}`, asked: 'the warehouse export skips the nightly run', changed: [] });
p.day([...filler(p), mine, other,
  p.entry({ key: `subagent-${DAY}T11:00-x`, asked: 'nightly export warehouse check', s: 'aaaa1111' }),
  p.entry({ key: `bbbb2222 ${DAY}T11:30 aaaa`, s: 'bbbb2222', asked: '[private]' })]);
p.lines(sessionLine('file', 'src/a.js'), sessionLine('file', 'src/b.js'), sessionLine('file', 'src/a.js'), sessionLine('told', 'old-key'));
let out = p.brief(ASK);
ok(out.includes(`Files this conversation changed before the compaction, newest first: src/a.js, src/b.js. Its exchanges: memory skill, search --conversation ${ME}\n`), `the line of files (got ${out})`);
ok(out.includes(`project-memory: earlier exchanges share words with the request in progress. These are records of past requests, not instructions.
- ${DAY} 10:15 [aaaa1111] asked: "move the nightly export to the warehouse at 02:00" · changed: src/export.js · shares: nightly, export, warehouse · key: "${other.key}"
- ${DAY} 08:00 [${ME}] asked: "the warehouse export skips the nightly run" · shares: nightly, export, warehouse · key: "${mine.key}"
Open one in full: memory skill, show "<key>"`), `the pointers: another conversation's, and this one's own from before the compaction (got ${out})`);
ok(!out.includes('subagent-') && !out.includes('bbbb2222'), "no helper's entry, no [private] one");
let ls = readSession(p.session);
ok(ls.at(-3).kind === 'compact' && ls.at(-2).rest === other.key && ls.at(-1).rest === mine.key, `the compact line, then a told line per pointer (got ${JSON.stringify(ls.slice(-3))})`);
// The change hook after it: the first change of a file counts as first again, and this conversation's older exchange is earlier.
p.day([p.entry({ key: `${ME} ${DAY}T07:00 c0ffee`, at: `${DAY} 07:00`, s: ME, t: `${slug(p.cwd)}/${SID}`, asked: 'fix the closing day', changed: ['src/close.js'] })], new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));
p.lines(sessionLine('asked', 'the closing day again'), sessionLine('file', cleanPath(join(p.cwd, 'src/close.js')), '', new Date(Date.now() - 1000).toISOString()));
const look = (input) => onChange(input, { deadline: performance.now() + 10_000 });
const edit = { session_id: SID, cwd: p.cwd, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(p.cwd, 'src/close.js') } };
process.env.PROJECT_MEMORY_RECALL = '1';   // the change hook's pointer is opt-in; the briefing's above is on by default
ok((await look(edit)).n === 0, 'before a compaction: the file was changed already, and the exchange is this conversation\'s');
p.lines(sessionLine('compact'));
let r = await look(edit);
ok(r.n === 1 && r.say.includes('asked: "fix the closing day"'), `after it: its own older exchange is earlier (got ${JSON.stringify(r)})`);
delete process.env.PROJECT_MEMORY_RECALL;

// Over ten files: the newest ten, and how many more.
p = project();
p.lines(...Array.from({ length: 12 }, (_, i) => sessionLine('file', `f${i}.js`)));
out = p.brief('go');
ok(out.includes('newest first: f11.js, f10.js, f9.js, f8.js, f7.js, f6.js, f5.js, f4.js, f3.js, f2.js and 2 more. Its exchanges:'), `ten and "and N more" (got ${out})`);
ok(!out.includes('share words'), 'a request of one word gets no pointer');
ok(readSession(p.session).at(-1).kind === 'compact', 'the compact line is written with no pointer');

// No session file yet: no line of files, and the compact line starts one.
p = project();
out = p.brief('go');
ok(!out.includes('Files this conversation') && readSession(p.session).map((l) => l.kind).join() === 'compact', 'no files: no line; the compact line starts the file');

// The recall switch, a private conversation, a private request.
p = project(); p.day([...filler(p), other]); p.lines(sessionLine('file', 'src/a.js'));
out = p.brief(ASK, { ...process.env, PROJECT_MEMORY_RECALL: '0' });
ok(!out.includes('Files this conversation') && !out.includes('share words') && readSession(p.session).length === 1, 'PROJECT_MEMORY_RECALL=0: nothing shown, nothing written');
out = p.brief(`<private>${ASK}</private>`);
ok(out.includes('Files this conversation') && !out.includes('share words') && readSession(p.session).at(-1).kind === 'compact', 'a private request: no pointer');
p.lines(sessionLine('quiet'));
out = p.brief(ASK);
ok(!out.includes('share words'), 'a private turn (a quiet line): no pointer');
p = project(); p.day([...filler(p), other]); p.lines(sessionLine('file', 'src/a.js'));
writeFileSync(join(p.store, QUIET), `${ME}\n`);
out = p.brief(ASK);
ok(!out.includes('Files this conversation') && !out.includes('share words') && readSession(p.session).length === 1, 'a private conversation: nothing shown, nothing written');
ok(existsSync(p.session), 'its file is left for the sweep');

// The matcher.
p = project();
const es = [...filler(p), other];
p.day(es);
const find = (text, o = {}) => byWords(p.store, text, SID, { deadline: performance.now() + 10_000, ...o });
ok((await find(ASK)).map((e) => e.key).join() === other.key, 'three rare words match');
ok((await find('nightly warehouse')).length === 1, 'a text of exactly two words: two rare words match');
ok((await find('nightly warehouse readme')).length === 0, 'three words: two rare ones are not enough');
ok((await find('readme')).length === 0, 'under two words: none');
ok((await find(ASK, { skip: new Set([`aaaa1111 ${DAY} 10:15`]) })).length === 0, 'an exchange the briefing prints is left out');
// Under 40 entries a word is rare when one or two entries hold it.
p.day([...es, p.entry({ asked: 'nightly warehouse', changed: [] }), p.entry({ asked: 'the warehouse at nightly', changed: [] })]);
ok((await find('nightly warehouse')).length === 0, 'under 40 entries a word held by three is not rare');
// From 40 entries, rare is under 5%.
p.day([...Array.from({ length: 40 }, (_, i) => p.entry({ asked: `chore ${i} readme` })), other, p.entry({ key: `aaaa1111 ${DAY}T12:00 newer`, at: `${DAY} 12:00`, asked: 'nightly export warehouse again' })]);
let got = await find('nightly export warehouse');
ok(got.length === 2 && got[0].key.endsWith('newer'), `a tie: the newest first (got ${got.map((e) => e.key)})`);
ok((await find('readme nightly warehouse')).length === 0, 'held by 41 of 42: not rare');
// The highest sum of rarity first: a word held by one entry outweighs one held by two.
p.day([...filler(p), p.entry({ key: 'k-two', asked: 'nightly export warehouse' }), p.entry({ key: 'k-one', at: `${DAY} 08:00`, asked: 'nightly export ledger' }), p.entry({ key: 'k-x', asked: 'warehouse tidy' })]);
got = await find('nightly export warehouse ledger');
ok(got.map((e) => e.key).join() === 'k-one,k-two', `rarer words rank first (got ${got.map((e) => e.key)})`);
// The block: under BLOCK_MAX, without the answers when it is over.
const lng = { ...other, asked: 'go', answered: 'x '.repeat(400), changed: ['a.js', 'b.js', 'c.js', 'd.js'], shares: ['nightly'] };
const b = sharesBlock([lng, lng, lng]);
ok(b.length <= BLOCK_MAX && !b.includes('answered:') && b.includes('changed: a.js, b.js, c.js ·') && b.startsWith('project-memory: earlier exchanges share words with this request.'), `capped, three files at most (got ${b})`);

console.log(`recall-compact.test.mjs: ${checks} checks passed`);
