// How text is printed safely: redacted, defused, cut where a person would, held to what Claude Code will show.
// A leaf: Node built-ins and store.mjs (redact) only. It knows nothing of the handoff, the journal or the transcript,
// so a hook can print without loading the briefing (1.6.0 step 15, docs/specs/2026-11-24-privacy-and-transcript-modules.md).
import { redact } from './store.mjs';

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
  // A few times n is all that can show, and the rules cost 0.2 to 1.3 s a megabyte: 64 KB or 4n first, not at a split surrogate.
  const lim = Math.max(65536, 4 * n);
  // Squeeze blanks first (cut() does too): a long blank run must not use up the cut.
  if (typeof s === 'string' && s.length > lim) s = s.replace(/\s+/g, ' ');
  // The pre-cut's loss is added to the (+N chars) count, so a 1 MB paste does not say it lost 64 KB.
  let extra = 0;
  if (typeof s === 'string' && s.length > lim) { const was = s.length; s = s.slice(0, /[\uD800-\uDBFF]/.test(s[lim - 1]) ? lim - 1 : lim); extra = was - s.length; }
  // Text only: anything else spelt as a text kept here fails in cut(), as it always did.
  const k = typeof s === 'string' ? `${n}\0${extra}\0${s}` : null;
  if (clipped.has(k)) return clipped.get(k);
  let out = cut(s, n, extra);
  for (let i = 0; i < 6; i++) { const again = cut(out, n); if (again === out) break; out = again; }
  if (k !== null) { if ((clippedSize += k.length) > 8e6) { clipped.clear(); clippedSize = k.length; } clipped.set(k, out); }
  return out;
};
const cut = (s, n, extra = 0) => {
  // Redacted before the blanks are squeezed and after. After only, a bare flag that ends a line took the next line's keyword as its value,
  // and that line's own secret was kept whole (F23, R59); before only, a secret after two blanks or a tab was redacted only when the entry
  // was clipped again (F19). U+0085 is made a line break first: it is not \s in JavaScript, and the first pass took it for a value.
  const one = defuse(redact(redact(s.replace(/\u0085/g, '\n')).replace(/\s+/g, ' '))).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD').trim();
  if (one.length <= n) return one;
  // Ends at the last sentence, else the last word, in the second half of the room: a cut mid-sentence kept
  // a claim and dropped the condition after it ("deploy" without "only on Windows"; survive.mjs).
  // A clip of 400 or more (a stored ask or answer, not a screen line) ends "… (+N chars)", N counted after redaction; the whole stays within n, so a second clip leaves it be.
  const long = n >= 400, tail = (k) => (long ? `… (+${one.length - k.length + extra} chars)` : '…');
  const room = one.slice(0, long ? n - 20 : n), half = n / 2;
  const sentence = room.match(/^.*[.!?](?=\s)/)?.[0], word = room.match(/^(.*) /)?.[1];
  if (sentence?.length >= half) return sentence + tail(sentence);
  if (word?.length >= half) return word + tail(word);
  const k = one.slice(0, long ? n - 20 : n - 1).replace(/[\uD800-\uDBFF]$/, '');
  return k + tail(k);
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

// Claude Code passes a hook's text whole up to 10,000 characters; past that,
// a preview and a file, and the shared lessons at the end were what was cut.
export const SAY = 9500;
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
