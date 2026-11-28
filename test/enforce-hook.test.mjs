// Self-check for enforce-hook.mjs, the PreToolUse hook that watches git commands against the
// enforce: rules in notes and logs which note matched. It prints nothing and blocks nothing.
// Run: node enforce-hook.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync, cpSync, renameSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
import { sessionsOf, sessionLine, sweepSessions } from '../src/sessions.mjs';
import { onEdit, onCommand } from '../src/lessons.mjs';

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
ok(pre[0].hooks.some((h) => h.if === 'Bash(git *)') && pre[0].hooks.some((h) => h.if === 'PowerShell(git *)') && pre[0].hooks.every((h) => typeof h.if === 'string'), 'one handler per `if` rule, the git ones among them (step 9 adds the rest)');
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
  // A memory file: the cwd holds the store, so the file is inside the root and only the projects-folder rule keeps it quiet. A listed
  // file next to it, from the same cwd, is told (so the project is wired and a lesson on the memory file would have been told too).
  { const store = storeFor(home, home), file = join(store, 'x.md'), up = (f) => f.slice(home.length + 1).replaceAll('\\', '/'), edit = (f, s) => ({ session_id: s, cwd: home, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: f } });
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'mem.md'), lessonNote('mem.md', 'About a memory file.', `applies_to: [${up(file)}]\n`)); writeFileSync(join(store, 'other.md'), lessonNote('other.md', 'About a plain file.', 'applies_to: [other.mjs]\n'));
    ok(said(run(edit(join(home, 'other.mjs'), 'mem00001'), EDIT)).includes('other.md'), 'a listed file under the home folder is told');
    quiet(run(edit(file, 'mem00002'), EDIT), 'a memory file'); ok(!existsSync(join(sessionsOf(store), 'mem00002')), 'a file under the projects folder gets nothing'); }
  q = lessonProject(); quiet(run(q.edit('src/a.mjs', { tool_input: { file_path: 7 } }), EDIT), 'a path that is a number');
  quiet(run(q.edit('src/a.mjs', { tool_input: {} }), EDIT), 'no path'); quiet(run(q.edit('src/a.mjs', { session_id: '../x' }), EDIT), 'a session id that is no tag'); ok(q.session().length === 0, 'no line for those');
  quiet(run({}, EDIT), 'an empty payload'); quiet(run('', EDIT), 'empty stdin'); quiet(run({ tool_name: 'Edit' }, EDIT), 'an Edit with nothing else');
  // A worktree is its own root: the lessons are the main repository's, the path is relative to the worktree (the `.git` there is a file).
  { const main = join(home, 'wtmain'), wt = join(main, '.claude', 'wt-x'), gd = join(main, '.git', 'worktrees', 'wt-x'), store = storeFor(home, main);
    for (const d of [gd, join(wt, 'src'), store]) mkdirSync(d, { recursive: true });
    writeFileSync(join(gd, 'commondir'), '../..\n'); writeFileSync(join(gd, 'gitdir'), `${join(wt, '.git')}\n`); writeFileSync(join(wt, '.git'), `gitdir: ${gd}\n`);
    writeFileSync(join(store, 'edit-a.md'), lessonNote('edit-a.md', 'Never edit a.mjs by hand.', A));
    const edit = (cwd, file, s) => ({ session_id: s, cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(cwd, file) } });
    r = run(edit(wt, 'src/a.mjs', 'wtree001'), EDIT); ok(r.status === 0 && said(r).startsWith(HEAD(1, 'src/a.mjs')) && said(r).includes('edit-a.md'), `in a worktree the path is relative to the worktree (got ${r.stdout}${r.stderr})`);
    r = run(edit(join(wt, 'src'), 'a.mjs', 'wtree002'), EDIT); ok(r.status === 0 && said(r).startsWith(HEAD(1, 'src/a.mjs')), `from a folder of the worktree too (got ${r.stdout}${r.stderr})`);
    quiet(run({ ...edit(wt, 'src/a.mjs', 'wtree003'), tool_input: { file_path: join(main, 'src', 'a.mjs') } }, EDIT), 'a file of the main repository, edited from its worktree'); }
  // A cwd that is no string, or blank, is no place: nothing, and no throw (a hook calls this).
  { const was = process.env.PROJECT_MEMORY_LESSONS; process.env.PROJECT_MEMORY_LESSONS = 'edit';
    q = lessonProject();
    for (const cwd of [7, null, {}, '', '   ']) { let out; try { out = onEdit({ ...q.edit(), cwd }); } catch (e) { out = e; } ok(out?.say === '' && q.session().length === 0, `a cwd of ${JSON.stringify(cwd)}: nothing, no throw (got ${out})`); }
    // With a transcript the store is the project's whatever the cwd says, so a blank cwd is the only thing between a relative path and a lesson.
    const t = join(q.store, '..', 'blank001.jsonl'), rel = q.edit('src/a.mjs', { tool_input: { file_path: 'src/a.mjs' }, transcript_path: t });
    writeFileSync(t, `${JSON.stringify({ type: 'user', cwd: q.cwd, timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'hello' }] } })}\n`);
    ok(onEdit({ ...rel, cwd: q.cwd }, { dry: true }).say.includes('edit-a.md'), 'a relative path, a real cwd and a transcript: told');
    for (const cwd of ['', '   ']) ok(onEdit({ ...rel, cwd }).say === '' && q.session().length === 0, `a relative path with a cwd of ${JSON.stringify(cwd)}: nothing`);
    if (was === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = was; }
  // A block over BLOCK_MAX (two long lines and a long path) is not told, and writes no line; one lesson of them fits.
  { const long = (c) => `${c} words that make a long line`.repeat(14), deep = `src/${'d'.repeat(150)}.mjs`;
    q = lessonProject({ 'p1.md': [long('x'), 'applies_to: [src/*.mjs]\n'], 'p2.md': [long('y'), 'applies_to: [src/*.mjs]\n'] });
    quiet(run(q.edit(deep), EDIT), 'two lessons over 800 characters'); ok(q.session().length === 0, 'no line for a block that was not told');
    q = lessonProject({ 'p1.md': [long('x'), 'applies_to: [src/*.mjs]\n'] }); r = run(q.edit(deep), EDIT); ok(said(r).length <= 800 && said(r).includes('p1.md') && q.session().length === 1, 'one long lesson fits'); }
  // The sessions line is not written (the disk is full, say): nothing is told, since it could not be counted.
  { const was = process.env.PROJECT_MEMORY_LESSONS; process.env.PROJECT_MEMORY_LESSONS = 'edit'; const real = fs.appendFileSync;
    q = lessonProject(); fs.appendFileSync = () => { throw new Error('no space left'); }; syncBuiltinESMExports();
    try { ok(onEdit(q.edit()).say === '' && q.session().length === 0, 'a session line that will not write: nothing told, no throw'); } finally { fs.appendFileSync = real; syncBuiltinESMExports(); }
    ok(onEdit(q.edit()).say.includes('edit-a.md'), 'and told once it writes again');
    if (was === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = was; }
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
  // With the trigger off an Edit asks switches.mjs and stops: lessons.mjs is not loaded and no timing line is written. A copy of src/
  // whose lessons.mjs marks its load, and, for the deadline, takes 250 ms to load (the 150 ms count from the hook's input, not from onEdit).
  { const copy = join(home, 'src-copy'), mark = join(home, 'lessons-loaded'), timing = join(home, '.claude', 'projects', '.timing'), timed = () => (existsSync(timing) ? readFileSync(timing, 'utf8') : '');
    cpSync(tool('src'), copy, { recursive: true }); renameSync(join(copy, 'lessons.mjs'), join(copy, 'lessons-real.mjs'));
    const slow = (ms) => writeFileSync(join(copy, 'lessons.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(mark)}, 'x'); const t = performance.now(); while (performance.now() - t < ${ms});\nexport * from './lessons-real.mjs';\n`);
    const via = (input, env) => spawnSync(process.execPath, [join(copy, 'enforce-hook.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env });
    slow(0); q = lessonProject(); let was = timed();
    r = via(q.edit(), OFFENV); ok(r.status === 0 && r.stdout === '' && r.stderr === '' && !existsSync(mark) && timed() === was, 'edit off: lessons.mjs not loaded, no timing line');
    r = via(q.edit(), { ...OFFENV, PROJECT_MEMORY_LESSONS: '-edit' }); ok(r.stdout === '' && !existsSync(mark) && timed() === was, 'edit off by -edit: the same');
    r = via(q.payload('git status'), OFFENV); ok(r.stdout === '' && !existsSync(mark) && timed() !== was, 'a shell command loads no lessons.mjs and is timed as before');
    was = timed(); r = via(q.edit(), EDIT); const added = timed().slice(was.length).trim().split('\n').map((x) => JSON.parse(x));
    ok(existsSync(mark) && said(r).includes('edit-a.md') && added.length === 1 && added[0].h === 'lesson' && added[0].e === 'PreToolUse' && added[0].n === 1, `edit on: loaded, told, one timing line of the lesson hook with the count (got ${JSON.stringify(added)})`);
    rmSync(mark); slow(250); q = lessonProject(); r = via(q.edit(), EDIT); quiet(r, 'a load that takes 250 ms is past the 150 ms'); ok(q.session().length === 0, 'and writes no line');
    rmSync(mark); slow(0); r = via(lessonProject().edit(), EDIT); ok(said(r).includes('edit-a.md'), 'the same copy with a quick load tells it'); }
  // The shared store's lessons never match a path.
  q = lessonProject({}); mkdirSync(sharedStore(), { recursive: true }); writeFileSync(join(sharedStore(), 'sh.md'), lessonNote('sh', 'Shared.', A)); quiet(run(q.edit(), EDIT), 'a shared lesson'); rmSync(join(sharedStore(), 'sh.md'));
  // A shell payload is as in 1.6.7 with the trigger on: the log line, nothing printed, no lesson line.
  p = project(); r = run(p.payload('git add -A'), EDIT); quiet(r, 'a match, edit on');
  l = lines(p.store); ok(l.length === 1 && l[0].note === 'stage.md' && Object.keys(l[0]).join() === 't,note,s,agent,id', `a shell payload's log line is unchanged (got ${JSON.stringify(l)})`);
}

// 1.7.0 step 9, H2: lessons before a risky command (on by default; `command`). A lesson says `applies_when: [<family>]`.
{
  const CMD = { ...process.env, PROJECT_MEMORY_LESSONS: 'command' }, W = (w) => `applies_when: [${w}]\n`;
  const cp = (notes) => lessonProject(notes);
  let q = cp({ 'push.md': ['Never push to main by hand.', W('push')] }), r = run(q.payload('git push origin main'), CMD);
  ok(r.status === 0 && r.stderr === '' && JSON.stringify(Object.keys(JSON.parse(r.stdout).hookSpecificOutput)) === '["hookEventName","additionalContext"]' && JSON.parse(r.stdout).hookSpecificOutput.hookEventName === 'PreToolUse', `a push prints additionalContext for PreToolUse and no decision (got ${r.stdout}${r.stderr})`);
  ok(said(r) === `${HEAD(1, 'push')}\n- [lesson, 12d] Never push to main by hand. (note: push.md)`, `the pinned block (got ${said(r)})`);
  ok(q.session().length === 1 && /^lesson \d{4}-\d\d-\d\dT[\d:.]+Z push\.md cmd:push$/.test(q.session()[0]), `one lesson line with cmd:push (got ${JSON.stringify(q.session())})`);
  r = run(q.payload('git push origin main', { tool_use_id: 'toolu_2' }), CMD); quiet(r, 'the same lesson again in the same context'); ok(q.session().length === 1, 'and no second line');
  // The default is on: no variable at all still tells; -command and 0 do not, and load nothing.
  q = cp({ 'push.md': ['Never push to main by hand.', W('push')] });
  ok(said(run(q.payload('git push'), OFFENV)).includes('push.md'), 'PROJECT_MEMORY_LESSONS unset: commands are on by default');
  for (const v of ['-command', '0']) { q = cp({ 'push.md': ['Push.', W('push')] }); quiet(run(q.payload('git push'), { ...process.env, PROJECT_MEMORY_LESSONS: v }), `PROJECT_MEMORY_LESSONS=${v}`); ok(q.session().length === 0, `${v}: no line`); }
  // The other commands and their families.
  q = cp({ 'publish.md': ['Run the tests before publishing.', W('publish')] }); ok(said(run(q.payload('npm publish'), CMD)).startsWith(HEAD(1, 'publish')), 'npm publish: the publish lesson');
  q = cp({ 'release.md': ['Tag after the merge.', W('release')], 'publish.md': ['Run the tests before publishing.', W('publish')] });
  r = run(q.payload('gh release create v1'), CMD); ok(said(r).startsWith(HEAD(1, 'release')) && said(r).includes('release.md') && !said(r).includes('publish.md'), `gh release create: the release lesson, not the publish one (got ${said(r)})`);
  q = cp({ 'deploy.md': ['Deploy from CI.', W('deploy')] }); quiet(run(q.payload('echo deploy'), CMD), 'echo deploy is no command about deploy'); ok(q.session().length === 0, 'no line for it');
  q = cp({ 'none.md': ['Unrelated.', 'applies_to: [src/a.mjs]\n'] }); quiet(run(q.payload('git push'), CMD), 'a lesson for a path, not a family');
  // An untagged feedback lesson that names the family is told (how 4); the project's own come before it.
  q = cp({ 'named.md': ['Never force push to main.', ''], 'tagged.md': ['Check CI first.', W('push')] });
  ok(said(run(q.payload('git push'), CMD)).split('\n').filter((l) => l.startsWith('- ')).map((l) => /note: (\S+)\)$/.exec(l)[1]).join() === 'tagged.md,named.md', 'tagged before named');
  // Two families: the block names the first with a match; a lesson for both is told once, as the first.
  q = cp({ 'both.md': ['Check twice.', W('push, destroy')], 'des.md': ['Not that.', W('destroy')] });
  r = run(q.payload('git push --force'), CMD); ok(said(r).startsWith(HEAD(2, 'push')) && q.session().length === 2 && q.session().some((x) => x.endsWith('both.md cmd:push')) && q.session().some((x) => x.endsWith('des.md cmd:destroy')), `two families (got ${said(r)} ${JSON.stringify(q.session())})`);
  // The block is about a family of a lesson it shows: the push lesson was told before, so only the destroy one is, and the header says destroy.
  q = cp({ 'p.md': ['Check twice.', W('push')], 'des.md': ['Not that.', W('destroy')] }); mkdirSync(sessionsOf(q.store), { recursive: true }); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), sessionLine('lesson', 'p.md cmd:push'));
  r = run(q.payload('git push --force'), CMD); ok(said(r).startsWith(HEAD(1, 'destroy')) && said(r).includes('des.md') && !said(r).includes('p.md'), `the header names the family of what it shows (got ${said(r)})`);
  // The shared store's lesson is named _shared/<file>.
  q = cp({}); mkdirSync(sharedStore(), { recursive: true }); writeFileSync(join(sharedStore(), 'sh.md'), lessonNote('sh', 'Shared push lesson.', W('push')));
  r = run(q.payload('git push'), CMD); ok(said(r).includes('Shared push lesson. (note: _shared/sh.md)') && q.session()[0].includes('_shared%2Fsh.md cmd:push'), `a shared lesson, named _shared/<file> (got ${said(r)} ${JSON.stringify(q.session())})`);
  rmSync(join(sharedStore(), 'sh.md'));
  // A git rule hit logs as before while the lesson prints.
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); r = run(q.payload('git add -A && git push'), CMD);
  ok(r.status === 0 && said(r).includes('push.md') && lines(q.store).length === 1 && lines(q.store)[0].note === 'stage.md' && Object.keys(lines(q.store)[0]).join() === 't,note,s,agent,id', `the rule is logged and the lesson printed (got ${r.stdout}${JSON.stringify(lines(q.store))})`);
  // A call the filters start twice: the second start finds the marker of the first and is silent, whatever the session file says.
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); mkdirSync(sessionsOf(q.store), { recursive: true });
  const marker = (id) => join(sessionsOf(q.store), `abcd1234.pre-${id}`);
  writeFileSync(marker('toolu_9'), ''); quiet(run(q.payload('git push', { tool_use_id: 'toolu_9' }), CMD), 'the marker of this call exists'); ok(q.session().length === 0, 'and no line is written');
  r = run(q.payload('git push', { tool_use_id: 'toolu_8' }), CMD); ok(said(r).includes('push.md') && existsSync(marker('toolu_8')), 'a call with no marker speaks and leaves one');
  // A helper has its own list; an incognito or private turn is silent; so is a memory-off project.
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push', { agent_id: 'a1' }), CMD);
  ok(/^lesson \S+ agent:a1 push\.md cmd:push$/.test(q.session()[0]) && said(run(q.payload('git push', { tool_use_id: 'toolu_7' }), CMD)).includes('push.md'), 'a helper is told once and the main conversation too');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); writeFileSync(join(q.store, QUIET), 'abcd1234\n'); quiet(run(q.payload('git push'), CMD), 'incognito');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); quiet(run(q.payload('git push'), { ...CMD, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }), 'auto memory off');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); mkdirSync(sessionsOf(q.store), { recursive: true }); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), `${sessionLine('asked', 'x')}${sessionLine('quiet')}`);
  quiet(run(q.payload('git push'), CMD), 'a private turn'); ok(q.session().length === 2, 'no line in a private turn');
  // The six a context are shared with the edit lessons; onCommand in process: deadline, dry, a command with no family.
  { const was = process.env.PROJECT_MEMORY_LESSONS; process.env.PROJECT_MEMORY_LESSONS = 'command';
    q = cp({ 'push.md': ['Check before pushing.', W('push')] });
    ok(onCommand(q.payload('git push'), ['push'], { deadline: -1 }).say === '' && q.session().length === 0, 'past the deadline: nothing, no line');
    const dry = onCommand(q.payload('git push'), ['push'], { dry: true }); ok(dry.say.includes('push.md') && q.session().length === 0 && !existsSync(marker('toolu_1')), 'dry: the text, no line, no marker');
    ok(onCommand(q.payload('git push'), [], {}).say === '' && onCommand(q.payload('git push'), undefined, {}).say === '', 'no family: nothing');
    for (const cwd of [7, null, {}]) ok(onCommand({ ...q.payload('git push'), cwd }, ['push']).say === '', `a cwd of ${JSON.stringify(cwd)}: nothing`);
    ok(onCommand(q.payload('git push'), ['push']).say === dry.say && onCommand(q.payload('git push', { tool_use_id: 'toolu_3' }), ['push']).say === '', 'real after dry: the same text, then once');
    if (was === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = was; }
  // The cap of 6 a context (shared with the edit lessons), a context already past it, a compact line, the helper id, a session id that is no tag.
  const eight = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`l${i}.md`, [`Lesson ${i} for push.`, W('push')]]));
  q = cp(eight); const outs = [1, 2, 3, 4].map((i) => run(q.payload('git push', { tool_use_id: `toolu_c${i}` }), CMD));
  ok(said(outs[0]).startsWith(HEAD(2, 'push')) && said(outs[0]).endsWith('and 6 more: memory skill, lessons') && said(outs[1]).includes('l3.md') && said(outs[2]).includes('l5.md') && outs[3].stdout === '' && q.session().length === 6, 'two a time, 6 a context');
  q = cp(eight); mkdirSync(sessionsOf(q.store), { recursive: true }); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), [1, 2, 3, 4, 5, 6, 7, 8].map((i) => sessionLine('lesson', `other${i}.md edit:src/z.mjs`)).join(''));
  quiet(run(q.payload('git push'), CMD), 'more than the cap already told'); ok(q.session().length === 8 && !fs.readdirSync(sessionsOf(q.store)).some((n) => n.includes('.pre-')), 'past the cap nothing more is told, and no marker is left');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push'), CMD); writeFileSync(join(sessionsOf(q.store), 'abcd1234'), `${q.session().join('\n')}\n${sessionLine('compact')}`);
  ok(said(run(q.payload('git push', { tool_use_id: 'toolu_k' }), CMD)).includes('push.md'), 'after a compact line it is told again');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push', { agent_id: 'a1 b2!' + 'x'.repeat(100) }), CMD); ok(q.session()[0].split(' ')[2] === `agent:a1b2${'x'.repeat(60)}`, 'the helper id loses what is no word character and is cut at 64');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); quiet(run(q.payload('git push', { session_id: '../x' }), CMD), 'a session id that is no tag'); ok(q.session().length === 0, 'no line for it');
  // A session line that will not write: nothing told.
  { const was = process.env.PROJECT_MEMORY_LESSONS; process.env.PROJECT_MEMORY_LESSONS = 'command'; const real = fs.appendFileSync;
    q = cp({ 'push.md': ['Check before pushing.', W('push')] }); fs.appendFileSync = () => { throw new Error('no space left'); }; syncBuiltinESMExports();
    try { ok(onCommand(q.payload('git push'), ['push']).say === '' && q.session().length === 0, 'a session line that will not write: nothing told, no throw'); } finally { fs.appendFileSync = real; syncBuiltinESMExports(); }
    ok(onCommand(q.payload('git push', { tool_use_id: 'toolu_w' }), ['push']).say.includes('push.md'), 'and told once it writes again');
    q = cp({ 'none.md': ['Unrelated.', W('deploy')] }); ok(onCommand(q.payload('git push'), ['push']).say === '', 'no lesson for the family: nothing, no throw');
    // A session file that will not read (a folder where it should be, on every OS) may hold a private turn's mark: nothing told, no throw.
    q = cp({ 'push.md': ['Check before pushing.', W('push')] }); mkdirSync(join(sessionsOf(q.store), 'abcd1234'), { recursive: true });
    ok(onCommand(q.payload('git push'), ['push']).say === '' && fs.readdirSync(sessionsOf(q.store)).join() === 'abcd1234', 'a session file that will not read: nothing told, no marker, no throw');
    if (was === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = was; }
  // The marker's name is the tool id cleaned and cut; a call with no id leaves none; the sweep of old session files removes it.
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push', { tool_use_id: '../zz' }), CMD); ok(existsSync(marker('zz')), 'the tool id is cleaned in the marker name');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push', { tool_use_id: 'a'.repeat(100) }), CMD); ok(existsSync(marker('a'.repeat(64))) && !existsSync(marker('a'.repeat(65))), 'and cut at 64');
  q = cp({ 'push.md': ['Check before pushing.', W('push')] }); r = run({ ...q.payload('git push'), tool_use_id: undefined }, CMD); ok(said(r).includes('push.md') && !fs.readdirSync(sessionsOf(q.store)).some((n) => n.includes('.pre-')), 'no tool id: told, no marker');
  { const old = new Date(Date.now() - 8 * 864e5); q = cp({ 'push.md': ['Check before pushing.', W('push')] }); run(q.payload('git push', { tool_use_id: 'toolu_old' }), CMD); utimesSync(marker('toolu_old'), old, old);
    sweepSessions(); ok(!existsSync(marker('toolu_old')), 'the sweep of old session files removes a marker'); }
  // With the trigger off a shell command loads no lessons.mjs, and a command with no family loads none either.
  { const copy = join(home, 'src-copy-cmd'), mark = join(home, 'lessons-loaded-cmd');
    cpSync(tool('src'), copy, { recursive: true }); renameSync(join(copy, 'lessons.mjs'), join(copy, 'lessons-real.mjs'));
    writeFileSync(join(copy, 'lessons.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(mark)}, 'x');\nexport * from './lessons-real.mjs';\n`);
    const via = (input, env) => spawnSync(process.execPath, [join(copy, 'enforce-hook.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env });
    q = cp({ 'push.md': ['Check before pushing.', W('push')] });
    quiet(via(q.payload('git push'), { ...process.env, PROJECT_MEMORY_LESSONS: '-command' }), 'command off'); ok(!existsSync(mark), 'command off: lessons.mjs not loaded');
    quiet(via(q.payload('git status'), CMD), 'a command with no family'); ok(!existsSync(mark), 'no family: lessons.mjs not loaded');
    const timing = join(home, '.claude', 'projects', '.timing'), timed = () => (existsSync(timing) ? readFileSync(timing, 'utf8') : ''), was = timed();
    ok(said(via(q.payload('git push'), CMD)).includes('push.md') && existsSync(mark), 'on, with a family: loaded and told');
    const added = timed().slice(was.length).trim().split('\n').map((x) => JSON.parse(x));
    ok(added.length === 1 && added[0].h === 'lesson' && added[0].e === 'PreToolUse' && added[0].n === 1, `one timing line of the lesson hook with the count (got ${JSON.stringify(added)})`);
    // The 150 ms count from the hook's input: a load of 250 ms is past it.
    writeFileSync(join(copy, 'lessons.mjs'), `const t = performance.now(); while (performance.now() - t < 250);\nexport * from './lessons-real.mjs';\n`);
    q = cp({ 'push.md': ['Check before pushing.', W('push')] }); quiet(via(q.payload('git push'), CMD), 'a load of 250 ms is past the 150 ms'); ok(q.session().length === 0, 'and writes no line'); }
  // hooks.json: the git filters, then one entry per risky command and shell, each as the git ones.
  const FILTERS = ['npm publish*', 'pnpm publish*', 'yarn publish*', 'cargo publish*', 'gh release *', 'gh pr merge*', 'docker push*', '*deploy*', 'rm -rf *', 'rm -fr *', 'rm -Rf *', 'rm -r -f *', 'terraform apply*', 'terraform destroy*', 'kubectl delete*'];
  const want = ['Bash(git *)', 'PowerShell(git *)', 'PowerShell(Remove-Item *)', 'Bash(*tools/release.mjs*)', 'PowerShell(*release.mjs*)', ...FILTERS.flatMap((f) => [`Bash(${f})`, `PowerShell(${f})`])].sort().join('\n');
  ok(pre[0].hooks.length === 35 && pre[0].hooks.map((h) => h.if).sort().join('\n') === want, `the Bash|PowerShell group holds 35 entries: git, ${FILTERS.length} filters in both shells, release.mjs, Remove-Item (got ${pre[0].hooks.length})`);
  ok(pre[0].hooks.every((h) => h.type === 'command' && h.command === 'node' && h.timeout === 5 && !('onFailure' in h) && !('statusMessage' in h) && h.args.join() === '${CLAUDE_PLUGIN_ROOT}/src/enforce-hook.mjs'), 'every entry is the same command as the git ones');
}

console.log(`enforce-hook: ${checks} checks passed`);
