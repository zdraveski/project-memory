// Self-check for run-records.mjs: each run record absent, present, with bad JSON, unreadable (a folder in its place),
// with a BOM and with CRLF line ends, called in this process. The expected values are what the code did before it moved
// out of memory-tier, journal, handoff-log and memory (1.6.0 step 17), except where a BOM is now stripped (one read rule).
// Run: node run-records.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { tempHome, tempDir } from './harness.mjs';

const { home } = tempHome('rr-test-');
const R = await import('../src/run-records.mjs');
const { local, reason, projectsRoot } = await import('../src/store.mjs');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const BOM = '\uFEFF';
const root = projectsRoot();
mkdirSync(root, { recursive: true });
const fresh = (n) => { const d = join(tempDir('rr-'), n, 'memory'); mkdirSync(d, { recursive: true }); return d; };
// A folder where a file should be: it exists and cannot be read.
const folder = (p) => mkdirSync(p, { recursive: true });
const rmFile = (p) => rmSync(p, { recursive: true, force: true });

// The names the other modules spell: the journal's own, and the failure records' prefixes.
{
  const j = await import('../src/journal.mjs');
  ok(R.JOURNAL === j.JOURNAL, "run-records' journal folder is journal.mjs's");
  ok(R.FAILED === '.failed' && R.HANDOFF_FAILED === '.handoff-failed-' && R.JOURNAL_FAILED === '.journal-failed-' && R.DEPLOYED === '.deployed.json', 'the record names');
}

// The one read rule: missing and damaged both read as none, a BOM goes.
{
  const d = tempDir('rr-read-'), p = join(d, 'f');
  ok(R.readText(p) === null && R.readJson(p) === null, 'a missing file reads as none');
  writeFileSync(p, '{"a":1}\r\n');
  ok(R.readText(p) === '{"a":1}\r\n' && R.readJson(p).a === 1, 'CRLF is kept in text and parses as JSON');
  writeFileSync(p, `${BOM}{"a":2}`);
  ok(R.readText(p) === '{"a":2}' && R.readJson(p).a === 2, 'a BOM is stripped');
  writeFileSync(p, '{"a":');
  ok(R.readText(p) === '{"a":' && R.readJson(p) === null, 'bad JSON reads as none');
  folder(join(d, 'dir'));
  ok(R.readText(join(d, 'dir')) === null && R.readJson(join(d, 'dir')) === null, 'an unreadable file reads as none');
}

// Claude Code's plugin records.
{
  const pdir = join(home, '.claude', 'plugins');
  ok(R.plugins('installed_plugins.json') === null, 'no plugins folder: none');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, 'installed_plugins.json'), `${BOM}{"plugins":{"a@b":[]}}\r\n`);
  ok(Object.keys(R.plugins('installed_plugins.json').plugins)[0] === 'a@b', 'present, with a BOM and CRLF');
  writeFileSync(join(pdir, 'installed_plugins.json'), '[');
  ok(R.plugins('installed_plugins.json') === null, 'bad JSON: none');
  folder(join(pdir, 'known_marketplaces.json'));
  ok(R.plugins('known_marketplaces.json') === null, 'unreadable: none');
}

// Store health.
{
  const d = fresh('h');
  ok(R.healthOf(d) === '' && R.notes(d).length === 0, 'no .health: nothing said');
  R.health(d, ['a', 'b']);
  ok(readFileSync(join(d, '.health'), 'utf8') === 'a\nb\n', 'one problem a line');
  ok(R.healthOf(d) === 'a\nb' && R.notes(d)[0] === `Memory store needs attention (${d}): a; b`, 'read back, trimmed, and said on one line');
  const t = new Date(2020, 0, 1); utimesSync(join(d, '.health'), t, t);
  R.health(d, ['a', 'b']);
  ok(statSync(join(d, '.health')).mtimeMs === t.getTime(), 'the same problems are not written again');
  R.health(d, ['c']);
  ok(readFileSync(join(d, '.health'), 'utf8') === 'c\n', 'changed problems replace it');
  R.health(d, []);
  ok(!existsSync(join(d, '.health')), 'none: the file goes');
  R.health(d, []);
  ok(!existsSync(join(d, '.health')), 'none again: nothing to do');
  writeFileSync(join(d, '.health'), `${BOM}a\r\nb\r\n`);
  ok(R.healthOf(d) === 'a\r\nb' && R.notes(d)[0] === `Memory store needs attention (${d}): a\r; b`, 'a BOM is stripped, a CRLF stays in the line');
  writeFileSync(join(d, '.health'), '  \n');
  ok(R.healthOf(d) === '' && R.notes(d).length === 0, 'blank: nothing said');
  const e = fresh('h2');
  folder(join(e, '.health'));
  ok(R.healthOf(e) === '' && R.notes(e).length === 0, 'unreadable: nothing said');
  assert.throws(() => R.health(e, ['x'])); checks++;
}

