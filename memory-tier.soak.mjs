// Soak: does the DESIGN hold, not just the code. Two questions the unit test
// and the break harness cannot answer.
//   1. Concurrency — sessions end at the same time (the remember plugin spawns
//      `claude -p` children that end while the parent does). Do simultaneous
//      runs leave a valid store?
//   2. Steady state — the corpus grows ~6 memories a day. Simulate a month of
//      that and see what the index costs on day 30, and what survives in it.
// Run: node memory-tier.soak.mjs [store dir]   (default: this machine's largest store, copied)
import { writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';
import { tool, tempDir, audit, largestStore } from './harness.mjs';
// The ceiling under test is the tool's own: a copy of the number here went
// stale the day the owner lowered it and asserted nothing.
import { BUDGET } from './store.mjs';

const TOOL = tool('memory-tier.mjs');
const REAL = process.argv[2] || largestStore();
if (!REAL) { console.error('no memory store on this machine to copy: pass one, node memory-tier.soak.mjs <store dir>'); process.exit(1); }
const CLOCK = Date.now();
const run = (dir, ...a) => execFileSync(process.execPath, [TOOL, '--dir', dir, ...a], { encoding: 'utf8' });

// audit(): see harness.mjs
// --- 1. concurrency ---------------------------------------------------------
const cdir = tempDir('soak-c-');
cpSync(REAL, cdir, { recursive: true, preserveTimestamps: true });
await Promise.all(Array.from({ length: 12 }, () => new Promise((res) => {
  execFile(process.execPath, [TOOL, '--dir', cdir, '--now', String(CLOCK)], () => res());
})));
// The property worth asserting: a race is a no-op, not a different answer.
// Same store, same clock, run once -- the result must be byte-identical.
const sdir0 = tempDir('soak-serial-');
cpSync(REAL, sdir0, { recursive: true, preserveTimestamps: true });
run(sdir0, '--now', String(CLOCK));
assert.equal(readFileSync(join(cdir, 'MEMORY.md'), 'utf8'), readFileSync(join(sdir0, 'MEMORY.md'), 'utf8'),
  '12 concurrent runs must land on the same index as one serial run');
rmSync(sdir0, { recursive: true, force: true });

const c = audit(cdir);
assert.equal(c.dupes, 0, 'concurrent runs must not duplicate a pointer');
assert.deepEqual(c.orphans, [], 'concurrent runs must not orphan a memory');
assert.deepEqual(c.dangling, [], 'concurrent runs must not leave a dangling pointer');
assert.deepEqual(c.stray, [], 'no temp file may survive');
assert.equal(c.archiveLines, 1, 'exactly one archive line after a race');
console.log(`concurrency: 12 simultaneous runs -> ${c.hot} hot / ${c.cold} archived, store valid`);
rmSync(cdir, { recursive: true, force: true });

// --- 2. thirty days of writing at the observed rate -------------------------
const sdir = tempDir('soak-s-');
cpSync(REAL, sdir, { recursive: true, preserveTimestamps: true });
const DAY = 86400000;
const DAYS = Number(process.argv[2]) || 30;
const start = Date.now();
let day0 = audit(sdir);
for (let d = 1; d <= DAYS; d++) {
  const when = new Date(start + d * DAY).toISOString();
  const stamp = when.slice(0, 10);
  // Six a day, the observed rate: four dated event logs, one durable note, one
  // working rule -- roughly the mix this store actually produced.
  const made = [];
  for (let i = 0; i < 4; i++) made.push([`audit-${stamp}-${i}`, 'project']);
  made.push([`durable-note-d${d}`, 'project']);
  made.push([`working-rule-d${d}`, 'feedback']);
  for (const [name, type] of made) {
    writeFileSync(join(sdir, `${name}.md`),
      `---\nname: ${name}\ndescription: "desc of ${name}"\nmetadata:\n  type: ${type}\n  modified: ${when}\n---\n\nbody\n`);
  }
  // The pointers a session would add by hand, at the length the trimmed index uses.
  const lines = made.map(([n]) => `- [${n}](${n}.md) — a hook of about the length a trimmed index actually carries, give or take`);
  const main = readFileSync(join(sdir, 'MEMORY.md'), 'utf8').split('\n');
  const at = main.findIndex((l) => /\(MEMORY-archive\.md\)/.test(l));
  main.splice(at < 0 ? main.length : at, 0, ...lines);
  writeFileSync(join(sdir, 'MEMORY.md'), main.join('\n'));
  run(sdir, '--now', String(start + d * DAY));
}
const s = audit(sdir);
const files = readdirSync(sdir).filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).length;
console.log(`${DAYS} days at 6 memories/day: corpus ${day0.hot + day0.cold} -> ${files} memories, ` +
  `index ${day0.bytes}B -> ${s.bytes}B, ${s.hot} hot / ${s.cold} archived`);
