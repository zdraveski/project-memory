// Self-check for handoff-log.mjs: a synthetic transcript whose only prompt
// sits beyond the first tail window, records that must not become an "ask",
// an existing section that must be merged, damaged files, and the two-hook
// race. Run: node handoff-log.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync, readdirSync, utimesSync, appendFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { tool, tempHome, storeFor } from './harness.mjs';

const HOOK = tool('handoff-log.mjs'), TIER = tool('memory-tier.mjs');
const { home, env } = tempHome('hl-test-');
// The hooks in this process too, under the same throwaway HOME: a check that
// needs no stdin or exit code calls handoff() itself, not a node start per turn.
process.env.HOME = home; process.env.USERPROFILE = home;
const { handoff, edited, plain } = await import('./handoff-log.mjs');
const cwd = 'C:\\handoff-log-selftest';
const dir = storeFor(home, cwd);
const transcript = join(dir, 'transcript.jsonl');
mkdirSync(dir, { recursive: true });
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const rec = (type, content, extra = {}) => JSON.stringify({ type, timestamp: extra.ts || '2026-09-11T07:00:00Z', message: { content }, ...extra });
const user = (s, extra) => rec('user', [{ type: 'text', text: s }], extra);
const asst = (s, extra) => rec('assistant', [{ type: 'text', text: s }], extra);
const tool_ = (n) => rec('user', [{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(n) }]);
const append = (...lines) => writeFileSync(transcript, lines.join('\n') + '\n', { flag: 'a' });

const run = () => execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd, transcript_path: transcript }), env });
const doc = () => readFileSync(join(dir, 'handoff.md'), 'utf8');
const section = () => { const d = doc(); return d.slice(d.lastIndexOf('<!-- auto:start -->'), d.lastIndexOf('<!-- auto:end -->')); };
// What --print says apart from the shared store's one line, which every
// session gets while nothing is shared yet (section 27 checks that line).
const bare = (s) => s.replace(/^Shared memory: lessons that hold in every project[^\n]*\n/m, '');
const entries = () => (section().match(/\*\*asked\*\*/g) || []).length;

// 1. One prompt, then 700 KB of tool output, then the answer: beyond a 512 KB tail.
writeFileSync(transcript, '');
append(user('<command-name>/model</command-name>'), user('first real question', { ts: '2026-09-11T07:01:00Z' }), asst('working on it'),
  tool_(700_000), user('Base directory for this skill: whatever', { isMeta: true }), asst('the final answer'));
run();
ok(/asked\*\* \S+ \S+: first real question\n  \*\*did:\*\* the final answer/.test(section()), 'prompt beyond the first tail window was found');
ok(!/Base directory/.test(section()), 'an isMeta record is not an ask');
ok(entries() === 1, 'one exchange');

// 2. Rerun: byte-identical and not rewritten. The stamp line is put back an
// hour, as it is on any turn after the first: a rewrite would refresh it.
writeFileSync(join(dir, 'handoff.md'), doc().replace(/Last: \S+ \S+\._/, 'Last: 2000-01-01 00:00._'));
const once = doc(), mtime = statSync(join(dir, 'handoff.md')).mtimeMs;
run();
ok(doc() === once && statSync(join(dir, 'handoff.md')).mtimeMs === mtime, 'rerun changes nothing and does not rewrite the file');

// 3. Twelve more turns, one at a time, each behind 600 KB of tool output: accumulates and caps at 10.
for (let i = 2; i <= 13; i++) { append(user(`question ${i}`, { ts: `2026-09-11T07:${String(i).padStart(2, '0')}:00Z` }), asst(`answer ${i}`), tool_(600_000)); handoff({ cwd, transcript_path: transcript }); }
ok(entries() === 10 && !/first real question/.test(section()), 'capped at ten, oldest fell off');
ok(/question 4[\s\S]*question 13/.test(section()), 'ordered by time, newest last');

// 4. Hand-written prose around the markers survives.
writeFileSync(join(dir, 'handoff.md'), doc().replace('## Last 10 exchanges', '## Hand-written state\n\nkeep me\n\n## Last 10 exchanges'));
run();
ok(/keep me/.test(doc()), 'prose outside the markers survives');

// 5. The end marker is lost and prose follows the orphaned start; two runs must not swallow it.
writeFileSync(join(dir, 'handoff.md'), doc().replace('<!-- auto:end -->', '') + '\nprose after the orphan\n');
run(); run();
ok(/prose after the orphan/.test(doc()) && (doc().match(/<!-- auto:end -->/g) || []).length === 1, 'prose after an orphaned start marker survives, one live section');

// 6. Records that are not asks: an interrupt, a compaction summary.
append(user('[Request interrupted by user for tool use]', { ts: '2026-09-11T08:00:00Z' }), asst('stopped'));
append(user('This session is being continued from a previous conversation', { ts: '2026-09-11T08:01:00Z', isCompactSummary: true }), asst('continuing'));
run();
ok(!/Request interrupted|being continued/.test(section()), 'interrupts and compaction summaries are not asks');

// 7. Marker text inside a prompt must not become the section boundary.
const markers = () => (doc().match(/<!-- auto:(start|end) -->/g) || []).length;
const before = markers();   // step 5 left an inert orphan on purpose
append(user('please keep <!-- auto:start --> literally', { ts: '2026-09-11T08:02:00Z' }), asst('kept <!-- auto:end --> too'));
run(); run();
ok(markers() === before && /please keep <!- - auto:start -->/.test(section()), 'marker in a prompt is defused, not dropped');

