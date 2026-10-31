#!/usr/bin/env node
// Fuzz: random, hostile conversations and notes through the real hooks and
// the memory CLI, and the rules that hold whatever they hold. The reviews of
// 2026-10-29/30 found their bugs by reading for input like this (a BOM, CRLF,
// half an emoji, a quoted forget, a clock moved to another zone); this looks
// for the next one by itself. A round is its seed: generate(seed) decides it
// as steps, all its randomness spent there, and execute(steps) runs them. A
// failing round is printed, shrunk to the steps it still fails with, replays
// exactly (--seed N), and becomes a test.
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
// Run: node fuzz.mjs [seconds, default 60] [--seed N] [--keep-going] [--no-shrink]
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, existsSync, utimesSync, cpSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tool, tempHome, storeFor } from './harness.mjs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--seed') ?? 60);
const only = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
const homes = tempHome('fuzz-').home, kept = new Set();
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

// A round as steps, each { type, ... } with its content decided: every random
// choice is made here, so the same steps run the same way again.
function generate(seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const text = (n) => Array.from({ length: n }, () => (r() < 0.6 ? pick(WORDS) : pick(PIECES))).join(r() < 0.5 ? ' ' : '');
  const u = seed >>> 0, hex = u.toString(16).padStart(6, '0').slice(-6), cwd = `C:\\fuzz-${u}`, steps = [];

  // Notes, some with a hand-written index line, some twice.
  const index = [];
  for (let i = 0, n = int(0, 6); i < n; i++) {
    const name = `note-${u}-${i}`, eol = r() < 0.3 ? '\r\n' : '\n';
    const body = `${r() < 0.2 ? '\uFEFF' : ''}---\nname: ${name}\ndescription: "${text(int(1, 8)).replace(/["\r\n\u2028\u0085]/g, ' ')}"\nmetadata:\n  type: project\n${r() < 0.2 ? '  tier: hot\n' : ''}---\n\n${text(int(1, 40))}\n`.replace(/\n/g, eol);
    steps.push({ type: 'note', name, body });
    if (r() < 0.5) for (let k = 0, m = r() < 0.2 ? 2 : 1; k < m; k++) index.push(`- [${name}](${name}.md) — ${text(int(1, 5)).replace(LINE_ENDS, ' ')}`);
  }
  for (let i = 0, n = int(0, 3); i < n; i++) index.push(text(int(1, 6)).replace(LINE_ENDS, ' '));
  steps.push({ type: 'index', lines: index });

  // An older conversation already on disk: the journal takes it in.
  if (r() < 0.3) {
    const st = { type: 'old', id: `o${hex}0-${int(1000, 9999)}`, exchanges: [] };
    for (let i = 0, n = int(1, 3); i < n; i++) {
      const mark = `OLD${u}n${i}`, x = { mark, ask: `${mark} ${text(int(1, 6))}`, did: `done ${text(int(1, 10))}` };
      if (r() < 0.4) { x.secret = `ZQXO${u}n${i}`; x.ask = `<private>${x.secret}</private> ${x.ask}`; x.did = `${x.did} ${x.secret}`; }
      st.exchanges.push(x);
    }
    steps.push(st);
  }

  // One or two conversations; distinct 8-character tags. Opened with 600 KB, a Stop reads it in part.
  const sessions = Array.from({ length: int(1, 2) }, (_, k) => ({ id: `f${k}${hex}-${int(1000, 9999)}`, private: false, n: 0 }));
  for (const s of sessions) steps.push({ type: 'session', id: s.id, big: r() < 0.25 });
  const marks = new Map();
  let clock = Date.UTC(2026, 9, 30, 8, 0, 0);
  const turn = (s) => {
    clock += int(1, 90) * 60_000;
    const i = s.n++, mark = `ASK${u}${s.id[1]}n${i}`, kind = r();
    const st = { type: 'turn', s: s.id, at: clock, mark, uuid: `u-${u}-${s.id[1]}-${i}`, kind: 'plain', ask: `${mark} ${text(int(1, 12))}`, did: `done ${text(int(1, 30))}` };
    if (kind < 0.15) { st.secret = `ZQXP${u}${s.id[1]}n${i}`; st.ask = `${pick(['<private>', '<PRIVATE>', '<private reason="x">'])}${st.secret}</private> ${st.ask}`; st.did = `${st.did} ${st.secret}`; }
    else if (kind < 0.25) { st.secret = `ZQXF${u}${s.id[1]}n${i}`; st.ask = `${st.ask} ${st.secret}`; st.did = `${st.did} ${st.secret}`; st.kind = 'forget'; st.tool = { type: 'tool_use', id: `f${i}`, name: 'Bash', input: { command: pick(FORGET) } }; }
    else if (kind < 0.3) { st.ask = `<private-session> ${st.ask}`; s.private = true; }
    marks.set(mark, { kind: st.kind, s, uuid: st.uuid });
    // The ask as a string or a text block; the answer half written when the Stop comes, or a broken line after it.
    st.block = r() >= 0.5;
    st.half = r() < 0.1;
    st.broken = !st.half && r() < 0.05;
    steps.push(st);
  };
  for (let k = 0, n = int(1, 6); k < n; k++) {
    const tz = pick(ZONES);
    if (sessions.length === 2 && r() < 0.3) { sessions.forEach((s) => turn(s)); steps.push({ type: 'stops', ss: sessions.map((s) => s.id), tz }); }
    else { const s = pick(sessions); turn(s); steps.push({ type: 'stop', s: s.id, tz }); }
    if (r() < 0.15) steps.push({ type: 'gate', s: pick(sessions).id, trigger: pick(['auto', 'manual']), tz });
  }

  // The CLI's status, search, show and forget; a forget by key and the conversation's next Stop.
  const tz = pick(ZONES), arg = () => text(int(1, 3)).replace(/[\uD800-\uDFFF\r\n\u2028\u0085\0]/g, ' ').trim() || 'x';
  for (const a of [['status'], ['search', pick(WORDS)], ['search', arg(), arg()], ['show', pick([...marks.values()].map((m) => m.uuid).concat('no-such-key'))], ['forget', arg()]]) steps.push({ type: 'cli', args: a, tz });
  const plain = [...marks].filter(([, m]) => m.kind === 'plain' && !m.s.private);
  if (plain.length && r() < 0.4) { const [mark, m] = pick(plain); steps.push({ type: 'forgetKey', mark, uuid: m.uuid, s: m.s.id, tz }); }
  return { steps, meta: { u, cwd, tz, briefing: { session: sessions[0].id, source: pick(['startup', 'resume', 'compact', 'clear']) } } };
}

