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
import { NUDGE_TAG } from './handoff-log.mjs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--seed') ?? 60);
const only = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
const homes = tempHome('fuzz-').home, kept = new Set();
// The hooks and this file must read the same numbers: the four variables that
// set the windows are gone from this process (the hooks inherit that) before
// compact-gate.mjs is loaded, which a static import would do first.
for (const v of ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_DISABLE_1M_CONTEXT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) delete process.env[v];
const { MODEL_WINDOW, WINDOW, TRIGGER } = await import('./compact-gate.mjs');
// Reply sizes, in tokens: a small start, two under the trigger, one just past it, one past the ceiling.
const SIZES = [1_000, 199_000, 500_000, Math.ceil(TRIGGER * WINDOW) + 1_000, Math.ceil(0.95 * MODEL_WINDOW)];
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
  // `env` stays undefined, which is "inherit" (harness.mjs); the zone is set on
  // this process just before the spawn, which copies it at that call. The date
  // maths here is UTC and does not read it.
  process.env.TZ = tz;
  const c = spawn(process.execPath, [file, ...argv]);
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
  // idx: the size of its last reply, in SIZES; sizes only grow until a compaction lets through and they fall back (fell).
  const sessions = Array.from({ length: int(1, 2) }, (_, k) => ({ id: `f${k}${hex}-${int(1000, 9999)}`, private: false, n: 0, idx: 0, fell: false }));
  for (const s of sessions) steps.push({ type: 'session', id: s.id, big: r() < 0.25 });
  const marks = new Map(), top = SIZES.length - 1;
  let clock = Date.UTC(2026, 9, 30, 8, 0, 0);
  // Returns the trigger of the gate that follows a turn cut mid-way, or null.
  const turn = (s) => {
    clock += int(1, 90) * 60_000;
    const i = s.n++, mark = `ASK${u}${s.id[1]}n${i}`, kind = r();
    // 20 % are cut mid-way; after one the gate runs 70 % of the time, over 90 % of the window in 40 % of those.
    const cut = r() < 0.2, gated = cut && r() < 0.7, over = gated && r() < 0.4;
    s.idx = over ? top : int(s.idx, s.fell ? 2 : gated ? Math.max(s.idx, top - 1) : top); s.fell = false;
    const st = { type: 'turn', s: s.id, at: clock, mark, uuid: `u-${u}-${s.id[1]}-${i}`, kind: 'plain', ask: `${mark} ${text(int(1, 12))}`, did: `done ${text(int(1, 30))}`, size: SIZES[s.idx] };
    if (kind < 0.15) { st.secret = `ZQXP${u}${s.id[1]}n${i}`; st.ask = `${pick(['<private>', '<PRIVATE>', '<private reason="x">'])}${st.secret}</private> ${st.ask}`; st.did = `${st.did} ${st.secret}`; }
    else if (kind < 0.25) { st.secret = `ZQXF${u}${s.id[1]}n${i}`; st.ask = `${st.ask} ${st.secret}`; st.did = `${st.did} ${st.secret}`; st.kind = 'forget'; st.tool = { type: 'tool_use', id: `f${i}`, name: 'Bash', input: { command: pick(FORGET) } }; }
    else if (kind < 0.3) { st.ask = `<private-session> ${st.ask}`; s.private = true; }
    marks.set(mark, { kind: st.kind, s, uuid: st.uuid });
    // The ask as a string or a text block; the answer half written when the Stop comes, or a broken line after it.
    st.block = r() >= 0.5;
    st.half = !cut && r() < 0.1;
    st.broken = !cut && !st.half && r() < 0.05;
    // Cut mid-way: half of those after a background launch (or two), and a launch's end may be noticed later.
    if (cut) {
      st.cut = true;
      st.launches = r() < 0.5 ? Array.from({ length: int(1, 2) }, (_, j) => ({ id: `bg${u}${s.id[1]}n${i}x${j}`, done: r() < 0.5 })) : [];
    }
    steps.push(st);
    if (!gated) return null;
    const trigger = r() < 0.85 ? 'auto' : 'manual';
    // A compaction that went through (a turn boundary, or past the ceiling or under the floor) brings the size down.
    if (trigger === 'auto' && (s.idx === top || SIZES[s.idx] < 200_000)) { s.idx = 0; s.fell = true; }
    return { type: 'gate', s: s.id, trigger };
  };
  for (let k = 0, n = int(1, 6); k < n; k++) {
    const tz = pick(ZONES);
    if (sessions.length === 2 && r() < 0.3) { const gs = sessions.map((s) => turn(s)).filter(Boolean); steps.push(...gs.map((g) => ({ ...g, tz }))); steps.push({ type: 'stops', ss: sessions.map((s) => s.id), tz }); }
    else { const s = pick(sessions), g = turn(s); if (g) steps.push({ ...g, tz }); steps.push({ type: 'stop', s: s.id, tz }); }
    if (r() < 0.15) { const s = pick(sessions), trigger = pick(['auto', 'manual']); steps.push({ type: 'gate', s: s.id, trigger, tz }); if (trigger === 'auto') { s.idx = 0; s.fell = true; } }
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
  const rec = (s, type, ts, content, uuid, size = 1000, stop = 'end_turn') => JSON.stringify({ type, uuid, sessionId: s.id, cwd, timestamp: ts,
    message: type === 'user' ? { role: 'user', content } : { role: 'assistant', content, stop_reason: stop, usage: { input_tokens: size } } });
  // What the hooks will read of a conversation, kept as its lines are written:
  // ctx and mid are the size and stop_reason of the last whole assistant line;
  // nudges, givenAt and unsure follow the nudge since the last dip under the trigger.
  const session = (id) => {
    if (!sessions.has(id)) { sessions.set(id, { id, t: join(proj, `${id}.jsonl`), private: false, did: '', rest: '', restSize: 0, cut: null, ctx: 0, mid: false, nudges: 0, givenAt: 0, unsure: false, lastPlain: false, turns: 0, stopped: 0 }); writeFileSync(sessions.get(id).t, ''); }
    return sessions.get(id);
  };
  // A half-written answer is finished, and a turn cut mid-way ends, before the next turn or Stop.
  const flush = (s) => { if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; s.ctx = s.restSize; s.mid = false; } };
  const endCut = (s) => { if (s.cut) { appendFileSync(s.t, s.cut.rest); s.ctx = s.cut.size; s.mid = false; s.cut = null; } };
  const stop = async (s, tz, solo = true) => {
    endCut(s);
    log.push(`stop ${s.id} TZ=${tz}`);
    s.stopped = s.turns;
    const p = await run(TIER, ['--stop'], JSON.stringify({ cwd, transcript_path: s.t, session_id: s.id, hook_event_name: 'Stop', last_assistant_message: s.did }), tz);
    if (p.status !== 0) { problems.push(`the Stop hook (${s.id}, TZ=${tz}) exited ${p.status ?? p.signal}: ${p.err.trim().split('\n').slice(-2).join(' | ')}`); return; }
    // The nudge: its tag in a line of stdout. At most once between dips under the
    // trigger (a size smaller than the last nudge's is a dip too), never in a
    // <private-session> conversation, and on the first Stop of a plain turn past it.
    const gave = p.out.split('\n').some((l) => { try { return JSON.parse(l).hookSpecificOutput?.additionalContext?.includes(NUDGE_TAG); } catch { return false; } });
    if (s.ctx < TRIGGER * WINDOW) { s.nudges = 0; s.unsure = false; }
    else {
      if (gave) {
        if (s.private) problems.push(`the Stop of a <private-session> conversation (${s.id}) gave a nudge`);
        if (s.nudges > 0 && s.ctx >= s.givenAt) problems.push(`a second nudge for ${s.id} between dips under the trigger: at ${s.givenAt}, then at ${s.ctx} tokens`);
        s.nudges++; s.givenAt = s.ctx;
      } else if (s.nudges === 0 && !s.unsure && !s.private && s.lastPlain) problems.push(`no nudge on the first Stop of a plain turn past the trigger (${s.id}, ${s.ctx} tokens)`);
      // A turn that may be private (a tag, forget) may or may not have spent the nudge.
      if (!s.lastPlain) s.unsure = true;
    }
    // A turn that has ended and stopped leaves no cut-turn note (the Stop rebuilds the section); not two Stops at once, which can leave one to the other.
    if (solo && !s.rest && !s.private) {
      const h = existsSync(join(dir, 'handoff.md')) ? readFileSync(join(dir, 'handoff.md'), 'utf8') : '';
      if (h.includes(`**cut mid-turn** [${s.id.slice(0, 8)}]`)) problems.push(`handoff.md still has the cut-turn note of ${s.id} after its turn ended and stopped`);
    }
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
  const finish = () => { for (const s of sessions.values()) flush(s); };

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
      const s = session(st.s), ts = (ms) => new Date(st.at + ms).toISOString(), size = st.size ?? 1000, id = (p) => st.uuid.replace('u-', p);
      endCut(s); flush(s);
      if (st.secret) secrets.push(st.secret);
      if (st.ask.startsWith('<private-session>')) s.private = true;
      s.did = st.did;
      s.lastPlain = st.kind === 'plain' && !st.secret && !st.ask.startsWith('<private-session>');
      marks.set(st.mark, { kind: st.kind, s, turn: ++s.turns });
      const askLine = rec(s, 'user', ts(0), st.block ? [{ type: 'text', text: st.ask }] : st.ask, st.uuid);
      log.push(`turn ${st.mark} ${st.kind}${st.ask.startsWith('<private-session>') ? ' <private-session>' : ''} at ${ts(0)}, ${size} tokens${st.cut ? ', cut mid-way' : ''}${st.half ? ', answer half written' : ''}${st.broken ? ', then a broken line' : ''}`);
      if (st.cut) {
        // Cut mid-way: background launches (and the notices of some that ended),
        // then a tool call with no result and no answer yet. The turn ends at the next Stop.
        let k = 0;
        const lines = [askLine], last = st.tool ?? { type: 'tool_use', id: `c${st.uuid}`, name: 'Read', input: { file_path: 'C:\\fuzz\\a.txt' } };
        for (const l of st.launches) {
          lines.push(rec(s, 'assistant', ts(1000 * ++k), [{ type: 'tool_use', id: `b${l.id}`, name: 'Bash', input: { command: 'npm test' } }], id(`b${k}-`), size, 'tool_use'));
          lines.push(rec(s, 'user', ts(1000 * ++k), [{ type: 'tool_result', tool_use_id: `b${l.id}`, content: `Command running in background with ID: ${l.id}. Output is being written to: C:\\fuzz\\tasks\\${l.id}.output` }], id(`b${k}-`)));
          log.push(`  launch ${l.id}${l.done ? ', then its notice' : ''}`);
        }
        for (const l of st.launches) if (l.done) lines.push(JSON.stringify({ type: 'attachment', uuid: id(`n${++k}-`), sessionId: s.id, cwd, timestamp: ts(1000 * k), attachment: { type: 'queued_command', prompt: `<task-notification><task-id>${l.id}</task-id></task-notification>` } }));
        lines.push(rec(s, 'assistant', ts(1000 * ++k), [last], id('c-'), size, 'tool_use'));
        appendFileSync(s.t, `${lines.join('\n')}\n`);
        s.ctx = size; s.mid = true;
        s.cut = { st, size, rest: `${rec(s, 'user', ts(1000 * ++k), [{ type: 'tool_result', tool_use_id: last.id, content: 'removed 0' }], id('r-'))}\n${rec(s, 'assistant', ts(1000 * ++k), [{ type: 'text', text: st.did }], id('a-'), size)}\n` };
        return;
      }
      // As Claude Code writes a turn: a tool call and its result on lines of their
      // own, when it runs, before the answer; only the answer can be half written.
      const user = [askLine,
        ...(st.tool ? [rec(s, 'assistant', ts(10_000), [st.tool], id('t-'), size),
          rec(s, 'user', ts(20_000), [{ type: 'tool_result', tool_use_id: st.tool.id, content: 'removed 0' }], id('r-'))] : [])].join('\n');
      const asst = rec(s, 'assistant', ts(30_000), [{ type: 'text', text: st.did }], id('a-'), size);
      // A Stop may come while the answer's line is half written; it is finished before the next turn.
      if (st.half) { const cut = Math.floor(asst.length / 2); appendFileSync(s.t, `${user}\n${asst.slice(0, cut)}`); s.rest = `${asst.slice(cut)}\n`; s.restSize = size; if (st.tool) { s.ctx = size; s.mid = false; } }
      else { appendFileSync(s.t, `${user}\n${asst}\n${st.broken ? '{"type":"user","message":\n' : ''}`); s.ctx = size; s.mid = false; }
    },
    stop: ({ s, tz }) => stop(session(s), tz),
    stops: async ({ ss, tz }) => { log.push('both Stops at once:'); await Promise.all(ss.map((id) => stop(session(id), tz, false))); },
    gate: async ({ s, trigger, tz }) => {
      const c = session(s), file = join(dir, 'handoff.md');
      log.push(`the compaction gate (${trigger}) for ${s} TZ=${tz}, at ${c.ctx} tokens${c.mid ? ' mid-turn' : ''}`);
      const marked = existsSync(file) && readFileSync(file, 'utf8').includes('<!-- auto:start -->');
      const g = await run(GATE, [], JSON.stringify({ cwd, transcript_path: c.t, session_id: s, hook_event_name: 'PreCompact', trigger }), tz);
      // 2 exactly for an automatic compaction in the middle of a turn, from the floor to the ceiling.
      const want = trigger === 'auto' && c.mid && c.ctx >= 200_000 && c.ctx < 0.9 * MODEL_WINDOW ? 2 : 0;
      if (g.status !== 0 && g.status !== 2) problems.push(`the compaction gate exited ${g.status ?? g.signal}: ${g.err.trim().split('\n').slice(-1)}`);
      else if (g.status !== want) problems.push(`the compaction gate exited ${g.status}, not ${want} (${trigger}, ${c.mid ? 'mid-turn' : 'at a turn boundary'}, ${c.ctx} tokens)`);
      for (const sec of secrets) if ((g.out + g.err).includes(sec)) problems.push(`the compaction gate printed private text ${sec}`);
      // What it wrote, read now: the next Stop takes the note out again.
      const h = existsSync(file) ? readFileSync(file, 'utf8') : '';
      for (const sec of secrets) if (h.includes(sec)) problems.push(`private text ${sec} is in handoff.md after the compaction gate`);
      for (const [mark, m] of marks) if (m.kind === 'forget' && h.includes(mark)) problems.push(`a turn that ran forget: ${mark} is in handoff.md after the compaction gate`);
      // A compaction let through over the ceiling, in a conversation that is not private, leaves a note
      // that names each launch not yet done (and none that is) -- when the file had its section to put it in.
      const cut = c.cut?.st;
      if (trigger === 'auto' && c.mid && c.ctx >= 0.9 * MODEL_WINDOW && cut?.kind === 'plain' && !cut.secret && !c.private && marked) {
        const head = `**cut mid-turn** [${s.slice(0, 8)}]`, i = h.indexOf(head), note = i === -1 ? '' : h.slice(i, h.indexOf('**edited this turn:**', i));
        if (i === -1) problems.push(`no cut-turn note in handoff.md after the gate over 90% (${s}, ${c.ctx} tokens)`);
        else for (const l of cut.launches) if (l.done === note.includes(l.id)) problems.push(`the cut-turn note ${l.done ? 'names' : 'does not name'} launch ${l.id}, ${l.done ? 'done' : 'not yet done'}`);
      }
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
const plain = lone.steps.find((x) => x.type === 'turn' && x.kind === 'plain' && !x.ask.startsWith('<private-session>'));
// A turn cut mid-way (past the ceiling, one launch), a turn past the trigger, and a gate alone or after the cut turn.
const cutTurn = { ...plain, cut: true, size: SIZES[4], launches: [{ id: 'bgx0', done: false }] }, gate = { type: 'gate', s: plain.s, trigger: 'auto', tz: 'UTC' };
for (const [name, xs] of [['turn', [plain]], ['note', [lone.steps.find((x) => x.type === 'note')]], ['cut turn', [cutTurn]], ['turn past the trigger', [{ ...plain, size: SIZES[3] }]], ['gate', [gate]], ['cut turn, gate', [cutTurn, gate]]]) alone.push([name, (await execute(xs, lone.meta)).found]);
assert.deepEqual(alone.map(([n, f]) => [n, f.length]), ['turn', 'note', 'cut turn', 'turn past the trigger', 'gate', 'cut turn, gate'].map((n) => [n, 0]), `a lone step fails on correct code: ${JSON.stringify(alone.filter(([, f]) => f.length))}`);

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
