// What a mutate.yml run found, from its machines' results files, finished or cut off: the survivors, and the
// mutants a machine never reached (rerun only those machines, split smaller: never the whole run again).
// Run: gh run download <run-id> -p 'mutate-results-*' -D <dir>; node tools/mutate-results.mjs <dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const KILLED = ['killed', 'killed on retry'];
// One machine's results-file text: what survived, and what it planned but never reported.
export const summarize = (text) => {
  const rows = text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const planned = rows.find((r) => r.planned)?.planned ?? [], done = rows.filter((r) => r.mutant);
  const seen = new Set(done.map((r) => r.mutant));
  return {
    survived: done.filter((r) => !KILLED.includes(r.verdict) && !r.verdict.startsWith('STILLBORN')).map((r) => `${r.mutant} (${r.verdict})`),
    notRun: planned.filter((m) => !seen.has(m)),
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/mutate-results.mjs <folder gh run download made>'); process.exit(2); }
  const files = (function walk(d) { return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.jsonl') ? [join(d, f)] : [])); })(dir);
  let bad = 0;
  for (const f of files.sort()) {
    const { survived, notRun } = summarize(readFileSync(f, 'utf8'));
    bad += survived.length + notRun.length;
    console.log(`${f}: ${survived.length} survived, ${notRun.length} not run`);
    for (const s of survived) console.log(`  SURVIVED ${s}`);
    for (const m of notRun) console.log(`  NOT RUN  ${m}`);
  }
  console.log(`${files.length} machine(s) reported`);
  process.exit(bad ? 1 : 0);
}
