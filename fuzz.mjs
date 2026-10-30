#!/usr/bin/env node
// Fuzz: random, hostile conversations and notes through the real hooks, and
// the rules that hold whatever they hold. The reviews of 2026-10-29/30 found
// their bugs by reading for input like this (a BOM, CRLF, half an emoji, a
// quoted forget, a clock moved to another zone); this looks for the next one
// by itself. A round is its seed: a failing one is printed, replays exactly
// (--seed N), and becomes a test.
// Run: node fuzz.mjs [seconds, default 60] [--seed N]
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tool, tempHome, storeFor } from './harness.mjs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--seed') ?? 60);
const only = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
const { home } = tempHome('fuzz-');
const TIER = tool('memory-tier.mjs'), LOG = tool('handoff-log.mjs');

// mulberry32: a seed replays its round exactly.
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// What broke something before, and its neighbours.
const PIECES = ['\uFEFF', '\r\n', '\n', '\u2028', '\u0085', '\uD83D', '\uDE00', '\u{1F600}', '\u{1F469}\u200D\u{1F4BB}', '\u212A', 'e\u0301', '"', "'", '`', '```', '---', '<!-- auto:end -->',
  '<!-- auto:start -->', '- [x](y.md) — z', '**asked**', '&lt;', '<system-reminder>', '</system-reminder>', '%s', '$&', '\t', '    ', '请修复（登录）', '…'];
const WORDS = ['deploy', 'the', 'fix', 'plan', 'logo', 'tests', 'continue', 'why', 'ok', 'run', 'notes', 'branch'];
const ZONES = ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Chatham'];
const FORGET = ["node memory.mjs forget x", "node \"C:/x/memory.mjs\" 'forget' 'x'", 'node memory.mjs --store "C:/s" "forget" x'];

