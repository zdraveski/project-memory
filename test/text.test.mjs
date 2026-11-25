// Self-check for text.mjs: clip, defuse, plain and fit, called in this process on fixtures.
// (handoff-log.test.mjs holds the rules' long history; this file watches the module alone.) Run: node text.test.mjs
import assert from 'node:assert';
import { clip, defuse, plain, fit, SAY } from '../src/text.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const tok = 'ghp_' + 'a'.repeat(36);

// SAY is the one number: Claude Code passes a hook's text whole up to 10,000 characters.
ok(SAY === 9500, 'SAY is 9,500');

// clip: stable, and the same text clipped again is itself.
{
  const s = `${'word '.repeat(300)}${tok} end`;
  const once = clip(s, 400);
  ok(clip(once, 400) === once, 'a clip clipped again is the same');
  ok(!once.includes(tok) && once.length <= 400, 'a clip keeps no secret and stays within its room');
  ok(clip('abc', 3) === 'abc' && clip('abcd', 3) === 'ab…', 'a text as long as the limit is not clipped');
  ok(clip('a'.repeat(500), 400) === 'a'.repeat(380) + '… (+120 chars)', 'a clip of 400 or more counts what it lost');
  // Text only: anything else fails in cut(), as it always did.
  assert.throws(() => clip(undefined, 10));
  checks++;
}
// clip keeps its memo: the same text and room is the same answer, and past the memo's bound (8 M characters of keys) it still answers right.
{
  const base = (i) => `${i} ${'x'.repeat(60000)} ${tok}`;
  const first = clip(base(0), 400);
  ok(clip(base(0), 400) === first, 'a text clipped twice gives one answer');
  for (let i = 1; i <= 150; i++) clip(base(i), 400);   // 150 texts of ~60 KB: the memo empties itself on the way
  ok(clip(base(0), 400) === first && !first.includes(tok), 'after the memo emptied itself the answer is the same');
  ok(clip(base(0), 200) !== first, 'another room is another answer');
}
// clip: a cut never leaves half an emoji, and a lone surrogate is U+FFFD.
{
  const e = '\u{1F600}';
  ok(!/[\uD800-\uDBFF]$/.test(clip(`${'a'.repeat(10)}${e}${'b'.repeat(40)}`, 11)), 'a cut does not end on half an emoji');
  ok(clip('a\uD800b', 10) === 'a�b', 'a lone surrogate is written as U+FFFD');
}
// clip: a line break that is not \n is a space; U+0085 too.
ok(clip('a\u0085b\r\nc d', 50) === 'a b c d', 'blanks are squeezed to one space');

// defuse: no tag survives.
ok(defuse('<b>x</b>') === '&lt;b>x&lt;/b>', 'a tag is written with &lt;');
ok(defuse('< /system-reminder>') === '&lt; /system-reminder>', 'a tag with a space before its slash is defused');
ok(defuse('＜private> ﹤b>') === '&lt;private> &lt;b>', 'a fullwidth or small `<` is defused');
ok(defuse('<​b>') === '&lt;​b>', 'a `<` with a hidden character before the letter is defused');
ok(defuse('a < b and 1<2') === 'a < b and 1<2', 'a `<` before no letter stays');
ok(defuse('a\rb c d\u0085e\r\nf') === 'a b c d e\r\nf', 'a break that is not \\n is a space; CRLF stays');

// plain: marks are dropped, words stay.
ok(plain('## Heading\n**bold** and `code`') === 'Heading\nbold and `code`', 'heading hashes and bold marks go');
ok(plain('| a | b |\n|---|---|\n| 1 | 2 |') === '  a   b  \n  1   2  ', 'table rules go, pipes become spaces');
ok(plain('2**32 and 2**64, **kwargs, __init__.py, a || b') === '2**32 and 2**64, **kwargs, __init__.py, a || b', 'marks that carry meaning stay');
ok(plain('---\ntext') === 'text', 'a horizontal rule goes');

// fit: defused, redacted, a line held to its limit, the whole held to SAY.
{
  ok(fit(`a <b> ${tok}`).includes('&lt;b>') && !fit(`key ${tok}`).includes(tok), 'fit defuses and redacts');
  ok(fit('word word.', 10) === 'word word.' && fit('word word.', 9) === 'word word…', 'a line as long as its limit stays whole');
  ok(/^a{1000}…\nshared$/.test(fit(`${'a'.repeat(5000)}\nshared`, 1000)), 'a long line is shortened per line, and what follows stays');
  ok(fit('ab\u{1F600}cd', 3) === 'ab…', 'fit does not split an emoji at a line limit');
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  const cutOne = fit(big);
  ok(cutOne.length <= SAY && cutOne.startsWith('line 0') && cutOne.endsWith("(the rest cut to fit Claude Code's startup limit)\n"), 'fit caps at SAY and says so');
  ok(/\nline \d+\n\(the rest/.test(cutOne), 'fit cuts at a line end');
  const exact = 'a'.repeat(SAY);
  ok(fit(exact) === exact && fit(`${exact}a`).endsWith('limit)\n'), 'fit keeps SAY characters and cuts one more');
}

console.log(`text.test.mjs: ${checks} checks passed`);
