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
import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync, fstatSync, readdirSync, statSync, realpathSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { storeOf, withLock, replaceIfUnchanged, projectsRoot, sharedStore, SHARED_BUDGET, local, POINTER, ARCHIVE, same, memoryOff } from './store.mjs';

const TURNS = 10;         // how many exchanges to keep, per session
const SESSIONS = 3;       // how many sessions: parallel work keeps the depth one session had alone
const ASK = 240;          // chars kept of what was asked
const DID = 400;          // chars kept of the answer
const CHANGED = 8;        // files an entry names: the turn's last
const TAIL = 512_000;     // first read; grown 4× until it reaches the latest prompt
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
// Text read the same in any width and without hidden characters: a fullwidth
// ＜private＞, or a zero-width space inside the tag, kept what it should hide.
export const norm = (s) => s.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
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

export { local };
// A session's short tag: enough to tell parallel sessions apart in one file.
export const tag = (id) => String(id || '').slice(0, 8);

export function turns(raw) {
  const out = [];
  let pending = null;
  // A nudge holds the answer for its memory update only; a private message
  // (frozen: true) holds it to the next prompt.
  const hold = (p) => { if (p.frozen !== true) { p.frozen = 'nudge'; p.ended = false; } };
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;        // a tail starts mid-line
    let r; try { r = JSON.parse(line); } catch { continue; }
    // A turn's edits are tool calls with no text: taken before the text test skips them.
    // Not once a nudge or a private message froze the turn: what follows is
    // the memory update, or the private part.
    if (r.type === 'assistant' && pending && !pending.frozen && Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        if (b?.type === 'tool_use' && /^(Bash|PowerShell)$/.test(b.name) && b.input?.command) pending.ran.push(String(b.input.command));
        const f = b?.type === 'tool_use' && /^(Edit|Write|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path);
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
    const t = text(r).trim(), n = norm(t);
    let ask = r.type === 'user' ? prompt(r, t) : '';
    if (ask && PRIVATE.test(norm(ask))) ask = norm(ask);   // any private tag in any spelling: with a plain one too, a fullwidth one was saved
    // What the user typed, tags and all: a slash command's arguments, a
    // wrapper own() strips, a message queued while Claude worked (an
    // attachment record, read by nothing before). Not what the harness quotes
    // (an agent's report or a task's end can quote the mark, and marked the
    // conversation private), nor a record it added, nor a compaction summary.
    // A summary is no part of it at all: it recaps the conversation, and one
    // that named the tag froze the rest of a long turn, its answer hours stale.
    const mine = r.type === 'user' && !r.isCompactSummary ? unquote(unwrap(n)) : '';
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
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}|\bxapp-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  // AWS keys, long-lived and STS.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  // With a digit in it: "Basic implementation/approach" and "Bearer
  // authentication-header" were prose, and were cut.
  [/\b(Bearer|Basic|Token) (?=[A-Za-z0-9._~+/=-]{0,200}\d)[A-Za-z0-9._~+/=-]{20,}/gi, '$1 [redacted]'],
  // GitLab, npm and Hugging Face tokens; a Slack webhook is its own secret.
  [/\bglpat-[A-Za-z0-9_-]{20,}|\bnpm_[A-Za-z0-9]{36}\b|\bhf_[A-Za-z0-9]{30,}/g, '[redacted]'],
  // PyPI, Stripe webhooks, SendGrid, Google OAuth, Groq, xAI, Shopify,
  // DigitalOcean, Notion, Atlassian, Vault, Docker; and a PEM key in base64
  // (kubeconfig's client-key-data).
  [/\bpypi-AgE[A-Za-z0-9_-]{20,}|\bwhsec_[A-Za-z0-9+/=]{20,}|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bya29\.[A-Za-z0-9_-]{20,}|\bgsk_[A-Za-z0-9]{20,}|\bxai-[A-Za-z0-9]{20,}|\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}|\bdop_v1_[a-f0-9]{64}|\bntn_[A-Za-z0-9]{20,}|\bATATT[A-Za-z0-9_=-]{20,}|\bhvs\.[A-Za-z0-9_-]{20,}|\bdckr_pat_[A-Za-z0-9_-]{20,}|LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}/g, '[redacted]'],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1[redacted]'],
  // The password in a URL: postgres://user:it@host, redis://:it@host (no
  // user), one with an @ in it (to the last one). Not a query: a port
  // before `?user=me@x` was cut as a password.
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{0,100}:)[^\s/?#]{1,200}@/gi, '$1[redacted]@'],
  // curl -u user:it, --user user:it. Not `docker run -u 1000:1000`, a user and group.
  [/((?:^|\s)(?:-u|--user)[ =]+(?!\d+:\d+(?![^\s'"]))[^\s:'"]{1,100}:)[^\s'"]{1,200}/g, '$1[redacted]'],
  // --password it (--token, --client-secret); docker login, az login, sshpass
  // and twine take it as -p it.
  [/(--(?:[a-z]+-){0,3}(?:password|passwd|token|secret)[ =]|\b(?:(?:docker|podman|az|oc)\s+login|sshpass|twine\s+upload)\b[^\n|;&]{0,200}?\s-p\s+)(?!-)[^\s"']{3,}/g, '$1[redacted]'],
  // A secret as a command's argument, which the journal's Ran field keeps (P1
  // hunt, 2026-10-29): `aws configure set` of a secret, key or token; a
  // SetEnvironmentVariable of one; htpasswd -b's password, after its file (none
  // with -n) and user; an exported name whose word is a key's.
  [/(\baws\s+configure\s+set\s+[\w.-]{0,100}(?:secret|key|token)[\w.-]{0,100}\s+)(?!-)[^\s"']+/gi, '$1[redacted]'],
  [/(SetEnvironmentVariable\(\s*["'][^"'\n]{0,100}(?:password|passwd|secret|token|key)[^"'\n]{0,100}["']\s*,\s*["'])[^"'\n]+/gi, '$1[redacted]'],
  [/(\bhtpasswd(?:\s+-[A-Za-z]+(?:\s+\d+)?)*?\s+-[A-Za-z]*b[A-Za-z]*(?:\s+-[A-Za-z]+(?:\s+\d+)?)*\s+(?:[^\s-]\S*\s+)?\S+\s+)[^\s;|&]+/g, '$1[redacted]'],
  // The name read whole, then judged: as words in one pattern, KEY_ repeated
  // took 28 s.
  [/(\bexport\s+([A-Za-z_]\w{0,100})=["']?)([^\s"';|&]+)/g, (m, pre, name, v) => (/(?:^|_)(?:key|secret|token|password|passwd)(?:_|$)/i.test(name) && !code(v) ? `${pre}[redacted]` : m)],
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
  [/((?:password|passwd|passphrase|secret|(?:access|auth|refresh|api|session)[_-]?token|(?:api|account|private)[_-]?key|key-data|(?<![A-Za-z0-9])pwd|(?<![A-Za-z0-9])pass(?![a-z]))[A-Za-z0-9_]{0,40}["']?[ \t]{0,20}[:=]\s{0,20}["']?)([^\s"',;]{6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
  // A bare `token=` or `token:` whose value has a letter: a key, not a count.
  [/((?<![A-Za-z0-9])tokens?[ \t]{0,20}[:=]\s{0,20}["']?)(?=[^\s"',;]{0,200}[A-Za-z])([^\s"',;]{6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
];
export const redact = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);
// The answer to a private message often repeats what it was told, so it is
// withheld whole.
export const answer = (ask, did, n) => (PRIVATE.test(ask) ? '[private]' : clip(plain(did), n));

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
export const clip = (s, n) => {
  const one = defuse(redact(s).replace(/\s+/g, ' ')).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD').trim();
  return one.length > n ? one.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : one;
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
function latest(path, since = null) {
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: raw, whole } = readTail(path, bytes);
    const got = turns(raw);
    const back = !since || got[0]?.at < since.at || got.some((t) => t.at === since.at && clip(t.ask, ASK) === since.ask && answer(t.raw ?? t.ask, t.did, DID) === since.did);
    if ((got.length && back) || whole || bytes >= 32e6) { got.whole = whole; return got; }
  }
}

// An entry whose ask is private shows no answer and no files, whoever wrote
// it: one written before 1.0.5 kept an answer that repeated the secret.
const render = (t) => {
  // As shown: 1.0.4 wrote the ask raw, <private> and all.
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
// the new text, 'unchanged', or null when there is nothing to write.
function build(raw, fresh, drop = null, me = fresh[0]?.s, whole = false) {
  let doc = (raw ?? '').replace(/^\uFEFF/, '');
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
  const kept = uniq.filter((t) => !gone.has(t) && !(t.s === '' && seenBare.has(bare(t))) && t.s !== drop && !fresh.some((f) => twin(f, t)));
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

// Exported so memory-tier.mjs can run it in the same process from the Stop
// hook: a second Node start cost a median 200 ms a turn on this box.
// The conversations marked private, by tag: the newest 1,000, one per line
// (9 KB). The newest 50 let an older private conversation, resumed, be
// recorded again.
const QUIET = '.private-sessions';
// The conversations held with auto memory off, kept the same way beside the
// projects (memory-tier's Stop, which makes no store for them): the journal's
// backfill never imports them.
export const OFF = '.memory-off';
export function hushed(dir, s, mark = false, list = QUIET) {
  const p = join(dir, list);
  if (!s) return false;
  for (let i = 0; i < 3; i++) {
    // CRLF too: a tag with a \r left over matched no conversation, and a marked
    // one was written again.
    let before = null; try { before = readFileSync(p, 'utf8'); } catch {}
    const have = (before ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!mark || have.includes(s)) return have.includes(s);
    // By rename: written in place, a hook killed mid-write forgot every mark.
    // Again, from the text read, when another wrote first: two memory-off
    // Stops at once (no lock there) kept one tag.
    if (replaceIfUnchanged(p, before, [...have, s].slice(-1000).join('\n') + '\n') !== 'conflict') return true;
  }
  return true;
}

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
    if (!same(dirname(dirname(resolve(input.transcript_path))), projectsRoot())) return false;
    mkdirSync(dir, { recursive: true });
  }
  // The transcript is read outside the lock: it is the slow part, and this session's alone.
  const s = tag(input.session_id);
  // Read without the lock: a hint for how far back to read, nothing more.
  let since = null;
  try { const d = readFileSync(file, 'utf8'), { a, b } = sectionOf(d); if (a !== -1) since = parse(d.slice(a, b)).filter((t) => t.s === s).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).at(-1) ?? null; } catch {}
  const got = latest(input.transcript_path, since);
  // The transcript can lag the reply that ends it: on Stop, Claude Code passes
  // that reply itself (hooks docs). Not after a block: then it is the reply
  // to the block. Nor when the hold has just ended and nothing was said since:
  // the reply it passes is then the memory update's.
  const open = got.open, last = input.last_assistant_message;
  if (open && !open.frozen && !open.reopened && input.hook_event_name === 'Stop' && !input.stop_hook_active && typeof last === 'string' && last.trim()) {
    open.did = last.trim();
    if (got.at(-1) !== open) got.push(open);
  }
  // File names, not paths; none for a private message's turn. Private by what
  // the user typed, not the ask made of it: a wrapper own() strips, or a
  // command, hid the tag from the test.
  const fresh = got.map((t) => ({ ...t, s, ask: clip(t.ask, ASK), did: answer(t.raw ?? t.ask, t.did, DID),
    changed: PRIVATE.test(t.raw ?? t.ask) ? '' : newest(t.changed.map((f) => f.split(/[\\/]/).pop()), CHANGED) }));
  const hush = got.hush === true;
  // Sessions of one project write this file at once, so they take turns: 8 at
  // once lost 22 of 40 turns without the lock (2026-10-26). The model can still
  // edit the file by hand meanwhile -- the nudge asks it to -- and then the
  // merge is redone from what it wrote.
  const r = withLock(dir, () => {
    // A conversation marked private writes nothing, and what it wrote before
    // the mark goes. The mark is kept in a file: only the turn that typed it
    // sees it in the transcript.
    const quiet = hushed(dir, s, hush);
    // The journal (memory-tier's Stop passes its writer) takes this lock too,
    // not one of its own; whatever it throws is its own.
    if (sink) try { sink(dir, input.transcript_path, got, { quiet, hush }); } catch {}
    for (let i = 0; i < 3; i++) {
      const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const next = build(raw, quiet ? [] : fresh, quiet ? s : null, s, got.whole);
      if (next === null || next === 'unchanged') return quiet ? 'private' : next ?? false;
      const w = replaceIfUnchanged(file, raw, next);
      if (w !== 'conflict') return quiet ? 'private' : w || 'unchanged';
    }
    return false;
  });
  return r ?? 'busy';
}

// Warnings only: the startup line costs every session, so it says nothing
// here when all is well. The shared store's problems are every project's.
function health(dir) {
  const out = [];
  for (const d of [dir, sharedStore()]) {
    try { const h = readFileSync(join(d, '.health'), 'utf8').trim(); if (h) out.push(`Memory store needs attention (${d}): ${h.split('\n').join('; ')}`); } catch {}
  }
  // The record of where you left off could not be saved after the last reply.
  try {
    const f = JSON.parse(readFileSync(join(projectsRoot(), `.handoff-failed-${basename(dirname(dir))}`), 'utf8'));
    out.push(`Memory store needs attention (${dir}): the record of where you left off could not be saved after the reply at ${local(f.at)}: ${f.error}`);
  } catch {}
  try {
    const s = JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8'));
    if (s.failures >= 3) out.push(`Memory snapshots have failed ${s.failures} times in a row, last ok ${s.lastOk || 'never'}: ${s.error}`);
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
  if (typeof t === 'string' && same(dirname(dirname(t)), projectsRoot()) && !same(dirname(t), folders[0])) folders.push(dirname(t));
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
  const raw = readTail(p, TAIL).text;
  let end = NaN, seen = 0, known = 0, open = false;
  for (const line of raw.split('\n')) {
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
  const others = working.map((t) => {
    const e = all.filter((x) => x.s === t.s).at(-1);
    return `Another session is working in this project: ${e ? `${e.at} [${t.s}] ${clip(e.ask, 120)}` : `${local(t.m)} [${t.s}] (no handoff entry)`}`;
  });
  if (input.source === 'startup' || input.source === 'clear') {
    const last = all.filter((t) => t.s !== me).at(-1);
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
    if (first) lines.push(`Earlier work in this project since ${first} is in its journal: when asked about the past, search it with the memory skill before saying you don't know.`);
    lines.push(...health(dir), ...(doc ? stalled(live[0]) : []), ...edited(), ...shared());
    return fit(lines.join('\n') + '\n', 1000);
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
      if (memoryOff()) {}   // auto memory off: no record, no briefing
      else if (process.argv.includes('--print')) process.stdout.write(await print(input));
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
