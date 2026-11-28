// Self-check for replay.mjs (1.7.0 step 6, spec H6): what each lesson trigger would have done over a made-up journal, with only what
// existed before each exchange. The numbers here are the ones the gate (step 7) reads, so the blind cut is tested hardest.
// Run: node test/replay.test.mjs
import { mkdirSync, writeFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome } from './harness.mjs';

const { home } = tempHome('replay-');
const { replayRun, blindSet, assertBlind, lessonsList } = await import('../src/replay.mjs');
const { recent, render } = await import('../src/journal.mjs');
const { wilson } = await import('../src/lessons.mjs');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (got, want, msg) => { assert.deepStrictEqual(got, want, msg); checks++; };

const NOW = new Date(2026, 10, 27, 12, 0).getTime();   // 2026-11-27 12:00, local
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m);
const store = (name) => { const d = join(home, '.claude', 'projects', name, 'memory'); mkdirSync(join(d, 'journal'), { recursive: true }); return d; };
const note = (d, file, keys, name, desc, when) => {
  writeFileSync(join(d, file), `---\nname: ${name}\ndescription: ${desc}\ntype: feedback\n${keys}---\n\nbody\n`);
  if (when) utimesSync(join(d, file), when, when);
};
const E = (key, atText, s, asked, o = {}) => ({ key, at: atText, s, t: `proj/${s}-full`, branch: '', asked, answered: o.answered ?? 'done', changed: o.changed ?? [], ran: o.ran ?? [] });
// Every entry on its day file, in the order given.
const journal = (d, es) => {
  for (const day of new Set(es.map((e) => e.at.slice(0, 10)))) writeFileSync(join(d, 'journal', `${day}.md`), `# Journal ${day}\n\n${es.filter((e) => e.at.startsWith(day)).map(render).join('\n\n')}\n`);
};
const run = (stores, o = {}) => replayRun([].concat(stores), { days: 7, now: NOW, recent, ...o });
// Names, sizes and times of every file under a folder, to see that a run changed nothing.
const snap = (d, rel = '') => readdirSync(join(d, rel), { withFileTypes: true }).flatMap((x) => x.isDirectory() ? snap(d, join(rel, x.name)) : [`${join(rel, x.name)} ${statSync(join(d, rel, x.name)).size} ${statSync(join(d, rel, x.name)).mtimeMs}`]).sort();

// --- blindSet and assertBlind: a lesson exists for an exchange only when it was created strictly before it ---
{
  const ls = [{ name: 'old.md', created: '2026-11-26 09:59' }, { name: 'same.md', created: '2026-11-26 10:00' }, { name: 'new.md', created: '2026-11-26 10:01' }];
  const entry = { key: 'k1', at: '2026-11-26 10:00' };
  eq(blindSet(ls, entry).map((x) => x.name), ['old.md'], 'only a lesson created strictly before the exchange is in the set (the same minute is not)');
  assertBlind(blindSet(ls, entry), entry); checks++;
  assert.throws(() => assertBlind(ls, entry), /replay leak: same\.md is newer than k1/); checks++;
  assert.throws(() => assertBlind([ls[2]], entry), /replay leak: new\.md is newer than k1/); checks++;
}