// The steps through the real hooks and the CLI, then the round's end, then what
// must hold. Any list of a round's steps is a whole round: a step whose
// conversation no step opened opens it, and the end is no step, so a shrink
// cannot cut it: every conversation's closing Stop, then the last Stops again.
async function execute(steps, { u, cwd, tz: lastTz, briefing }) {
  // A home of the round's own, made afresh: a replay sees nothing an earlier
  // one left (the shared store included), and the paths it prints are the same.
  const home = join(homes, `r${u}`);
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  process.env.HOME = process.env.USERPROFILE = home;
  const dir = storeFor(home, cwd), proj = dirname(dir), problems = [], log = [];
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 3 * 86400_000);
  const notes = new Map(), secrets = [], marks = new Map(), forgotten = new Set(), sessions = new Map();
  const rec = (s, type, ts, content, uuid) => JSON.stringify({ type, uuid, sessionId: s.id, cwd, timestamp: ts,
    message: type === 'user' ? { role: 'user', content } : { role: 'assistant', content, stop_reason: 'end_turn', usage: { input_tokens: 1000 } } });
  const session = (id) => {
    if (!sessions.has(id)) { sessions.set(id, { id, t: join(proj, `${id}.jsonl`), private: false, did: '', rest: '', turns: 0, stopped: 0 }); writeFileSync(sessions.get(id).t, ''); }
    return sessions.get(id);
  };
  const stop = async (s, tz) => {
    log.push(`stop ${s.id} TZ=${tz}`);
    s.stopped = s.turns;
    const p = await run(TIER, ['--stop'], JSON.stringify({ cwd, transcript_path: s.t, session_id: s.id, hook_event_name: 'Stop', last_assistant_message: s.did }), tz);
    if (p.status !== 0) problems.push(`the Stop hook (${s.id}, TZ=${tz}) exited ${p.status ?? p.signal}: ${p.err.trim().split('\n').slice(-2).join(' | ')}`);
  };
  // The CLI: every command exits 0 or 1, prints no stack and no private text.
  const cli = async (tz, ...a) => {
    const c = await run(CLI, [...a, '--store', dir], '', tz);
    if (c.status !== 0 && c.status !== 1) problems.push(`memory.mjs ${a.join(' ')} exited ${c.status ?? c.signal}: ${c.err.trim().split('\n').slice(-1)}`);
    else if (/\n\s+at /.test(c.err)) problems.push(`memory.mjs ${a.join(' ')} threw: ${c.err.trim().split('\n')[0]}`);
    for (const sec of secrets) if (c.out.includes(sec)) problems.push(`memory.mjs ${a[0]} printed private text ${sec}`);
    return c;
  };
  const files = () => {
    const out = new Map();
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.set(f, readFileSync(join(dir, f), 'utf8'));
    if (existsSync(join(dir, 'journal'))) for (const f of readdirSync(join(dir, 'journal'))) if (f.endsWith('.md')) out.set(`journal/${f}`, readFileSync(join(dir, 'journal', f), 'utf8'));
    return out;
  };
  // A half-written answer is finished before the next turn, or when the conversations are over.
  const finish = () => { for (const s of sessions.values()) if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; } };

  const act = {
    note: ({ name, body }) => {
      const f = join(dir, `${name}.md`);
      log.push(`note ${name}.md`);
      writeFileSync(f, body);
      utimesSync(f, old, old);
      // As the disk holds it: half an emoji is written as U+FFFD.
      notes.set(`${name}.md`, readFileSync(f, 'utf8'));
    },
    index: ({ lines }) => {
      log.push(`MEMORY.md, ${lines.length} line(s)`);
      writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...lines].join('\n') + '\n');
      utimesSync(join(dir, 'MEMORY.md'), old, old);
    },
    old: ({ id, exchanges }) => {
      log.push(`an older conversation ${id}: ${exchanges.map((x) => x.mark).join(' ')}`);
      writeFileSync(join(proj, `${id}.jsonl`), exchanges.map(({ mark, ask, did, secret }, i) => {
        const ts = new Date(Date.UTC(2026, 9, 20, 9, i)).toISOString();
        if (secret) secrets.push(secret);
        marks.set(mark, { kind: 'old' });
        return `${rec({ id }, 'user', ts, ask, `uo-${u}-${i}`)}\n${rec({ id }, 'assistant', ts, [{ type: 'text', text: did }], `ao-${u}-${i}`)}`;
      }).join('\n') + '\n');
    },
    session: ({ id, big }) => {
      log.push(`${id}${big ? ': opens with 600 KB' : ''}`);
      writeFileSync(session(id).t, big ? JSON.stringify({ type: 'user', sessionId: id, cwd, timestamp: new Date(Date.UTC(2026, 9, 30, 8, 0, 0)).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(600_000) }] } }) + '\n' : '');
    },
    turn: (st) => {
      const s = session(st.s), ts = (ms) => new Date(st.at + ms).toISOString();
      if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; }
      if (st.secret) secrets.push(st.secret);
      if (st.ask.startsWith('<private-session>')) s.private = true;
      s.did = st.did;
      marks.set(st.mark, { kind: st.kind, s, turn: ++s.turns });
      // As Claude Code writes a turn: a tool call and its result on lines of their
      // own, when it runs, before the answer; only the answer can be half written.
      const user = [rec(s, 'user', ts(0), st.block ? [{ type: 'text', text: st.ask }] : st.ask, st.uuid),
        ...(st.tool ? [rec(s, 'assistant', ts(10_000), [st.tool], st.uuid.replace('u-', 't-')),
          rec(s, 'user', ts(20_000), [{ type: 'tool_result', tool_use_id: st.tool.id, content: 'removed 0' }], st.uuid.replace('u-', 'r-'))] : [])].join('\n');
      const asst = rec(s, 'assistant', ts(30_000), [{ type: 'text', text: st.did }], st.uuid.replace('u-', 'a-'));
      // A Stop may come while the answer's line is half written; it is finished before the next turn.
      log.push(`turn ${st.mark} ${st.kind}${st.ask.startsWith('<private-session>') ? ' <private-session>' : ''} at ${ts(0)}${st.half ? ', answer half written' : ''}${st.broken ? ', then a broken line' : ''}`);
      if (st.half) { const cut = Math.floor(asst.length / 2); appendFileSync(s.t, `${user}\n${asst.slice(0, cut)}`); s.rest = `${asst.slice(cut)}\n`; }
      else appendFileSync(s.t, `${user}\n${asst}\n${st.broken ? '{"type":"user","message":\n' : ''}`);
    },
    stop: ({ s, tz }) => stop(session(s), tz),
    stops: async ({ ss, tz }) => { log.push('both Stops at once:'); await Promise.all(ss.map((id) => stop(session(id), tz))); },
    gate: async ({ s, trigger, tz }) => {
      log.push(`the compaction gate (${trigger}) for ${s} TZ=${tz}`);
      const g = await run(GATE, [], JSON.stringify({ cwd, transcript_path: session(s).t, session_id: s, hook_event_name: 'PreCompact', trigger }), tz);
      if (g.status !== 0 && g.status !== 2) problems.push(`the compaction gate exited ${g.status ?? g.signal}: ${g.err.trim().split('\n').slice(-1)}`);
      for (const sec of secrets) if ((g.out + g.err).includes(sec)) problems.push(`the compaction gate printed private text ${sec}`);
    },
    cli: (st) => { log.push(`memory.mjs ${st.args.join(' ')}`); return cli(st.tz, ...st.args); },
    // A forget by key, then the conversation's next Stop: the exchange stays out.
    // Only of an exchange a Stop has seen, as in a whole round: a shrunk one can
    // lose the turn or its Stop, and a key not yet saved is no forget.
    forgetKey: async ({ mark, uuid, s, tz }) => {
      const m = marks.get(mark);
      if (!m || m.turn > m.s.stopped) { log.push(`forget --key ${uuid}: not run, no Stop has seen ${mark}`); return; }
      log.push(`forget --key ${uuid} --yes (${mark})`);
      const c = await cli(tz, 'forget', '--key', uuid, '--yes');
      if (c.status !== 0) problems.push(`forget --key ${uuid} --yes exited ${c.status}: ${c.out.trim().split('\n').slice(-1)}`);
      forgotten.add(mark);
      await stop(session(s), tz);
    },
  };
  // A store has its MEMORY.md (a Stop leaves a folder without one alone): with
  // the index step cut, an empty one, as generate makes when it draws no line.
  if (!steps.some((st) => st.type === 'index')) act.index({ lines: [] });
  for (const st of steps) {
    if (!['turn', 'stop', 'stops', 'gate'].includes(st.type)) finish();
    await act[st.type](st);
  }
  finish();
  // The round's end. Each conversation's closing Stop, for a turn no Stop has
  // seen (none in a whole round); with no conversation, one in a fresh one, as
  // a Stop is what indexes the notes. Then the last Stops again, nothing new:
  // the store settles.
  if (!sessions.size) session(briefing.session);
  for (const s of sessions.values()) if (s.turns > s.stopped) await stop(s, lastTz);
  let before = files(), settled = false;
  for (let k = 0; k < 4 && !settled; k++) {
    for (const s of sessions.values()) await stop(s, lastTz);
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
  const after = files();
  const brief = await run(LOG, ['--print'], JSON.stringify({ cwd, session_id: briefing.session, source: briefing.source }), lastTz);
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
  // FUZZ_KEEP=<folder>, a failing round's project folder is kept there as
  // round-<u>, an older copy replaced: its first failing run here, the whole
  // round, not a shrink's replays.
  const found = [...new Set(problems)], keep = process.env.FUZZ_KEEP && join(process.env.FUZZ_KEEP, `round-${u}`);
  if (found.length && keep && !kept.has(u)) { kept.add(u); rmSync(keep, { recursive: true, force: true, maxRetries: 5 }); cpSync(proj, keep, { recursive: true }); }
  return { found, story: ['--- the round:', ...log, '--- handoff.md entries:', ...handoff.split('\n').filter((l) => l.startsWith('- **asked**')).map((l) => l.slice(0, 120))] };
}

