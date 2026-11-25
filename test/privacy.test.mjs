// Self-check for privacy.mjs, called in this process: the six sources (private turn, private conversation, conversation switched
// off, project switched off, off period, forgotten exchange), each with its file absent, present and unreadable (a folder where
// the file should be), the rule "unreadable means private", the tag patterns, the compaction note's wider check, and the pruning
// of the two lists. Run: node privacy.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, tempDir, quick } from './harness.mjs';

const { home } = tempHome('privacy-test-');
const { norm, projectsRoot, tag } = await import('../src/store.mjs');
const P = await import('../src/privacy.mjs');
const { PRIVATE, PRIVATE_SESSION, QUIET, OFF, PROJECT_OFF, OFF_PERIODS, FORGOTTEN, hushed, isOff, wasOff, off, offLine, unreadable, forgotten } = P;

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
  ok(hushed(none, S, false, list) === false, `${what}: no list, not marked`);
  ok(hushed(here, S, false, list) === true, `${what}: a tag in the list (CRLF too) is marked`);
  ok(hushed(here, 'zzz00000', false, list) === false, `${what}: another tag is not`);
  ok(hushed(gone, S, false, list) === null, `${what}: a list that cannot be read answers unknown, for the Stop that records it`);
  ok(hushed(none, '', false, list) === false && hushed(none, undefined, true, list) === false && !existsSync(join(none, list)), `${what}: no id is never private, and never marked`);
}
// Marking, by rename; a mark already there writes nothing.
{
  const d = store('mark');
  ok(hushed(d, S, true) === true && readFileSync(join(d, QUIET), 'utf8') === `${S}\n`, 'a tag is marked');
  ok(hushed(d, S, true) === true && readFileSync(join(d, QUIET), 'utf8') === `${S}\n`, 'a tag already there is marked once');
  const bad = store('mark-unread'); mkdirSync(join(bad, QUIET));
  ok(hushed(bad, S, true) === null, 'a list that cannot be read is not written, and is private');
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

console.log(`privacy.test.mjs: ${checks} checks passed`);