function round(seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const text = (n) => Array.from({ length: n }, () => (r() < 0.6 ? pick(WORDS) : pick(PIECES))).join(r() < 0.5 ? ' ' : '');
  const cwd = `C:\\fuzz-${seed}`, dir = storeFor(home, cwd), proj = dirname(dir), problems = [];
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 3 * 86400_000);

  // Notes, some with a hand-written index line, some twice.
  const notes = new Map(), index = ['# Index', ''];
  for (let i = 0, n = int(0, 6); i < n; i++) {
    const name = `note-${seed}-${i}`, eol = r() < 0.3 ? '\r\n' : '\n';
    const body = `${r() < 0.2 ? '\uFEFF' : ''}---\nname: ${name}\ndescription: "${text(int(1, 8)).replace(/["\r\n\u2028\u0085]/g, ' ')}"\nmetadata:\n  type: project\n${r() < 0.2 ? '  tier: hot\n' : ''}---\n\n${text(int(1, 40))}\n`.replace(/\n/g, eol);
    writeFileSync(join(dir, `${name}.md`), body);
    utimesSync(join(dir, `${name}.md`), old, old);
    // As the disk holds it: half an emoji is written as U+FFFD.
    notes.set(`${name}.md`, readFileSync(join(dir, `${name}.md`), 'utf8'));
    if (r() < 0.5) for (let k = 0, m = r() < 0.2 ? 2 : 1; k < m; k++) index.push(`- [${name}](${name}.md) — ${text(int(1, 5)).replace(/[\r\n\u2028\u0085]/g, ' ')}`);
  }
  for (let i = 0, n = int(0, 3); i < n; i++) index.push(text(int(1, 6)).replace(/[\r\n\u2028\u0085]/g, ' '));
  writeFileSync(join(dir, 'MEMORY.md'), index.join('\n') + '\n');
  utimesSync(join(dir, 'MEMORY.md'), old, old);

  // A conversation, a Stop after each turn, the clock moving zones between them.
  const session = `fz${(seed >>> 0).toString(16).padStart(6, '0').slice(-6)}-${int(1000, 9999)}`, t = join(proj, `${session}.jsonl`);
  const secrets = [], asks = [];
  let clock = Date.UTC(2026, 9, 30, 8, 0, 0), sessionPrivate = false, did = '';
  const stop = (tz) => {
    const p = spawnSync(process.execPath, [TIER, '--stop'], { input: JSON.stringify({ cwd, transcript_path: t, session_id: session, hook_event_name: 'Stop', last_assistant_message: did }), env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 30000 });
    if (p.status !== 0) problems.push(`the Stop hook (TZ=${tz}) exited ${p.status ?? p.signal}: ${String(p.stderr).trim().split('\n').slice(-2).join(' | ')}`);
  };
  writeFileSync(t, '');
  for (let i = 0, n = int(1, 6); i < n; i++) {
    clock += int(1, 90) * 60_000;
    const ts = new Date(clock).toISOString(), mark = `ASK${seed >>> 0}n${i}`, kind = r(), tools = [];
    let ask = `${mark} ${text(int(1, 12))}`;
    did = text(int(1, 30));
    if (kind < 0.15) { const s = `ZQXP${seed >>> 0}n${i}`; secrets.push(s); ask = `${pick(['<private>', '<PRIVATE>', '<private reason="x">'])}${s}</private> ${ask}`; did = `${did} ${s}`; }
    else if (kind < 0.25) { const s = `ZQXF${seed >>> 0}n${i}`; secrets.push(s); ask = `${ask} ${s}`; did = `${did} ${s}`; tools.push({ type: 'tool_use', id: `f${i}`, name: 'Bash', input: { command: pick(FORGET) } }); }
    else if (kind < 0.3) { ask = `<private-session> ${ask}`; sessionPrivate = true; }
    asks.push(mark);
    const user = { type: 'user', uuid: `u-${seed >>> 0}-${i}`, sessionId: session, cwd, timestamp: ts, message: { role: 'user', content: r() < 0.5 ? ask : [{ type: 'text', text: ask }] } };
    const asst = { type: 'assistant', uuid: `a-${seed >>> 0}-${i}`, sessionId: session, cwd, timestamp: new Date(clock + 30_000).toISOString(), message: { role: 'assistant', content: [...tools, { type: 'text', text: did }], stop_reason: 'end_turn', usage: { input_tokens: 1000 } } };
    appendFileSync(t, `${JSON.stringify(user)}\n${JSON.stringify(asst)}\n`);
    stop(pick(ZONES));
  }
  // The last Stop again, as nothing new happened: nothing may change.
  const tz = pick(ZONES);
  stop(tz);
  const files = () => {
    const out = new Map();
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.set(f, readFileSync(join(dir, f), 'utf8'));
    if (existsSync(join(dir, 'journal'))) for (const f of readdirSync(join(dir, 'journal'))) if (f.endsWith('.md')) out.set(`journal/${f}`, readFileSync(join(dir, 'journal', f), 'utf8'));
    return out;
  };
  const before = files();
  stop(tz);
  const after = files();
  for (const [f, s] of after) if (before.get(f) !== s) problems.push(`a second Stop with nothing new changed ${f}`);
  const brief = spawnSync(process.execPath, [LOG, '--print'], { input: JSON.stringify({ cwd, session_id: session, source: 'startup' }), env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 30000 });
  if (brief.status !== 0) problems.push(`the startup briefing exited ${brief.status ?? brief.signal}`);

  // What was written: no secret, nothing of a private conversation.
  const written = [...after].filter(([f]) => f === 'handoff.md' || f.startsWith('journal/') || f.startsWith('MEMORY'));
  for (const s of secrets) for (const [f, body] of [...written, ['the startup briefing', brief.stdout ?? '']]) if (body.includes(s)) problems.push(`private text ${s} is in ${f}`);
  if (sessionPrivate) for (const a of asks) for (const [f, body] of [...written, ['the startup briefing', brief.stdout ?? '']]) if (body.includes(a)) problems.push(`a conversation marked <private-session> left ${a} in ${f}`);
  // No turn listed twice.
  const handoff = after.get('handoff.md') ?? '';
  for (const a of asks) if ((handoff.match(new RegExp(`\\b${a}\\b`, 'g')) ?? []).length > 1) problems.push(`${a} is listed ${handoff.match(new RegExp(`\\b${a}\\b`, 'g')).length} times in handoff.md`);
  // Every note kept as written, with one index line.
  const lines = `${after.get('MEMORY.md') ?? ''}\n${after.get('MEMORY-archive.md') ?? ''}`;
  for (const [f, body] of notes) {
    if (!existsSync(join(dir, f))) problems.push(`${f} is gone`);
    else {
      const now = readFileSync(join(dir, f), 'utf8');
      let k = 0; while (k < body.length && body[k] === now[k]) k++;
      if (now !== body) problems.push(`${f} was rewritten, from character ${k}: ${JSON.stringify(body.slice(Math.max(0, k - 20), k + 40))} -> ${JSON.stringify(now.slice(Math.max(0, k - 20), k + 40))}`);
    }
    const n = lines.split('\n').filter((l) => l.includes(`](${f})`)).length;
    if (n !== 1) problems.push(`${f} has ${n} index lines`);
  }
  return problems;
}

const start = Date.now(), first = only ?? Math.floor(Math.random() * 2 ** 31);
let rounds = 0;
for (let seed = first; only === null ? Date.now() - start < seconds * 1000 : rounds < 1; seed++) {
  rounds++;
  const problems = round(seed);
  if (problems.length) {
    console.log(`fuzz: round ${seed} failed (replay: node fuzz.mjs --seed ${seed}):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
}
console.log(`fuzz: ${rounds} round(s) from seed ${first} held, ${Math.round((Date.now() - start) / 1000)} s`);
