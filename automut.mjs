// Automatic mutants: eight small breaks (an operator flipped, a condition
// negated, a call dropped) made everywhere in the code, not only where a
// hand-written mutant in mutate.mjs sits. The 883 hand mutants touched a third
// of the code lines (2026-10-30); a line no mutant touches can lose its test
// unnoticed. Only code is mutated: strings, template text, regular
// expressions and comments are blanked first by a masker that keeps offsets,
// so a `<private>` in a pattern or `&&` in a comment is never touched. Each
// mutant has an id that survives edits to other lines, so automut-ignore.txt
// can name the harmless ones.
import assert from 'node:assert';
import { createHash } from 'node:crypto';

export const OPS = ['equality', 'boundary', 'logic', 'boolean', 'not', 'number', 'condition', 'statement'];

// After one of these characters, or one of these words, a `/` opens a regular
// expression; after anything else (a name, a number, `)`, `]`) it divides.
const BEFORE_RE = new Set('(,=:[!&|?{};+-*%<>~^');
const WORDS_RE = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

// src with every string, template text (not the code in its ${}), regular
// expression and comment turned to spaces, line breaks kept: same length, so
// an offset in the mask is the same offset in src.
export function mask(src) {
  const out = src.split(''), n = src.length, tpl = [];
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  // last: the previous code character (a literal's closing one counts), what tells a regex from a division.
  let i = 0, depth = 0, last = -1;
  const startsRegex = () => {
    if (last < 0 || src.lastIndexOf('\n', i) > last) return true;
    if (BEFORE_RE.has(src[last])) return true;
    let k = last;
    while (k > 0 && /[\w$]/.test(src[k - 1])) k--;
    return WORDS_RE.has(src.slice(k, last + 1));
  };
  // Where a regular expression starting at i ends, or -1 when its line ends first: then it was a division.
  const regexEnd = () => {
    for (let k = i + 1, cls = false; k < n && src[k] !== '\n'; k++) {
      if (src[k] === '\\') k++;
      else if (src[k] === '[') cls = true;
      else if (src[k] === ']') cls = false;
      else if (src[k] === '/' && !cls) { k++; while (k < n && /[a-z]/.test(src[k])) k++; return k; }
    }
    return -1;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if ((c === '/' && d === '/') || (i === 0 && c === '#' && d === '!')) {
      const e = src.indexOf('\n', i) < 0 ? n : src.indexOf('\n', i);
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2) < 0 ? n : src.indexOf('*/', i + 2) + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      blank(i, k + 1); last = k; i = k + 1;
    } else if (c === '`' || (c === '}' && tpl.at(-1) === depth)) {
      // Template text, from its opening ` or the } that ends a ${, to its closing ` or the next ${.
      if (c === '}') tpl.pop();
      let k = i + 1;
      while (k < n && src[k] !== '`' && !(src[k] === '$' && src[k + 1] === '{')) k += src[k] === '\\' ? 2 : 1;
      if (src[k] === '`') { blank(i, k + 1); last = k; i = k + 1; } else { tpl.push(depth); blank(i, k + 2); last = k + 1; i = k + 2; }
    } else if (c === '/' && startsRegex() && regexEnd() > 0) {
      const e = regexEnd();
      blank(i, e); last = e - 1; i = e;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (!/\s/.test(c)) last = i;
      i++;
    }
  }
  return out.join('');
}