// A problem's kind: what it says, its numbers, ids and marks left out.
const kindOf = (problem) => problem.replace(/ASK\w+|OLD\w+|ZQX\w+|[0-9a-f]{6,}|\d+/g, '#');

// The fewest steps found that still fail with a problem of the kind: runs of
// half the steps taken out, then quarters, down to single steps, a cut kept
// when a replay without those steps fails with the kind (delta debugging).
// The kind leaves counts out, so what is left can fail another way (a turn
// listed 0 times, not 3): the whole round's problems are printed first. A
// failure that needs a race (two Stops at once) and does not come back on a
// replay keeps steps it could lose: the list can be longer than it needs.
async function shrinkWith(exec, steps, kind, { replays = 200, ms = 120_000 } = {}) {
  const end = Date.now() + ms, fails = async (xs) => (await exec(xs)).some((p) => kindOf(p) === kind);
  for (let size = Math.max(1, steps.length >> 1); replays > 0 && Date.now() < end;) {
    let cut = false;
    for (let i = 0; i < steps.length && replays > 0 && Date.now() < end; replays--) {
      const rest = steps.toSpliced(i, size);
      if (await fails(rest)) { steps = rest; cut = true; } else i += size;
    }
    if (!cut && size === 1) break;
    if (!cut) size = Math.max(1, size >> 1);
  }
  return steps;
}
const shrink = (steps, meta, kind, opts) => shrinkWith(async (xs) => (await execute(xs, meta)).found, steps, kind, opts);