// The Stop record.
{
  const ran = join(root, '.stop-ran');
  ok(R.stopRan() === ran, 'where the Stop record is');
  ok(R.stopRuns().length === 0, 'absent: no runs');
  R.stopRecord({ session_id: 'abcdefghij', hook_event_name: 'Stop', last_assistant_message: 'hello' });
  let [r] = R.stopRuns();
  ok(r.s === 'abcdefgh' && r.e === 'Stop' && r.h === undefined && /^[0-9a-f]{8}$/.test(r.m) && r.from === dirname(fileURLToPath(new URL('../src/run-records.mjs', import.meta.url))) && !Number.isNaN(Date.parse(r.at)), 'a line: when, session, event, fingerprint, copy');
  R.stopRecord({ stop_hook_active: true });
  ok(R.stopRuns().at(-1).h === 1 && R.stopRuns().at(-1).s === '' && R.stopRuns().length === 2, 'a block sent it back; no payload fields are empty');
  R.stopRecord(null);
  ok(R.stopRuns().length === 3, 'no payload still marks a run');
  // Before 1.0.7 the file was one time and no newline.
  writeFileSync(ran, '2020-01-01T00:00:00Z');
  R.stopRecord({});
  ok(readFileSync(ran, 'utf8').split('\n').length === 3 && R.stopRuns().length === 1, 'a line with no newline is not run into the next');
  // A line that does not parse, or has no time, is skipped; a BOM and CRLF are read.
  writeFileSync(ran, `${BOM}{"at":"2026-01-01T00:00:00Z","s":"a"}\r\nnot json\n{"s":"x"}\n{"at":"2026-01-02T00:00:00Z","s":"b"}\r\n`);
  ok(R.stopRuns().map((x) => x.s).join() === 'a,b', 'bad lines and lines with no time are skipped; BOM and CRLF read');
  // The cut: past 8 KB the newest 20 lines stay.
  writeFileSync(ran, Array.from({ length: 100 }, (_, i) => JSON.stringify({ at: '2026-01-01T00:00:00Z', s: String(i), pad: 'x'.repeat(100) })).join('\n') + '\n');
  ok(statSync(ran).size > 8192, 'fixture is past 8 KB');
  R.stopRecord({ session_id: 'last' });
  const lines = readFileSync(ran, 'utf8').split('\n').filter(Boolean);
  ok(lines.length === 20 && JSON.parse(lines.at(-1)).s === 'last' && JSON.parse(lines[0]).s === '81', 'past 8 KB the newest 20 lines stay');
  writeFileSync(ran, Array.from({ length: 30 }, (_, i) => JSON.stringify({ at: '2026-01-01T00:00:00Z', s: String(i) })).join('\n') + '\n');
  R.stopRecord({});
  ok(readFileSync(ran, 'utf8').split('\n').filter(Boolean).length === 31, 'under 8 KB nothing is cut');
  // Exactly 8 KB is not past it: the line a run adds is measured, then 30 lines are laid so the file ends at 8192 bytes.
  rmFile(ran); R.stopRecord({});
  const one = statSync(ran).size, pad = 8192 - one - 29 * 10;
  writeFileSync(ran, '123456789\n'.repeat(29) + 'x'.repeat(pad - 1) + '\n');
  R.stopRecord({});
  ok(statSync(ran).size === 8192 && readFileSync(ran, 'utf8').split('\n').filter(Boolean).length === 31, 'a file of exactly 8192 bytes is not cut');
  // Damaged: a folder in its place is a run that goes unrecorded, quietly.
  rmFile(ran); folder(ran);
  R.stopRecord({});
  ok(R.stopRuns().length === 0, 'unreadable: no runs, and no throw');
  rmFile(ran);
}

