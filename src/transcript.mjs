// Reads a transcript, the JSONL file Claude Code keeps of a conversation. Two levels, and nothing else:
//
//  * Records: the bytes of a file, from its end, its start, or any range, cut into whole lines and parsed. A subagent's
//    records (isSidechain) are left out unless the caller asks for them. Each reader keeps its own limits.
//  * Turns: built on records. The ask, the reply, the commands, the files changed, the picks from AskUserQuestion, and
//    the private flags, which come from privacy.mjs. handoff-log, journal, memory and compact-gate read turns.
//
// Imports Node, store.mjs, privacy.mjs and text.mjs only: never the handoff or the journal.
import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { clip } from './text.mjs';
import { PRIVATE, PRIVATE_SESSION } from './privacy.mjs';
import { tag, same, inProjects, local, norm } from './store.mjs';
import { BARE } from './secrets.mjs';

// ---- Records ----
export const TAIL = 512_000;     // first read; grown 4× until it reaches the latest prompt

export function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const from = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    return { text: buf.toString('utf8'), whole: from === 0 };
  } finally { closeSync(fd); }
}

// The first `bytes` of a file as text (a file shorter than that, whole). A line the end cuts through is cut.
export function readHead(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString('utf8', 0, readSync(fd, buf, 0, bytes, 0));
  } finally { closeSync(fd); }
}

// A file opened to read by range: its descriptor, its size, and the call that closes it (also when the size will not read).
export function openFile(path) {
  const fd = openSync(path, 'r');
  try { return { fd, size: fstatSync(fd).size, close: () => closeSync(fd) }; } catch (e) { closeSync(fd); throw e; }
}

// Past the line that runs on at `pos`: its newline found in 1 MB reads, never decoded.
export function past(fd, pos, size) {
  const buf = Buffer.allocUnsafe(1 << 20);
  for (; pos < size; pos += buf.length) {
    const i = buf.subarray(0, readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos)).indexOf(10);
    if (i !== -1) return pos + i + 1;
  }
  return size;
}

// The whole lines in the `seg` bytes from `pos`, and where they start (`pos`):
// a line longer than `seg` is passed over unread. null at the end.
export function chunk(fd, pos, seg, size) {
  while (pos < size) {
    const buf = Buffer.allocUnsafe(Math.min(seg, size - pos)), n = readSync(fd, buf, 0, buf.length, pos);
    if (!n) return null;
    const nl = pos + n >= size ? n - 1 : buf.subarray(0, n).lastIndexOf(10);
    if (nl !== -1) return { buf: buf.subarray(0, nl + 1), pos };
    pos = past(fd, pos + n, size);
  }
  return null;
}

// ---- The typed <private-session> mark ----
// The one reading of "the user typed the mark" for the git-rule hook, the compaction gate and the journal: turns().hush, so a mark
// typed, queued or given as an answer to Claude's question counts, and one only quoted, or in a compaction summary, does not.
// A cheap text test first; turns() only on a piece that holds the mark. norm costs ~10 ms a MB: only a line with a non-ASCII
// character can hide the mark from the plain test.
const holdsMark = (t) => (PRIVATE_SESSION.test(t) || t.split('\n').some((l) => /[^\x00-\x7f]/.test(l) && PRIVATE_SESSION.test(norm(l)))) && turns(t).hush === true;

// Whether a typed mark is in the bytes of `fd` from `pos` (a line's start), read `seg` bytes a piece while `more()`. A line is read
// whole however many pieces it spans (one string of a 600 MB transcript took 14 s and then threw). { hit, pos }: `pos` is where the
// look stopped, at a line's start, or `size` at the end.
// shortcut: turns() sees one piece at a time, so an answer whose question sits in an earlier piece is not read as typed; carry the
// asks across pieces if that is ever met.
export function markFrom(fd, pos, seg, size, more = () => true) {
  const buf = Buffer.allocUnsafe(Math.max(1, Math.min(seg, size - pos)));
  for (let rest = [], at = pos; at < size;) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, size - at), at);
    if (!n) break;
    at += n;
    const piece = buf.subarray(0, n), nl = at >= size ? n - 1 : piece.lastIndexOf(10);
    if (nl === -1) { rest.push(Buffer.from(piece)); continue; }
    if (holdsMark(Buffer.concat([...rest, piece.subarray(0, nl + 1)]).toString('utf8'))) return { hit: true, pos: size };
    rest = [Buffer.from(piece.subarray(nl + 1))];
    pos = at - (n - nl - 1);
    if (pos < size && !more()) return { hit: false, pos };
  }
  return { hit: false, pos: size };
}

