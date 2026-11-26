// Self-check for privacy.mjs, called in this process: the six sources (private turn, private conversation, conversation switched
// off, project switched off, off period, forgotten exchange), each with its file absent, present and unreadable (a folder where
// the file should be), the rule "unreadable means private", the tag patterns, the compaction note's wider check, and the pruning
// of the two lists. Run: node privacy.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, tempDir, quick } from './harness.mjs';

const { home } = tempHome('privacy-test-');
const { norm, projectsRoot, tag } = await import('../src/store.mjs');
const P = await import('../src/privacy.mjs');
const { PRIVATE, PRIVATE_SESSION, NOTE_HIDES, QUIET, OFF, PROJECT_OFF, OFF_PERIODS, FORGOTTEN, hushed, isHushed, isQuiet, gate, isOff, wasOff, off, offLine, unreadable, forgotten, forgottenIn, listForgotten, switchOff, switchOn } = P;

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const store = (name) => { const d = join(home, name); mkdirSync(d, { recursive: true }); return d; };
const S = 'abc12345';

// The names are the module's: nothing is left behind in the places they came from.
{
  const hl = await import('../src/handoff-log.mjs'), st = await import('../src/store.mjs');
  const gone = ['PRIVATE', 'PRIVATE_SESSION', 'hushed', 'off', 'offLine', 'unreadable', 'FORGOTTEN', 'forgotten', 'OFF'];
  ok(gone.every((n) => !(n in hl)), 'handoff-log re-exports nothing that moved to privacy');
  ok(['QUIET', 'OFF', 'PROJECT_OFF', 'isOff', 'OFF_PERIODS', 'wasOff'].every((n) => !(n in st)), 'store keeps none of the names that moved to privacy');
  ok(QUIET === '.private-sessions' && OFF === '.memory-off' && PROJECT_OFF === '.project-off' && OFF_PERIODS === '.off-periods', 'the marker files keep their names');
  ok(FORGOTTEN === join('journal', '.forgotten'), 'the forgotten list keeps its place');
}

// Source 2, a private conversation (a tag in .private-sessions), and source 3, a conversation switched off (the same shape, in the
// projects root): absent, present, unreadable.
for (const [what, list, dirOf] of [['private conversation', QUIET, () => store('quiet')], ['conversation switched off', OFF, () => store('switched-off')]]) {
  const none = dirOf(), here = dirOf() + '-present', gone = dirOf() + '-unread';
  mkdirSync(here, { recursive: true }); mkdirSync(gone, { recursive: true });
  writeFileSync(join(here, list), `other000\n${S}\r\n`);
  mkdirSync(join(gone, list));   // a folder where the list should be: it exists and cannot be read
  ok(hushed(none, S, false, list) === false && isHushed(none, S, list) === false, `${what}: no list, not marked`);
  ok(hushed(here, S, false, list) === true && isHushed(here, S, list) === true, `${what}: a tag in the list (CRLF too) is marked`);
  ok(hushed(here, 'zzz00000', false, list) === false && isHushed(here, 'zzz00000', list) === false, `${what}: another tag is not`);
  ok(hushed(gone, S, false, list) === null, `${what}: a list that cannot be read answers unknown, for the Stop that records it`);
  ok(isHushed(gone, S, list) === true && isHushed(gone, 'zzz00000', list) === true, `${what}: unreadable is private, whoever asks`);
  ok(hushed(none, '', false, list) === false && hushed(none, undefined, true, list) === false && !existsSync(join(none, list)), `${what}: no id is never private, and never marked`);
}
// One try, as the git-rule hook asks (its timeout is 5 s), and three by default: counted on a list a scan holds.
{
  const d = store('tries'), list = join(d, QUIET);
  writeFileSync(list, `${S}\n`);
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (p, ...a) => { if (String(p) === list) { reads++; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } return read(p, ...a); };
  syncBuiltinESMExports();
  try {
    const one = isHushed(d, S, QUIET, 1), oneReads = reads; reads = 0;
    const three = isHushed(d, S), threeReads = reads;
    ok(one === true && oneReads === 1, `a caller that asks for one try reads once (read ${oneReads})`);
    ok(three === true && threeReads === 3, `the default is three tries (read ${threeReads})`);
  } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
}
// Marking, by rename; a mark already there writes nothing.
{
  const d = store('mark');
  ok(hushed(d, S, true) === true && readFileSync(join(d, QUIET), 'utf8') === `${S}\n`, 'a tag is marked');
  ok(hushed(d, S, true) === true && readFileSync(join(d, QUIET), 'utf8') === `${S}\n`, 'a tag already there is marked once');
  const bad = store('mark-unread'); mkdirSync(join(bad, QUIET));
  ok(hushed(bad, S, true) === null && isHushed(bad, S) === true, 'a list that cannot be read is not written, and is private');
}