// --- the made-up journal: 16 exchanges over 4 days, 3 notes ---
const S = store('C--replay-app');
const A = 'src/a.mjs', T = 'test/a.test.mjs', BOOM = 'npm test → failed: Error: boom';
const both = { changed: [A, T], ran: [BOOM] };
note(S, 'push-lesson.md', 'applies_when: [push]\n', 'Check before pushing', 'Run the whole check before every push.', at(24, 8));
note(S, 'edit-lesson.md', 'applies_to: [src/a.mjs]\n', 'Keep store and test together', 'Change the store with its test in the same turn.');
note(S, 'dead-end.md', 'instead: key on the last error marker line\n', 'Tail of output signatures', 'Keying errors on the tail of the output made ids differ.');
const entries = [
  E('k01', '2026-11-24 09:00', 'h1', 'begin ZEBRA01', both),
  E('k02', '2026-11-24 10:00', 'h2', 'begin ZEBRA02', both),
  E('k03', '2026-11-24 11:00', 'h3', 'begin ZEBRA03', both),
  E('k04', '2026-11-24 17:00', 'h3', 'write the dead end note ZEBRA04', { changed: [join(S, 'dead-end.md')] }),
  E('k05', '2026-11-25 08:00', 'h4', 'begin ZEBRA05', both),
  E('k06', '2026-11-25 08:30', 'h5', 'begin ZEBRA06', both),
  E('k07', '2026-11-25 09:00', 'h5', 'add the edit lesson ZEBRA07', { changed: [join(S, 'edit-lesson.md')] }),
  E('k08', '2026-11-26 10:00', 'm1', 'touch the store again ZEBRA08', { changed: [A] }),
  E('kp1', '2026-11-26 10:15', 'm1', '[private]', { answered: '[private]' }),
  E('kf1', '2026-11-26 10:20', 'm1', 'forgotten ZEBRA99', { ran: ['git push origin main'] }),
  E('k09', '2026-11-26 10:30', 'm1', 'publish it ZEBRA09', { ran: ['git push origin main'] }),
  E('k10', '2026-11-26 11:00', 'm1', 'no, always run the tests when you touch src/a.mjs ZEBRA10'),
  E('k11', '2026-11-26 12:00', 'm1', 'run the suite ZEBRA11', { answered: 'Looks good: all tests pass.', ran: ['npm test → failed: Error: x'] }),
  E('k12', '2026-11-26 12:30', 'm1', 'again ZEBRA12', { ran: ['npm test -- a → failed: Error: x', 'npm test -- b → failed: Error: y'] }),
  E('k13', '2026-11-26 13:00', 'm1', 'retry ZEBRA13', { ran: ['npm test → failed: Error: x', 'npm test'] }),
  E('k14', '2026-11-26 13:30', 'm1', 'once more ZEBRA14', { ran: ['npm test → failed: Error: z', 'npm test', 'npm test → failed: Error: z'] }),
  E('k15', '2026-11-27 09:00', 'm2', 'a new day ZEBRA15'),
  E('k16', '2026-11-27 09:30', 'm3', 'another conversation ZEBRA16'),
];
journal(S, entries);
writeFileSync(join(S, 'journal', '.forgotten'), 'kf1\n');

const before = snap(S);
const plain = run(S), shown = run(S, { show: true });
eq(snap(S), before, 'a replay changes nothing in the store: no history, no notes cache');
eq(plain.lines, [
  'Replayed 16 exchanges over 7 days (3 days had no journal). 3 lessons existed at some point; 3 could fire. 1 dated by file time.',
  'H1 edit lessons: 1 firing, 0.1 a day, median 0 on an active day. Probable hits 1, unclear 0. No correction signal (1 in 16 prompts).',
  'H2 command lessons: 1 firing, 0.1 a day, median 0 on an active day. Probable hits 0, unclear 1. No correction signal (1 in 16 prompts).',
  'H3 dead ends: 5 firings, 0.7 a day, median 1.5 on an active day. Probable hits 0, unclear 5. No correction signal (1 in 16 prompts).',
  'H4 recurring errors: 3 firings, 0.4 a day, median 1 on an active day. Probable hits 0, unclear 3. No correction signal (1 in 16 prompts).',
  'L2 stuck streak: 1 firing, 0.1 a day, median 0 on an active day. Probable hits 0, unclear 1. No correction signal (1 in 16 prompts). Lower bound (an exact re-run hides its earlier failure).',
  'H5 nudge: 1 firing in 16 prompts, median 0 on an active day. Cannot claim, n too small. (No interrupt markers in the journal.)',
  'L6 claim check: 1 firing, 0.1 a day, median 0 on an active day. Probable hits 0, unclear 1. No correction signal (1 in 16 prompts).',
  'L9 co-change: 1 firing, 0.1 a day, median 0 on an active day. Probable hits 0, unclear 1. No correction signal (1 in 16 prompts).',
  'L17 scan: hides 0 of 3 notes.',
  'Upper bound: a match is not proof that the lesson changes anything.',
], 'the pinned report of the made-up journal');
eq(plain.history, { at: '2026-11-27 12:00', days: 7, exchanges: 16,
  firings: { edit: 1, command: 1, deadend: 5, recurring: 3, stuck: 1, nudge: 1, claim: 1, cochange: 1 },
  hits: { edit: 1, command: 0, deadend: 0, recurring: 0, stuck: 0, nudge: 0, claim: 0, cochange: 0 } }, 'the history line holds numbers only');