// 8. An emptied handoff.md gets its frontmatter back, so tiering keeps it hot.
writeFileSync(join(dir, 'handoff.md'), '');
run();
ok(/^---\nname: handoff[\s\S]*tier: hot/.test(doc()), 'frontmatter restored on an empty file');

// 9. Saved as CRLF by an editor: existing entries still parse and merge.
const prior = entries();
writeFileSync(join(dir, 'handoff.md'), doc().replace(/\n/g, '\r\n'));
append(tool_(600_000), user('question 14', { ts: '2026-09-11T07:14:00Z' }), asst('answer 14'));
run();
ok(entries() === prior + 1 && /question 14/.test(section()), 'CRLF entries survive a merge');

// 10. Damaged inputs: exit 0, no temp file, prose intact.
// BOM first: `\s` matches U+FEFF in JavaScript, so collapsing whitespace would turn it into a space.
const prose = () => doc().replace(/^﻿/, '').replace(/<!-- auto:start -->[\s\S]*<!-- auto:end -->/, '').replace(/\s+/g, ' ');
const keep = prose();
for (const [name, breakIt] of Object.entries({
  'read-only handoff': () => chmodSync(join(dir, 'handoff.md'), 0o444),
  'BOM on handoff': () => writeFileSync(join(dir, 'handoff.md'), '\uFEFF' + doc()),
  'empty transcript': () => writeFileSync(transcript, ''),
  'transcript is not JSON': () => writeFileSync(transcript, 'hello\nworld\n'),
  'transcript has only tool results': () => writeFileSync(transcript, tool_(10) + '\n'),
})) {
  breakIt();
  let status = 0; try { run(); } catch (e) { status = e.status; }
  chmodSync(join(dir, 'handoff.md'), 0o644);
  const p = prose().replace(/^\uFEFF/, '');
  let at = 0; while (at < p.length && p[at] === keep[at]) at++;
  ok(status === 0 && !readdirSync(dir).some((f) => f.includes('.tmp')) && p === keep,
    `${name}: exit 0, no temp file, prose intact (status ${status}; ${p.length} vs ${keep.length} chars, first diff at ${at}: ${JSON.stringify(p.slice(at - 20, at + 40))} vs ${JSON.stringify(keep.slice(at - 20, at + 40))})`);
}

// 11. The handoff write and the tiering pass, in parallel, twenty rounds: no lost write, no temp file.
writeFileSync(join(dir, 'MEMORY.md'), '# Index\n\n- [handoff](handoff.md) — the rolling handoff\n');
let lost = 0, leaks = 0;
for (let i = 0; i < 20; i++) {
  append(user(`race question ${i}`, { ts: `2026-09-11T09:${String(i).padStart(2, '0')}:00Z` }), asst(`race answer ${i}`));
  const input = JSON.stringify({ cwd, transcript_path: transcript });
  const procs = [spawn(process.execPath, [HOOK], { env }), spawn(process.execPath, [TIER, '--dir', dir], { env })];
  for (const p of procs) p.stdin.end(input);
  await Promise.all(procs.map((p) => new Promise((res) => p.on('close', res))));
  if (!doc().includes(`race question ${i}`)) lost++;
  leaks += readdirSync(dir).filter((f) => f.includes('.tmp')).length;
}
ok(lost === 0 && leaks === 0, `two hooks in parallel x20: no lost write, no temp file (lost ${lost}, temp files ${leaks}: ${readdirSync(dir).filter((f) => f.includes('.tmp')).join(', ')})`);

// 12. `--print` (SessionStart after a compaction): the section, without markers; nothing for an unknown store.
const printed = execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd }), env }).toString();
ok(/race question 19/.test(printed) && !/<!-- auto:/.test(printed), '--print gives the last exchanges, markers stripped');
const none = execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: 'C:\\no-such-project' }), env }).toString();
ok(bare(none) === '', '--print says nothing for a project with no handoff');

// 13. The compaction gate's Stop nudge enters the conversation as a user record: it is
// not an ask, and the words the model writes after it (the memory update) do not
// replace what the turn did.
// Stamped after every other turn: the section keeps the newest ten, so an
// older stamp would hide the nudge from this check whether or not it is an ask.
append(user('the real question', { ts: '2026-09-11T10:00:00Z' }), asst('the real answer'),
  user('[SYSTEM: compaction gate] Context is at 96% of the compaction window: update memory now.', { ts: '2026-09-11T10:01:00Z' }),
  asst('Memory updated.'));
run();
ok(!/compaction gate/.test(section()), 'a nudge is not an ask');
ok(/the real question\n  \*\*did:\*\* the real answer$/m.test(section()), 'and the answer before it is the one kept');

