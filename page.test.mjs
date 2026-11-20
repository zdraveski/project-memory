// Self-check for page.mjs, the one local HTML page of the journal: its date and search helpers, and the page built from plain data.
// Run: node page.test.mjs
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { addDays, weekOf, matches, level, daysAgo, pageHtml } from './page.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.deepEqual(weekOf('2026-11-20'), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
checks += 3;
const e = { p: 'bookshop', q: 'Why is the Cart total wrong?', a: 'Summed as floats.', c: '3f07bb43', b: 'main', f: ['src/cart.js'] };
ok(matches(e, '', '') && matches(e, 'cart', '') && matches(e, 'cart.js', 'bookshop'), 'words in the request and in a file');
ok(!matches(e, 'cart', 'garden-site') && !matches(e, 'tomato', '') && !matches(e, 'cart tomato', ''), 'another project, another word, a missing word among found ones');
ok(!matches({ ...e, priv: 1, q: '', a: '' }, 'bookshop', ''), 'a private turn is never a search match');
ok(matches({ ...e, priv: 1, q: '', a: '' }, '', 'bookshop'), 'but it shows on its day');
assert.deepEqual([0, 1, 2, 4, 8].map((n) => level(n, 8)), [0, 1, 1, 2, 4]);
assert.equal(daysAgo('2026-11-20', '2026-11-20'), 0);
assert.equal(daysAgo('2026-10-31', '2026-11-02'), 2);
checks += 3;

// The page built from plain data: one policy, escaped data, nothing loaded from anywhere.
const sha = (t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`;
const entry = (o) => ({ d: '2026-11-12', t: '10:00', c: '3f07bb43', b: 'main', p: 'bookshop', q: 'Why is the cart total wrong?', a: 'Summed as floats.', f: ['src/cart.js'], n: 0, priv: 0, cut: 0, ...o });
const data = (entries, o) => ({ built: '2026-11-12 10:05', today: '2026-11-12', days: 30, entries, ...o });
// A made-up value in the form of the newest redact rule.
const GH = ['gh', 'p_', 'Zq8Xk2Lm4Nv6Bt1Rw3Ys5Df7Gh9Jk0Pa2Cd4'].join('');
const parts = (h) => ({ style: h.match(/<style>([\s\S]*?)<\/style>/)[1], script: h.match(/<script>([\s\S]*?)<\/script>/)[1] });
const dataOf = (script) => JSON.parse(script.slice('const DATA='.length, script.indexOf(';\nfunction addDays')));

const hostile = [
  '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '</style><link rel=stylesheet href=//x.test/a.css>',
  '</script><script>alert(2)</script>', '<!-- <script>', 'a\u001b[31m\u202eb\u0000c\u2028d\u2029e', `token ${GH}`, '${alert(3)} `x`',
];
const h = pageHtml(data([
  entry({ q: hostile[0], a: hostile[1], f: [hostile[2], 'src/x"onload="y.js'], b: hostile[3], p: hostile[4], c: hostile[5] }),
  entry({ q: hostile[6], a: hostile[7], n: 1, cut: 1 }),
  entry({ q: '', a: '', f: [], b: '', priv: 1 }),
]));
const { style, script } = parts(h);
ok(h.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src ${sha(style)}; script-src ${sha(script)}">`), 'the policy names the hash of the style and of the script');
ok(h.indexOf('Content-Security-Policy') < h.indexOf('<style'), 'the policy comes before any style or script');
ok(h.split('<script').length === 2 && h.split('<style').length === 2 && h.split('</script>').length === 2, 'one script and one style, whatever the data says');
ok(!script.slice(0, script.indexOf(';\nfunction addDays')).includes('<'), 'the data holds no < at all');
for (const bad of ['<link', '<iframe', ' style=', '@import', 'http:', 'https:', 'fetch(', 'url(']) ok(!h.includes(bad), `the page has no ${bad}`);
ok(h.split('<img').length === 2, 'one picture');
assert.deepStrictEqual(h.match(/ src="[^"]{0,22}/g), [' src="data:image/png;base64,']); checks++;
assert.deepStrictEqual(h.match(/ href="[^"]*"/g), [' href="#list"']); checks++;
for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', "setAttribute('style'", 'setAttribute("style"']) ok(!script.includes(bad), `the script never uses ${bad}`);
for (const fn of [addDays, weekOf, matches, level, daysAgo]) ok(script.includes(String(fn)), `the page runs the tested ${fn.name}`);
new vm.Script(script); checks++;
const d = dataOf(script);
ok(d.entries[0].q === hostile[0] && d.entries[0].a === hostile[1] && d.entries[0].f[0] === hostile[2], 'the data comes back as it went in');
ok(!h.includes(GH) && d.entries[1].q.includes('token ') && !d.entries[1].q.includes(GH), 'a secret is redacted when the page is built');
ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2028\u2029]/.test(h.replace(/\r?\n/g, '')) && d.entries[0].c === 'a�[31m�b�c\u2028d\u2029e', 'control and bidi characters are replaced, and the line separators too');
ok(d.entries[2].priv === 1 && d.entries[2].q === '' && d.entries[2].cut === 0, 'a private turn keeps no text');
ok(d.entries[1].n === 1 && d.entries[1].cut === 1 && d.today === '2026-11-12' && d.days === 30, 'the flags and the range come through');
ok(script.startsWith('const DATA='), 'the script starts with its data');
ok(dataOf(parts(pageHtml(data([], { days: 'all' }))).script).days === 'all' && dataOf(parts(pageHtml(data([], { days: '7' }))).script).days === 7, 'the range is a number of days or all');

// The script runs to its end against a document that accepts everything: a mistake in it (a name that is not there) throws here, not in a browser.
const dom = () => {
  const el = new Proxy(function () {}, {
    get: (t, k) => k === Symbol.iterator ? function* () {} : k === 'length' ? 0 : k === 'then' ? undefined : el,
    set: () => true, apply: () => el, construct: () => el,
  });
  return { document: el, matchMedia: () => ({ matches: true }), addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, innerHeight: 800, scrollY: 0, console };
};
const run = (entries, o) => { const s = parts(pageHtml(data(entries, o))).script; vm.runInNewContext(s, dom()); checks++; };
run([entry({}), entry({ priv: 1, q: '', a: '', f: [], b: '' }), entry({ cut: 1, n: 1, d: '2026-11-10' })]);
run([]);
run([entry({})], { days: 'all' });
run([entry({ d: '2026-10-01' })], { days: 7 });


console.log(`page.test.mjs: ${checks} checks passed`);
