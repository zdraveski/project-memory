// enforce.mjs's wall-clock limits, out of enforce.test.mjs: tools/suites.mjs runs a *-timed file alone after the
// other suites, so a limit measures the code and not a machine busy with 30 other suites. Same limits as before.
// Run: node test/enforce-timed.test.mjs
import assert from 'node:assert';
import { ruleOf, segments, hits } from '../src/enforce.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const note = (rule, extra = '') => `---\nname: Stage files by name\ndescription: Never run git add -A.\ntype: feedback\n${extra}${rule}---\n\nbody\n`;
const A = (c) => hits({ on: 'add', has: ['-A', '--all'], unless: [] }, c);

// The best of up to 5 runs (runs stop once one is under the limit), so one stall on a busy runner is no failure.
const best = (f, lim = 2500) => { let m = Infinity; for (let i = 0; i < 5 && m >= lim; i++) { const t = performance.now(); f(); m = Math.min(m, performance.now() - t); } return m; };
// Under 1 ms on a 2026 PC; the quadratic lazy `(.*?)[ \t]*$` it replaced takes 4 s here.
{ const m = best(() => ruleOf(note('enforce:\n  on: git add\n  has: [-A]\n  unless: x' + ' '.repeat(60000) + 'y\n')), 1000);
  ok(m < 1000, `ruleOf is not quadratic on a long run of blanks (${m.toFixed(0)} ms)`); }
// Under 2.5 s (best, above). 500 ms failed on busy runners (best of 3 at 581 ms, macOS, 2026-11-26). On a 2026 PC
// the linear code takes ~70 ms (hits, 30,000 lines) and ~45 ms (segments); with its O(1) closing-word check swapped for a
// scan (quadratic) one run takes 8 s and ~30 s: 3x over the limit on a fast PC, 30x under it for the linear code.
// (Growth ratios were tried and were noisier still: 11x for linear work on Windows CI.)
{ const h = best(() => A('git add -A\n' + 'cat <<EOF\n'.repeat(30000))), s = best(() => segments('git status\n' + 'cat <<A\nx\n'.repeat(60000)));
  ok(h < 2500 && s < 2500, `unclosed heredocs are linear (hits ${h.toFixed(0)} ms, segments ${s.toFixed(0)} ms)`); }

console.log(`enforce-timed: ${checks} checks passed`);
