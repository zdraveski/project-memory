// Self-check for wire.mjs: switching settings.json between running the hooks
// itself and leaving them to the plugin touches no other hook and no other key.
// Run: node wire.test.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';
import { tool, tempHome } from './harness.mjs';
import { unwire, rewire } from './wire.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const h = (command) => ({ type: 'command', command });
const live = 'C:/Users/u/.claude/hooks-live';
const settings = {
  env: { X: '1' }, statusLine: { type: 'command', command: 'node s.js' }, enabledPlugins: { 'a@b': true },
  hooks: {
    PreCompact: [{ matcher: 'manual', hooks: [h(`node "${live}/memory-tier.mjs" --stop`)] }, { matcher: 'auto', hooks: [h(`node "${live}/compact-gate.mjs"`)] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [h('rtk hook claude')] }],
    SessionStart: [{ hooks: [h('node heal.mjs')] }, { matcher: 'startup|compact', hooks: [h(`node "${live}/handoff-log.mjs" --print`), h('node other.mjs')] }],
    Stop: [{ hooks: [h(`node "${live}/memory-tier.mjs" --stop`)] }],
  },
};
const commands = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => e.hooks).map((x) => [x.command, ...(x.args || [])].join(' '));
const ourCount = (s) => commands(s).filter((c) => /memory-tier|handoff-log|compact-gate/.test(c)).length;

const u = unwire(settings);
ok(ourCount(u) === 0, 'unwire drops every memory hook');
ok(['rtk hook claude', 'node heal.mjs', 'node other.mjs'].every((c) => commands(u).includes(c)), 'and keeps every other hook, one sharing an entry with ours too');
ok(!u.hooks.Stop && !u.hooks.PreCompact, 'an event left with no handler is dropped, not left empty');
ok(u.env.X === '1' && u.statusLine.command === 'node s.js' && u.enabledPlugins['a@b'], 'and every other key is as it was');
ok(JSON.stringify(settings.hooks.Stop) !== JSON.stringify(u.hooks.Stop), 'the input is not changed in place');
const r = rewire(u, live, 'C:\\Program Files\\nodejs\\node.exe');
ok(ourCount(r) === 4 && r.hooks.SessionStart.some((e) => e.matcher === 'startup|clear|compact'), 'rewire puts the four entries back, /clear included');
ok(commands(r).every((c) => !c.includes('\\')) && r.hooks.Stop.some((e) => e.hooks.some((x) => x.command === 'C:/Program Files/nodejs/node.exe' && x.args[0].endsWith('/memory-tier.mjs') && x.args[1] === '--stop')),
  'in exec form: node and the live copy as forward-slash paths, no shell between');
ok(ourCount(rewire(r, live)) === 4, 'rewiring twice does not double them');
// Both wirings come from hooks/hooks.json: what it has to say, pinned here.
const wiring = (s) => Object.entries(s.hooks).flatMap(([ev, es]) => es.flatMap((e) => e.hooks.filter((x) => /(memory-tier|handoff-log|compact-gate)\.mjs$/.test(x.args?.[0] || ''))
  .map((x) => `${ev} | ${e.matcher || ''} | ${[x.args[0].split('/').pop(), ...x.args.slice(1)].join(' ')}`))).sort();
ok(JSON.stringify(wiring(rewire({}, live))) === JSON.stringify(['PreCompact | auto | compact-gate.mjs', 'PreCompact | manual | memory-tier.mjs --stop',
  'SessionStart | startup|clear|compact | handoff-log.mjs --print', 'Stop |  | memory-tier.mjs --stop']), `the plugin wires the four hooks, each with its flag (${wiring(rewire({}, live)).join('; ')})`);
ok(commands(r).includes('rtk hook claude') && commands(r).includes('node heal.mjs'), 'and the other hooks survive the round trip');

// --dry-run says what it would do and touches nothing.
const { home, env } = tempHome('wire-');
mkdirSync(join(home, '.claude', 'hooks-live', '.claude-plugin'), { recursive: true });
writeFileSync(join(home, '.claude', 'hooks-live', '.claude-plugin', 'plugin.json'), '{}');
// The live copy's hooks.json, marked: settings.json gets what the check passed, not this checkout's.
const liveHooks = JSON.parse(readFileSync(tool('hooks/hooks.json'), 'utf8'));
liveHooks.hooks.Stop[0].hooks[0].args.push('--deployed');
mkdirSync(join(home, '.claude', 'hooks-live', 'hooks'), { recursive: true });
writeFileSync(join(home, '.claude', 'hooks-live', 'hooks', 'hooks.json'), JSON.stringify(liveHooks));
const path = join(home, '.claude', 'settings.json');
writeFileSync(path, JSON.stringify(settings));
const run = spawnSync(process.execPath, [tool('wire.mjs'), '--plugin', '--dry-run'], { env, encoding: 'utf8' });
ok(run.status === 0 && /settings\.json runs now:\n  PreCompact \(manual\)/.test(run.stdout) && readFileSync(path, 'utf8') === JSON.stringify(settings), '--dry-run lists the change and writes nothing');
ok(spawnSync(process.execPath, [tool('wire.mjs')], { env, encoding: 'utf8' }).status === 1, 'no mode is a usage error');
const toSettings = spawnSync(process.execPath, [tool('wire.mjs'), '--settings', '--dry-run'], { env, encoding: 'utf8' });
ok(toSettings.status === 0 && /it would run:[^]*memory-tier\.mjs --stop --deployed/.test(toSettings.stdout), `--settings takes the live copy's entries, not this checkout's (got ${toSettings.stdout.split('it would run:')[1]?.trim().split('\n')[1]})`);
// The plugin's state decides, and wire installs nothing: it says which claude
// plugin command to run first. Entries dropped before the plugin is enabled
// leave no hook running; entries put back while it is, every hook twice.
const wire = (mode) => spawnSync(process.execPath, [tool('wire.mjs'), mode], { env, encoding: 'utf8' });
const before = JSON.stringify(settings);
writeFileSync(path, before);
let w = wire('--plugin');
ok(w.status === 1 && /not enabled yet[^]*claude plugin install project-memory@project-memory/.test(w.stderr) && readFileSync(path, 'utf8') === before,
  `--plugin refuses until the plugin is enabled, says how to install it, and changes nothing (got ${w.stderr.trim()})`);
const pluginOn = { ...settings, enabledPlugins: { ...settings.enabledPlugins, 'project-memory@project-memory': true } };
writeFileSync(path, JSON.stringify(pluginOn));
w = wire('--settings');
ok(w.status === 1 && /still enabled[^]*claude plugin uninstall project-memory@project-memory/.test(w.stderr) && readFileSync(path, 'utf8') === JSON.stringify(pluginOn),
  '--settings refuses while the plugin is still enabled, says how to uninstall it, and changes nothing');
w = wire('--plugin');
const plugged = JSON.parse(readFileSync(path, 'utf8'));
ok(w.status === 0 && ourCount(plugged) === 0 && commands(plugged).includes('rtk hook claude') && plugged.enabledPlugins['project-memory@project-memory'] && plugged.env.X === '1',
  `with the plugin enabled, --plugin drops these hooks' entries and keeps every other hook and key (got ${w.stderr.trim()})`);
writeFileSync(path, JSON.stringify(u));
w = wire('--settings');
const wired = JSON.parse(readFileSync(path, 'utf8'));
ok(w.status === 0 && ourCount(wired) === 4 && commands(wired).some((c) => c.endsWith('--deployed')), "with the plugin gone, --settings puts the live copy's four entries back");

console.log(`wire: ${checks} checks passed`);