// The offset of the ) that closes the ( at j in a masked line, or -1.
const close = (k, j) => {
  for (let i = j, d = 0; i < k.length; i++) if (k[i] === '(') d++; else if (k[i] === ')' && --d === 0) return i;
  return -1;
};
// Where the operand of a ! ends, the ! being just before j, for the label only
// (the edit is the ! removed): a (...) on the line, a name, or a literal.
const operand = (k, s, j) => {
  const rest = k.slice(j);
  if (rest[0] === '(') return close(k, j) + 1 || j + 1;
  if (/^[\w$]/.test(rest)) return j + /^[\w$.]+/.exec(rest)[0].length;
  if (/^['"`/]/.test(s.slice(j))) return j + s.slice(j, j + /^ */.exec(rest)[0].length).trimEnd().length;
  return j;
};
const swap = (re, to) => (k) => [...k.matchAll(re)].map((m) => [m.index, m[0], to[m[0]]]);
// Each operator: its [offset in the line, from, to] on a masked line k whose real text is s.
const FIND = {
  // The look-arounds leave =>, <<, >>, >>>, ?? and ?. alone.
  equality: swap(/(?<![=!<>])(?:===|!==|==|!=)(?!=)/g, { '===': '!==', '!==': '===', '==': '!=', '!=': '==' }),
  boundary: swap(/(?<![<>=])[<>]=?(?![<>=])/g, { '<': '<=', '<=': '<', '>': '>=', '>=': '>' }),
  logic: swap(/&&|\|\|/g, { '&&': '||', '||': '&&' }),
  boolean: swap(/(?<![\w$.])(?:true|false)(?![\w$])/g, { true: 'false', false: 'true' }),
  not: (k, s) => [...k.matchAll(/!(?!=)/g)].flatMap(({ index: i }) => {
    const e = operand(k, s, i + 1);
    return e > i + 1 ? [[i, s.slice(i, e), s.slice(i + 1, e)]] : [];
  }),
  // A lone digit: not 10, 1.5, 0x1, 1e3 or 1_000.
  number: (k) => [...k.matchAll(/(?<![\w$.])[0-9](?![\w$.])/g)].map((m) => [m.index, m[0], String(Number(m[0]) + 1)]),
  condition: (k, s) => [...k.matchAll(/(?<![\w$.])if\s*\(/g)].flatMap((m) => {
    const j = m.index + m[0].length - 1, e = close(k, j) + 1;
    return e ? [[j, s.slice(j, e), `(!${s.slice(j, e)})`]] : [];
  }),
  // A line that is one call, f(...); or a.b(...);, and nothing else.
  statement: (k, s) => {
    const t = k.trim(), j = k.search(/\S/);
    return /^(?!(?:return|const|let|var|if|for|while|throw)\b)[\w$]+(?:\.[\w$]+)*\(.*\);$/.test(t) && close(t, t.indexOf('(')) === t.length - 2
      ? [[j, s.slice(j, j + t.length), 'void 0;']] : [];
  },
};

// Every automatic mutant of src, in source order; with lines, only those on
// these 1-based lines. The id hashes the line's text, not its number, so an
// edit elsewhere keeps it.
export function mutants(file, src, lines) {
  const masked = mask(src).split('\n'), copies = new Map(), out = [];
  let at = 0;
  src.split('\n').forEach((s, n) => {
    const text = s.trim(), copy = copies.get(text) ?? 0;
    copies.set(text, copy + 1);
    if (!lines || lines.has(n + 1)) {
      for (const op of OPS) FIND[op](masked[n], s).forEach(([i, from, to], nth) => out.push({
        id: createHash('sha256').update([file, op, text, nth, copy].join('\0')).digest('hex').slice(0, 12),
        label: `auto ${op} ${file}:${n + 1} ${from.slice(0, 40)} -> ${to.slice(0, 40)}`,
        op, line: n + 1, at: at + i, from, to,
      }));
    }
    at += s.length + 1;
  });
  return out.sort((a, b) => a.at - b.at || OPS.indexOf(a.op) - OPS.indexOf(b.op));
}

// automut-ignore.txt, `<id> <reason>` a line: the survivors no test could
// tell from the real code. Blank and # lines are skipped; a line of another
// shape is an error, not an id silently dropped.
export function ignored(text) {
  const out = new Map();
  for (const l of (text ?? '').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
    const m = /^([0-9a-f]{12}) +(\S.*)$/.exec(l);
    if (!m) throw new Error(`automut-ignore.txt: not "<id> <reason>": ${l}`);
    out.set(m[1], m[2]);
  }
  return out;
}

// no mutant inside a literal
assert.equal(mutants('t.mjs', "const re = /a<b&&!c===d/; const s = '<private> && !x';\n").length, 0);
// each operator, once
const ops = (s) => mutants('t.mjs', s).map((m) => `${m.op} ${m.from}->${m.to}`);
assert.deepEqual(ops('if (a === b) f();\n'), ['condition (a === b)->(!(a === b))', 'equality ===->!==']);
assert.deepEqual(ops('log.push(x);\n'), ['statement log.push(x);->void 0;']);
assert.deepEqual(ops('x = a < 3 && !y;\n'), ['boundary <-><=', 'number 3->4', 'logic &&->||', 'not !y->y']);
assert.deepEqual(ops('const f = (a) => a >= 10 ?? true;\n'), ['boundary >=->>', 'boolean true->false']);
// an id survives an edit elsewhere
const one = mutants('t.mjs', 'x = a === b;\n')[0].id, two = mutants('t.mjs', '// new\n\nx = a === b;\n')[0].id;
assert.equal(one, two);
// two copies of a line, and two matches on one line, are told apart
assert.equal(new Set(mutants('t.mjs', 'f(x);\nf(x);\n').map((m) => m.id)).size, 2);
assert.equal(new Set(mutants('t.mjs', 'x = a === b || c === d;\n').filter((m) => m.op === 'equality').map((m) => m.id)).size, 2);
// the label
assert.match(mutants('t.mjs', 'x = a === b;\n')[0].label, /^auto equality t\.mjs:1 === -> !==$/);
// the masker: a hash-bang, ${} nested in a template, {} inside a ${}, a / after ` divides, a / in a class, a comment
assert.equal(mask("#!x\na = `t${b ? `u${c}` : {d}}v` / 2 + /[/]x/.test(e); // it's\n"), '   \na =     b ?     c   : {d}    / 2 +       .test(e);        \n');
// the ignore list
assert.deepEqual([...ignored('0123456789ab a log line only\n\n')], [['0123456789ab', 'a log line only']]);
assert.equal(ignored(null).size, 0);
// a # header, blank lines and CRLF ends are skipped
assert.equal(ignored('# header\n0123456789ab why\n').size, 1);
assert.deepEqual([...ignored('0123456789ab why\r\n\r\n   \r\n')], [['0123456789ab', 'why']]);
assert.throws(() => ignored('0123 too short\n'), /not "<id> <reason>"/);