// 14. Sessions of one project: each keeps its own last ten, for the three most recent.
const cwdS = 'C:\\handoff-sessions';
const dirS = storeFor(home, cwdS);
mkdirSync(dirS, { recursive: true });
const docS = () => readFileSync(join(dirS, 'handoff.md'), 'utf8');
// Where Claude Code keeps them: the project folder, named by session id.
const turnIn = (id, i, iso) => {
  const t = join(dirname(dirS), `${id}.jsonl`);
  writeFileSync(t, user(`${id.slice(0, 4)} q${i}`, { ts: iso }) + '\n' + asst(`${id.slice(0, 4)} a${i}`) + '\n', { flag: 'a' });
  handoff({ cwd: cwdS, transcript_path: t, session_id: id });   // 37 turns in order: in process, not 37 node starts
};
const isoAt = (day, i) => `2026-09-${day}T08:${String(i).padStart(2, '0')}:00Z`;
for (const [k, id] of ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3'].entries()) for (let i = 0; i < 12; i++) turnIn(id, i, isoAt(11 + k, i));
const tagged = (t) => (docS().match(new RegExp(`\\*\\*asked\\*\\* \\S+ \\S+ \\[${t}\\]`, 'g')) || []).length;
ok(tagged('aaaaaaaa') === 10 && tagged('bbbbbbbb') === 10 && tagged('cccccccc') === 10, 'three sessions keep ten exchanges each, tagged');
turnIn('dddddddd-4', 0, isoAt(14, 0));
ok(tagged('aaaaaaaa') === 0 && tagged('dddddddd') === 1 && tagged('bbbbbbbb') === 10, 'a fourth session pushes out the one that went quiet first');

// 15. After a compaction a session gets back its own exchanges, and a line for any other working here now.
const nowIso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
turnIn('dddddddd-4', 1, nowIso(5));
// The others' transcripts last moved when they did: weeks ago.
const weeksAgo = new Date(Date.now() - 14 * 86400000);
for (const id of ['aaaaaaaa-1', 'bbbbbbbb-2', 'cccccccc-3']) utimesSync(join(dirname(dirS), `${id}.jsonl`), weeksAgo, weeksAgo);
const printS = (session_id, source) => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdS, session_id, source }), env }).toString();
const pc = printS('cccccccc-3', 'compact');
ok(/cccc q11/.test(pc) && !/bbbb q/.test(pc) && !/dddd q0/.test(pc), 'a compacted session is given its own exchanges only');
ok(/Another session is working in this project: \S+ \S+ \[dddddddd\] dddd q1/.test(pc), 'and told who else is working here');
ok(!/Another session[^\n]*bbbbbbbb/.test(pc), 'a session quiet for weeks is not called working');
// A session with no entries of its own yet (cut in its first turn) is shown the
// newest ten, not all three sessions' thirty: ~5k tokens (final review, 2026-10-26).
const pf = printS('ffffffff-6', 'compact');
const shownF = (pf.match(/\*\*asked\*\*/g) || []).length;
ok(shownF === 10 && /dddd q1/.test(pf), `a session with no entries of its own is shown the newest ten (got ${shownF})`);

// 16. At startup: who is working here now, or where the last session stopped; then anything failing.
const ps = printS('eeeeeeee-5', 'startup');
ok(/^Another session is working in this project: \S+ \S+ \[dddddddd\] dddd q1$/m.test(ps) && !/Last session here/.test(ps), 'startup names the session working here now');
ok(!/Another session/.test(printS('dddddddd-4', 'startup')), 'and never names a session to itself');
const cwdL = 'C:\\handoff-last';
const dirL = storeFor(home, cwdL);
mkdirSync(dirL, { recursive: true });
const localAt = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toLocaleString('sv-SE').slice(0, 16);
const handoffAt = (daysAgo) => writeFileSync(join(dirL, 'handoff.md'),
  `---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** ${localAt(daysAgo)} [ffffffff]: the old question\n  **did:** the old answer\n<!-- auto:end -->\n`);
const startup = () => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdL, session_id: 'gggggggg-7', source: 'startup' }), env }).toString();
handoffAt(2);
ok(/^Last session here ended \S+ \S+ on: the old question/m.test(startup()), 'startup says where a recent session stopped');
const clearL = () => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdL, session_id: 'gggggggg-7', source: 'clear' }), env }).toString();
// After /clear, the conversation just cleared is the newest transcript and the
// last entry: neither is named, or the cleared ask comes back.
writeFileSync(join(dirname(dirL), 'ffffffff-1.jsonl'), user('the cleared ask', { ts: nowIso(1) }) + '\n');
ok(/Another session is working/.test(startup()) && !/Another session|Last session here/.test(clearL()), 'a /clear names neither the conversation it cleared nor its ask');
rmSync(join(dirname(dirL), 'ffffffff-1.jsonl'));
handoffAt(10);
ok(bare(startup()) === '', 'and nothing about one ten days old');
writeFileSync(join(dirL, '.health'), 'over budget: 9000B > 7000B\n');
writeFileSync(join(home, '.claude', 'projects', '.snapshot-health'), JSON.stringify({ lastOk: '2026-10-01T00:00:00Z', failures: 3, error: 'git not found' }));
const warn = startup();
ok(/Memory store needs attention[^\n]*over budget/.test(warn) && /snapshots have failed 3 times/.test(warn), 'and warns when the store or the snapshots are failing');
writeFileSync(join(home, '.claude', 'projects', '.snapshot-health'), 'not json');
writeFileSync(join(dirL, 'handoff.md'), 'no markers at all\n');
ok(/Memory store needs attention/.test(startup()), 'a damaged handoff.md or health file is no crash');
rmSync(join(dirL, '.health'));

// 17. A nudge Claude Code hands back behind a prefix, and any other [SYSTEM record, is not an ask.
append(user('a question before the gate', { ts: '2026-09-11T11:00:00Z' }), asst('its answer'),
  user('Stop hook feedback:\n[SYSTEM: compaction gate] Context is at 86% of the compaction window.', { ts: '2026-09-11T11:01:00Z' }), asst('Memory updated.'),
  user('[SYSTEM: reminder] not a question', { ts: '2026-09-11T11:02:00Z' }), asst('noted'));
run();
ok(!/Stop hook feedback|compaction gate|not a question/.test(section()), 'a prefixed nudge, or another [SYSTEM record, is not an ask');
ok(/a question before the gate\n  \*\*did:\*\* its answer$/m.test(section()), 'and a prefixed nudge freezes the answer as the bare one does');

