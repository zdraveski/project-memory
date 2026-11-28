// Replay (1.7.0, spec H6): what each lesson trigger would have done over the journal, knowing only what existed before each exchange,
// and `memory lessons`, the list of the lessons with their counters. Read-only: the journal comes through the `recent` it is handed
// (memory.mjs loads journal.mjs apart, so a journal that will not load costs only this command), the notes through notesOf with no
// cache write. The only thing a run writes is the history line memory.mjs appends from the `history` returned here: numbers only.
// Imports store, text, enforce, lessons, mistakes, correction and recall (never the other way round, ADR 0003).
import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { foldCase, local, sharedStore } from './store.mjs';
import { clip } from './text.mjs';
import { notesOf, familyOf } from './enforce.mjs';
import { matchPath, matchFamily, order, wilson, readCounters } from './lessons.mjs';
import { mistakes, recurring, claimed, cochangeFor, failuresOf, targetOf, readMistakes } from './mistakes.mjs';
import { correction } from './correction.mjs';
import { cleanPath, isHelper } from './recall.mjs';

const FAILED = ' → failed: ', NEXT = 20, ENOUGH = 20;
// Ordering by shown/followed/broken would use today's counts for an exchange of last month: the order is by specificity and name alone.
// (A lesson retired today is still left out: the plan counts it among those that existed, not those that could fire.)
const NO_COUNTERS = { v: 1, notes: {}, errors: {} };
// The trigger ids, in the order the report prints them, with the name of each line.
const LINES = [['edit', 'H1 edit lessons'], ['command', 'H2 command lessons'], ['deadend', 'H3 dead ends'], ['recurring', 'H4 recurring errors'],
  ['stuck', 'L2 stuck streak'], ['nudge', 'H5 nudge'], ['claim', 'L6 claim check'], ['cochange', 'L9 co-change']];

const ms = (at) => Date.parse(at.replace(' ', 'T'));   // a journal time (local, to the minute) as milliseconds
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const cmdOf = (c) => { const k = c.indexOf(FAILED); return k === -1 ? c : c.slice(0, k); };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return !s.length ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = (x) => +x.toFixed(1), pc = (x) => Math.round(x * 100);
const said = (x) => [x.l.desc || x.l.name, x.l.instead && `Instead: ${x.l.instead}`].filter(Boolean).join(' ');
// A path the journal keeps relative to the folder of the turn: an absolute one, one outside it and a memory file are no repository path.
const inside = (p) => !/^(?:[A-Za-z]:)?[\\/]/.test(p) && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p) && !/(?:^|[\\/])\.claude[\\/]projects(?:[\\/]|$)/.test(p);

// The blind cut: a lesson exists for an exchange only when it was created strictly before it (both are local times to the minute, so the
// same minute is not before). A lesson newer than the exchange in the set would make every number wrong, so it throws, not warns.
export const blindSet = (lessons, entry) => lessons.filter((x) => x.created < entry.at);
export function assertBlind(set, entry) {
  for (const x of set) if (!(x.created < entry.at)) throw new Error(`replay leak: ${x.name} is newer than ${entry.key}`);
}

// A store's lessons, each with the time it was created: the first entry that changed its file, else the file's time, which is never earlier
// than the truth: the lesson then fires for fewer exchanges, never more. The file is `<projects>/<folder>/memory/<file>`, <folder> being this
// project's or one this machine has no store for (the same project's journal from another machine names its own folder); another project's
// note of the same name here, or the shared store's, does not date this one. Hidden lessons are counted, not listed.
function lessonsIn(dir, prefix, entries) {
  const out = { list: [], notes: 0, hidden: 0 }, own = foldCase(basename(dirname(dir))), others = new Set();
  try { for (const x of readdirSync(dirname(dirname(dir)), { withFileTypes: true })) if (x.isDirectory()) others.add(foldCase(x.name)); } catch { /* no folder to compare with: every folder is foreign */ }
  others.delete(own);
  const madeBy = (file) => entries.find((e) => e.changed.some((p) => {
    const q = foldCase(p.replaceAll('\\', '/')).split('/'), n = q.length;
    return q[n - 1] === foldCase(file) && q[n - 2] === 'memory' && q[n - 4] === 'projects' && !others.has(q[n - 3]);
  }));
  for (const x of notesOf(dir, { write: false })) {
    out.notes++;
    const l = x.l?.lesson;
    if (!l) continue;
    if (l.hidden) { out.hidden++; continue; }
    const made = madeBy(x.file);
    out.list.push({ name: prefix + x.file, l, mtime: x.mtime, r: x.r, created: made ? made.at : local(x.mtime), byFile: !made, ...(prefix ? { shared: true } : {}) });
  }
  return out;
}

