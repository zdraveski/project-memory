// How a query is read and matched: the word splitter and the tests on a journal entry that search and, later, the hooks share.
import { foldCase } from './store.mjs';

// Words that say nothing about which memory: in a model's natural-language
// query they scored like content -- "the" in a file name took the name bonus,
// and "how do we deploy the site" filled its last places with them (review).
export const STOP = new Set(['the', 'and', 'for', 'how', 'what', 'why', 'with', 'was', 'are', 'not', 'this', 'that', 'from',
  'when', 'where', 'who', 'did', 'does', 'have', 'has', 'can', 'you', 'our', 'about', 'into', 'there', 'their', 'then', 'than',
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  // Question filler: "which design skill did I put in all projects" ranked the real entry 7th (1.5.0 audit).
  'which', 'will', 'many', 'all', 'any', 'last', 'month', 'take', 'ever', 'just', 'before', 'after', 'some', 'got',
  'should', 'would', 'could', 'been', 'were', 'one', 'them', 'they', 'your', 'its', 'also', 'very', 'much', 'more', 'most', 'need',
  'want', 'like', 'used', 'tell', 'remind', 'again', 'week', 'day', 'today', 'yesterday', 'ago']);
// Two letters are a word too: CI, PR, DB were never found. But only standing
// alone: `ci` is in "decision".
// Combining marks (\p{M}) belong to the word (Hindi), and both sides are NFC so a decomposed "e" + accent is "é".
// A version (1.4.3, v1.4.3) is one word, matched whole: split at the dots, its pieces were all dropped, and 1.4.3 is not 1.4.30.
const VERSION = /(?<![\p{L}\p{N}.])v?(\d+(?:\.\d+)+)/gu;
export const isVer = (t) => /^\d+(?:\.\d+)+$/.test(t);
// A one-dot version (1.4) is every release of it (1.4.1), so only a three-part version refuses a further .N.
export const verRe = (t) => new RegExp(`(?<![\\p{L}\\p{N}.])v?${t.replaceAll('.', '\\.')}(?!\\p{N}${t.split('.').length > 2 ? '|\\.\\p{N}' : ''})`, 'gu');
// Word forms: the query's word loses one regular ending, and the match finds the longer forms (the index is not stemmed).
// shortcut: regular endings only (run and ran, or decide and decision, are not one word; no irregular-verb table).
// A root of 5 letters or more matches at the start of a word (migrat: migrate, migration). A root of 3 or 4 letters from
// s, es, ed, ing, ies or ied (and a 3-letter word as typed) matches only itself and those endings, so "log" finds logs, logged
// and logging but not login, and "planned" finds plan but not planet. A 3-letter root needs a vowel and one of s, es, ed, ing.
// A final y or e is dropped only when an ending was cut, so "ready" is not "read". "-us" and "-is" words (status) keep their s.
const EN_SUF = ['ational', 'ations', 'ation', 'ments', 'ment', 'ingly', 'ings', 'ing', 'edly', 'ies', 'ied', 'ures', 'ure', 'ed', 'es', 's', 'ly'];
// Macedonian: articles, plurals and common verb endings; the stem stays 3 letters or more.
const MK_SUF = ['ињата', 'ијата', 'ување', 'увања', 'ите', 'ата', 'ото', 'ета', 'ови', 'еви', 'ања', 'ање', 'вме', 'вте', 'ше', 'ме', 'те', 'та', 'то', 'от', 'ов', 'ва', 'во', 'ве', 'он', 'на', 'но', 'не', 'ат', 'ам', 'аш', 'и', 'а', 'е', 'о', 'у'];
const INFL = new Set(['s', 'es', 'ed', 'ing', 'ings', 'ies', 'ied']), DOUBLED = new Set(['ed', 'ing', 'ings', 'edly', 'ingly']);
// An English word as [root, the ending cut, the final y or e dropped].
function cutEn(t) {
  let x = t, cut = '', drop = '';
  for (const f of EN_SUF) {
    const n = x.length - f.length;
    if (x.endsWith(f) && (n >= 4 || n === 3 && ['s', 'es', 'ed', 'ing'].includes(f) && /[aeiou]/.test(x.slice(0, 3))) && !(f === 's' && /(ss|us|is)$/.test(x))) { x = x.slice(0, -f.length); cut = f; break; }
  }
  if (DOUBLED.has(cut) && x.length >= 4 && /([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss|zz|ff)$/.test(x)) x = x.slice(0, -1);
  else if (cut && x.length > 4 && /[^aeiou][ye]$/.test(x)) { drop = x.at(-1); x = x.slice(0, -1); }
  return [x, cut, drop];
}
function stem(t) {
  if (/^[a-z]+$/.test(t)) return cutEn(t)[0];
  if (/^[Ѐ-ӿ]+$/.test(t)) for (const f of MK_SUF) if (t.endsWith(f) && t.length - f.length >= 3) return t.slice(0, -f.length);
  return t;
}
// The search words of a query, each as its stem; `.as` gives the word as typed. `any`: a query of only stop words
// searches them rather than nothing. Without it, only words that say which memory (a date range alone lists the days).
export const words = (q, any = false) => {
  const n = q.normalize('NFC').toLowerCase();
  const all = [...[...n.matchAll(VERSION)].map((m) => m[1]), ...n.replace(VERSION, ' ').split(/[^\p{L}\p{M}\p{N}]+/u).filter((t) => t.length >= 2 || CJK.test(t))];
  const kept = all.filter((t) => !STOP.has(t)), as = new Map();
  for (const t of kept.length || !any ? kept : all) if (!as.has(stem(t))) as.set(stem(t), t);
  return Object.assign([...as.keys()], { as });
};
// Han, Hiragana and Katakana have no spaces round a word, so they are not the letters a Latin word must not touch.
const CJK = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]$/u, NC = '(?![\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}])';
export const alone = (t) => new RegExp(`(?<!${NC}[\\p{L}\\p{M}\\p{N}])${t}(?!${NC}[\\p{L}\\p{M}\\p{N}])`, 'gu');
// Chinese and Japanese have no spaces round a word, so a two-character one is looked for as a substring.
export const plain = (t) => t.length > 2 || /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]+$/u.test(t);
// A cut stem counts only at the start of a word: "stor" finds "store" and "storage", not "history" (`cut`: the term was shortened).
// A short English root (see stem()) is a whole word with its endings instead; `w` is the word as typed.
export const starts = (t, w = t) => {
  const [r, f, d] = /^[a-z]+$/.test(w) ? cutEn(w) : [], B = `(?<!${NC}[\\p{L}\\p{N}])`;
  if (!r || r.length > 4 || !(f ? INFL.has(f) : r.length === 3)) {
    // An uncut consonant + y word also finds its plural and past: library, libraries; story, stories (not store).
    const y = !f && /[^aeiou]y$/.test(t) ? `|${t.slice(0, -1)}i(?:es|ed)` : '';
    return new RegExp(`${B}(?:${t}${y})`, 'gu');
  }
  const l = r.at(-1), o = [`e?(?:s|es|d|ed|ing|ings|ies|ied|${l}ed|${l}ing|${l}ings)`];
  if (!d && !(f === 'ed' && r.endsWith('e'))) o.push(['s', 'es', 'ed', 'ing', 'ings'].includes(f) ? 'e?' : '');
  return new RegExp(`${B}(?:${w}|${r}(?:${o.join('|')}))(?!${NC}[\\p{L}\\p{N}])`, 'gu');
};
// A term is matched as word forms when it was cut, is a 3-letter English word, or ends in a consonant and y (library: libraries).
export const forms = (t, cut) => (cut || /^[a-z]{3}$/.test(t) || /^[a-z]*[^aeiou]y$/.test(t)) && plain(t);
export const count = (hay, t, cut) => (isVer(t) ? (hay.match(verRe(t)) ?? []).length : forms(t, cut) ? (hay.normalize('NFC').match(starts(t, cut || t)) ?? []).length : plain(t) ? hay.normalize('NFC').split(t).length - 1 : (hay.normalize('NFC').match(alone(t)) ?? []).length);
export const has = (hay, t, cut) => (isVer(t) ? verRe(t).test(hay) : forms(t, cut) ? starts(t, cut || t).test(hay.normalize('NFC')) : plain(t) ? hay.normalize('NFC').includes(t) : alone(t).test(hay.normalize('NFC')));