// Pruning. .private-sessions keeps the newest 999 with the new tag; a plain list of 1,005 is cut to 1,000.
{
  const d = store('prune-quiet'), old = Array.from({ length: 1005 }, (_, i) => `q${String(i).padStart(7, '0')}`);
  writeFileSync(join(d, QUIET), old.join('\n') + '\n');
  ok(hushed(d, 'new00000', true) === true, 'a new tag is marked');
  const have = readFileSync(join(d, QUIET), 'utf8').trim().split('\n');
  ok(have.length === 1000 && have[0] === old[6] && have.at(-1) === 'new00000' && have.at(-2) === old.at(-1), `.private-sessions keeps the newest 999 and the new tag (got ${have.length}, first ${have[0]})`);
}
// .memory-off keeps what is on disk, plus the newest 100, up to 10,000: the list is the projects root's, written by off().
{
  const root = projectsRoot(), proj = join(root, 'C--prune'), tags = Array.from({ length: 150 }, (_, i) => `m${String(i).padStart(7, '0')}`);
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'live0001-aaaa.jsonl'), '');   // a transcript on disk: its tag stays however old
  writeFileSync(join(root, OFF), ['live0001', ...tags].join('\n') + '\n');
  ok(off({ session_id: 'newtag99-bbbb' }) === true, 'a conversation held with auto memory off is marked');
  const have = readFileSync(join(root, OFF), 'utf8').trim().split('\n');
  ok(have.length === 102 && have[0] === 'live0001' && have[1] === tags[50] && have.at(-2) === tags.at(-1) && have.at(-1) === 'newtag99', `.memory-off keeps tags still on disk and the newest 100 (got ${have.length}: ${have.slice(0, 2)} ... ${have.slice(-2)})`);
  ok(off({ session_id: 'newtag99-bbbb' }) === true && readFileSync(join(root, OFF), 'utf8').trim().split('\n').length === 102, 'a tag already there is marked once');
  ok(off({ transcript_path: join(proj, 'fromfile-cccc.jsonl') }) === true && readFileSync(join(root, OFF), 'utf8').includes('fromfile\n'), 'the tag is read from the transcript path when there is no session id');
  // Up to 10,000: each of 10,050 tags has a transcript on disk, so none is dropped as stale, and the cap alone cuts the oldest.
  if (!quick) {
    const many = join(root, 'C--many'), big = Array.from({ length: 10_050 }, (_, i) => `b${String(i).padStart(7, '0')}`);
    mkdirSync(many, { recursive: true });
    for (const t of big) writeFileSync(join(many, `${t}.jsonl`), '');
    writeFileSync(join(root, OFF), big.join('\n') + '\n');
    off({ session_id: 'last0000-dddd' });
    const kept = readFileSync(join(root, OFF), 'utf8').trim().split('\n');
    ok(kept.length === 10_001 && kept[0] === big[50] && kept.at(-1) === 'last0000', `.memory-off holds at most 10,000 before the new tag (got ${kept.length}, first ${kept[0]})`);
  }
  // A list that will not read: off() throws, after writing nothing, so the Stop records it.
  const bad = tempDir('privacy-off-');
  const real = process.env.HOME, realProfile = process.env.USERPROFILE;
  process.env.HOME = bad; process.env.USERPROFILE = bad;
  try {
    mkdirSync(join(bad, '.claude', 'projects', OFF), { recursive: true });
    assert.throws(() => off({ session_id: 'zzzz0000-eeee' }), /\.memory-off could not be read/);
    checks++;
  } finally { process.env.HOME = real; process.env.USERPROFILE = realProfile; }
}