ok(!/ZEBRA|k\d\d|\.mjs|\.md/.test(JSON.stringify(plain.history)), 'and no name, key or text');

// Without --show no text of the journal is printed: not one request's marker word, nor a key.
ok(!/ZEBRA/.test(plain.lines.join('\n')) && !/\bk\d\d\b/.test(plain.lines.join('\n')), 'without --show nothing of the journal is printed');
// --show: one line per firing after the counts, in time order.
const fired = shown.lines.filter((l) => /^2026-\d\d-\d\d \d\d:\d\d \[/.test(l));
eq(shown.lines.slice(0, 10), plain.lines.slice(0, 10), '--show keeps the counts first');
eq(shown.lines.at(-1), plain.lines.at(-1), 'and the upper bound last');
const only = (kind) => fired.filter((l) => new RegExp(`\\] ${kind} `).test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]);
eq(only('edit'), ['k08'], 'the edit lesson fires for k08 alone: k01-k03, k05, k06 changed the same file before the note was made');
eq(only('command'), ['k09'], 'the push lesson fires for the one push that was kept (the forgotten one is gone)');
eq(only('deadend'), ['k05', 'k06', 'k08', 'k15', 'k16'], 'a dead end is listed at each conversation start after its note was made');
eq(only('recurring'), ['k06', 'k08', 'k15'], 'a recurring error is listed at three startups, then no more');
eq(only('stuck'), ['k12'], 'two failures of one target in one entry (npm test -- a, npm test -- b) count; a failure then a pass, and fail-pass-fail, do not');
eq(only('nudge'), ['k10'], 'the correction fires the nudge, its first prompt would not');
eq(only('claim'), ['k11'], 'a reply that says tests pass over a failed run fires the claim check');
eq(only('cochange'), ['k08'], 'a file changed without the one it goes with fires once');
ok(fired.every((l, i) => !i || fired[i - 1].slice(0, 16) <= l.slice(0, 16)), 'the lines are in time order');
ok(fired.find((l) => l.includes('[k08] edit ')) === `2026-11-26 10:00 [k08] edit edit-lesson.md: touch the store again ZEBRA08 => Change the store with its test in the same turn.`, 'a --show line: time, key, trigger, note, request, what it would have said');
ok(!/ZEBRA99|kf1|kp1/.test(shown.lines.join('\n')), 'a forgotten and a private exchange are never shown');
ok(fired.length === 14 && fired.every((l) => /=> .+$/.test(l)), `every firing has its line (${fired.length})`);

