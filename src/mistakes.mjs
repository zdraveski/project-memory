// The mistakes a journal holds, found by machine (1.7.0): a command that failed and, soon after, the same kind of command that
// went through; the errors that come back in conversation after conversation; the files that change together; and a reply that says
// "tests pass" over a last run that failed. All pure functions over the journal's entries, plus <store>/.mistakes.json, the cache
// the hooks read (F4 of the plan). Statically it imports store, text and enforce only (ADR 0003); journal is loaded inside buildMistakes.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { keyed, local, withLock, replaceIfUnchanged, raw, foldCase, MISTAKES, MISTAKES_TRIED, mistakesOwed } from './store.mjs';
import { clip } from './text.mjs';
import { segments, tokens } from './enforce.mjs';

// A failure is `<cmd> → failed: <last 300 characters>` (transcript.mjs). These texts are no failure and no success of the command: a
// Bash timeout, a user's interrupt, a refused call. Measured on Claude Code 2.1.332 (reports/1.7.0-probes.md, P10 and P11); refused() in
// transcript.mjs misses the permission texts, so they are listed here. The tail is all a failure keeps, so the ends of the texts count.
export const NOT_FAILURE = new RegExp([
  'Command timed out after',
  "The user doesn't want to proceed with this tool use",
  '\\[Request interrupted by user for tool use\\]',
  'The instruction to stop and wait still stands',
  'Permission to use \\S+ with command',
  'Permission for this (?:tool use|action|command)',
  'Claude requested permissions to',
  'with command [\\s\\S]*has been denied\\.?\\s*$',
].join('|'));

const FAILED = ' → failed: ';
const SETUP = new Set(['cd', 'sleep', 'export', 'set', 'pushd', 'echo', 'source']);
const LEAD = new Set(['env', 'command', 'sudo', 'time', 'rtk', 'exec', 'nohup']);
const WITH_SUB = new Set(['git', 'npm', 'pnpm', 'yarn', 'gh', 'docker', 'cargo', 'go', 'pip', 'kubectl', 'dotnet']);
const INTERPRETERS = new Set(['node', 'python', 'bash', 'sh', 'pwsh', 'powershell', 'ruby', 'deno', 'bun']);
const INLINE = new Set(['-c', '-e', '--eval']);
// Inline code: the flag of any interpreter above, a shell's joined flags (`-lc`), and pwsh's `-Command`.
const inline = (prog, w) => INLINE.has(w) || (/^(?:ba|z|da|k)?sh$/.test(prog) && /^-[a-z]*c$/.test(w)) || (/^(?:pwsh|powershell)$/.test(prog) && /^-(?:c|command|encodedcommand)$/i.test(w));

