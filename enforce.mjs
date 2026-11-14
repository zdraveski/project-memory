// A note can carry a rule a computer checks on a git command (`enforce:` in its
// front matter). This file reads the rule and matches it; it never runs, blocks
// or writes anything. Imports store.mjs only, so a hook can load it fast.
import { readFileSync, writeFileSync, appendFileSync, readdirSync, openSync, readSync, closeSync, fstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { frontEnd, front, isIndex, storeOf, sharedStore, projectsRoot, memoryOff, isOff, tag, QUIET, OFF, listOf } from './store.mjs';

const KEYS = ['on', 'has', 'unless'], MAX = 8;

// The note's rule: { rule: { on, has, unless } }, { bad: reason }, or null when it has no enforce: block.
// Only the front matter is read. Never throws.
export function ruleOf(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n'), end = frontEnd(t);
  if (end === -1) return null;
  const lines = t.slice(0, end).split('\n'), at = lines.findIndex((l) => /^enforce:/.test(l));
  if (at === -1) return null;
  if (!/^enforce:[ \t]*$/.test(lines[at])) return { bad: 'write `enforce:` alone on its line, with on:, has: indented below it' };
  const got = {};
  for (const l of lines.slice(at + 1)) {
    if (!/\S/.test(l)) continue;
    if (!/^[ \t]/.test(l)) break;
    const m = l.match(/^[ \t]+([^:\s]+):[ \t]*(.*?)[ \t]*$/);
    if (!m) return { bad: l.trim().startsWith('-') ? 'a block list is not read; write a flow list like [a, b]' : `cannot read the line "${l.trim().slice(0, 40)}"` };
    if (m[1] === 'true') return { bad: 'key `on` was rewritten to `true`; write it as on: git add' };
    if (!KEYS.includes(m[1])) return { bad: `unknown key \`${m[1]}\`` };
    if (m[1] in got) return { bad: `\`${m[1]}\` is given twice` };
    got[m[1]] = m[2];
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
      const text = readFileSync(join(dir, file), 'utf8'), r = front(text).tier === 'archive' ? null : ruleOf(text);
      return r ? [{ file, ...r }] : [];
    } catch { return []; }
  });
}