// One store's exchanges in time order, each simulated with only the lessons, mistakes and context from before it. Gives the firings
// ({ trigger, i, ref, said, hit }) and the misses per trigger by cause.
function walk(es, lessons) {
  const day = (e) => e.at.slice(0, 10), conv = new Map(), listed = new Map(), fired = [], dropped = [], exist = [], firstOf = [], corr = [];
  let lo = 0;
  es.forEach((e, i) => {
    while (es[lo].at < e.at) lo++;   // es[0..lo) are strictly before this minute
    const t = ms(e.at), set = blindSet(lessons, e), helper = isHelper(e);
    assertBlind(set, e);
    const st = conv.get(e.s) ?? conv.set(e.s, { started: false, edit: { seen: new Set(), n: 0 }, command: { seen: new Set(), n: 0 }, prompts: 0, nudged: -Infinity, nudges: 0, changed: [], last: '', rules: [], rec: false, cochange: false }).get(e.s);
    const first = !helper && !st.started;
    firstOf[i] = first;
    const fire = (trigger, ref, say, share = {}) => fired.push({ i, trigger, ref, said: say, files: [], families: [], targets: [], ...share });
    const drop = (trigger) => dropped.push({ i, trigger });
    // H1 and H2: once per lesson per conversation, at most 2 an entry and 6 a conversation.
    const used = { edit: 0, command: 0 };
    const speak = (trigger, matches, share) => {
      for (const { lesson: x } of order(matches, NO_COUNTERS, t)) {
        const s = st[trigger];
        if (s.seen.has(x.name) || used[trigger] >= 2 || s.n >= 6) { drop(trigger); continue; }
        s.seen.add(x.name); s.n++; used[trigger]++;
        fire(trigger, x.name, said(x), share);
      }
    };
    for (const p of e.changed) if (inside(p)) speak('edit', matchPath(set, p), { files: [p] });
    for (const c of e.ran) if (typeof c === 'string') for (const fam of familyOf(cmdOf(c))) speak('command', matchFamily(set, fam), { families: [fam] });
    // H3, H4 and L9 speak at a startup: the first exchange of a conversation. The mistakes are those of the entries before it.
    if (first) {
      st.started = true;
      const dead = order(set.filter((x) => !x.shared && x.l.instead).map((lesson) => ({ lesson, how: 1 })), NO_COUNTERS, t).map((m) => m.lesson);
      for (const x of dead.slice(0, 3)) fire('deadend', x.name, said(x), { files: x.l.to.filter((p) => !/\*|[\\/]$/.test(p)), families: x.l.when });
      if (dead.length > 3) drop('deadend');
      if (lo > 0) {
        const m = mistakes(es.slice(0, lo), t), rec = recurring(m, t, new Set(set.flatMap((x) => x.l.resolves))), fresh = rec.filter((r) => (listed.get(r.id) ?? 0) < 3);
        st.rules = m.together; st.rec = rec.length > 0;
        for (const r of fresh.slice(0, 2)) { listed.set(r.id, (listed.get(r.id) ?? 0) + 1); fire('recurring', r.id, `${r.target}: "${r.error}" in ${r.sessions} conversations on ${r.days} days, last ${r.last}`, { targets: [r.target] }); }
        if (rec.length > Math.min(2, fresh.length)) drop('recurring');
      }
    }
    if (!helper) {
      const r = !st.cochange && st.rules.length ? cochangeFor(st.rules, e.changed, st.changed) : null;
      if (r) { st.cochange = true; fire('cochange', `${r.a} with ${r.b}`, `${r.a} changed with ${r.b} in ${r.both} of ${r.n} conversations`, { files: [r.b] }); }
      const c = claimed(e.answered, e.ran);
      if (c) fire('claim', c.target, `says the ${c.kind} checks pass, but the last "${c.target}" failed`, { targets: [c.target] });
      // H5: the cooldown is at most 1 nudge in 10 prompts and 3 in a conversation. The journal keeps no interrupt marker.
      st.prompts++;
      const n = correction(e.asked, { first, helper: false, marker: () => false, lastEndsWithQuestion: () => /\?\s*$/.test(st.last) });
      if (n.fire) {
        if (st.nudges >= 3 || st.prompts - st.nudged < 10) drop('nudge');
        else { st.nudges++; st.nudged = st.prompts; fire('nudge', n.ids.join(' '), 'this reads like a correction that should last: save it as a feedback note'); }
      }
      st.last = e.answered;
    }
    // L2: two failures of one target with no unmarked command of that target between them; once per target in an entry. A lower bound:
    // the journal clears the earlier mark of an exact re-run.
    const fails = new Map(failuresOf(e).map((f) => [f.i, f]));
    if (fails.size > 1) {
      const streak = new Map(), done = new Set();
      e.ran.forEach((c, k) => {
        const f = fails.get(k);
        if (f) {
          streak.set(f.target, (streak.get(f.target) ?? 0) + 1);
          if (streak.get(f.target) === 2 && !done.has(f.target)) { done.add(f.target); fire('stuck', f.target, `"${f.target}" failed twice in a row in this turn`, { targets: [f.target] }); }
        } else if (typeof c === 'string' && !c.includes(FAILED)) { const tg = targetOf(c); if (tg) streak.delete(tg); }
      });
    }
    st.changed.push(...e.changed);
    // Whether a lesson of each kind existed at this exchange: what tells a miss "no lesson" from "no match".
    exist[i] = { edit: set.some((x) => !x.shared && (x.l.to.length > 0 || x.l.named.paths.length > 0 || x.l.named.files.length > 0)), command: set.some((x) => x.l.when.length > 0 || x.l.named.families.length > 0),
      deadend: set.some((x) => !x.shared && !!x.l.instead), recurring: st.rec, cochange: st.rules.length > 0 };
  });
  // A request that reads like a correction (the first of a conversation and a helper's cannot be one).
  const isCorr = (i) => (corr[i] ??= !isHelper(es[i]) && !firstOf[i] && correction(es[i].asked, { first: false, helper: false, marker: () => false, lastEndsWithQuestion: () => false }).fire);
  const low = (s) => s.toLowerCase(), same = (c, p) => { const a = cleanPath(c), b = cleanPath(p); return a === b || a.endsWith(`/${b}`); };
  // Shares the firing's file or family: the entry changed the file, ran the family or target, or its request names either.
  const shares = (f, e) => {
    const ask = low(e.asked), cmds = e.ran.filter((c) => typeof c === 'string').map(cmdOf);
    return f.files.some((p) => e.changed.some((c) => same(c, p)) || ask.includes(low(p)) || ask.includes(low(cleanPath(p).split('/').pop())))
      || f.families.some((fam) => cmds.some((c) => familyOf(c).includes(fam)) || new RegExp(`\\b${fam}\\b`).test(ask))
      || f.targets.some((tg) => cmds.some((c) => targetOf(c) === tg) || ask.includes(low(tg)));
  };
  // A probable hit: a correction in the next 20 exchanges of the same day that shares it. Else unclear; never "worked".
  for (const f of fired) {
    f.hit = false;
    for (let j = f.i + 1; j < es.length && j <= f.i + NEXT && day(es[j]) === day(es[f.i]); j++) if (isCorr(j) && shares(f, es[j])) { f.hit = true; break; }
  }
  // A miss: a correction with no firing of the trigger in the 20 exchanges before it that day (the nudge fires on the correction itself).
  const miss = Object.fromEntries(LINES.map(([k]) => [k, { none: 0, nomatch: 0, filtered: 0 }]));
  es.forEach((e, j) => {
    if (!isCorr(j)) return;
    const near = (x) => x.i >= j - NEXT && x.i < j && day(es[x.i]) === day(e);
    for (const [k] of LINES) {
      if (k === 'nudge' || fired.some((f) => f.trigger === k && near(f))) continue;
      miss[k][dropped.some((d) => d.trigger === k && near(d)) ? 'filtered' : exist[j][k] === false ? 'none' : 'nomatch']++;
    }
  });
  return { fired: fired.map((f) => ({ ...f, e: es[f.i] })), miss, prompts: es.filter((e) => !isHelper(e)).length };
}

