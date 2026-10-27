#!/usr/bin/env node
// Compaction at a turn boundary, after memory is written -- not in the middle
// of a task. Claude Code checks its compaction threshold before EVERY model
// call, so a long turn was cut half-way: the background tasks it was waiting
// on lost their notifications, the commit it was about to make was not made,
// and the memory the model writes when a task ends was never written
// (2026-09-13: step 3 of the site redesign, cut with six suites in flight).
//
// Two hooks, one file:
//  * PreCompact (matcher `auto`): exit 2 blocks the compaction. Blocked while
//    the last assistant message did not end the turn (mid-turn) and the context
//    is between FLOOR and CEILING; allowed at a turn boundary (`end_turn`),
//    under the floor (a smaller model's window) or over the ceiling -- the
//    model's window is the hard limit, and a compaction refused there is a
//    rejected call. A mid-turn compaction it does let through first writes
//    the handoff entry and a note of what was in flight: the ask, the last
//    words said, background tasks still running with their output files,
//    files edited. It is the only writer of handoff.md on that event. A
//    conversation marked <private-session> gets neither.
//  * Stop: `nudge(payload)` -- when the context is past the trigger a
//    compaction is a turn or two away, so the stop is blocked ONCE with the reason "write
//    memory now"; the model writes it, stops again, and passes. Re-armed when
//    the context drops (a compaction happened).
//
// Not relied on. On 2026-10-03 Claude Code compacted a session mid-turn at
// 767k with a summary it had precomputed (71 ms), while this gate, replayed on
// the same transcript, said "deferred". `recover()` puts the in-flight note
// back at SessionStart either way, and the nudge fires early enough that
// memory is written before any compaction.
//
// Run: node compact-gate.mjs   (PreCompact payload on stdin)
//      node compact-gate.mjs --state <transcript.jsonl>   (print what it sees)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTail, text, own, asked, handoff, hushed, tag, local, clip, answer, newest, sectionOf, NUDGE_TAG } from './handoff-log.mjs';
import { storeOf, withLock, replaceIfUnchanged, projectsRoot } from './store.mjs';

// --- the numbers. Change these, not the code below. -------------------------
const MODEL_WINDOW = 1_000_000;  // the model's own window (Fable / Opus, 1M on)
// The window Claude Code compacts against: settings `env` sets it to 800000.
export const WINDOW = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || MODEL_WINDOW;
// Claude Code compacts at ~0.959 of its window (863,324 of 900,000; 767,072 of
// 800,000). The nudge has to land a whole turn before that, and a turn above
// 300k adds 18k tokens at the median, 46k at p75 and 148k at p90 (2026-10-26):
// at 0.95 the room was 7k and no nudge was ever seen. 0.85 leaves ~87k.
export const TRIGGER = 0.85;
// Over this share of the model's window a mid-turn compaction goes through.
// The API refuses a call when input + max output exceeds the window, so the
// margin must hold the response budget (32k+) and one more tool result: 10 %.
const CEILING = 0.90;
// No model's window is smaller than this. A session on a 200k model under
// these user-level hooks would otherwise be deferred until 900k -- never --
// and the context-limit error Claude Code retries a compaction for would
// surface instead. Under the floor a deferral can only be wrong.
const FLOOR = 200_000;
const TAIL = 256_000;
const LIST_MAX = 20;      // running tasks and edited files a note names: the newest

const WEEK = 7 * 86400000;
// One small file per session: sessions sharing one stamp file rewrote each
// other's state.
const NUDGES = () => join(projectsRoot(), '.nudge');
// One tool result each: a Bash launch says "ID: x ... Output is being written
// to: <path>", an Agent launch "agentId: x ... output_file: <path>" with ~450
// characters of instructions between (a 200-character cap missed every agent).
const LAUNCH = /(?:running in background with ID|agentId): ?(\w+)[\s\S]*?(?:Output is being written to|output_file): ?(\S+?\.output)/g;
const DONE = /<task-id>(\w+)<\/task-id>/g;

/** What the transcript says right now: context size, whether a turn is open,
 *  and what that turn has in flight. Reads a growing tail until it holds the
 *  turn's own prompt (a turn can be megabytes of tool output), or the whole
 *  file. */
function state(path, { ask = true } = {}) {
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: raw, whole } = readTail(path, bytes);
    const s = walk(raw);
    // The Stop nudge needs only the size and whether the turn is open; it runs
    // every turn and must not read a 30 MB transcript to find the prompt.
    if ((ask ? s.ask : s.ctx) || whole) return s;
  }
}

