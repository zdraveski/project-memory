// Self-check for enforce.mjs: the rule in a note's front matter, and what it
// matches in a git command. Run: node enforce.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync, openSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, storeFor } from './harness.mjs';
import { ruleOf, rulesOf, segments, tokens, hits, commandsOf, ruleSet, privateTurn, record, tally, LOG, CACHE, CACHE_V, LOG_MAX } from './enforce.mjs';
import { front, projectsRoot, sharedStore, QUIET, OFF, PROJECT_OFF } from './store.mjs';
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

// An enforce: block indented under metadata: is no rule, and says why (it used to be skipped without a word)
bad(`---
name: x
metadata:
  type: feedback
  enforce:
    on: git add
    has: [-A]
---

body
`, /start of a line, not under metadata:/, 'an indented enforce: block');
ok(ruleOf(`---
name: x
metadata:
  type: feedback
---

  enforce:
`) === null, 'an indented enforce: in the body is no rule');

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
  'FOO=1 git add -A', 'echo x |git add -A', 'echo x||git add -A', 'echo x&git add -A', 'sleep 1 & git add -A', 'git status 2>&1 && git add -A', 'git add -A &>/dev/null', 'cd x && git add -A', 'git status; git add -A', 'git add -A -n', 'git add -A; git status', 'git -C C:\\Users\\me\\repo add -A', 'git -C "C:\\Program Files\\r" add .'])
  ok(hit(c), `hit: ${c}`);
for (const c of ['git status 2>&1', 'git status &>/dev/null', 'echo a & git status', 'git add -A && git init', 'git add file', 'git add src/a.mjs', 'git commit -m "git add -A"', "git commit -F - <<'EOF'\ngit add -A\nEOF", 'echo "git add -A"', 'git status', 'git add ./-A', 'mktemp; git add -A'])
  ok(!hit(c), `no hit: ${c}`);
for (const c of ['rtk bypass git add -A', 'rtk proxy git add -A', 'rtk git add -A', 'sudo -u bob git add -A', 'sudo -E git add -A', 'cmd /c git add -A', 'env -i FOO=1 git add -A', 'time -p git add -A'])
  ok(hit(c), `hit through a lead word's options: ${c}`);
for (const c of ['exec -a name git add -A', 'cmd.exe /c git add -A'])
  ok(hit(c), `hit through a lead word's options (1.5.2 review): ${c}`);
for (const c of ['rtk bypass git add file.txt', 'sudo -u bob git add file.txt', 'cmd /c git add file.txt', 'rtk bypass ls -A', 'sudo -u bob ls -A'])
  ok(!hit(c), `no hit: ${c}`);
ok(hits(rule, 'git add file').on && !hits(rule, 'git status').on, 'on says whether the command is the subcommand at all');
// a command wrapped in quotes for another shell (BUG found 1.5.3: it was not seen)
for (const c of ['cmd /c "git add -A"', 'bash -c "git add -A"', "sh -c 'cd x && git add .'", '/bin/bash -lc "git add -A"', 'powershell -Command "git add -A"', 'rtk bash -c "git add -A"'])
  ok(hit(c), `hit inside a shell's quotes: ${c}`);
for (const c of ['bash -c "git add file"', 'bash -c "echo git add -A"', 'bash -c "mktemp; git add -A"', 'bash script.sh'])
  ok(!hit(c), `no hit inside a shell's quotes: ${c}`);
// known misses
for (const c of ['git add -- -A', 'echo "$(git add -A)"']) ok(!hit(c), `known miss: ${c}`);
const push = ruleOf(note('enforce:\n  on: git push\n  has: --force\n')).rule;
ok(hits(push, 'git push --force').hit && hits(push, 'git push origin main --force').hit, 'git push --force');
ok(!hits(push, 'git push --force-with-lease').hit && !hits(push, 'echo "git push --force"').hit, 'not --force-with-lease, not an echo');

// review fixes: here-string and unclosed heredoc word keep the rest; compound forms; bad flow list and inline block
for (const c of ['cat <<< hi\ngit add -A', 'echo "x <<EOF"\ngit add -A', '(git add -A)', '{ git add -A; }', 'for f in x; do git add -A; done', 'if true; then git add -A; fi', '! git add -A'])
  ok(hit(c), `hit: ${c}`);
