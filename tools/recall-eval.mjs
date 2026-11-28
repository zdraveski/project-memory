#!/usr/bin/env node
// The eval harness of 1.6.0 (design, section "The gate"): does a pointer that arrives by itself
// make Claude's answers better, and does it mislead? Headless `claude -p` sessions in throwaway
// projects whose journals hold made-up facts (tools/recall-eval-cases.json), each case with the
// pointers (PROJECT_MEMORY_RECALL=1) and, with --without, with PROJECT_MEMORY_RECALL=0. A developer tool like bench.mjs:
// it spends plan usage, so it never runs in CI; CI runs --self-check, which drives a fake claude.
//
//   node tools/recall-eval.mjs --plugin <dir> [--set file|prompt|error] [--without] [--runs N]
//        [--case <name>] [--model sonnet] [--max-usd 20] [--json <path>]
//   node tools/recall-eval.mjs --self-check
//
// Login: a fresh CLAUDE_CONFIG_DIR has none, and the real ~/.claude is never copied or read.
// Make a long-lived token once with `claude setup-token`, save it in a file only you can read,
// and name that file in PROJECT_MEMORY_EVAL_TOKEN_FILE. Each session gets it as
// CLAUDE_CODE_OAUTH_TOKEN (ANTHROPIC_API_KEY is dropped, so it is the login used). Never printed.
// PROJECT_MEMORY_EVAL_CLAUDE names another claude binary (a .mjs runs with node): the self-check's fake.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync, rmSync, statSync, realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert';
import { storeOf, withLock, local } from '../src/store.mjs';
import { record } from '../src/journal.mjs';
import { pct } from '../src/timing.mjs';
import { scriptOf } from './live-times.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const CASES = JSON.parse(readFileSync(join(repo, 'tools', 'recall-eval-cases.json'), 'utf8'));
export const PREFIX = 'pm-recall-eval-';
const EVENT = { file: 'PostToolUse', prompt: 'UserPromptSubmit', error: 'PostToolUseFailure' };
// The helper's set (headline 6) has no hook: it is built when the plugin ships the agent, and its arm without drops the routing line.
const HELPER = 'helper', SETS = [...Object.keys(EVENT), HELPER];
const RECALL_HOOK = 'recall-hook.mjs', EMPTY_HOOK = 'empty-hook.mjs';
const AT_ONCE = 4, SESSION_MS = 10 * 60_000, HOOK_SLACK_MS = 100, DAY = 86_400_000;
const USAGE = 'usage: node tools/recall-eval.mjs --plugin <dir> [--set file|prompt|error] [--without] [--runs N] [--case <name>] [--model sonnet] [--max-usd 20] [--json <path>]\n       node tools/recall-eval.mjs --self-check';

