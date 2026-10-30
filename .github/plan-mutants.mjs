// The mutate workflow's plan: which mutants, on how many machines. Prints
// GitHub step outputs: `shards` (a JSON list, empty when no mutant is due) and
// `changed` (empty: every mutant). By hand, or a branch's first push, every
// mutant; a push, the changed files' only, by deploy.mjs's own rule (all of
// them after a change to what every suite stands on).
import { execFileSync } from 'node:child_process';
import { changedScope } from '../deploy.mjs';
import { suites } from '../mutate.mjs';

const machines = Math.min(256, Math.max(1, Math.floor(Number(process.env.MACHINES)) || 17));
const before = process.env.BEFORE || '';
const scope = before && !/^0+$/.test(before)
  ? changedScope(execFileSync('git', ['diff', '--name-only', before, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean))
  : null;
const due = !scope || Object.entries(suites).some(([file, [test]]) => scope.includes(file) || scope.includes(test));
console.log(`shards=${JSON.stringify(due ? Array.from({ length: machines }, (_, i) => i + 1) : [])}`);
console.log(`changed=${scope ? scope.join(',') : ''}`);