// Whether the user typed the mark anywhere in the transcript at `path`. One that won't read counts as marked: no write is safer
// than a write of a private conversation.
export function typedMark(path, seg = 8 * 1024 * 1024) {
  let f;
  try { f = openFile(path); return markFrom(f.fd, 0, seg, f.size).hit; } catch { return true; } finally { f?.close(); }
}

// The last prompt's line before a tail of `bytes` (fewer than the file has), the line the tail cut through included:
// read back a megabyte at a time, up to 256 MB. null: none there.
export function promptBefore(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    // From the end of the line the tail cut through, found 64 KB at a time (the end of the file when it has no more).
    const peek = Buffer.alloc(65536), size = fstatSync(fd).size;
    let pos = size - bytes, carry = Buffer.alloc(0);
    for (let n, i; pos < size; pos += n) {
      n = readSync(fd, peek, 0, peek.length, pos); i = peek.subarray(0, n).indexOf(10);
      if (i !== -1) { pos += i + 1; break; }
      if (!n) break;
    }
    for (let k = 0; k < 256 && pos; k++) {
      const buf = Buffer.alloc(Math.min(1048576, pos));
      pos -= buf.length; readSync(fd, buf, 0, buf.length, pos);
      // Whole lines only: the piece before the first line break ends a line that started further back. (Every read but
      // the first ends with the line break the carry holds; the first ends with one, or the tail cut a line too long.)
      const all = Buffer.concat([buf, carry]), cut = pos && all.indexOf(10) + 1;
      carry = all.subarray(0, cut);
      for (const l of all.subarray(cut).toString('utf8').split('\n').reverse()) {
        // A tool's result, by its head: a screenshot's line is 300 KB to parse for nothing.
        if (l.slice(0, 4096).includes('"tool_result"')) continue;
        let r; try { r = JSON.parse(l); } catch { continue; }
        if (r?.type === 'user' && prompt(r, text(r).trim())) return l;
      }
    }
    return null;
  } finally { closeSync(fd); }
}

// The records in a text read from a transcript, in order: each line that starts with `{` and parses, a line the tail cut
// through or a half-written one passed over. A subagent's record (isSidechain) only when `sidechain`. `types`: a line whose
// first key is a type not listed is not parsed at all (a record the reader never uses can be megabytes: api-request-blob,
// 7 of 32 MB). `has`: a line without that text is not parsed either, a cheap filter on the raw line.
// A record a crash cut mid-write gets the next one appended onto its line: that whole one is the line's end, from a later
// `{"` on. Skipping the line lost a prompt, and its reply was filed under the ask before (1.6.1). Only lines that fail to parse
// pay; an inner `{"` fails at its own end, so a long line costs about its length times its nesting, not its length squared.
const rejoined = (line) => {
  // From the right: a start inside the glued record leaves its closing `}` after it and fails, so the first that parses is
  // the glued record, however many objects the cut one held. At most 1000 starts: a cut line stays in the transcript, and a
  // line of many small objects cost ~0.9 s on every read.
  for (let i = line.lastIndexOf('{"'), k = 0; i > 0 && k < 1000; i = line.lastIndexOf('{"', i - 1), k++) { try { return JSON.parse(line.slice(i)); } catch {} }
  return null;
};
export function* records(text,{ sidechain = false, types = null, has = null } = {}) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{') || (has && !line.includes(has))) continue;   // a tail starts mid-line
    const ty = types && /^{"type":"([^"]*)"/.exec(line.slice(0, 40))?.[1];
    // A record of an unread type is skipped unparsed, unless a crash cut it and a record it reads starts later on its line
    // (not any `{"type":`: a content block inside would parse every big unread record again).
    if (ty && !types.includes(ty) && !line.includes('{"parentUuid":', 1) && !types.some((t) => line.includes(`{"type":"${t}"`, 1))) continue;
    let r; try { r = JSON.parse(line); if (ty && !types.includes(ty)) continue; } catch { r = rejoined(line); if (!r || types && !types.includes(r.type)) continue; }
    if (r.isSidechain === true && !sidechain) continue;
    yield r;
  }
}

// ---- Turns ----
// What compact-gate's Stop nudge opens with. `asked()` skips it, and `turns()`
// freezes the turn's answer at it: the words written after it are the memory
// update, not what the turn did. Named for the plugin: `[SYSTEM: ...]`, its
// label before 1.1.0, read as text posing as Claude Code's own, and
// transcripts from then still carry it.
export const NUDGE_TAG = '[project-memory: compaction gate]';
const NUDGE_TAGS = [NUDGE_TAG, '[SYSTEM: compaction gate]'];

