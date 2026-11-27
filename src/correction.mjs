// The correction detector (H5): one pure function over a prompt's text, with phrase lists in English and Macedonian.
// It reads nothing and writes nothing; the prompt hook (step 11) passes the context and acts on the verdict.
export const VERSION = 1;

// A whole word: \b does not work on Cyrillic, so the edges are letters and digits.
const W = (s) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'iu');
const AP = "['’]";
// A negative, then `again`/`пак`/`повторно` in the same sentence.
const after = (neg, again) => W(`(?:${neg})(?![\\p{L}\\p{N}])[^.!?\\n]{0,40}?(?<![\\p{L}\\p{N}])(?:${again})`);

// Gate A, a correction: matched in the first sentence.
export const GATE_A = [
  { id: 'A-no', re: /^\s*no[,.]/iu },
  { id: 'A-wrong', re: W(`that(?:${AP}s| is) wrong`) },
  { id: 'A-not-what-i', re: W(`that(?:${AP}s| is) not what i`) },
  { id: 'A-not-what-asked', re: W('not what i asked') },
  { id: 'A-i-said', re: W('i said') },
  { id: 'A-i-told-you', re: W('i told you') },
  { id: 'A-why-did-you', re: W('why did you') },
  { id: 'A-you-didnt', re: W(`you didn${AP}?t`) },
  { id: 'A-you-forgot', re: W('you forgot') },
  { id: 'A-stop-ing', re: W('stop\\s+\\p{L}+ing') },
  { id: 'A-dont', re: W(`don${AP}?t`) },
  { id: 'A-mk-ne', re: /^\s*не[,.]/iu },
  { id: 'A-mk-pogresno', re: W('погрешно') },
  { id: 'A-mk-ne-toa-sto', re: W('не\\s+тоа\\s+што') },
  { id: 'A-mk-rekov', re: W('реков') }, // also "ти реков"
  { id: 'A-mk-zaboravi-da', re: W('заборави\\s+да') },
  { id: 'A-mk-nemoj', re: W('немој') },
  { id: 'A-mk-prestani-da', re: W('престани\\s+да') },
  { id: 'A-lat-nemoj', re: W('nemoj') },
  { id: 'A-lat-pogresno', re: W('pogresno') },
];
// Weak cues: they count only when 2 of them are in the first sentence.
export const WEAK = [
  { id: 'A-weak-actually', re: W('actually') },
  { id: 'A-weak-instead', re: W('instead') },
  { id: 'A-weak-rather', re: W('rather') },
];
// Gate B, a lasting rule: matched anywhere in the first 280 characters.
export const GATE_B = [
  { id: 'B-always', re: W('always') },
  { id: 'B-never', re: W('never') },
  { id: 'B-from-now-on', re: W('from\\s+now\\s+on') },
  { id: 'B-every-time', re: W('every\\s+time') },
  { id: 'B-next-time', re: W('next\\s+time') },
  { id: 'B-in-future', re: W('in\\s+(?:the\\s+)?future') },
  { id: 'B-remember', re: W('remember') },
  { id: 'B-again', re: after(`\\p{L}*n${AP}t|not|never|no|stop`, 'again') },
  { id: 'B-mk-sekogas', re: W('секогаш') },
  { id: 'B-mk-nikogas', re: W('никогаш') },
  { id: 'B-mk-od-sega', re: W('од\\s+сега') },
  { id: 'B-mk-otsega', re: W('отсега') },
  { id: 'B-mk-sekoj-pat', re: W('секој\\s+пат') },
  { id: 'B-mk-sledniot-pat', re: W('следниот\\s+пат') },
  { id: 'B-mk-vo-idnina', re: W('во\\s+иднина') },
  { id: 'B-mk-zapomni', re: W('запомни') },
  { id: 'B-mk-pak', re: after('не|немој|никогаш|nemoj|nikogas', 'пак|повторно') },
  { id: 'B-lat-sekogas', re: W('sekogas') },
  { id: 'B-lat-nikogas', re: W('nikogas') },
  { id: 'B-lat-otsega', re: W('otsega') },
  { id: 'B-lat-zapomni', re: W('zapomni') },
];
export const FILTERS = ['F2-helper', 'F2-first', 'F3-long', 'F4-question', 'F5-polite-no', 'F6-praise', 'F6-self-blame', 'F6-reported'];

const POLITE_NO = /^\s*(?:no[,.!]?\s+(?:problem|thanks|thank\s+you|worries|need)|нема\s+проблем)(?![\p{L}\p{N}])/iu;
const BARE_NO = /^\s*(?:no|не)[\s,.!]*$/iu;
const PRAISE = W('great|perfect|thanks|nice|благодарам|фала');
const SELF_BLAME = W('my\\s+bad|my\\s+mistake|i\\s+was\\s+wrong|sorry|извини|моја\\s+грешка');
const REPORTED = W('(?:he|she)\\s+said|they\\s+told|the\\s+client\\s+said');

// shortcut: only the first 100,000 characters are read and a longer prompt counts as long (F3), so a 10 MB paste costs the same as a small one; upgrade if a typed prompt ever gets that long.
const CAP = 100_000;
const strip = (t) => t.replace(/```[\s\S]*?```/g, ' ').split('\n').filter((l) => !/^(?:\s*>|\t| {4})/.test(l)).join('\n').replace(/`[^`\n]*`/g, ' ');

// ctx = { helper, first, marker: () => boolean, lastEndsWithQuestion: () => boolean }; the two functions run only when the verdict needs them.
// Returns { fire, ids (pattern ids, never prompt text), drop (the first filter that dropped a match, else '') }.
export function correction(text, ctx) {
  const none = { fire: false, ids: [], drop: '' };
  if (typeof text !== 'string') return none;
  const c = ctx || {};
  const s = strip(text.slice(0, CAP)).trim(), head = s.slice(0, 280), first = head.match(/^[^.!?\n]*[.!?]?/)[0];
  // F2 and F3 are known before any pattern runs; they report only when something matched.
  let drop = c.helper ? 'F2-helper' : c.first ? 'F2-first' : s.replace(/\s+/g, ' ').length > 500 || text.length > CAP ? 'F3-long' : '';
  const a = [...GATE_A, ...(WEAK.filter(({ re }) => re.test(first)).length >= 2 ? WEAK : [])].flatMap(({ id, re }) => { const m = re.exec(first); return m ? [{ id, at: m.index }] : []; });
  if (!a.length) return none;
  let seen;
  const marker = () => seen ??= !!c.marker?.();
  const b = GATE_B.filter(({ re }) => re.test(head)).map(({ id }) => id);
  if (!b.length) {
    if (drop || !marker()) return none;
    b.push('B-marker');
  }
  const ids = [...a.map(({ id }) => id), ...b];
  const stop = (id) => ({ fire: false, ids, drop: id });
  if (drop) return stop(drop);
  if (/\?$/.test(first) && !marker()) return stop('F4-question');
  if (POLITE_NO.test(first) || (BARE_NO.test(first) && c.lastEndsWithQuestion?.())) return stop('F5-polite-no');
  const praise = PRAISE.exec(first);
  if (praise && !a.some(({ at }) => at > praise.index)) return stop('F6-praise');
  if (SELF_BLAME.test(first)) return stop('F6-self-blame');
  if (REPORTED.test(first)) return stop('F6-reported');
  return { fire: true, ids, drop: '' };
}