function walk(raw) {
  const s = { ctx: 0, midTurn: false, ask: '', said: '', hidden: false, at: '', running: new Map(), edited: new Set() };
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const m = r.message, c = Array.isArray(m?.content) ? m.content : [];
    const t = text(r).trim();
    if (r.type === 'user') {
      // A new prompt starts a new turn's edits. Not its running tasks: a build
      // launched two turns ago is still running now, and a note that said
      // "none" had the model rerun it after the compaction.
      // Its answer too: the last one said belonged to the turn before, and
      // after a private ask it was shown under the next one.
      if (asked(r, t)) { s.ask = own(t); s.at = local(r.timestamp); s.said = ''; s.hidden = false; s.edited.clear(); }
      else if (/<private/i.test(own(t))) s.hidden = true;
      for (const b of c) {
        const body = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join(' ') : b.text || '';
        for (const hit of body.matchAll(LAUNCH)) {
          s.running.set(hit[1], hit[2]);
          if (s.running.size > LIST_MAX) s.running.delete(s.running.keys().next().value);
        }
      }
      // A notification is a user record's text (a string or text blocks), never
      // a tool result: one scan, not two that hide each other from a mutant.
      for (const hit of t.matchAll(DONE)) s.running.delete(hit[1]);
    } else if (r.type === 'assistant') {
      if (t) s.said = t;
      if (m?.usage) {
        const u = m.usage;
        s.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        s.midTurn = m.stop_reason !== 'end_turn';
      }
      for (const b of c) {
        if (b.type !== 'tool_use' || !/^(Edit|Write|NotebookEdit)$/.test(b.name)) continue;
        const file = b.input?.file_path || b.input?.notebook_path;   // NotebookEdit names its file differently
        if (file) s.edited.add(file);
      }
    }
  }
  return s;
}

/** The in-flight note, as one entry inside handoff.md's auto section. The
 *  Stop hook rebuilds that section from its asked/did entries, so the note
 *  lives exactly until the next turn ends. `--print` never shows it: it is no
 *  entry, and `recover()` builds the same note from the same transcript. */
function note(payload, s) {
  const running = [...s.running].map(([id, p]) => `${id} → ${p}`).join('; ') || 'none';
  // Capped like the running tasks: a wide refactor turn listed tens of KB.
  const edited = newest([...s.edited], LIST_MAX, 'earlier') || 'none';
  const t = tag(payload.session_id);
  // Tagged, so a parallel session's note is never taken for this one's.
  return `- **cut mid-turn**${t ? ` [${t}]` : ''} ${local()} at ${Math.round(s.ctx / 1000)}k tokens, asked ${s.at}: ${clip(s.ask, 240)}\n` +
    `  **last said:** ${s.hidden ? '[private]' : answer(s.ask, s.said, 400)}\n  **still running (read their output files, do not rerun):** ${running}\n  **edited this turn:** ${edited}`;
}

function inflight(payload, s) {
  const dir = storeOf(payload);
  const file = join(dir, 'handoff.md');
  if (!existsSync(file)) return false;
  if (hushed(dir, tag(payload.session_id))) return 'private';
  const r = withLock(dir, () => {
    const doc = readFileSync(file, 'utf8');
    const { a, b } = sectionOf(doc);
    if (a === -1) return false;
    const out = doc.slice(0, b).trimEnd() + '\n' + note(payload, s) + '\n' + doc.slice(b);
    return replaceIfUnchanged(file, doc, out) === true;
  });
  return r ?? 'busy';
}

/** SessionStart after a compaction: the note for a turn the compaction cut,
 *  whether or not the gate was asked. SessionStart runs before any new
 *  assistant message, so the last one is the turn that was cut. A note the
 *  gate wrote into the file holds the same facts from the same transcript, and
 *  only this one is printed. Printed, not written: the next Stop drops notes
 *  from the file anyway. */
export function recover(input) {
  const t = input.transcript_path;
  if (!t || !existsSync(t)) return '';
  const s = state(t);
  if (!s.midTurn) return '';
  return note(input, s);
}