// 18. Sessions ending a turn at the same moment. Without the store lock, 8 at
// once lost 22 of 40 turns (2026-10-26).
const cwdP = 'C:\\handoff-parallel';
const dirP = storeFor(home, cwdP);
mkdirSync(dirP, { recursive: true });
const hookAt = (payload) => new Promise((res) => { const c = spawn(process.execPath, [HOOK], { env }); c.on('close', res); c.stdin.end(JSON.stringify(payload)); });
let missed = 0;
for (let round = 0; round < 5; round++) {
  const payloads = Array.from({ length: 8 }, (_, k) => {
    const t = join(dirP, `p${k}.jsonl`);
    writeFileSync(t, user(`round ${round} writer ${k}`, { ts: `2026-09-12T0${round}:${String(k).padStart(2, '0')}:00Z` }) + '\n' + asst('ok') + '\n');
    return { cwd: cwdP, transcript_path: t };
  });
  rmSync(join(dirP, 'handoff.md'), { force: true });
  await Promise.all(payloads.map(hookAt));
  const d = readFileSync(join(dirP, 'handoff.md'), 'utf8');
  missed += payloads.filter((_, k) => !d.includes(`round ${round} writer ${k}`)).length;
}
ok(missed === 0, `8 writers at once x5: every turn reaches handoff.md (${missed} of 40 missing)`);
for (let round = 0; round < 5; round++) {
  await Promise.all(['s1aaaaaa', 's2bbbbbb', 's3cccccc'].map((id) => {
    const t = join(dirP, `${id}.jsonl`);
    writeFileSync(t, user(`${id} turn ${round}`, { ts: `2026-09-13T0${round}:00:00Z` }) + '\n' + asst('ok') + '\n', { flag: 'a' });
    return hookAt({ cwd: cwdP, transcript_path: t, session_id: id });
  }));
}
const dp = readFileSync(join(dirP, 'handoff.md'), 'utf8');
let threeMissed = 0;
for (const id of ['s1aaaaaa', 's2bbbbbb', 's3cccccc']) for (let round = 0; round < 5; round++) if (!dp.includes(`${id} turn ${round}`)) threeMissed++;
ok(threeMissed === 0, `three sessions ending turns together x5: all fifteen kept (${threeMissed} missing)`);
// Another hook holding the store: this turn's write waits, then is left for the next turn.
const held = readFileSync(join(dirP, 'handoff.md'), 'utf8');
writeFileSync(join(dirP, 's1aaaaaa.jsonl'), user('s1aaaaaa while held', { ts: '2026-09-13T09:00:00Z' }) + '\n' + asst('ok') + '\n', { flag: 'a' });
mkdirSync(join(dirP, '.lock'));
// In this process, for the answer: the compaction gate names a held store as
// that, not as one with nothing to write.
const t0 = Date.now();
const heldSays = handoff({ cwd: cwdP, transcript_path: join(dirP, 's1aaaaaa.jsonl'), session_id: 's1aaaaaa' });
ok(readFileSync(join(dirP, 'handoff.md'), 'utf8') === held && Date.now() - t0 >= 1900, 'a store another hook holds is waited on, then left alone');
ok(heldSays === 'busy', `and the writer says busy, not nothing to write (got ${heldSays})`);
rmSync(join(dirP, '.lock'), { recursive: true });

// 19. Two sessions typing the same thing in the same minute ("continue") are two
// turns, not one: each Stop used to drop the other's entry (final review, 2026-10-26).
const cwdK = 'C:\\handoff-same-ask';
const dirK = storeFor(home, cwdK);
mkdirSync(dirK, { recursive: true });
const sameAsk = (id) => {
  const t = join(dirK, `${id}.jsonl`);
  writeFileSync(t, user('continue', { ts: '2026-09-14T10:00:00Z' }) + '\n' + asst(`${id} went on`) + '\n');
  execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdK, transcript_path: t, session_id: id }), env });
};
const kd = () => readFileSync(join(dirK, 'handoff.md'), 'utf8');
sameAsk('aaaaaaaa-1'); sameAsk('bbbbbbbb-2'); sameAsk('aaaaaaaa-1');
ok(/\[aaaaaaaa\]: continue/.test(kd()) && /\[bbbbbbbb\]: continue/.test(kd()), 'the same ask in the same minute from two sessions keeps both');
// An entry written before tags existed is its session's own when time and ask
// match: re-seen with a tag, it is replaced, not kept beside.
writeFileSync(join(dirK, 'handoff.md'), kd().replace(/ \[bbbbbbbb\]: continue/, ': continue'));
ok(/\d: continue/.test(kd()), 'the setup really left an untagged entry');
sameAsk('bbbbbbbb-2');
ok((kd().match(/: continue/g) || []).length === 2 && /\[bbbbbbbb\]: continue/.test(kd()), 'an untagged entry is replaced by its tagged re-sighting, not duplicated');

// 20. A prompt that mentions tool_use_id is a prompt: a filter meant for tool
// results, which carry no text, dropped 7 real ones (audit, 2026-10-26).
const cwdU = 'C:\\handoff-others';
const dirU = storeFor(home, cwdU);
mkdirSync(dirU, { recursive: true });
const turnU = (id, ask, ts) => {
  const t = join(dirname(dirU), `${id}.jsonl`);
  writeFileSync(t, user(ask, { ts }) + '\n' + asst('ok') + '\n');
  execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdU, transcript_path: t, session_id: id }), env });
};
turnU('uuuuuuuu-1', 'why does a tool_use_id repeat?', '2026-09-15T10:00:00Z');
ok(/why does a tool_use_id repeat\?/.test(readFileSync(join(dirU, 'handoff.md'), 'utf8')), 'a prompt that mentions tool_use_id is an ask');
utimesSync(join(dirname(dirU), 'uuuuuuuu-1.jsonl'), weeksAgo, weeksAgo);