// Self-checks, before any round.
assert.equal(kindOf('ASK123f0n4 is in handoff.md 0 times'), '# is in handoff.md # times');
// shrink keeps a step list only while the same kind fails (a fake executor: fails when steps 2 and 5 are both there,
// another way with 2 alone), and stops once no single step can go.
let calls = 0;
const fakeExec = async (xs) => { calls++; return xs.includes(2) ? [xs.includes(5) ? 'boom 1' : 'bang 1'] : []; };
assert.deepEqual((await shrinkWith(fakeExec, [0, 1, 2, 3, 4, 5, 6], 'boom #')).sort(), [2, 5]);
assert.ok(calls <= 20, `shrinking 7 steps took ${calls} replays`);
// All of a round's randomness is in generate: a seed gives the same steps twice.
assert.deepEqual(generate(7), generate(7));
// Every list of a round's steps is a whole round: a lone turn, a lone note hold on correct code.
const lone = generate(12345), alone = [];
for (const st of [lone.steps.find((x) => x.type === 'turn' && x.kind === 'plain' && !x.ask.startsWith('<private-session>')), lone.steps.find((x) => x.type === 'note')]) alone.push([st.type, (await execute([st], lone.meta)).found]);
assert.deepEqual(alone, [['turn', []], ['note', []]], 'a lone step fails on correct code');

