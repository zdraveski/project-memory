#!/usr/bin/env node
// Fuzz: random, hostile conversations and notes through the real hooks and
// the memory CLI, and the rules that hold whatever they hold. The reviews of
// 2026-10-29/30 found their bugs by reading for input like this (a BOM, CRLF,
// half an emoji, a quoted forget, a clock moved to another zone); this looks
// for the next one by itself. A round is its seed: a failing one is printed,
// replays exactly (--seed N), and becomes a test.
//
// A round: notes (a BOM, CRLF, half an emoji, hand-written and doubled index
// lines); an older conversation already on disk for the journal to take in;
// one or two conversations, a Stop after each turn in a random time zone,
// sometimes two Stops at once; transcripts that open with 600 KB (read in
// part), a last line half written, a broken line; <private> secrets, forget
// turns in three spellings, <private-session> marks; the compaction gate; the
// CLI's status, search, show and forget, and a `forget --key ... --yes`.
// What must hold: every hook and command exits as it should; no private or
// forgotten text is written, briefed or printed; a private conversation leaves
// nothing; every other exchange is in handoff.md once and in the journal once;
// every note keeps its text and one index line; repeating the last Stop
// settles within four.
// Run: node fuzz.mjs [seconds, default 60] [--seed N]
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, existsSync, utimesSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tool, tempHome, storeFor } from './harness.mjs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--seed') ?? 60);
const only = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
const { home } = tempHome('fuzz-');
const TIER = tool('memory-tier.mjs'), LOG = tool('handoff-log.mjs'), GATE = tool('compact-gate.mjs'), CLI = tool('memory.mjs');

// mulberry32: a seed replays its round exactly.
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// What broke something before, and its neighbours.
const PIECES = ['\uFEFF', '\r\n', '\n', '\u2028', '\u0085', '\uD83D', '\uDE00', '\u{1F600}', '\u{1F469}\u200D\u{1F4BB}', '\u212A', 'e\u0301', '"', "'", '`', '```', '---', '<!-- auto:end -->',
  '<!-- auto:start -->', '- [x](y.md) — z', '**asked**', '&lt;', '<system-reminder>', '</system-reminder>', '%s', '$&', '\t', '    ', '请修复（登录）', '…', '(', '[', '*', '\\'];
const WORDS = ['deploy', 'the', 'fix', 'plan', 'logo', 'tests', 'continue', 'why', 'ok', 'run', 'notes', 'branch'];
const ZONES = ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Chatham'];
const FORGET = ["node memory.mjs forget x", "node \"C:/x/memory.mjs\" 'forget' 'x'", 'node memory.mjs --store "C:/s" "forget" x',
  "node \"C:/x/memory.mjs\" '--shared' 'forget' 'x' --session y", 'node memory.mjs --limit -5 forget x', 'node memory.mjs --conversation= forget x'];
const LINE_ENDS = /[\r\n\u2028\u0085]/g;

// A process, as Claude Code runs a hook: its input on stdin, cut off at 30 s.
const run = (file, argv, input, tz) => new Promise((done) => {
  const c = spawn(process.execPath, [file, ...argv], { env: { ...process.env, TZ: tz } });
  let out = '', err = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { err += b; });
  const timer = setTimeout(() => c.kill(), 30000);
  c.on('close', (status, signal) => { clearTimeout(timer); done({ status, signal, out, err }); });
  c.stdin.on('error', () => {});
  c.stdin.end(input ?? '');
});

