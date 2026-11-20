// Self-check for recall.mjs: the word splitter and the tests on a journal entry. Run: node recall.test.mjs
import assert from 'node:assert';
import { words, changedFile, isHelper, inConversation } from './recall.mjs';

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
console.log(`recall.test.mjs: ${checks} checks passed`);