// A Stop that could not save.
{
  const d = fresh('lost'), f = join(root, `${R.HANDOFF_FAILED}${d.split(/[\\/]/).at(-2)}`);
  ok(R.lostHandoff(d) === null && R.notes(d).length === 0, 'absent: none');
  const at = '2026-01-02T03:04:05.000Z';
  writeFileSync(f, JSON.stringify({ at, error: 'boom' }));
  ok(R.lostHandoff(d).error === 'boom', 'present');
  ok(R.notes(d)[0] === `Memory store needs attention (${d}): the record of where you left off could not be saved after the reply at ${local(at)}: boom`, 'said in the briefing');
  ok(R.unsaved({ at, error: 'e', off: true }) === `a conversation held with auto memory off could not be marked after the reply at ${local(at)}, so the journal may take it in later: e`, 'the auto memory off wording');
  writeFileSync(f, `${BOM}${JSON.stringify({ at, error: 'bom' })}\r\n`);
  ok(R.lostHandoff(d).error === 'bom', 'a BOM and CRLF read');
  writeFileSync(f, '{"at"');
  ok(R.lostHandoff(d) === null && R.notes(d).length === 0, 'bad JSON: none');
  writeFileSync(f, 'null');
  ok(R.notes(d).length === 0, 'null: nothing said');
  rmFile(f); folder(f);
  ok(R.lostHandoff(d) === null && R.notes(d).length === 0, 'unreadable: none');
  // The writers: one file a project, its fields as older releases wrote them (status and the briefing read those too).
  rmFile(f);
  R.handoffFailed(d, new Error('disk full'));
  ok(Object.keys(JSON.parse(readFileSync(f, 'utf8'))).join() === 'at,error' && R.lostHandoff(d).error === 'disk full', 'a failure kept: at and error');
  ok(process.platform === 'win32' || (statSync(f).mode & 0o777) === 0o600, 'kept 0600');
  const other = fresh('lost-other');
  R.handoffSaved(other);
  ok(R.lostHandoff(d).error === 'disk full', "another project's save clears none of this one's");
  R.handoffFailed(d, new Error('tag'), true);
  ok(R.lostHandoff(d).off === true && R.notes(d)[0].includes('auto memory off'), 'with auto memory off: off, said in its own words');
  R.handoffSaved(d); R.handoffSaved(d);
  ok(!existsSync(f) && R.lostHandoff(d) === null, 'a save clears it, and clearing none is no error');
  folder(join(f, 'x'));
  assert.throws(() => R.handoffFailed(d, new Error('e'))); checks++;
  rmFile(f);
}