assert(s.bytes <= BUDGET, `the ceiling must hold: ${s.bytes}B > ${BUDGET}B`);
assert.equal(s.dupes, 0, 'no duplicates after a month');
assert.deepEqual(s.orphans, [], 'no memory falls out of both indexes');
assert.deepEqual(s.dangling, [], 'no dangling pointer');
const hotLines = readFileSync(join(sdir, 'MEMORY.md'), 'utf8');
assert(/opus-launch-order/.test(hotLines), 'a pinned front door survives every day of writing');
assert(hotLines.includes(`(working-rule-d${DAYS}.md)`), "the last day's working rule stays hot");
// A pointer line names its memory twice, in the title and in the target. Count
// targets: the first draft of this counted both and reported 60 of 30.
const rules = (hotLines.match(/\(working-rule-d\d+\.md\)/g) || []).length;
const notes = (hotLines.match(/\(durable-note-d\d+\.md\)/g) || []).length;
const events = (hotLines.match(/\(audit-\d{4}-\d{2}-\d{2}-\d\.md\)/g) || []).length;
console.log(`  day ${DAYS} hot index: ${rules}/${DAYS} working rules, ${notes} durable notes, ` +
  `${events} event logs, ${s.hot - rules - notes - events} from before the simulation`);
// The index has two jobs: how to work here, and where the work stands. Rules
// that never age out ate all of it by day 180 -- 69 rules, 0 recent anything.
assert(notes + events > 0, `no recent work survived in the index: ${rules} rules and nothing else`);
assert(rules < s.hot, 'the index must not become nothing but working rules');
rmSync(sdir, { recursive: true, force: true });

// --- 3. a session adding memories while other hooks tier the store ----------
// The model writes a memory file, then edits the index to point at it, while
// tiering runs (another session's hook, a manual run). Before the orphan grace,
// the replace check and the reorder rule, 74 of 120 hand-written pointers were
// replaced by recovered machine lines (race probe, 2026-10-26).
const rdir = tempDir('soak-r-');
const raceMem = (i) => `---\nname: race-${i}\ndescription: "machine description ${i}"\nmetadata:\n  type: project\n---\n\nbody\n`;
let raceIndex = '# Memory\n';
for (let i = 0; i < 30; i++) { writeFileSync(join(rdir, `seed-${i}.md`), raceMem(`seed-${i}`)); raceIndex += `- [seed ${i}](seed-${i}.md) — seed hook ${i}\n`; }
writeFileSync(join(rdir, 'MEMORY.md'), raceIndex);
run(rdir);
const N = 120;
const writer = (async () => {
  for (let i = 0; i < N; i++) {
    writeFileSync(join(rdir, `race-${i}.md`), raceMem(i));
    await new Promise((r) => setTimeout(r, 20));
    for (let k = 0; k < 20; k++) {
      try { const cur = readFileSync(join(rdir, 'MEMORY.md'), 'utf8'); writeFileSync(join(rdir, 'MEMORY.md'), cur + `- [race ${i}](race-${i}.md) — hand hook ${i}\n`); break; }
      catch { await new Promise((r) => setTimeout(r, 5)); }
    }
  }
})();
const passes = (async () => {
  const ps = [];
  for (let k = 0; k < 60; k++) { ps.push(new Promise((res) => execFile(process.execPath, [TOOL, '--dir', rdir], () => res()))); await new Promise((r) => setTimeout(r, 40)); }
  await Promise.all(ps);
})();
await Promise.all([writer, passes]);
run(rdir);
const both = readFileSync(join(rdir, 'MEMORY.md'), 'utf8') + '\n' + readFileSync(join(rdir, 'MEMORY-archive.md'), 'utf8');
let replaced = 0, gone = 0;
for (let i = 0; i < N; i++) {
  const m = both.match(new RegExp(`\\(race-${i}\\.md\\) — (.*)`));
  if (!m) gone++; else if (m[1] !== `hand hook ${i}`) replaced++;
}
console.log(`race: ${N} memories added while 60 passes tiered the store -> ${replaced} hand-written pointers replaced, ${gone} without a pointer`);
assert.equal(gone, 0, 'every raced memory keeps a pointer');
assert.equal(replaced, 0, 'no hand-written pointer is replaced by a recovered line');
console.log('soak: passed');