// The cut is a time, not a count: a lesson dated by its file's time (09:30) fires for the exchange after it and not the one before.
{
  const L = store('C--replay-late');
  note(L, 'late-lesson.md', 'applies_to: [late.mjs]\n', 'Late lesson', 'Check late.mjs twice.', at(26, 9, 30));
  // l0 changed another project's note of the same name (a store on this machine): it does not date this one.
  store('C--elsewhere');
  journal(L, [E('l0', '2026-11-26 08:00', 'c0', 'elsewhere ZEBRA', { changed: ['/work/projects/C--elsewhere/memory/late-lesson.md'] }),
    E('l1', '2026-11-26 09:00', 'c1', 'before ZEBRA', { changed: ['late.mjs'] }), E('l2', '2026-11-26 10:00', 'c2', 'after ZEBRA', { changed: ['late.mjs'] })]);
  const r = run(L, { show: true });
  eq(r.lines.filter((l) => /\] edit /.test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]), ['l2'], 'a note dated after an exchange never fires for it, nor does a same-named note of another project date it');
  ok(/ 1 lesson existed at some point; 1 could fire\. 1 dated by file time\.$/.test(r.lines[0]), `the file-time count is in the first line (${r.lines[0]})`);
}

// The same project's journal from another machine names that machine's folder for the project: it dates the note all the same.
{
  const F = store('C--replay-foreign');
  note(F, 'foreign-lesson.md', 'applies_to: [f.mjs]\n', 'Foreign lesson', 'Check f.mjs.');   // file time: now, long after both exchanges
  journal(F, [E('f1', '2026-11-26 08:00', 'c1', 'made on the other PC ZEBRA', { changed: ['C:/Users/other/.claude/projects/C--other-pc-app/memory/foreign-lesson.md'] }),
    E('f2', '2026-11-26 09:00', 'c2', 'after ZEBRA', { changed: ['f.mjs'] })]);
  const r = run(F, { show: true });
  eq(r.lines.filter((l) => /\] edit /.test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]), ['f2'], 'a path under a folder this machine has no store for dates the note');
  ok(/ 1 lesson existed at some point; 1 could fire\. 0 dated by file time\.$/.test(r.lines[0]), `and it is not counted as dated by file time (${r.lines[0]})`);
}

// No journal at all, and a journal that will not read.
{
  const empty = store('C--replay-empty');
  const r = run(empty);
  eq(r.lines, ['Replayed 0 exchanges over 7 days (7 days had no journal). Nothing to replay.'], 'a store with no journal: every day counted');
  eq(r.history.exchanges, 0, 'and the history says 0');
  const bad = run(empty, { recent: () => null });
  ok(bad.lines[0] === `could not read the journal of ${empty}`, `a journal that will not read is said (${bad.lines[0]})`);
}

// A ratio prints n and its interval once there are 20 firings to read and 20 corrections to count them against: 30 conversations touch
// x.mjs, some of them are corrected about it (the request of a correction names the file, so it is a probable hit).
const shareJournal = (name, corrected) => {
  const X = store(name);
  note(X, 'x-lesson.md', 'applies_to: [x.mjs]\n', 'Mind x', 'Mind the x module.', at(25, 7));
  const es = [];
  for (let i = 0; i < 30; i++) {
    const m = 8 * 60 + i * 10, hh = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    es.push(E(`a${i}`, `2026-11-25 ${hh(m)}`, `c${i}`, `edit x ${i}`, { changed: ['x.mjs'] }));
    if (i < corrected) es.push(E(`b${i}`, `2026-11-25 ${hh(m + 5)}`, `c${i}`, 'no, always run the tests for x.mjs', {}));
  }
  journal(X, es);
  return X;
};
{
  const r = run(shareJournal('C--replay-share', 22)), [lo, hi] = wilson(22, 30);
  eq(r.lines[1], `H1 edit lessons: 30 firings, 4.3 a day, median 30 on an active day. Probable hits 22, unclear 8. Share 73% (22 of 30), 95% interval ${Math.round(lo * 100)}-${Math.round(hi * 100)}%. Misses 0: no lesson 0, no match 0, filtered 0.`,
    '20 corrections or more and 20 firings or more: the share, its n and its Wilson interval');
  ok(/^H2 command lessons: 0 firings, 0 a day, median 0 on an active day\. Probable hits 0, unclear 0\. Cannot claim, n too small\. Misses 22: no lesson 22, no match 0, filtered 0\.$/.test(r.lines[2]), `a correction nothing was listed before, with no lesson of that kind: a miss with its cause (${r.lines[2]})`);
  ok(/^L2 stuck streak: .* Misses 22: no lesson 0, no match 22, filtered 0\./.test(r.lines[5]), `and with a lesson that could have matched: no match (${r.lines[5]})`);
  eq(r.history.firings.edit, 30, 'the history counts the firings');
}
// Under 20 corrections a 0% share and a count of no misses are no finding, only a journal without the signal: neither is printed.
{
  const r = run(shareJournal('C--replay-nosignal', 12));
  eq(r.lines[1], 'H1 edit lessons: 30 firings, 4.3 a day, median 30 on an active day. Probable hits 12, unclear 18. No correction signal (12 in 42 prompts).', '12 corrections: no share, no interval, no miss count');
  eq(r.lines[2], 'H2 command lessons: 0 firings, 0 a day, median 0 on an active day. Probable hits 0, unclear 0. No correction signal (12 in 42 prompts).', 'and for a trigger that never fired');
  ok(r.lines.slice(1, 9).filter((l) => !/^H5 /.test(l)).every((l) => /No correction signal \(12 in 42 prompts\)\./.test(l) && !/%|Misses|Share|interval/.test(l)), 'every line has the signal and none a percentage or a miss');
  eq(r.history.hits.edit, 12, 'the history still counts the hits');
}