// The journal's failure records.
{
  const d = fresh('jf'), name = d.split(/[\\/]/).at(-2), j = join(d, 'journal', '.failed'), aside = join(root, `${R.JOURNAL_FAILED}${name}`);
  ok(R.aside(d) === aside && R.failures(d).length === 0 && R.notes(d).length === 0, 'absent: none, and the aside file is beside the projects');
  R.fault(d, new Error('live'));
  R.fault(d, new Error('late'), 'backfill: ');
  let lines = readFileSync(j, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(lines.length === 2 && lines[0].error === 'backfill: late' && lines[1].error === 'live', 'one line a writer, the newest first');
  R.fault(d, new Error('live2'));
  lines = readFileSync(j, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(lines.length === 2 && lines[0].error === 'live2' && lines[1].error === 'backfill: late', 'a writer replaces its own line only');
  ok(R.failures(d).length === 2, 'failures: one line each');
  const at = lines[0].at;
  ok(R.notes(d).join() === `Memory store needs attention (${d}): the journal could not be written after the reply at ${local(at)}: live2`, 'a backfill is retried, so not said');
  R.clear(d, true);
  ok(R.failures(d).length === 1 && JSON.parse(R.failures(d)[0]).error === 'live2', 'a backfill clears its own line');
  R.clear(d, false);
  ok(!existsSync(j) && R.failures(d).length === 0, 'a live write clears its own, and the file goes with the last');
  R.clear(d, false); R.clear(d, true);
  ok(!existsSync(j), 'clearing none is nothing');
  // CRLF and a BOM in the file.
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(j, `${BOM}${JSON.stringify({ at, error: 'crlf' })}\r\n${JSON.stringify({ at, error: 'backfill: x' })}\r\n`);
  ok(R.failures(d).length === 2 && R.notes(d).length === 1 && R.notes(d)[0].endsWith(': crlf'), 'CRLF line ends split, and a BOM is stripped for the briefing');
  writeFileSync(j, 'not json\n');
  ok(R.notes(d).length === 0, 'bad JSON: nothing said');
  rmFile(j);
  // A journal folder that takes nothing: a live failure is kept beside the projects, a backfill's is not.
  const e = fresh('jf2'), ename = e.split(/[\\/]/).at(-2), easide = join(root, `${R.JOURNAL_FAILED}${ename}`);
  writeFileSync(join(e, 'journal'), 'a file, not a folder');
  R.fault(e, new Error('refused'), 'backfill: ');
  ok(!existsSync(easide), 'a backfill failure that cannot be kept is dropped');
  R.fault(e, new Error('refused'));
  ok(JSON.parse(readFileSync(easide, 'utf8')).error === reason(new Error('refused')), 'a live failure is kept beside the projects');
  ok(R.failures(e).length === 1 && R.notes(e).length === 1, 'and read from there');
  R.clear(e, true);
  ok(existsSync(easide), 'a backfill does not clear the aside file');
  R.clear(e, false);
  ok(!existsSync(easide), 'a live write does');
}

// The deploy record.
{
  const d = tempDir('rr-dep-');
  ok(R.hash('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256, hex');
  ok(R.deployed(d) === null && R.deployedCommit(d) === null && R.edited(d).length === 0, 'absent: none, and nothing edited');
  writeFileSync(join(d, 'a.txt'), 'one'); writeFileSync(join(d, 'b.txt'), 'two');
  const sa = statSync(join(d, 'a.txt'));
  R.writeDeployed(d, { commit: 'abc123', tag: 'v1', repo: 'C:\\repo', files: { 'a.txt': R.hash('one'), 'b.txt': R.hash('two') }, stat: { 'a.txt': [sa.size, sa.mtimeMs] } });
  ok(readFileSync(join(d, '.deployed.json'), 'utf8').endsWith('}\n') && R.deployedCommit(d) === 'abc123' && R.deployed(d).tag === 'v1', 'written as one line, read back');
  ok(R.edited(d).length === 0, 'unchanged files: nothing edited');
  writeFileSync(join(d, 'b.txt'), 'TWO');
  let m = R.edited(d);
  ok(m.length === 1 && m[0].includes(`b.txt in ${d}`) && !m[0].includes('a.txt') && m[0].includes('edit C:\\repo and run node tools/deploy.mjs there'), 'a changed file is named, with the repo');
  writeFileSync(join(d, 'a.txt'), 'ONE');   // same size, same time as deployed: not read
  utimesSync(join(d, 'a.txt'), sa.atime, sa.mtime);
  ok(R.edited(d)[0].includes(`b.txt in ${d}`), 'a file whose size and time are as deployed is not read');
  rmFile(join(d, 'b.txt'));
  const gone = join(d, 'gone');
  writeFileSync(join(d, '.deployed.json'), `${BOM}${JSON.stringify({ commit: 'c', files: { 'gone.txt': 'x' }, repo: gone, origin: 'https://example.test/r.git' })}\r\n`);
  ok(R.deployedCommit(d) === 'c' && R.edited(d)[0].includes(`gone.txt in ${d}`) && R.edited(d)[0].includes(`${gone} (gone; clone https://example.test/r.git)`), 'a BOM and CRLF read; a file that is gone is named, and a repo that is gone is named by its origin');
  writeFileSync(join(d, '.deployed.json'), '{"commit"');
  ok(R.deployed(d) === null && R.deployedCommit(d) === null && R.edited(d).length === 0, 'bad JSON: none, and silent');
  writeFileSync(join(d, '.deployed.json'), '{"commit":"c"}');
  ok(R.deployedCommit(d) === 'c' && R.edited(d).length === 0, 'no file list: silent');
  writeFileSync(join(d, '.deployed.json'), '{"commit":""}');
  ok(R.deployedCommit(d) === '', 'an empty commit is taken as written');
  writeFileSync(join(d, '.deployed.json'), '{"files":{"gone.txt":"x"}}');
  ok(R.edited(d)[0].includes('edit the hooks repo and run node tools/deploy.mjs there'), 'no repo named: the hooks repo');
  const e = tempDir('rr-dep2-');
  folder(join(e, '.deployed.json'));
  ok(R.deployed(e) === null && R.deployedCommit(e) === null && R.edited(e).length === 0, 'unreadable: none, and silent');
}

console.log(`run-records.test.mjs: ${checks} checks passed`);
