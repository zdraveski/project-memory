#!/usr/bin/env node
// Run by the Stop hook (memory-tier.mjs, in-process): after EVERY assistant
// turn, refresh the auto section of the project's handoff.md from the
// transcript. SessionEnd is not enough -- a crash, a closed window or a
// killed process never reaches it, and the narrative for that session is then
// gone. This costs no model call: the transcript already holds what was asked
// and what was answered.
//
// It rewrites ONLY the text between the markers. Everything a person or a
// session wrote by hand around them is left alone.
//
// Several sessions can share one project. Each entry carries its session's tag,
// each session keeps its own last ten, and the file is written by one hook at a
// time (store.mjs).
//
// What it writes stays until newer exchanges replace it -- the snapshots leave
// this file out -- and what must not be written is kept out before it is:
// secrets (SECRETS), the answer to a <private> message and the files its turn
// changed (answer()), and every entry of a conversation marked
// <private-session> (hushed()).
import { readFileSync, existsSync, openSync, readSync, closeSync, fstatSync, readdirSync, statSync, statfsSync, realpathSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { storeOf, withLock, replaceIfUnchanged, projectsRoot, sharedStore, SHARED_BUDGET, local, POINTER, ARCHIVE, same, memoryOff, pathKey, transcriptKey, raw, listOf, inProjects, BUSY, sleep, STEP, HANDOFF_FAILED, JOURNAL_FAILED } from './store.mjs';

const TURNS = 10;         // how many exchanges to keep, per session
const SESSIONS = 3;       // how many sessions: parallel work keeps the depth one session had alone
// The startup briefing prints these exchanges whole, a line each under fit()'s
// 1,000 at startup: detail over tokens (KIRE, 2026-10-31; were 240 and 400).
const ASK = 500;          // chars kept of what was asked
const DID = 900;          // chars kept of the answer
const CHANGED = 8;        // files an entry names: the turn's last
export const TAIL = 512_000;     // first read; grown 4× until it reaches the latest prompt
export const ACTIVE = 30 * 60000;    // a transcript this recently changed: its session is still working
export const GRACE = 60000;   // the Stop hook runs seconds after a turn ends
const RECENT = 7 * 86400000;  // older than this, the startup line has nothing to say
// What compact-gate's Stop nudge opens with. `asked()` skips it, and `turns()`
// freezes the turn's answer at it: the words written after it are the memory
// update, not what the turn did. Named for the plugin: `[SYSTEM: ...]`, its
// label before 1.1.0, read as text posing as Claude Code's own, and
// transcripts from then still carry it.
export const NUDGE_TAG = '[project-memory: compaction gate]';
const NUDGE_TAGS = [NUDGE_TAG, '[SYSTEM: compaction gate]'];
const START = '<!-- auto:start -->';
const END = '<!-- auto:end -->';

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
const unwrap = (s) => {
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf('<system-reminder>', i), b = a === -1 ? -1 : s.indexOf('</system-reminder>', a);
    if (b === -1) return out + s.slice(i);
    out += s.slice(i, a);
    i = b + '</system-reminder>'.length;
  }
};
// Only a harness-style name, one with `-` or `_` (every tag Claude Code puts
// before a prompt here: task-notification, command-name, local-command-stdout,
// ide_opened_file): a prompt that was one <template> element was stripped to
// nothing, and its answer filed under the ask before. Any case: <PRIVATE> too.
export const own = (s) => unwrap(s)
  .replace(/^(?:\s*<(?!private|pasted)(?=[A-Za-z]\w{0,62}[_-])([A-Za-z][\w-]{0,63})(?=[\s>])[^>]{0,2000}>[\s\S]*?<\/\1>)+/i, '').trim();
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
  return !!o && !o.startsWith('[SYSTEM') && !o.startsWith('[Request interrupted');
};
// A slash command's record names it and its arguments, and the user typed
// both. Read as no ask, its reply was saved as the answer to the ask before.
const command = (s) => {
  if (!isCommand(s)) return '';
  const n = s.match(/<command-name>\s*([^<]{1,200}?)\s*<\/command-name>/);
  if (!n) return '';
  // By index: a regex read on to the end from every opener, 20 s a megabyte.
  const i = s.indexOf('<command-args>'), j = i === -1 ? -1 : s.indexOf('</command-args>', i);
  const a = (j === -1 ? '' : s.slice(i + '<command-args>'.length, j)).trim();
  return `${n[1].startsWith('/') ? '' : '/'}${n[1]}${a ? ` ${a}` : ''}`;
};
// The prompt a user record opens a turn with, or '' when it opens none. One of
// images only has no words, and opens a turn all the same: read as none, its
// answer was filed under the ask before.
const image = (r) => Array.isArray(r.message?.content) && r.message.content.some((b) => b?.type === 'image');
export const prompt = (r, s) => (r.isMeta || r.isCompactSummary ? '' : command(s) || (asked(r, s) ? own(s) : '') || (!s && image(r) ? '[image]' : ''));
// A <private> block's opener, and the <private-session> mark: in any case,
// with spaces or attributes, self-closed, or as private_session. Only the
// exact forms counted, and `<private-session/>` recorded the conversation.
// An opener never closed with `>` runs to the end: `<private my pin` was saved.
export const PRIVATE = /<\s*private(?![-_\w])(?:[^>]*>|[^>]*$)/i;
// Bounded: with no `>`, 256 KB of openers took 5 s a test.
export const PRIVATE_SESSION = /<\s*private[-_]session\b[^>]{0,200}>/i;
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
export const FORGETS = /memory\.mjs["']?(?:\s+(["']?)--[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s"']*))?\1(?:\s+(?:"(?!--)[^"]*"|'(?!--)[^']*'|-\d+(?!\S)|[^\s"'-]\S*))?)*\s+(?:forget\b|'forget'|"forget")/;
// Text read the same in any width and without hidden characters: a fullwidth
// ＜private＞, or a zero-width space inside the tag, kept what it should hide.
// Every character Unicode says to show as nothing (Default_Ignorable_Code_Point): with the five zero-width ones alone, a soft
// hyphen, a left-to-right mark (an RTL keyboard's, or a paste's), a bidi control or a variation selector inside the tag kept it
// (e2e audit, 2026-11-01).
export const norm = (s) => s.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
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
const SAID = 'the user said:';
const resultText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x?.type === 'text' ? String(x.text ?? '') : '')).join(' ') : '');
const answersOf = (r) => { const a = r.toolUseResult?.answers; return a && typeof a === 'object' ? Object.values(a).map(String).join('\n') : null; };
export const toolAnswers = () => {
  const asks = new Set();
  return (r) => {
    const c = Array.isArray(r?.message?.content) ? r.message.content : [];
    if (r.type === 'assistant') for (const b of c) if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') asks.add(b.id);
    if (r.type !== 'user') return '';
    return c.filter((b) => b?.type === 'tool_result').map((b) => {
      if (asks.has(b.tool_use_id)) return answersOf(r) ?? resultText(b);
      if (r.toolUseResult !== 'User rejected tool use') return '';
      const s = resultText(b), i = s.indexOf(SAID);
      return i === -1 ? '' : s.slice(i + SAID.length);
    }).filter(Boolean).join('\n');
  };
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
export { unwrap };

// A session's short tag: enough to tell parallel sessions apart in one file.
export const tag = (id) => String(id || '').slice(0, 8);

// The file a tool call edits, or '': the one list of the edit tools, for the
// handoff and the compaction note alike. NotebookEdit names its file differently.
export const editedFile = (b) => (b?.type === 'tool_use' && /^(Edit|Write|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path)) || '';

export function turns(tail) {
  const out = [];
  let pending = null;
  // A nudge holds the answer for its memory update only; a private message
  // (frozen: true) holds it to the next prompt.
  const hold = (p) => { if (p.frozen !== true) { p.frozen = 'nudge'; p.ended = false; } };
  const heard = toolAnswers();
  for (const line of tail.split('\n')) {
    if (!line.startsWith('{')) continue;        // a tail starts mid-line
    let r; try { r = JSON.parse(line); } catch { continue; }
    // A subagent's record (isSidechain), as a Claude Code version wrote them into its conversation's transcript: neither the
    // user's words nor the conversation's reply, and a tag it quotes marks nothing (e2e audit, 2026-11-01).
    if (r.isSidechain === true) continue;
    // A turn's edits are tool calls with no text: taken before the text test skips them.
    // Once a nudge or a private message froze the turn, what follows is the
    // memory update, or the private part: only a forget of it is kept, below.
    if (r.type === 'assistant' && pending && Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        // Frozen: only a forget is kept, so a turn that ran one still says nothing (F14); a quiet turn lists no commands.
        if (b?.type === 'tool_use' && /^(Bash|PowerShell)$/.test(b.name) && b.input?.command && (!pending.frozen || FORGETS.test(String(b.input.command)))) pending.ran.push(String(b.input.command));
        const f = pending.frozen ? null : editedFile(b);
        if (!f) continue;
        // The newest edit last, and by path: two index.ts files are two, and
        // a file edited first and last is one of the turn's last.
        const at = pending.changed.indexOf(String(f));
        if (at !== -1) pending.changed.splice(at, 1);
        pending.changed.push(String(f));
      }
    }
    // Read as typed; normalized (fullwidth, hidden characters) only to find the
    // private tags. Written normalized, `…` and CJK punctuation became ASCII,
    // and every entry an older version wrote was added again beside it.
    const t = text(r).trim(), n = norm(t), told = heard(r);
    let ask = r.type === 'user' ? prompt(r, t) : '';
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
    if (!t && !ask && !typed) continue;
    if (ask) pending = { at: local(r.timestamp), ask, raw: unwrap(n), did: '', changed: [], ran: [],
      id: r.uuid || '', branch: r.gitBranch && r.gitBranch !== 'HEAD' ? r.gitBranch : '', cwd: r.cwd || '' };
    // A nudge, or a private message that is no ask: the answer after it is not
    // this turn's, and it is not saved.
    else if ((r.type === 'user' || typed) && pending && /<\s*private/i.test(typed || mine)) pending.frozen = true;
    else if (r.type === 'user' && pending && nudged(t)) hold(pending);
    else if (r.type === 'assistant' && pending) {
      if (!pending.frozen) { pending.did = t; pending.reopened = false; }     // last text block of the turn wins, unless a nudge froze it
      if (out[out.length - 1] !== pending) out.push(pending);
    }
  }
  out.open = pending;   // the turn the transcript ends in
  return out;
}

