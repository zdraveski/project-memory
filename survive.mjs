// What survives a compaction: which facts of a session the print after a compaction (SessionStart, source
// compact) still carries, and which only the journal keeps. Model-free, after KEEP-Bench (arXiv 2610.26827):
// every fact is a unique token, found or not by string match, and an exchange counts only if all of its
// facts survive. A synthetic transcript under a throwaway HOME: no real memory is read.
// Run: node survive.mjs   (prints the table; exits 1 if the journal loses a fact, or the print loses one
// it promises to keep: the start of an ask or an answer of an exchange it shows)
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tool, tempHome, storeFor } from './harness.mjs';

const { home, env } = tempHome('survive-');
const { handoff, parse } = await import('./handoff-log.mjs');
const { entryOf, render, parseDay } = await import('./journal.mjs');
const cwd = 'C:\\survive-project', dir = storeFor(home, cwd), t = join(dir, 'ssssssss.jsonl');
mkdirSync(dir, { recursive: true });

const N = 15, ASK_AT = [0, 600], DID_AT = [0, 400, 850, 1200, 3000];
// A fact is a token; a qualified one ends in its qualifier, which a cut between the two would drop and leave
// the rest wrong ("deploy" without "only on Windows"): that half-kept case is counted on its own.
// Each ends in `END`, so a token the print cut short (`QUALQ1…` from `QUALQ10END`) never passes for another.
const fact = (k) => `FACT${k}END`, qual = (k) => `QUAL${k}END`;
const fill = (n) => 'the build ran and the log was long '.repeat(Math.ceil(n / 35)).slice(0, n);
// Text with each token at (about) its offset, filler between.
const place = (marks, len) => {
  let s = '';
  for (const [at, tok] of marks) { s += fill(Math.max(0, at - s.length)) + ` ${tok} `; }
  return s + fill(Math.max(0, len - s.length));
};
const t0 = Date.now() - (N + 1) * 60e3, iso = (i, s = 0) => new Date(t0 + i * 60e3 + s * 1e3).toISOString();
const rec = (type, text, ts) => JSON.stringify({ type, timestamp: ts, message: { content: [{ type: 'text', text }] } });
const turns = [];
for (let i = 1; i <= N; i++) {
  const ask = place(ASK_AT.map((o) => [o, fact(`A${i}@${o}`)]), 900);
  // The qualifier rides just past the answer's limit: 880 + the fact, then `only on Windows QUAL`.
  const did = place([...DID_AT.map((o) => [o, fact(`D${i}@${o}`)]), [870, `${fact(`Q${i}`)} only on Windows ${qual(`Q${i}`)}`]].sort((a, b) => a[0] - b[0]), 3200);
  turns.push({ i, ask, did });
}
writeFileSync(t, turns.flatMap(({ i, ask, did }) => [rec('user', ask, iso(i)), rec('assistant', did, iso(i, 30))]).join('\n') + '\n');
handoff({ cwd, transcript_path: t, session_id: 'ssssssss-1' });
const print = execFileSync(process.execPath, [tool('handoff-log.mjs'), '--print'], { input: JSON.stringify({ cwd, session_id: 'ssssssss-2', source: 'compact' }), env }).toString();
const journal = turns.map(({ i, ask, did }) => {
  const d = parseDay(render(entryOf({ ask, did, at: iso(i).slice(0, 16).replace('T', ' '), changed: [], ran: [] }, t)));
  return `${d.entries[0]?.asked} ${d.entries[0]?.answered}`;
}).join('\n');
const shown = parse(readFileSync(join(dir, 'handoff.md'), 'utf8')).length;

const has = (text, tok) => text.includes(tok);
const toks = (i) => [...ASK_AT.map((o) => fact(`A${i}@${o}`)), ...DID_AT.map((o) => fact(`D${i}@${o}`)), fact(`Q${i}`), qual(`Q${i}`)];
const head = ['ask@0', 'ask@600', ...DID_AT.map((o) => `ans@${o}`), 'fact', 'qual'];
const rows = [];
let broken = [], half = 0, allPrint = 0;
for (const { i } of turns) {
  const inPrint = toks(i).map((k) => has(print, k)), inJournal = toks(i).map((k) => has(journal, k));
  if (inPrint.every(Boolean)) allPrint++;
  if (inPrint[7] && !inPrint[8]) half++;
  const back = N - i;   // 0: the newest exchange
  if (inJournal.some((x) => !x)) broken.push(`journal lost a fact of exchange ${back} back`);
  // Promised: an exchange the print shows keeps the start of its ask and of its answer.
  if (inPrint.some(Boolean) && !(inPrint[0] && inPrint[2])) broken.push(`print lost the start of exchange ${back} back`);
  rows.push(`${String(back).padStart(4)}  ${inPrint.map((x) => (x ? 'kept' : '-')).map((s) => s.padEnd(8)).join('')}${inJournal.every(Boolean) ? 'all' : 'LOST'}`);
}
console.log(`Exchanges in handoff.md: ${shown}. Kept whole by the print after a compaction (all facts): ${allPrint} of ${N}.`);
console.log(`Fact kept but its qualifier cut off: ${half} of ${N}.\n`);
console.log(`back  ${head.map((h) => h.padEnd(8)).join('')}journal`);
console.log(rows.reverse().join('\n'));
rmSync(home, { recursive: true, force: true });
if (broken.length) { console.error(`\n${broken.join('\n')}`); process.exit(1); }