ok(!hit("git commit -F - <<-'EOF'\n\tgit add -A\nEOF"), 'a <<- heredoc body is still dropped');
bad(note('enforce:\n  on: git add\n  has: [-A\n'), /closed/, 'an unclosed flow list');
bad(note('enforce: {on: git add, has: [-A]}\n'), /enforce/, 'an inline enforce block');
bad(note('enforce:\n  on: git add\n  has: [-A]\n  has: [-B]\n'), /`has` is given twice/, 'a repeated key');

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

// 1.4.1 L: parsing
const BS = String.fromCharCode(92), A = (c) => hits({ on: 'add', has: ['-A', '--all'], unless: [] }, c);
// 1.5.1 L2: `unless` also matches a folder name inside a path; `has` still matches whole words only
const STAGE = { on: 'add', has: ['-A', '--all', '.'], unless: ['mktemp', 'init', 'scratchpad'] }, S = (c) => hits(STAGE, c).hit;
for (const c of ['cd /tmp/claude/abc/scratchpad/repo-c && git add -A', `git -C C:${BS}Users${BS}me${BS}scratchpad${BS}repo add -A`, `git -C "C:${BS}Temp${BS}scratchpad${BS}r b" add .`, 'cd ~/x/scratchpad && git add --all'])
  ok(!S(c), `scratchpad path exempts: ${c}`);
for (const c of ['cd ~/.claude/hooks && git add -A && git status --short', 'git -C ~/scratchpad-old/r add -A', 'git -C ~/my_scratchpad add -A', 'git add -A && cat ~/notes/init.txt', 'git add -A'])
  ok(S(c), `still a hit: ${c}`);
for (const c of ['git add src/.', 'git add ./', 'git add a/--all', `git add C:${BS}x${BS}.`, 'git add ./-A'])
  ok(!S(c), `a path is not a has word: ${c}`);

const t0 = Date.now(); ruleOf(note('enforce:\n  on: git add\n  has: [-A]\n  unless: x' + ' '.repeat(60000) + 'y\n'));
ok(Date.now() - t0 < 500, 'ruleOf is not quadratic on a long run of blanks');
for (const c of [`git commit -m "a ${BS}" b"; git add -A`, `git commit -m "say ${BS}"hi${BS}" now" && git add -A`, `git commit -m it${BS}'s; git add -A`, `echo "x ${BS}" y"\ngit add -A`])
  ok(A(c).hit, `escaped quote: ${c}`);
ok(!A(`git commit -m 'C:${BS}dir${BS}' ; echo hi`).hit, 'a backslash before a closing single quote is no escape');
ok(tokens(`echo a${BS}`).join('|') === `echo|a${BS}`, 'a trailing backslash stays');
for (const c of ['git --no-optional-locks add -A', 'git -p add -A', 'git --bare add -A', 'git --exec-path=/x add -A', 'git --namespace n add -A', 'git --config-env=a=B add -A', 'git -c a=b --no-optional-locks -C d add -A'])
  ok(A(c).hit, `global option: ${c}`);
ok(!A('git --no-optional-locks status -A').hit, 'status -A is no hit');
for (const c of ['if ($?) { git add -A }', 'try { git add -A } catch { }', 'Get-ChildItem | ForEach-Object { git add -A }', '(cd x && git add -A)', '{git add -A}', 'a && (b; git add -A)', '$x = (git add -A)'])
  ok(A(c).hit, `block: ${c}`);
ok(!A('echo "if (x) { git add -A }"').hit, 'braces inside quotes are no separator');
for (const c of [`git add ${BS}\n  -A`, `git add ${BS}\r\n  -A`, `git ${BS}\n  add -A`, 'git add `\n  -A']) ok(A(c).hit, `continuation: ${JSON.stringify(c)}`);
ok(!A(`echo hi${BS}\ngit status`).hit, 'a continuation is no false hit');
ok(A("echo '<<EOF'\ngit add -A\nEOF").hit && A('git commit -m "docs: show <<EOF usage"\ngit add -A\nEOF').hit, 'a quoted << is no heredoc');
ok(!A('cat <<EOF\ngit add -A\nEOF').hit, 'a real heredoc body is still dropped');
for (const c of ['env FOO=1 git add -A', 'command git add -A', '/usr/bin/git add -A', 'git.exe add -A', 'rtk git add -A', 'sudo git add -A', 'time git add -A', '& git add -A', '& "C:/Program Files/Git/cmd/git.exe" add -A'])
  ok(A(c).hit, `wrapped: ${c}`);