async function round(seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const text = (n) => Array.from({ length: n }, () => (r() < 0.6 ? pick(WORDS) : pick(PIECES))).join(r() < 0.5 ? ' ' : '');
  const u = seed >>> 0, hex = u.toString(16).padStart(6, '0').slice(-6);
  const cwd = `C:\\fuzz-${u}`, dir = storeFor(home, cwd), proj = dirname(dir), problems = [];
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 3 * 86400_000);

  // Notes, some with a hand-written index line, some twice.
  const notes = new Map(), index = ['# Index', ''];
  for (let i = 0, n = int(0, 6); i < n; i++) {
    const name = `note-${u}-${i}`, eol = r() < 0.3 ? '\r\n' : '\n';
    const body = `${r() < 0.2 ? '\uFEFF' : ''}---\nname: ${name}\ndescription: "${text(int(1, 8)).replace(/["\r\n\u2028\u0085]/g, ' ')}"\nmetadata:\n  type: project\n${r() < 0.2 ? '  tier: hot\n' : ''}---\n\n${text(int(1, 40))}\n`.replace(/\n/g, eol);
    writeFileSync(join(dir, `${name}.md`), body);
    utimesSync(join(dir, `${name}.md`), old, old);
    // As the disk holds it: half an emoji is written as U+FFFD.
    notes.set(`${name}.md`, readFileSync(join(dir, `${name}.md`), 'utf8'));
    if (r() < 0.5) for (let k = 0, m = r() < 0.2 ? 2 : 1; k < m; k++) index.push(`- [${name}](${name}.md) — ${text(int(1, 5)).replace(LINE_ENDS, ' ')}`);
  }
  for (let i = 0, n = int(0, 3); i < n; i++) index.push(text(int(1, 6)).replace(LINE_ENDS, ' '));
  writeFileSync(join(dir, 'MEMORY.md'), index.join('\n') + '\n');
  utimesSync(join(dir, 'MEMORY.md'), old, old);

  const secrets = [], marks = new Map(), forgotten = new Set(), log = [];
  const rec = (s, type, ts, content, uuid) => JSON.stringify({ type, uuid, sessionId: s.id, cwd, timestamp: ts,
    message: type === 'user' ? { role: 'user', content } : { role: 'assistant', content, stop_reason: 'end_turn', usage: { input_tokens: 1000 } } });

  // An older conversation already on disk: the journal takes it in.
  if (r() < 0.3) {
    const s = { id: `o${hex}0-${int(1000, 9999)}` }, lines = [];
    for (let i = 0, n = int(1, 3); i < n; i++) {
      const ts = new Date(Date.UTC(2026, 9, 20, 9, i)).toISOString(), mark = `OLD${u}n${i}`;
      let ask = `${mark} ${text(int(1, 6))}`, did = `done ${text(int(1, 10))}`;
      if (r() < 0.4) { const sec = `ZQXO${u}n${i}`; secrets.push(sec); ask = `<private>${sec}</private> ${ask}`; did = `${did} ${sec}`; }
      marks.set(mark, { kind: 'old' });
      lines.push(rec(s, 'user', ts, ask, `uo-${u}-${i}`), rec(s, 'assistant', ts, [{ type: 'text', text: did }], `ao-${u}-${i}`));
    }
    writeFileSync(join(proj, `${s.id}.jsonl`), lines.join('\n') + '\n');
  }

  // One or two conversations; distinct 8-character tags.
  const sessions = Array.from({ length: int(1, 2) }, (_, k) => ({ id: `f${k}${hex}-${int(1000, 9999)}`, private: false, did: '', rest: '', n: 0 }));
  let clock = Date.UTC(2026, 9, 30, 8, 0, 0);
  for (const s of sessions) {
    s.t = join(proj, `${s.id}.jsonl`);
    // Opened with 600 KB, a Stop reads it in part.
    const big = r() < 0.25;
    log.push(`${s.id}${big ? ': opens with 600 KB' : ''}`);
    writeFileSync(s.t, big ? JSON.stringify({ type: 'user', sessionId: s.id, cwd, timestamp: new Date(clock).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(600_000) }] } }) + '\n' : '');
  }
  const turn = (s) => {
    if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; }
    clock += int(1, 90) * 60_000;
    const i = s.n++, ts = new Date(clock).toISOString(), mark = `ASK${u}${s.id[1]}n${i}`, kind = r(), tools = [];
    let ask = `${mark} ${text(int(1, 12))}`, kindName = 'plain';
    s.did = `done ${text(int(1, 30))}`;
    if (kind < 0.15) { const sec = `ZQXP${u}${s.id[1]}n${i}`; secrets.push(sec); ask = `${pick(['<private>', '<PRIVATE>', '<private reason="x">'])}${sec}</private> ${ask}`; s.did = `${s.did} ${sec}`; }
    else if (kind < 0.25) { const sec = `ZQXF${u}${s.id[1]}n${i}`; secrets.push(sec); ask = `${ask} ${sec}`; s.did = `${s.did} ${sec}`; kindName = 'forget'; tools.push({ type: 'tool_use', id: `f${i}`, name: 'Bash', input: { command: pick(FORGET) } }); }
    else if (kind < 0.3) { ask = `<private-session> ${ask}`; s.private = true; }
    const uuid = `u-${u}-${s.id[1]}-${i}`;
    marks.set(mark, { kind: kindName, s, uuid });
    // As Claude Code writes a turn: a tool call and its result on lines of their
    // own, when it runs, before the answer; only the answer can be half written.
    const user = [rec(s, 'user', ts, r() < 0.5 ? ask : [{ type: 'text', text: ask }], uuid),
      ...tools.flatMap((tu) => [rec(s, 'assistant', new Date(clock + 10_000).toISOString(), [tu], `t-${u}-${s.id[1]}-${i}`),
        rec(s, 'user', new Date(clock + 20_000).toISOString(), [{ type: 'tool_result', tool_use_id: tu.id, content: 'removed 0' }], `r-${u}-${s.id[1]}-${i}`)])].join('\n');
    const asst = rec(s, 'assistant', new Date(clock + 30_000).toISOString(), [{ type: 'text', text: s.did }], `a-${u}-${s.id[1]}-${i}`);
    // A Stop may come while the answer's line is half written; it is finished before the next turn.
    const half = r() < 0.1, broken = !half && r() < 0.05;
    log.push(`turn ${mark} ${kindName}${ask.startsWith('<private-session>') ? ' <private-session>' : ''} at ${ts}${half ? ', answer half written' : ''}${broken ? ', then a broken line' : ''}`);
    if (half) { const cut = Math.floor(asst.length / 2); appendFileSync(s.t, `${user}\n${asst.slice(0, cut)}`); s.rest = `${asst.slice(cut)}\n`; }
    else appendFileSync(s.t, `${user}\n${asst}\n${broken ? '{"type":"user","message":\n' : ''}`);
  };
  const stop = async (s, tz) => {
    log.push(`stop ${s.id} TZ=${tz}`);
    const p = await run(TIER, ['--stop'], JSON.stringify({ cwd, transcript_path: s.t, session_id: s.id, hook_event_name: 'Stop', last_assistant_message: s.did }), tz);
    if (p.status !== 0) problems.push(`the Stop hook (${s.id}, TZ=${tz}) exited ${p.status ?? p.signal}: ${p.err.trim().split('\n').slice(-2).join(' | ')}`);
  };
  for (let step = 0, n = int(1, 6); step < n; step++) {
    const tz = pick(ZONES);
    if (sessions.length === 2 && r() < 0.3) { sessions.forEach(turn); log.push('both Stops at once:'); await Promise.all(sessions.map((s) => stop(s, tz))); }
    else { const s = pick(sessions); turn(s); await stop(s, tz); }
    if (r() < 0.15) {
      const s = pick(sessions), g = await run(GATE, [], JSON.stringify({ cwd, transcript_path: s.t, session_id: s.id, hook_event_name: 'PreCompact', trigger: pick(['auto', 'manual']) }), tz);
      if (g.status !== 0 && g.status !== 2) problems.push(`the compaction gate exited ${g.status ?? g.signal}: ${g.err.trim().split('\n').slice(-1)}`);
      for (const sec of secrets) if ((g.out + g.err).includes(sec)) problems.push(`the compaction gate printed private text ${sec}`);
    }
  }
  for (const s of sessions) if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; }

  // The CLI: every command exits 0 or 1, prints no stack and no private text.
  const tz = pick(ZONES), arg = () => text(int(1, 3)).replace(/[\uD800-\uDFFF\r\n\u2028\u0085\0]/g, ' ').trim() || 'x';
  const cli = async (...a) => {
    const c = await run(CLI, [...a, '--store', dir], '', tz);
    if (c.status !== 0 && c.status !== 1) problems.push(`memory.mjs ${a.join(' ')} exited ${c.status ?? c.signal}: ${c.err.trim().split('\n').slice(-1)}`);
    else if (/\n\s+at /.test(c.err)) problems.push(`memory.mjs ${a.join(' ')} threw: ${c.err.trim().split('\n')[0]}`);
    for (const sec of secrets) if (c.out.includes(sec)) problems.push(`memory.mjs ${a[0]} printed private text ${sec}`);
    return c;
  };
  await cli('status');
  await cli('search', pick(WORDS));
  await cli('search', arg(), arg());
  await cli('show', pick([...marks.values()].map((m) => m.uuid).filter(Boolean).concat('no-such-key')));
  await cli('forget', arg());
  // A forget by key, then the conversation's next Stop: the exchange stays out.
  const plain = [...marks].filter(([, m]) => m.kind === 'plain' && !m.s.private);
  if (plain.length && r() < 0.4) {
    const [mark, m] = pick(plain);
    log.push(`forget --key ${m.uuid} --yes (${mark})`);
    const c = await cli('forget', '--key', m.uuid, '--yes');
    if (c.status !== 0) problems.push(`forget --key ${m.uuid} --yes exited ${c.status}: ${c.out.trim().split('\n').slice(-1)}`);
    forgotten.add(mark);
    await stop(m.s, tz);
  }

  // The last Stops again, nothing new: the store settles.
  const files = () => {
    const out = new Map();
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.set(f, readFileSync(join(dir, f), 'utf8'));
    if (existsSync(join(dir, 'journal'))) for (const f of readdirSync(join(dir, 'journal'))) if (f.endsWith('.md')) out.set(`journal/${f}`, readFileSync(join(dir, 'journal', f), 'utf8'));
    return out;
  };
  let before = files(), settled = false;
  for (let k = 0; k < 4 && !settled; k++) {
    for (const s of sessions) await stop(s, tz);
    const after = files();
    settled = after.size === before.size && [...after].every(([f, s]) => before.get(f) === s);
    before = after;
  }
  if (!settled) problems.push('repeating the last Stop never settled: a file changed on each of four');
  // A hook exits 0 whatever happens, and says what failed in a file: none may
  // be there. Not .health: it names what is wrong with the store (a hand-written
  // line pointing at no file), which hostile notes are meant to make.
  for (const f of readdirSync(dirname(proj)).filter((n) => n.startsWith('.handoff-failed-'))) problems.push(`${f}: ${readFileSync(join(dirname(proj), f), 'utf8').trim().slice(0, 300)}`);
  if (existsSync(join(dir, 'journal', '.failed'))) problems.push(`journal/.failed: ${readFileSync(join(dir, 'journal', '.failed'), 'utf8').trim().slice(0, 300)}`);
  const after = before;
  const brief = await run(LOG, ['--print'], JSON.stringify({ cwd, session_id: sessions[0].id, source: pick(['startup', 'resume', 'compact', 'clear']) }), tz);
  if (brief.status !== 0) problems.push(`the startup briefing exited ${brief.status ?? brief.signal}`);

  // What was written: no secret, nothing forgotten, nothing of a private conversation.
  const handoff = after.get('handoff.md') ?? '', journal = [...after].filter(([f]) => f.startsWith('journal/')).map(([, s]) => s).join('\n');
  const places = [...[...after].filter(([f]) => f === 'handoff.md' || f.startsWith('journal/') || f.startsWith('MEMORY')), ['the briefing', brief.out]];
  const count = (hay, w) => hay.split(w).length - 1;
  for (const sec of secrets) for (const [f, body] of places) if (body.includes(sec)) problems.push(`private text ${sec} is in ${f}`);
  for (const [mark, m] of marks) {
    const gone = m.kind === 'forget' || m.s?.private || forgotten.has(mark), why = m.kind === 'forget' ? 'a turn that ran forget' : m.s?.private ? 'a <private-session> conversation' : 'an exchange forget --key removed';
    if (gone) { for (const [f, body] of places) if (body.includes(mark)) problems.push(`${why}: ${mark} is in ${f}`); }
    else if (m.kind === 'old') { if (count(journal, mark) > 1) problems.push(`${mark} is in the journal ${count(journal, mark)} times`); }
    else {
      if (count(handoff, mark) !== 1) problems.push(`${mark} is in handoff.md ${count(handoff, mark)} times`);
      if (count(journal, mark) !== 1) problems.push(`${mark} is in the journal ${count(journal, mark)} times`);
    }
  }
  // Every note kept as written, with one index line.
  const lines = `${after.get('MEMORY.md') ?? ''}\n${after.get('MEMORY-archive.md') ?? ''}`;
  for (const [f, body] of notes) {
    if (!existsSync(join(dir, f))) { problems.push(`${f} is gone`); continue; }
    const now = readFileSync(join(dir, f), 'utf8');
    let k = 0; while (k < body.length && body[k] === now[k]) k++;
    if (now !== body) problems.push(`${f} was rewritten, from character ${k}: ${JSON.stringify(body.slice(Math.max(0, k - 20), k + 40))} -> ${JSON.stringify(now.slice(Math.max(0, k - 20), k + 40))}`);
    const n = lines.split('\n').filter((l) => l.includes(`](${f})`)).length;
    if (n !== 1) problems.push(`${f} has ${n} index lines`);
  }
  // What happened, for the one who replays it: every step, repeats too. With
  // FUZZ_KEEP=<folder>, a failing round's project folder is kept there.
  const found = [...new Set(problems)];
  if (found.length && process.env.FUZZ_KEEP) cpSync(proj, join(process.env.FUZZ_KEEP, `round-${u}`), { recursive: true });
  return { found, story: ['--- the round:', ...log, '--- handoff.md entries:', ...handoff.split('\n').filter((l) => l.startsWith('- **asked**')).map((l) => l.slice(0, 120))] };
}

// --keep-going: every failing round named, not just the first (a bug hunt);
// the story of each is in its replay.
const keepGoing = args.includes('--keep-going'), start = Date.now(), first = only ?? Math.floor(Math.random() * 2 ** 31);
let rounds = 0, failed = 0;
for (let seed = first; only === null ? Date.now() - start < seconds * 1000 : rounds < 1; seed++) {
  rounds++;
  const { found, story } = await round(seed);
  if (!found.length) continue;
  failed++;
  console.log(`fuzz: round ${seed} failed (replay: node fuzz.mjs --seed ${seed}):`);
  for (const p of keepGoing ? found : [...found, ...story]) console.log(`  ${p}`);
  if (!keepGoing) break;
}
// Not process.exit(): a pipe's output can be cut short (CONTRIBUTING).
console.log(failed ? `fuzz: ${failed} of ${rounds} round(s) failed` : `fuzz: ${rounds} round(s) from seed ${first} held, ${Math.round((Date.now() - start) / 1000)} s`);
process.exitCode = failed ? 1 : 0;
