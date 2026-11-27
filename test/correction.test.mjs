// Self-check for correction.mjs, the correction detector (H5), over test/fixtures/correction-cases.json.
// The fixture is all made up: nobody labelled a real prompt. Run: node test/correction.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { correction, GATE_A, GATE_B, WEAK, FILTERS, VERSION } from '../src/correction.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const cases = JSON.parse(readFileSync(new URL('./fixtures/correction-cases.json', import.meta.url), 'utf8').replace(/^﻿/, ''));
const textOf = (c) => c.text.replace('{pad}', 'y'.repeat(c.pad || 0));
// A context whose two functions count their calls and answer from the case.
const spyOf = (c = {}) => {
  const spy = { marker: 0, last: 0 };
  spy.ctx = { helper: !!c.helper, first: !!c.first, marker: () => { spy.marker++; return !!c.marker; }, lastEndsWithQuestion: () => { spy.last++; return !!c.lastQ; } };
  return spy;
};
const run = (c) => correction(textOf(c), spyOf(c).ctx);
const quick = (text, c) => correction(text, spyOf(c).ctx);

ok(VERSION === 1, 'the detector has a version');

// The fixture: the sizes the plan names, then every case.
const count = (k, lang, f = () => true) => cases.filter((c) => c.k === k && c.lang === lang && f(c)).length;
ok(count('must', 'en') >= 30 && count('must', 'mk') >= 10, 'at least 30 English and 10 Macedonian corrections');
ok(count('neg', 'en') >= 31 && count('neg', 'mk') >= 10, '31 English and 10 Macedonian everyday negatives');
ok(cases.filter((c) => c.k === 'hostile').length >= 13, '13 hostile negatives');

for (const c of cases) {
  const r = run(c), label = `${c.k} ${c.lang}: ${textOf(c).slice(0, 50)}`;
  if (c.must) ok(r.fire && r.drop === '' && r.ids.length > 0, `must fire: ${label}`);
  else if (!c.allowedFalse) ok(!r.fire, `must not fire: ${label} ${JSON.stringify(r)}`);
  if ('drop' in c) ok(r.drop === c.drop, `drop ${c.drop || "''"}: ${label} gave ${JSON.stringify(r)}`);
  ok(r.ids.every((id) => /^[AB]-[a-z-]+$/.test(id)), `ids are pattern ids, never prompt text: ${label}`);
  ok(r.fire === (r.drop === '' && r.ids.length > 0), `fire means a match that no filter dropped: ${label}`);
}
const fired = cases.filter((c) => !c.must && run(c).fire);
ok(fired.length <= 2 && fired.every((c) => c.allowedFalse), `at most 2 negatives fire, and they are named: ${fired.map((c) => c.text)}`);
// Every filter has a case that it drops.
for (const id of FILTERS) ok(cases.some((c) => c.drop === id && run(c).drop === id && run(c).ids.length > 0), `a case for ${id}`);

// No pattern is in both gates: each pattern's sample matches none of the other gate's patterns.
const SAMPLE = {
  'A-no': 'No, x', 'A-wrong': "that's wrong", 'A-not-what-i': 'that is not what I', 'A-not-what-asked': 'not what I asked', 'A-i-said': 'I said',
  'A-i-told-you': 'I told you', 'A-why-did-you': 'why did you', 'A-you-didnt': "you didn't", 'A-you-forgot': 'you forgot', 'A-stop-ing': 'stop doing',
  'A-dont': "don't", 'A-mk-ne': 'Не, x', 'A-mk-pogresno': 'погрешно', 'A-mk-ne-toa-sto': 'не тоа што', 'A-mk-rekov': 'ти реков',
  'A-mk-zaboravi-da': 'заборави да', 'A-mk-nemoj': 'немој', 'A-mk-prestani-da': 'престани да', 'A-lat-nemoj': 'nemoj', 'A-lat-pogresno': 'pogresno',
  'A-weak-actually': 'actually', 'A-weak-instead': 'instead', 'A-weak-rather': 'rather',
  'B-always': 'always', 'B-never': 'never', 'B-from-now-on': 'from now on', 'B-every-time': 'every time', 'B-next-time': 'next time',
  'B-in-future': 'in future', 'B-remember': 'remember', 'B-again': 'not that again', 'B-mk-sekogas': 'секогаш', 'B-mk-nikogas': 'никогаш',
  'B-mk-od-sega': 'од сега', 'B-mk-otsega': 'отсега', 'B-mk-sekoj-pat': 'секој пат', 'B-mk-sledniot-pat': 'следниот пат',
  'B-mk-vo-idnina': 'во иднина', 'B-mk-zapomni': 'запомни', 'B-mk-pak': 'не прави пак', 'B-lat-sekogas': 'sekogas', 'B-lat-nikogas': 'nikogas',
  'B-lat-otsega': 'otsega', 'B-lat-zapomni': 'zapomni',
};
const A = [...GATE_A, ...WEAK];
eq([...A, ...GATE_B].map((p) => p.id).sort(), Object.keys(SAMPLE).sort(), 'every pattern has a sample and every sample a pattern');
eq(new Set([...A, ...GATE_B].map((p) => p.id)).size, A.length + GATE_B.length, 'pattern ids are unique');
for (const p of [...A, ...GATE_B]) {
  ok(p.re.test(SAMPLE[p.id]), `${p.id} matches its sample`);
  for (const q of A.includes(p) ? GATE_B : A) ok(!q.re.test(SAMPLE[p.id]), `${SAMPLE[p.id]} is in both gates: ${p.id} and ${q.id}`);
}