// 21. The startup line names at most two other sessions, the newest two.
for (const [k, id] of ['h1hhhhhh', 'h2hhhhhh', 'h3hhhhhh'].entries()) turnU(id, `${id} working`, nowIso(10 - k));
const named = execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdU, session_id: 'iiiiiiii-9', source: 'startup' }), env }).toString();
ok((named.match(/^Another session/gm) || []).length === 2 && /h3hhhhhh/.test(named) && /h2hhhhhh/.test(named), `at most two other sessions are named, the newest (got: ${named.trim()})`);

// 22. An untagged entry whose ask opens with "[word]: " is still untagged: the
// time took the colon and the word read as a session, so its tagged
// re-sighting was kept beside it (audit, 2026-10-26).
const cwdB = 'C:\\handoff-bracket';
const dirB = storeFor(home, cwdB);
mkdirSync(dirB, { recursive: true });
const tb = join(dirB, 'b.jsonl');
writeFileSync(tb, user('[URGENT]: fix the build', { ts: '2026-09-16T10:00:00Z' }) + '\n' + asst('ok') + '\n');
const bracket = () => execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdB, transcript_path: tb, session_id: 'jjjjjjjj-1' }), env });
bracket();
writeFileSync(join(dirB, 'handoff.md'), readFileSync(join(dirB, 'handoff.md'), 'utf8').replace(' [jjjjjjjj]: [URGENT]', ': [URGENT]'));
bracket();
const hb = readFileSync(join(dirB, 'handoff.md'), 'utf8');
ok((hb.match(/fix the build/g) || []).length === 1 && /\[jjjjjjjj\]: \[URGENT\]: fix the build/.test(hb), 'an untagged ask opening with [word]: is replaced by its re-sighting, not kept beside');

// 23. Working is judged by the transcript, not the ask: a session an hour into
// one prompt was called ended while it worked (2026-10-26).
const cwdW = 'C:\\handoff-working';
const dirW = storeFor(home, cwdW);
mkdirSync(dirW, { recursive: true });
const tw = join(dirname(dirW), 'wwwwwwww-1.jsonl');
writeFileSync(tw, user('a long job', { ts: nowIso(60) }) + '\n' + asst('step 1') + '\n');
execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdW, transcript_path: tw, session_id: 'wwwwwwww-1' }), env });
appendFileSync(tw, asst('step 40') + '\n');
const printW = () => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdW, session_id: 'xxxxxxxx-2', source: 'startup' }), env }).toString();
ok(/^Another session is working in this project: \S+ \S+ \[wwwwwwww\] a long job$/m.test(printW()), 'a session an hour into one prompt is still working');
const hourAgo = new Date(Date.now() - 60 * 60000);
utimesSync(tw, hourAgo, hourAgo);
ok(!/Another session/.test(printW()) && /Last session here ended/.test(printW()), 'one whose transcript has not moved for an hour is not');
writeFileSync(join(dirname(dirW), 'ffffffff-3.jsonl'), user('a first prompt', { ts: nowIso(1) }) + '\n');
ok(/^Another session is working in this project: \S+ \S+ \[ffffffff\] \(no handoff entry\)$/m.test(printW()), 'and one still in its first turn is named all the same');

// 24. A Stop hook that stopped running is said at startup: its output reaches
// nobody, so an unwired or crashing hook was silence. Every Stop touches
// .stop-ran; a turn another session finished after it went unrecorded.
const cwdT = 'C:\\handoff-stalled';
const dirT = storeFor(home, cwdT);
mkdirSync(dirT, { recursive: true });
const tt = join(dirname(dirT), 'tttttttt-1.jsonl');
const ended = (minAgo) => JSON.stringify({ type: 'assistant', timestamp: nowIso(minAgo),
  message: { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } } });
writeFileSync(tt, user('q', { ts: nowIso(10) }) + '\n' + ended(5) + '\n');
// A project the hook keeps a handoff for: one with none is judged by nothing.
execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdT, transcript_path: tt, session_id: 'tttttttt-1' }), env });
const ranAt = (minAgo) => { const p = join(home, '.claude', 'projects', '.stop-ran'); writeFileSync(p, 'x'); const d = new Date(Date.now() - minAgo * 60000); utimesSync(p, d, d); };
const printT = () => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdT, session_id: 'zzzzzzzz-9', source: 'startup' }), env }).toString();
// No .stop-ran: the hooks just installed, or the file cleaned away. That is
// not knowing, and it read as "never ran" in 6 of 8 real projects (review, 2026-10-26).
ok(!/Memory hooks/.test(printT()), 'no .stop-ran yet: nothing said');
ranAt(20);
ok(/^Memory hooks look stopped: \[tttttttt\] finished a turn at [^\n]*Run: node "[^"\n]*memory\.mjs" doctor$/m.test(printT()), 'a turn finished after the Stop hook last ran is reported, with the check that says why, whichever way the hooks are wired');
ranAt(4);
ok(!/Memory hooks/.test(printT()), 'and nothing once the hook has run since');
writeFileSync(tt, user('q', { ts: nowIso(10) }) + '\n' + ended(0.2) + '\n');
ranAt(20);
ok(!/Memory hooks/.test(printT()), 'nor for a turn that ended seconds ago, whose Stop hook may still be starting');
writeFileSync(tt, Array.from({ length: 60 }, (_, i) => JSON.stringify({ type: 'assistant', timestamp: nowIso(5), msg: { text: `x${i}` } })).join('\n') + '\n');
ok(/^Memory hooks cannot read \[tttttttt\]/m.test(printT()), 'a transcript whose format the hooks cannot read is reported');
// A session's start-up records (attachments, modes, titles) before any reply
// ran to 41 in a real transcript: they are not messages, and no drift.
writeFileSync(tt, Array.from({ length: 60 }, () => JSON.stringify({ type: 'attachment', timestamp: nowIso(5) })).join('\n') + '\n');
ok(!/Memory hooks/.test(printT()), "a session's start-up records before any reply are no drift");
// A project with no handoff (`claude -p` runs that load no user hooks) is not
// judged: its finished turns were never the hook's to record.
const cwdN = 'C:\\handoff-no-hooks';
mkdirSync(storeFor(home, cwdN), { recursive: true });
writeFileSync(join(dirname(storeFor(home, cwdN)), 'nnnnnnnn-1.jsonl'), user('q', { ts: nowIso(10) }) + '\n' + ended(5) + '\n');
ok(!/Memory hooks/.test(execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdN, session_id: 'zzzzzzzz-9', source: 'startup' }), env }).toString()), 'a project with no handoff is not judged');

