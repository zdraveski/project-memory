// Self-check for page.mjs, the one local HTML page of the journal: its date and search helpers, and the page built from plain data.
// Run: node page.test.mjs
import assert from 'node:assert';
import { addDays, weekOf, matches, level, daysAgo } from './page.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.deepEqual(weekOf('2026-11-20'), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
checks += 3;
const e = { p: 'bookshop', q: 'Why is the Cart total wrong?', a: 'Summed as floats.', c: '3f07bb43', b: 'main', f: ['src/cart.js'] };
ok(matches(e, '', '') && matches(e, 'cart', '') && matches(e, 'cart.js', 'bookshop'), 'words in the request and in a file');
ok(!matches(e, 'cart', 'garden-site') && !matches(e, 'tomato', ''), 'another project, another word');
ok(!matches({ ...e, priv: 1, q: '', a: '' }, 'bookshop', ''), 'a private turn is never a search match');
ok(matches({ ...e, priv: 1, q: '', a: '' }, '', 'bookshop'), 'but it shows on its day');
assert.deepEqual([0, 1, 2, 4, 8].map((n) => level(n, 8)), [0, 1, 1, 2, 4]);
assert.equal(daysAgo('2026-11-20', '2026-11-20'), 0);
assert.equal(daysAgo('2026-10-31', '2026-11-02'), 2);
checks += 3;

console.log(`page.test.mjs: ${checks} checks passed`);
