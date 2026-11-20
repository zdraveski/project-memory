// Self-check for recall.mjs: the word splitter and the tests on a journal entry. Run: node recall.test.mjs
import assert from 'node:assert';
import { words, changedFile, isHelper, inConversation, changers, whoChanged } from './recall.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const e = (over) => ({ key: '01234567 2026-10-28 14:05 a1b2c3d4e5f6', s: '01234567',
  t: 'C--shop/0123456789abcdef-aaaa', changed: ['src/cart.js', 'C:\\shop\\docs\\README.md'], ...over });
const win = process.platform === 'win32' || process.platform === 'darwin';
// one file, two spellings
ok(changedFile(e(), 'src/cart.js'), 'equal');
ok(changedFile(e(), './src/cart.js') && changedFile(e(), 'src\\cart.js'), 'slashes and ./');
ok(changedFile(e(), 'SRC/Cart.js') === win, 'case as the journal folds it');
ok(changedFile(e(), 'cart.js') && changedFile(e(), 'docs/README.md') && changedFile(e(), 'README.md'), 'the end of a path');
// the end of a path counts only at a folder
ok(!changedFile(e(), 'art.js') && !changedFile(e(), 'rc/cart.js'), 'not inside a name');
ok(!changedFile(e(), '') && !changedFile(e(), '/') && !changedFile(e({ changed: [] }), 'cart.js'), 'nothing given, nothing changed');
// the journal holds paths relative to the session folder; an absolute path matches when it ends in one, at a folder
ok(changedFile(e(), '/home/u/shop/src/cart.js') && changedFile(e(), 'c:\\shop\\src\\cart.js') && changedFile(e(), 'C:/shop/src/cart.js'), 'an absolute path ending in the stored one');
ok(!changedFile(e(), '/x/shop/rc/cart.js') && !changedFile(e(), '/x/shop/src/art.js') && !changedFile(e(), '/home/u/shop/lib/cart.js'), 'an absolute path matches only at a folder');
// helper
ok(isHelper(e({ key: 'subagent-a1' })) && !isHelper(e()), 'helper by key');
// conversation
ok(inConversation(e(), '0123') && inConversation(e(), '0123456789ABCDEF-aaaa'), 'start of the id, case ignored');
ok(!inConversation(e(), '1234') && !inConversation(e(), ''), 'not inside the id, not empty');
ok(inConversation(e({ t: '' }), '0123456789') && inConversation(e({ t: '' }), '0123'), 'no t: the tag decides');
ok(!inConversation(e({ t: '', s: '' }), '0123') && !inConversation(e({ t: 'C--shop/', s: '' }), '0123'), 'an entry with no id and no tag is in no conversation');
// the splitter did not change
ok(words('The Carts v1.2.3').join(' ') === '1.2.3 cart', 'same stems');
// who said it: a note's snapshots paired with the entries that changed it
const at = (t, over) => ({ key: `k ${t}`, at: `2026-11-12 ${t}`, s: '3f07bb43', t: 'C--shop/3f07bb43-aaaa',
  asked: 'save that as a rule', changed: ['/home/u/.claude/projects/C--shop/memory/rules.md'], ...over });
const P = ['/home/u/.claude/projects/C--shop/memory/rules.md'];
const who = (snaps, es) => whoChanged(snaps.map((t) => `2026-11-12 ${t}`), es).map((x) => x && (x.key ?? x));
ok(changers([at('14:02'), at('14:03', { changed: ['memory/rules.md'] }), at('14:04', { changed: [] })], P).length === 1, 'the full path, not its end');
assert.deepStrictEqual(who(['14:03'], [at('14:02')]), ['k 14:02']);
assert.deepStrictEqual(who(['14:03'], [at('14:03')]), ['k 14:03']);
assert.deepStrictEqual(who(['14:03'], [at('14:04')]), [null]);
assert.deepStrictEqual(who(['14:03', '15:00'], [at('14:02'), at('14:30')]), ['k 14:02', 'k 14:30']);
assert.deepStrictEqual(who(['14:03', '15:00'], [at('14:02'), at('14:03', { key: 'second' })]), ['k 14:02', null]);
assert.deepStrictEqual(who(['14:03', '15:00'], [at('13:00'), at('14:02')]), [null, null]);
assert.deepStrictEqual(who(['14:03', '15:00'], [at('13:00'), at('14:02'), at('14:30')]), [null, 'k 14:30']);
// given once
assert.deepStrictEqual(who(['14:03', '14:04'], [at('14:03')]), ['k 14:03', null]);
assert.deepStrictEqual(who(['14:03', '14:04'], [at('14:02')]), ['k 14:02', null]);
// one minute, two entries
const two = [at('14:02', { key: 'a' }), at('14:02', { key: 'b', t: 'C--shop/99999999-bbbb', s: '99999999' })];
assert.deepStrictEqual(who(['14:03'], two), ['several']);
assert.deepStrictEqual(who(['14:03'], [at('14:02', { key: 'a' }), at('14:02', { key: 'b' })]), [null]);
assert.deepStrictEqual(who(['14:00', '14:03'], [at('14:02', { key: 'a' }), at('14:02', { key: 'b' })]), [null, 'b']);
// two conversations between two snapshots: none is named, even when one is older
assert.deepStrictEqual(who(['14:03', '15:00'], [at('14:02'), at('14:10', { t: 'C--shop/99999999-bbbb', s: '99999999' }), at('14:20')]), ['k 14:02', 'several']);
// a helper's entry is named only when nothing else fits
const sub = (t, over) => at(t, { key: `subagent-${t}`, asked: 'Subagent Explore: look', ...over });
assert.deepStrictEqual(who(['14:03'], [at('14:01'), sub('14:02')]), ['k 14:01']);
assert.deepStrictEqual(who(['14:03'], [sub('14:02')]), ['subagent-14:02']);
assert.deepStrictEqual(who(['14:03'], []), [null]);
assert.deepStrictEqual(who([], [at('14:02')]), []);
// every entry in a snapshot's own minute is taken, not only the one named
assert.deepStrictEqual(who(['14:00', '14:03', '14:04'], [at('14:03', { key: 'a' }), at('14:03', { key: 'b' })]), [null, 'b', null]);
assert.deepStrictEqual(who(['14:02', '14:03', '14:04'], [at('14:01', { key: 'a' }), at('14:03', { key: 'b' }), at('14:03', { key: 'c' })]), ['a', 'c', null]);
// a deleted snapshot names nothing, and takes its minute's entries
const del = (snaps, es, d) => whoChanged(snaps.map((t) => `2026-11-12 ${t}`), es, d).map((x) => x && x.key);
assert.deepStrictEqual(del(['14:03', '14:04'], [at('14:02'), at('14:03', { key: 'b' })], [false, true]), ['k 14:02', null]);
assert.deepStrictEqual(del(['14:03', '14:04'], [at('14:03')], [true, false]), [null, null]);
// midnight
assert.deepStrictEqual(whoChanged(['2026-11-13 00:01'], [at('23:58', { key: 'day before' })]).map((x) => x && x.key), ['day before']);
assert.deepStrictEqual(whoChanged(['2026-11-12 23:59'], [at('00:01', { at: '2026-11-13 00:01' })]), [null]);
checks += 17;

console.log(`recall.test.mjs: ${checks} checks passed`);