export function parseArgs(argv) {
  const o = { plugin: null, set: null, without: false, runs: null, case: null, model: 'sonnet', maxUsd: 20, json: null, selfCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--plugin') o.plugin = v();
    else if (a === '--set') o.set = v();
    else if (a === '--without') o.without = true;
    else if (a === '--runs') o.runs = Number(v());
    else if (a === '--case') o.case = v();
    else if (a === '--model') o.model = v();
    else if (a === '--max-usd') o.maxUsd = Number(v());
    else if (a === '--json') o.json = v();
    else if (a === '--self-check') o.selfCheck = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (o.selfCheck) return o;
  if (!o.plugin) throw new Error('--plugin <dir> is needed');
  if (o.runs !== null && !(Number.isInteger(o.runs) && o.runs > 0)) throw new Error('--runs takes a whole number above 0');
  if (!(o.maxUsd > 0)) throw new Error('--max-usd takes an amount above 0');
  if (o.set && !SETS.includes(o.set)) throw new Error(`--set is one of ${SETS.join(', ')}`);
  if (o.case && !CASES.cases.some((c) => c.name === o.case)) throw new Error(`no case ${o.case}`);
  return o;
}

// The clean-up can never reach a real store: it deletes only its own folders, under the OS temp folder.
const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
export const underTmp = (p) => { const t = real(tmpdir()), r = real(p); return dirname(t) !== t && fold(r).startsWith(fold(t) + sep); };
export function removeDir(p) {
  if (!underTmp(p)) throw new Error(`refused to delete ${p}: not under the OS temp folder`);
  if (!basename(real(p)).startsWith(PREFIX)) throw new Error(`refused to delete ${p}: not a recall-eval folder`);
  rmSync(p, { recursive: true, force: true, maxRetries: 5 });
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// What a killed run left: a folder of ours whose run is gone (one just made has 60 s to write its pid).
export function sweep() {
  for (const n of readdirSync(tmpdir()).filter((f) => f.startsWith(PREFIX))) {
    const d = join(tmpdir(), n);
    let pid = NaN; try { pid = Number(readFileSync(join(d, 'pid'), 'utf8')); } catch {}
    try {
      if (Number.isInteger(pid) && pid > 0 ? alive(pid) : Date.now() - statSync(d).mtimeMs < 60_000) continue;
      removeDir(d);
    } catch { /* held open, or gone already: the next run tries again */ }
  }
}
// A folder of this run, its pid inside so no other run sweeps it.
const ownDir = (tag = '') => { const d = real(mkdtempSync(join(tmpdir(), PREFIX + tag))); writeFileSync(join(d, 'pid'), String(process.pid)); return d; };

// The triggers whose hook the plugin has: its event runs recall-hook.mjs. The helper's, when it ships agents/recall.md.
export function builtTriggers(plugin) {
  let hooks = {}; try { hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks ?? {}; } catch {}
  const built = new Set(Object.keys(EVENT).filter((t) => JSON.stringify(hooks[EVENT[t]] ?? []).includes(RECALL_HOOK)));
  return existsSync(join(plugin, 'agents', 'recall.md')) ? built.add(HELPER) : built;
}

// A memory search, for the grader: the CLI's search or show, or any tool reaching into the stores. Loading the skill is none.
const isSearch = (name, input, cfg) => (/^(Bash|PowerShell)$/.test(name) && /memory\.mjs["']?\s+(?:search|show)\b/.test(String(input?.command ?? '')))
  || JSON.stringify(input ?? {}).replace(/\\\\/g, '/').toLowerCase().includes(`${cfg.replace(/\\/g, '/').toLowerCase()}/projects`);
// The session's stream-json: its final answer, cost, id, and whether a memory search ran.
export function readStream(text, cfg) {
  const s = { answer: '', cost: 0, session: null, searched: false };
  for (const line of String(text).split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r || typeof r !== 'object') continue;
    if (typeof r.session_id === 'string') s.session = r.session_id;
    if (r.type === 'assistant') for (const b of r.message?.content ?? []) if (b?.type === 'tool_use' && isSearch(b.name, b.input, cfg)) s.searched = true;
    if (r.type === 'result') { s.answer = String(r.result ?? ''); s.cost = Number(r.total_cost_usd) || 0; }
  }
  return s;
}
// Every hook run Claude Code saved in the conversation file: event, script, ms, and whether it printed anything.
// shortcut: a hook is known by its command's script; a statusMessage replaces the command in the record, so
// recall-hook.mjs must have none (or live-times.mjs's STATUS must learn it). Upgrade when step 4 gives it one.
export function hookRuns(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.includes('durationMs')) continue;
    let a; try { a = JSON.parse(line).attachment; } catch { continue; }
    if (a && typeof a.durationMs === 'number' && String(a.type).startsWith('hook_')) {
      out.push({ event: a.hookEvent, script: scriptOf(a.command), ms: a.durationMs, printed: String(a.stdout ?? '').trim() !== '' });
    }
  }
  return out;
}

// One session against its case's checks. A control fails whenever a pointer was shown: memory had nothing to say.
export function grade(c, { answer = '', pointer = false, searched = false, dir }) {
  const k = c.check ?? {}, why = [], re = (p) => new RegExp(p, 'i');
  if (k.answer && !re(k.answer).test(answer)) why.push(`the answer does not match /${k.answer}/`);
  if (k.notAnswer && re(k.notAnswer).test(answer)) why.push(`the answer matches /${k.notAnswer}/`);
  if ((k.noPointer || c.kind === 'control') && pointer) why.push('a pointer was shown');
  if (k.noSearch && searched) why.push('a memory search ran');
  if (k.fileHas) {
    let t = null; try { t = readFileSync(join(dir, k.fileHas[0]), 'utf8'); } catch {}
    if (t === null || !re(k.fileHas[1]).test(t)) why.push(`${k.fileHas[0]} does not match /${k.fileHas[1]}/`);
  }
  for (const f of k.exists ?? []) if (!existsSync(join(dir, f))) why.push(`${f} is gone`);
  for (const f of k.absent ?? []) if (existsSync(join(dir, f))) why.push(`${f} exists`);
  return { pass: !why.length, why };
}

// The eval part of a trigger's gate, scaled to the runs: a gain passes in 4 of 5 with pointers and at most 2 of 5
// without; a misleading case and a control pass every time, a control in both arms. The helper's answer cases, summed: right with
// the routing line at least as often as without it.
export function gates(results) {
  const out = {}, right = { with: 0, without: 0, runs: 0, runsWithout: 0 };
  for (const r of results.filter((x) => x.status === 'run')) {
    const g = (out[r.trigger] ??= { pass: true, why: [] }), n = r.with?.runs ?? 0, fail = (why) => { g.pass = false; g.why.push(`${r.name}: ${why}`); };
    if (!n) { fail('not run'); continue; }
    if (r.kind === 'gain') {
      if (r.with.pass < Math.ceil(0.8 * n)) fail(`${r.with.pass} of ${n} with pointers, needs ${Math.ceil(0.8 * n)}`);
      if (!r.without?.runs) fail('no arm without pointers (--without)');
      else if (r.without.pass > Math.floor(0.4 * r.without.runs)) fail(`${r.without.pass} of ${r.without.runs} without pointers: too easy, rewrite it once`);
    } else if (r.kind === 'answer') {
      if (!r.without?.runs) fail('no arm without the routing line (--without)');
      else Object.assign(right, { with: right.with + r.with.pass, without: right.without + r.without.pass, runs: right.runs + n, runsWithout: right.runsWithout + r.without.runs });
    } else if (r.with.pass < n) fail(`${r.with.pass} of ${n} with pointers, needs all`);
    if (r.kind === 'control') {
      if (!r.without?.runs) fail('no arm without pointers (--without)');
      else if (r.without.pass < r.without.runs) fail(`${r.without.pass} of ${r.without.runs} without pointers, needs all`);
    }
  }
  if (out[HELPER] && right.with < right.without) {
    out[HELPER].pass = false;
    out[HELPER].why.push(`${right.with} of ${right.runs} right with the routing line, ${right.without} of ${right.runsWithout} without`);
  }
  return out;
}

// The store a session in `dir` uses, seeded through the journal's own writer: 60 made-up entries of
// other work, then the case's own, each from another conversation, so they are "earlier".
function seed(dir, c) {
  const store = storeOf({ cwd: dir }), at = (days, i = 0) => local(Date.now() - days * DAY + i * 60_000);
  mkdirSync(store, { recursive: true });
  const turn = (id, when, s) => ({ id, at: when, ask: s.ask, said: s.said, changed: s.changed ?? [], ran: s.ran ?? [], cwd: dir });
  const filler = Array.from({ length: 60 }, (_, i) => {
    const topic = CASES.filler[i % CASES.filler.length];
    return turn(`eval-filler-${i}`, at(1 + i, i), { ask: `${topic}, part ${1 + Math.floor(i / CASES.filler.length)}`, said: `Done: ${topic}.` });
  });
  const conv = () => join(dirname(store), `${randomUUID()}.jsonl`);
  withLock(store, () => record(store, conv(), filler));
  (c.seed ?? []).forEach((s, i) => withLock(store, () => record(store, conv(), [turn(`eval-${c.name}-${i}`, at(s.daysAgo), s)])));
  return store;
}
// The seed as `search` finds it: the case's own entry, or for a case with none, the filler.
export function checkSeed(store, c) {
  const r = spawnSync(process.execPath, [join(repo, 'src', 'memory.mjs'), 'search', c.find ?? CASES.project, '--store', store], { encoding: 'utf8' });
  return (r.stdout ?? '').includes(c.seed?.length ? `key: eval-${c.name}-0` : 'key: eval-filler-');
}
function project(dir) {
  for (const [f, text] of Object.entries(CASES.files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); }
}

const claudeCommand = () => { const c = process.env.PROJECT_MEMORY_EVAL_CLAUDE || 'claude'; return /\.[cm]?js$/.test(c) ? [process.execPath, [c]] : [c, []]; };
const median = (xs) => (xs.length ? pct([...xs].sort((a, b) => a - b), 0.5) : null);
const findConversation = (cfg, id) => { try { return readdirSync(join(cfg, 'projects')).map((d) => join(cfg, 'projects', d, `${id}.jsonl`)).find(existsSync) ?? null; } catch { return null; } };

export async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`recall-eval: ${e.message}\n${USAGE}`); return 1; }
  if (o.selfCheck) return selfCheck();
  const plugin = resolve(o.plugin);
  if (!existsSync(join(plugin, 'hooks', 'hooks.json'))) { console.error(`recall-eval: ${plugin} holds no hooks/hooks.json`); return 1; }
  const built = builtTriggers(plugin), runs = o.runs ?? 5;
  const results = CASES.cases.filter((c) => (!o.set || c.trigger === o.set) && (!o.case || c.name === o.case))
    .map((c) => ({ name: c.name, trigger: c.trigger, kind: c.kind, status: built.has(c.trigger) ? 'run' : 'trigger not built', c }));
  const jobs = results.filter((r) => r.status === 'run').flatMap((r) => ['with', ...(o.without && r.kind !== 'misleading' ? ['without'] : [])]
    .flatMap((arm) => { r[arm] = { runs: 0, pass: 0, searched: 0, pointer: 0, costs: [], why: [] }; return Array.from({ length: runs }, () => ({ r, arm })); }));
  let token = '';
  if (jobs.length) {
    try { token = process.env.PROJECT_MEMORY_EVAL_TOKEN_FILE ? readFileSync(process.env.PROJECT_MEMORY_EVAL_TOKEN_FILE, 'utf8').trim() : ''; } catch {}
    if (!token) {
      console.error('recall-eval: no login, so no session was started. Make a long-lived token with `claude setup-token`, save it in a file\n'
        + 'only you can read, and name that file in PROJECT_MEMORY_EVAL_TOKEN_FILE. Your own ~/.claude login is never copied.');
      return 1;
    }
  }
  sweep();
  const root = ownDir(), cfg = join(root, 'config'), children = new Set();
  const bye = () => { try { removeDir(root); } catch {} };
  const onInt = () => { for (const ch of children) ch.kill(); bye(); process.exit(130); };
  process.once('exit', bye); process.once('SIGINT', onInt);
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  let spent = 0, notRun = 0, errors = 0;
  const times = {};
  try {
    if (!underTmp(root) || !underTmp(cfg)) throw new Error(`refused: ${root} is not under the OS temp folder`);
    mkdirSync(cfg);
    // An empty Node hook on the trigger events: Claude Code times it beside the plugin's (section "Budgets").
    const empty = join(root, EMPTY_HOOK).replace(/\\/g, '/'), settings = join(root, 'settings.json');
    writeFileSync(empty, '');
    writeFileSync(settings, JSON.stringify({
      enabledPlugins: { 'project-memory@project-memory': false },
      permissions: { allow: ['Skill', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(node *)', 'PowerShell(node *)'] },
      hooks: Object.fromEntries(Object.values(EVENT).map((ev) => [ev, [{ hooks: [{ type: 'command', command: `node "${empty}"`, timeout: 5 }] }]])),
    }, null, 2));
    jobs.forEach((j, i) => { mkdirSync(j.dir = join(root, `s${i}`, CASES.project), { recursive: true }); j.dir = real(j.dir); project(j.dir); j.store = seed(j.dir, j.r.c); });
    for (const r of results.filter((x) => x.status === 'run')) {
      if (!checkSeed(jobs.find((j) => j.r === r).store, r.c)) throw new Error(`search does not find the seed of ${r.name}: no session was started`);
    }
    const session = (j) => new Promise((done) => {
      const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_OAUTH_TOKEN: token };
      for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_PROJECT_DIR_NAME', 'CLAUDE_PROJECT_DIR', 'PROJECT_MEMORY_RECALL']) delete env[k];
      env.PROJECT_MEMORY_RECALL = j.arm === 'without' ? '0' : '1';
      const [cmd, pre] = claudeCommand();
      const ch = spawn(cmd, [...pre, '-p', j.r.c.prompt, '--output-format', 'stream-json', '--verbose', '--model', o.model, '--plugin-dir', plugin,
        '--settings', settings, '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--max-budget-usd', String(Math.max(0.01, o.maxUsd - spent))],
      { cwd: j.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      children.add(ch);
      let out = '', err = '';
      ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
      const timer = setTimeout(() => ch.kill(), SESSION_MS);
      ch.on('error', (e) => { err += e.message; });
      ch.on('close', (code) => { clearTimeout(timer); children.delete(ch); done({ code, out, err }); });
    });
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        if (spent >= o.maxUsd) { notRun++; continue; }
        const { code, out, err } = await session(j), s = readStream(out, cfg);
        spent += s.cost;
        const conv = s.session && findConversation(cfg, s.session), hooks = conv ? hookRuns(readFileSync(conv, 'utf8')) : [];
        const pointer = hooks.some((h) => h.script === RECALL_HOOK && h.printed);
        const failed = !s.answer && (err.trim().split('\n').pop() || `claude ended with ${code}`);
        if (failed) errors++;
        const g = failed ? { pass: false, why: [failed] } : grade(j.r.c, { answer: s.answer, pointer, searched: s.searched, dir: j.dir });
        const a = j.r[j.arm];
        a.runs++; a.pass += g.pass; a.searched += s.searched; a.pointer += pointer; a.costs.push(s.cost);
        if (!g.pass && a.why.length < 3) a.why.push(g.why.join('; '));
        if (j.arm === 'with') for (const h of hooks) if (!h.printed && [RECALL_HOOK, EMPTY_HOOK].includes(h.script)) ((times[h.event] ??= {})[h.script] ??= []).push(h.ms);
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
  } catch (e) {
    console.error(`recall-eval: ${e.message}`);
    return 1;
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was;
    process.removeListener('SIGINT', onInt); process.removeListener('exit', bye);
    bye();
  }
  // The plugin's own share of hook time: its quiet runs beside the empty hook's, in the same sessions.
  const hookTimes = Object.values(EVENT).filter((ev) => times[ev]).map((ev) => {
    const plugin = median(times[ev][RECALL_HOOK] ?? []), empty = median(times[ev][EMPTY_HOOK] ?? []);
    const extra = plugin === null || empty === null ? null : plugin - empty;
    return { event: ev, plugin, empty, extra, pass: extra !== null && extra <= HOOK_SLACK_MS };
  });
  const report = {
    date: local(), model: o.model, runsPerCase: runs, spentUsd: Math.round(spent * 100) / 100, notRun, errors,
    cases: results.map(({ c, ...r }) => ({ ...r, ...Object.fromEntries(['with', 'without'].filter((a) => r[a]).map((a) => {
      const { costs, ...rest } = r[a]; return [a, { ...rest, medianCostUsd: median(costs) }];
    })) })),
    gates: gates(results), hookTimes,
  };
  const arm = (a) => (a ? `${a.pass}/${a.runs}` : '-'), pair = (r, k) => `${r.with?.[k] ?? '-'}/${r.without?.[k] ?? '-'}`;
  console.log(`${'case'.padEnd(16)} ${'trigger'.padEnd(7)} ${'kind'.padEnd(10)} with  without  searched  pointer  median USD`);
  for (const r of report.cases) {
    if (r.status !== 'run') { console.log(`${r.name.padEnd(16)} ${r.trigger.padEnd(7)} ${r.kind.padEnd(10)} ${r.status}`); continue; }
    console.log(`${r.name.padEnd(16)} ${r.trigger.padEnd(7)} ${r.kind.padEnd(10)} ${arm(r.with).padEnd(5)} ${arm(r.without).padEnd(8)} ${pair(r, 'searched').padEnd(9)} ${pair(r, 'pointer').padEnd(8)} ${pair(r, 'medianCostUsd')}`);
    for (const a of ['with', 'without']) for (const w of r[a]?.why ?? []) console.log(`    ${a}: ${w}`);
  }
  for (const [t, g] of Object.entries(report.gates)) console.log(`eval gate, ${t} trigger: ${g.pass ? 'passes' : 'fails'}${g.why.map((w) => `\n    ${w}`).join('')}`);
  for (const h of hookTimes) console.log(`hook time, ${h.event}: plugin ${h.plugin ?? '?'} ms, empty hook ${h.empty ?? '?'} ms, ${h.pass ? 'within' : 'not within'} ${HOOK_SLACK_MS} ms`);
  console.log(`model ${o.model}, ${runs} runs a case, spent ${report.spentUsd} USD${notRun ? `, ${notRun} sessions not run: --max-usd ${o.maxUsd} reached` : ''}${errors ? `, ${errors} sessions failed` : ''}`);
  if (o.json) writeFileSync(o.json, JSON.stringify(report, null, 2) + '\n');
  return notRun ? 2 : errors ? 1 : 0;
}

// The whole harness against a fake claude: no paid session, no login, nothing left behind.
const FAKE = (storeUrl) => `import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { storeOf } from ${JSON.stringify(storeUrl)};
const args = process.argv.slice(2), env = process.env, has = (f) => args.includes(f), val = (f) => args[args.indexOf(f) + 1];
const wrong = [!env.CLAUDE_CONFIG_DIR?.includes(${JSON.stringify(PREFIX)}) && 'config dir', env.CLAUDE_CODE_OAUTH_TOKEN !== 'tok-SECRET-123' && 'token',
  env.ANTHROPIC_API_KEY !== undefined && 'api key', !has('--plugin-dir') && 'plugin', !existsSync(val('--settings') ?? '') && 'settings',
  val('--output-format') !== 'stream-json' && 'stream'].filter(Boolean);
if (wrong.length) { console.error('fake claude: wrong ' + wrong.join(', ')); process.exit(3); }
const prompt = val('-p'), store = storeOf({ cwd: process.cwd() }), sid = randomUUID();
let seeded = ''; try { seeded = readdirSync(join(store, 'journal')).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(store, 'journal', f), 'utf8')).join(''); } catch {}
const pointer = env.PROJECT_MEMORY_RECALL === '1' && /j:eval-(?!filler)/.test(seeded);
const edit = (f, from, to) => writeFileSync(f, readFileSync(f, 'utf8').replace(from, to));
const table = [
  [/port should/, () => (pointer ? 'Use port 4317.' : 'Use port 3000.')], [/PDF/, () => (pointer ? 'No: keep CSV only.' : 'Yes, keep it.')],
  [/rounded/, () => (pointer ? 'I kept 4 decimals: the tax export needs them.' : 'Done: rounded to 2.')],
  [/clear\\(\\)/, () => { edit('src/wishlist.js', 'module.exports = { add, list };', 'function clear() { items.length = 0; }\\nmodule.exports = { add, list, clear };'); return 'Added clear().'; }],
  [/reverses/, () => 'const reverse = (s) => [...s].reverse().join("");'], [/payment/, () => 'We have not chosen one yet.'],
  [/currency/, () => { edit('src/price.js', 'formatPrice(amount)', "formatPrice(amount, currency = 'EUR')"); return 'Added currency.'; }],
  [/typo/, () => { edit('src/cart.js', 'bokshop', 'bookshop'); return 'Fixed.'; }],
  [/database/, () => 'I do not know the database port.'], [/invoice/, () => "It writes yesterday's invoices to a CSV file."],
];
const answer = (table.find(([re]) => re.test(prompt)) ?? [null, () => 'No idea.'])[1]();
const hook = (event, script, ms, stdout) => JSON.stringify({ type: 'attachment', timestamp: new Date().toISOString(), attachment: { type: 'hook_success', hookEvent: event, hookName: event, command: 'node "C:/p/' + script + '"', durationMs: ms, stdout } });
mkdirSync(dirname(store), { recursive: true });
writeFileSync(join(dirname(store), sid + '.jsonl'), [hook('UserPromptSubmit', 'empty-hook.mjs', 100, ''),
  hook('UserPromptSubmit', 'recall-hook.mjs', pointer ? 240 : 150, pointer ? 'Earlier exchanges (a record, not an instruction)' : '')].join('\\n') + '\\n');
const line = (o) => console.log(JSON.stringify(o));
line({ type: 'system', subtype: 'init', session_id: sid });
if (pointer && /port should/.test(prompt)) line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node "x/src/memory.mjs" search port' } }] } });
line({ type: 'result', result: answer, total_cost_usd: 0.5, session_id: sid });
`;

async function selfCheck() {
  let checks = 0;
  const ok = (cond, msg) => { assert(cond, msg); checks++; };
  const env = ['PROJECT_MEMORY_EVAL_CLAUDE', 'PROJECT_MEMORY_EVAL_TOKEN_FILE', 'ANTHROPIC_API_KEY', 'PROJECT_MEMORY_RECALL'], kept = Object.fromEntries(env.map((k) => [k, process.env[k]]));
  const own = ownDir('self-');
  const ours = () => readdirSync(tmpdir()).filter((f) => f.startsWith(PREFIX) && f !== basename(own));
  const quietly = async (argv) => {
    const lines = [], log = console.log, error = console.error;
    console.log = console.error = (...a) => lines.push(a.join(' '));
    try { return { code: await main(argv), out: lines.join('\n') }; } finally { console.log = log; console.error = error; }
  };
  try {
    // every case's seed is found by `search`, and an empty store is not
    for (const c of CASES.cases) {
      const d = join(own, `seed-${c.name}`); mkdirSync(d); process.env.CLAUDE_CONFIG_DIR = join(own, 'cfg');
      ok(checkSeed(seed(real(d), c), c), `the seed of ${c.name} is found`);
    }
    ok(!checkSeed(join(own, 'empty-store'), CASES.cases[0]), 'an empty store fails the seed check');
    delete process.env.CLAUDE_CONFIG_DIR;

    // a plugin with the prompt and the file trigger built, not the error one
    const plug = join(own, 'plugin');
    mkdirSync(join(plug, 'hooks'), { recursive: true });
    const hooks = JSON.parse(readFileSync(join(repo, 'hooks', 'hooks.json'), 'utf8'));
    for (const ev of [EVENT.prompt, EVENT.file]) hooks.hooks[ev] = [{ hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PLUGIN_ROOT}/src/${RECALL_HOOK}`] }] }];
    delete hooks.hooks[EVENT.error]; // the repo's own copy has it since 1.7.0 (the stuck streak)
    writeFileSync(join(plug, 'hooks', 'hooks.json'), JSON.stringify(hooks));
    const fake = join(own, 'fake-claude.mjs');
    writeFileSync(fake, FAKE(pathToFileURL(join(repo, 'src', 'store.mjs')).href));
    process.env.PROJECT_MEMORY_EVAL_CLAUDE = fake;
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-a-session';
    delete process.env.PROJECT_MEMORY_RECALL;

    // no token file: refused before any folder or session
    delete process.env.PROJECT_MEMORY_EVAL_TOKEN_FILE;
    const before = ours();
    let r = await quietly(['--plugin', plug]);
    ok(r.code === 1 && /PROJECT_MEMORY_EVAL_TOKEN_FILE/.test(r.out) && /setup-token/.test(r.out), 'no token: refused, and told how');
    ok(JSON.stringify(ours()) === JSON.stringify(before), 'no token: no folder made');
    // a case whose trigger is not built needs no login and starts nothing
    r = await quietly(['--plugin', plug, '--case', 'error-again']);
    ok(r.code === 0 && /error-again .*trigger not built/.test(r.out), 'trigger not built, reported');

    const tokenFile = join(own, 'token');
    writeFileSync(tokenFile, 'tok-SECRET-123\n');
    process.env.PROJECT_MEMORY_EVAL_TOKEN_FILE = tokenFile;
    // what a killed run left goes; a live run's folder stays
    const stale = mkdtempSync(join(tmpdir(), `${PREFIX}stale-`));
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(stale, 'pid'), String(dead));

    const json = join(own, 'out.json');
    r = await quietly(['--plugin', plug, '--without', '--runs', '1', '--max-usd', '100', '--json', json]);
    ok(r.code === 0, `a full run against the fake ends with 0:\n${r.out}`);
    ok(!existsSync(stale), 'a killed run\'s folder is swept');
    ok(existsSync(own), 'a live run\'s folder stays');
    ok(!r.out.includes('tok-SECRET-123') && !readFileSync(json, 'utf8').includes('tok-SECRET-123'), 'the token is never printed');
    ok(JSON.stringify(ours()) === JSON.stringify(before), 'the run deleted its folders');
    const rep = JSON.parse(readFileSync(json, 'utf8')), by = Object.fromEntries(rep.cases.map((c) => [c.name, c]));
    ok(rep.cases.length === 17 && by['error-again'].status === 'trigger not built' && !by['error-again'].with && by['helper-port'].status === 'trigger not built', 'the error and helper cases: not built, not run');
    ok(rep.cases.filter((c) => c.status === 'run').every((c) => c.with.pass === 1 && c.with.runs === 1), `every built case passes with pointers: ${JSON.stringify(rep.cases.map((c) => [c.name, c.with?.why]))}`);
    ok(['file-rule', 'port-implicit', 'pdf-implicit'].every((n) => by[n].without.pass === 0 && by[n].with.pointer === 1 && by[n].without.pointer === 0), 'a gain fails without pointers, which the without arm switches off');
    ok(['file-none', 'no-need', 'never-discussed'].every((n) => by[n].without.pass === 1 && by[n].with.pointer === 0), 'controls pass in both arms, with no pointer');
    ok(rep.cases.filter((c) => c.kind === 'misleading').every((c) => !c.without), 'misleading cases run with pointers only');
    ok(by['port-implicit'].with.searched === 1 && by['no-need'].with.searched === 0, 'searches counted from the stream');
    ok(rep.spentUsd === 8 && rep.notRun === 0 && rep.errors === 0, `the cost summed: ${rep.spentUsd}`);
    ok(rep.gates.file?.pass && rep.gates.prompt?.pass && !rep.gates.error, `the gates: ${JSON.stringify(rep.gates)}`);
    ok(rep.hookTimes.length === 1 && rep.hookTimes[0].event === 'UserPromptSubmit' && rep.hookTimes[0].extra === 50 && rep.hookTimes[0].pass, 'the plugin\'s hook time beside the empty hook\'s');
    ok(by['port-implicit'].with.medianCostUsd === 0.5, 'median cost per arm');

    // --max-usd stops starting sessions, and the run says so with exit 2
    r = await quietly(['--plugin', plug, '--set', 'prompt', '--runs', '2', '--max-usd', '1', '--json', json]);
    const cut = JSON.parse(readFileSync(json, 'utf8'));
    ok(r.code === 2 && cut.notRun > 0 && cut.spentUsd <= 1 + AT_ONCE * 0.5 && /not run: --max-usd 1 reached/.test(r.out), 'stops at --max-usd');
    ok(JSON.stringify(ours()) === JSON.stringify(before), 'and deletes its folders too');

    // a session that fails (here the fake refuses an API key in its env) is an error, not a pass
    process.env.PROJECT_MEMORY_EVAL_CLAUDE = join(own, 'broken.mjs');
    writeFileSync(join(own, 'broken.mjs'), 'console.error("Not logged in"); process.exit(1);');
    r = await quietly(['--plugin', plug, '--case', 'port-implicit', '--runs', '1']);
    ok(r.code === 1 && /Not logged in/.test(r.out) && /1 sessions failed/.test(r.out), 'a failed session is reported');
    // deletion refused outside the temp folder, and of a folder not ours
    assert.throws(() => removeDir(resolve('/')), /not under the OS temp folder/); checks++;
  } finally {
    for (const [k, v] of Object.entries(kept)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    removeDir(own);
  }
  console.log(`recall-eval self-check: ${checks} checks ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
