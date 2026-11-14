// Self-check for enforce.mjs: the rule in a note's front matter, and what it
// matches in a git command. Run: node enforce.test.mjs
import { mkdirSync, writeFileSync, openSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome } from './harness.mjs';
import { ruleOf, rulesOf, segments, tokens, hits, commandsOf } from './enforce.mjs';
import { front } from './store.mjs';
import { chunk } from './journal.mjs';

const { home } = tempHome('enforce-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const note = (rule, extra = '') => `---\nname: Stage files by name\ndescription: Never run git add -A.\ntype: feedback\n${extra}${rule}---\n\nbody\n`;
const ADD = 'enforce:\n  on: git add\n  has: [-A, --all, .]\n  unless: [mktemp, init]\n';

// ruleOf: good rules
let r = ruleOf(note(ADD));
ok(r.rule && r.rule.on === 'add' && r.rule.has.join() === '-A,--all,.' && r.rule.unless.join() === 'mktemp,init', `a good rule is read (got ${JSON.stringify(r)})`);
ok(ruleOf(note('enforce:\n  on: git push\n  has: --force\n')).rule.has.join() === '--force', 'a single word is a list of one');
ok(ruleOf(note('enforce:\n  on: git push\n  has: --force\n')).rule.unless.length === 0, 'unless is optional');
ok(ruleOf(note(ADD).replace(/\n/g, '\r\n')).rule?.on === 'add', 'a CRLF file');
ok(ruleOf('\uFEFF' + note(ADD)).rule?.on === 'add', 'a BOM');
ok(ruleOf(note(ADD).replace(/\n/g, '\r')).rule?.on === 'add' || ruleOf(note(ADD).replace(/\n/g, '\r')) === null, 'a lone CR never throws');
ok(ruleOf(note('')) === null, 'no block: no rule');
ok(ruleOf(note('', 'has: [-A]\non: git add\n')) === null, 'keys outside enforce: are no rule');
ok(ruleOf('enforce:\n  on: git add\n  has: [-A]\n') === null, 'no front matter: no rule');
ok(ruleOf(`---\nname: x\n---\n\n${ADD}`) === null, 'a block in the body is no rule');

// ruleOf: bad rules, each with a reason, never a throw
const bad = (text, re, msg) => { const b = ruleOf(text); ok(b?.bad && re.test(b.bad), `${msg} (got ${JSON.stringify(b)})`); };
bad(note('enforce:\n  on: npm install\n  has: [-g]\n'), /git/, 'on must be git');
bad(note('enforce:\n  on: git\n  has: [-g]\n'), /subcommand/, 'on needs a subcommand');
bad(note('enforce:\n  true: git add\n  has: [-A]\n'), /rewritten to `true`/, 'a YAML tool turned on: into true:');
bad(note('enforce:\n  on: git add\n  has: []\n'), /has/, 'empty has');
bad(note('enforce:\n  on: git add\n'), /has/, 'missing has');
bad(note('enforce:\n  on: git add\n  has: [a, b, c, d, e, f, g, h, i]\n'), /8/, 'nine words');
bad(note('enforce:\n  on: git add\n  has: ["-A"]\n'), /quote/, 'quotes');
bad(note('enforce:\n  on: git add\n  has:\n    - -A\n'), /list/, 'a block list instead of a flow list');
bad(note('enforce:\n  on: git add\n  has: [-A]\n  level: ask\n'), /level/, 'an unknown key');
bad(note('enforce:\n  has: [-A]\n'), /on/, 'missing on');

// A note with the block still reads as without it, even when the rule holds words front() looks for
const withBlock = note('enforce:\n  on: git add\n  has: [type: archive, tier: archive]\n');
ok(JSON.stringify(front(withBlock)) === JSON.stringify(front(note(''))), 'front() ignores the enforce block');

// segments and tokens
ok(segments('a && b || c; d | e\nf').join('|') === 'a|b|c|d|e|f'.split('|').map((s) => s).join('|'), 'split at && || ; | newline');
ok(segments('echo "a && b"; git x').length === 2, 'not inside quotes');
ok(segments("git commit -F - <<'EOF'\ngit add -A\nEOF\ngit status").join('|').includes('git status') && !segments("git commit -F - <<'EOF'\ngit add -A\nEOF\ngit status").join('|').includes('add -A'), 'a heredoc body is dropped');
ok(tokens('git -C "C:\\my dir" add -A').join('|') === 'git|-C|C:\\my dir|add|-A', 'quotes group, a backslash is a character');
ok(tokens("echo 'a b'c").join('|') === 'echo|a bc', 'a quote inside a word');

// hits
const rule = ruleOf(note(ADD)).rule;
const hit = (cmd) => hits(rule, cmd).hit;
for (const c of ['git add -A', 'git add .', 'git -C x add --all', 'git --git-dir=x add -A', 'git -c core.x=1 add -A', 'git --no-pager add -A', 'git -P add -A', 'git --work-tree=x --literal-pathspecs add -A',
  'FOO=1 git add -A', 'cd x && git add -A', 'git status; git add -A', 'git add -A -n', 'git add -A; git status', 'git -C C:\\Users\\me\\repo add -A', 'git -C "C:\\Program Files\\r" add .'])
  ok(hit(c), `hit: ${c}`);
for (const c of ['git add -A && git init', 'git add file', 'git add src/a.mjs', 'git commit -m "git add -A"', "git commit -F - <<'EOF'\ngit add -A\nEOF", 'echo "git add -A"', 'git status', 'git add ./-A', 'mktemp; git add -A'])
  ok(!hit(c), `no hit: ${c}`);
ok(hits(rule, 'git add file').on && !hits(rule, 'git status').on, 'on says whether the command is the subcommand at all');
// known misses
for (const c of ['bash -c "git add -A"', 'git add -- -A', 'echo "$(git add -A)"', 'sudo git add -A']) ok(!hit(c), `known miss: ${c}`);
const push = ruleOf(note('enforce:\n  on: git push\n  has: --force\n')).rule;
ok(hits(push, 'git push --force').hit && hits(push, 'git push origin main --force').hit, 'git push --force');
ok(!hits(push, 'git push --force-with-lease').hit && !hits(push, 'echo "git push --force"').hit, 'not --force-with-lease, not an echo');

// rulesOf: the store's notes, archive and indexes left out, a bad block listed with its reason
const store = join(home, 'store'); mkdirSync(store);
writeFileSync(join(store, 'a.md'), note(ADD));
writeFileSync(join(store, 'b.md'), note('enforce:\n  on: npm i\n  has: x\n'));
writeFileSync(join(store, 'c.md'), note(ADD, 'tier: archive\n'));
writeFileSync(join(store, 'd.md'), note(''));
writeFileSync(join(store, 'MEMORY.md'), note(ADD));
writeFileSync(join(store, 'e.txt'), note(ADD));
const rs = rulesOf(store);
ok(rs.map((x) => x.file).join() === 'a.md,b.md' && rs[0].rule && rs[1].bad, `rulesOf lists a good and a bad rule, not archive, plain notes, the index (got ${JSON.stringify(rs)})`);
ok(rulesOf(join(home, 'none')).length === 0, 'no folder: no rules');

// commandsOf: Bash and PowerShell tool calls, any line length, `git` lines only
const line = (command, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-10T10:00:00.000Z', message: { content: [{ type: 'tool_use', name: 'Bash', id: 't1', input: { command } }] }, ...extra }) + '\n';
const tf = join(home, 't.jsonl');
const big = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'git '.repeat(5000) }] } }) + '\n';
writeFileSync(tf, line('git add -A') + big + line('git status') + 'not json git\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'git add -A' }] } }) + '\n' + line('ls') + line('git push'));
const seen = [];
commandsOf(tf, chunk, 4096, (c) => seen.push(c.command));
ok(seen.join('|') === 'git add -A|git status|git push', `commands past a line longer than the chunk (got ${seen.join('|')})`);
ok(new Date(0) && (() => { let t; commandsOf(tf, chunk, 1 << 20, (c) => { t ??= c.t; }); return t === Date.parse('2026-11-10T10:00:00.000Z'); })(), 'the line time is in ms');
{ const fd = openSync(tf, 'r'); const n = fstatSync(fd).size; closeSync(fd); ok(n > 4096, 'the fixture is longer than one chunk'); }

console.log(`enforce: ${checks} checks passed`);