// The tests on a journal entry (as parseDay returns it) that a filter or a hook asks.
// A path as the journal compares it: forward slashes, no leading ./ or trailing /, case as the journal folds it.
export const cleanPath = (p) => foldCase(p.replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/\/+$/, ''));
// An equal path, or the given one is the end of a changed path right after a folder: art.js is not src/cart.js.
// The journal holds paths relative to the session's folder, so an absolute one given also matches when it ends in a changed path.
export const changedFile = (e, path) => {
  const p = cleanPath(path), abs = /^(?:[a-z]:)?\//i.test(p);
  return p !== '' && e.changed.some((c) => { const f = cleanPath(c); return f === p || f.endsWith(`/${p}`) || (abs && f !== '' && p.endsWith(`/${f}`)); });
};
export const isHelper = (e) => e.key.startsWith('subagent-');
// The session id is the end of `t`; an entry with no `t` has only its 8-character tag. With neither, it is in no conversation.
export const inConversation = (e, tag) => {
  const g = tag.toLowerCase(), id = e.t.slice(e.t.lastIndexOf('/') + 1).toLowerCase(), s = e.s.toLowerCase();
  return g !== '' && (id ? id.startsWith(g) : s !== '' && (g.startsWith(s) || s.startsWith(g)));
};

// The entries whose Changed holds one of `paths` whole (not by its end: another project's notes.md is not this one's), in the order given.
export const changers = (es, paths) => { const p = new Set(paths.map(cleanPath)); return es.filter((e) => e.changed.some((c) => p.has(cleanPath(c)))); };
// Who changed a note at each snapshot. `snaps` are snapshot times 'YYYY-MM-DD HH:MM', oldest first; `es` the entries from `changers`, oldest first.
// An entry holds only its minute, so one sent in a snapshot's own minute may have come after it: it is taken only when nothing earlier fits.
// shortcut: an entry names one snapshot only; upgrade if a long turn that a save cut in two is reported as "no exchange found".
export const whoChanged = (snaps, es, origin = '') => {
  const given = new Set();
  return snaps.map((hi, i) => {
    const lo = i ? snaps[i - 1] : '', all = es.filter((e) => !given.has(e) && e.at >= lo && e.at <= hi);
    // a helper's entry is named only when no other fits: its report lands a minute after the request that started it
    const fit = all.some((e) => !isHelper(e)) ? all.filter((e) => !isHelper(e)) : all;
    const before = fit.filter((e) => e.at < hi), pool = before.length ? before : fit;
    const top = pool.reduce((m, e) => (e.at > m ? e.at : m), ''), last = pool.filter((e) => e.at === top);
    const e = last.findLast((x) => origin && inConversation(x, origin)) ?? last.at(-1) ?? null;
    if (e) given.add(e);
    return e;
  });
};
