// Self-check for enforce-hook.mjs, the PreToolUse hook that watches git commands against the
// enforce: rules in notes and logs which note matched. It prints nothing and blocks nothing.
// Run: node enforce-hook.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor } from './harness.mjs';
import { ruleSet, record, LOG, CACHE, CACHE_V, LOG_MAX } from './enforce.mjs';
import { QUIET, OFF, PROJECT_OFF, sharedStore } from './store.mjs';
import { tag as tagOf, hushed } from './handoff-log.mjs';
import { gitignore } from './memory-tier.mjs';

const { home } = tempHome('enforce-hook-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const HOOK = tool('enforce-hook.mjs');
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
quiet(run(p.payload('git add -A')), 'log full'); ok(statSync(join(p.store, LOG)).size === LOG_MAX + 2, 'a full log gets no new line');

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
ok(pre.length === 1 && pre[0].matcher === 'Bash|PowerShell', 'one PreToolUse group for Bash and PowerShell');
ok(pre[0].hooks.map((h) => h.if).sort().join() === 'Bash(git *),PowerShell(git *)', 'one handler per `if` rule');
ok(pre[0].hooks.every((h) => h.timeout === 5 && !('onFailure' in h) && !('statusMessage' in h) && h.args[0] === '${CLAUDE_PLUGIN_ROOT}/enforce-hook.mjs'), 'timeout 5, no onFailure, no statusMessage');

// The snapshot's .gitignore takes neither dot file.
mkdirSync(join(home, '.claude', 'projects', 'x', 'memory'), { recursive: true });
const ig = gitignore();
ok(ig.split('\n').includes('*') && !ig.includes('enforce'), 'the snapshot ignores everything but an allow list of notes');

// 1.4.1 L: a rule after a description over 2 KB is read
{ const q = project(); writeFileSync(join(q.store, 'stage.md'), note('Stage files by name', ADD).replace('Never run git add -A.', 'x'.repeat(5000)));
  ok(ruleSet(q.payload('git add -A')).rules.length === 1, 'a rule after a long description is cached'); }

console.log(`enforce-hook: ${checks} checks passed`);