// A command's segments: split at && || ; | and newlines outside quotes, heredoc bodies dropped first
// (a commit message that says "git add -A" is no command). A backslash is a character (Windows paths).
export function segments(command) {
  const lines = String(command).split(/\r?\n/), kept = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    const h = lines[i].match(/(?<!<)<<(?!<)-?[ \t]*(["']?)([A-Za-z_]\w*)\1/);
    // No closing word: the "heredoc" was a quoted `<<EOF`, and the lines stay.
    const end = h ? lines.findIndex((l, j) => j > i && l.trim() === h[2]) : -1;
    if (end !== -1) i = end;
  }
  const out = []; let cur = '', q = '';
  const cut = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  const s = kept.join('\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = ''; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === '\n' || c === ';' || c === '|' || c === '&' && s[i + 1] === '&') { cut(); if (s[i + 1] === c && c !== '\n' && c !== ';') i++; }
    else cur += c;
  }
  cut();
  return out;
}

// A segment's words: blanks split them outside quotes, quotes group and are dropped.
export function tokens(segment) {
  const out = []; let cur = '', q = '', has = false;
  for (const c of segment) {
    if (q) { if (c === q) q = ''; else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

const LEAD = ['!', '{', 'do', 'then', 'else', 'elif', 'if', 'while', 'until'];
const OPTS_WITH_VALUE = ['-C', '-c', '--git-dir', '--work-tree'], OPTS = ['--no-pager', '-P', '--literal-pathspecs'];
// Whether `command` is the rule's git subcommand (`on`), and whether it also holds a word of `has` and none of `unless`.
// shortcut: `bash -c "..."`, `$(...)`, aliases and anything after `--` are not seen (said in the README).
export function hits(rule, command) {
  const segs = segments(command).map(tokens), all = segs.flat();
  let on = false, hit = false;
  for (const toks of segs) {
    let i = 0;
    // A group or loop opener before the command: `(git ...)`, `do git ...`, `then git ...`.
    if (toks[0]?.startsWith('(')) { toks[0] = toks[0].replace(/^\(+/, ''); toks[toks.length - 1] = toks[toks.length - 1].replace(/\)+$/, ''); }
    while (i < toks.length && (/^[A-Za-z_]\w*=/.test(toks[i]) || LEAD.includes(toks[i]) || !toks[i])) i++;
    if (toks[i++] !== 'git') continue;
    for (; i < toks.length; i++) {
      if (OPTS_WITH_VALUE.includes(toks[i])) i++;
      else if (!(OPTS.includes(toks[i]) || /^--(?:git-dir|work-tree)=/.test(toks[i]))) break;
    }
    if (toks[i] !== rule.on) continue;
    on = true;
    const args = toks.slice(i + 1), stop = args.indexOf('--');
    if ((stop === -1 ? args : args.slice(0, stop)).some((a) => rule.has.includes(a))) hit = true;
  }
  return { on, hit: hit && !rule.unless.some((u) => all.includes(u)) };
}

// Each git Bash or PowerShell command in a transcript, `got({ command, t, sidechain })`, read with journal.mjs's `chunk`
// in pieces of `seg` bytes (a line longer than that, a tool result, is passed over). Lines without `git` are not parsed.
export function commandsOf(file, chunk, seg, got) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    for (let pos = 0, b; (b = chunk(fd, pos, seg, size)); pos = b.pos + b.buf.length) {
      for (const line of b.buf.toString('utf8').split('\n')) {
        if (!line.includes('git')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        for (const c of Array.isArray(j?.message?.content) ? j.message.content : [])
          if (c?.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string' && c.input.command.includes('git'))
            got({ command: c.input.command, t: Date.parse(j.timestamp), sidechain: j.isSidechain === true });
      }
    }
  } finally { closeSync(fd); }
}

export const LOG = '.enforce-log', CACHE = '.enforce.json', LOG_MAX = 256 * 1024, CACHE_V = 1;

// A store's rules through its cache `.enforce.json` ({ v, files: { file: { mtime, size, r } } }; another v is rebuilt, as ruleOf may read differently): only a note that is new or changed since
// is read, and then only its first 2 KB unless that holds `enforce:`. A cache that does not read is rebuilt. Never throws.
function cached(dir) {
  let old = {}, names = [], changed = false;
  try { const j = JSON.parse(readFileSync(join(dir, CACHE), 'utf8')); if (j?.v === CACHE_V && j.files && typeof j.files === 'object' && !Array.isArray(j.files)) old = j.files; } catch {}
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md') && !isIndex(n)).sort(); } catch { return []; }
  const now = {}, out = [];
  for (const file of names) {
    try {
      const { mtimeMs: mtime, size } = statSync(join(dir, file)), was = old[file];
      let r;
      if (was && was.mtime === mtime && was.size === size) r = was.r;
      else {
        changed = true;
        const fd = openSync(join(dir, file), 'r'), head = Buffer.alloc(2048);
        let got = 0; try { got = readSync(fd, head, 0, 2048, 0); } finally { closeSync(fd); }
        if (!head.toString('utf8', 0, got).includes('enforce:')) r = null;
        else { const text = readFileSync(join(dir, file), 'utf8'); r = front(text).tier === 'archive' ? null : ruleOf(text); }
      }
      now[file] = { mtime, size, r: r ?? null };
      if (r) out.push({ file, ...r });
    } catch {}
  }
  if (changed || Object.keys(old).length !== Object.keys(now).length) try { writeFileSync(join(dir, CACHE), JSON.stringify({ v: CACHE_V, files: now })); } catch {}
  return out;
}

// What the hook needs for a payload: { store, rules } with the project's and the shared store's rules that read
// (a shared one is named `_shared/<file>`), or { store, off } when memory is off or the conversation is private.
// An unreadable marker or tag list counts as private: no log is safer than a log of a private conversation.
export function ruleSet(payload) {
  if (memoryOff()) return { off: true, rules: [] };
  const store = storeOf(payload);
  if (isOff(store)) return { store, off: true, rules: [] };
  const s = tag(payload.session_id), tagged = (dir, list) => { try { return listOf(readFileSync(join(dir, list), 'utf8')).includes(s); } catch (e) { return e.code !== 'ENOENT'; } };
  if (s && (tagged(store, QUIET) || tagged(projectsRoot(), OFF))) return { store, off: true, rules: [] };
  const rules = cached(store).filter((x) => x.rule);
  const shared = sharedStore() === store ? [] : cached(sharedStore()).filter((x) => x.rule).map((x) => ({ ...x, file: `_shared/${x.file}` }));
  return { store, rules: [...rules, ...shared] };
}

// One line of the log, unless the log is over LOG_MAX (it stops growing; status says so) or the store has no folder.
// shortcut: no lock, so a line can be lost under heavy parallel use (said in the docs).
export function record(store, entry) {
  try {
    const f = join(store, LOG);
    let size = 0; try { size = statSync(f).size; } catch {}
    if (size <= LOG_MAX) appendFileSync(f, JSON.stringify(entry) + '\n');
  } catch {}
}