// 26. The hooks run from a copy deploy.mjs makes after the full check: an edit
// in the repo was live before any test ran. An edit to that copy is live and
// untested, so the startup line names it.
const { install } = await import('./deploy.mjs');
const liveDir = join(home, 'hooks-live');
install(dirname(HOOK), liveDir, 'test');
const printLive = () => execFileSync(process.execPath, [join(liveDir, 'handoff-log.mjs'), '--print'], { input: JSON.stringify({ cwd: cwdT, session_id: 'zzzzzzzz-9', source: 'startup' }), env }).toString();
ok(!/outside deploy/.test(printLive()), 'a deployed copy as deployed: nothing said');
// A damaged manifest says nothing, and costs nothing else: thrown, it took the
// whole startup line with it, the other-session warning too (review, 2026-10-26).
const asDeployed = readFileSync(join(liveDir, '.deployed.json'), 'utf8'), whole = printLive();
// Run through a symlinked folder (a dotfiles-managed ~/.claude, macOS's /var):
// Node names the script by its real path, and a hook that compared the path
// it was given ran nothing at all, silently.
symlinkSync(liveDir, join(home, 'linked-live'), 'junction');
const viaLink = execFileSync(process.execPath, [join(home, 'linked-live', 'handoff-log.mjs'), '--print'], { input: JSON.stringify({ cwd: cwdT, session_id: 'zzzzzzzz-9', source: 'startup' }), env }).toString();
ok(whole && viaLink === whole, `a hook run through a symlinked folder still runs (got ${JSON.stringify(viaLink)})`);
for (const bad of ['{}', 'null', '{"files":null}']) {
  writeFileSync(join(liveDir, '.deployed.json'), bad);
  ok(whole && printLive() === whole, `a manifest of ${bad} costs the startup line nothing`);
}
writeFileSync(join(liveDir, '.deployed.json'), asDeployed);
ok(JSON.parse(readFileSync(join(liveDir, '.deployed.json'), 'utf8')).commit === 'test' && !readdirSync(liveDir, { recursive: true }).some((f) => f.endsWith('.tmp')), 'the manifest names its commit, and no temp file is left');
appendFileSync(join(liveDir, 'compact-gate.mjs'), '\n// a quick fix\n');
rmSync(join(liveDir, 'memory-tier.mjs'));
ok(/^Memory hooks changed outside deploy\.mjs, live and untested: compact-gate\.mjs, memory-tier\.mjs in /m.test(printLive()), 'an edit to the deployed copy, or a file gone from it, is named');
// Claude Code keeps a cached copy of an installed plugin per version: each deploy is a new one.
const liveV = join(home, 'hooks-live-v');
install(dirname(HOOK), liveV, 'test', 42, 'C:\\Program Files\\nodejs\\node.exe');
const stamped = JSON.parse(readFileSync(join(liveV, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const liveHooks = JSON.parse(readFileSync(join(liveV, 'hooks', 'hooks.json'), 'utf8')).hooks;
ok(Object.values(liveHooks).flat().flatMap((e) => e.hooks).every((x) => x.command === 'C:/Program Files/nodejs/node.exe'), "the live plugin runs the deploying node by its path, not whatever node is on PATH");
ok(/^\d+\.\d+\.42$/.test(stamped) && edited(liveV).length === 0, `the live plugin's version carries the deploy's number, and the manifest hashes what was written (got ${stamped})`);
// A file whose size and mtime are as deployed is not read: hashing every one
// was most of a startup's own time. One whose stat moved is read, and named
// only if its bytes changed.
const mV = readFileSync(join(liveV, '.deployed.json'), 'utf8'), later = new Date(Date.now() + 5000);
writeFileSync(join(liveV, '.deployed.json'), mV.replace(/("store\.mjs":")[0-9a-f]+/, '$1not-its-hash'));
ok(/not-its-hash/.test(readFileSync(join(liveV, '.deployed.json'), 'utf8')) && edited(liveV).length === 0, 'a file whose size and mtime are as deployed is not read');
writeFileSync(join(liveV, '.deployed.json'), mV);
utimesSync(join(liveV, 'handoff-log.mjs'), later, later);
ok(edited(liveV).length === 0, 'a file touched but not changed is not named');
const storeText = readFileSync(join(liveV, 'store.mjs'), 'utf8');
writeFileSync(join(liveV, 'store.mjs'), storeText.replace('BUDGET', 'BUDGEX'));
utimesSync(join(liveV, 'store.mjs'), later, later);
ok(/^Memory hooks changed outside deploy\.mjs, live and untested: store\.mjs in /.test(edited(liveV)[0] || ''), 'an edit that keeps the size is still named');
// deploy.mjs refuses before any check, from a branch or with uncommitted
// changes, in a repo of its own files (and no suites: a gate gone fails fast,
// on another message). Its last gate, HEAD unchanged after the check, needs a
// nine-minute check to reach; not tested here.
const gated = join(home, 'gated');
mkdirSync(gated, { recursive: true });
for (const f of ['deploy.mjs', 'store.mjs', 'handoff-log.mjs', 'memory.mjs', 'compact-gate.mjs']) writeFileSync(join(gated, f), readFileSync(join(dirname(HOOK), f)));
const g = (...a) => execFileSync('git', ['-C', gated, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env, encoding: 'utf8' });
g('init', '-q', '-b', 'master'); g('add', '-A'); g('commit', '-qm', 'base'); g('checkout', '-qb', 'other');
let gate = spawnSync(process.execPath, [join(gated, 'deploy.mjs')], { env, encoding: 'utf8' });
ok(gate.status === 1 && /deploy from master/.test(gate.stderr) && !existsSync(join(home, '.claude', 'hooks-live')), `deploy refuses a branch, before any check (got ${gate.stderr.trim()})`);
g('checkout', '-q', 'master');
appendFileSync(join(gated, 'store.mjs'), '// an edit\n');
gate = spawnSync(process.execPath, [join(gated, 'deploy.mjs')], { env, encoding: 'utf8' });
ok(gate.status === 1 && /uncommitted changes/.test(gate.stderr), `and uncommitted changes (got ${gate.stderr.trim()})`);

// 28. An answer's markdown marks carry no words: dropped before the 400 characters are counted.
const cwdM = 'C:\\handoff-markdown';
const dirM = storeFor(home, cwdM);
mkdirSync(dirM, { recursive: true });
const tM = join(dirname(dirM), 'mmmmmmmm-1.jsonl');
writeFileSync(tM, user('## a question with **marks** | kept', { ts: nowIso(1) }) + '\n' + asst('## Head\n**bold** text\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- item - one') + '\n');
execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: cwdM, transcript_path: tM, session_id: 'mmmmmmmm-1' }), env });
const docM = readFileSync(join(dirM, 'handoff.md'), 'utf8');
ok(/\*\*did:\*\* Head bold text a b 1 2 - item - one$/m.test(docM), `an answer's heading marks, bold and table rules are dropped (got ${docM.match(/\*\*did:\*\*.*$/m)})`);
ok(/: ## a question with \*\*marks\*\* \| kept$/m.test(docM), 'an ask is the user\'s words, kept as typed');
for (const s of ['2**32 and 2**64', '**kwargs and **opts', '__init__.py', 'a || b', 'a ** b ** c', 'x**y** z']) ok(plain(s) === s, `only marks go: "${s}" keeps its meaning`);
ok(plain('**The 3 parties:** 1. **You**, the (**owner**)') === 'The 3 parties: 1. You, the (owner)', 'and bold that hugs its words is dropped');
// Sized so the cubic pattern this replaced takes seconds, not hours: it fails
// the check instead of hanging the mutation run, and 2 s holds under its load.
const tPlain = Date.now();
plain(' \n'.repeat(1500) + 'x'); plain('-\n'.repeat(1500) + 'x'); plain(' - '.repeat(20000) + 'x'); plain('**a '.repeat(20000));
ok(Date.now() - tPlain < 2000, `blank, dash and unclosed-bold runs take no time (took ${Date.now() - tPlain} ms; a pattern across newlines was cubic)`);

// 27. The shared store, printed into every session of every project: Claude
// Code loads only the project's own index.
const sharedDir = join(home, '.claude', 'projects', '_shared', 'memory');
const cwdX = 'C:\\handoff-shared';
const dirX = storeFor(home, cwdX);
mkdirSync(dirX, { recursive: true });
const printX = (source) => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd: cwdX, session_id: 'xxxxxxxx-1', source }), env }).toString();
ok(/^Shared memory: lessons that hold in every project[^\n]*_shared[\\/]memory/m.test(printX('startup')), 'no shared store yet: one line says where such a lesson goes');
mkdirSync(sharedDir, { recursive: true });
writeFileSync(join(sharedDir, 'MEMORY.md'), '\uFEFF- [No git add -A](no-add-all.md) — stage named files only\r\n- [Also here](also-here.md) — the project has its own copy\r\n- [Archive](MEMORY-archive.md) — 2 older pointers; grep it\r\n');
// Auto-memory names repeat across projects: a project memory of the same file
// name is a different memory, so the shared line still prints.
writeFileSync(join(dirX, 'also-here.md'), 'x');
writeFileSync(join(dirX, 'MEMORY.md'), '- [Mine](also-here.md) — the project indexes its own\n');
const sx = printX('startup');
ok(sx.includes(`Shared memory, every project (${sharedDir}): open a file there when its line applies; a new lesson that holds in every project goes there too`) && /^- \[No git add -A\]\(no-add-all\.md\) — stage named files only$/m.test(sx),
  'startup prints the shared index under its absolute folder, BOM and CRLF read');