ok(!A('echo git add -A').hit && !A('git-lfs add -A').hit && !A('gitk add -A').hit, 'echo, git-lfs, gitk are no hit');
const t1 = Date.now(), long = A('git add -A\n' + 'cat <<EOF\n'.repeat(20000)), t2 = Date.now(); segments('git status\n' + 'cat <<A\nx\n'.repeat(60000));
ok(long.hit && t2 - t1 < 500 && Date.now() - t2 < 500, 'unclosed heredocs are linear');

ok(!segments('echo "x\\').join('|').includes('undefined') && segments('git commit -m "a\\\ngit add -A"').length === 1, 'a backslash ending the last line in a quote adds no text');
{ const d = join(home, 'big'); mkdirSync(d); const rule = 'enforce:\n  on: git\n  has:\n    - x\n';
  writeFileSync(join(d, 'long.md'), '---\ndescription: ' + 'a'.repeat(70000) + '\n' + rule + '---\n');
  ok(rulesOf(d).length === 0, 'front matter that ends after 64 KB is no rule in status, as in the hook'); }

// 1.5.3 holes: ruleOf, segments, tokens and hits in detail
{ const g = 'garbage line that has no colon in it, it is long enough to cut', b = ruleOf(note(`enforce:\n  on: git add\n  has: [-A]\n  ${g}\n`));
  ok(b?.bad === `cannot read the line "${g.slice(0, 40)}"`, `an unreadable line is quoted, cut at 40 (got ${JSON.stringify(b)})`); }
ok(ruleOf(note('enforce:\n  on: git push\n  has: on\n')).rule?.has.join() === 'on', 'a value equal to a key name is no repeated key');
bad(note('enforce:\n  on: git add\n  has:\n'), /must be a word or a flow list/, 'has: with nothing after it');
bad(note('enforce:\n  on: git add\n  has: [-A]\n  unless:\n'), /must be a word or a flow list/, 'unless: with nothing after it');
bad(note('enforce:\n  on: git add\n  has: []\n'), /is empty/, 'has: [] says it is empty');
bad(note('enforce:\n  on: git add\n  has: [ ]\n'), /is empty/, 'has: [ ] says it is empty');
ok(ruleOf(note('enforce:\n  on: git add\n  has: [-A]\n  unless: []\n')).rule?.unless.length === 0, 'unless: [] is allowed');
ok(ruleOf(note('enforce:\n  on: git add\n  has: [-A]\n')).rule?.has.join() === '-A', 'a flow list of one word');
bad(note('enforce:\n  on: git add\n  has: [a, , c]\n'), /empty word or a word with a space/, 'an empty word in a list');
bad(note('enforce:\n  on: git add\n  has: [a b, c]\n'), /empty word or a word with a space/, 'a word with a space');
ok(ruleOf(note('enforce:\n  on: git add\n  has: [a, b, c, d, e, f, g, h]\n')).rule?.has.length === 8, 'eight words are allowed');
ok(ruleOf(note('enforce:\n  on:  git add\n  has: [-A]\n')).rule?.on === 'add', 'a leading no-break space in on: is no word');
{ const d = join(home, 'store-dir'); mkdirSync(d); mkdirSync(join(d, 'dir.md')); writeFileSync(join(d, 'a.md'), note(ADD));
  ok(rulesOf(d).map((x) => x.file).join() === 'a.md', 'a folder named like a note is skipped, not listed'); }

