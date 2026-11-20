// Self-check for timing.mjs, the one line of numbers every hook run appends to <projects root>/.timing.
// Run: node timing.test.mjs
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome } from './harness.mjs';
import { begin, tag, mark, flush, read, cut, stats, pct, FILE, MAX } from './timing.mjs';

const { home } = tempHome('timing-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const root = join(home, '.claude', 'projects'), file = join(root, FILE);
mkdirSync(root, { recursive: true });

begin('save'); tag('Stop'); mark('input'); mark('load'); mark('input'); await flush();
const [l] = read(0, file);
ok(l.h === 'save' && l.e === 'Stop', 'the hook and the event');
ok(Number.isInteger(l.node) && l.node > 0 && l.start >= l.node && l.ms >= l.start, 'node, then start, then the total');
ok(eq(Object.keys(l.p), ['input', 'load']), 'a phase marked twice is one phase');
ok(readFileSync(file, 'utf8').split('\n').length === 2, 'one line, one newline');
ok((statSync(file).mode & 0o777) === 0o600 || process.platform === 'win32', 'private to the user');

// tag keeps names only
for (const bad of ['C:\\Users\\someone', 'a b', 'x'.repeat(10000), '', undefined, { a: 1 }]) { begin('gate'); tag(bad, bad); await flush(); }
ok(read(0, file).slice(1).every((x) => x.e === '?'), 'what is not a name is ?');
begin('brief'); tag('SessionStart', 'compact'); await flush();
ok(read(0, file).at(-1).e === 'SessionStart:compact', 'the detail after a colon');
begin('brief'); tag('SessionStart', 'a b/c'); await flush();
ok(read(0, file).at(-1).e === 'SessionStart', 'a detail that is not a word is left out');
begin('brief'); await flush();
ok(read(0, file).at(-1).e === '?', 'no tag, no event name');

// what starts nothing
const count = read(0, file).length;
begin('anything'); mark('x'); await flush();
mark('y'); await flush();
process.env.PROJECT_MEMORY_TIMING = '0'; begin('save'); await flush(); delete process.env.PROJECT_MEMORY_TIMING;
ok(read(0, file).length === count, 'an unknown hook, no begin and the off switch wrote no line');
begin('save'); await flush(); await flush();
ok(read(0, file).length === count + 1, 'a second flush writes nothing');

// the cut
const fill = (n, t0) => Array.from({ length: n }, (_, i) => JSON.stringify({ t: t0 + i, h: 'save', e: 'Stop', start: 90, p: { load: 20 }, ms: 300 })).join('\n') + '\n';
writeFileSync(file, fill(Math.ceil(MAX / 60), 1000));
ok(statSync(file).size > MAX, 'the made-up file is over the limit');
begin('save'); tag('Stop'); await flush();
ok(statSync(file).size < MAX * 0.6, 'cut to its newer half');
const newest = read(0, file).at(-1);
ok(newest.t > 1e12, 'the newest line stays');
ok(!readdirSync(root).some((f) => f.startsWith('.timing.tmp')), 'no temp file stays');
ok(read(0, file).every((x, i, a) => !i || a[i - 1].t <= x.t), 'oldest first');

// a cut that loses the race leaves the file as it was
writeFileSync(file, fill(Math.ceil(MAX / 60), 1000));
const before = readFileSync(file, 'utf8'), size = statSync(file).size;
cut(file, size, () => ({ size: size + 100 }));
ok(readFileSync(file, 'utf8') === before, 'another run appended: the file is kept');
ok(!readdirSync(root).some((f) => f.startsWith('.timing.tmp')), 'a lost race leaves no temp file');
cut(file, MAX);
ok(readFileSync(file, 'utf8') === before, 'a file under the limit is not cut');

// read(): a cut-off last line, a line of prose, a line with unknown keys, a line without numbers
writeFileSync(file, fill(3, 5000));
const n0 = read(0, file).length;
writeFileSync(file, readFileSync(file, 'utf8') + 'some prose\n{"t":1,"ms":"x"}\n{"t":9000,"h":"save","ms":5,"extra":7}\n{"t":9001,"h":"sa');
ok(read(0, file).length === n0 + 1 && read(0, file).at(-1).extra === 7, 'the broken ones are skipped, the unknown key is kept');
ok(read(5001, file).every((x) => x.t >= 5001), 'since cuts the old ones');
ok(eq(read(0, join(root, 'nothing')), []), 'a missing file is an empty list');

// stats
ok(eq(stats([5, 1, 3, 2, 4, 9, 7, 8, 6, 10]), { runs: 10, median: 6, p90: 10, worst: 10 }), 'the house percentile');
ok(pct([1, 2, 3], 0.5) === 2, 'pct');

console.log(`timing.test.mjs: ${checks} checks passed`);