// A secret pasted into a message is never written: the snapshots would keep it
// for good. A key or token is known by its issuer's prefix, or by the word
// before it; anything in <private>...</private> goes whole. Before clipping,
// so no half of a key is left behind.
// A value that is plainly code, not a secret: a type (`password: string`),
// a reference (`${DB_PASSWORD}`, `$(cat f)`, `process.env.X`), a call or an
// index with no digit (`jwt.sign(payload`, `request.form[`), a path of two
// parts or more. 25 of 35 ordinary lines were cut; but a value with a `_` or
// a `.` in it is no code (correct_horse_battery_staple, Summer.Sunshine), and
// a looser rule let those through.
// A member whose last name is the secret's own word (`user.password`,
// `this.apiKey`, `settings.SECRET_KEY`) is a reference to one, not one.
const code = (v) => /^\$[{(]|^(?:process\.env[.[]|os\.environ|os\.getenv|System\.getenv|ENV\[)/.test(v)
  || (!/\d/.test(v) && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v) && /(?:pass|secret|token|key|pwd|auth|cred)\w*$/i.test(v))
  || /^(?:string|number|boolean|str|int|bytes|any|unknown|null|undefined|none|true|false|object|bool|float|char|optional|secretstr)$/i.test(v)
  || (!/\d/.test(v) && (/^[A-Za-z_$][\w$.]*[([]/.test(v) || /^(?:\/|~\/|[A-Za-z]:[\\/])[^\s/\\]+[\\/]/.test(v)));
// A command's argument that is no secret itself: a reference ($TOKEN,
// ${TOKEN}, $(cat pw): the shell expands it) or a path (~/.ssh/id_ed25519,
// ./pw.txt, /etc/x/y, certs/key.pem). Cut, the word a search would find was
// lost (review, 2026-10-29). Not a number: after --password or TOKEN= it is a
// PIN (R34).
const arg = (v) => /^\$[{(A-Za-z_]|^~|^\.{1,2}[\\/]|^\/[^\s/]+\/|[\\/]\S*\.[A-Za-z]\w{0,7}$/.test(v);
// A variable's name that holds a secret: one of its _-parts is the word (not
// KEYBOARD or MONKEY), and it doesn't name a file (KEY_FILE, PUBLIC_KEY_PATH).
const named = (n) => {
  const ps = n.toUpperCase().split('_');
  return ps.some((p) => /^(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD)$/.test(p)) && !/^(?:FILE|PATH|DIR|NAME|ID)$/.test(ps.at(-1));
};
// A number under a count's name (TOKEN_LIMIT, MAX_TOKEN, SECRET_PORT): no
// secret, as only a count-like whole part says (R34).
const counted = (n, v) => /^\d+$/.test(v) && n.toUpperCase().split('_').some((p) => /^(?:LIMIT|MAX|MIN|SIZE|COUNT|LEN|TTL|TIMEOUT|BYTES|PORT)$/.test(p));
// A .env name that holds a secret: its last `_`-part is the word (SIGNING_KEY, DB_PASSWORD). One whose word comes first names
// something else (KEY_ALGORITHM, TOKEN_URL, SECRET_BACKEND); a name with SECRET or PASSWORD anywhere the setting rule reads anyway.
const envNamed = (n) => /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD)$/.test(n);
// A YAML child's value under a secret's key, whose own name says nothing: a secret has a digit or a symbol, a PIN too (not a
// name such as `apiKey`, `tls-cert` or `production`); under `tokens:` a token's length too, 16 or more with a letter and a digit
// (not a colour, `blue-500`, a model's name or a count).
const yamlSecret = (v, tok) => (tok ? v.length >= 16 && /\d/.test(v) && /[A-Za-z]/.test(v) : /[\d!@#$%^&*+=?~]/.test(v));
const SECRETS = [
  // From the first opener to the last closer: nested, the text after the inner
  // closer was saved. Self-closed or unclosed, to the end.
  [/<\s*private(?![-_\w])(?:[^>]*>(?:[\s\S]*<\s*\/\s*private\s*>|[\s\S]*)|[^>]*$)/gi, '[private]'],
  // PGP's says PRIVATE KEY BLOCK.
  // Bounded: `-----BEGIN ` then `PRIVATE KEY ` repeated took 20 s a megabyte.
  [/-----BEGIN [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----|$)/g, '[redacted]'],
  // sk-... (Anthropic, OpenAI); sk_live_, pk_test_, rk_live_ (Stripe).
  [/\b(?:sk|rk|pk)(?:-|_(?:live|test)_)[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g, '[redacted]'],
  [/\bxox[abeprs]-[A-Za-z0-9-]{10,}|\bxapp-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  // AWS keys, long-lived and STS.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  // With a digit in it, or 32 characters or more: "Basic implementation/approach" and "Bearer authentication-header" were prose,
  // and were cut; a long one with no digit (1 in 400 random ones) was kept (audit #7). A hidden character after the word, as
  // redact() sees the raw text, does not hide the value. The long one has no . or /, so "basic tests/integration/x.rb" is kept.
  [/\b(Bearer|Basic|Token)[ \p{Default_Ignorable_Code_Point}]+(?=[A-Za-z0-9._~+/=-]{0,200}\d|[A-Za-z0-9_~+=-]{32})[A-Za-z0-9._~+/=-]{20,}/giu, '$1 [redacted]'],
  // GitLab, npm and Hugging Face tokens; a Slack webhook is its own secret.
  [/\bglpat-[A-Za-z0-9_-]{20,}|\bnpm_[A-Za-z0-9]{36}\b|\bhf_[A-Za-z0-9]{30,}/g, '[redacted]'],
  // PyPI, Stripe webhooks, SendGrid, Google OAuth, Groq, xAI, Shopify,
  // DigitalOcean, Notion, Atlassian, Vault, Docker; and a PEM key in base64
  // (kubeconfig's client-key-data).
  [/\bpypi-AgE[A-Za-z0-9_-]{20,}|\bwhsec_[A-Za-z0-9+/=]{20,}|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bya29\.[A-Za-z0-9_-]{20,}|\bgsk_[A-Za-z0-9]{20,}|\bxai-[A-Za-z0-9]{20,}|\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}|\bdop_v1_[a-f0-9]{64}|\bntn_[A-Za-z0-9]{20,}|\bATATT[A-Za-z0-9_=-]{20,}|\bhvs\.[A-Za-z0-9_-]{20,}|\bdckr_pat_[A-Za-z0-9_-]{20,}|\bpplx-[A-Za-z0-9]{40,}|\b\d{8,10}:AA[\w-]{33}\b|\blin_api_[A-Za-z0-9]{30,}|\bPMAK-[A-Za-z0-9-]{40,}|\br8_[A-Za-z0-9]{30,}|\bsbp_[a-f0-9]{40}\b|\bdapi[a-f0-9]{32}\b|\bsntrys_[A-Za-z0-9+/=_-]{20,}|\bSK[0-9a-f]{32}\b|\bkey-[0-9a-f]{32}\b|\bsk\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}/g, '[redacted]'],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1[redacted]'],
  [/(discord(?:app)?\.com\/api\/webhooks\/\d{1,25}\/)[\w-]+/g, '$1[redacted]'],
  // A session cookie logs anyone in: a Cookie / Set-Cookie header (name=value inside it), and curl's -b / --cookie value (not a jar file).
  // The curl rule first: the header rule reads to the next quote, which may be the one that opens a -b value.
  [/(\bcurl\b[^\n|;&]{0,300}?\s(?:-b|--cookie)[ =]+["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|[^\s"']+)/g, (m, pre, v) => (v.includes('=') ? `${pre}[redacted]` : m)],
  [/((?:^|[\s'"])(?:set-)?cookie["']?[ \t]*:[ \t]*["']?)(?=[^'"\n=]{1,100}=)[^'"\n]{1,4000}/gim, '$1[redacted]'],
  // A signed URL's signature is the credential (Azure SAS, S3, GCS).
  [/([?&](?:sig|X-Amz-Signature|X-Goog-Signature)=)[^&\s]{16,}/gi, '$1[redacted]'],
  // The password in a URL: postgres://user:it@host, redis://:it@host (no
  // user), one with an @ in it (to the last one). Not a query: a port
  // before `?user=me@x` was cut as a password.
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{0,100}:)[^\s/?#]{1,200}@/gi, '$1[redacted]@'],
  // curl -u user:it, --user user:it, quoted too, to the closing quote (review, 2026-11-01). Not `docker run -u 1000:1000`, a user
  // and group.
  [/((?:^|\s)(?:-u|--user)[ =]+["']?(?!\d+:\d+(?![^\s'"]))[^\s:'"]{1,100}:)(?:(?<="[^\s:'"]{1,100}:)[^"\n]{1,200}(?=")|(?<='[^\s:'"]{1,100}:)[^'\n]{1,200}(?=')|[^\s'"]{1,200})/g, '$1[redacted]'],
  // --password it (--token, --client-secret); docker login, az login, sshpass
  // and twine take it as -p it. Not --no-password, whose next word is the
  // command's own; nor "the --token flag", in prose.
  // Quoted, as a value with symbols or blanks must be, to its closing quote: the opening quote refused, each was kept (e2e audit,
  // 2026-11-01). A quoted one may start with `-`; a bare one that does is the next option (review, 2026-11-01).
  [/(--(?!no-)(?:[a-z]+-){0,3}(?:password|passwd|token|secret)[ =]["']?|\b(?:(?:docker|podman|az|oc)\s+login|sshpass|twine\s+upload)\b[^\n|;&]{0,200}?\s-p\s+["']?)(?!(?:flag|option|argument|parameter|value|field|setting)s?\b)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // A secret as a command's argument, which the journal's Ran field keeps (P1
  // hunt, 2026-10-29): `aws configure set` of a secret, key or token; a
  // SetEnvironmentVariable or setx of one; htpasswd -b's password, after its
  // file (none with -n) and user, before any redirect (-n prints, so one
  // follows: `> .htpasswd` was taken for the password); an exported name whose
  // word is a key's; gh secret set's body; an npm registry's _authToken.
  // Quoted values here and below to the closing quote, as above (review, 2026-11-01).
  [/(\baws\s+configure\s+set\s+[\w.-]{0,100}(?:secret|key|token)[\w.-]{0,100}\s+["']?)(?!-)(?:(?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']+)/gi, '$1[redacted]'],
  [/(SetEnvironmentVariable\(\s*["']([^"'\n]{1,100})["']\s*,\s*["'])([^"'\n]+)/gi, (m, pre, name, v) => (named(name) && !arg(v) && !counted(name, v) ? `${pre}[redacted]` : m)],
  [/(\bhtpasswd(?:\s+-[A-Za-z]+(?:\s+\d+)?)*?\s+-[A-Za-z]*b[A-Za-z]*(?:\s+-[A-Za-z]+(?:\s+\d+)?)*\s+(?:[^\s<>-]\S*\s+)?[^\s<>]+\s+)(?!\d*>)[^\s;|&<>]+/g, '$1[redacted]'],
  // The name read whole, then judged: as words in one pattern, KEY_ repeated
  // took 28 s. PowerShell's `$env:NAME = …` too, in any case, as export's is (e2e audit, 2026-11-01).
  [/((?:\b(?:export\s+([A-Za-z_]\w{0,100})=|setx[ \t]+([A-Za-z_]\w{0,100})[ \t]+)|\$env:([A-Za-z_]\w{0,100})[ \t]*=[ \t]*)["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]+)/gi, (m, pre, a, b, c, v) => (named(a ?? b ?? c) && !arg(v) && !code(v) && !counted(a ?? b ?? c, v) ? `${pre}[redacted]` : m)],
  // A .env line at a line's start (e2e audit, 2026-11-01): only its own shape, an upper-case name with no blank before `=`, whose
  // last part is the secret's word (envNamed). Any `name = value` was read as one, and Python's `key = item.name`, `CACHE_KEY =
  // "x"` and `TOKEN_URL=https://…` were cut (review, 2026-11-01). Its close relatives too: a compose list item's `- NAME=…`, cmd's
  // `set NAME=…`, and one after a shell's `&&`, `||`, `;` or `|` (an inline variable before a command).
  [/((?:^[ \t]*(?:-[ \t]+)?|(?:&&|\|\||[;|])[ \t]*)(?:(?:export|set|SET)[ \t]+)?([A-Z][A-Z0-9_]{0,100})=["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]+)/gm, (m, pre, n, v) => (envNamed(n) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  // A Kubernetes env entry, `- name: NAME` then `value: …` on the next line, judged by the name as a .env line is (review,
  // 2026-11-01).
  [/(-[ \t]+name:[ \t]*["']?([A-Za-z_][A-Za-z0-9_]{0,100})["']?[ \t]*\r?\n[ \t]+value:[ \t]*["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']+)/g,
    (m, pre, n, v) => (envNamed(n.toUpperCase()) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  [/(\bgh\s+secret\s+set\b[^\n|;&]{0,200}?\s(?:--body|-b)[ =]["']?)([^\s"']+)/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  [/(:_authToken[ =]["']?)([^\s"']+)/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // `mysql -pIT`: the password glued to the flag. Case kept: -P is the port.
  // In the mysql command only: `; find . -print` after it was cut.
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p)[^\s-][^\s]{2,}/g, '$1[redacted]'],
  // "my password is IT": one with a digit or a symbol, as a password has --
  // "the password is hashed" names none.
  // Also "the password for the prod db is IT", "the api key is IT", and
  // "password IT" with no verb, when IT has a letter and a digit.
  [/\b((?:password|passwd|passphrase|api[ _-]?key|token|secret)(?:\s{1,5}(?:for|of|to)\s{1,5}[^.,;:\n]{1,40}?)?\s{1,5}(?:is|was)\s{1,5})["']?(?=\S*[0-9!@#$%^&*_+=-])[^\s"',;]{3,}[^\s"',;.]/gi, '$1[redacted]'],
  [/\b((?:password|passwd)\s{1,3})(?=[^\s"',;]{0,200}\d)(?=[^\s"',;]{0,200}[A-Za-z])[^\s"',;:]{6,}/gi, '$1[redacted]'],
  // The word can end a longer name, glued (PGPASSWORD=, dbPassword, clientSecret,
  // stripeApiKey) or not (DB_PASSWORD=, AWS_SECRET_ACCESS_KEY=), and the value
  // can sit on the next line (YAML). `pwd` needs its own start. Bounded, so no
  // input backtracks. Not a bare `token`: "input_tokens: 863324" is a count.
  // `pass` alone too (DB_PASS=, pass:), and a key's data. Not a value that
  // is plainly code: `password: string`, `token = jwt.sign(payload`,
  // `secret: process.env.JWT_SECRET`, `${DB_PASSWORD}`, a path.
  // Each child of a YAML parent key that names a secret (`passwords:\n  admin: X\n  root: Y`, `secrets:\n  db: X`): only the
  // parent's name says what they are (e2e audit, 2026-11-01). Only the lines indented under it, and only a value that looks like a
  // secret (yamlSecret): read on to any indented line, the siblings after it were cut (GitHub Actions' runs-on, Helm's username),
  // and so were names and settings under it (OpenAPI's `type: apiKey`, design tokens) (review, 2026-11-01). A child a line, each
  // line read once: linear.
  [/^([ \t]*)((?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?[ \t]*:[ \t]*\r?\n)((?:\1[ \t]+[\w.-]{1,40}[ \t]*:[^\n]{0,500}(?:\n|$))+)/gim,
    (m, ind, head, tok, block) => ind + head + block.replace(/^([ \t]+[\w.-]{1,40}[ \t]*:[ \t]*["']?)([^\s"',;]{6,})/gm, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))],
  // The same in JSON: each string in an object under a key that names a secret (`"secrets": {"db": "…"}`), judged as a YAML child
  // is (review, 2026-11-01). An object of one level only, read to its first `}`, bounded.
  [/("(?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?"[ \t]*:[ \t]*\{)([^{}]{0,2000})\}/gi,
    (m, head, tok, body) => `${head}${body.replace(/("[\w.-]{1,40}"[ \t]*:[ \t]*")([^"\n]{6,200})(?=")/g, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))}}`],
  // A value is never a key (a name and a colon with more after it: blanks then a value on its line, or a line break then an
  // indented child): taken for the parent's value, the child after it was kept (`secret:\n  password: X`, `secret: password: X`;
  // e2e audit, 2026-11-01). Only that shape: a value ending in `:` before a blank or at its line's end was taken for a key, and
  // a password such as `"Tr0ub4dor&3:"` or `Tr0ub4dor3:` was kept (review rounds 1 and 2, 2026-11-01).
  // A quoted value goes whole, blanks and all, as in a command; it is never a key. Unquoted, a value ends at its first blank
  // (`password: p@ss w0rd` keeps all of it: `p@ss` is under 6), since prose follows a value as often as a second word does.
  // An Azure connection string's SharedAccessKey too, not its SharedAccessKeyName (e2e audit, 2026-11-01).
  [/((?:password|passwd|passphrase|secret|(?:access|auth|refresh|api|session)[_-]?token|(?:api|account|private|secret)[ _-]?key|access[ _-]key|sharedaccesskey(?!name)|key-data|(?<![A-Za-z0-9])pwd|(?<![A-Za-z0-9])pass(?![a-z]))[A-Za-z0-9_]{0,40}["']?[ \t]{0,20}[:=]\s{0,20}["']?)((?<=")[^"\n]{6,200}(?=")|(?<=')[^'\n]{6,200}(?=')|(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))[^\s"',;]{6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
  // A bare `token=` or `token:` whose value has a letter: a key, not a count.
  [/((?<![A-Za-z0-9])tokens?[ \t]{0,20}[:=]\s{0,20}["']?)(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))(?=[^\s"',;]{0,200}[A-Za-z])([^\s"',;]{6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
];
export const redact = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);
// The answer to a private message often repeats what it was told, so it is
// withheld whole.
export const answer = (ask, did, n) => (PRIVATE.test(ask) ? '[private]' : clip(plain(did), n));
// What a turn's privacy is read from: what the user typed and the ask made of
// it, together. Each can keep a tag the other lost -- own() strips a wrapper
// from the ask, and a fullwidth reminder, normalized, swallows what it holds
// -- and read as `raw ?? ask` here but `raw || ask` in the gate, one message
// was private to one and not the other.
export const userText = (t) => `${t.raw ?? ''}\n${t.ask ?? ''}`;

// Marker text inside an ask or an answer would become the section boundary on
// the next run and strand every entry before it as prose, and a tag printed at
// startup (`</system-reminder>`) could end the wrapper Claude Code puts the
// briefing in and pose as its own text. No tag survives: `<` before a letter,
// `/`, `!` or `?` is written `&lt;`, and so is one with spaces or hidden
// characters before it (`< /system-reminder>`), or in another width (＜, ﹤).
// A line break that is not \n (a lone \r, U+2028, U+0085) is a space: in a
// shared index line or a health message it started a line of its own, and
// posed as one.
// Never half an emoji, and no lone surrogate: one is written as U+FFFD, the
// entry read back no longer matched its turn, and the turn was added again every Stop.
export const defuse = (s) => s.replace(/[<\uFF1C\uFE64](?=[\u200B-\u200D\u2060\uFEFF]*[A-Za-z/!?]|\s+\/)/g, '&lt;')
  .replace(/\r(?!\n)|[\u2028\u2029\u0085]/g, ' ');
// Cut until a cut changes nothing, so an entry as written (clipped again by render) is the turn as read, to latest() and to forget, and
// what the journal stores (clipped once) is what handoff.md shows (F15, F19, R36, R44). One more cut was not enough: a cut can leave a
// code reference (api_key = proces…) that reads as a secret, defuse's `&lt;` gives a value the symbol a password has, and a value one
// pattern keeps as a path is half redacted by a later one, which the first then takes. Bounded at 7 cuts, what a clip of 2,000 can
// need: a `-u` value is redacted 200 characters a pass, so a run of over about 1,300 clipped at Infinity (a journal entry, kept
// whole, or a search's display) can stop short of stable (B3). Nothing else the tests build takes more than 2.
// Kept for the process, by length and text: a Stop clips each turn of its read several times (latest(), the fresh entries, the
// journal's), and each clip is four passes of every secret pattern or more (release review). clip is pure: redact(),
// defuse() and cut() read no state and no environment, so a clip kept is the clip again, whatever store the run is for.
// shortcut: emptied once its texts pass 8 M characters (a Stop's 512 KB read keeps about 1 M), so a read near latest()'s 32 MB
// redoes some of its redaction; make it an LRU if a long-lived process ever clips that much.
const clipped = new Map();
let clippedSize = 0;
export const clip = (s, n) => {
  // Text only: anything else spelt as a text kept here fails in cut(), as it always did.
  const k = typeof s === 'string' ? `${n}\0${s}` : null;
  if (clipped.has(k)) return clipped.get(k);
  let out = cut(s, n);
  for (let i = 0; i < 6; i++) { const again = cut(out, n); if (again === out) break; out = again; }
  if (k !== null) { if ((clippedSize += k.length) > 8e6) { clipped.clear(); clippedSize = k.length; } clipped.set(k, out); }
  return out;
};
const cut = (s, n) => {
  // Redacted before the blanks are squeezed and after. After only, a bare flag that ends a line took the next line's keyword as its value,
  // and that line's own secret was kept whole (F23, R59); before only, a secret after two blanks or a tab was redacted only when the entry
  // was clipped again (F19). U+0085 is made a line break first: it is not \s in JavaScript, and the first pass took it for a value.
  const one = defuse(redact(redact(s.replace(/\u0085/g, '\n')).replace(/\s+/g, ' '))).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD').trim();
  if (one.length <= n) return one;
  // Ends at the last sentence, else the last word, in the second half of the room: a cut mid-sentence kept
  // a claim and dropped the condition after it ("deploy" without "only on Windows"; survive.mjs).
  const room = one.slice(0, n), half = n / 2;
  const sentence = room.match(/^.*[.!?](?=\s)/)?.[0], word = room.match(/^(.*) /)?.[1];
  if (sentence?.length >= half) return sentence + '…';
  if (word?.length >= half) return word + '…';
  return one.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
};

// An answer is markdown, and its marks carry no words: heading hashes, bold,
// table rules and pipes cost characters a 400-character entry cannot spare
// ("## What a surety agent is **The 3 parties in a bond:** ...", 2026-10-26).
// Line by line, and no pattern that can match a newline: a `\s` in the rule
// pattern was cubic on blank lines -- 800 of them took a second, every Stop.
// Only marks are dropped: `2**32 and 2**64`, `**kwargs`, `__init__.py` and
// `a || b` keep their meaning. Bold opens after a space or the line start and
// closes before a space, punctuation or the line end, hugging its words.
export const plain = (s) => s.split('\n')
  .filter((l) => !(l.includes('-') && /^[ \t|:-]*$/.test(l)))   // a table rule, or a horizontal one
  .map((l) => (l.trimStart().startsWith('|') ? l.replace(/\|/g, ' ') : l).replace(/^#{1,6}[ \t]+/, '')
    .replace(/(^|[ \t(])\*\*(?=[^\s*])([^*]*?[^\s*])\*\*(?=$|[\s).,:;!?])/g, '$1$2'))
  .join('\n');

// One turn can be megabytes of tool output, so a fixed tail read nothing on
// 65 of 76 transcripts here. Grow until the latest prompt is inside it, and
// back to `since`, the last turn the section holds for this session (its time
// and ask; by the minute alone, a turn skipped in that same minute was lost): a turn
// skipped while another hook held the store, then pushed out of the tail by a
// long next turn, was never written. Bounded: about 32 MB (2 ** 25 let it grow
// once more, to 128 MB).
// A turn's ask and answer as handoff.md shows them: one rule for the writer
// and for latest(), which looks for the last one written. Matched against the
// turn as read, a turn that ran forget (shown [private]) was never found, and
// the next Stop read up to four times the transcript, the last 32 MB.
const shown = (t) => {
  // A turn that ran forget says nothing, as a private one.
  const gone = t.ran.some((c) => FORGETS.test(c));
  const ask = gone ? '[private]' : clip(t.ask, ASK);
  // As render writes it: an ask that quotes [private] has no answer either (I2, R36).
  return { ask, did: gone || ask.includes('[private]') ? '[private]' : answer(userText(t), t.did, DID) };
};
// `all`: on to the whole file whatever the tail holds, for a hint that would not read (F21).
function latest(path, since = null, all) {
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: tail, whole } = readTail(path, bytes);
    const got = turns(tail);
    const same = (t) => { const e = shown(t); return e.ask === since.ask && e.did === since.did; };
    const there = since && got.some((t) => t.at === since.at && same(t));
    // The newest entry's turn read at another minute, and not at its own: the
    // clock moved to another zone, and every entry of this conversation is in
    // the old one. Read on to the whole file, where build() takes them all
    // back: read in part, a long one listed each turn twice (fuzz, review,
    // 2026-10-30). Not at its own minute too: two identical exchanges are no move.
    const moved = since && !there && got.some(same);
    const back = !moved && (!since || got[0]?.at < since.at || there);
    if ((got.length && back && !all) || whole || bytes >= 32e6) {
      // 32 MB read and no prompt in them: the turn's prompt is further back (a long browser task's screenshots), and its
      // own Stops never wrote it (audit H-F6). Found by a look back, and read with the tail: its tools are the tail's.
      const p = !whole && !got.open ? promptBefore(path, bytes) : null;
      const out = p ? turns(`${p}\n${tail}`) : got;
      out.whole = whole; return out;
    }
  }
}
// The last prompt's line before a tail of `bytes` (fewer than the file has), the line the tail cut through included:
// read back a megabyte at a time, up to 256 MB. null: none there.
export function promptBefore(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    // From the end of the line the tail cut through, when it ends within 64 KB; a longer one is left out.
    const peek = Buffer.alloc(65536), from = fstatSync(fd).size - bytes;
    let pos = from + peek.subarray(0, readSync(fd, peek, 0, peek.length, from)).indexOf(10) + 1, carry = Buffer.alloc(0);
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

// An entry whose ask is private shows no answer and no files, whoever wrote
// it: one written before 1.0.5 kept an answer that repeated the secret.
const render = (t) => {
  // As shown: 1.0.4 wrote the ask raw, <private> and all.
  // shortcut: a question that quotes `[private]` loses its answer too; an old
  // entry's only mark is that text, and its answer repeats the secret.
  const ask = clip(t.ask, ASK), hid = ask.includes('[private]');
  return `- **asked** ${t.at}${t.s ? ` [${t.s}]` : ''}: ${ask}\n  **did:** ${hid ? '[private]' : clip(t.did, DID)}`
    + (t.changed && !hid ? `\n  **changed:** ${clip(t.changed, DID)}` : '');
};
// The newest n of a list, and how many older ones it leaves out.
export const newest = (xs, n, older = 'more') => (xs.length > n ? `${xs.slice(-n).join(', ')}, and ${xs.length - n} ${older}` : xs.join(', '));
// \r-tolerant: an editor that saves this file CRLF must not make every entry
// unparseable, which silently emptied the section. The tag is optional:
// entries written before it read as one untagged session. The time is lazy:
// greedy, it took the colon of an untagged "[word]: ..." ask, and the word read as a tag.
const ENTRY = /^- \*\*asked\*\* (\S+ \S+?)(?: \[([\w-]+)\])?: (.*?)\r?\n  \*\*did:\*\* (.*?)\r?$(?:\n  \*\*changed:\*\* (.*?)\r?$)?/gm;
// Why a store is not in the snapshots, and the user's fix. Shared with doctor.
export const MISSED = 'it is reached through a link to a folder outside ~/.claude/projects, and git does not follow that link, so no old version of a note there can be brought back. The fix: keep the folder in ~/.claude/projects and make the link the other way round';
export const parse = (section) => [...section.matchAll(ENTRY)].map((m) => ({ at: m[1], s: m[2] || '', ask: m[3], did: m[4], changed: m[5] || '' }));
// The LAST START that has an END after it, and the first END after it.
// Searching for the first START let a stray START -- one whose END was lost --
// pair with the next run's END; taking the last END let one quoted below the
// section pair with the real START. Either way, everything hand-written
// between them was replaced.
// And a marker counts only on a line of its own, as this file writes it: one
// quoted in a sentence below the section was taken for it, the next Stop
// wrote into that sentence, and the real section went stale (audit, 2026-10-28).
const alone = (doc, i, mark) => {
  const end = doc.indexOf('\n', i);
  return /^[ \t]*$/.test(doc.slice(doc.lastIndexOf('\n', i - 1) + 1, i)) && /^[ \t]*\r?$/.test(doc.slice(i + mark.length, end === -1 ? doc.length : end));
};
export const sectionOf = (doc) => {
  for (let a = doc.lastIndexOf(START); a !== -1; a = a ? doc.lastIndexOf(START, a - 1) : -1) {
    if (!alone(doc, a, START)) continue;
    for (let b = doc.indexOf(END, a); b !== -1; b = doc.indexOf(END, b + 1)) if (alone(doc, b, END)) return { a, b };
  }
  return { a: -1, b: -1 };
};

// The newest SESSIONS sessions, the last TURNS of each, in time order. `at` is
// a fixed-width `2026-10-27 01:07`, so code-unit order is time order;
// localeCompare loaded ICU's collator for it, ~16 ms of every Stop (profiled).
const byAt = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
// The writing session's always, then the newest others: ranked by when its
// last ask was made, a turn asked first and finished last lost to three
// later asks, and its own Stop dropped it.
function keep(all, me) {
  const by = new Map();
  for (const t of [...all].sort(byAt)) { if (!by.has(t.s)) by.set(t.s, []); by.get(t.s).push(t); }
  return [...by.values()]
    .sort((x, y) => (y[0].s === me) - (x[0].s === me) || byAt(y[y.length - 1], x[x.length - 1]))
    .slice(0, SESSIONS)
    .flatMap((g) => g.slice(-TURNS))
    // Ties by session: in the order the writer came first, two sessions with
    // entries in one minute swapped places on every Stop, and the file was
    // rewritten each time (audit, 2026-10-28).
    .sort((x, y) => byAt(x, y) || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));
}

const FRONT = `---\nname: handoff\ndescription: "The rolling handoff"\nmetadata:\n  node_type: memory\n  type: project\n  tier: hot\n---\n\n`;

// What handoff.md should say, from what it says now and this turn's entries:
// the new text, 'unchanged', or null when there is nothing to write. `drop`:
// which of its entries go.
function build(before, fresh, drop = null, me = fresh[0]?.s, whole = false) {
  let doc = (before ?? '').replace(/^\uFEFF/, '');
  // A file emptied by a failed edit has no `tier: hot`, so tiering would age
  // the handoff out of the index a week later.
  if (!doc.startsWith('---')) doc = FRONT + doc;
  const { a, b } = sectionOf(doc);
  const has = a !== -1;                       // a START before the last END
  const have = has ? parse(doc.slice(a, b)) : [];
  // Merge, keyed by session + time + ask: a turn seen again replaces its own
  // line, a new one is added, and two sessions on the same project interleave
  // by time. Without the session in the key, "continue" typed into two
  // sessions in the same minute was one turn, and each Stop dropped the
  // other's. An untagged entry (written before tags) whose time and ask match
  // is this session's own, re-seen: replaced, not kept beside. The ask as it
  // is written: one an older version wrote with a raw tag still matches.
  // 1.0.7 wrote a marker in an ask as `<!- -`.
  const key = (t) => `${t.s} ${bare(t)}`;
  const bare = (t) => `${t.at} ${clip(t.ask.replace(/<!- -/g, '<!--'), ASK)}`;
  const seenBare = new Set(fresh.map(bare));
  // One turn, two spellings: an ask an older version wrote otherwise (with a
  // trailing reminder before 1.0.6, its leading element cut in 1.0.6-1.0.7)
  // is the turn re-read when the session and minute match and one ask holds
  // the other. Kept beside it, an upgrade doubled every resumed turn.
  const ask = (t) => clip(t.ask, ASK).replace(/…$/, '');
  // Only over a minute the read covered whole (the file, or a turn of this
  // session before it): then every real turn of that minute is fresh, and a
  // leftover is an old spelling. Not so, "fix it" was taken for an old
  // spelling of "fix it and run tests" a minute later, and lost.
  const covered = (t) => whole || fresh.some((f) => f.s === t.s && f.at < t.at);
  const twin = (x, y) => x.s === y.s && x.at === y.at && covered(y) && !!ask(x) && !!ask(y) && (ask(x).includes(ask(y)) || ask(y).includes(ask(x)));
  // And one entry twice: a window still on 1.0.7 keyed its entries raw,
  // matched none of the escaped ones, and added each again every Stop. The
  // whole entry, answer and all: "continue" asked twice in a minute is two.
  const whole1 = (t) => `${key(t)}\n${clip(t.did, DID)}\n${t.changed}`;
  const last = new Map(have.map((t) => [whole1(t), t]));
  // A turn read again replaces its own line, one for one, newest first:
  // "continue" twice in a minute is two lines of one key, and replacing every
  // line of the key lost the first when only the second was read again.
  const uniq = have.filter((t) => last.get(whole1(t)) === t), left = new Map(), gone = new Set();
  for (const f of fresh) left.set(key(f), (left.get(key(f)) ?? 0) + 1);
  for (const t of [...uniq].reverse()) { const n = left.get(key(t)); if (n) { gone.add(t); left.set(key(t), n - 1); } }
  // Read whole, the writer's turns are all fresh: an entry of its own left over
  // is no turn now, as a clock moved to another time zone leaves every minute.
  // Kept, each turn was listed twice, and the old zone's later-sorting minutes
  // crowded out the newest (audit, 2026-10-30). Never the untagged: a writer
  // with no session id is not every entry written before tags.
  const kept = uniq.filter((t) => !(whole && me && t.s === me) && !gone.has(t) && !(t.s === '' && seenBare.has(bare(t))) && !drop?.(t) && !fresh.some((f) => twin(f, t)));
  const merged = keep([...kept, ...fresh], me);
  if (!merged.length && !(drop && has)) return null;
  // An entry kept from the file is rendered once, for the comparison and the
  // write: each render runs every secret pattern over it.
  const shown = new Map(), show = (t) => shown.get(t) ?? shown.set(t, render(t)).get(t);
  const core = merged.map(show).join('\n');
  // Compare the entries, not the stamp line, or the guard is dead code. A note
  // the compaction gate left lives until the next write: with one there, this
  // is a write.
  const notes = has && doc.slice(a, b).includes('**cut mid-turn**');
  if (!notes && have.map(show).join('\n') === core) return 'unchanged';
  const body = [START,
    `_Written after every turn by \`handoff-log.mjs\`, so an interrupted session still leaves this. Last: ${local()}._`,
    '', core, END].join('\n');
  return has ? doc.slice(0, a) + body + doc.slice(b + END.length)
    : doc.trimEnd() + `\n\n## Last ${TURNS} exchanges\n\n` + body + '\n';
}

// The conversations marked private, by tag: the newest 1,000, one per line
// (9 KB). The newest 50 let an older private conversation, resumed, be
// recorded again.
const QUIET = '.private-sessions';
// The conversations held with auto memory off, kept the same way beside the
// projects (off(), at their start and every Stop, which make no store for
// them): the journal never records or imports them.
export const OFF = '.memory-off';
// `prune`: the tags kept beside a new one. False: not marked, or a mark that
// lost every race, unwritten. Null: unknown, the list refused three reads.
export function hushed(dir, s, mark = false, list = QUIET, prune = (have) => have.slice(-999)) {
  const p = join(dir, list);
  if (!s) return false;
  let unread;
  for (let i = 0; i < 3; i++) {
    // CRLF too: a tag with a \r left over matched no conversation, and a marked
    // one was written again.
    // A read refused (EBUSY: a scan holding the list) is no answer: read as no
    // tags, a private conversation was saved as public (F12). Held for a moment, it is read again after a pause, as the store's other
    // retries do: three reads in the same instant all met the hold (release review). None after the last, none for a folder.
    let before = null;
    try { before = readFileSync(p, 'utf8'); unread = false; } catch (e) { unread = e.code !== 'ENOENT'; if (i < 2 && BUSY.includes(e.code)) sleep(STEP); }
    if (unread) continue;
    const have = listOf(before);
    if (!mark || have.includes(s)) return have.includes(s);
    // By rename: written in place, a hook killed mid-write forgot every mark.
    // Again, from the text read, when another wrote first.
    if (replaceIfUnchanged(p, before, [...prune(have), s].join('\n') + '\n') !== 'conflict') return true;
  }
  return unread ? null : false;
}
// What a writer throws when hushed() answers unknown, after changing nothing.
export const unreadable = (dir, list) => new Error(`${join(dir, list)} could not be read`);

// The tags of the transcripts in every project folder; null when one won't list.
function onDisk(root) {
  const all = new Set();
  try {
    for (const f of readdirSync(root)) {
      let ns = []; try { ns = readdirSync(join(root, f)); } catch (e) { if (e.code !== 'ENOTDIR') return null; }
      for (const n of ns) if (n.endsWith('.jsonl')) all.add(tag(n));
    }
  } catch { return null; }
  return all;
}
// A conversation held with auto memory off, into OFF. Under the projects'
// lock: 24 memory-off Stops at once, with no lock, lost 46 tags of 96 (P1
// hunt, 2026-10-29). Pruned by the transcripts still on disk, as the
// journal's list is: the newest 1,000 anywhere evicted a quiet project's tags,
// and its conversations were imported. The newest OFF_NEW stay whatever: a
// transcript is made with its first message, after its start wrote the tag.
// False when the tag is not there. A list that won't read throws, after
// writing nothing, so the Stop records it: swallowed, the conversation stayed
// untagged, nothing said so, and once the list read the journal took it in (R67).
const OFF_NEW = 100, OFF_MOST = 10_000;
export function off(input) {
  const root = projectsRoot(), s = tag(input.session_id || basename(String(input.transcript_path || ''), '.jsonl'));
  return withLock(root, () => {
    const r = hushed(root, s, true, OFF, (have) => {
      const live = onDisk(root);
      return have.filter((t, i) => !live || live.has(t) || i >= have.length - OFF_NEW).slice(-OFF_MOST);
    });
    if (r === null) throw unreadable(root, OFF);
    return r;
  }) === true;
}

// Exported so memory-tier.mjs can run it in the same process from the Stop
// hook: a second Node start cost a median 200 ms a turn on this box.
export function handoff(input, sink = null) {
  const dir = storeOf(input);
  const file = join(dir, 'handoff.md');
  // What happened is returned -- true written, 'unchanged', false nothing to
  // write, 'busy' another hook held the store -- because a caller that reads
  // silence as success reports "handoff written" over a store that does not
  // exist (the compaction gate did).
  if (typeof input.transcript_path !== 'string' || !existsSync(input.transcript_path)) return false;
  // Claude Code makes a project's memory folder when Claude first saves a
  // note: until then, no conversation in it was recorded. Made here for a
  // real session, one whose transcript Claude Code keeps in the projects
  // folder; never for a payload's cwd alone. Its project folder too: one
  // started in a repository's subfolder, with none yet at its root, has its
  // store in a folder Claude Code makes with the first note, and recorded
  // nothing until then (audit, 2026-10-28).
  // Recursive: two sessions starting in a new project at once both make it.
  if (!existsSync(dir)) {
    if (!inProjects(input.transcript_path)) return false;
    mkdirSync(dir, { recursive: true });
  }
  // The transcript is read outside the lock: it is the slow part, and this session's alone.
  const s = tag(input.session_id);
  // Read without the lock: a hint for how far back to read, nothing more.
  // One the disk won't read (EBUSY: a scan holding it) is no hint, and no sign of no entry: read as none, only the tail was read,
  // and after a clock moved to another zone each turn was listed twice (F21, fuzz 169429179). Read whole, as for a moved clock:
  // build() takes the old entries back. One that never reads throws under the lock, as before, and the Stop records the failure.
  let since = null, refused = false;
  try { const d = readFileSync(file, 'utf8'), { a, b } = sectionOf(d); if (a !== -1) since = parse(d.slice(a, b)).filter((t) => t.s === s).sort(byAt).at(-1) ?? null; } catch (e) { refused = e.code !== 'ENOENT'; }
  const got = latest(input.transcript_path, since, refused);
  // The transcript can lag the reply that ends it: on Stop, Claude Code passes
  // that reply itself (hooks docs). Not after a block: then it is the reply
  // to the block. Nor when the hold has just ended and nothing was said since:
  // the reply it passes is then the memory update's.
  const open = got.open, last = input.last_assistant_message;
  if (open && !open.frozen && !open.reopened && input.hook_event_name === 'Stop' && !input.stop_hook_active && typeof last === 'string' && last.trim()) {
    open.did = last.trim();
    if (got.at(-1) !== open) got.push(open);
  }
  // File names, not paths; none for a private message's turn, read by what the
  // user typed as well as the ask made of it (userText): a wrapper own()
  // strips, or a command, hid the tag from the ask.
  const fresh = got.map((t) => ({ ...t, s, ...shown(t),
    changed: PRIVATE.test(userText(t)) ? '' : newest(t.changed.map((f) => f.split(/[\\/]/).pop()), CHANGED) }));
  const hush = got.hush === true;
  // Sessions of one project write this file at once, so they take turns: 8 at
  // once lost 22 of 40 turns without the lock (2026-10-26). The model can still
  // edit the file by hand meanwhile -- the nudge asks it to -- and then the
  // merge is redone from what it wrote.
  const r = withLock(dir, () => {
    // A conversation marked private writes nothing, and what it wrote before
    // the mark goes. The mark is kept in a file: only the turn that typed it
    // sees it in the transcript.
    // Private by this read even when the mark could not be kept.
    const was = hushed(dir, s);
    // Unknown (the list won't read): nothing written, nothing swept; the next
    // Stop does it. Taken as private, a normal conversation's lines and entries
    // went (F12). Thrown, so the Stop records it: a list that never read again
    // stopped the store in silence (R64).
    if (was === null) throw unreadable(dir, QUIET);
    let quiet = was || hushed(dir, s, hush) || hush || hushed(projectsRoot(), s, false, OFF);
    // Held with auto memory off once (OFF): kept out as the journal keeps it out (take()), what it wrote before included. Read by
    // the journal alone, what was typed while auto memory was off reached handoff.md at the first Stop with it back on (e2e audit,
    // 2026-11-01). A list that won't read is unknown here too: nothing written or swept (F12).
    if (quiet === null) throw unreadable(projectsRoot(), OFF);
    // The journal (memory-tier's Stop passes its writer) takes this lock too,
    // not one of its own; whatever it throws is its own. Swept anew only by the
    // read that first marks it: while the mark stayed in the tail each Stop
    // reads (~25 Stops of 20 KB turns), every one swept every journal day
    // again, under the lock (1.5 s with three years of journal).
    if (sink) try { sink(dir, input.transcript_path, got, { quiet, hush: hush && !was }); } catch {}
    // Or by the journal's look at the whole transcript, past this read.
    quiet ||= hushed(dir, s);
    if (quiet === null) throw unreadable(dir, QUIET);
    // An exchange forget took out stays out: read again, the forget turn's own
    // Stop put it back (R36). By its transcript and minute, as forget lists it,
    // and by its key, the prompt's id: a clock moved to another time zone gave
    // it another minute, and it came back.
    let list = null; try { list = readFileSync(join(dir, FORGOTTEN), 'utf8'); } catch {}
    const me = pathKey(transcriptKey(input.transcript_path)), listed = forgotten(list);
    const keys = new Set(listed.map(([k]) => k)), out = new Set(listed.filter(([, t]) => t && pathKey(t) === me).map(([, , at]) => at));
    // A turn with a key goes by it alone: the minute it was listed under, in
    // another zone's clock, can be another turn's minute here (fuzz, 2026-10-30).
    const forgot = (t) => (t.id ? keys.has(t.id) : out.has(t.at));
    // One already listed goes too, by what it says: forget took it out of
    // handoff.md by minute, and one listed under another zone's minute stayed (fuzz, 2026-10-30).
    const gone = fresh.filter(forgot);
    const drop = quiet ? (t) => t.s === s : gone.length ? (t) => t.s === s && gone.some((g) => g.ask === t.ask && g.did === t.did) : null;
    const w = put(dir, quiet ? [] : fresh.filter((t) => !forgot(t)), drop, s, got.whole);
    return quiet ? 'private' : w;
  });
  return r ?? 'busy';
}

// handoff.md with these entries merged in, and without those `drop` takes (a
// private conversation's). Call under withLock(dir). True written,
// 'unchanged', false nothing to write.
function put(dir, fresh, drop, me, whole) {
  const file = join(dir, 'handoff.md');
  for (let i = 0; i < 3; i++) {
    const before = raw(file);
    const next = build(before, fresh, drop, me, whole);
    if (next === null || next === 'unchanged') return next ?? false;
    const w = replaceIfUnchanged(file, before, next);
    if (w !== 'conflict') return w || 'unchanged';
  }
  return false;
}
// The entries `gone` takes go from handoff.md: a conversation the journal's
// import found marked private, as its own Stop's would have, or the exchanges
// forget took out. Call under withLock(dir).
export const unsay = (dir, gone) => put(dir, [], gone);
// The exchanges forget took out, `<key>\t<folder>/<session>\t<time>` a line
// (journal.mjs writes it; an older line is its key alone). Trimmed: an
// editor's CRLF, or a space left after a line, is still the line.
export const FORGOTTEN = join('journal', '.forgotten');
export const forgotten = (text) => listOf(text).map((l) => l.split('\t'));

// What a Stop's record of a failure (HANDOFF_FAILED) says, in the briefing and in status: the record of where you left off, or with
// auto memory off (`off`) the tag that keeps the conversation out of the journal, which was all a Stop then meant to write.
export const unsaved = (f) => (f.off
  ? `a conversation held with auto memory off could not be marked after the reply at ${local(f.at)}, so the journal may take it in later: ${f.error}`
  : `the record of where you left off could not be saved after the reply at ${local(f.at)}: ${f.error}`);

// Warnings only: the startup line costs every session, so it says nothing
// here when all is well. The shared store's problems are every project's.
function health(dir) {
  const out = [];
  for (const d of [dir, sharedStore()]) {
    try { const h = readFileSync(join(d, '.health'), 'utf8').trim(); if (h) out.push(`Memory store needs attention (${d}): ${h.split('\n').join('; ')}`); } catch {}
  }
  // What the last Stop could not save.
  try {
    const f = JSON.parse(readFileSync(join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(dir))}`), 'utf8'));
    out.push(`Memory store needs attention (${dir}): ${unsaved(f)}`);
  } catch {}
  // A journal write that failed after a reply (journal/.failed; not a backfill,
  // which is retried): only status said so, and every reply went unrecorded.
  // And one its folder would not take, kept beside the projects (JOURNAL_FAILED).
  for (const p of [join(dir, 'journal', '.failed'), join(projectsRoot(), `${JOURNAL_FAILED}${basename(dirname(dir))}`)]) {
    try {
      for (const l of readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const f = JSON.parse(l);
        if (!String(f.error).startsWith('backfill: ')) out.push(`Memory store needs attention (${dir}): the journal could not be written after the reply at ${local(f.at)}: ${f.error}`);
      }
    } catch {}
  }
  try {
    const s = JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8'));
    if (s.failures >= 3) out.push(`Memory snapshots have failed ${s.failures} times in a row, last ok ${s.lastOk ? local(s.lastOk) : 'never'}: ${s.error}`);
    if (s.missed?.length) out.push(`Memory snapshots leave out ${s.missed.join(', ')}: ${MISSED}`);
  } catch {}
  return out;
}

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
export function lastTurn(p) {
  const tail = readTail(p, TAIL).text;
  let end = NaN, seen = 0, known = 0, open = false;
  for (const line of tail.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
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
    open = r.message.stop_reason !== 'end_turn';
    if (!open) end = Date.parse(r.timestamp);
  }
  return { end, seen, known, open };
}

// Stop output reaches nobody, so a Stop hook that stopped running -- unwired,
// or failing before it loads the handoff -- was silence. memory-tier touches
// `.stop-ran` on every `--stop`: a turn the newest other session finished
// after that went unrecorded. A tail full of messages the hooks cannot read
// means the transcript format moved under them.
// `hint`: the startup line says how to look closer; doctor, which is that,
// does not tell the user to run itself.
export function stalled(t, hint = true) {
  if (!t) return [];
  let end, seen, known; try { ({ end, seen, known } = lastTurn(t.p)); } catch { return []; }
  if (seen >= 50 && !known) return [`Memory hooks cannot read [${t.s}]'s transcript: none of its last ${seen} messages is a model reply they know. Has Claude Code's transcript format changed?`];
  // No file is not knowing (just installed, or cleaned away), not "never ran".
  let ran; try { ran = statSync(join(projectsRoot(), '.stop-ran')).mtimeMs; } catch { return []; }
  if (end - ran > GRACE && Date.now() - end > GRACE) {
    // A full disk, or a folder that takes no writes, stops the proof of life too: said as hooks stopped or turned off, the
    // failed write was never named (audit H-F5). The file opened for writing, not written: a full disk opens it all the same.
    const root = projectsRoot();
    let refused = '';
    try { const s = statfsSync(root); if (s.bavail * s.bsize < 1048576) refused = `the disk holding ${root} is full`; } catch {}
    if (!refused) try { closeSync(openSync(join(root, '.stop-ran'), 'r+')); } catch (e) { if (e.code !== 'ENOENT') refused = `${root} refuses writes (${e.code})`; }
    if (refused) return [`Memory could not be saved after [${t.s}]'s reply at ${local(end)}: ${refused}. project-memory saves again once it can write there.`];
    return [`Memory hooks look stopped: [${t.s}] finished a reply at ${local(end)}, but project-memory last saved after one at ${local(ran)}. ` +
      `If project-memory was turned off meanwhile, this clears after the next reply.` +
      (hint ? ` If not: node "${join(dirname(fileURLToPath(import.meta.url)), 'memory.mjs')}" doctor` : '')];
  }
  return [];
}

export const hash = (buf) => createHash('sha256').update(buf).digest('hex');

// The hooks run from the copy deploy.mjs made after the full check. A file
// changed or gone there since is live and untested: name it. Run from the
// repo, with no manifest, there is nothing to say; nor with a damaged one:
// thrown, it took every other line of the startup message with it.
export function edited(here = dirname(fileURLToPath(import.meta.url))) {
  try {
    const m = JSON.parse(readFileSync(join(here, '.deployed.json'), 'utf8'));
    const bad = Object.keys(m.files).filter((f) => {
      try {
        // Size and mtime as deployed: not read, as git's index judges. Hashing all
        // nine files was 8-11 ms of every startup (measured 2026-10-27).
        const s = statSync(join(here, f)), was = m.stat?.[f];
        if (was && s.size === was[0] && s.mtimeMs === was[1]) return false;
        return hash(readFileSync(join(here, f))) !== m.files[f];
      } catch { return true; }
    });
    return bad.length ? [`Memory hooks changed outside deploy.mjs, live and untested: ${bad.join(', ')} in ${here}. For the user: edit ${m.repo || 'the hooks repo'} and run node deploy.mjs there (a deploy replaces these edits).`] : [];
  } catch { return []; }
}

// The shared store's index, printed into every session of every project: Claude
// Code loads only the project's own. Every line is printed, even one whose file
// name the project also has: auto-memory names repeat (`feedback_testing.md`),
// and hiding the shared line for a different memory of the same name lost the
// lesson there (reviews, 2026-10-27). With nothing shared yet, one line says
// where such a lesson goes -- the model is told of no store but the project's,
// so without it the shared one stayed empty.
function shared() {
  const at = sharedStore();
  let index = '';
  try { index = readFileSync(join(at, 'MEMORY.md'), 'utf8'); } catch {}
  // Tiering holds the index to its budget but never evicts a pin or a pointer
  // whose file is gone: the ceiling is held here too, since this prints everywhere.
  const lines = [];
  let bytes = 0, cut = 0;
  for (const l of index.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!POINTER.test(l)) continue;
    if (bytes + Buffer.byteLength(l) + 1 > SHARED_BUDGET) { cut++; continue; }
    bytes += Buffer.byteLength(l) + 1;
    lines.push(l);
  }
  if (cut) lines.push(`(${cut} more shared line(s) over the ${SHARED_BUDGET} B ceiling, in ${join(at, 'MEMORY.md')})`);
  // An empty archive's line says nothing, in every session.
  const said = lines.filter((l) => !(l.includes(`](${ARCHIVE})`) && / — 0 older/.test(l)));
  // Once the user agrees: a lesson there reaches every project, the ones a
  // conversation here should not speak for too.
  const head = said.some((l) => !l.includes(`](${ARCHIVE})`))
    ? `Shared memory, every project (${at}): each line below names a file there with a lesson that holds in every project. A new lesson of that kind can go there too, once the user agrees, with a pointer in its MEMORY.md.`
    : `Shared memory: lessons that hold in every project (how the user works, machine-wide tools) can go in ${at} once the user agrees, same format, with a pointer in its MEMORY.md.`;
  return [head, ...said];
}

// Claude Code passes a hook's text whole up to 10,000 characters; past that,
// a preview and a file, and the shared lessons at the end were what was cut.
const SAY = 9500;
// The "usually under 1,000 tokens" the README promises, at 3.5 characters a
// token, which code and paths come near: the last session's exchanges fill
// the startup briefing up to it, the oldest left out first, and never past
// it. What is there without them (the shared index alone can be 3,000 B) is
// as before.
const BRIEF = 3500;
// Defused, then held to SAY at a line's end, on both paths: the startup's
// health lists and the compaction note's task lists had no bound, and `<`
// grows fourfold as `&lt;`. What is cut is cut from the end, the shared
// lessons first. At startup each line is held to `line` characters first:
// one health line naming 400 files cut the briefing to 407 characters, the
// shared lessons with it, at every start.
export const fit = (s, line = Infinity) => {
  // Redacted whole: the shared index and the health lines are printed in
  // every session too, and a key written into one was printed as it was.
  // Line by line, each line being its own: an unclosed <private> runs to the
  // end of what it is given, and one shared lesson about the tags hid every
  // lesson after it.
  const d = defuse(s.split('\n').map(redact).join('\n')).split('\n').map((l) => (l.length <= line ? l : `${l.slice(0, /[\uD800-\uDBFF]/.test(l[line - 1]) ? line - 1 : line)}…`)).join('\n');
  return d.length <= SAY ? d : `${d.slice(0, SAY - 60).replace(/[^\n]*$/, '')}(the rest cut to fit Claude Code's startup limit)\n`;
};

// The SessionStart hook. After a compaction (source "compact"): the note on a
// turn the compaction cut, then this session's own exchanges -- a parallel
// session's asks are never taken for this one's -- then who else is working
// here. At startup (or a /clear, a fresh context too): who is working here
// now, or where the last session stopped, and anything failing. Either way the
// shared store last: what the compaction summarised away, or never loaded.
async function print(input) {
  const dir = storeOf(input);
  const file = join(dir, 'handoff.md');
  // One that cannot be read (a folder, a file another program holds) is none:
  // thrown, it took every other line of the briefing with it.
  let doc = ''; try { doc = readFileSync(file, 'utf8'); } catch {}
  const { a, b } = sectionOf(doc);
  const section = a === -1 ? '' : doc.slice(a + START.length, b);
  const all = parse(section);
  const me = tag(input.session_id);
  // `at` is local time, and so is a date-time without an offset.
  const age = (t) => Date.now() - Date.parse(t.at.replace(' ', 'T'));
  // Working is judged by the transcript, not the entry: an entry carries the
  // time of the ask, and a session an hour into one prompt read as ended.
  // Recent, with a turn still open: one that finished its turn is closed, or
  // waiting for its user, and the one closed for a restart read as working.
  const live = transcripts(dir, me, input.transcript_path);
  // Newest first, the first two only: each is a 512 KB read.
  const busy = (t) => { try { return lastTurn(t.p).open; } catch { return false; } };
  const working = [];
  for (const t of live) { if (working.length === 2 || Date.now() - t.m >= ACTIVE) break; if (busy(t)) working.push(t); }
  // Never the words of a conversation marked private, though handoff.md still
  // holds them (a sweep that failed waits for the next reply): the mark is
  // kept apart. A list that won't read hides them all.
  const hid = new Map(), quiet = (s) => hid.get(s) ?? hid.set(s, hushed(dir, s) !== false).get(s);
  // By the last request recorded for it, and said so: what it works on now may be newer, and named as its work, a finished
  // ask read as the current one (audit H-F8).
  const others = working.map((t) => {
    const e = all.filter((x) => x.s === t.s && !quiet(x.s)).at(-1);
    return `Another session is working in this project: [${t.s}]${e ? `; the last request recorded for it, at ${e.at}: ${clip(e.ask, 120)}` : `, active at ${local(t.m)} (no handoff entry)`}`;
  });
  if (input.source === 'startup' || input.source === 'clear') {
    const told = all.filter((t) => !quiet(t.s));
    const last = told.filter((t) => t.s !== me).at(-1);
    // After /clear the conversation just cleared is the newest transcript and
    // the last entry: named, it brought back the ask the user had cleared away.
    const lines = input.source === 'clear' ? [] : others.length ? others
      : last && age(last) < RECENT ? [`Last session here ended ${last.at} on: ${clip(last.ask, 120)} (log: ${file})`] : [];
    // A project with no handoff is not judged: its sessions were never the
    // Stop hook's to record (from before the plugin, or `claude --bare` runs,
    // which load no hooks).
    // A broken journal.mjs costs the line, never the briefing. Loaded here:
    // journal.mjs imports this module.
    let first = null; try { first = (await import(new URL('./journal.mjs', import.meta.url))).firstDay(dir); } catch {}
    // Where it stopped in its own words: its last exchanges, oldest first, the
    // oldest dropped until the whole briefing is within BRIEF, so they never
    // cost the shared lessons at its end (2026-10-31). None forget listed, by
    // conversation and minute as its sweep matches them: a sweep that failed
    // waits for that conversation's next reply. The line above still names the
    // newest entry: that reply puts back another exchange of a swept minute.
    // A list that won't read could name any: none is listed. Nor any of a
    // conversation held with auto memory off, unknown included: a later Stop
    // with it on reads back what was typed while it was off.
    let list = null, shut = false; try { list = readFileSync(join(dir, FORGOTTEN), 'utf8'); } catch (e) { shut = e.code !== 'ENOENT'; }
    const gone = new Set(forgotten(list).filter(([, t]) => t).map(([, t, at]) => `${tag(basename(t))} ${at}`));
    const theirs = lines.length && last && !others.length && !shut && hushed(projectsRoot(), last.s, false, OFF) === false
      ? told.filter((t) => t.s === last.s && !gone.has(`${t.s} ${t.at}`)).map(render) : [];
    const rest = [...(first ? [`Earlier work in this project since ${first} is in its journal: when asked about the past, search it with the memory skill before saying you don't know.`] : []),
      ...health(dir), ...(doc ? stalled(live[0]) : []), ...edited(), ...shared()];
    const say = (ex) => fit([...lines, ...(ex.length ? ['Its last exchanges, oldest first:', ...ex] : []), ...rest].join('\n') + '\n', 1000);
    // The most that fit, from the newest back; none when not even it does.
    // Found, not looped: a while on the length, its && made ||, never ended
    // when the rest alone was over BRIEF, and no test could fail it (a mutant).
    const from = theirs.findIndex((_, i) => say(theirs.slice(i)).length <= BRIEF);
    return say(from === -1 ? [] : theirs.slice(from));
  }
  let note = '';
  try { note = (await import(new URL('./compact-gate.mjs', import.meta.url))).recover(input); } catch {}
  // Its own exchanges only. None yet (cut in its first turn, or a private
  // conversation) is none: another session's, shown here, read as its own.
  const mine = all.filter((t) => t.s === me).map(render), tail = shared();
  const say = () => [...(note || mine.length ? ['The last exchanges before this compaction, from handoff.md:', ...(note ? [note] : []), ...mine, ...others] : []), ...tail].join('\n') + '\n';
  // The oldest exchanges go first, until it fits.
  let out = say();
  while (mine.length && out.length > SAY) { mine.shift(); out = say(); }
  return fit(out);
}

// Run directly (the harnesses do): payload on stdin, always exit 0.
// `--print` is the SessionStart hook, for sources "startup", "clear" and "compact".
// Not a top-level await: print() imports compact-gate, which imports this
// module, and a module still awaiting at its top level can never be imported
// back -- Node gives up with "unsettled top-level await".
// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // A reader gone before the write (Claude Code ended the hook): its EPIPE,
  // thrown with no listener, exited 1 with a stack trace once process.exit()
  // no longer came first (P1 hunt, 2026-10-29).
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  (async () => {
    try {
      const input = JSON.parse(readFileSync(0, 'utf8'));
      // Auto memory off: no record, no briefing; the tag at every start, so no
      // backfill imports a conversation whose first reply got no Stop (P1 hunt,
      // 2026-10-29). A resumed conversation has its history: no briefing.
      if (memoryOff()) off(input);
      else if (process.argv.includes('--print')) { if (input.source !== 'resume') process.stdout.write(await print(input)); }
      else handoff(input);
    } catch {
      // A hook that throws on every turn is worse than one that misses a turn.
    }
    // Not process.exit(): on macOS a pipe is written asynchronously, and
    // exiting cut a briefing of up to 9,500 characters at 8 KB (as memory.mjs's
    // search, CI 2026-10-29).
    process.exitCode = 0;
  })();
}
