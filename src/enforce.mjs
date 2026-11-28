// A note can carry a rule a computer checks on a git command (`enforce:` in its
// front matter). This file reads the rule and matches it; it never runs, blocks
// or writes anything. Imports store.mjs, privacy.mjs and transcript.mjs only, so a hook can load it fast.
import { readFileSync, writeFileSync, readdirSync, openSync, closeSync, fstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { frontEnd, front, isIndex, sharedStore, tag, appendCapped } from './store.mjs';
import { records, readHead, typedMark } from './transcript.mjs';
import { gate, PRIVATE } from './privacy.mjs';

const BSL = String.fromCharCode(92), KEYS = ['on', 'has', 'unless'], MAX = 8;

// The note's rule: { rule: { on, has, unless } }, { bad: reason }, or null when it has no enforce: block.
// Only the front matter is read. Never throws.
export function ruleOf(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'), end = frontEnd(t);
  if (end === -1) return null;
  const lines = t.slice(0, end).split('\n'), at = lines.findIndex((l) => /^enforce:/.test(l));
  if (at === -1) return lines.some((l) => /^[ 	]+enforce:/.test(l)) ? { bad: 'write `enforce:` at the start of a line, not under metadata:' } : null;
  if (!/^enforce:[ \t]*$/.test(lines[at])) return { bad: 'write `enforce:` alone on its line, with on:, has: indented below it' };
  const got = {};
  for (const l of lines.slice(at + 1)) {
    if (!/\S/.test(l)) continue;
    if (!/^[ \t]/.test(l)) break;
    const m = l.match(/^[ \t]+([^:\s]+):[ \t]*(.*)$/);
    if (!m) return { bad: l.trim().startsWith('-') ? 'a block list is not read; write a flow list like [a, b]' : `cannot read the line "${l.trim().slice(0, 40)}"` };
    if (m[1] === 'true') return { bad: 'key `on` was rewritten to `true`; write it as on: git add' };
    if (!KEYS.includes(m[1])) return { bad: `unknown key \`${m[1]}\`` };
    if (m[1] in got) return { bad: `\`${m[1]}\` is given twice` };
    got[m[1]] = m[2].trimEnd(); // trimEnd, not a lazy `(.*?)[ \t]*$` in the match: that was quadratic on a long run of blanks
  }
  const words = (key, needed) => {
    const v = got[key];
    if (v === undefined) return needed ? { bad: `needs \`${key}\`` } : [];
    if (/["']/.test(v)) return { bad: `\`${key}\` has quotes; write the words bare` };
    if (v === '') return { bad: `\`${key}\` must be a word or a flow list like [a, b], not a block list` };
    if (v.startsWith('[') && !v.endsWith(']')) return { bad: `\`${key}\` list is not closed with ]` };
    const w = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => x.trim()) : [v];
    if (w.length === 1 && w[0] === '' && /^\[/.test(v)) return needed ? { bad: `\`${key}\` is empty` } : [];
    if (w.some((x) => !x || /\s/.test(x))) return { bad: `\`${key}\` holds an empty word or a word with a space` };
    return w.length > MAX ? { bad: `\`${key}\` holds more than ${MAX} words` } : w;
  };
  const on = (got.on ?? '').split(/\s+/).filter(Boolean);
  if (got.on === undefined) return { bad: 'needs `on`, like on: git add' };
  if (on[0] !== 'git') return { bad: '`on` must start with git, like on: git add' };
  if (on.length !== 2) return { bad: '`on` needs a git subcommand and nothing more, like on: git add' };
  const has = words('has', true), unless = words('unless', false);
  for (const w of [has, unless]) if (w.bad) return w;
  return { rule: { on: on[1], has, unless } };
}

// Every note of a store that has an enforce: block, archive and the indexes left out: [{ file, rule | bad }].
export function rulesOf(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md') && !isIndex(n)).sort(); } catch {}
  return names.flatMap((file) => {
    try {
      const text = readFileSync(join(dir, file)).subarray(0, HEAD).toString('utf8'), r = front(text).tier === 'archive' ? null : ruleOf(text);
      return r ? [{ file, ...r }] : [];
    } catch { return []; }
  });
}

// A command's segments: split at && || ; | { } ( ) and newlines outside quotes, heredoc bodies dropped (a commit
// message that says "git add -A" is no command), a line ending in \ or ` joined to the next. Outside single quotes a
// backslash escapes the next character; elsewhere it is a character (Windows paths).
export function segments(command) {
  const lines = String(command).split(/\r?\n/), last = new Map(), HD = /<<-?[ \t]*(["']?)([A-Za-z_]\w*)\1/y;
  lines.forEach((l, j) => last.set(l.trim(), j)); // the closing word's last line: an unclosed opener costs O(1), not a scan
  const out = []; let cur = '', q = '';
  const cut = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n], docs = []; let join = false, m;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === BSL && q !== "'") { if (i + 1 < l.length) cur += c + l[++i]; else if (!q) join = true; }
      else if (q) { cur += c; if (c === q) q = ''; }
      else if (c === '"' || c === "'") { q = c; cur += c; }
      else if (c === '`' && i + 1 === l.length) join = true;
      else if (c === '<' && l[i - 1] !== '<' && l[i + 1] === '<' && l[i + 2] !== '<' && (HD.lastIndex = i, m = HD.exec(l))) { docs.push(m[2]); cur += c; }
      else if (c === '#' && (i === 0 || /[\s;|&]/.test(l[i - 1]))) break; // a comment: its quotes open nothing
      else if (';|{}()&'.includes(c)) cut();
      else cur += c;
    }
    if (n === lines.length - 1) break;
    if (q) cur += '\n'; else if (join) cur += ' '; else cut();
    if (!q && !join) for (const w of docs) { const j = last.get(w) > n ? lines.findIndex((x, k) => k > n && x.trim() === w) : -1; if (j !== -1) n = j; }
  }
  cut();
  return out;
}

// A segment's words: blanks split them outside quotes, quotes group and are dropped, \" and \' are the quote itself.
export function tokens(segment) {
  const out = []; let cur = '', q = '', has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === BSL && q !== "'" && i + 1 < segment.length) { const d = segment[++i]; cur += d === '"' || d === "'" ? d : c + d; }
    else if (q) { if (c === q) q = ''; else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

const LEAD = ['!', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', 'env', 'command', 'sudo', 'time', 'rtk', 'exec', 'nohup', '&', 'cmd', 'cmd.exe'];
// Options of a lead word that take a value in the next word (`sudo -u bob`); other options, and `cmd /c`, are one word.
const LEAD_VALUE = { sudo: ['-u', '-g', '-h', '-p', '-r', '-t', '-C', '-D', '-R', '-T', '-U'], env: ['-u', '-C', '-S'], exec: ['-a'] };
const OPTS_WITH_VALUE = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'], SHELL = /^(?:.*[\\/])?(?:(?:ba|z|da)?sh|pwsh|powershell)(?:\.exe)?$/i;
// Whether `command` is the rule's git subcommand (`on`), and whether it also holds a word of `has` and none of `unless`.
// A command wrapped in quotes for a shell (`cmd /c "git add -A"`, `bash -c "..."`) is read on its own. shortcut: `$(...)`, aliases and anything after `--` are not seen (said in the README).
export function hits(rule, command) {
  const segs = segments(command).map(tokens), all = segs.flat().flatMap((w) => [w, ...w.split(/[\\/]/)]); // `unless` also sees each part of a path; `has` stays whole words
  let on = false, hit = false;
  for (const toks of segs) {
    let i = afterLead(toks);
    if (!/^(?:.*[\\/])?git(?:\.exe)?$/i.test(toks[i++] ?? '')) { const q = /\s/.test(toks[i - 1] ?? '') ? toks[i - 1] : SHELL.test(toks[i - 1] ?? '') ? toks.slice(i).find((t) => /\s/.test(t)) : ''; if (q) { const n = hits(rule, q); on ||= n.on; hit ||= n.hit; } continue; }
    while (toks[i]?.startsWith('-')) i += OPTS_WITH_VALUE.includes(toks[i]) ? 2 : 1;
    if (toks[i] !== rule.on) continue;
    on = true;
    const args = toks.slice(i + 1), stop = args.indexOf('--');
    if ((stop === -1 ? args : args.slice(0, stop)).some((a) => rule.has.includes(a))) hit = true;
  }
  return { on, hit: hit && !rule.unless.some((u) => all.includes(u)) };
}

// The command families a lesson can be about (`applies_when:`), in the spec's table order.
export const FAMILIES = ['push', 'merge', 'publish', 'release', 'deploy', 'destroy'];
const FORMS = { push: 'push|pushes|pushed|pushing', merge: 'merge|merges|merged|merging', publish: 'publish|publishes|published|publishing', release: 'release|releases|released|releasing', deploy: 'deploy|deploys|deployed|deploying', destroy: 'destroy|destroys|destroyed|destroying' };
// Names too common to say which file a lesson means: never a match alone, compared case-folded.
const COMMON = new Set(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md', 'index.js', 'index.mjs', 'index.ts', 'index.html', 'main.js', 'main.ts', 'app.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'settings.json', 'config.json', 'Makefile', 'Dockerfile', 'setup.py', 'requirements.txt'].map((n) => n.toLowerCase()));

// What a lesson's name, description and instead must not hold, or the lesson is hidden (spec L17): text that reads like an
// order to the model, or hides one. The reason says what was found. shortcut: the 64 KB head is all that is read.
const INVISIBLE = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩\p{Default_Ignorable_Code_Point}]/u;
const PHRASES = [/\b(?:ignore|disregard)\b.{0,40}\b(?:previous|prior|above|earlier)\b.{0,40}\binstructions?\b/i, /\bsystem prompt\b/i, /\byou are now\b/i, /\bnew instructions\b/i, /\bdo not tell the user\b/i,
  /<\/?\s*(?:system|assistant|user|human)\b/i, /\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba|z|da)?sh\b/];