// A hidden lesson is no lesson, and the scan counts it; a retired one existed but cannot fire.
{
  const H = store('C--replay-hidden');
  note(H, 'good.md', 'applies_to: [g.mjs]\n', 'Good lesson', 'Read g.mjs first.', at(20, 8));
  note(H, 'secret.md', 'applies_to: [s.mjs]\n', 'Secret <private> lesson', 'Do not show this.', at(20, 8));
  note(H, 'retired.md', 'applies_to: [r.mjs]\n', 'Retired lesson', 'Read r.mjs first.', at(20, 8));
  writeFileSync(join(H, '.lessons.json'), JSON.stringify({ v: 1, notes: { 'retired.md': { rev: 'ab', shown: 4, followed: 0, broken: 3, na: 0, unknown: 1, sessions: [], last: '2026-11-20', retired: 'broken 3', told: true } }, errors: {} }));
  journal(H, [E('h1', '2026-11-26 09:00', 'c1', 'go', { changed: ['s.mjs', 'g.mjs', 'r.mjs'] })]);
  const r = run(H, { show: true });
  ok(r.lines.some((l) => l === 'L17 scan: hides 1 of 3 notes.'), `the scan's count (${r.lines.join(' | ')})`);
  ok(/ 2 lessons existed at some point; 1 could fire\. /.test(r.lines[0]), `a retired lesson existed and cannot fire (${r.lines[0]})`);
  eq(r.lines.filter((l) => /\] edit /.test(l)).length, 1, 'only the lesson that shows and is not retired fires');
  ok(!/Secret|private/.test(r.lines.join('\n')), 'and nothing of the hidden one is printed');
}