ok(segments(`echo a${BS}b\ngit status`).join('|') === `echo a${BS}b|git status`, 'a backslash before the last character of a line is a character');
ok(!hit('echo <x<<EOF\ngit add -A\nEOF') && !hit('cat <<E<\ngit add -A\nE'), 'a heredoc after another < and a heredoc word followed by <');
ok(!hit('cat <<EOF\nx\ngit add -A\nEOF') && hit('cat <<EOF\nx\nEOF\ngit add -A'), 'a heredoc body of several lines is dropped, the line after it is not');
ok(hit('cat <<EOF "x\n" ; git add -A\nEOF') && hit('cat <<EOF "x\n" ; git add -A\nEOF\nEOF'), 'a heredoc opened beside an open quote does not swallow the quote');
ok(segments('a & b').join('|') === 'a|b' && segments('a&b').join('|') === 'a|b' && segments('a&&b').join('|') === 'a|b' && segments('a 2>&1').join('|') === 'a 2>|1', 'a single & and && are both separators (a background command is followed by another)');
ok(segments('a|b').join('|') === 'a|b' && segments('a||b').length === 2 && segments('a|b').length === 2 && segments('a;b').length === 2, 'a | splits without eating the next character');
ok(tokens('').length === 0 && tokens('  a').join('|') === 'a', 'no empty token before or after the words');
ok(tokens(`say ${BS}"hi${BS}"`).join('|') === 'say|"hi"' && tokens(`it${BS}'s`).join('|') === "it's" && tokens(`a${BS}"`).join('|') === 'a"', 'an escaped quote is the quote');
ok(tokens(`'a${BS}b' 'C:${BS}'`).join('|') === `a${BS}b|C:${BS}`, 'a backslash inside single quotes is a character');
ok(JSON.stringify(tokens('x ""')) === '["x",""]', 'an empty quoted word is a word');
ok(hits(rule, 'bash -c "git add file"').on && hits(rule, 'bash -c "git add -A"').on && !hits(rule, 'bash -c "echo hi"').on, 'a quoted command counts for on');
ok(!hits(rule, 'git').on && !hits(rule, 'git -C').on && !hits(rule, '').on, 'git alone, git -C alone');
ok(hit('git add -A -- f') && !hit('git add f -- -A') && !hits({ on: 'add', has: ['--'], unless: [] }, 'git add f -- g').hit, 'only the words before -- count');

