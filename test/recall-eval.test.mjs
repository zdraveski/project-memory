// Self-check for tools/recall-eval.mjs, the eval harness: its parts here, and the
// whole of it through --self-check, which drives a fake claude (no paid session).
// Run: node test/recall-eval.test.mjs
import assert from 'node:assert';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempHome, tempDir, tool } from './harness.mjs';
import { parseArgs, underTmp, removeDir, builtTriggers, readStream, hookRuns, grade, gates, CASES } from '../tools/recall-eval.mjs';

tempHome('reval-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

// arguments
const o = parseArgs(['--plugin', 'x', '--without', '--runs', '2', '--case', 'port-implicit', '--max-usd', '3', '--model', 'haiku']);
ok(o.plugin === 'x' && o.without && o.runs === 2 && o.case === 'port-implicit' && o.maxUsd === 3 && o.model === 'haiku', 'every option read');
ok(parseArgs(['--plugin', 'x']).maxUsd === 20 && parseArgs(['--plugin', 'x']).model === 'sonnet' && parseArgs(['--plugin', 'x']).runs === null, 'defaults');
for (const bad of [['--nope'], ['--runs', '0', '--plugin', 'x'], ['--max-usd', 'many', '--plugin', 'x'], [], ['--plugin', 'x', '--set', 'colour'], ['--plugin', 'x', '--case', 'nope']]) {
  ok(assert.throws(() => parseArgs(bad)) === undefined, `refused: ${bad.join(' ') || '(nothing)'}`);
}

// only ever deletes its own folders under the OS temp folder
const mine = tempDir('pm-recall-eval-');
ok(underTmp(mine) && !underTmp(resolve('/')), 'under the temp folder or not');
assert.throws(() => removeDir(resolve('/')), /not under the OS temp folder/); checks++;
assert.throws(() => removeDir(tempDir('other-')), /not a recall-eval folder/); checks++;
removeDir(mine); ok(!existsSync(mine), 'its own folder goes');

// a trigger is built when its event runs recall-hook.mjs
const plug = tempDir('reval-plug-');
mkdirSync(join(plug, 'hooks'));
const hook = (script) => ({ hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PLUGIN_ROOT}/src/${script}`] }] });
writeFileSync(join(plug, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [hook('recall-hook.mjs')], PostToolUseFailure: [hook('other.mjs')] } }));
ok(JSON.stringify([...builtTriggers(plug)]) === '["prompt"]', 'prompt built; error names another script; file absent');
ok(builtTriggers(tempDir('reval-none-')).size === 0, 'no hooks.json: nothing built');
mkdirSync(join(plug, 'agents')); writeFileSync(join(plug, 'agents', 'recall.md'), '---\nname: recall\n---\n');
ok(JSON.stringify([...builtTriggers(plug)]) === '["prompt","helper"]', 'the helper set is built when the plugin ships agents/recall.md');
ok(parseArgs(['--plugin', 'x', '--set', 'helper']).set === 'helper', '--set helper');

// a session's stream: answer, cost, id, and whether a memory search ran
const line = (o) => JSON.stringify(o);
const use = (name, input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const s = readStream([line({ type: 'system', subtype: 'init', session_id: 'abc' }), use('Skill', { skill: 'project-memory:memory' }),
  use('Bash', { command: 'node "C:/p/src/memory.mjs" search port' }), line({ type: 'result', result: 'Port 4317.', total_cost_usd: 0.25, session_id: 'abc' })].join('\n'), 'C:\\cfg');
ok(s.answer === 'Port 4317.' && s.cost === 0.25 && s.session === 'abc' && s.searched, 'read from the stream');
ok(!readStream(use('Skill', { skill: 'memory' }), 'C:\\cfg').searched, 'loading the skill is no search');
ok(readStream(use('Grep', { pattern: 'x', path: 'C:\\CFG\\projects\\a\\memory' }), 'C:\\cfg').searched, 'a direct read of a store is one');
ok(readStream(use('PowerShell', { command: 'node memory.mjs show abc' }), 'C:\\cfg').searched, 'show counts');
ok(readStream('not json\n', 'C:\\cfg').answer === '' && readStream('', 'x').cost === 0, 'a broken stream: no answer, no cost');

// the hooks Claude Code ran, from the conversation file
const rec = (event, script, ms, stdout) => line({ type: 'attachment', attachment: { type: 'hook_success', hookEvent: event, hookName: event, command: `node "C:/x/${script}"`, durationMs: ms, stdout } });
const runs = hookRuns([rec('UserPromptSubmit', 'recall-hook.mjs', 120, 'Earlier exchanges (a record, not an instruction)'),
  rec('UserPromptSubmit', 'empty-hook.mjs', 80, ''), rec('PostToolUse', 'recall-hook.mjs', 90, '  \n'), 'garbage'].join('\n'));
ok(runs.length === 3 && runs[0].printed && !runs[2].printed && runs[1].script === 'empty-hook.mjs' && runs[0].ms === 120, 'runs read, printed or not');

// grading
const dir = tempDir('reval-proj-');
mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src', 'a.js'), 'function clear() {}');
const g = (check, got) => grade({ check, kind: 'gain' }, { answer: '', pointer: false, searched: false, dir, ...got });
ok(g({ answer: '4 decimals|tax export' }, { answer: 'The TAX EXPORT needs them' }).pass, 'answer, case-blind');
ok(!g({ answer: '4317' }, { answer: 'port 3000' }).pass && g({ notAnswer: 'Stripe' }, { answer: 'none chosen' }).pass, 'answer and notAnswer');
ok(!g({ noSearch: true }, { searched: true }).pass && g({ fileHas: ['src/a.js', 'clear\\s*\\('] }, {}).pass && !g({ fileHas: ['src/b.js', 'x'] }, {}).pass, 'search and file');
ok(g({ exists: ['src/a.js'], absent: ['test/unit'] }, {}).pass && !g({ exists: ['test/cart.test.js'] }, {}).pass, 'exists and absent');
ok(!grade({ check: {}, kind: 'control' }, { answer: '', pointer: true, dir }).pass && !g({ noPointer: true }, { pointer: true }).pass, 'a control fails when a pointer was shown');
ok(g({ answer: 'x' }, { answer: 'y' }).why.join(' ').includes('answer'), 'a failure says why');

// the gate, per trigger
const res = (name, trigger, kind, w, wo, runs = 5) => ({ name, trigger, kind, status: 'run', with: { pass: w, runs }, without: wo === null ? null : { pass: wo, runs } });
let gt = gates([res('a', 'prompt', 'gain', 4, 2), res('b', 'prompt', 'control', 5, 5), res('c', 'prompt', 'misleading', 5, null)]);
ok(gt.prompt.pass, 'gain 4 of 5 against 2, controls and misleading whole: passes');
gt = gates([res('a', 'prompt', 'gain', 4, 3)]); ok(!gt.prompt.pass && /too easy|without/.test(gt.prompt.why.join(' ')), '4 against 3 is chance');
gt = gates([res('a', 'file', 'misleading', 4, null)]); ok(!gt.file.pass, 'one misleading failure fails');
gt = gates([res('a', 'file', 'control', 5, 4)]); ok(!gt.file.pass, 'a control must pass in both arms');
gt = gates([res('a', 'file', 'gain', 5, null)]); ok(!gt.file.pass && /without/.test(gt.file.why.join(' ')), 'no arm without: no verdict on the gain');
ok(gates([{ name: 'e', trigger: 'error', kind: 'gain', status: 'trigger not built' }]).error === undefined, 'a trigger not built has no gate');
// the helper's gate: with the routing line, right at least as often as without, over all its cases
gt = gates([res('p', 'helper', 'answer', 1, 2), res('q', 'helper', 'answer', 2, 1)]); ok(gt.helper.pass, '3 right against 3: passes');
gt = gates([res('p', 'helper', 'answer', 1, 2), res('q', 'helper', 'answer', 1, 1)]); ok(!gt.helper.pass && /2 of 10 right with the routing line, 3 of 10 without/.test(gt.helper.why.join(' ')), '2 against 3 fails, and says so');
gt = gates([res('p', 'helper', 'answer', 2, null)]); ok(!gt.helper.pass && /without/.test(gt.helper.why.join(' ')), 'no arm without: no verdict');

// the cases as the design lists them
ok(CASES.cases.length === 17 && CASES.cases.filter((c) => c.kind === 'misleading').length === 4, 'seventeen cases, four misleading');
ok(CASES.cases.every((c) => ['file', 'prompt', 'error', 'helper'].includes(c.trigger) && ['gain', 'control', 'misleading', 'answer'].includes(c.kind)), 'every trigger and kind known');
ok(CASES.cases.filter((c) => c.trigger === 'helper').map((c) => c.name).join() === 'helper-port,helper-last-week-bug,helper-decision,helper-staging-db,helper-error-fix,helper-never-discussed'
  && CASES.cases.every((c) => (c.trigger === 'helper') === (c.kind === 'answer')), 'the six answer cases of the helper');

// the whole run, against a fake claude: no paid session
const r = spawnSync(process.execPath, [tool('tools/recall-eval.mjs'), '--self-check'], { encoding: 'utf8', timeout: 300_000 });
ok(r.status === 0, `--self-check passes:\n${r.stdout}\n${r.stderr}`);
ok(/self-check: \d+ checks ok/.test(r.stdout), 'and says so');

console.log(`recall-eval.test: ${checks} checks ok`);