// A ratio with its n and its 95% interval, or why there is none: under 20 trials nothing can be claimed.
const ratio = (label, k, n, trials) => {
  if (trials < ENOUGH) return 'Cannot claim, n too small.';
  const [lo, hi] = wilson(k, n);
  return `${label} ${pc(k / n)}% (${k} of ${n}), 95% interval ${pc(lo)}-${pc(hi)}%.`;
};

// The report for `memory lessons replay`: { lines, history }. `stores` are memory folders, `recent` is journal.mjs's. Reads only.
export function replayRun(stores, { days, now, show = false, recent }) {
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  const span = Array.from({ length: days }, (_, k) => local(noon.getTime() - k * 864e5).slice(0, 10)), cant = [], read = [];
  for (const store of stores) {
    const got = recent(store, { days: days + 1, bytes: 64 * 1024 * 1024, deadline: performance.now() + 120_000, now }, () => true);
    if (got === null) { cant.push(`could not read the journal of ${store}`); continue; }
    const es = got.reverse().filter((e) => span.includes(e.at.slice(0, 10))).sort(byAt);
    if (es.length) read.push({ store, es });
  }
  const everything = read.flatMap((r) => r.es).sort(byAt), active = new Set(everything.map((e) => e.at.slice(0, 10)));
  const zero = (v) => Object.fromEntries(LINES.map(([k]) => [k, v]));
  if (!everything.length) return { lines: [...cant, `Replayed 0 exchanges over ${days} days (${days} days had no journal). Nothing to replay.`], history: { at: local(now), days, exchanges: 0, firings: zero(0), hits: zero(0) } };

  // The lessons: each project store's own, and the shared store's once. A retired one existed and cannot fire.
  const sharedDir = sharedStore(), isShared = (d) => foldCase(d) === foldCase(sharedDir), shared = lessonsIn(sharedDir, '_shared/', everything);
  const seen = new Map(), counted = { notes: 0, hidden: 0 }, sharedUsed = read.some((r) => !isShared(r.store));
  if (sharedUsed) { counted.notes += shared.notes; counted.hidden += shared.hidden; }
  const total = Object.fromEntries(LINES.map(([k]) => [k, { fire: [], miss: { none: 0, nomatch: 0, filtered: 0 } }]));
  let prompts = 0;
  for (const { store, es } of read) {
    const own = lessonsIn(store, '', everything), counters = readCounters(store);
    counted.notes += own.notes; counted.hidden += own.hidden;
    const mine = [...own.list, ...(isShared(store) ? [] : shared.list)];
    for (const x of mine) { const key = x.shared ? x.name : `${store}|${x.name}`; seen.set(key, { x, off: !!counters.notes[x.name]?.retired || !!seen.get(key)?.off }); }
    const w = walk(es, mine.filter((x) => !counters.notes[x.name]?.retired));
    prompts += w.prompts;
    for (const f of w.fired) total[f.trigger].fire.push(f);
    for (const [k] of LINES) for (const c of Object.keys(total[k].miss)) total[k].miss[c] += w.miss[k][c];
  }
  const live = [...seen.values()].filter((v) => !v.off), plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const lines = [...cant, `Replayed ${everything.length} exchanges over ${days} days (${days - active.size} days had no journal). ${plural(seen.size, 'lesson')} existed at some point; ${live.length} could fire. ${live.filter((v) => v.x.byFile).length} dated by file time.`];
  for (const [k, name] of LINES) {
    const fs = total[k].fire, n = fs.length, h = fs.filter((f) => f.hit).length, m = total[k].miss;
    const mid = num(median([...active].map((d) => fs.filter((f) => f.e.at.startsWith(d)).length))), count = plural(n, 'firing');
    lines.push(k === 'nudge'
      ? `${name}: ${count} in ${prompts} prompts, median ${mid} on an active day. ${ratio('Rate', n, prompts, n)} (No interrupt markers in the journal.)`
      : `${name}: ${count}, ${num(n / days)} a day, median ${mid} on an active day. Probable hits ${h}, unclear ${n - h}. ${ratio('Share', h, n, n)} Misses ${m.none + m.nomatch + m.filtered}: no lesson ${m.none}, no match ${m.nomatch}, filtered ${m.filtered}.${k === 'stuck' ? ' Lower bound (an exact re-run hides its earlier failure).' : ''}`);
  }
  lines.push(`L17 scan: hides ${counted.hidden} of ${counted.notes} notes.`);
  // What was asked, said back for the maintainer to read: on this PC only, through memory.mjs's redact like every listing.
  if (show) for (const f of LINES.flatMap(([k]) => total[k].fire).sort((a, b) => byAt(a.e, b.e))) lines.push(`${f.e.at} [${f.e.key}] ${f.trigger} ${f.ref}: ${clip(f.e.asked, 120)} => ${clip(f.said, 200)}`);
  lines.push('Upper bound: a match is not proof that the lesson changes anything.');
  return { lines, history: { at: local(now), days, exchanges: everything.length,
    firings: Object.fromEntries(LINES.map(([k]) => [k, total[k].fire.length])), hits: Object.fromEntries(LINES.map(([k]) => [k, total[k].fire.filter((f) => f.hit).length])) } };
}

