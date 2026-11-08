// Mutation check for the six suites: break one rule of a tool at a time in a
// copy and confirm its test fails. A mutant that survives is a rule the test
// does not watch. Run: node mutate.mjs
import { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tool, tempDir } from './harness.mjs';
import { mutants, ignored } from './automut.mjs';
import store from './mutants/store.mjs';
import compactGate from './mutants/compact-gate.mjs';
import handoffLog from './mutants/handoff-log.mjs';
import memoryTier from './mutants/memory-tier.mjs';
import memory from './mutants/memory.mjs';
import hooks from './mutants/hooks.mjs';
import journal from './mutants/journal.mjs';
import deploy from './mutants/deploy.mjs';

// Every file a suite may import, copied beside the mutant.
const FILES = ['harness.mjs', 'store.mjs', 'handoff-log.mjs', 'journal.mjs', 'compact-gate.mjs', 'memory-tier.mjs', 'deploy.mjs', 'memory.mjs',
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json', 'skills/memory/SKILL.md'];

export const suites = {
  'store.mjs': ['store.test.mjs', store],
  'compact-gate.mjs': ['compact-gate.test.mjs', compactGate],
  'handoff-log.mjs': ['handoff-log.test.mjs', handoffLog],
  'memory-tier.mjs': ['memory-tier.test.mjs', memoryTier],
  'memory.mjs': ['memory.test.mjs', memory],
  'hooks/hooks.json': ['memory.test.mjs', hooks],
  'journal.mjs': ['journal.test.mjs', journal],
  'deploy.mjs': ['handoff-log.test.mjs', deploy],
};
// The file that holds a group's mutants. Editing it reruns that group alone; a change to this file reruns them all (SHARED in deploy.mjs).
export const tableOf = (name) => `mutants/${name.split('/').pop().replace(/\.\w+$/, '')}.mjs`;
// Whether a --changed list asks for a group: its source, its suite or its mutants.
export const inScope = (changed, name, test) => [name, test, tableOf(name)].some((f) => changed.includes(f));
// The machines a change needs on GitHub: scope is deploy.mjs's changedScope, null for every mutant.
export const shardsFor = (scope, machines) => (!scope || Object.entries(suites).some(([name, [test]]) => inScope(scope, name, test)) ? Array.from({ length: machines }, (_, i) => i + 1) : []);

// Run when executed, not when imported: check.mjs reads the table above.
// A mutant that hit the clock is run once more, alone: on a slow GitHub machine three that a run before killed in 18-75 s
// timed out at 120 s and counted as survivors. Killed the second time it counts as killed; otherwise the second verdict stands.
export const settle = async (first, again) => first !== 'TIMED OUT' ? first : ((v) => v === 'killed' ? 'killed on retry' : v)(await again());

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Side by side, one per core but one: each mutant has its own folder and HOME,
  // and one after another the check took ~15 minutes of a 20-minute deploy.
  // `node mutate.mjs <text...>` runs only the mutants whose label contains one
  // of the texts: several run one pool (one at a time, each paid its own controls).
  // `--changed a,b`: only the groups whose source, suite or mutants are among the
  // files a deploy changed. `--shard i/n`: every n-th mutant from the i-th, one machine
  // of a GitHub matrix (.github/workflows/mutate.yml).
  // `--auto`: every hand mutant and every automatic one (automut.mjs, the
  // table's source files); `--auto-lines a.mjs:3,5;b.mjs:9`: only the automatic
  // ones on those lines; `--list`: print the labels, run nothing.
  // Every file is read once, here: an edit made while the check runs must not
  // reach half the mutants.
  const args = process.argv.slice(2), value = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
  const changed = value('--changed')?.split(',').filter(Boolean), shard = value('--shard')?.match(/^(\d+)\/(\d+)$/);
  // --shard 0/17, 18/17 or a typo selected no mutant and reported "all 0 killed": a check that never ran (audit #15).
  if (args.includes('--shard') && !(shard && Number(shard[1]) >= 1 && Number(shard[1]) <= Number(shard[2]))) { console.error(`--shard wants i/n with i from 1 to n, not "${value('--shard')}"`); process.exit(1); }
  const only = args.filter((a, i) => !a.startsWith('--') && !['--changed', '--shard', '--auto-lines'].includes(args[i - 1]));
  // A missing or empty --auto-lines value selects nothing, never every hand mutant.
  const wantsLines = args.includes('--auto-lines'), autoLines = wantsLines ? (value('--auto-lines') ?? '').replace(/^--.*/, '') : undefined;
  if (autoLines && !/^[^:;]+:\d+(,\d+)*(;[^:;]+:\d+(,\d+)*)*$/.test(autoLines)) { console.error(`--auto-lines wants <file>:<n>,<n>;<file>:<n>, not "${autoLines}"`); process.exit(1); }
  if (wantsLines && !autoLines && !args.includes('--auto')) { console.log('--auto-lines: no lines given, nothing selected'); process.exit(0); }
  const auto = args.includes('--auto') || wantsLines, hand = !wantsLines || args.includes('--auto');
  const lineSets = new Map(autoLines?.split(';').filter(Boolean).map((p) => { const [f, ls = ''] = p.split(':'); return [f, new Set(ls.split(',').filter(Boolean).map(Number))]; }));
  const tests = [...new Set(Object.values(suites).map(([t]) => t))];
  const code = Object.fromEntries([...FILES, ...tests].filter((f) => existsSync(tool(f))).map((f) => [f, readFileSync(tool(f))]));
  const jobs = [];
  for (const [name, [testName, mutants]] of Object.entries(suites)) {
    if (changed && !inScope(changed, name, testName)) continue;
    if (hand) for (const [label, [from, to, opts]] of Object.entries(mutants)) if (!only.length || only.some((o) => label.includes(o))) jobs.push({ name, testName, label, from, to, full: !!opts?.full });
  }
  // The automatic mutants, after the hand ones: dropped when a hand mutant makes
  // the same edit. Compared as (offset, removed, inserted) with the common start
  // and end of from/to trimmed, not as two whole mutated files (2,270 x 883 copies).
  const edit = (at, from, to) => {
    let p = 0, q = 0;
    while (p < from.length && p < to.length && from[p] === to[p]) p++;
    while (q < from.length - p && q < to.length - p && from.at(-1 - q) === to.at(-1 - q)) q++;
    return JSON.stringify([at + p, from.slice(p, from.length - q), to.slice(p, to.length - q)]);
  };
  const stale = [];
  let dropped = 0;
  const ignore = ignored(existsSync(tool('automut-ignore.txt')) ? readFileSync(tool('automut-ignore.txt'), 'utf8') : null);
  if (auto) {
    const seen = new Set();
    for (const [name, [testName, table]] of Object.entries(suites)) {
      if (name === 'hooks/hooks.json' || !code[name]) continue; // JSON: no code to mutate
      const src = code[name].toString('utf8'), same = new Set();
      for (const [from, to] of Object.values(table)) { const i = src.indexOf(from); if (i !== -1) same.add(edit(i, from, to)); }
      const every = mutants(name, src);
      every.forEach((m) => seen.add(m.id));
      if (changed && !inScope(changed, name, testName)) continue;
      for (const m of !wantsLines || args.includes('--auto') ? every : mutants(name, src, lineSets.get(name) ?? new Set())) {
        if (same.has(edit(m.at, m.from, m.to))) { dropped++; continue; }
        if (!only.length || only.some((o) => m.label.includes(o))) jobs.push({ name, testName, label: m.label, edit: m, id: m.id, auto: true, full: false });
      }
    }
    for (const id of ignore.keys()) if (!seen.has(id)) stale.push(id);
  }
  if (shard) jobs.splice(0, jobs.length, ...jobs.filter((_, k) => k % Number(shard[2]) === Number(shard[1]) - 1));
  if (args.includes('--list')) {
    for (const j of jobs) console.log(j.label);
    if (auto) console.error(`${dropped} automatic mutant(s) dropped as copies of hand mutants`);
    for (const id of stale) console.error(`stale ignore: ${id}`);   // stderr: stdout is the list check.mjs reads
    process.exit(0);
  }
  for (const id of stale) console.log(`stale ignore: ${id}`);
  // --mutant skips a suite's slow blocks (harness.mjs `quick`): a lock waited
  // out, a race, a big fixture, paid again by each of ~750 mutants, and a clock
  // that beside the other mutants failed on the right code, a kill by the time,
  // not by the rule. A mutant only those blocks kill is marked { full: true }.
  const how = (j) => (j.full ? j.testName : `${j.testName} --mutant`);
  // A suite that fails unmutated kills every mutant, and the check then proves
  // nothing: a missing file once passed 132 mutants in 6 seconds.
  const run = (args, name, from, to, limit, at) => new Promise((done) => {
    const src = name && code[name].toString('utf8');
    // An automatic mutant carries its offset: it applies where it was found.
    if (at !== undefined) { if (src.slice(at, at + from.length) !== from) return done('MUTATION DID NOT APPLY'); }
    else if (name && !src.includes(from)) return done('MUTATION DID NOT APPLY');
    // Found twice, only the first was ever broken: the redaction of a bare
    // token's next-line value went unwatched behind a find-text that matched both rules.
    if (name && at === undefined && src.split(from).length > 2) return done('FIND-TEXT NOT UNIQUE');
    const dir = tempDir('mut-');
    // A function, so a `$&` or `$'` in the mutant is text, not a pattern.
    for (const [f, buf] of Object.entries(code)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), f !== name ? buf : at === undefined ? src.replace(from, () => to) : src.slice(0, at) + to + src.slice(at + from.length)); }
    // A break that no longer parses proves nothing about the tests: not a survivor.
    const parsed = at !== undefined && spawnSync(process.execPath, ['--check', join(dir, name)], { encoding: 'utf8' });
    if (parsed && parsed.status !== 0) { try { rmSync(dir, { recursive: true, force: true }); } catch {} return done(`STILLBORN: ${(parsed.stderr.split('\n').find((l) => /Error/.test(l)) ?? '').trim()}`); }
    const [testName, ...flags] = args.split(' ');
    // A control (no mutant) keeps the end of its errors: "fails unmutated" with
    // no reason sent a GitHub run back blind (2026-10-30). A mutant's are its kill.
    const child = spawn(process.execPath, [join(dir, testName), ...flags], { stdio: name ? 'ignore' : ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr?.on('data', (b) => { err = (err + b).slice(-2000); });
    // A suite cut off by the clock proved nothing: not a kill.
    let late = false;
    const timer = setTimeout(() => { late = true; child.kill(); }, limit);
    // A child a killed suite left behind can still hold the folder: TEMP keeps it.
    child.on('close', (status) => { clearTimeout(timer); try { rmSync(dir, { recursive: true, force: true }); } catch {} if (!name) why[args] = err; done(late ? 'TIMED OUT' : status === 0 ? 'SURVIVED' : 'killed'); });
  });
  const why = {};
  // Controls run as many at once as the mutants do: a suite that passes alone but
  // fails under that load would kill mutants by timing, not by the rule.
  const pool = async (items, fn) => {
    let next = 0;
    const worker = async () => { while (next < items.length) await fn(items[next++]); };
    await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, worker));
  };
  const took = {};
  // An ignored mutant never runs, so its suite needs no control for it.
  const live = jobs.filter((j) => !ignore.has(j.id));
  await pool([...new Set(live.map(how))], async (t) => {
    const t0 = Date.now();
    if (await run(t, undefined, undefined, undefined, 600_000) !== 'SURVIVED') {
      const lines = (why[t] ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^at /.test(l) && !/^Node\.js v/.test(l));
      console.log(`${t} fails unmutated: fix it before the mutants can say anything. ${lines.find((l) => /Error\b/.test(l)) ?? lines.at(-1) ?? ''}`.slice(0, 600));
      process.exit(1);
    }
    took[t] = Date.now() - t0;
  });
  // Longest suites first, timed by their controls: in file order the last
  // handoff-log mutants ran on alone while the other workers sat idle. A mutant
  // that hangs is cut off at three times its control: a whole memory.test.mjs
  // took 122 s beside other work, past the 120 s every mutant once had.
  live.sort((a, b) => took[how(b)] - took[how(a)]);
  const survived = [], count = { STILLBORN: 0, IGNORED: jobs.length - live.length };
  // The id is what automut-ignore.txt needs; a label can name two mutants.
  const tag = (j) => `${j.label}${j.id ? ` [${j.id}]` : ''}`;
  for (const j of jobs) if (ignore.has(j.id)) console.log(`${j.name.padEnd(17)} ${tag(j).padEnd(48)} IGNORED: ${ignore.get(j.id)}`);
  const report = (job, verdict, t0) => {
    if (verdict.startsWith('STILLBORN')) count.STILLBORN++;
    else if (verdict !== 'killed' && verdict !== 'killed on retry') survived.push(`${job.name} :: ${tag(job)} (${verdict})`);
    console.log(`${job.name.padEnd(17)} ${tag(job).padEnd(48)} ${verdict} ${Math.round((Date.now() - t0) / 1000)} s`);
  };
  const go = (job) => run(how(job), job.name, job.edit?.from ?? job.from, job.edit?.to ?? job.to, Math.max(120_000, 3 * took[how(job)]), job.edit?.at);
  const late = [];
  await pool(live, async (job) => {
    const t0 = Date.now(), verdict = await go(job);
    if (verdict === 'TIMED OUT') late.push(job); else report(job, verdict, t0);
  });
  // One at a time, after the pool: alone on the machine.
  for (const job of late) { const t0 = Date.now(); report(job, await settle('TIMED OUT', () => go(job)), t0); }
  // Named on the last line: deploy prints only the last few, and "2 survived"
  // sent a 65-minute run back to find which (2026-10-30).
  const ran = live.length - count.STILLBORN, tail = `; ${count.STILLBORN} stillborn, ${count.IGNORED} ignored`;
  console.log((survived.length ? `${survived.length} of ${ran} mutant(s) survived: ${survived.join('; ')}` : `all ${ran} mutants killed`) + tail);
  process.exit(survived.length ? 1 : 0);
}