// The caps: a lesson once per conversation, 2 an entry, 6 a conversation; one a cap held back can still fire later.
{
  const K = store('C--replay-caps');
  for (let i = 1; i <= 7; i++) note(K, `cap${i}.md`, `applies_to: [f${i}.mjs]\n`, `Cap ${i}`, `Mind f${i}.`, at(20, 8));
  journal(K, [E('c1', '2026-11-26 09:00', 's1', 'first', { changed: ['f1.mjs', 'f2.mjs', 'f3.mjs'] }), E('c2', '2026-11-26 09:10', 's1', 'again', { changed: ['f1.mjs'] }),
    E('c3', '2026-11-26 09:20', 's1', 'more', { changed: ['f3.mjs', 'f4.mjs'] }), E('c4', '2026-11-26 09:30', 's1', 'and more', { changed: ['f5.mjs', 'f6.mjs'] }),
    E('c5', '2026-11-26 09:40', 's1', 'last', { changed: ['f7.mjs'] }), E('c6', '2026-11-26 09:50', 's2', 'other conversation', { changed: ['f1.mjs'] })]);
  const r = run(K, { show: true });
  eq(r.lines.filter((l) => /\] edit /.test(l)).map((l) => `${/\[(\w+)\]/.exec(l)[1]} ${/edit (\S+):/.exec(l)[1]}`),
    ['c1 cap1.md', 'c1 cap2.md', 'c3 cap3.md', 'c3 cap4.md', 'c4 cap5.md', 'c4 cap6.md', 'c6 cap1.md'], 'two an entry (the third waits), none twice in a conversation, six a conversation (the seventh waits), a new conversation starts again');
}

// A lesson is dated by the LAST exchange that changed its file: the text replayed is today's, so a lesson written at 09:00 and reworded at
// 11:00 is not the lesson of the 10:00 exchange (an `applies_to` added at 11:00 must not fire in the past).
{
  const Z = store('C--replay-edited');
  note(Z, 'late-edit.md', 'applies_to: [z.mjs]\n', 'Reworded lesson', 'Mind z.mjs.');
  journal(Z, [E('z1', '2026-11-26 09:00', 's1', 'write the lesson', { changed: [join(Z, 'late-edit.md')] }), E('z2', '2026-11-26 10:00', 's2', 'touch z', { changed: ['z.mjs'] }),
    E('z3', '2026-11-26 11:00', 's3', 'reword the lesson', { changed: [join(Z, 'late-edit.md')] }), E('z4', '2026-11-26 12:00', 's4', 'touch z again', { changed: ['z.mjs'] })]);
  const r = run(Z, { show: true });
  eq(r.lines.filter((l) => /\] edit /.test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]), ['z4'], 'a lesson edited after an exchange does not fire on it: it exists from its last change');
  ok(/ 0 dated by file time\.$/.test(r.lines[0]), `and the journal dates it (${r.lines[0]})`);
}

// A probable hit is a correction of the same day: one on the next morning shares the file, and is not one.
{
  const D = store('C--replay-day');
  note(D, 'd-lesson.md', 'applies_to: [d.mjs]\n', 'Mind d', 'Mind d.mjs.', at(20, 8));
  journal(D, [E('d1', '2026-11-25 23:00', 's1', 'edit d', { changed: ['d.mjs'] }), E('d2', '2026-11-26 08:00', 's2', 'no, always run the tests for d.mjs')]);
  ok(/^H1 edit lessons: 1 firing,.* Probable hits 0, unclear 1\./.test(run(D).lines[1]), 'a correction the next day is no hit');
}

// The misses, with 20 corrections to count them against: one a day, each in its own conversation and each editing the file of the lesson,
// so a firing is in the correction's own entry and none in the 20 before it: a firing in the same entry is no firing before the correction.
{
  const M = store('C--replay-miss');
  note(M, 'm-lesson.md', 'applies_to: [w.mjs]\n', 'Mind w', 'Mind w.mjs.', new Date(2026, 9, 25, 8));
  journal(M, Array.from({ length: 20 }, (_, i) => E(`w${i}`, `2026-11-${String(i + 1).padStart(2, '0')} 09:00`, `c${i}`, 'no, always run the tests', { changed: ['w.mjs'] })));
  const r = run(M, { days: 31 }), [lo, hi] = wilson(0, 20);
  eq(r.lines[1], `H1 edit lessons: 20 firings, 0.6 a day, median 1 on an active day. Probable hits 0, unclear 20. Share 0% (0 of 20), 95% interval ${Math.round(lo * 100)}-${Math.round(hi * 100)}%. Misses 20: no lesson 0, no match 20, filtered 0.`,
    'a first prompt of a conversation that reads like a correction is counted, and its own entry is no firing before it');
}