const scan = (s) => {
  if (INVISIBLE.test(s)) return 'its text holds an invisible or control character';
  for (const re of PHRASES) { const m = re.exec(s); if (m) return `its text reads like an instruction to the model ("${m[0].slice(0, 40)}")`; }
  return /[A-Za-z0-9+/]{80,}={0,2}/.test(s) ? 'its text holds a long run of encoded characters' : '';
};
const cut = (s, n) => (s.length <= n ? s : s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n));
const LESSON_KEYS = ['applies_to', 'applies_when', 'instead', 'resolves'];

// The note's lesson (spec "A lesson"): { lesson } in the shape of F5, { bad: reason }, or null when the note is archived, or is no
// feedback note and has none of the keys applies_to:, applies_when:, instead:, resolves:. Only the front matter is read. Never throws.
export function lessonOf(text) {
  try {
    const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'), end = frontEnd(t);
    if (end === -1) return null;
    const f = front(t);
    if (f.tier === 'archive') return null;
    const lines = t.slice(0, end).split('\n'), got = {};
    let indented = '', block = false;
    lines.forEach((l, at) => {
      // The lines of a `description: |` or `>` block are text, whatever they quote.
      if (/^description:[ \t]*[>|]/.test(l)) { block = true; return; }
      if (block && (/^[ \t]/.test(l) || !/\S/.test(l))) return;
      block = false;
      const m = /^([ \t]*)(applies_to|applies_when|instead|resolves):[ \t]*(.*)$/.exec(l);
      if (!m) return;
      if (m[1]) indented ||= m[2]; else got[m[2]] ??= { v: m[3].trimEnd(), at };
    });
    if (f.type !== 'feedback' && !indented && !LESSON_KEYS.some((k) => k in got)) return null;
    if (indented) return { bad: `write \`${indented}:\` at the start of a line, not indented or under metadata:` };
    const words = (key) => {
      const g = got[key];
      if (!g) return [];
      const v = g.v;
      if (/["']/.test(v)) return { bad: `\`${key}\` has quotes; write the words bare` };
      if (v === '') return /^[ \t]*-(?:[ \t]|$)/.test(lines.slice(g.at + 1).find((l) => /\S/.test(l)) ?? '') ? { bad: `\`${key}\` is a block list, which is not read; write a flow list like [a, b]` } : [];
      if (v.startsWith('[') && !v.endsWith(']')) return { bad: `\`${key}\` list is not closed with ]` };
      const w = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => x.trim()) : [v];
      if (w.length === 1 && w[0] === '' && v.startsWith('[')) return [];
      if (w.some((x) => !x || /\s/.test(x))) return { bad: `\`${key}\` holds an empty word or a word with a space` };
      return w.length > MAX ? { bad: `\`${key}\` holds more than ${MAX} words` } : w;
    };
    const to = words('applies_to'), when = words('applies_when'), resolves = words('resolves');
    for (const w of [to, when, resolves]) if (w.bad) return w;
    const odd = when.find((w) => !FAMILIES.includes(w));
    if (odd) return { bad: `\`applies_when\` word "${odd}" is not one of ${FAMILIES.join(', ')}` };
    if (to.some((p) => /^(?:[A-Za-z]:|[\\/])/.test(p) || p.split(/[\\/]/).includes('..'))) return { bad: '`applies_to` must hold paths relative to the project, not an absolute path, a drive letter or ..' };
    if (resolves.some((w) => !/^[0-9a-f]{8}$/.test(w))) return { bad: '`resolves` must hold error ids of 8 hex characters' };
    const v = got.instead?.v ?? '', instead = v.match(/^(["'])(.*)\1$/)?.[2] ?? v;
    if (instead !== '' && (instead.length < 10 || instead.length > 200)) return { bad: '`instead` must be 10 to 200 characters' };
    if (/^(?:don['’]t|never|avoid|stop)\b/i.test(instead)) return { bad: '`instead` must say what to do, not what to avoid: it cannot start with don\'t, never, avoid or stop' };
    const name = cut(f.name, 120), desc = cut(f.desc, 300), seen = `${name} ${desc}`;
    // Named in the name and description only, never the body: what an untagged lesson is matched on.
    const toks = seen.split(/\s+/).map((w) => w.replace(/^[`'"(]+/, '').replace(/[`'".,;:)]+$/, '')).filter(Boolean);
    const files = toks.filter((w) => /^[\w.-]+\.[A-Za-z0-9]{1,5}$/.test(w) && w.length >= 5 && !COMMON.has(w.toLowerCase()));
    const named = { paths: [...new Set(toks.filter((w) => w.includes('/')))], files: [...new Set(files)], families: FAMILIES.filter((fam) => new RegExp(`\\b(?:${FORMS[fam]})\\b`, 'i').test(seen)) };
    // A hidden lesson keeps only its reason: its text must not reach the cache or a caller.
    const hidden = PRIVATE.test(t) ? 'holds <private>' : scan(name) || scan(desc) || scan(instead);
    return { lesson: hidden ? { hidden } : { type: f.type, name, desc, to, when, instead, resolves, named, hidden } };
  } catch { return null; }
}

// The index of a segment's command word, after the lead words (env, sudo, VAR=x ...) and their options. hits() and familyOf() both use it.
function afterLead(toks) {
  let i = 0;
  while (i < toks.length && (/^[A-Za-z_]\w*=/.test(toks[i]) || LEAD.includes(toks[i]) || !toks[i])) {
    const lead = toks[i++];
    if (!LEAD.includes(lead)) continue;
    while (/^-|^\/[ck]$/i.test(toks[i] ?? '')) i += LEAD_VALUE[lead]?.includes(toks[i]) ? 2 : 1;
    if (lead === 'rtk' && ['bypass', 'proxy'].includes(toks[i])) i++;
  }
  return i;
}
const flag = (args, short, long) => args.some((a) => a === `--${long}` || new RegExp(`^-[A-Za-z]*${short}[A-Za-z]*$`).test(a));
const INTERPRETER = /^(?:node(?:js)?|(?:ba|z|da)?sh|python3?|pwsh|powershell|ruby|perl|bun|deno)$/;

// Which of FAMILIES a command is about (spec H2), in that order. Command words only: a heredoc body or a word in an argument is
// no command. A command in a shell's quotes is read on its own, as hits() reads it. shortcut: `$(...)`, aliases and
// `npm run deploy` are not seen; upgrade if a user shows it matters.
export function familyOf(command) {
  const out = new Set();
  try {
    for (const toks of segments(command).map(tokens)) {
      const i = afterLead(toks), word = toks[i] ?? '', cmd = word.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
      const q = /\s/.test(word) ? word : SHELL.test(word) ? toks.slice(i + 1).find((t) => /\s/.test(t)) : '';
      if (q) { familyOf(q).forEach((x) => out.add(x)); continue; }
      let args = toks.slice(i + 1); const stop = args.indexOf('--'); if (stop !== -1) args = args.slice(0, stop);
      let a = 0; if (cmd === 'git') while (args[a]?.startsWith('-')) a += OPTS_WITH_VALUE.includes(args[a]) ? 2 : 1;
      const rest = args.slice(a), plain = args.filter((x) => !x.startsWith('-')), sub = cmd === 'git' ? rest[0] : plain[0];
      if (cmd === 'git' && sub === 'push') { out.add('push'); if (flag(rest, 'f', 'force')) out.add('destroy'); }
      if (cmd === 'git' && sub === 'merge') out.add('merge');
      if (cmd === 'git' && sub === 'reset' && rest.includes('--hard')) out.add('destroy');
      if (cmd === 'git' && sub === 'clean' && flag(rest, 'f', 'force')) out.add('destroy');
      if (cmd === 'docker' && sub === 'push') out.add('push');
      if (cmd === 'gh' && plain[0] === 'pr' && plain[1] === 'merge') out.add('merge');
      if (cmd === 'gh' && plain[0] === 'release') out.add('release');
      if (['npm', 'pnpm', 'yarn', 'cargo'].includes(cmd) && sub === 'publish') out.add('publish');
      if (cmd === 'twine' && sub === 'upload') out.add('publish');
      if (/^node(?:js)?$/.test(cmd) && /(?:^|[\\/])tools[\\/]release\.mjs$/.test(plain[0] ?? '')) out.add('release');
      if ((cmd === 'terraform' || cmd === 'kubectl') && sub === 'apply') out.add('deploy');
      if ((cmd === 'terraform' && sub === 'destroy') || (cmd === 'kubectl' && sub === 'delete')) out.add('destroy');
      if (cmd === 'rm' && flag(args, '[rR]', 'recursive') && flag(args, 'f', 'force')) out.add('destroy');
      if (cmd === 'remove-item' && args.some((x) => /^-r[a-z]*$/i.test(x) && 'recurse'.startsWith(x.slice(1).toLowerCase()))) out.add('destroy'); // any prefix of -Recurse
      const script = INTERPRETER.test(cmd) && plain[0] && !/\s/.test(plain[0]) ? plain[0] : '';
      if ([word, script].some((n) => n.replace(/^.*[\\/]/, '').toLowerCase().split(/[-_.]/).includes('deploy'))) out.add('deploy');
    }
  } catch {}
  return FAMILIES.filter((f) => out.has(f));
}

// Each git Bash or PowerShell command in a transcript, `got({ command, t, sidechain })`, read with transcript.mjs's `chunk`
// in pieces of `seg` bytes (a line longer than that, a tool result, is passed over). Lines without `git` are not parsed.
export function commandsOf(file, chunk, seg, got) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    for (let pos = 0, b; (b = chunk(fd, pos, seg, size)); pos = b.pos + b.buf.length) {
      for (const j of records(b.buf.toString('utf8'), { sidechain: true, has: 'git' }))
        for (const c of Array.isArray(j?.message?.content) ? j.message.content : [])
          if (c?.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string' && c.input.command.includes('git'))
            got({ command: c.input.command, t: Date.parse(j.timestamp), sidechain: j.isSidechain === true });
    }
  } finally { closeSync(fd); }
}

export const LOG = '.enforce-log', CACHE = '.enforce.json', LOG_MAX = 256 * 1024, CACHE_V = 4, HEAD = 64 * 1024;

// A store's notes through its cache `.enforce.json` ({ v, files: { file: { mtime, size, r, l } } }; another v is rebuilt, as ruleOf and
// lessonOf may read differently): only a note that is new or changed since is read, and then only its first 64 KB, ruleOf only if that
// holds `enforce:`. Gives [{ file, r, l, mtime }]: r is ruleOf's answer, l lessonOf's, each null for none. A cache that does not read is
// rebuilt, and with `write: false` it is not written (a reader that must leave no file). Never throws.
const lessonShaped = (l) => l == null || (typeof l === 'object' && (typeof l.bad === 'string' || (!!l.lesson && typeof l.lesson === 'object' && (l.lesson.hidden ? typeof l.lesson.hidden === 'string' : Array.isArray(l.lesson.to)))));
export function notesOf(dir, { write = true } = {}) {
  let old = {}, names = [], changed = false;
  try { const j = JSON.parse(readFileSync(join(dir, CACHE), 'utf8')); if (j?.v === CACHE_V && j.files && typeof j.files === 'object' && !Array.isArray(j.files)) old = j.files; } catch {}
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md') && !isIndex(n)).sort(); } catch { return []; }
  const now = {}, out = [];
  for (const file of names) {
    try {
      const st = statSync(join(dir, file)), { mtimeMs: mtime, size } = st, was = old[file];
      if (!st.isFile()) continue; // a folder named like a note: Windows reads it as empty, elsewhere the read throws
      let r, l;
      // A cache entry whose lesson is not the shape lessonOf gives is read again.
      if (was && was.mtime === mtime && was.size === size && lessonShaped(was.l)) { r = was.r; l = was.l; }
      else {
        changed = true;
        const text = readHead(join(dir, file), Math.min(size, HEAD));
        r = text.includes('enforce:') && front(text).tier !== 'archive' ? ruleOf(text) : null;
        l = lessonOf(text);
      }
      now[file] = { mtime, size, r: r ?? null, l: l ?? null };
      out.push({ file, r: r ?? null, l: l ?? null, mtime });
    } catch {}
  }
  if (write && (changed || Object.keys(old).length !== Object.keys(now).length)) try { writeFileSync(join(dir, CACHE), JSON.stringify({ v: CACHE_V, files: now }), { mode: 0o600 }); } catch {}
  return out;
}
const rulesIn = (dir) => notesOf(dir).filter((x) => x.r).map(({ file, r }) => ({ file, ...r }));

// What the hook needs for a payload: { store, rules } with the project's and the shared store's rules that read
// (a shared one is named `_shared/<file>`), or { store, off } when memory is off or the conversation is private.
// An unreadable marker or tag list counts as private: no log is safer than a log of a private conversation.
export function ruleSet(payload) {
  // One try each: this hook has 5 s. A list that cannot be read is private (privacy.mjs).
  const { why, ...at } = gate(payload, tag(payload?.session_id), 1), { store } = at;
  if (why) return { ...at, off: true, rules: [] };
  const rules = rulesIn(store).filter((x) => x.rule);
  const shared = sharedStore() === store ? [] : rulesIn(sharedStore()).filter((x) => x.rule).map((x) => ({ ...x, file: `_shared/${x.file}` }));
  return { store, rules: [...rules, ...shared] };
}

// True when the user typed the private-session mark anywhere in the conversation, as the writers read one (transcript.mjs
// typedMark); an unreadable transcript counts as private (no path: not).
export const privateTurn = (payload, seg) => !!payload?.transcript_path && typedMark(payload.transcript_path, seg);

// One line of the log (dropped if over 1 KB or the store has no folder). Over LOG_MAX, the oldest half of the log goes.
// shortcut: no lock, so a line can be lost under heavy parallel use (said in the docs).
export function record(store, entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    if (line.length > 1024) return;
    appendCapped(join(store, LOG), line, LOG_MAX);
  } catch {}
}

// What `memory enforce status` shows of a store: its rule notes (and the shared store's, as `_shared/<file>`), each with the
// log's hits since `from` (ms) split main and sub-agent. Never throws.
export function tally(dir, from) {
  const lines = [], once = new Set(); // a call a git filter and a lesson filter both start logs one line a start: the same note and id is one hit
  try {
    const f = join(dir, LOG);
    for (const l of readFileSync(f, 'utf8').split('\n')) try {
      const j = JSON.parse(l), t = Date.parse(j.t), k = `${j.note}\0${j.id}`;
      if (t >= from && !(j.id && once.has(k))) { once.add(k); lines.push({ note: String(j.note), t, sub: !!j.agent }); }
    } catch {}
  } catch {}
  const shared = sharedStore() === dir ? [] : rulesOf(sharedStore()).map((x) => ({ ...x, file: `_shared/${x.file}` }));
  const notes = [...rulesOf(dir), ...shared].map(({ file, bad }) => {
    const mine = lines.filter((l) => l.note === file);
    return { file, bad, main: mine.filter((l) => !l.sub).length, sub: mine.filter((l) => l.sub).length, last: Math.max(0, ...mine.map((l) => l.t)) };
  });
  return { notes };
}