// Source 4, a project switched off (.project-off): absent, present, unreadable.
{
  const none = store('proj-none'), on = store('proj-on'), bad = store('proj-bad'), junk = store('proj-junk');
  writeFileSync(join(on, PROJECT_OFF), JSON.stringify({ t: 1_700_000_000_000 }));
  mkdirSync(join(bad, PROJECT_OFF));
  writeFileSync(join(junk, PROJECT_OFF), 'not json');
  ok(isOff(none) === null, 'project: no marker, on');
  ok(isOff(on)?.since === 1_700_000_000_000 && !isOff(on).unread, 'project: a marker is off since its time');
  ok(isOff(bad) && !isOff(bad).since, 'project: a marker that cannot be read is off, with no date');
  ok(isOff(junk)?.since === null, 'project: a marker with no time is off, since an unknown date');
  ok(/can't be read \(EACCES\)/.test(offLine({ since: null, unread: 'EACCES' })) && /since \d{4}-\d\d-\d\d/.test(offLine({ since: 1_700_000_000_000 })) && /unknown date/.test(offLine({ since: null })), 'the start says why a project is off');
}

// Source 5, an off period: absent, present, unreadable. The unreadable list throws, so the Stop records it and writes nothing.
{
  const none = store('per-none'), on = store('per-on'), bad = store('per-bad');
  writeFileSync(join(on, OFF_PERIODS), '1000 2000\r\n5000 6000\n');
  mkdirSync(join(bad, OFF_PERIODS));
  ok(wasOff(none)({ ms: 1500 }) === false && wasOff(none)({ ms: NaN }) === false, 'periods: none listed, nothing was off');
  const was = wasOff(on);
  ok(was({ ms: 1500 }) && was({ ms: 5000 }) && !was({ ms: 2001 }) && !was({ ms: 999 }) && was({ ms: NaN }), 'periods: a turn inside one was off, and so is one with no time');
  assert.throws(() => wasOff(bad)); checks++;
}

// Source 6, a forgotten exchange: absent, present, unreadable.
{
  const none = store('fg-none'), on = store('fg-on'), bad = store('fg-bad');
  mkdirSync(join(on, 'journal'), { recursive: true }); mkdirSync(join(bad, FORGOTTEN), { recursive: true });
  writeFileSync(join(on, FORGOTTEN), 'k1\tC--p/abc\t2026-11-01 10:00\r\nk2\n');
  assert.deepStrictEqual(forgottenIn(none), { listed: [], shut: false }); checks++;
  assert.deepStrictEqual(forgottenIn(on), { listed: [['k1', 'C--p/abc', '2026-11-01 10:00'], ['k2']], shut: false }); checks++;
  { const { code, ...r } = forgottenIn(bad); assert.deepStrictEqual(r, { listed: [], shut: true }); ok(typeof code === 'string' && code, 'a list that will not read says why'); }
  assert.deepStrictEqual(forgotten('a\tb\tc\n\n k \n'), [['a', 'b', 'c'], ['k']]); checks++;
  ok(unreadable('/d', '.x').message.endsWith('.x could not be read') && unreadable('/d', '.x') instanceof Error, 'the error a writer throws names the list');
}

// Source 1, a private turn, and the private-session mark: in any case, with spaces or attributes, self-closed; and the forms that
// are not the mark. Fullwidth and zero-width spellings are found by the normalizing the callers do (norm), not by the pattern.
{
  for (const t of ['<private>', '<PRIVATE>', '< private >', '<private my pin', '<private/>', '<private pin="1">x', 'a <private\nb']) ok(PRIVATE.test(t), `private turn: ${JSON.stringify(t)}`);
  for (const t of ['<privately>', '<private-session>', '<private_session>', '<privates>', 'private', '<priv ate>']) ok(!PRIVATE.test(t), `not a private turn: ${JSON.stringify(t)}`);
  for (const t of ['<private-session>', '<PRIVATE_SESSION/>', '< private-session >', '<private-session x="1">']) ok(PRIVATE_SESSION.test(t), `private conversation: ${JSON.stringify(t)}`);
  for (const t of ['<private>', '<private-session', `<private-session ${'x'.repeat(300)}>`]) ok(!PRIVATE_SESSION.test(t), `not a private conversation: ${JSON.stringify(t).slice(0, 40)}`);
  const full = '＜private-session＞', zero = '<pri​vate-sess⁠ion>', fullTurn = '＜private＞ my pin', zeroTurn = '<​private>';
  ok(!PRIVATE_SESSION.test(full) && PRIVATE_SESSION.test(norm(full)), 'a fullwidth private-session tag is seen once normalized');
  ok(!PRIVATE_SESSION.test(zero) && PRIVATE_SESSION.test(norm(zero)), 'a private-session tag with zero-width characters inside is seen once normalized');
  ok(PRIVATE.test(norm(fullTurn)) && PRIVATE.test(norm(zeroTurn)), 'fullwidth and zero-width private turns are seen once normalized');
}
// The compaction note's wider check: it hides any text holding `<private`, in any spelling, the longer tags included. That is wider
// than a private turn, and stays so on purpose: the note is printed into the next context.
{
  for (const t of ['<private-session>', '<privately>', '<Private', '< private', '<privates and more', '<private>']) ok(NOTE_HIDES.test(t), `the note hides ${JSON.stringify(t)}`);
  ok(!PRIVATE.test('<privately>') && !PRIVATE.test('<private-session>'), 'the private-turn rule is narrower than the note\'s');
  for (const t of ['private', 'a < b', '<priv', '</private>']) ok(!NOTE_HIDES.test(t), `the note shows ${JSON.stringify(t)}`);
}

// A quiet conversation: private in its store, or switched off in the projects root; a list of either that won't read is quiet.
{
  const root = projectsRoot(), none = store('q-none'), mine = store('q-mine'), bad = store('q-bad');
  writeFileSync(join(mine, QUIET), `${S}\n`); mkdirSync(join(bad, QUIET));
  ok(!isQuiet(none, S) && isQuiet(mine, S) && isQuiet(bad, S) && !isQuiet(mine, 'zzz00000'), 'quiet: by the store\'s private list, unreadable included');
  mkdirSync(root, { recursive: true });
  const was = existsSync(join(root, OFF)) ? readFileSync(join(root, OFF), 'utf8') : null;
  try {
    writeFileSync(join(root, OFF), 'offtag00\n');
    ok(isQuiet(none, 'offtag00', 1) && !isQuiet(none, S, 1), 'quiet: by the projects root\'s switched-off list');
    fs.rmSync(join(root, OFF)); mkdirSync(join(root, OFF));
    ok(isQuiet(none, S), 'quiet: a switched-off list that won\'t read');
  } finally { fs.rmSync(join(root, OFF), { recursive: true, force: true }); if (was != null) writeFileSync(join(root, OFF), was); }
}
// The gate a hook asks first: auto memory, then the project, then the conversation, and the store it worked out.
{
  const t = join(projectsRoot(), 'C--gate', 'gate0000-aaaa.jsonl'), d = join(projectsRoot(), 'C--gate', 'memory'), env = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  mkdirSync(d, { recursive: true });
  try {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    assert.deepStrictEqual(gate({ transcript_path: t }, 'gate0000'), { why: 'auto memory off' }); checks++;
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';
    assert.deepStrictEqual(gate({ transcript_path: t }, 'gate0000'), { store: d }); checks++;
    writeFileSync(join(d, QUIET), 'gate0000\n');
    assert.deepStrictEqual(gate({ transcript_path: t }, 'gate0000', 1), { store: d, why: 'quiet' }); checks++;
    writeFileSync(join(d, PROJECT_OFF), '{"t":1}');
    assert.deepStrictEqual(gate({ transcript_path: t }, 'gate0000'), { store: d, why: 'project off' }); checks++;
  } finally { if (env === undefined) delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; else process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = env; }
}
// memory off and on: the marker by rename, and on, the off period before the marker goes; a marker that won't read writes none.
{
  const d = join(home, 'switch', 'new');
  ok(switchOff(d) && isOff(d)?.since > 0, 'memory off makes the store and writes the marker');
  switchOn(d, { since: 1000 });
  ok(!existsSync(join(d, PROJECT_OFF)) && /^1000 \d+\n$/.test(readFileSync(join(d, OFF_PERIODS), 'utf8')), 'memory on keeps the period and removes the marker');
  const was = store('switch-nodate'); writeFileSync(join(was, PROJECT_OFF), 'not json');
  switchOn(was, isOff(was));
  ok(Number(readFileSync(join(was, OFF_PERIODS), 'utf8').split(' ')[0]) > 0, 'a marker with no time: the period starts at its mtime');
  const un = store('switch-unread'); writeFileSync(join(un, PROJECT_OFF), '{"t":5}');
  switchOn(un, { since: null, unread: 'EACCES' });
  ok(!existsSync(join(un, OFF_PERIODS)) && !existsSync(join(un, PROJECT_OFF)), 'a marker that would not read writes no period');
}
// The forget list's writer: added by key, a key once, and a line whose transcript is gone dropped; an older key-alone line kept.
{
  const d = store('fg-write'), proj = join(projectsRoot(), 'C--fg');
  mkdirSync(join(d, 'journal'), { recursive: true }); mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'here0000.jsonl'), '');
  writeFileSync(join(d, FORGOTTEN), 'old\nk0\tC--fg/gone0000\t2026-11-01 09:00\r\n');
  listForgotten(d, [{ key: 'k1', t: 'C--fg/here0000', at: '2026-11-01 10:00' }, { key: 'k2', t: 'C--fg/gone0001', at: '2026-11-01 10:01' }]);
  listForgotten(d, [{ key: 'k1', t: 'C--fg/here0000', at: '2026-11-01 10:00' }]);
  ok(readFileSync(join(d, FORGOTTEN), 'utf8') === 'old\nk1\tC--fg/here0000\t2026-11-01 10:00\n', `forget lists live keys once (got ${JSON.stringify(readFileSync(join(d, FORGOTTEN), 'utf8'))})`);
  // A transcript that won't stat, but for its absence, may still be there: its key stays.
  const stat = fs.statSync;
  fs.statSync = (p, ...a) => { if (String(p).includes('locked00')) throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }); return stat(p, ...a); };
  syncBuiltinESMExports();
  try { listForgotten(d, [{ key: 'k3', t: 'C--fg/locked00', at: '2026-11-01 10:02' }]); } finally { fs.statSync = stat; syncBuiltinESMExports(); }
  ok(readFileSync(join(d, FORGOTTEN), 'utf8').endsWith('k3\tC--fg/locked00\t2026-11-01 10:02\n'), 'forget keeps the key of a transcript that will not stat');
}

console.log(`privacy.test.mjs: ${checks} checks passed`);