// `memory lessons`: one line a lesson (retired ones too) with its counters, then the recurring errors past their 3 startups, then the
// lessons the scan hides with the reason. The counters are all 0 until the Stop writes `.lessons.json`.
export function lessonsList(store, now = Date.now()) {
  const { notes, errors } = readCounters(store), rows = [], hidden = [], resolved = new Set();
  for (const [dir, pre] of [[store, ''], ...(foldCase(sharedStore()) === foldCase(store) ? [] : [[sharedStore(), '_shared/']])]) {
    for (const x of notesOf(dir, { write: false })) {
      const l = x.l?.lesson;
      if (!l) continue;
      const name = pre + x.file, c = notes[name] ?? {};
      if (l.hidden) { hidden.push(`${name}   ${l.hidden}`); continue; }
      l.resolves.forEach((id) => resolved.add(id));
      rows.push(`${name}   shown ${c.shown || 0}, followed ${c.followed || 0}, broken ${c.broken || 0}, not applicable ${c.na || 0}, unknown ${c.unknown || 0}; last ${c.last || 'never'}${c.retired ? `; retired: ${c.retired}` : ''}`);
    }
  }
  const m = readMistakes(store), past = m ? recurring(m, now, resolved).filter((r) => (errors[r.id]?.listed ?? 0) >= 3) : [];
  const out = [...rows, ...(past.length ? ['Recurring errors past their 3 startups:', ...past.map((r) => `[${r.id}] ${r.target}: "${r.error}" in ${r.sessions} conversations on ${r.days} days, last ${r.last}`)] : []),
    ...(hidden.length ? ['Lessons the scan hides:', ...hidden] : [])];
  return out.length ? out : [`no lessons in ${store}`];
}
