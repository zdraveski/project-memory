// Self-check for enforce-hook.mjs, the PreToolUse hook that watches git commands against the
// enforce: rules in notes and logs which note matched. It prints nothing and blocks nothing.
// Run: node enforce-hook.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor } from './harness.mjs';
import { ruleSet, record, LOG, CACHE, CACHE_V, LOG_MAX } from '../src/enforce.mjs';
import { sharedStore } from '../src/store.mjs';
import { QUIET, OFF, PROJECT_OFF } from '../src/privacy.mjs';
import { tag as tagOf } from '../src/handoff-log.mjs';
import { hushed } from '../src/privacy.mjs';
import { gitignore } from '../src/snapshot.mjs';
import { sessionsOf, sessionLine } from '../src/sessions.mjs';
import { onEdit } from '../src/lessons.mjs';

const { home } = tempHome('enforce-hook-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const HOOK = tool('src/enforce-hook.mjs');
const note = (name, rule) => `---\nname: ${name}\ndescription: Never run git add -A.\ntype: feedback\n${rule}---\n\nbody\n`;
const ADD = 'enforce:\n  on: git add\n  has: [-A, --all]\n  unless: [mktemp]\n';

let n = 0;
// A project: its folder, its store with one rule note, and a payload builder.
function project(rule = ADD) {
  const cwd = join(home, `proj${++n}`), store = storeFor(home, cwd);
  mkdirSync(cwd, { recursive: true }); mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'stage.md'), note('Stage files by name', rule));
  const payload = (command, extra = {}) => ({ session_id: 'abcd1234-aaaa', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_1', ...extra });
  return { cwd, store, payload };
}
const run = (input, env = process.env) => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env });
const lines = (store) => (existsSync(join(store, LOG)) ? readFileSync(join(store, LOG), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const quiet = (r, msg) => ok(r.status === 0 && r.stdout === '' && r.stderr === '', `${msg} (status ${r.status}, out ${JSON.stringify(r.stdout)}, err ${JSON.stringify(r.stderr)})`);

// A match: nothing printed, one log line, no command text.
let p = project(), r = run(p.payload('git add -A src/secret-thing.js'));
quiet(r, 'a match prints nothing and exits 0');
let l = lines(p.store);
ok(l.length === 1 && l[0].note === 'stage.md' && l[0].s === 'abcd1234' && l[0].agent === '' && l[0].id === 'toolu_1' && Number.isFinite(Date.parse(l[0].t)), `one log line with the fields (got ${JSON.stringify(l)})`);
ok(!readFileSync(join(p.store, LOG), 'utf8').includes('secret-thing') && !readFileSync(join(p.store, LOG), 'utf8').includes('git'), 'the log holds no command text');

// Wrapped forms the probe found the filter lets through.
for (const c of ['FOO=1 git add -A', 'cd . && git add -A', 'cd "C:\\some dir" && git add -A; echo done']) {
  p = project(); quiet(run(p.payload(c)), c); ok(lines(p.store).length === 1, `a hit in: ${c}`);
}
// No match: no log line, and no file read before the `git` check.
p = project();
for (const c of ['git add src/a.js', 'ls -la', 'git add -A mktemp', 'echo "git add -A" > /dev/null; echo hi']) { quiet(run(p.payload(c)), c); }
ok(lines(p.store).length === 0, 'no match, no log line');

// A subagent, PowerShell, a Monitor-shaped payload, a Windows-style cwd: all watched.
p = project(); quiet(run(p.payload('git add -A', { agent_id: 'a1', agent_type: 'general-purpose' })), 'subagent');
ok(lines(p.store)[0].agent === 'general-purpose', 'the log has the agent type');
p = project(); quiet(run(p.payload('git add --all', { tool_name: 'PowerShell' })), 'PowerShell'); ok(lines(p.store).length === 1, 'PowerShell is watched');
p = project(); quiet(run(p.payload('git add -A', { tool_name: 'Monitor' })), 'Monitor'); ok(lines(p.store).length === 1, 'a Monitor-shaped payload is watched');
p = project(); quiet(run(p.payload('git add -A', { cwd: p.cwd.replace(/\//g, '\\') })), 'backslash cwd'); ok(lines(p.store).length === 1, 'a Windows-style cwd finds the store');

// Fail open: nothing printed, exit 0, never a throw.
for (const [what, input] of [['empty stdin', ''], ['garbage', 'not json {'], ['null', 'null'], ['an array', '[]'], ['command as a number', { tool_input: { command: 5 }, cwd: home }],
  ['no tool_input', { cwd: home }], ['cwd as a number', { tool_input: { command: 'git add -A' }, cwd: 7 }]]) quiet(run(input), what);
// A store folder that is a file; an unreadable note (a folder named like a note); a bad rule beside a good one.
{ const q = project(); const dir = q.store; mkdirSync(join(dir, 'dir.md')); writeFileSync(join(dir, 'bad.md'), note('Bad', 'enforce:\n  on: ls\n  has: [x]\n'));
  quiet(run(q.payload('git add -A')), 'an unreadable note and a bad rule'); ok(lines(dir).length === 1 && lines(dir)[0].note === 'stage.md', 'the good rule still works beside them'); }
{ const q = project(), file = join(home, 'file-store'); writeFileSync(file, 'x'); quiet(run(q.payload('git add -A', { transcript_path: join(file, 'x', 's.jsonl') })), 'a transcript path under a file'); }
{ const q = project(); writeFileSync(join(q.store, CACHE), '{ not json'); quiet(run(q.payload('git add -A')), 'a corrupt cache'); ok(lines(q.store).length === 1, 'the rule still matches');
  ok(typeof JSON.parse(readFileSync(join(q.store, CACHE), 'utf8')) === 'object', 'the corrupt cache is rebuilt'); }
{ const q = project(); writeFileSync(join(q.store, CACHE), '[1,2]'); quiet(run(q.payload('git add -A')), 'a cache that is an array'); ok(lines(q.store).length === 1, 'still matches'); }

// Memory off: the env var, the project marker, a .memory-off tag: no log. Incognito: no log, no crash.
p = project(); quiet(run(p.payload('git add -A'), { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }), 'memory off by env'); ok(lines(p.store).length === 0, 'env off: no log');
// Item 28: autoMemoryEnabled false in the project's own settings.json: no log, whether Claude Code names the project (CLAUDE_PROJECT_DIR) or starts the hook in it.
for (const [how, opts] of [['CLAUDE_PROJECT_DIR', (q) => ({ env: { ...process.env, CLAUDE_PROJECT_DIR: q.cwd } })], ['the hook folder', (q) => ({ cwd: q.cwd })]]) {
  p = project(); mkdirSync(join(p.cwd, '.claude')); writeFileSync(join(p.cwd, '.claude', 'settings.json'), JSON.stringify({ autoMemoryEnabled: false }));
  quiet(spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p.payload('git add -A')), encoding: 'utf8', ...opts(p) }), `memory off in settings (${how})`);
  ok(lines(p.store).length === 0, `settings off, found by ${how}: no log`);
}
p = project(); writeFileSync(join(p.store, PROJECT_OFF), JSON.stringify({ t: 1 })); quiet(run(p.payload('git add -A')), 'project off'); ok(lines(p.store).length === 0, 'project marker: no log');
p = project(); mkdirSync(join(home, '.claude', 'projects'), { recursive: true }); writeFileSync(join(home, '.claude', 'projects', OFF), 'cafe0000\n');
quiet(run(p.payload('git add -A', { session_id: 'cafe0000-1111' })), 'off tag'); ok(lines(p.store).length === 0, 'a .memory-off tag: no log');
quiet(run(p.payload('git add -A', { session_id: 'beef0000-1111' })), 'other session'); ok(lines(p.store).length === 1, 'another session is still watched');
p = project(); writeFileSync(join(p.store, QUIET), 'dead0000\n'); quiet(run(p.payload('git add -A', { session_id: 'dead0000-1' })), 'incognito'); ok(lines(p.store).length === 0, 'an incognito tag: no log');
p = project(); mkdirSync(join(p.store, QUIET)); quiet(run(p.payload('git add -A')), 'an unreadable tag list'); ok(lines(p.store).length === 0, 'a tag list that cannot be read counts as private');
ok(tagOf('dead0000-1') === 'dead0000', 'the tag helper is the one handoff-log exports');

// The shared store's rules count; archive notes do not.
p = project(''); writeFileSync(join(p.store, 'stage.md'), note('plain', ''));
mkdirSync(sharedStore(), { recursive: true }); writeFileSync(join(sharedStore(), 'shared-rule.md'), note('Shared rule', ADD));
quiet(run(p.payload('git add -A')), 'shared'); ok(lines(p.store).length === 1 && lines(p.store)[0].note === '_shared/shared-rule.md', `a shared rule is logged under _shared/ (got ${JSON.stringify(lines(p.store))})`);
writeFileSync(join(sharedStore(), 'shared-rule.md'), note('Shared rule', ADD).replace('type: feedback', 'type: feedback\ntier: archive'));
p = project(''); quiet(run(p.payload('git add -A')), 'archived'); ok(lines(p.store).length === 0, 'an archived note has no rule');
writeFileSync(join(sharedStore(), 'shared-rule.md'), 'x');

// A log over 256 KB stops growing.
p = project(); writeFileSync(join(p.store, LOG), 'x'.repeat(LOG_MAX + 1) + '\n');
quiet(run(p.payload('git add -A', { tool_use_id: 'new1' })), 'log full'); ok(lines(p.store).some((l) => l.id === 'new1') && statSync(join(p.store, LOG)).size < LOG_MAX, 'a full log drops its oldest half and takes the new line');
p = project(); quiet(run(p.payload('git add -A', { agent_type: 'A'.repeat(2e6), tool_use_id: 'T'.repeat(2e6) })), 'huge fields'); ok(statSync(join(p.store, LOG)).size < 1024, 'one log line is bounded');
{ const d = join(home, 'nohook'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'enforce-hook.mjs'), readFileSync(HOOK)); writeFileSync(join(d, 'timing.mjs'), readFileSync(tool('src/timing.mjs')));
  quiet(spawnSync(process.execPath, [join(d, 'enforce-hook.mjs')], { input: '{}', encoding: 'utf8' }), 'enforce.mjs missing'); }
p = project(); { const tp = join(home, 'priv.jsonl'); writeFileSync(tp, '{"type":"user","message":{"content":"x <private-session>"}}\n');
  quiet(run(p.payload('git add -A', { transcript_path: tp })), 'private transcript'); ok(lines(p.store).length === 0, 'no hit logged in a private-session turn');
  const tq = join(home, 'quote.jsonl'); writeFileSync(tq, "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"the <private-session> tag\"}]}}\n{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"content\":\"quoted <private-session>\"}]}}\n");
  p = project(); quiet(run(p.payload('git add -A', { transcript_path: tq })), 'quoted mark'); ok(lines(p.store).length === 1, 'a mark quoted by the assistant or a tool result is no private mark');
  p = project(); quiet(run(p.payload('git add -A', { transcript_path: join(home, 'gone.jsonl') })), 'unreadable transcript'); ok(lines(p.store).length === 0, 'unreadable transcript counts as private'); }

// The cache: built on first run; a second run reads no note (a note changed with its size and time kept is not seen);
// a changed note is read again.
p = project(); const f = join(p.store, 'stage.md'), T = new Date('2026-01-01T00:00:00Z');
utimesSync(f, T, T);
quiet(run(p.payload('git add -A')), 'first run'); ok(Object.keys(JSON.parse(readFileSync(join(p.store, CACHE), 'utf8')).files).join() === 'stage.md', 'the first run builds the cache');
writeFileSync(f, readFileSync(f, 'utf8').replace('-A, --all', '-B, --zzz')); utimesSync(f, T, T);
quiet(run(p.payload('git add -A')), 'second run'); ok(lines(p.store).length === 2, 'the second run used the cache, not the note');
utimesSync(f, T, new Date(T.getTime() + 5000));
quiet(run(p.payload('git add -A')), 'third run'); ok(lines(p.store).length === 2, 'a changed note is read again (its old rule is gone)');
quiet(run(p.payload('git add -B')), 'fourth run'); ok(lines(p.store).length === 3, 'and its new rule applies');

// A cache written by another version is not trusted: its parsed rule (a bogus one here) is rebuilt from the note.
{ const q = project(); quiet(run(q.payload('git add -A')), 'build'); const c = JSON.parse(readFileSync(join(q.store, CACHE), 'utf8'));
  c.v = CACHE_V - 1; c.files['stage.md'].r = { on: 'ls', has: ['x'], unless: [] }; writeFileSync(join(q.store, CACHE), JSON.stringify(c));
  quiet(run(q.payload('git add -A')), 'old cache version'); ok(lines(q.store).length === 2, 'a cache of another version is rebuilt from the notes');
  ok(JSON.parse(readFileSync(join(q.store, CACHE), 'utf8')).v === CACHE_V, 'and written with the current version'); }
// No file is read or made before the `git` check: a non-git command leaves no cache.
{ const q = project(); quiet(run(q.payload('ls -la')), 'non-git'); ok(!existsSync(join(q.store, CACHE)), 'a non-git command builds no cache'); }
// The hook's private test agrees with handoff-log's hushed() on odd tag files.
for (const [what, make] of [['CRLF', (f) => writeFileSync(f, 'dead0000\r\nbeef0000\r\n')], ['empty', (f) => writeFileSync(f, '')], ['a folder', (f) => mkdirSync(f)],
  ['no final newline', (f) => writeFileSync(f, 'beef0000\ndead0000')], ['blank lines', (f) => writeFileSync(f, '\n\ndead0000\n\n')], ['other tags only', (f) => writeFileSync(f, 'beef0000\n')]]) {
  for (const sid of ['dead0000-1', 'abc']) {
    const q = project(); make(join(q.store, QUIET));
    ok((hushed(q.store, tagOf(sid)) !== false) === (ruleSet(q.payload('git add -A', { session_id: sid })).off === true), `ruleSet and hushed agree on ${what} for ${sid}`);
  }
}

// ruleSet and record, called directly.
p = project(); const set = ruleSet(p.payload('git add -A'));
ok(set.rules.length === 1 && set.rules[0].file === 'stage.md' && set.store === p.store, `ruleSet names the store and its rules (got ${JSON.stringify(set)})`);
record(join(home, 'no-such-store'), { note: 'x' }); ok(!existsSync(join(home, 'no-such-store')), 'record makes no store folder');

// hooks.json: both `if` handlers and the timeout, no onFailure, nothing printed as a decision.
const hookFile = JSON.parse(readFileSync(tool('hooks/hooks.json'), 'utf8')), pre = hookFile.hooks.PreToolUse;
ok(pre.length === 2 && pre[0].matcher === 'Bash|PowerShell', 'a PreToolUse group for Bash and PowerShell, and one for the edit tools');
ok(pre[1].matcher === 'Edit|Write|NotebookEdit|MultiEdit' && pre[1].hooks.length === 1 && pre[1].hooks[0].timeout === 5 && !('if' in pre[1].hooks[0]) && pre[1].hooks[0].command === 'node' && pre[1].hooks[0].args.join() === '${CLAUDE_PLUGIN_ROOT}/src/enforce-hook.mjs', 'the edit group: one entry like the others, no `if`');
ok(pre[0].hooks.map((h) => h.if).sort().join() === 'Bash(git *),PowerShell(git *)', 'one handler per `if` rule');
ok(pre[0].hooks.every((h) => h.timeout === 5 && !('onFailure' in h) && !('statusMessage' in h) && h.args[0] === '${CLAUDE_PLUGIN_ROOT}/src/enforce-hook.mjs'), 'timeout 5, no onFailure, no statusMessage');

// The snapshot's .gitignore takes neither dot file.
mkdirSync(join(home, '.claude', 'projects', 'x', 'memory'), { recursive: true });
const ig = gitignore();
ok(ig.split('\n').includes('*') && !ig.includes('enforce'), 'the snapshot ignores everything but an allow list of notes');

// 1.4.1 L: a rule after a description over 2 KB is read
{ const q = project(); writeFileSync(join(q.store, 'stage.md'), note('Stage files by name', ADD).replace('Never run git add -A.', 'x'.repeat(5000)));
  ok(ruleSet(q.payload('git add -A')).rules.length === 1, 'a rule after a long description is cached'); }

// 1.5.3: the agent type and the tool id are cut at 64 characters; a character split across two reads of stdin arrives whole
p = project(); quiet(run(p.payload('git add -A', { agent_type: 'A'.repeat(100), tool_use_id: 'T'.repeat(100) })), 'long fields');
ok(lines(p.store)[0].agent === 'A'.repeat(64) && lines(p.store)[0].id === 'T'.repeat(64), 'agent and id are cut at 64 characters');
{ p = project(); const E = String.fromCharCode(233), at = (pad) => JSON.stringify(p.payload('git add -A', { pad: 'a'.repeat(pad), agent_type: E.repeat(30) })), start = Buffer.byteLength(at(0).slice(0, at(0).indexOf(E)));
  quiet(run(at(65536 - 11 - start)), 'a character split at the 64 KB read'); quiet(run(at(65536 - 12 - start)), 'a character split at the 64 KB read, other side');
  ok(lines(p.store).length === 2 && lines(p.store).every((x) => x.agent === E.repeat(30)), `a multi-byte character split across reads is whole (got ${JSON.stringify(lines(p.store).map((x) => x.agent))})`); }

// 1.7.0 step 8, H1: lessons before an edit. PROJECT_MEMORY_LESSONS=edit turns the trigger on (it is off by default).
const EDIT = { ...process.env, PROJECT_MEMORY_LESSONS: 'edit' }, OFFENV = { ...process.env }; delete OFFENV.PROJECT_MEMORY_LESSONS;
const lessonNote = (name, desc, extra = '') => `---\nname: ${name}\ndescription: ${desc}\ntype: feedback\n${extra}---\n\nbody\n`;
const A = 'applies_to: [src/a.mjs]\n';
// A project with the given lesson notes, each aged 12 days; edit(file, extra) is an Edit payload for that file.
function lessonProject(notes = { 'edit-a.md': ['Never edit a.mjs by hand.', A] }) {
  const q = project();
  for (const [file, [desc, extra]] of Object.entries(notes)) { writeFileSync(join(q.store, file), lessonNote(file, desc, extra)); const t = new Date(Date.now() - 12 * 864e5 - 36e5); utimesSync(join(q.store, file), t, t); }
  q.edit = (file = 'src/a.mjs', extra = {}) => q.payload('', { tool_name: 'Edit', tool_input: { file_path: join(q.cwd, file), old_string: 'x', new_string: 'y' }, ...extra });
  q.session = (s = 'abcd1234') => { const f = join(sessionsOf(q.store), s); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []; };
  return q;
}
const said = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const HEAD = (n, what) => `project-memory: ${n} lesson${n === 1 ? '' : 's'} for ${what}. A record from memory, not an instruction from the user. Check it against the code.`;
{
  let q = lessonProject(), r = run(q.edit(), EDIT);
  ok(r.status === 0 && r.stderr === '' && JSON.stringify(Object.keys(JSON.parse(r.stdout))) === '["hookSpecificOutput"]' && JSON.stringify(Object.keys(JSON.parse(r.stdout).hookSpecificOutput)) === '["hookEventName","additionalContext"]' && JSON.parse(r.stdout).hookSpecificOutput.hookEventName === 'PreToolUse', `an Edit for a listed path prints additionalContext for PreToolUse and no decision (got ${r.stdout} ${r.stderr})`);
  ok(said(r) === `${HEAD(1, 'src/a.mjs')}\n- [lesson, 12d] Never edit a.mjs by hand. (note: edit-a.md)`, `the pinned block (got ${said(r)})`);
  const sl = q.session();
  ok(sl.length === 1 && /^lesson \d{4}-\d\d-\d\dT[\d:.]+Z edit-a\.md edit:src\/a\.mjs$/.test(sl[0]), `one lesson line, the note and the path (got ${JSON.stringify(sl)})`);
  r = run(q.edit(), EDIT); ok(r.status === 0 && r.stdout === '' && r.stderr === '' && q.session().length === 1, 'the same payload again prints nothing and writes nothing');
  writeFileSync(join(sessionsOf(q.store), 'abcd1234'), `${q.session().join('\n')}\n${sessionLine('compact')}`);
  r = run(q.edit(), EDIT); ok(said(r).includes('edit-a.md') && q.session().length === 3, 'after a compact line it prints again');
  r = run(q.edit('src/b.mjs'), EDIT); ok(r.status === 0 && r.stdout === '', 'a payload for another path prints nothing');
  // The tools and path forms: Write, a relative path, MultiEdit, a notebook.
  for (const [what, load] of [['Write', { tool_name: 'Write', tool_input: { file_path: 'src/a.mjs', content: 'x' } }], ['a relative path', { tool_input: { file_path: 'src/a.mjs' } }], ['MultiEdit', { tool_name: 'MultiEdit' }],
    ['NotebookEdit', { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'src/a.mjs' } }]]) {
    q = lessonProject(); r = run(q.edit('src/a.mjs', load), EDIT); ok(r.status === 0 && said(r).includes('edit-a.md'), `${what}: the lesson is shown`);
  }
  // Nothing is shown, and nothing breaks.
  q = lessonProject(); r = run(q.edit(), OFFENV); ok(r.status === 0 && r.stdout === '' && r.stderr === '' && q.session().length === 0, 'PROJECT_MEMORY_LESSONS unset: edit is off by default');
  r = run(q.edit(), { ...EDIT, PROJECT_MEMORY_LESSONS: '0' }); ok(r.stdout === '' && q.session().length === 0, 'PROJECT_MEMORY_LESSONS=0: nothing');
  r = run(q.edit(), { ...EDIT, PROJECT_MEMORY_LESSONS: 'edit,-edit' }); ok(r.stdout === '', 'edit,-edit: nothing');
  q = lessonProject(); mkdirSync(sessionsOf(q.store), { recursive: true }); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), `${sessionLine('asked', 'fix it')}${sessionLine('quiet')}`);
  quiet(run(q.edit(), EDIT), 'a private turn (quiet newest)'); ok(q.session().length === 2, 'no lesson line in a private turn');
  writeFileSync(join(sessionsOf(q.store), 'abcd1234'), `${sessionLine('quiet')}${sessionLine('asked', 'fix it')}`); ok(said(run(q.edit(), EDIT)).includes('edit-a.md'), 'a later prompt ends the private turn');
  q = lessonProject(); mkdirSync(join(sessionsOf(q.store), 'abcd1234'), { recursive: true }); quiet(run(q.edit(), EDIT), 'a session file that will not read');
  q = lessonProject(); writeFileSync(join(q.store, PROJECT_OFF), JSON.stringify({ t: 1 })); quiet(run(q.edit(), EDIT), 'project off'); ok(q.session().length === 0, 'project off: no line');
  q = lessonProject(); writeFileSync(join(q.store, QUIET), 'abcd1234\n'); quiet(run(q.edit(), EDIT), 'incognito'); ok(q.session().length === 0, 'incognito: no line');
  q = lessonProject(); quiet(run(q.edit(), { ...EDIT, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }), 'auto memory off');
  q = lessonProject(); writeFileSync(join(q.store, CACHE), '{ not json'); r = run(q.edit(), EDIT); ok(r.status === 0 && r.stderr === '' && said(r).includes('edit-a.md'), 'a broken cache is rebuilt from the notes, as for the rules, and the hook exits 0');
  q = lessonProject(); rmSync(q.store, { recursive: true }); writeFileSync(q.store, 'x'); quiet(run(q.edit(), EDIT), 'a store that is a file');
  q = lessonProject(); quiet(run(q.edit('../elsewhere/a.mjs'), EDIT), 'a path outside the project');
  q = lessonProject(); quiet(run(q.edit('x', { tool_input: { file_path: join(q.store, 'x.md') } }), EDIT), 'a memory file'); ok(q.session().length === 0, 'a file under the projects folder gets nothing');
  q = lessonProject(); quiet(run(q.edit('src/a.mjs', { tool_input: { file_path: 7 } }), EDIT), 'a path that is a number');
  quiet(run(q.edit('src/a.mjs', { tool_input: {} }), EDIT), 'no path'); quiet(run(q.edit('src/a.mjs', { session_id: '../x' }), EDIT), 'a session id that is no tag'); ok(q.session().length === 0, 'no line for those');
  quiet(run({}, EDIT), 'an empty payload'); quiet(run('', EDIT), 'empty stdin'); quiet(run({ tool_name: 'Edit' }, EDIT), 'an Edit with nothing else');
  // A helper: its line carries its id, and its once-per-context list is its own.
  q = lessonProject(); r = run(q.edit('src/a.mjs', { agent_id: 'a1b2c3', agent_type: 'general-purpose' }), EDIT);
  ok(said(r).includes('edit-a.md') && /^lesson \S+ agent:a1b2c3 edit-a\.md edit:src\/a\.mjs$/.test(q.session()[0]), `a helper's payload writes its line with agent:<id> (got ${JSON.stringify(q.session())})`);
  ok(run(q.edit('src/a.mjs', { agent_id: 'a1b2c3' }), EDIT).stdout === '', 'the same helper is told once');
  ok(said(run(q.edit(), EDIT)).includes('edit-a.md') && said(run(q.edit('src/a.mjs', { agent_id: 'zzz' }), EDIT)).includes('edit-a.md'), 'the main conversation and another helper each get it once');
  // Two at most, the cap of 6 a context, and a lesson shown once whatever file triggers it.
  const eight = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`l${i}.md`, [`Lesson ${i} for a.`, A]]));
  q = lessonProject(eight); const outs = [1, 2, 3, 4, 5].map(() => run(q.edit(), EDIT));
  ok(said(outs[0]) === `${HEAD(2, 'src/a.mjs')}\n- [lesson, 12d] Lesson 1 for a. (note: l1.md)\n- [lesson, 12d] Lesson 2 for a. (note: l2.md)\nand 6 more: memory skill, search --file src/a.mjs`, `two lessons and the rest counted (got ${said(outs[0])})`);
  ok(said(outs[1]).includes('l3.md') && said(outs[1]).includes('l4.md') && said(outs[1]).endsWith('and 4 more: memory skill, search --file src/a.mjs') && said(outs[2]).includes('l5.md') && said(outs[2]).includes('l6.md'), 'the next two, then the next');
  ok(outs[3].stdout === '' && outs[4].stdout === '' && q.session().length === 6, 'a seventh lesson is not shown: 6 a context');
  q = lessonProject({ 'both.md': ['Both files.', 'applies_to: [src/a.mjs, src/b.mjs]\n'] }); run(q.edit('src/a.mjs'), EDIT); ok(run(q.edit('src/b.mjs'), EDIT).stdout === '', 'a lesson is shown once per context whatever file triggers it');
  q = lessonProject({ 'a-glob.md': ['By glob.', 'applies_to: [src/*.mjs]\n'], 'exact.md': ['By path.', A], 'dead.md': ['Dead end.', `${A}instead: use the helper that exists now\n`] });
  r = run(q.edit(), EDIT); ok(said(r).split('\n').filter((l) => l.startsWith('- ')).map((l) => /note: (\S+)\)$/.exec(l)[1]).join() === 'dead.md,exact.md' && said(r).includes('[dead end, 12d] Dead end. Instead: use the helper that exists now'), `the listed paths first, a dead end in its form, a glob after (got ${said(r)})`);
  // The agent id is cleaned and cut to 64; a path with a line break is no path; 8 lesson lines already in the context leave no room.
  q = lessonProject(); r = run(q.edit('src/a.mjs', { agent_id: 'a1 b2!' + 'x'.repeat(100) }), EDIT); ok(q.session()[0].split(' ')[2] === `agent:a1b2${'x'.repeat(60)}`, 'the agent id loses what is no word character and is cut at 64');
  q = lessonProject({ 'nl.md': ['A glob.', 'applies_to: [src/*.mjs]\n'] }); quiet(run(q.edit('src/a\nb.mjs'), EDIT), 'a path with a line break'); ok(q.session().length === 0, 'no lesson line for a path with a line break');
  q = lessonProject(eight); mkdirSync(sessionsOf(q.store), { recursive: true }); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), [1, 2, 3, 4, 5, 6, 7, 8].map((i) => sessionLine('lesson', `other${i}.md edit:src/z.mjs`)).join(''));
  quiet(run(q.edit(), EDIT), 'more than the cap already told'); ok(q.session().length === 8, 'past the cap nothing more is told');
  // In process: the 150 ms deadline, and dry, which reads no session lines and writes none.
  { const was = process.env.PROJECT_MEMORY_LESSONS; process.env.PROJECT_MEMORY_LESSONS = 'edit';
    q = lessonProject(); ok(onEdit(q.edit(), { deadline: -1 }).say === '' && q.session().length === 0, 'past the deadline it says nothing and writes nothing');
    const real = onEdit(q.edit()); ok(real.say.includes('edit-a.md') && real.shown.length === 1 && q.session().length === 1, 'onEdit returns the text and what it showed');
    const dir = lessonProject(); mkdirSync(join(sessionsOf(dir.store), 'abcd1234'), { recursive: true }); ok(onEdit(dir.edit()).say === '', 'a session file that will not read: nothing, and no throw');
    const dry = onEdit(q.edit(), { dry: true }); ok(dry.say === real.say && q.session().length === 1, 'dry: the same text from a fresh context, and no line written');
    if (was === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = was; }
  // The shared store's lessons never match a path.
  q = lessonProject({}); mkdirSync(sharedStore(), { recursive: true }); writeFileSync(join(sharedStore(), 'sh.md'), lessonNote('sh', 'Shared.', A)); quiet(run(q.edit(), EDIT), 'a shared lesson'); rmSync(join(sharedStore(), 'sh.md'));
  // A shell payload is as in 1.6.7 with the trigger on: the log line, nothing printed, no lesson line.
  p = project(); r = run(p.payload('git add -A'), EDIT); quiet(r, 'a match, edit on');
  l = lines(p.store); ok(l.length === 1 && l[0].note === 'stage.md' && Object.keys(l[0]).join() === 't,note,s,agent,id', `a shell payload's log line is unchanged (got ${JSON.stringify(l)})`);
}

console.log(`enforce-hook: ${checks} checks passed`);