/** PreCompact: 0 lets the compaction run, 2 defers it. */
export function gate(payload) {
  if (payload.trigger !== 'auto' || !payload.transcript_path || !existsSync(payload.transcript_path)) return { code: 0, why: 'not an auto compaction' };
  // Size and turn state decide: past the threshold Claude Code asks before every
  // model call, and the read back to the turn's prompt can be megabytes. Only
  // the note, over the ceiling, needs it.
  let s = state(payload.transcript_path, { ask: false });
  const pct = Math.round(100 * s.ctx / MODEL_WINDOW);
  if (!s.midTurn) return { code: 0, why: `turn boundary at ${pct}%` };
  if (s.ctx < FLOOR) return { code: 0, why: `mid-turn at ${Math.round(s.ctx / 1000)}k, under the smallest window any model has: not deferred` };
  if (s.ctx < CEILING * MODEL_WINDOW) return { code: 2, why: `deferred: mid-turn at ${pct}% of the model window; it runs when this turn ends` };
  s = state(payload.transcript_path);
  // One writer, in order: the handoff first (the turn's ask and last words as
  // an entry), then the note inside it. As two hooks on the same event they
  // ran in parallel and raced their renames over handoff.md; the note lost.
  // Neither may decide the compaction: it runs, and the failure is named.
  // Their return values are read: an early return (no store for this cwd, no
  // markers in the file) is not a write, and once reported as one; nor is a
  // store another hook held past the lock wait, once reported as no file.
  const failed = [];
  const held = 'another hook held the store past the lock wait';
  try {
    const h = handoff(payload);
    if (h === 'busy') failed.push(`handoff: ${held}`);
    else if (!h) failed.push('handoff: nothing written (no store for this cwd, no transcript, or no turn in it)');
  } catch (e) { failed.push(`handoff: ${e.message}`); }
  try {
    const n = inflight(payload, s);
    if (n === 'private') return { code: 0, why: `mid-turn at ${pct}%, over the ceiling: a private conversation, nothing written` };
    if (n === 'busy') failed.push(`note: ${held}`);
    else if (!n) failed.push('note: no handoff.md with markers in the store');
  } catch (e) { failed.push(`note: ${e.message}`); }
  return { code: 0, why: `mid-turn at ${pct}%, over the ceiling: ` + (failed.length ? failed.join('; ') : 'handoff and in-flight note written') };
}

/** Stop: the one block per compaction cycle that gets memory written first. */
export function nudge(payload) {
  // Stop only. memory-tier.mjs --stop also runs as the PreCompact hook, and a
  // PreCompact hook that prints `decision: block` blocks the compaction: the
  // first mid-turn crossing would have spent the cycle's one nudge on
  // deferring a compaction the gate defers anyway, and the turn's end would
  // then have passed with no memory written (found by the second audit).
  if (payload.hook_event_name !== 'Stop' || payload.stop_hook_active || !payload.transcript_path || !existsSync(payload.transcript_path)) return null;
  const s = state(payload.transcript_path, { ask: false });
  const id = String(payload.session_id || 'none').replace(/[^\w-]/g, '');
  const mine = join(NUDGES(), id);
  let given = 0; try { given = Number(readFileSync(mine, 'utf8')) || 0; } catch {}
  const arm = (ctx) => {
    try {
      mkdirSync(NUDGES(), { recursive: true });
      writeFileSync(mine, String(ctx));
      // A file per session needs pruning; a week is longer than any session.
      for (const f of readdirSync(NUDGES())) {
        const p = join(NUDGES(), f);
        if (Date.now() - statSync(p).mtimeMs > WEEK) unlinkSync(p);
      }
    } catch {}
  };
  if (s.ctx < TRIGGER * WINDOW) {
    // Below the trigger with a nudge on record: the context came down (a
    // compaction ran), so the next crossing earns a nudge of its own.
    if (given) arm(0);
    return null;
  }
  // Same cycle, the context only grown: the nudge was already given.
  if (given && s.ctx >= given) return null;
  arm(s.ctx);
  const pct = Math.round(100 * s.ctx / WINDOW);
  // The tag keeps the reason, which Claude Code puts into the conversation,
  // from reading as a prompt: handoff-log's `asked()` skips `[SYSTEM`, so it
  // is neither the turn's ask nor a reason to clear the turn's edits.
  return { decision: 'block', reason:
    `${NUDGE_TAG} Context is at ${pct}% of the compaction window: this session compacts within a turn or two. ` +
    'Before stopping, update memory -- handoff.md (what this task finished, what is open, every background task id with its output file) ' +
    'and any project memory this work changed -- then stop. Start no new work.' };
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const i = process.argv.indexOf('--state');
  if (i !== -1) {
    const s = state(process.argv[i + 1]);
    console.log(JSON.stringify({ ...s, running: [...s.running], edited: [...s.edited] }, null, 1));
    process.exit(0);
  }
  // A payload it cannot read, or a gate that throws, lets the compaction run:
  // a broken gate must never be what keeps a session from compacting. The two
  // are told apart, because "no payload" once covered every failure.
  let payload = null;
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {}
  let r = { code: 0, why: 'no payload' };
  if (payload) { try { r = gate(payload); } catch (e) { r = { code: 0, why: `gate failed, not deferred: ${e.message}` }; } }
  // Always said, so the hooks debug log shows why a compaction ran or waited;
  // Claude Code shows exit-2 stderr to the user only for a manual /compact.
  process.stderr.write(`compaction gate: ${r.why}\n`);
  process.exit(r.code);
}