// What fires, with which ids.
eq(correction('No, always use tabs.').ids, ['A-no', 'B-always'], 'no context at all: ids in gate order');
eq(correction('Actually, instead of that, always ask first.').ids, ['A-weak-actually', 'A-weak-instead', 'B-always'], 'two weak cues count');
ok(!correction('Actually always ask first.').fire, 'one weak cue does not');
ok(!correction('Instead, instead always ask first.').fire, 'one weak cue twice is one');
ok(!correction('Actually it works. Instead always use tabs.').fire,'a weak cue counts in the first sentence only');
ok(!correction('Немојте да го правите тоа, секогаш.').fire, 'a Cyrillic word is whole');
eq(correction('No, always use tabs. ' + '`a`'.repeat(1e5)).drop, 'F3-long', 'a prompt past the read limit counts as long');
ok(correction('No, always use tabs. ' + '`a` '.repeat(300) + 'end').fire, 'the blanks that code leaves are not counted toward the 500');
ok(!correction('Ok. No, always use tabs.').fire, 'gate A reads the first sentence only');
eq(quick('No, that is wrong.', { marker: true }).ids, ['A-no', 'A-wrong', 'B-marker'], 'the marker stands for gate B');
ok(!quick('No, that is wrong.', { marker: false }).fire, 'gate A alone is no match');
eq(quick('No, that is wrong.', { marker: false }).drop, '', 'and no drop');
eq(quick('No, always use tabs.', { helper: true }).ids, ['A-no', 'B-always'], 'a drop keeps the pattern ids');

// The functions in ctx run only when needed: a spy counts every call.
for (const c of cases) {
  const text = textOf(c), spy = spyOf(c);
  correction(text, spy.ctx);
  if (!A.some((p) => p.re.test(text))) ok(spy.marker === 0 && spy.last === 0, `no gate A phrase, no transcript read: ${text.slice(0, 50)}`);
}
const calls = (text, c) => { const spy = spyOf(c); correction(text, spy.ctx); return [spy.marker, spy.last]; };
eq(calls('Can you add a test?'), [0, 0], 'nothing matched, nothing called');
eq(calls('No, always use tabs.'), [0, 0], 'gate B has a phrase, F4 has no question: no marker call');
eq(calls('No, that is wrong.'), [1, 0], 'gate B has no phrase: one marker call');
eq(calls('Why did you always edit the lockfile?', { marker: true }), [1, 0], 'F4 asks the marker once more: answered once');
eq(calls('Why did you always edit the lockfile?'), [1, 0], 'a question with no marker: dropped after one call');
eq(calls('No. Never use tabs.'), [0, 1], 'a bare no asks whether Claude had asked a question');
eq(calls('No, that is wrong.', { helper: true }), [0, 0], 'a helper is dropped before any transcript read');
eq(calls('No, that is wrong.', { first: true }), [0, 0], 'a first prompt too');

// Never throws, whatever the text.
const kinds = ['', ' ', '\ud800', 'x\udc00y', '\ud83d', 'a'.repeat(1e7), '`'.repeat(1e6), '\n'.repeat(1e6), '>'.repeat(1e6), 'No, always ' + 'x'.repeat(1e7), '`a`'.repeat(1e5)];
for (const t of kinds) { const r = correction(t, spyOf().ctx); ok(typeof r.fire === 'boolean' && Array.isArray(r.ids) && typeof r.drop === 'string', 'a verdict for any text'); }
for (const t of [undefined, null, 5, {}]) ok(correction(t).fire === false, 'a non-string is no match');
ok(correction('No, always use tabs.', null).fire, 'no ctx is fine');
eq(correction('', spyOf().ctx), { fire: false, ids: [], drop: '' }, 'empty text');

console.log(`correction: ${checks} checks passed`);