ok(/^- \[Also here\]\(also-here\.md\)/m.test(sx), 'a project memory with the same file name does not hide the shared one');
ok(/^- \[Archive\]\(MEMORY-archive\.md\) — 2 older pointers/m.test(sx), 'the shared archive line says how much is greppable');
ok(printX('clear') === sx, 'a /clear is a fresh context: told what startup is told');
ok(/no-add-all\.md/.test(printX('compact')), 'a compaction summarised the shared lines away: printed again');
writeFileSync(join(sharedDir, 'MEMORY.md'), '- [Archive](MEMORY-archive.md) — 3 older pointers; grep it\n');
ok(/^Shared memory: lessons that hold[^\n]*\n- \[Archive\]/m.test(printX('startup')), 'a shared store with every line archived still says where lessons go');
writeFileSync(join(sharedDir, '.health'), 'over budget: 3400B > 3000B\n');
ok(/^Memory store needs attention \([^)]*_shared[\\/]memory\): over budget/m.test(printX('startup')), "the shared store's problems are said in every project");
rmSync(join(sharedDir, '.health'));
// Pins are never evicted by tiering: the printed lines hold the ceiling themselves.
writeFileSync(join(sharedDir, 'MEMORY.md'), Array.from({ length: 60 }, (_, i) => `- [Pin ${i}](pin-${i}.md) — ${'a pinned lesson that tiering will never evict '.repeat(2)}`).join('\n') + '\n');
const capped = printX('startup');
const sharedBytes = Buffer.byteLength(capped.split('\n').filter((l) => l.startsWith('- [Pin')).join('\n'));
ok(sharedBytes <= 3000 && /^\(\d+ more shared line\(s\) over the 3000 B ceiling, in /m.test(capped), `printed shared lines stop at 3000 B and say how many more (${sharedBytes} B)`);

rmSync(home, { recursive: true, force: true });

// 30. A secret pasted into a message never reaches the handoff, where the
// snapshots would keep it for good: a key by its prefix, a password by the
// word before it, anything in <private> tags whole.
const cwdZ = 'C:\\handoff-privacy', dirZ = storeFor(home, cwdZ), tz = join(dirZ, 'z.jsonl');
mkdirSync(dirZ, { recursive: true });
const zs = (...lines) => writeFileSync(tz, lines.join('\n') + '\n', { flag: 'a' });
const zrun = () => handoff({ cwd: cwdZ, transcript_path: tz, session_id: 'zzzzzzzz-5' });
const zdoc = () => readFileSync(join(dirZ, 'handoff.md'), 'utf8');
zs(user('deploy with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 and <private>my pin is 4321</private> please', { ts: '2026-10-27T10:00:00Z' }),
  asst('Done. I set password: hunter2222 and token ghp_abcdefghijklmnopqrstuvwxyz0123456789.'));
zrun();
ok(!/sk-ant-api03|4321|hunter2222|ghp_abc/.test(zdoc()) && /deploy with \[redacted\] and \[private\] please/.test(zdoc()) && /password: \[redacted\]/.test(zdoc()),
  `a key, a password, a token and a <private> block are not written (got ${zdoc().split('**asked**')[1]})`);
// 31. Each entry names the files its turn changed, by name, from Edit, Write
// and NotebookEdit, and keeps them when the entry is read back and rewritten.
const toolUse = (name, input) => rec('assistant', [{ type: 'tool_use', id: name, name, input }]);
zs(user('fix the pricing page', { ts: '2026-10-27T10:05:00Z' }), toolUse('Edit', { file_path: 'C:\\site\\src\\pricing.html' }),
  toolUse('Write', { file_path: '/site/notes.md' }), toolUse('Edit', { file_path: 'C:\\site\\src\\pricing.html' }),
  toolUse('NotebookEdit', { notebook_path: 'C:\\site\\data.ipynb' }), toolUse('Read', { file_path: 'C:\\site\\read-only.txt' }), asst('fixed'));
zrun();
ok(/fix the pricing page\n  \*\*did:\*\* fixed\n  \*\*changed:\*\* pricing\.html, notes\.md, data\.ipynb\n/.test(zdoc()) && !/read-only/.test(zdoc()),
  `the files a turn changed are named once each, and a read is not a change (got ${zdoc().split('fix the pricing page')[1]})`);
ok(!/hunter2222[\s\S]*\*\*changed:\*\*[\s\S]*fix the pricing/.test(zdoc()) && (zdoc().match(/\*\*changed:\*\*/g) || []).length === 1, 'a turn that changed nothing gets no changed line');
// Another session's Stop rewrites the file: this session's entries come only
// from reading it back, so the changed line has to survive the parse.
const tz2 = join(dirZ, 'y.jsonl');
writeFileSync(tz2, [user('one more', { ts: '2026-10-27T10:09:00Z' }), asst('ok')].join('\n') + '\n');
handoff({ cwd: cwdZ, transcript_path: tz2, session_id: 'yyyyyyyy-6' });
ok(/\*\*changed:\*\* pricing\.html, notes\.md, data\.ipynb\n/.test(zdoc()) && (zdoc().match(/\*\*asked\*\*/g) || []).length === 3, 'read back and written again by another session, the changed line stays');
zs(user('rename everything', { ts: '2026-10-27T10:12:00Z' }), ...Array.from({ length: 11 }, (_, i) => toolUse('Write', { file_path: 'C:\\site\\f' + i + '.txt' })), asst('renamed'));
zrun();
ok(/\*\*changed:\*\* f3\.txt, f4\.txt, [^\n]*f10\.txt, and 3 more\n/.test(zdoc()), 'many files: the last 8, and how many more');

console.log(`handoff-log: ${checks} checks passed`);