// --keep-going: every failing round named, not just the first (a bug hunt),
// with its story, 60 lines at most. Otherwise the first failing round, shrunk
// unless --no-shrink, and the story of what is left of it.
const keepGoing = args.includes('--keep-going'), noShrink = args.includes('--no-shrink'), start = Date.now(), first = only ?? Math.floor(Math.random() * 2 ** 31);
let rounds = 0, failed = 0;
for (let seed = first; only === null ? Date.now() - start < seconds * 1000 : rounds < 1; seed++) {
  rounds++;
  const { steps, meta } = generate(seed), { found, story } = await execute(steps, meta);
  if (!found.length) continue;
  failed++;
  console.log(`fuzz: round ${seed} failed (replay: node fuzz.mjs --seed ${seed}):`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- seed ${seed}: ${found[0].replace(/\n/g, ' ')}\n`);
  if (keepGoing) { for (const p of [...found, ...story].slice(0, 60)) console.log(`  ${p}`); continue; }
  for (const p of noShrink ? [...found, ...story] : found) console.log(`  ${p}`);
  if (!noShrink) {
    const small = await shrink(steps, meta, kindOf(found[0])), again = await execute(small, meta);
    console.log(`fuzz: shrunk to ${small.length} of ${steps.length} steps:`);
    if (!again.found.length) console.log('  (they held on this replay: the failure needs a race)');
    for (const p of [...again.found, ...again.story]) console.log(`  ${p}`);
  }
  break;
}
// Not process.exit(): a pipe's output can be cut short (CONTRIBUTING).
console.log(failed ? `fuzz: ${failed} of ${rounds} round(s) failed` : `fuzz: ${rounds} round(s) from seed ${first} held, ${Math.round((Date.now() - start) / 1000)} s`);
process.exitCode = failed ? 1 : 0;