// The command a line ran, as a key: its first segment that is no setup, with `VAR=` and lead words dropped. null: none, or inline code.
export function targetOf(command) {
  for (const seg of segments(command)) {
    const t = tokens(seg);
    let i = 0;
    for (;;) {
      if (/^[A-Za-z_]\w*=/.test(t[i] ?? '')) i++;
      else if (LEAD.has(t[i])) { i++; while (t[i]?.startsWith('-')) i++; if (t[i - 1] === 'rtk' && ['bypass', 'proxy'].includes(t[i])) i++; }
      else break;
    }
    const prog = (t[i] ?? '').split(/[\\/]/).pop().replace(/\.exe$/i, '').replace(/^(python|pip)\d[\d.]*$/i, '$1').toLowerCase();
    if (SETUP.has(prog)) continue;
    if (/<<-?\s*["']?\w/.test(seg) || !/^[a-z][\w.+-]*$/.test(prog)) return null;
    const rest = t.slice(i + 1);
    if (INTERPRETERS.has(prog)) {
      const lead = rest.findIndex((w) => !w.startsWith('-'));
      if ((lead === -1 ? rest : rest.slice(0, lead)).some((w) => inline(prog, w))) return null;
      return lead === -1 ? prog : `${prog} ${rest[lead].replaceAll('\\', '/').replace(/^(\.\/)+/, '')}`;
    }
    const runs = prog === 'npx' ? 'npx' : prog === 'pnpm' && rest[0] === 'dlx' ? 'pnpm dlx' : null;   // a package runner: the package is the target
    if (runs) { const pkg = rest.slice(runs === 'npx' ? 0 : 1).find((w) => !w.startsWith('-')); return pkg ? `${runs} ${pkg}` : runs; }
    if (!WITH_SUB.has(prog)) return prog;
    let j = 0;
    while (rest[j]?.startsWith('-')) j += prog === 'git' && ['-C', '-c'].includes(rest[j]) ? 2 : 1;
    const sub = rest[j];
    if (sub === undefined) return prog;
    const script = ['run', 'run-script'].includes(sub) ? rest.slice(j + 1).find((w) => !w.startsWith('-')) : undefined;
    return script ? `${prog} run ${script}` : `${prog} ${sub}`;
  }
  return null;
}

// Where an error is: the markers, and what a line of it holds that differs from run to run.
const MARKERS = [/\b\w*(?:Error|Exception):/, /fatal:/, /error:/, /npm ERR!/, /FAILED/, /not ok/, /\bE[A-Z]{2,}\b/, /\bTS\d{3,5}\b/];
const TMP = /\/tmp\/[^\s'"`)]*|%TEMP%[^\s'"`)]*|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/]AppData[\\/]Local[\\/]Temp[\\/][^\s'"`)]*/gi;
// A number after a colon is a port or a line:col after a path, and stays.
const fold = (s) => s.replace(TMP, '<tmp>').replace(/(?<![\w:./\\-])\d{1,2}:\d\d(?::\d\d(?:\.\d+)?)?(?![\w:])/g, '<time>')
  .replace(/\b[0-9a-f]{7,}\b/gi, '<hex>').replace(/(?<![:\d])\d+/g, '#');
// The line holding the last error marker, folded and cut to 120; '' when there is none. A failure's text is squeezed to one line:
// then the line is cut from its first marker, or the 120 characters would not reach it.
export function errorLine(text) {
  const lines = String(text).split(/\r?\n/);
  for (let k = lines.length; k--;) {
    const at = MARKERS.map((m) => m.exec(lines[k])?.index ?? -1).filter((x) => x >= 0);
    if (at.length) return fold(clip(lines[k].slice(lines[k].length > 120 ? Math.min(...at) : 0), Infinity).trim()).slice(0, 120);
  }
  return '';
}

// The failed commands of an entry: [{ i (its place in ran), cmd, target, error }]. A call with no target (inline code) is left out, and
// so is one whose text is NOT_FAILURE: it is no failure and no success.
export function failuresOf(entry) {
  const out = [];
  (entry.ran ?? []).forEach((c, i) => {
    const at = typeof c === 'string' ? c.indexOf(FAILED) : -1;
    if (at === -1) return;
    const cmd = c.slice(0, at), text = c.slice(at + FAILED.length), target = targetOf(cmd);
    if (target && !NOT_FAILURE.test(text)) out.push({ i, cmd, target, error: errorLine(text) });
  });
  return out;
}

const cleanPath = (p) => foldCase(p.replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/\/+$/, ''));   // recall.mjs's, which this file may not import
const flat = (c) => c.replace(/\s+/g, ' ').trim();
const PROBE_FLAG = /(?:^|\s)(?:--help|-h|--version|--dry-run|--list)(?:\s|=|$)/, PROBE_SUB = new Set(['status', 'log', 'diff', 'show', 'ls']);
const probe = (cmd, target) => PROBE_FLAG.test(cmd) || target.split(' ').slice(1).some((w) => PROBE_SUB.has(w)) || target === 'ls';
const minutes = (e) => Date.parse(e.at.replace(' ', 'T')) / 6e4;

// F4: the errors, with the fix found for each, and the files that change together.
export function mistakes(entries, now) {
  const es = entries.map((e, k) => [e, k]).sort(([a, i], [b, j]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : i - j)).map(([e]) => e);
  // The entries after each one in its own conversation, two at most.
  const mine = new Map(), next = es.map(() => []);
  es.forEach((e, k) => { const l = mine.get(e.s) ?? mine.set(e.s, []).get(e.s); for (const p of l.slice(-2)) next[p].push(k); l.push(k); });
  const errors = new Map(), all = { failures: 0 };
  es.forEach((e, k) => {
    for (const f of failuresOf(e)) {
      all.failures++;
      const id = keyed(`${f.target}\n${f.error}`, 8), day = e.at.slice(0, 10);
      const r = errors.get(id) ?? errors.set(id, { target: clip(f.target, Infinity), error: f.error, n: 0, s: new Set(), d: new Set(), first: day, last: day, key: e.key, fix: '', fixKey: '', fs: new Set() }).get(id);
      r.n++; r.s.add(e.s); r.d.add(day); r.last = day; r.key = e.key;
      // The first later command of the same target that did not fail: after it in this entry, or in the next 2 of the conversation within an hour.
      const closes = (c) => typeof c === 'string' && !c.includes(FAILED) && targetOf(c) === f.target && flat(c) !== flat(f.cmd) && !probe(c, f.target);
      const near = next[k].filter((p) => minutes(es[p]) - minutes(e) <= 60);
      for (const [x, from] of [[e, f.i + 1], ...near.map((p) => [es[p], 0])]) {
        const c = (x.ran ?? []).slice(from).find(closes);
        if (c !== undefined) { r.fix = clip(c, Infinity); r.fixKey = x.key; r.fs.add(e.s); break; }
      }
    }
  });
  const kept = [...errors].sort(([ia, a], [ib, b]) => (a.last < b.last ? 1 : a.last > b.last ? -1 : b.n - a.n || (ia < ib ? -1 : 1))).slice(0, 500);
  const stamp = es.map((e) => e.at.slice(0, 10));
  return {
    v: 1, built: local(now).slice(0, 10),
    window: { from: stamp[0] ?? local(now).slice(0, 10), to: stamp.at(-1) ?? local(now).slice(0, 10), entries: es.length, failures: all.failures, days: new Set(stamp).size },
    errors: Object.fromEntries(kept.map(([id, r]) => [id, { target: r.target, error: r.error, n: r.n, sessions: r.s.size, days: r.d.size, first: r.first, last: r.last, key: r.key, fix: r.fix, fixKey: r.fixKey, fixSessions: r.fs.size }])),
    together: together(es),
  };
}

// `A with B`: A changed in 5 or more conversations and B in 80 % or more of them. A conversation's set is the union of its entries
// with 1 to 20 changed files, relative paths only. The top 200 by n, then both, then the names.
function together(es) {
  const sets = new Map();
  for (const e of es) {
    if (!(e.changed?.length >= 1 && e.changed.length <= 20)) continue;
    const set = sets.get(e.s) ?? sets.set(e.s, new Set()).get(e.s);
    for (const p of e.changed) { const c = cleanPath(p); if (c && !/^(?:[a-z]:)?\//i.test(c) && !c.split('/').includes('..') && !/(?:^|\/)\.claude\/projects(?:\/|$)/.test(c)) set.add(c); }
  }
  const count = new Map();
  for (const set of sets.values()) for (const p of set) count.set(p, (count.get(p) ?? 0) + 1);
  const both = new Map();
  for (const set of sets.values()) for (const a of set) if (count.get(a) >= 5) for (const b of set) if (b !== a && count.get(b) >= 4) { const m = both.get(a) ?? both.set(a, new Map()).get(a); m.set(b, (m.get(b) ?? 0) + 1); }
  const rules = [];
  for (const [a, m] of both) for (const [b, n] of m) if (n >= 0.8 * count.get(a)) rules.push({ a: clip(a, Infinity), b: clip(b, Infinity), n: count.get(a), both: n });
  return rules.sort((x, y) => y.n - x.n || y.both - x.both || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0)).slice(0, 200);
}

// The errors that keep coming back: an error line, 3 or more conversations on 2 or more days, the last within 30 days, no id in `resolved`.
export function recurring(m, now, resolved = new Set()) {
  const from = local(now - 30 * 864e5).slice(0, 10);
  return Object.entries(m.errors).filter(([id, e]) => e.error && e.sessions >= 3 && e.days >= 2 && e.last >= from && !resolved.has(id))
    .map(([id, e]) => ({ id, ...e })).sort((a, b) => b.sessions - a.sessions || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

// L6: a reply that says the checks are green, over a last check that failed. `said` is the reply, `ran` the turn's commands.
const CLAIMS = [[/\btests? (?:all )?pass(?:es|ing)?/gi, 'test'], [/\ball green\b/gi, 'any'], [/\bbuild succeeds\b/gi, 'build'], [/\blint is clean\b/gi, 'lint'], [/\bno errors\b/gi, 'any'], [/\bno failures\b/gi, 'any']];
const HEDGE = /\b(?:but|if|will|once|should|still|expected|except)\b|fail|not yet|\?/i;
const KINDS = {
  test: (t, cmd) => (/^node\b/.test(t) && /(?:^|\s)--test(?:\s|$)/.test(cmd)) || /^(?:npm|pnpm|yarn|bun) (?:run )?test$/.test(t) || /^(?:go|cargo|dotnet) test$/.test(t) || /^(?:(?:npx|pnpm dlx) )?(?:pytest|vitest|jest|mocha)$/.test(t) || /^(?:node|python|deno|ruby|bun) \S*(?:test|spec)/i.test(t),
  lint: (t) => /^(?:(?:npx|pnpm dlx) )?(?:eslint|tsc|ruff|mypy)$/.test(t) || (t.includes(' ') && /^(?:check|lint|verify)$/.test(t.split(' ').pop().split('/').pop().replace(/\.\w+$/, ''))),
  build: (t) => /^(?:npm|pnpm|yarn|bun) (?:run )?build$/.test(t) || /^(?:cargo|go) build$/.test(t) || t === 'make',
};
export function claimed(said, ran) {
  const text = String(said ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').split('\n').filter((l) => !/^\s*>/.test(l)).join('\n').slice(-1500);
  let claim = null, bare = text;
  for (const [re, kind] of CLAIMS) {
    for (const m of text.matchAll(re)) if (!claim || m.index > claim.at) claim = { at: m.index, kind };
    bare = bare.replace(re, ' ');
  }
  if (!claim || HEDGE.test(bare)) return null;
  const fits = claim.kind === 'any' ? Object.keys(KINDS) : [claim.kind];
  for (let j = (ran ?? []).length; j--;) {
    const c = ran[j];
    if (typeof c !== 'string') continue;
    const at = c.indexOf(FAILED), cmd = at === -1 ? c : c.slice(0, at), target = targetOf(cmd), kind = target && fits.find((k) => KINDS[k](target, cmd));
    if (!kind || (at !== -1 && NOT_FAILURE.test(c.slice(at + FAILED.length)))) continue;
    return at === -1 ? null : { cmd, target, kind };   // the last check: it passed (no later one of its target is left to look at), or it failed
  }
  return null;
}

// L9: the first rule whose `a` the turn changed and whose `b` neither the turn nor the context changed.
export function cochangeFor(rules, turnChanged, contextChanged) {
  const turn = new Set(turnChanged.map(cleanPath)), seen = new Set([...turn, ...contextChanged.map(cleanPath)]);
  return rules.find((r) => turn.has(cleanPath(r.a)) && !seen.has(cleanPath(r.b))) ?? null;
}

export function readMistakes(store) {
  try { const m = JSON.parse((raw(join(store, MISTAKES)) ?? '').replace(/^﻿/, '')); return m?.v === 1 ? m : null; } catch { return null; }
}
export { mistakesOwed };

// Built by the Stop's tidy child (memory-tier.mjs), once a day, from the last 90 days of the journal (recent() leaves out what is private
// or forgotten). Never throws: true when it wrote the file, false when it did not (nothing new, a busy lock, an unreadable journal).
// The day is stamped first, so a build that fails is not tried again until tomorrow (see mistakesOwed in store.mjs).
export async function buildMistakes(store, now) {
  try {
    const { recent } = await import('./journal.mjs');
    return withLock(store, () => {
      writeFileSync(join(store, MISTAKES_TRIED), `${local(now).slice(0, 10)}\n`, { mode: 0o600 });
      const es = recent(store, { days: 90, bytes: 6 * 1024 * 1024, deadline: performance.now() + 20_000, now }, () => true);
      if (!es) return false;
      const file = join(store, MISTAKES);
      return replaceIfUnchanged(file, raw(file), `${JSON.stringify(mistakes(es, now))}\n`) === true;
    }) ?? false;
  } catch { return false; }
}