// 1.5.3 holes: commandsOf in detail
{ const f = join(home, 'c.jsonl'), L = (m, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-10T10:00:00.000Z', message: m, ...extra }) + '\n', use = (name, input) => ({ content: [{ type: 'tool_use', name, input }] });
  writeFileSync(f, ['{"x":"git"}\n', '"git"\n', L({ content: 'git add -A' }), L({ content: [null, { type: 'tool_use', name: 'Bash', input: { command: 'git a' } }] }),
    L(use('Read', { command: 'git b' })), L(use('PowerShell', { command: 'git c' })), L(use('Bash', { command: 5, description: 'git' })), L(use('Bash', { command: 'ls', description: 'git' })), L({ content: [{ type: 'tool_use', name: 'Bash', id: 'git' }] }),
    L({ content: [{ type: 'tool_result', name: 'Bash', input: { command: 'git d' } }] }), L(use('Bash', { command: 'git e' }), { isSidechain: true }), L(use('Bash', { command: 'git f' }), { isSidechain: 'true' })].join(''));
  const got = []; commandsOf(f, chunk, 1 << 20, (c) => got.push(c));
  ok(JSON.stringify(got.map((c) => [c.command, c.sidechain])) === '[["git a",false],["git c",false],["git e",true],["git f",false]]', `commandsOf keeps only git commands of Bash and PowerShell (got ${JSON.stringify(got)})`); }

// 1.5.3 holes: ruleSet, the cache, privateTurn, record and tally, called here (this suite alone checks enforce.mjs)
let pn = 0;
const proj = (rl = ADD) => { const cwd = join(home, `proj${++pn}`), st = storeFor(home, cwd); mkdirSync(cwd, { recursive: true }); mkdirSync(st, { recursive: true }); writeFileSync(join(st, 'stage.md'), note(rl));
  return { cwd, st, payload: (extra = {}) => ({ session_id: 'abcd1234-aaaa', cwd, ...extra }) }; };
const files = (s) => s.rules.map((x) => x.file).join();
{ const q = proj(), s = ruleSet(q.payload());
  ok(s.store === q.st && !s.off && files(s) === 'stage.md' && s.rules[0].rule.on === 'add', `ruleSet names the store and its rules (got ${JSON.stringify(s)})`);
  const cf = join(q.st, CACHE), T = new Date('2026-01-01T00:00:00Z'); ok(existsSync(cf), 'the first call builds the cache');
  utimesSync(cf, T, T); ruleSet(q.payload()); ok(statSync(cf).mtimeMs === T.getTime(), 'a call that finds nothing changed leaves the cache alone');
  const st = statSync(join(q.st, 'stage.md')), BOG = { rule: { on: 'ls', has: ['x'], unless: [] } }, mk = (fs, v = CACHE_V) => writeFileSync(cf, JSON.stringify({ v, files: fs })), on = () => ruleSet(q.payload()).rules[0]?.rule.on;
  mk({ 'stage.md': { mtime: st.mtimeMs, size: st.size, r: BOG } }); ok(on() === 'ls', 'a cache entry with the note\'s time and size is used');
  mk({ 'stage.md': { mtime: st.mtimeMs + 1, size: st.size, r: BOG } }); ok(on() === 'add', 'another time: the note is read again');
  mk({ 'stage.md': { mtime: st.mtimeMs, size: st.size + 1, r: BOG } }); ok(on() === 'add', 'another size: the note is read again');
  mk({ 'stage.md': null }); ok(on() === 'add', 'a null entry: the note is read');
  mk({ 'stage.md': { mtime: st.mtimeMs, size: st.size, r: BOG } }, CACHE_V - 1); ok(on() === 'add', 'a cache of another version is not used');
  writeFileSync(cf, JSON.stringify({ files: { 'stage.md': { mtime: st.mtimeMs, size: st.size, r: BOG } } })); ok(on() === 'add', 'a cache with no version is not used');
  writeFileSync(cf, JSON.stringify({ v: CACHE_V, files: [{ mtime: st.mtimeMs, size: st.size, r: BOG }] })); ok(on() === 'add', 'a cache whose files are an array is not used');
  mk({ 'stage.md': { mtime: st.mtimeMs, size: st.size, r: ruleOf(note(ADD)) }, 'gone.md': { mtime: 1, size: 1, r: null } }); on();
  ok(Object.keys(JSON.parse(readFileSync(cf, 'utf8')).files).join() === 'stage.md', 'a note that is gone leaves the cache');
  mk({ 'gone.md': { mtime: 1, size: 1, r: null } }); on(); ok(Object.keys(JSON.parse(readFileSync(cf, 'utf8')).files).join() === 'stage.md', 'a new note replacing a gone one is cached');
  rmSync(cf); on(); ok(existsSync(cf), 'a new note is cached'); }
for (const [i, c] of ['[1,2]', '{"v":3,"files":"abc"}', '{"v":3,"files":null}', '{"v":3}', '{"v":2,"files":{"x.md":{}}}', '{"files":{"x.md":{}}}', 'null', '{ bad', '{"v":3,"files":{}}'].entries()) {
  const d = join(projectsRoot(), `emptyslug${i}`, 'memory'), cwd = join(home, `emptyproj${i}`); mkdirSync(d, { recursive: true }); writeFileSync(join(d, CACHE), c);
  const s = ruleSet({ session_id: 'abcd1234', cwd, transcript_path: join(d, '..', 's.jsonl') });
  ok(s.store === d && s.rules.length === 0 && readFileSync(join(d, CACHE), 'utf8') === c, `an unusable cache over a store with no notes is left alone: ${c}`); }
{ const q = proj(), st = q.st; ok(ruleSet(q.payload({ cwd: join(home, 'never-made') })).rules.length === 0 && !existsSync(storeFor(home, join(home, 'never-made'))), 'a store that does not exist has no rules, and none is made');
  writeFileSync(join(st, 'bad.md'), note('enforce:\n  on: ls\n  has: x\n')); writeFileSync(join(st, 'arch.md'), note(ADD, 'tier: archive\n')); writeFileSync(join(st, 'MEMORY.md'), note(ADD)); writeFileSync(join(st, 'x.txt'), note(ADD)); writeFileSync(join(st, 'plain.md'), note('')); mkdirSync(join(st, 'dir.md'));
  ok(files(ruleSet(q.payload())) === 'stage.md', 'a bad rule, an archive note, the index, a text file, a plain note and a folder give no rule');
  writeFileSync(join(st, 'long.md'), '---\ndescription: ' + 'a'.repeat(70000) + '\n' + ADD + '---\n'); ok(files(ruleSet(q.payload())) === 'stage.md', 'a rule after 64 KB of front matter is not read'); }
{ const sh = sharedStore(); mkdirSync(sh, { recursive: true }); writeFileSync(join(sh, 'shared-rule.md'), note(ADD)); writeFileSync(join(sh, 'shared-bad.md'), note('enforce:\n  on: ls\n  has: x\n'));
  const q = proj(); ok(files(ruleSet(q.payload())) === 'stage.md,_shared/shared-rule.md', `shared rules follow, named _shared/ (got ${files(ruleSet(q.payload()))})`);
  const s = ruleSet({ session_id: 'abcd1234', transcript_path: join(projectsRoot(), '_shared', 's.jsonl') }); ok(s.store === sh && files(s) === 'shared-rule.md', `the shared store's own rules are listed once, unprefixed (got ${files(s)})`);
  writeFileSync(join(sh, 'shared-rule.md'), note(ADD, 'tier: archive\n')); ok(files(ruleSet(q.payload())) === 'stage.md', 'an archived shared note has no rule'); rmSync(sh, { recursive: true }); }
{ const q = proj(); process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { const s = ruleSet(q.payload()); ok(s.off === true && s.rules.length === 0 && !('store' in s), 'memory off by env: off, no rules'); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; } }
{ const q = proj(); writeFileSync(join(q.st, PROJECT_OFF), JSON.stringify({ t: 1 })); const s = ruleSet(q.payload()); ok(s.off === true && s.store === q.st && s.rules.length === 0, 'a project marker: off, with its store');
  rmSync(join(q.st, PROJECT_OFF)); ok(!ruleSet(q.payload()).off, 'without the marker: on'); }
{ const q = proj(), qf = join(q.st, QUIET), of = join(projectsRoot(), OFF), isOff = (extra) => { const s = ruleSet(q.payload(extra)); return s.off === true && s.rules.length === 0 && s.store === q.st; };
  ok(!isOff(), 'no tag list: on'); writeFileSync(qf, 'beef0000\n'); ok(!isOff(), 'a list without the tag: on');
  writeFileSync(qf, 'beef0000\nabcd1234\n'); ok(isOff(), 'the tag in the incognito list: off'); ok(!isOff({ session_id: 'ffff0000' }), 'another session: on'); ok(!isOff({ session_id: '' }), 'no session id: on');
  rmSync(qf); mkdirSync(projectsRoot(), { recursive: true }); writeFileSync(of, 'abcd1234\n'); ok(isOff(), 'the tag in the memory-off list: off'); writeFileSync(of, 'beef0000\n'); ok(!isOff(), 'a memory-off list without the tag: on'); rmSync(of);
  mkdirSync(qf); ok(isOff(), 'an incognito list that cannot be read: off'); ok(!isOff({ session_id: '' }), 'but with no session id: on'); rmSync(qf, { recursive: true });
  mkdirSync(of); ok(isOff(), 'a memory-off list that cannot be read: off'); ok(!isOff({ session_id: '' }), 'but with no session id: on'); rmSync(of, { recursive: true }); }

{ const P = '<private-session>', tf2 = join(home, 'pt.jsonl'), pt = (...ls) => { writeFileSync(tf2, ls.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n'); return privateTurn({ transcript_path: tf2 }); };
  ok(privateTurn(null) === false && privateTurn({}) === false && privateTurn(undefined) === false, 'no payload, no path: not private');
  ok(pt({ type: 'user', message: { content: 'hi' } }) === false, 'a transcript without the mark: not private');
  ok(pt({ type: 'user', message: { content: `x ${P}` } }) === true, 'a typed string with the mark: private');
  ok(pt({ type: 'user', message: { content: [{ type: 'text', text: `x ${P}` }] } }) === true, 'a typed text block with the mark: private');
  ok(pt({ type: 'user', message: { content: [null, { type: 'text', text: P }] } }) === true, 'a null block before the text block');
  ok(pt({ type: 'user', message: { content: [{ type: 'text', text: P }, { type: 'tool_result', content: 'x' }] } }) === true, 'one text block among others is enough');
  ok(pt({ type: 'user', message: { content: [{ type: 'tool_result', content: P }] } }) === false, 'a tool result that quotes the mark: not private');
  ok(pt({ type: 'user', message: { content: [{ type: 'tool_result', content: P }, { type: 'text', text: 'hi' }] } }) === false, 'a text block without the mark beside a quoting tool result: not private');
  ok(pt({ type: 'assistant', message: { content: P } }) === false && pt({ type: 'assistant', message: { content: [{ type: 'text', text: P }] } }) === false, 'assistant text with the mark: not private');
  ok(pt({ type: 'user', message: { content: [{ type: 'text', text: 'a' }] }, note: P }) === false, 'the mark elsewhere in the line: not private');
  ok(pt(`${P} not json`, { type: 'user', message: { content: `x ${P}` } }) === true, 'a line that is not JSON is passed over');
  ok(privateTurn({ transcript_path: join(home, 'gone.jsonl') }) === true, 'an unreadable transcript: private'); }

{ const rec = (st, e) => { record(st, e); return existsSync(join(st, LOG)) ? readFileSync(join(st, LOG), 'utf8') : null; }, mkst = (n) => { const d = join(home, `rec${n}`); mkdirSync(d); return d; };
  ok(rec(mkst(1), { note: 'x'.repeat(1012) }).length === 1024, 'a line of 1024 characters is kept');
  ok(rec(mkst(2), { note: 'x'.repeat(1013) }) === null, 'a line of 1025 characters is dropped');
  const d = mkst(3), f = join(d, LOG); writeFileSync(f, 'y'.repeat(LOG_MAX - 1) + '\n'); record(d, { note: 'z' }); ok(statSync(f).size > LOG_MAX && readFileSync(f, 'utf8').startsWith('yyyy'), 'a log of exactly LOG_MAX bytes is not cut');
  const d2 = mkst(4), f2 = join(d2, LOG); let big = ''; for (let k = 0; k < 2700; k++) big += String(k).padStart(5, '0') + 'x'.repeat(94) + '\n'; writeFileSync(f2, big);
  record(d2, { note: 'new' }); const got = readFileSync(f2, 'utf8').split('\n');
  ok(got[0].startsWith('01351') && got.length === 1349 + 2 && got.at(-2) === '{"note":"new"}', `an over-long log loses its oldest half at a line start (first ${got[0].slice(0, 5)}, ${got.length} lines)`);
  const d3 = mkst(5), f3 = join(d3, LOG); writeFileSync(f3, 'x'.repeat(LOG_MAX + 1)); record(d3, { note: 'n' }); ok(readFileSync(f3, 'utf8') === '{"note":"n"}\n', 'an over-long log of one line is emptied'); }

{ const d = join(home, 'tally'), sh = sharedStore(), T1 = '2026-11-10T10:00:00.000Z', from = Date.parse(T1), iso = (ms) => new Date(from + ms).toISOString();
  mkdirSync(d); mkdirSync(sh, { recursive: true }); writeFileSync(join(d, 'a.md'), note(ADD)); writeFileSync(join(d, 'b.md'), note('enforce:\n  on: ls\n  has: x\n')); writeFileSync(join(sh, 's.md'), note(ADD));
  const e = (t, nt, agent = '') => JSON.stringify({ t, note: nt, agent }) + '\n';
  writeFileSync(join(d, LOG), e(iso(-1), 'a.md') + e(T1, 'a.md') + e(iso(5000), 'a.md', 'general-purpose') + e(iso(9000), 'a.md') + 'not json\n' + e(iso(7000), '_shared/s.md', 'x') + e(iso(8000), 'other.md'));
  const t = tally(d, from), by = Object.fromEntries(t.notes.map((n) => [n.file, n]));
  ok(t.notes.map((n) => n.file).join() === 'a.md,b.md,_shared/s.md', `tally lists the notes, then the shared ones (got ${t.notes.map((n) => n.file)})`);
  ok(by['a.md'].main === 2 && by['a.md'].sub === 1 && by['a.md'].last === from + 9000 && !by['a.md'].bad, `a.md: two main, one sub, last hit (got ${JSON.stringify(by['a.md'])})`);
  ok(by['b.md'].main === 0 && by['b.md'].sub === 0 && by['b.md'].last === 0 && by['b.md'].bad, 'a bad rule: no hits, last 0, its reason');
  ok(by['_shared/s.md'].main === 0 && by['_shared/s.md'].sub === 1 && by['_shared/s.md'].last === from + 7000, 'a shared rule counts its own hits');
  ok(tally(d, from + 5001).notes[0].main === 1 && tally(d, from + 5001).notes[0].sub === 0, 'hits before from are left out');
  ok(tally(join(home, 'nolog'), 0).notes.length === 1 && tally(sh, 0).notes.map((n) => n.file).join() === 's.md', 'no log: no hits; the shared store is not listed twice');
  rmSync(sh, { recursive: true }); }

console.log(`enforce: ${checks} checks passed`);
