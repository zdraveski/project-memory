// The release archive, as a user gets it: git archive HEAD unpacked in a folder of its own, every hooks.json command run from
// there with ${CLAUDE_PLUGIN_ROOT} filled in, and every path the skill and the commands name present. A moved or ignored
// runtime file fails here, on any OS, before a user's hook does. Runs the committed tree (HEAD), not the working copy.
// Run: node archive.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import assert from 'node:assert';
import { ROOT, tempHome, tempDir, storeFor } from './harness.mjs';

const { home } = tempHome('archive-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const plugin = tempDir('archive-plugin-'), tarDir = tempDir('archive-tar-'), tarball = join(tarDir, 'plugin.tar');
execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tarball, 'HEAD']);
// relative paths and a cwd: GNU tar (Git Bash) reads `C:...` as a host name or an escape
execFileSync('tar', ['-xf', relative(plugin, tarball).replaceAll('\\', '/')], { cwd: plugin });
const at = (p) => p.replaceAll('${CLAUDE_PLUGIN_ROOT}', plugin.replaceAll('\\', '/'));

const cwd = join(home, 'proj'), store = storeFor(home, cwd), projects = join(home, '.claude', 'projects');
mkdirSync(store, { recursive: true });
const tp = join(projects, 'proj-sess.jsonl');
writeFileSync(tp, [{ type: 'user', timestamp: '2026-11-01T09:00:00Z', message: { content: 'feed the tapir' } },
  { type: 'assistant', timestamp: '2026-11-01T09:00:30Z', message: { content: [{ type: 'text', text: 'fed it' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
writeFileSync(join(store, 'MEMORY.md'), '# Memory\n');
const base = { session_id: 'abcd1234-aaaa', cwd, transcript_path: tp };

const hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks;
let ran = 0;
for (const [event, groups] of Object.entries(hooks)) for (const g of groups) for (const h of g.hooks) {
  const payload = { ...base, hook_event_name: event, last_assistant_message: 'fed it', source: 'startup', trigger: g.matcher,
    ...(event === 'PreToolUse' ? { tool_name: 'Bash', tool_input: { command: 'git status' } } : {}) };
  const args = (h.args ?? []).map(at);
  ok(args.every((a) => !a.includes('${') && (!a.endsWith('.mjs') || existsSync(a))), `${event}: the script ${args[0]} is in the archive`);
  const r = spawnSync(h.command === 'node' ? process.execPath : h.command, args, { input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000 });
  ok(r.status === 0, `${event} ${g.matcher ?? ''} ${args.join(' ')} exits 0 (got ${r.status}: ${r.stderr.trim().split('\n')[0]})`);
  ran++;
}
const listed = Object.values(hooks).flat().reduce((n, g) => n + g.hooks.length, 0);
ok(ran > 0 && ran === listed, `every hook command in hooks.json ran (${ran} of ${listed})`);
ok(existsSync(join(projects, '.stop-ran')), 'a Stop from the archive saved: the proof-of-life file is there');
ok(readdirSync(join(home, '.claude'), { recursive: true }).some((f) => /\.timing$/.test(f)), 'and the hooks timed themselves');

// The skill and the commands run memory.mjs: its path must be in the archive too.
for (const f of ['skills/memory/SKILL.md', 'commands/incognito.md', 'commands/memory-off.md', 'commands/memory-on.md']) {
  const named = [...readFileSync(join(plugin, f), 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.\w+)/g)].map((m) => m[1]);
  ok(named.length > 0 && named.every((p) => existsSync(join(plugin, p))), `${f} names ${named.join(', ')}: in the archive`);
}
console.log(`archive: ${checks} checks passed`);