export const text = (r) => {
  const c = r?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
  return '';
};

// Claude Code may hand a Stop reason back wrapped ("Stop hook feedback: ..."),
// and no real nudge record survives to show which: look near the start, not
// only at it.
const nudged = (s) => NUDGE_TAGS.some((n) => s.slice(0, 200).includes(n));

// A user record can also be a tool result, a slash-command echo, or something
// the harness injected (`isMeta`: a skill body, a hook's output). None is a
// prompt. Without the isMeta test a skill body became the "ask" of the turn.
// "[Request interrupted by user]" is the harness reporting an Escape, not a
// question; 18 of them had been recorded as asks.
// A compaction summary ("This session is being continued from...") is a user
// record too, flagged isCompactSummary; 17 had been recorded as asks.
// A tool result has no text, so `s` is empty.
// What the user wrote, without what Claude Code wraps in tags around it: a
// <system-reminder> anywhere, and before the words a slash command's
// <command-name>, a <task-notification>, an IDE's <ide_opened_file>. Read
// whole, an IDE prompt opened with a tag and was no ask, and a <private>
// message after one had its answer saved as the answer to the message before.
// A <private> or <private-session> block is the user's own, and so is text the
// user pasted (<pasted_content>).
// Linear on any input: a regex took 35 s on a tag name of 50,000 `a-`, and
// stalled every hook that read the message.
export const unwrap = (s) => {
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf('<system-reminder>', i), b = a === -1 ? -1 : s.indexOf('</system-reminder>', a);
    if (b === -1) return out + s.slice(i);
    out += s.slice(i, a);
    i = b + '</system-reminder>'.length;
  }
};
// A harness-style name, one with `-` or `_`, is taken off the front; a prompt
// that was one such element (<my-card>, a <template>) would be nothing, and its
// answer filed under the ask before: then only a name Claude Code itself uses
// (task-notification, command-name, local-command-stdout, ide_opened_file,
// agent-message, ...) is taken off, and the element is the ask. Any case: <PRIVATE> too.
const lead = (known) => new RegExp(`^(?:\\s*<(?!private|pasted)(?=${known ? '(?:task-|command-|local-command-|bash-|ide_|agent-message|cross-session-message|teammate-message|user-prompt-submit-hook)\\w' : '[A-Za-z]\\w{0,62}[_-]'})([A-Za-z][\\w-]{0,63})(?=[\\s>])[^>]{0,2000}>[\\s\\S]*?<\\/\\1>)+`, 'i');
const LEAD = lead(false), KNOWN = lead(true);
export const own = (s) => { const u = unwrap(s); return u.replace(LEAD, '').trim() || u.replace(KNOWN, '').trim(); };
// A slash command's record opens with its tags. Quoted anywhere else in a
// prompt (a question about a transcript), the prompt was taken for the command,
// and its <private> parts were missed.
const isCommand = (s) => /^\s*<command-(?:name|message)>/.test(unwrap(s));
// What a prompt starts with is the user's: 4 prompts here began with a paste,
// and read as no ask, each one's answer was saved as the answer to the one before.
// (A record the harness added, or a compaction summary, prompt() turns away first.)
export const asked = (r, s) => {
  if (!s || isCommand(s) || nudged(s)) return false;
  const o = own(s);
  return !!o && !o.startsWith('[SYSTEM:') && !o.startsWith('[Request interrupted');   // "[SYSTEM_SERVICE] ..." is a pasted log line
};
// A slash command's record names it and its arguments, and the user typed
// both. Read as no ask, its reply was saved as the answer to the ask before.
const command = (s) => {
  if (!isCommand(s)) return '';
  // By index too: two adjacent \s* made a run of blanks after the opener quadratic (8 KB took 14 s).
  const o = s.indexOf('<command-name>'), e = o === -1 ? -1 : s.indexOf('</command-name>', o);
  const name = e === -1 ? '' : s.slice(o + '<command-name>'.length, e).trim();
  if (!name || name.length > 200 || name.includes('<')) return '';
  // By index: a regex read on to the end from every opener, 20 s a megabyte.
  const i = s.indexOf('<command-args>'), j = i === -1 ? -1 : s.indexOf('</command-args>', i);
  const a = (j === -1 ? '' : s.slice(i + '<command-args>'.length, j)).trim();
  return `${name.startsWith('/') ? '' : '/'}${name}${a ? ` ${a}` : ''}`;
};
// The prompt a user record opens a turn with, or '' when it opens none. One of
// images only has no words, and opens a turn all the same: read as none, its
// answer was filed under the ask before.
const image = (r) => Array.isArray(r.message?.content) && r.message.content.some((b) => b?.type === 'image');
export const prompt = (r, s) => (r.isMeta || r.isCompactSummary ? '' : command(s) || (asked(r, s) ? own(s) : '') || (!s && image(r) ? '[image]' : ''));
// A turn that ran forget is kept like a private one, in the journal and in
// handoff.md: its listing, saved as the reply and committed with the day, kept
// what it removed (review, 2026-10-29).
// The subcommand only: "memory.mjs" anywhere before the word took a commit
// message or a search for "forget" for one, and dropped a whole turn.
// Options may come first (`--session X forget`, as the CLI takes them),
// quoted as /memory quotes every word typed, with a value that is a negative
// number or none after `=`: each of those was journaled whole (review,
// 2026-10-30). A value never starts with - (but a number), nor is a quoted
// `--`: one that could be the next option too doubled the work per option
// (40 took 7 s). The word quoted too: /memory has Claude quote each word
// typed, the command's with them, and a forget run from it was saved whole.
// A flag with no value can take the next word as one, so a search for
// "forget" after `--shared` is read as a forget: hidden, the safe way to err.
// Read token by token, not with one regex: 64 options was the most a regex could take before it went quadratic, and a command with more
// went unseen. A bare value ends a token the same way wherever the scan starts, so a "memory.mjs" that an earlier scan already took as a
// value is not scanned again (a run of 'memory.mjs --a ' was 64 options per start); one inside a quoted value is, and the steps are capped
// at 8 per character, past which the command counts as a forget (hidden, the safe way to err).
const F_OPT = /\s+(["']?)--[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s"']*))?\1/y, F_VAL = /\s+(?:"(?!--)[^"]*"|'(?!--)[^']*'|-\d+(?!\S)|[^\s"'-]\S*)/y, F_END = /\s+(?:forget\b|'forget'|"forget")/y;
const F_BARE = /\s+[^\s"'-]\S*/y;
const stick = (re, s, at) => { re.lastIndex = at; return re.test(s) ? re.lastIndex : -1; };
// Only .test is supported (not .exec or .source): every caller uses .test.
export const FORGETS = { test(s) {
  const done = new Set(); let steps = 8 * s.length + 64;
  for (const m of s.matchAll(/memory\.mjs["']?/g)) {
    let p = m.index + m[0].length;
    if (done.has(p)) continue;
    for (;;) {
      if (--steps < 0 || stick(F_END, s, p) >= 0) return true;
      const o = stick(F_OPT, s, p);
      if (o < 0) break;
      if (stick(F_END, s, o) >= 0) return true;
      const v = stick(F_VAL, s, o);
      p = v < 0 ? o : v;
      if (v >= 0 && stick(F_BARE, s, o) === v) done.add(v);
    }
  }
  return false;
} };

// The harness's blocks that quote others: an agent's message, a task's end, a
// command's output. What they quote is not the user's, and a red-team report
// quoting <private-session> marked the conversation that read it private.
// By index, at most 50 blocks: linear on any input.
const QUOTES = /<(task-notification|agent-message|teammate-message|local-command-std(?:out|err)|bash-std(?:out|err))\b[^>]{0,200}>/gi;
// A queued message's words: its prompt is a string, or blocks (text beside
// an image). Read as a string, blocks were "[object Object]" and a private
// tag in them went unseen.
export const queuedText = (r) => {
  const p = r.attachment?.prompt;
  return typeof p === 'string' ? p : Array.isArray(p) ? p.map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? String(b.text ?? '') : '')).join(' ') : '';
};
// What the user typed into a tool call's result: the answer to Claude's question (the result of an AskUserQuestion call, by the
// call's id, kept as the calls go by) or the words given with a rejected call. A tag typed there was ignored, and the reply that
// repeated it was saved (e2e audit, 2026-11-01). The answers alone (toolUseResult.answers): the result's words quote Claude's
// question too, and a question that named <private-session> marked the conversation (review, 2026-11-01); the words only for a
// record without them. A rejection by Claude Code's own mark on the record (toolUseResult), not by its words, which an MCP
// server's error can spell out, and only what follows "the user said:". No other tool's output: a file read that quotes
// <private-session> is no mark. One reader a pass: `heard(r)` for every record in order, '' for all but those results.
// shortcut: a question asked before the text read starts (an import's next segment, a look's next chunk) is not known, so its
// answer is not read; carry the ids across if a question and its answer are ever found apart.
export const SAID = 'the user said:';
const resultText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x?.type === 'text' ? String(x.text ?? '') : '')).join(' ') : '');
const picksOf = (r) => { const a = r.toolUseResult?.answers; return a && typeof a === 'object' ? Object.entries(a).map(([q, v]) => [q, String(v)]) : null; };
export const toolAnswers = () => {
  const asks = new Set();
  // heard.picks: the answers of AskUserQuestion read by the last call, one a pick.
  const heard = (r) => {
    heard.picks = [];
    const c = Array.isArray(r?.message?.content) ? r.message.content : [];
    if (r.type === 'assistant') for (const b of c) if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') asks.add(b.id);
    if (r.type !== 'user') return '';
    return c.filter((b) => b?.type === 'tool_result').map((b) => {
      if (asks.has(b.tool_use_id)) { const a = picksOf(r); heard.picks = a ?? []; return a ? a.map((e) => e[1]).join('\n') : resultText(b); }
      if (r.toolUseResult !== 'User rejected tool use') return '';
      const s = resultText(b), i = s.indexOf(SAID);
      return i === -1 ? '' : s.slice(i + SAID.length);
    }).filter(Boolean).join('\n');
  };
  return heard;
};
export const unquote = (s) => {
  let out = '', i = 0;
  for (let n = 0; n < 50; n++) {
    QUOTES.lastIndex = i;
    const m = QUOTES.exec(s);
    const end = m ? s.indexOf(`</${m[1]}>`, m.index) : -1;
    if (end === -1) break;
    out += s.slice(i, m.index);
    i = end + m[1].length + 3;
  }
  return out + s.slice(i);
};

// A result that says the call was refused or blocked and never ran. Claude Code's own first words on a result with is_error true
// (read from real transcripts, 2026-11-17): the user's refusal (also toolUseResult "User rejected tool use"), a PreToolUse hook's
// block, the auto-mode classifier's denial or its outage, and the permission prompt's "multiple operations" stop.
const REFUSED = /^(?:The user doesn't want to proceed with this tool use|Permission for this (?:action|command) was denied|The server-side auto mode classifier gave no verdict|PreToolUse:\S+ hook error|This Bash command contains multiple operations|<tool_use_error>(?:Blocked:|InputValidationError|Subagents should return findings as text))/;
export const refused = (r, b) => b?.is_error === true && (r?.toolUseResult === 'User rejected tool use' || REFUSED.test(resultText(b)));
// What a call ran: the command of a shell tool, the code of context-mode's ctx_execute, the commands of its ctx_batch.
const ranOf = (b) => {
  if (b?.type !== 'tool_use') return '';
  const i = b.input;
  if (/^(Bash|PowerShell)$/.test(b.name)) return i?.command ? String(i.command) : '';
  if (/__ctx_execute$/.test(b.name)) return i?.code ? String(i.code) : '';
  return /__ctx_batch$/.test(b.name) && Array.isArray(i?.commands) ? i.commands.map((c) => String(c?.command ?? c)).join('\n') : '';
};
// The file a tool call edits, or '': the one list of the edit tools, for the
// handoff and the compaction note alike. NotebookEdit names its file differently.
export const editedFile = (b) => (b?.type === 'tool_use' && /^(Edit|Write|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path)) || '';

// What an assistant record asked: its AskUserQuestion questions as text.
const questions = (r) => (Array.isArray(r.message?.content) ? r.message.content.filter((b) => b?.type === 'tool_use' && b.name === 'AskUserQuestion').map((b) => JSON.stringify(b.input?.questions ?? '')).join(' ') : '');

// The most of a turn's text kept while reading: the journal cuts it to its own cap from the start, so the end must be there.
export const SAID_KEEP = 100000;
// Redacted before it is cut: a cut inside a <private> block or a key would leave the rest of it unmarked.
// Cut once past twice that: a cut per block redacted the whole text each time (finding 5, a long turn's Stop). turns() cuts to SAID_KEEP at the end.
export const tailOf = (s, keep = 2 * SAID_KEEP) => (s.length > keep ? clip(s, Infinity).slice(-SAID_KEEP) : s);
// Between a turn's text blocks in `said` (U+2063, invisible, not \s, so clip keeps it): search takes its Result from the text after the last one.
// Entries written before it have none. Every reader that prints `said` or an entry's Answered strips it (memory.mjs unmark).
export const BLOCK = '\u2063';
export const joined = (said, t) => (said ? `${said}\n\n${BLOCK}${t}` : t);
// sidechain: a helper's own conversation file, whose records are all marked isSidechain (journal.mjs's helper entries).
export function turns(tail, { sidechain = false } = {}) {
  const out = [];
  let pending = null;
  const opened = [];
  let said = '';   // the last text Claude wrote
  // A nudge holds the answer for its memory update only; a private message
  // (frozen: true) holds it to the next prompt.
  const hold = (p) => { if (p.frozen !== true) { p.frozen = 'nudge'; p.ended = false; } };
  const heard = toolAnswers();
  // A turn with edits or commands but no reply (Escape, an API error) is still saved: what it changed is true.
  // A refused call is nulled in ran/base/ids (indexes stay put for `look`) and filtered out once at the end.
  const look = new WeakMap(), slot = (p) => look.get(p) ?? look.set(p, { id: new Map(), cmd: new Map() }).get(p);
  const keep = (p) => { if (p && !p.frozen && (p.changed.length || p.ran.some((c) => c !== null)) && out[out.length - 1] !== p) { p.did ||= '[stopped before a reply]'; out.push(p); } };
  // Not a record whose first key is a type nothing here reads (api-request-blob: 7 of 32 MB), and not a subagent's record
  // (isSidechain), as a Claude Code version wrote them into its conversation's transcript: neither the user's words nor the
  // conversation's reply, and a tag it quotes marks nothing (e2e audit, 2026-11-01).
  for (const r of records(tail, { sidechain, types: ['user', 'assistant', 'attachment'] })) {
    // A turn's edits are tool calls with no text: taken before the text test skips them.
    // Once a nudge or a private message froze the turn, what follows is the
    // memory update, or the private part: only a forget of it is kept, below.
    if (r.type === 'assistant' && pending && Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        // Frozen: only a forget is kept, so a turn that ran one still says nothing (F14); a quiet turn lists no commands.
        const cmd = ranOf(b);
        if (cmd && (!pending.frozen || FORGETS.test(cmd))) { const m = slot(pending), n = pending.ids.push(b.id) - 1; pending.ran.push(cmd); pending.base.push(cmd); if (!m.id.has(b.id)) m.id.set(b.id, n); (m.cmd.get(cmd) ?? m.cmd.set(cmd, []).get(cmd)).push(n); }
        const f = pending.frozen ? null : editedFile(b);
        if (!f) continue;
        pending.edits.set(b.id, String(f));
        // The newest edit last, and by path: two index.ts files are two, and
        // a file edited first and last is one of the turn's last.
        const at = pending.changed.indexOf(String(f));
        if (at !== -1) pending.changed.splice(at, 1);
        pending.changed.push(String(f));
      }
    }
    // A call's result: a refused call never ran, an edit that errored changed nothing, and a command that failed keeps the end of
    // its output unless a later call of the same command succeeded (1.5.0). Calls are read optimistically, so one with no result stays.
    if (r.type === 'user' && pending && Array.isArray(r.message?.content)) for (const b of r.message.content) {
      if (b?.type !== 'tool_result') continue;
      const m = slot(pending), i = m.id.get(b.tool_use_id) ?? -1, err = b.is_error === true;
      if (i !== -1) {
        if (refused(r, b)) { m.id.delete(b.tool_use_id); pending.ids[i] = pending.base[i] = pending.ran[i] = null; }
        else {
          for (const j of m.cmd.get(pending.base[i])) if (pending.ran[j] !== null) pending.ran[j] = pending.base[i];   // the earlier tries' tails go: only the last result counts
          if (err) pending.ran[i] = `${pending.base[i]} → failed: ${clip(resultText(b).slice(-20000), Infinity).slice(-300)}`;
        }
      }
      const f = pending.edits.get(b.tool_use_id);
      if (f && err) { pending.edits.delete(b.tool_use_id); if (![...pending.edits.values()].includes(f)) { const at = pending.changed.indexOf(f); if (at !== -1) pending.changed.splice(at, 1); } }
    }
    // Read as typed; normalized (fullwidth, hidden characters) only to find the
    // private tags. Written normalized, `…` and CJK punctuation became ASCII,
    // and every entry an older version wrote was added again beside it.
    // An API error is written as an assistant record of the model "<synthetic>": no reply, so no text of ours.
    if (r.type === 'assistant' && r.message?.model === '<synthetic>') { keep(pending); continue; }
    const t = text(r).trim(), n = r.type === 'user' ? norm(t) : '', told = heard(r);   // n only for a user record: nothing else reads it
    // A pick answering a question that asks for a secret is redacted like a typed answer (BARE); `said` is still the question.
    if (pending && !pending.frozen && heard.picks.length) pending.picked.push(...heard.picks.map(([q, p]) => (BARE(p, q) ? '[redacted]' : p)));
    // A message typed while Claude worked has no user record, only this attachment: it opens a turn too (1.3.2). A private one
    // keeps the older way below (it freezes the turn it came into).
    // Not another session's or a subagent's message (origin.kind peer, isMeta): it is no ask of the user's.
    const q = r.type === 'attachment' && r.attachment?.type === 'queued_command' && !r.attachment.isMeta && r.attachment.origin?.kind !== 'peer' ? queuedText(r).trim() : '';
    let ask = r.type === 'user' ? prompt(r, t) : q && !PRIVATE.test(norm(q)) && asked(r, q) ? own(q) : '';
    // A user record that repeats the queued message just opened is the same ask.
    if (ask && r.type === 'user' && pending?.queued && !pending.did && ask === pending.ask) continue;
    if (ask && PRIVATE.test(norm(ask))) ask = norm(ask);   // any private tag in any spelling: with a plain one too, a fullwidth one was saved
    // What the user typed, tags and all: a slash command's arguments, a
    // wrapper own() strips, a message queued while Claude worked (an
    // attachment record, read by nothing before). Not what the harness quotes
    // (an agent's report or a task's end can quote the mark, and marked the
    // conversation private), nor a record it added, nor a compaction summary.
    // A summary is no part of it at all: it recaps the conversation, and one
    // that named the tag froze the rest of a long turn, its answer hours stale.
    // An answer to Claude's question, or a rejected call's words, too (toolAnswers).
    const mine = r.type === 'user' && !r.isCompactSummary ? unquote(unwrap(told ? `${n}\n${norm(told)}` : n)) : '';
    const typed = r.type === 'user' && !r.isMeta && !r.isCompactSummary ? mine
      : r.type === 'attachment' && r.attachment?.type === 'queued_command' ? unquote(norm(queuedText(r))) : '';
    // Marked whether or not a reply follows: a turn of tool calls, or one
    // the user stopped, writes no entry but must still mark.
    if (PRIVATE_SESSION.test(typed)) out.hush = true;
    // The hold ends with the memory update's own turn. A turn no prompt opened
    // after it (a task's end, an agent's message, in either form, or a
    // compaction) is work again:
    // held to the next prompt, a turn of hours kept the answer from before the
    // nudge, and every result after it was lost (real transcripts, 2026-10-28).
    if (pending?.frozen === 'nudge') {
      if (r.type === 'assistant' && r.message?.stop_reason === 'end_turn') pending.ended = true;
      else if (pending.ended && ((r.type === 'attachment' && r.attachment?.type === 'queued_command') || r.isCompactSummary
        || (r.type === 'user' && /^\s*<task-notification>|<agent-message[\s>]/.test(unwrap(t))))) { pending.frozen = false; pending.reopened = true; }
    }
    // The nudge as hook feedback: an attachment record, not a user one. Its
    // answer is the memory update, not this turn's.
    if (r.type === 'attachment' && /^hook_(?:additional_context|blocking_error)$/.test(r.attachment?.type ?? '')
      && nudged(JSON.stringify(r.attachment.content ?? r.attachment.blockingError ?? ''))) { if (pending) hold(pending); continue; }
    if (r.type === 'assistant') { const qs = questions(r); if (qs) said = qs; }
    if (!t && !ask && !typed) continue;
    if (r.type === 'assistant' && t) said = t;
    if (ask && r.type === 'user' && BARE(ask, said)) ask = '[redacted]';
    // A message queued before a private ask was answered: that answer is to both, and may repeat the private text, so it is not this turn's either.
    const inherit = !!q && !!pending && !pending.did && PRIVATE.test(userText(pending));
    if (ask) { pending = { at: local(r.timestamp), ms: Date.parse(r.timestamp), ask, raw: unwrap(n), queued: !!q, did: '', changed: [], ran: [], base: [], ids: [], edits: new Map(), said: '', picked: [],
      id: r.uuid || '', branch: r.gitBranch && r.gitBranch !== 'HEAD' ? r.gitBranch : '', cwd: r.cwd || '', ...(inherit && { frozen: true }) }; opened.push(pending); }
    // A nudge, or a private message that is no ask: the answer after it is not
    // this turn's, and it is not saved.
    // Not a skill's body (isMeta, opens "Base directory for this skill:"): it names <private> in its own text, and froze the turn
    // with the answer unsaved (1.3.2). Any other isMeta record that names the tag still freezes it.
    else if ((r.type === 'user' || typed) && pending && !(r.isMeta && /^Base directory for this skill:/.test(t)) && /<\s*private/i.test(typed || mine)) pending.frozen = true;
    else if (r.type === 'user' && pending && nudged(t)) hold(pending);
    else if (r.type === 'user' && /^\[Request interrupted by user/.test(t)) keep(pending);
    else if (r.type === 'assistant' && pending) {
      // did: the last text block of the turn (the briefing's), said: all of them (the journal's); neither once a nudge froze it
      if (!pending.frozen) { pending.did = t; pending.said = tailOf(joined(pending.said, t)); pending.reopened = false; }
      if (out[out.length - 1] !== pending) out.push(pending);
    }
  }
  // A turn saved: the strict cut, redacted (its blocks were cut at twice this, unredacted).
  for (const p of out) if (p.said.length > SAID_KEEP) p.said = tailOf(p.said, SAID_KEEP);
  for (const p of opened) for (const k of ['ran', 'base', 'ids']) p[k] = p[k].filter((c) => c !== null);
  out.open = pending;   // the turn the transcript ends in
  out.opened = opened;  // every turn a prompt opened, replied or not (a subagent's start turn)
  return out;
}

// What a turn's privacy is read from: what the user typed and the ask made of
// it, together. Each can keep a tag the other lost -- own() strips a wrapper
// from the ask, and a fullwidth reminder, normalized, swallows what it holds
// -- and read as `raw ?? ask` here but `raw || ask` in the gate, one message
// was private to one and not the other.
export const userText = (t) => `${t.raw ?? ''}\n${t.ask ?? ''}`;

// The project's other sessions, newest first: Claude Code keeps each one's
// transcript, named by its id, in the folder of the folder it started in. The
// store's, and this session's own (`t`) when it started in a subfolder of the
// repository, whose store is the repository's.
// shortcut: a session started in another subfolder is not seen as working;
// scan every project folder's first cwd if that is ever wanted.
export function transcripts(dir, me, t) {
  const folders = [dirname(dir)];
  if (typeof t === 'string' && inProjects(t) && !same(dirname(t), folders[0])) folders.push(dirname(t));
  const all = [];
  for (const project of folders) {
    try {
      for (const f of readdirSync(project)) if (f.endsWith('.jsonl') && tag(f) !== me) all.push({ s: tag(f), p: join(project, f), m: statSync(join(project, f)).mtimeMs });
    } catch {}
  }
  return all.sort((x, y) => y.m - x.m);
}

// When a transcript's last finished turn ended (NaN: none in its tail), how
// many of its last messages are model replies the hooks know, and whether a
// turn is open in it: a prompt, or a reply that did not end the turn, last.
// Whether a reply leaves its turn open: a tool call or a server pause goes on, and so does a record with no stop_reason yet.
// max_tokens, stop_sequence and refusal end the turn (the user is next).
export const goesOn = (m) => !m?.stop_reason || m.stop_reason === 'tool_use' || m.stop_reason === 'pause_turn';
export function lastTurn(p) {
  let end, seen, known, open;
  // Grown as latest() does, only while the tail holds no whole message: a last record over 512 KB (a screenshot) filled it.
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: tail, whole } = readTail(p, bytes);
    ({ end, seen, known, open } = scan(tail));
    if (seen || whole || bytes >= 32e6) return { end, seen, known, open };
  }
}
function scan(tail) {
  let end = NaN, seen = 0, known = 0, open = false;
  for (const r of records(tail)) {   // not a subagent's record, as turns() and the gate skip it
    // Messages only: a session's start-up records (attachments, modes, titles)
    // ran to 41 before its first reply.
    if (r.type === 'user' || r.type === 'assistant') seen++;
    // Not a slash command: a local one (/exit, /model) gets no reply, and the
    // turn it opened never closed.
    if (r.type === 'user' && !text(r).includes('<command-name>') && prompt(r, text(r).trim())) open = true;
    // Stopped with Escape: closed, though no reply ended it. Not an end for
    // stalled(): no Stop hook runs for it. Read as open, the startup said
    // another session was working here for half an hour (audit, 2026-10-28).
    if (r.type === 'user' && /^\s*\[Request interrupted by user/.test(text(r))) { open = false; continue; }
    if (r.type !== 'assistant' || !r.message?.usage) continue;
    known++;
    open = goesOn(r.message);
    if (!open) end = Date.parse(r.timestamp);
  }
  return { end, seen, known, open };
}