// The nudge: at most 1 in 10 prompts and 3 in a conversation. 40 corrections in one conversation: the first prompt cannot be one, then
// the 2nd, the 12th and the 22nd prompt, and the 32nd is held back by the cap.
{
  const N = store('C--replay-nudge');
  journal(N, Array.from({ length: 40 }, (_, i) => E(`n${String(i + 1).padStart(2, '0')}`, `2026-11-26 ${String(8 + Math.floor(i / 12)).padStart(2, '0')}:${String(i % 12 * 5).padStart(2, '0')}`, 's1', 'no, always run the tests')));
  const r = run(N, { show: true });
  eq(r.lines.filter((l) => /\] nudge /.test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]), ['n02', 'n12', 'n22'], 'one nudge in 10 prompts, 3 in a conversation');
}

// Only a path inside the repository is a path a lesson is about: an absolute one, one outside the folder and a memory file are not.
{
  const I = store('C--replay-inside');
  note(I, 'q-lesson.md', 'applies_to: [**/q.mjs]\n', 'Mind q', 'Mind q.mjs.', at(20, 8));
  journal(I, ['/abs/dir/q.mjs', 'C:/abs/dir/q.mjs', '../other/q.mjs', '.claude/projects/p/memory/q.mjs', 'sub/q.mjs'].map((p, i) => E(`i${i + 1}`, `2026-11-26 09:${String(i * 10).padStart(2, '0')}`, `s${i + 1}`, 'touch q', { changed: [p] })));
  const r = run(I, { show: true });
  eq(r.lines.filter((l) => /\] edit /.test(l)).map((l) => /\[(\w+)\]/.exec(l)[1]), ['i5'], 'only sub/q.mjs fires: an absolute path, one with .., and a memory file do not');
}

// memory lessons: one line per lesson with its counters, the retired ones too, then the hidden ones and the errors past their startups.
{
  const C = store('C--replay-list');
  note(C, 'a-lesson.md', 'applies_to: [a.mjs]\n', 'Lesson A', 'Mind A.');
  note(C, 'b-lesson.md', 'applies_when: [push]\n', 'Lesson B', 'Mind B.');
  note(C, 'c-hidden.md', 'applies_to: [c.mjs]\n', 'Hidden <private> one', 'Never shown.');
  writeFileSync(join(C, '.lessons.json'), JSON.stringify({ v: 1, notes: {
    'a-lesson.md': { rev: 'deadbeef', shown: 9, followed: 6, broken: 1, na: 1, unknown: 1, sessions: [], last: '2026-11-26', retired: '', told: false },
    'b-lesson.md': { rev: 'deadbeef', shown: 4, followed: 0, broken: 3, na: 0, unknown: 1, sessions: [], last: '2026-11-20', retired: 'broken 3', told: true } }, errors: {} }));
  const lines = lessonsList(C, NOW);
  eq(lines.slice(0, 2), ['a-lesson.md   shown 9, followed 6, broken 1, not applicable 1, unknown 1; last 2026-11-26',
    'b-lesson.md   shown 4, followed 0, broken 3, not applicable 0, unknown 1; last 2026-11-20; retired: broken 3'], 'a lesson line, and a retired one with its reason');
  ok(lines.includes('Lessons the scan hides:') && lines.includes('c-hidden.md   holds <private>'), `the hidden ones, with their reason (${lines.join(' | ')})`);
  eq(snap(C).filter((x) => /\.enforce\.json/.test(x)), [], 'listing writes no cache');
  const none = lessonsList(store('C--replay-nolessons'), NOW);
  ok(none.length === 1 && /^no lessons in /.test(none[0]), `no lessons: said (${none})`);
}

console.log(`replay: ${checks} checks passed`);
