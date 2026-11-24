// Self-check for memory.mjs, part 3 of 3: incognito, memory off and on, the search filters, enforce replay, and the edges the automatic mutants found.
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync, rmSync, symlinkSync, readdirSync, chmodSync, renameSync, statSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { ROOT, tool, tempHome, tempDir, capture } from './harness.mjs';

const CLI = tool('src/memory.mjs'), TIER = tool('src/memory-tier.mjs');
const { home, env } = tempHome('memcli-');
const root = join(home, '.claude', 'projects');
const dir = join(root, 'C--mem-cli', 'memory'), shared = join(root, '_shared', 'memory');
mkdirSync(dir, { recursive: true });
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
// Another session acts at one exact moment of a call: after the first time `kind` (an fs function) is called with
// a path `match` accepts, `act` runs, and the call goes on. This is how the "meanwhile" branches are reached.
const meanwhile = (kind, match, act) => {
  const real = fs[kind]; let done = false;
  fs[kind] = function (p, ...a) { const r = real.call(this, p, ...a); if (!done && match(String(p))) { done = true; act(); } return r; };
  syncBuiltinESMExports();
  return () => { fs[kind] = real; syncBuiltinESMExports(); };
};
// The CLI in this process: a process a call cost 0.2 s, and 256 calls were
// nearly all of the suite's 50 s (2026-10-30). What needs a process of its
// own (another cwd or PATH, a run through a symlink, a journal.mjs that will
// not load) still spawns one. Imported after tempHome: it names the live copy
// from HOME as it loads. Its output through harness.mjs's capture(), which
// sends it through UTF-8 as a process's reaches the reader.
const { main } = await import(pathToFileURL(CLI).href);
const run = async (args) => {
  try { const { out, value } = await capture(() => main(args)); return { status: value, stdout: out, stderr: '' }; }
  catch (e) { return { status: 1, stdout: '', stderr: String(e?.stack ?? e) }; }
};
const cli = (...args) => run([...args, ...(args.includes('--shared') ? [] : ['--store', dir])]);
const tenMin = new Date(Date.now() - 10 * 60000);
const memory = (d, name, desc, body = 'body', extra = '') => {
  writeFileSync(join(d, `${name}.md`), `---\nname: ${name}\ndescription: "${desc}"\nmetadata:\n  type: project\n${extra}---\n\n${body}\n`);
  utimesSync(join(d, `${name}.md`), tenMin, tenMin);
};

let r;
const tier = () => spawnSync(process.execPath, [TIER], { env, encoding: 'utf8' });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const installed = (id, at, source) => {
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { [id]: [{ installPath: at }] } }));
  writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ [id.split('@')[1]]: { source } }));
};
memory(dir, 'deploy-notes', 'deploy notes', 'deploy '.repeat(5));
memory(dir, 'release-checklist', 'steps before a deploy');
memory(dir, 'a-long-log', 'everything that happened', 'we did a deploy, then more steps, then a deploy and more steps');
memory(dir, 'mentions', 'unrelated', 'deploy once');
memory(dir, 'spam-log', 'unrelated chatter', 'deploy '.repeat(20));
memory(dir, 'old-thing', 'an archived deploy memory');
writeFileSync(join(dir, 'crlf-note.md'), '\uFEFF---\r\nname: crlf-note\r\ndescription: "windows line ends"\r\nmetadata:\r\n  type: project\r\n---\r\n\r\nbody [[ghost]] [[shared-rule]]\r\n');
memory(dir, 'bare', '', 'no description here');
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', '- [Deploy notes](deploy-notes.md) — deploy notes', '- [Release checklist](release-checklist.md) — steps',
  '- [Log](a-long-log.md) — log', '- [Mentions](mentions.md) — m', '- [Spam](spam-log.md) — s', '- [CRLF](crlf-note.md) — c', '- [Bare](bare.md) — b',
  '- [Archive](MEMORY-archive.md) — 1 older pointers'].join('\n') + '\n');
writeFileSync(join(dir, 'MEMORY-archive.md'), '# Archive\n\n- [Old](old-thing.md) — old\n');
mkdirSync(shared, { recursive: true });
memory(shared, 'shared-rule', 'stage files by name, never git add -A');
writeFileSync(join(shared, 'MEMORY.md'), '- [Shared rule](shared-rule.md) — stage files by name\n');
tier();


// 99. incognito, memory off and memory on.
{
  const proj = join(root, 'C--incog'), d = join(proj, 'memory'), cwd = 'C:\\incog';
  mkdirSync(d, { recursive: true });
  const SID = 'aaaaaaaa-1111', TID = 'bbbbbbbb-2222', UID = 'cccccccc-3333';
  const line = (type, text, c = cwd) => JSON.stringify({ type, cwd: c, timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text }] } });
  const turn = (id, ask, answer) => appendFileSync(join(proj, `${id}.jsonl`), `${line('user', ask)}\n${line('assistant', answer)}\n`);
  const stopOf = (id, event = 'Stop') => spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: id, transcript_path: join(proj, `${id}.jsonl`), hook_event_name: event }) });
  const everything = () => { let t = ''; for (const f of readdirSync(d, { recursive: true })) { try { t += `\n#${f}\n` + readFileSync(join(d, f), 'utf8'); } catch {} } return t; };
  const listing = () => readdirSync(d, { recursive: true }).sort().map((f) => `${f}:${statSync(join(d, f)).mtimeMs}`).join('|');
  turn(SID, 'tell me about narwhal tusks', 'a narwhal tusk is a tooth');
  turn(TID, 'tell me about otters', 'otters hold hands');
  ok(stopOf(SID).status === 0 && stopOf(TID).status === 0 && /narwhal/.test(everything()), 'before: both conversations are recorded');
  // Refused, and nothing written.
  const frozen = listing();
  for (const a of [[], ['--session', '../x'], ['--session', '${CLAUDE_SESSION_ID}'], ['--session', 'dddddddd-9999']]) {
    r = await run(['incognito', '--store', d, ...a]);
    ok(r.status === 1 && /incognito/.test(r.stdout) && listing() === frozen && !existsSync(join(d, '.private-sessions')), `incognito ${a.join(' ')} is refused and writes nothing (got ${r.status} ${r.stdout.trim()})`);
  }
  // A plugin's command is namespaced: there is no /incognito (defect hunt 1.4.3, L5-4).
  ok(/\/project-memory:incognito /.test((await run(['incognito', '--store', d])).stdout), 'a missing --session names the command that passes it: /project-memory:incognito');
  // A held lock: not applied, said so.
  mkdirSync(join(d, '.lock'));
  r = await run(['incognito', '--session', SID]);
  rmSync(join(d, '.lock'), { recursive: true });
  ok(r.status === 1 && /^incognito NOT applied/m.test(r.stdout) && !existsSync(join(d, '.private-sessions')), `a held lock: incognito NOT applied, exit 1, nothing marked (got ${r.stdout.trim()})`);
  r = await run(['incognito', '--session', SID]);
  ok(r.status === 0 && /Claude Code by default still keeps its own transcript/.test(r.stdout) && /its own auto memory may still save notes/.test(r.stdout)
    && /snapshots of days already over keep a copy/.test(r.stdout) && /save no note unless the user asks/.test(r.stdout), `incognito says what it does not cover (got ${r.stdout.trim()})`);
  ok(readFileSync(join(d, '.private-sessions'), 'utf8').includes('aaaaaaaa') && !/narwhal/.test(everything()) && /otters/.test(everything()), 'the turns so far are swept at once, the other conversation stays');
  turn(SID, 'and what about pelican beaks', 'a pelican beak holds water');
  ok(stopOf(SID).status === 0 && stopOf(SID, 'PreCompact').stdout === '' && !/narwhal|pelican/.test(everything()), 'the next Stop and a manual PreCompact in it record nothing');
  turn(TID, 'tell me about seals', 'seals bark');
  stopOf(TID);
  ok(/seals/.test(everything()) && !/narwhal|pelican/.test(everything()), 'another conversation\'s Stop does not bring it back');
  // A Stop in it still tiers and repairs the index; a note written in it is kept and indexed (known limit).
  writeFileSync(join(d, 'kept.md'), '---\nname: kept\ndescription: "kept note"\nmetadata:\n  type: project\n---\nbody\n');
  utimesSync(join(d, 'kept.md'), tenMin, tenMin);
  rmSync(join(d, 'MEMORY.md'), { force: true });
  stopOf(SID);
  ok(existsSync(join(d, 'MEMORY.md')) && /kept\.md/.test(readFileSync(join(d, 'MEMORY.md'), 'utf8')), 'a Stop in it still repairs the index, and a note written during it is indexed');
  r = await run(['search', 'seals', '--store', d]);
  ok(/seals/.test(r.stdout), 'search still finds earlier work');
  const start = spawnSync(process.execPath, [tool('src/handoff-log.mjs'), '--print'], { env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: UID, source: 'startup' }) }).stdout;
  ok(/seals/.test(start) && !/narwhal|pelican/.test(start), 'a startup after it still briefs, without it');

  // memory off / on.
  const ofd = join(root, 'C--off-cli', 'memory');
  const go = (...a) => run([...a, '--store', ofd]);
  r = await go('off');
  ok(r.status === 0 && existsSync(join(ofd, '.project-off')) && /Off stops adding; it doesn't hide/.test(r.stdout) && /Claude Code by default still keeps its own transcript/.test(r.stdout), `memory off with no store folder makes it and the marker (got ${r.stdout.trim()})`);
  r = await go('status');
  ok(/memory is off in this project since \d{4}-\d\d-\d\d; next: run memory on if the user asks to turn it back on/.test(r.stdout), `status prints the off line (got ${r.stdout})`);
  memory(ofd, 'findable', 'a findable thing about axolotls');
  ok(/findable/.test((await go('search', 'axolotls')).stdout), 'search still answers in an off project');
  ok(/memory is off in this project since/.test((await run(['doctor', '--store', ofd])).stdout), 'doctor prints the off line');
  writeFileSync(join(ofd, '.project-off'), 'garbage');
  ok(/since an unknown date/.test((await go('status')).stdout), 'a marker that does not read is off since an unknown date');
  // A conversation that ran while it was off is not imported into the journal once memory is on.
  const OC = 'C:\\off-cli', oproj = dirname(ofd), OID = 'eeeeeeee-4444';
  appendFileSync(join(oproj, `${OID}.jsonl`), `${line('user', 'a secret axolotl plan', OC)}\n${line('assistant', 'noted', OC)}\n`);
  // Old enough that a backfill would take it (a live one is left alone), but after the off time.
  writeFileSync(join(ofd, '.project-off'), JSON.stringify({ t: Date.now() - 3 * 864e5 }));
  utimesSync(join(oproj, `${OID}.jsonl`), new Date(Date.now() - 864e5), new Date(Date.now() - 864e5));
  // Asked in the very millisecond memory goes on: still while it was off (macOS CI, 2026-11-09).
  const realNow = Date.now, askedAt = Date.parse(JSON.parse(readFileSync(join(oproj, `${OID}.jsonl`), 'utf8').split('\n')[0]).timestamp);
  Date.now = () => askedAt;
  try { r = await go('on'); } finally { Date.now = realNow; }
  ok(r.status === 0 && !existsSync(join(ofd, '.project-off')) && /memory is on/.test(r.stdout), `memory on removes the marker (got ${r.stdout.trim()})`);
  appendFileSync(join(oproj, 'ffffffff-5555.jsonl'), `${line('user', 'after on', OC)}\n${line('assistant', 'fine', OC)}\n`);
  spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd: 'C:\\off-cli', session_id: 'ffffffff-5555', transcript_path: join(oproj, 'ffffffff-5555.jsonl'), hook_event_name: 'Stop' }) });
  ok(!/secret axolotl plan/.test(readdirSync(ofd, { recursive: true }).map((f) => { try { return readFileSync(join(ofd, f), 'utf8'); } catch { return ''; } }).join('\n')), 'a conversation from while it was off is not imported once it is on');
  r = await go('on');
  ok(r.status === 0 && /already on/.test(r.stdout), 'memory on when it is on says so');
  // One conversation across off and on: what it said before and after stays, what it said while off does not.
  {
    const sd = join(root, 'C--span', 'memory'), sproj = dirname(sd), SC = 'C:\\span', SPAN = '99999999-6666', t = join(sproj, `${SPAN}.jsonl`), now = Date.now();
    mkdirSync(sd, { recursive: true });
    const say = (ask, ago) => {
      const row = (type, text) => JSON.stringify({ type, cwd: SC, timestamp: new Date(now - ago).toISOString(), message: { content: [{ type: 'text', text }] } });
      appendFileSync(t, `${row('user', ask)}\n${row('assistant', 'noted')}\n`);
      return spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd: SC, session_id: SPAN, transcript_path: t, hook_event_name: 'Stop' }) });
    };
    const saved = () => readdirSync(sd, { recursive: true }).map((f) => { try { return readFileSync(join(sd, f), 'utf8'); } catch { return ''; } }).join('\n');
    say('span walrus before', 3 * 36e5);
    ok(/span walrus before/.test(saved()), 'spanning: the turn before off is saved');
    r = await run(['off', '--store', sd]);
    writeFileSync(join(sd, '.project-off'), JSON.stringify({ t: now - 2 * 36e5 }));
    say('span secret during', 36e5);
    r = await run(['on', '--store', sd]);
    // A minute ahead of `now`: on a slow machine `on` ran more than a second after `now`, the off period closed after this
    // turn's time, and the turn was rightly dropped as asked while off (2026-11-13).
    say('span walrus after', -60_000);
    const text = saved(), day = readdirSync(join(sd, 'journal')).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(sd, 'journal', f), 'utf8')).join('\n');
    ok(/span walrus before/.test(day), `spanning: the turn before off stays in the journal (got ${day.slice(0, 200)})`);
    ok(/span walrus after/.test(day), `spanning: the turn after on is journaled (got ${day.slice(0, 200)})`);
    ok(/span walrus after/.test(readFileSync(join(sd, 'handoff.md'), 'utf8')), 'spanning: the turn after on reaches handoff.md');
    ok(!/span secret during/.test(text), 'spanning: the turn while off is saved nowhere');
  }
  // A marker that cannot be removed: not applied, exit 1.
  writeFileSync(join(ofd, '.project-off'), '{}');
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (p, ...a) => { if (String(p).endsWith('.project-off')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return realUnlink(p, ...a); };
  syncBuiltinESMExports();
  try { r = await go('on'); } finally { fs.unlinkSync = realUnlink; syncBuiltinESMExports(); }
  ok(r.status === 1 && /memory on NOT applied/.test(r.stdout) && existsSync(join(ofd, '.project-off')), `a marker that cannot be removed: NOT applied, exit 1 (got ${r.stdout.trim()})`);
}

// Checked lessons: replay reads the project's transcripts of the last 30 days, the sub-agents' too, and writes nothing.
{
  const day = 86400000, at = (d) => new Date(Date.now() - d * day).toISOString();
  const tl = (command, d = 1, extra = {}) => JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: at(d), cwd: 'C:/enf/proj', sessionId: 'sess1234-aaaa',
    message: { content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: { command } }] }, ...extra }) + '\n';
  const proj = join(root, 'C--enf-proj'), other = join(root, 'C--enf-other'), pm = join(proj, 'memory');
  mkdirSync(join(proj, 'sess1234-aaaa', 'subagents'), { recursive: true }); mkdirSync(pm, { recursive: true }); mkdirSync(join(other, 'memory'), { recursive: true });
  const huge = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'git '.repeat(2300000) }] } }) + '\n';
  writeFileSync(join(proj, 'sess1234-aaaa.jsonl'), tl('git add -A') + tl('git add keep.txt') + tl('export API_TOKEN=supersecretvalue123 && git add -A') + tl('git add -A', 40) + huge + tl('cd x && git add --all   # sssss'));
  writeFileSync(join(proj, 'sess1234-aaaa', 'subagents', 'agent-1.jsonl'), tl('git add .', 2, { isSidechain: true, agentId: 'a1' }));
  writeFileSync(join(proj, 'oldsess0-bbbb.jsonl'), tl('git add -A', 32));
  const old = new Date(Date.now() - 32 * day); utimesSync(join(proj, 'oldsess0-bbbb.jsonl'), old, old);
  writeFileSync(join(other, 'othersess-cccc.jsonl'), tl('git add -A', 3, { cwd: 'C:/enf/other' }));
  const rule = '---\nname: Stage files by name\ndescription: Never run git add -A.\ntype: feedback\nenforce:\n  on: git add\n  has: [-A, --all, .]\n---\n\nbody\n';
  writeFileSync(join(pm, 'stage-by-name.md'), rule);
  const snap = () => JSON.stringify([pm, proj].map((d) => readdirSync(d).map((n) => [n, statSync(join(d, n)).mtimeMs])));
  const before = snap();
  r = await run(['enforce', 'replay', 'stage-by-name', '--store', pm]);
  const hitLines = r.stdout.split('\n').filter((l) => /\d{4}-\d\d-\d\d \d\d:\d\d/.test(l));
  ok(r.status === 0 && hitLines.length === 4, 'replay lists each hit once: 4 in the project (one a sub-agent), old ones not read (got ' + r.stdout + r.stderr + ')');
  ok(hitLines.filter((l) => /\[subagent\]/.test(l)).length === 1, 'the sub-agent hit is marked');
  ok(hitLines.some((l) => l.endsWith('git add --all # sssss')), 'a command is printed with its blanks collapsed and its letters kept');
  ok(!/supersecretvalue123/.test(r.stdout) && /sess1234/.test(r.stdout), 'a secret in a command is redacted, the session is named');
  ok(/checked 5 git commands/.test(r.stdout) && /5 are git add/.test(r.stdout) && /4 hits/.test(r.stdout) && /Read each hit\. A hit is a catch only if you agree the command broke the lesson\./.test(r.stdout), 'the summary counts commands, matches and hits (got ' + r.stdout + ')');
  ok(snap() === before, 'replay changes nothing');
  r = await run(['enforce', 'replay', 'stage-by-name.MD', '--store', pm]);
  ok(r.status === 0 && !/no note /.test(r.stdout), `a name typed with .MD is the note, not "stage-by-name.MD.md" (got ${r.stdout})`);
  r = await run(['enforce', 'replay', join(pm, 'stage-by-name.md'), '--all']);
  ok(r.status === 0 && /C--enf-other/.test(r.stdout) && /2 projects/.test(r.stdout), 'a path works, and --all reads every project (got ' + r.stdout + ')');
  // Private sessions and projects with memory off are not printed, even by --all.
  const priv = join(root, 'C--enf-priv'), offp = join(root, 'C--enf-off');
  mkdirSync(join(priv, 'memory'), { recursive: true }); mkdirSync(join(offp, 'memory'), { recursive: true });
  writeFileSync(join(priv, 'memory', '.private-sessions'), 'hushed01\n');
  writeFileSync(join(priv, 'hushed01-aaaa.jsonl'), tl('git add -A # hushedcmd'));
  writeFileSync(join(priv, 'public01-bbbb.jsonl'), tl('git add -A # publiccmd'));
  writeFileSync(join(offp, 'memory', '.project-off'), '{}');
  writeFileSync(join(offp, 'offsess1-cccc.jsonl'), tl('git add -A # offcmd'));
  r = await run(['enforce', 'replay', join(pm, 'stage-by-name.md'), '--all']);
  ok(/publiccmd/.test(r.stdout) && !/hushedcmd|offcmd/.test(r.stdout), 'a private session and a project with memory off are skipped (got ' + r.stdout + ')');
  rmSync(priv, { recursive: true }); rmSync(offp, { recursive: true });
  writeFileSync(join(home, 'rule.md'), rule); renameSync(root, root + '.bak');
  try { r = await run(['enforce', 'replay', join(home, 'rule.md'), '--all']); } finally { renameSync(root + '.bak', root); }
  ok(r.status === 1 && /no projects folder/.test(r.stdout), 'no projects folder: one line, exit 1 (got ' + r.stdout + r.stderr + ')');
  writeFileSync(join(pm, 'bad.md'), rule.replace('on: git add', 'on: npm i'));
  r = await run(['enforce', 'replay', 'bad', '--store', pm]);
  ok(r.status === 1 && /must start with git/.test(r.stdout), 'a bad rule prints its reason and exits 1');
  r = await run(['enforce', 'replay', 'nothere', '--store', pm]);
  ok(r.status === 1 && /no note/.test(r.stdout), 'a missing note exits 1');
  writeFileSync(join(pm, 'plain.md'), '---\nname: plain\n---\n\nbody\n');
  r = await run(['enforce', 'replay', 'plain', '--store', pm]);
  ok(r.status === 1 && /no enforce/.test(r.stdout), 'a note with no rule says so');
  // A journal.mjs that will not load: replay says so on one line and exits 1 (it threw a TypeError).
  const nj = join(home, 'cli-nojournal');
  mkdirSync(nj, { recursive: true });
  for (const f of ['memory.mjs', 'recall.mjs', 'page.mjs', 'store.mjs', 'timing.mjs', 'handoff-log.mjs', 'enforce.mjs', 'compact-gate.mjs']) writeFileSync(join(nj, f), readFileSync(tool(`src/${f}`)));
  writeFileSync(join(nj, 'journal.mjs'), 'this is not javascript (');
  r = spawnSync(process.execPath, [join(nj, 'memory.mjs'), 'enforce', 'replay', 'stage-by-name', '--store', pm], { env, encoding: 'utf8' });
  ok(r.status === 1 && /replay needs journal\.mjs/.test(r.stdout) && !/TypeError/.test(r.stderr), `replay with a journal.mjs that will not load says so (got ${r.status} ${r.stdout}${r.stderr})`);
  r = await run(['enforce']);
  ok(r.status === 1 && /replay/.test(r.stdout), 'enforce alone prints the usage');

  // status: per rule note, the hits of the last 30 days from the live log (main and sub-agent), bad rules with their reason.
  rmSync(join(pm, 'plain.md'));
  writeFileSync(join(pm, 'quiet-rule.md'), rule.replace('Stage files by name', 'Quiet'));
  const logLine = (note, d, agent = '') => JSON.stringify({ t: at(d), note, s: 'sess1234', agent, id: 'tu' }) + '\n';
  writeFileSync(join(pm, '.enforce-log'), logLine('stage-by-name.md', 1) + logLine('stage-by-name.md', 3) + logLine('stage-by-name.md', 2, 'Explore') + logLine('stage-by-name.md', 40) + 'garbage\n' + logLine('gone.md', 1));
  r = await run(['enforce', 'status', '--store', pm]);
  const st = r.stdout.trim().split('\n');
  ok(r.status === 0 && st.some((l) => /^stage-by-name\.md +3 hits in 30 days \(2 main, 1 subagent\), last \d{4}-\d\d-\d\d \d\d:\d\d$/.test(l)), `status counts the hits of the last 30 days, main and sub-agent (got ${r.stdout})`);
  ok(st.some((l) => /^quiet-rule\.md +no hits in 30 days$/.test(l)) && !/gone\.md/.test(r.stdout), 'a rule with no hits says so, and a log line of a note with no rule is not listed');
  ok(st.some((l) => /^bad\.md +bad rule: .*must start with git/.test(l)), 'a bad rule is listed with its reason');
  ok(st.at(-1) === 'To see the commands, run `memory enforce replay <note>`.', 'the last line points to replay');
  ok(!/log full|paused/.test(r.stdout), 'no warning when the log is small and memory is on');
  const shared = join(root, '_shared', 'memory');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'all-projects.md'), rule.replace('Stage files by name', 'Shared'));
  appendFileSync(join(pm, '.enforce-log'), logLine('_shared/all-projects.md', 1));
  r = await run(['enforce', 'status', '--store', pm]);
  ok(/^_shared\/all-projects\.md +1 hit in 30 days \(1 main, 0 subagent\)/m.test(r.stdout), `a rule of the shared store is listed as _shared/<file> (got ${r.stdout})`);
  rmSync(join(shared, 'all-projects.md'));
  rmSync(join(pm, '.enforce-log'));
  r = await run(['enforce', 'status', '--store', pm]);
  ok(r.status === 0 && /^stage-by-name\.md +no hits in 30 days$/m.test(r.stdout), 'no log at all: no hits, no crash');
  writeFileSync(join(pm, '.project-off'), '{}');
  r = await run(['enforce', 'status', '--store', pm]);
  ok(/memory is off here: watch is paused/.test(r.stdout) && /stage-by-name\.md/.test(r.stdout), `memory off is said, the rules still listed (got ${r.stdout})`);
  rmSync(join(pm, '.project-off'));
  for (const f of ['bad.md', 'quiet-rule.md', 'stage-by-name.md']) rmSync(join(pm, f));
  r = await run(['enforce', 'status', '--store', pm]);
  ok(r.status === 0 && /no enforce: rules/.test(r.stdout), `a store with no rule says so (got ${r.stdout})`);

  // doctor: one line for the enforce hook of the plugin copy that runs, even when memory is off.
  const efHome = join(home, '.claude', 'plugins', 'cache', 'ef', '1.4.0');
  mkdirSync(join(efHome, 'hooks'), { recursive: true }); mkdirSync(join(efHome, 'src'));
  const EF = ['enforce-hook.mjs', 'enforce.mjs', 'store.mjs', 'timing.mjs', 'handoff-log.mjs'];
  for (const f of EF) writeFileSync(join(efHome, 'src', f), readFileSync(tool(`src/${f}`)));
  writeFileSync(join(efHome, 'hooks', 'hooks.json'), readFileSync(join(ROOT, 'hooks', 'hooks.json')));
  installed('project-memory@project-memory', efHome, { source: 'github', repo: 'zdraveski/project-memory' });
  const doc = async () => (await cli('doctor')).stdout;
  ok(/^ok +the enforce hook runs and is wired \(PreToolUse\)/m.test(await doc()), `doctor: a good copy passes (got ${await doc()})`);
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { ok(/^ok +the enforce hook runs/m.test(await doc()), 'doctor: the line shows when memory is off'); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  const hookFile = join(efHome, 'src', 'enforce-hook.mjs'), good = readFileSync(hookFile);
  writeFileSync(hookFile, 'process.exitCode = 1;\n');
  ok(/^PROBLEM [^\n]*enforce hook[^\n]*exit code 1/m.test(await doc()), 'doctor: a hook that exits 1 is a problem');
  writeFileSync(hookFile, "console.log('allow');\n");
  ok(/^PROBLEM [^\n]*enforce hook[^\n]*printed/m.test(await doc()), 'doctor: a hook that prints is a problem');
  rmSync(hookFile);
  ok(/^PROBLEM [^\n]*enforce-hook\.mjs is missing/m.test(await doc()), 'doctor: a missing hook file is a problem');
  writeFileSync(hookFile, good);
  const hj = join(efHome, 'hooks', 'hooks.json'), hjText = readFileSync(hj, 'utf8');
  writeFileSync(hj, JSON.stringify({ hooks: { Stop: [] } }));
  ok(/^PROBLEM [^\n]*no PreToolUse group/m.test(await doc()), 'doctor: hooks.json without the PreToolUse group is a problem');
  writeFileSync(hj, JSON.stringify({ hooks: { Stop: [], PreToolUse: [{}] } }));
  ok(/^PROBLEM [^\n]*no SubagentStop group/m.test(await doc()), 'doctor: hooks.json without the SubagentStop group is a problem');
  writeFileSync(hj, hjText);
}

// 1.5.3 holes: replay's 30-day window to the millisecond, its order, the files it reads and what it prints.
{
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 30);
  const day = 86400000, ago = (d) => Date.now() - d * day;
  const tl = (command, t) => JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: new Date(t).toISOString(), cwd: 'C:/rp/proj', sessionId: 'rp123456-aaaa',
    message: { content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: { command } }] } }) + '\n';
  const proj = join(root, 'C--rp-proj'), pm = join(proj, 'memory'), sh = join(root, '_shared');
  mkdirSync(pm, { recursive: true }); mkdirSync(sh, { recursive: true });
  const rule = '---\nname: Stage files by name\ndescription: Never run git add -A.\ntype: feedback\nenforce:\n  on: git add\n  has: [-A, --all, .]\n---\n\nbody\n';
  writeFileSync(join(pm, 'stage.md'), rule);
  // The first moment of the window is in, a millisecond before it is out, and a file last written at that moment is read.
  writeFileSync(join(proj, 'edge.jsonl'), tl('git add -A # atedge', from.getTime()) + tl('git add -A # justbefore', from.getTime() - 1));
  utimesSync(join(proj, 'edge.jsonl'), from, from);
  // Written newest first: the listing is oldest first.
  writeFileSync(join(proj, 'order.jsonl'), tl('git add -A # third', ago(1)) + tl('git add -A # first', ago(5)) + tl('git add -A # second', ago(3)));
  // A line longer than the 8 MB read is passed over, the line after it is read.
  writeFileSync(join(proj, 'big.jsonl'), tl('git add -A # bigline ' + 'x'.repeat(8.5 * 1048576), ago(2)) + tl('git add -A # afterbig', ago(2)));
  // Not transcripts: a file of another kind, a folder named like one, and the shared store's folder.
  writeFileSync(join(proj, 'notes.txt'), tl('git add -A # nottranscript', ago(1)));
  mkdirSync(join(proj, 'folder.jsonl'));
  mkdirSync(join(sh, 'memory'), { recursive: true }); writeFileSync(join(sh, 'shared01-aaaa.jsonl'), tl('git add -A # sharedcmd', ago(1)));
  const go = (...a) => run(['enforce', 'replay', 'stage', '--store', pm, ...a]);
  r = await go();
  const lines = r.stdout.split('\n').filter((l) => /\d{4}-\d\d-\d\d \d\d:\d\d/.test(l)), tags = lines.map((l) => l.match(/# (\w+)/)?.[1]);
  ok(r.status === 0 && tags.join() === 'atedge,first,second,afterbig,third', `replay prints the hits oldest first, the window's first moment in, the moment before out, a line past 8 MB passed over (got ${tags} ${r.stdout.slice(-300)}${r.stderr})`);
  ok(!/nottranscript/.test(r.stdout) && !/could not read/.test(r.stdout), 'a file that is not a .jsonl is not read, a folder named like one is no failure');
  ok(/^hits by project: .* 5$/m.test(r.stdout) && /5 hits in 3 sessions, 1 project/.test(r.stdout), `hits by project counts one by one (got ${r.stdout.slice(-300)})`);
  r = await go('--all');
  ok(!/sharedcmd/.test(r.stdout), '--all does not read the shared store folder');
  // The spawned CLI has no terminal: nothing on stderr.
  const sp = spawnSync(process.execPath, [CLI, 'enforce', 'replay', 'stage', '--store', pm, '--all'], { env, encoding: 'utf8' });
  ok(sp.status === 0 && sp.stderr === '', `replay writes no progress to a stderr that is no terminal (got ${sp.stderr})`);
  // A transcript that goes away while it is read is named, not skipped in silence.
  const gone = join(proj, 'gone.jsonl'); writeFileSync(gone, tl('git add -A # gonecmd', ago(1)));
  mkdirSync(join(proj, 'rpsess', 'subagents'), { recursive: true });
  const undo = meanwhile('readdirSync', (p) => /subagents$/.test(p), () => rmSync(gone));
  try { r = await go(); } finally { undo(); }
  ok(/^could not read .*gone\.jsonl: ENOENT$/m.test(r.stdout), `a transcript that vanished is reported (got ${r.stdout.slice(-300)})`);
  // What is not asked for: no words after replay, another word before them, a path that is no note.
  r = await run(['enforce', 'replay', '--store', pm]);
  ok(r.status === 1 && /enforce takes status, or replay/.test(r.stdout), 'replay with no note is the usage');
  r = await run(['enforce', 'bogus', 'stage', '--store', pm]);
  ok(r.status === 1 && /enforce takes status, or replay/.test(r.stdout), 'enforce with another word is the usage');
  const nowhere = join(home, 'nowhere');
  r = await run(['enforce', 'replay', join(nowhere, 'stage.md'), '--store', pm]);
  ok(r.status === 0 && /checked \d+ git commands/.test(r.stdout), `a .md path that is not there falls back to the note of that name in the store (got ${r.stdout.slice(-200)})`);
  mkdirSync(join(nowhere, 'dir.md'), { recursive: true }); writeFileSync(join(nowhere, 'plain'), rule);
  r = await run(['enforce', 'replay', join(nowhere, 'dir.md'), '--store', pm]);
  ok(r.status === 1 && /no note/.test(r.stdout), `a folder named like a note is no note (got ${r.stdout})`);
  r = await run(['enforce', 'replay', join(nowhere, 'plain'), '--store', pm]);
  ok(r.status === 1 && /no note/.test(r.stdout), `a path with no .md is looked up as a note name, not read (got ${r.stdout})`);
  // status counts back to the same moment: a log line at it is in, one a millisecond before is out.
  writeFileSync(join(pm, '.enforce-log'), JSON.stringify({ t: from.toISOString(), note: 'stage.md', s: 'rp', agent: '', id: 'a' }) + '\n' + JSON.stringify({ t: new Date(from.getTime() - 1).toISOString(), note: 'stage.md', s: 'rp', agent: '', id: 'b' }) + '\n');
  r = await run(['enforce', 'status', '--store', pm]);
  ok(/^stage\.md +1 hit in 30 days \(1 main, 0 subagent\)/m.test(r.stdout), `status counts from the window's first moment (got ${r.stdout})`);
}

// Fake secrets, built from pieces so no scanner sees a literal.
const GH = ['gh', 'p_', 'Zq8Xk2Lm4Nv6Bt1Rw3Ys5Df7Gh9Jk0Pa2Cd4'].join(''), PW = ['Zx9', 'Qv', '7!', 'mT3', 'kLp'].join('');
// Secrets in a note (1.4.1 J): promote refuses it, search and status print no secret from names or links.
{
  const sd = join(root, 'C--mem-secret', 'memory'); mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'lesson.md'), `---
name: lesson
description: "deploy"
metadata:
  type: project
---
Token ${GH}
password: ${PW}
See [[nonexist-${GH}]]
`);
  writeFileSync(join(sd, `token-${GH}.md`), 'no frontmatter\n');
  writeFileSync(join(sd, 'MEMORY.md'), `# Index

- [lesson](lesson.md) deploy
`);
  let r = await run(['promote', 'lesson', '--store', sd]);
  ok(r.status === 1 && !existsSync(join(shared, 'lesson.md')) && existsSync(join(sd, 'lesson.md')) && /nothing moved/.test(r.stdout), 'promote refuses a note that holds a secret');
  for (const a of [['search', 'deploy'], ['status'], ['status', '--all']]) {
    r = await run([...a, '--store', sd]);
    ok(!(r.stdout + r.stderr).includes(GH), `memory ${a.join(' ')} prints no token from a name or link`);
  }
  for (const a of [['history', `token-${GH}`], ['restore', `token-${GH}`], ['promote', `token-${GH}`]]) {
    r = await run([...a, '--store', sd]);
    ok(!(r.stdout + r.stderr).includes(GH), `memory ${a[0]} of a note named with a token prints no token`);
  }
  r = await run(['promote', 'lesson', '--force', '--store', sd]);
  ok(r.status === 0 && existsSync(join(shared, 'lesson.md')), 'promote --force copies it anyway');
  // The <private> tag alone is no secret; a password wrapped in it still is (defect hunt 1.4.3, L3-3).
  writeFileSync(join(sd, 'tag-howto.md'), '---\nname: tag-howto\ndescription: "t"\n---\nWrap a secret in <private>...</private> and it is not saved.\n');
  writeFileSync(join(sd, 'tag-pass.md'), '---\nname: tag-pass\ndescription: "t"\n---\npassword: <private>hunter2xx</private>\n');
  r = await run(['promote', 'tag-howto', '--store', sd]);
  ok(r.status === 0 && existsSync(join(shared, 'tag-howto.md')), `promote moves a note that mentions the <private> tag (got ${r.stdout.trim()})`);
  r = await run(['promote', 'tag-pass', '--store', sd]);
  { const pin = join(sd, 'tag-pin.md'); writeFileSync(pin, '---\nname: tag-pin\ndescription: "t"\n---\nOffice alarm code: <private>4821</private>\n');
    const p = await run(['promote', 'tag-pin', '--store', sd]);
    ok(!existsSync(join(shared, 'tag-pin.md')), `promote refuses a note with a word the rules miss wrapped in <private> (got ${p.stdout.trim()})`); }
  ok(r.status === 1 && /nothing moved/.test(r.stdout) && !existsSync(join(shared, 'tag-pass.md')), `promote refuses a password wrapped in the <private> tag (got ${r.stdout.trim()})`);
}

// forget --purge: the finished day is in the snapshots; --yes alone leaves it there, --purge drops it from every commit.
{
  const { render } = await import('../src/journal.mjs');
  const pd = join(root, 'C--purge', 'memory'), word = 'zebrafish-' + 'purge';
  mkdirSync(join(pd, 'journal'), { recursive: true });
  const e = { key: 'pk1', at: '2020-01-02 10:00', s: 'c0ffee12', t: 'C--purge/c0ffee12-full', branch: 'main', asked: `remember ${word}`, answered: 'noted', changed: [], ran: [] };
  const writeDay = () => writeFileSync(join(pd, 'journal', '2020-01-02.md'), `# Journal 2020-01-02\n\n${render(e)}\n`);
  writeDay();
  writeFileSync(join(pd, 'MEMORY.md'), '# Memory Index\n');
  tier(); tier();
  const held = () => spawnSync('git', ['-C', root, 'log', '--all', '-S' + word, '--format=%H'], { encoding: 'utf8' }).stdout.trim() !== '';
  ok(held(), 'fixture: the snapshots hold the finished day');
  let r = await run(['forget', word, '--yes', '--store', pd]);
  ok(/removed 1/.test(r.stdout) && held(), 'forget --yes alone leaves the snapshot history');
  // A narrowed forget that matches nothing purges nothing: the range must not widen into every day holding the word (1.4.3 review).
  r = await run(['forget', word, '--until', '2019-12-31', '--yes', '--purge', '--store', pd]);
  ok(/nothing in .* matches/.test(r.stdout) && !/purged/.test(r.stdout) && held(), `forget --purge with a range that matches nothing purges nothing (got ${r.stdout})`);
  // The hint's own next step: the entry is gone from the journal now, yet --purge still finds the day in the snapshots (defect hunt 1.4.3, L3-2),
  // in another case too, as forget itself matches.
  r = await run(['forget', word.toUpperCase(), '--yes', '--purge', '--store', pd]);
  ok(/purged the journal of 2020-01-02/.test(r.stdout) && !/nothing in/.test(r.stdout) && !held(), `forget --purge after a plain forget still drops it from the history (got ${r.stdout})`);
  writeDay(); tier(); tier();
  r = await run(['forget', word, '--yes', '--store', pd]);
  writeDay();
  r = await run(['forget', word, '--yes', '--purge', '--store', pd]);
  ok(/removed 1/.test(r.stdout) && /purged from the snapshots/.test(r.stdout) && !held(), `forget --purge drops it from the history (got ${r.stdout})`);
  ok(spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).status === 0 && !existsSync(join(root, '.git', 'refs', 'original')), 'the purge leaves a working repository and no backup refs');
  ok(!existsSync(join(root, '.git', 'config.lock')), 'the purge frees its lock when done');
  // 1.5.1 finding 6: the history copy sits inside the snapshot repo's .git (a snapshot never commits it), not in the OS temp folder.
  {
    writeDay(); tier(); tier();
    // 1.5.1 finding 8: a purge killed earlier left its full-history copy in .git; the next one removes it.
    const stale = join(root, '.git', 'pm-purge-stale'); mkdirSync(join(stale, 'copy.git'), { recursive: true });
    const made = [], realMk = fs.mkdtempSync;
    fs.mkdtempSync = (...a) => { const d = realMk(...a); made.push(d); return d; };
    syncBuiltinESMExports();
    try { r = await run(['forget', word, '--yes', '--purge', '--store', pd]); } finally { fs.mkdtempSync = realMk; syncBuiltinESMExports(); }
    const where = made.filter((d) => /pm-purge-/.test(d));
    ok(/purged from the snapshots/.test(r.stdout) && where.length === 1 && where[0].replace(/\\/g, '/').startsWith(join(root, '.git').replace(/\\/g, '/') + '/') && !existsSync(where[0]), `the purge's history copy lives under the snapshot repo's .git and is gone after (got ${where} ${r.stdout})`);
    ok(!existsSync(stale), 'a purge removes a pm-purge copy an earlier killed one left');
  }
  // A snapshot in flight (git's own lock, fresh): the purge would overwrite its commit, so it refuses and changes nothing.
  writeDay(); tier();
  writeFileSync(join(root, '.git', 'config.lock'), '');
  r = await run(['forget', word, '--yes', '--purge', '--store', pd]);
  ok(/could not be purged/.test(r.stdout) && /snapshot/.test(r.stdout) && existsSync(join(root, '.git', 'config.lock')), `forget --purge refuses while a snapshot holds the repository (got ${r.stdout})`);
  unlinkSync(join(root, '.git', 'config.lock'));
  ok(/still hold/.test(r.stdout) && /--purge/.test(r.stdout), `a failed purge says the snapshots still hold the text and what to run (got ${r.stdout})`);
}

// git writes a path with bytes past ASCII as "..." with octal escapes (a store folder named with an accent): the purge reads them back.
{
  const { render } = await import('../src/journal.mjs');
  const pd = join(root, 'C--pürge', 'memory'), word = 'okapi-' + 'quoted';
  mkdirSync(join(pd, 'journal'), { recursive: true });
  const e = { key: 'pk2', at: '2020-01-03 10:00', s: 'c0ffee13', t: 'C--pürge/c0ffee13-full', branch: 'main', asked: `remember ${word}`, answered: 'noted', changed: [], ran: [] };
  writeFileSync(join(pd, 'journal', '2020-01-03.md'), `# Journal 2020-01-03\n\n${render(e)}\n`);
  writeFileSync(join(pd, 'MEMORY.md'), '# Memory Index\n');
  tier(); tier();
  const held = () => spawnSync('git', ['-C', root, 'log', '--all', '-S' + word, '--format=%H'], { encoding: 'utf8' }).stdout.trim() !== '';
  ok(held(), 'fixture: the snapshots hold the day of a store with an accent in its name');
  const r = await run(['forget', word, '--yes', '--purge', '--store', pd]);
  ok(/purged from the snapshots/.test(r.stdout) && !held(), `forget --purge drops a day whose path git wrote with octal escapes (got ${r.stdout})`);
}

// 1.5.2 finding 3: the purge rewrites a long history in one stream, not one shell and one git rm per commit (0.7 s each: 507 s for 709).
{
  const ld = join(root, 'C--purgelong', 'memory'), word = 'quokka-' + 'purgelong', day = 'C--purgelong/memory/journal/2020-03-04.md', keep = 'C--purgelong/memory/keep.md';
  mkdirSync(join(ld, 'journal'), { recursive: true });
  writeFileSync(join(ld, 'MEMORY.md'), '# Memory Index\n');
  tier(); tier();
  const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const N = 500;
  let s = '';
  for (let i = 0; i < N; i++) {
    const body = (b) => `data ${Buffer.byteLength(b)}\n${b}\n`;
    s += `commit refs/heads/${branch}\ncommitter t <t@t> ${1600000000 + i} +0000\n${body('c' + i)}${i ? '' : `from refs/heads/${branch}^0\n`}`
      + `M 100644 inline ${keep}\n${body('keep ' + i)}` + (i < N - 5 ? `M 100644 inline ${day}\n${body(`# Journal\n${word} ${i}`)}` : `D ${day}\n`) + '\n';
  }
  const imp = spawnSync('git', ['-C', root, 'fast-import', '--quiet'], { input: s });
  ok(imp.status === 0, `fixture: ${N} snapshot commits imported (${imp.stderr})`);
  const hold = () => spawnSync('git', ['-C', root, 'log', '--all', '-S' + word, '--format=%H'], { encoding: 'utf8' }).stdout.trim() !== '';
  const count = () => spawnSync('git', ['-C', root, 'rev-list', '--count', '--all'], { encoding: 'utf8' }).stdout.trim();
  const before = count();
  ok(hold(), 'fixture: the long history holds the word');
  writeFileSync(join(ld, 'journal', '2020-03-04.md'), `# Journal 2020-03-04\n\n${word}\n`);
  const t0 = Date.now(), r = await run(['forget', word, '--yes', '--purge', '--store', ld]);
  ok(/purged the journal of 2020-03-04/.test(r.stdout) && !hold() && count() === before, `forget --purge cleans every commit of a long history and keeps the commits (got ${r.stdout})`);
  ok(spawnSync('git', ['-C', root, 'log', '--all', '--format=', '--name-only', '--', keep], { encoding: 'utf8' }).stdout.trim().split('\n').length >= N, 'the other files keep their history');
  ok(Date.now() - t0 < 30_000, `${N} commits are purged in one pass, not one git rm each (took ${Date.now() - t0} ms)`);
}

// rescan: a secret saved before a rule existed is found in the files and the snapshots; the dry run prints counts, never the value;
// --apply needs --yes; --apply --yes backs up, redacts the files, and rewrites the history so no snapshot holds it.
{
  const rd = join(root, 'C--rescan', 'memory'), key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  mkdirSync(join(rd, 'journal'), { recursive: true });
  writeFileSync(join(rd, 'MEMORY.md'), '# Memory Index\n');
  writeFileSync(join(rd, 'old.md'), `---\nname: old\n---\nthe token was ${key} then\npassword=***REMOVED*** stays\n`);
  writeFileSync(join(rd, 'journal', '2020-02-03.md'), `# Journal 2020-02-03\n\nran with ${key}\n`);
  tier(); tier();
  // restore keeps a replaced note under a ref that names a blob
  const blob = spawnSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: `old note ${key}
`, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['-C', root, 'update-ref', 'refs/project-memory/replaced/lab', blob]);
  const kept = () => spawnSync('git', ['-C', root, 'cat-file', 'blob', 'refs/project-memory/replaced/lab'], { encoding: 'utf8' }).stdout;
  const held = () => spawnSync('git', ['-C', root, 'log', '--all', '-S' + key, '--format=%H'], { encoding: 'utf8' }).stdout.trim() !== '';
  const head = () => spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  ok(held(), 'fixture: the snapshots hold the key');
  const before = head();
  let r = await run(['rescan']);
  ok(r.status === 0 && r.stdout.includes('C--rescan/memory/old.md (1)') && r.stdout.includes('C--rescan/memory/journal/2020-02-03.md (1)') && /snapshots: \d+ secrets? in \d+ saved versions?/.test(r.stdout) && !r.stdout.includes(key) && held() && readFileSync(join(rd, 'old.md'), 'utf8').includes(key), `rescan prints counts and places, never the value, and changes nothing (got ${r.stdout}${r.stderr.slice(0, 400)})`);
  r = await run(['rescan', '--apply']);
  ok(/revoke or rotate/.test(r.stdout) && /still holds the secrets/.test(r.stdout) && /add --yes/.test(r.stdout) && held() && head() === before && !readdirSync(join(home, '.claude')).some((n) => n.startsWith('project-memory-rescan-backup')), `rescan --apply alone only says what it would do (got ${r.stdout})`);
  r = await run(['rescan', '--apply', '--yes']);
  // A git of the snapshots still finishing (Windows CI, 2026-11-24) makes rescan refuse, as it should: once more after it lets go.
  if (/a snapshot is being taken/.test(r.stderr)) { await new Promise((ok) => setTimeout(ok, 3000)); r = await run(['rescan', '--apply', '--yes']); }
  const bk = readdirSync(join(home, '.claude')).find((n) => n.startsWith('project-memory-rescan-backup'));
  ok(r.status === 0 && bk && /the snapshots hold none now/.test(r.stdout) && !r.stdout.includes(key), `rescan --apply --yes redacts (got ${r.stdout}${r.stderr.slice(0, 400)})`);
  const old = readFileSync(join(rd, 'old.md'), 'utf8');
  ok(!old.includes(key) && old.includes('[redacted]') && old.includes('password=[redacted] stays') && !held() && head() !== before && !kept().includes(key) && kept().includes('[redacted]'), 'the file, every snapshot and the kept copy lose the key; the history has new IDs');
  ok(readFileSync(join(home, '.claude', bk, 'files', 'C--rescan', 'memory', 'old.md'), 'utf8').includes(key) && existsSync(join(home, '.claude', bk, 'snapshots.bundle')), 'the backup holds the old file and a bundle of the old history');
  ok(spawnSync('git', ['-C', root, 'fsck', '--no-dangling'], { encoding: 'utf8' }).status === 0 && !existsSync(join(root, '.git', 'refs', 'original')) && !existsSync(join(root, '.git', 'config.lock')), 'the history is sound and the lock is freed');
  r = await run(['rescan']);
  ok(/nothing found; nothing changed/.test(r.stdout), `a second run finds nothing (got ${r.stdout})`);
  // 1.5.1 finding 1: a store holding only markers (old or new) is clean, on the first run and the second.
  const md = join(root, 'C--rescan-marks', 'memory');
  mkdirSync(md, { recursive: true });
  writeFileSync(join(md, 'MEMORY.md'), '# Memory Index\n');
  writeFileSync(join(md, 'marks.md'), '---\nname: marks\n---\nAPI_KEY=[redacted]\nexport DB_PASSWORD=[redacted]\ncurl -u admin:[redacted]\npostgres://u:[redacted]@h/db\nAPI_KEY=***REMOVED***\n');
  for (const n of [1, 2]) { r = await run(['rescan']); ok(/nothing found; nothing changed/.test(r.stdout), `markers alone are no finding, run ${n} (got ${r.stdout})`); }
  rmSync(join(root, 'C--rescan-marks'), { recursive: true });
  // a busy snapshot lock: a clean line, exit 1, nothing changed, no backup made
  writeFileSync(join(rd, 'handoff.md'), `handoff ${key}
`);
  writeFileSync(join(root, '.git', 'config.lock'), '');
  const nb = () => readdirSync(join(home, '.claude')).filter((n) => n.startsWith('project-memory-rescan-backup')).length;
  r = await run(['rescan', '--apply', '--yes']);
  ok(r.status === 1 && /snapshot is being taken/.test(r.stdout) && !/at .*memory\.mjs:\d+/.test(r.stderr) && nb() === 1 && readFileSync(join(rd, 'handoff.md'), 'utf8').includes(key), `rescan --apply --yes with a busy lock stops cleanly (got ${r.stdout}${r.stderr.slice(0, 300)})`);
  unlinkSync(join(root, '.git', 'config.lock'));
  r = await run(['rescan', '--apply', '--yes']);
  ok(r.status === 0 && !readFileSync(join(rd, 'handoff.md'), 'utf8').includes(key) && /backup: /.test(r.stdout), `a secret in handoff.md is redacted (got ${r.stdout})`);
  const nb2 = nb();
  r = await run(['rescan', '--apply', '--yes']);
  ok(/nothing found/.test(r.stdout) && nb() === nb2, 'a clean store makes no backup');
  // 1.5.1 finding 2: handoff.md.prev, the copy beside handoff.md, is counted by the dry run and cleaned by --apply --yes.
  writeFileSync(join(rd, 'handoff.md.prev'), `old handoff ${key}\n`);
  r = await run(['rescan']);
  ok(r.stdout.includes('C--rescan/memory/handoff.md.prev (1)') && !r.stdout.includes(key), `the dry run counts a secret in handoff.md.prev (got ${r.stdout})`);
  r = await run(['rescan', '--apply', '--yes']);
  ok(r.status === 0 && !readFileSync(join(rd, 'handoff.md.prev'), 'utf8').includes(key) && readFileSync(join(rd, 'handoff.md.prev'), 'utf8').includes('[redacted]'), `--apply --yes redacts handoff.md.prev (got ${r.stdout})`);
}

// 1.5.0 P39: the skill's description makes Claude search before answering, relative dates included.
{
  const d = readFileSync(new URL('../skills/memory/SKILL.md', import.meta.url), 'utf8').match(/^description: (.*)$/m)[1];
  ok(/before answering/i.test(d) && /last week/.test(d) && /earlier work/.test(d), `the skill description names answering and relative dates (got ${d})`);
}

// 1.5.3 holes: word forms, edge by edge (each word picked so one rule of cutEn/starts/stem is the only thing that finds or misses it).
{
  const sd = join(root, 'C--stem', 'memory'); mkdirSync(sd, { recursive: true });
  const bodies = ['tsking', 'tsked', 'acted', 'gas', 'statue', 'status', 'sadness', 'sadly', 'nickname', 'nicely', 'managing', 'manatee', 'management', 'printer',
    'компас', 'компјутер', 'она'];
  bodies.forEach((b, i) => memory(sd, `stem-${String(i).padStart(2, '0')}`, 'word', b));
  const found = async (q) => { const r = await run(['search', q, '--store', sd]); return [...r.stdout.matchAll(/stem-(\d\d)\.md$/gm)].map((m) => bodies[Number(m[1])]).sort().join(','); };
  ok(await found('tsked') === 'tsked', 'a 3-letter root with no vowel is not cut: tsked is not tsking');
  ok((await found('acts')).includes('acted'), 'a 3-letter root with its vowel first is cut: acts finds acted');
  ok((await found('gas')).split(',').includes('gas'), 'a short word keeps its s: gas');
  ok(await found('status') === 'status', 'status keeps its s: not statue');
  ok(await found('sadly') === 'sadly', 'ly is no word form of a 3-letter root: sadly is not sadness');
  ok(await found('nicely') === 'nicely', 'a 4-letter stem keeps its e: nicely is not nickname');
  ok(await found('management') === 'management,managing', 'management finds the manag- forms and nothing else');
  ok((await found('printed')).includes('printer'), 'a 5-letter root matches at the start of a word: printed finds printer');
  ok(await found('компјутер') === 'компјутер', 'a Cyrillic word is cut only at a suffix it ends with');
  ok((await found('она')).split(',').includes('она'), 'a Cyrillic word keeps a suffix that leaves under 3 letters');
}

// 1.5.3 holes: the plugin lookups, a folder named like a note, a forget list that will not read, take(), promote's own defaults.
{
  const m = await import(pathToFileURL(CLI).href);
  const cfg = tempDir('plug-'), was = process.env.CLAUDE_CONFIG_DIR;
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const put = (f, v) => writeFileSync(join(cfg, 'plugins', f), JSON.stringify(v));
  try {
    ok(m.installPath() === null && m.marketplace() === null && m.pluginRoot() === null && m.deployedCommit(cfg) === null, 'nothing installed: every lookup is null');
    put('known_marketplaces.json', {});
    ok(m.marketplace() === null, 'a marketplace list with no plugin installed names none');
    put('installed_plugins.json', { plugins: { 'project-memory@mk': [] } });
    ok(m.installPath() === null, 'an install with no entry has no path');
    put('installed_plugins.json', { plugins: { 'project-memory@mk': [{ installPath: '' }] } });
    put('known_marketplaces.json', { mk: { source: '' } });
    writeFileSync(join(cfg, '.deployed.json'), JSON.stringify({ commit: '' }));
    ok(m.installPath() === '' && m.marketplace() === '' && m.deployedCommit(cfg) === '', 'a value is taken as written, an empty one too');
  } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
}
{ // A folder named like a note is no note: skipped by status and search, which go on.
  const hd = join(root, 'C--hole', 'memory'); mkdirSync(join(hd, 'folder.md'), { recursive: true });
  memory(hd, 'real-note', 'a note beside a folder', 'quokka');
  const s = await run(['status', '--store', hd]), q = await run(['search', 'quokka', '--store', hd]);
  ok(s.status === 0 && q.status === 0 && /real-note\.md/.test(q.stdout) && !/folder\.md/.test(q.stdout), `a folder named folder.md is skipped (got ${s.stderr}${q.stderr}${q.stdout})`);
  // A forget list that cannot be read (here a folder) is not fatal to a search that was not asked to report it.
  const { FORGOTTEN } = await import('../src/handoff-log.mjs');
  const { search: searchFn } = await import(pathToFileURL(CLI).href);
  mkdirSync(join(hd, FORGOTTEN), { recursive: true });
  ok(Array.isArray(searchFn([hd], 'quokka')), 'a search with no failure list survives an unreadable forget list');
}
{ // take(): a line that is no pointer keeps its place and its indented lines; only the pointer's own wrap goes with it.
  const { promote } = await import(pathToFileURL(CLI).href);
  const td = join(root, 'C--take', 'memory'); mkdirSync(td, { recursive: true });
  memory(td, 'tk-a', 'first');
  const sharedIdx = join(shared, 'MEMORY.md'), idxWas = existsSync(sharedIdx) ? readFileSync(sharedIdx, 'utf8') : '';
  writeFileSync(join(td, 'MEMORY.md'), '  stray indented line\n- [A](tk-a.md) — first\n  wrapped onto a second line\nplain line\n  indented after plain\n- [B](tk-b.md) — b\n');
  const r1 = promote(td, 'tk-a.md');
  ok(r1.ok === true && readFileSync(join(td, 'MEMORY.md'), 'utf8') === '  stray indented line\nplain line\n  indented after plain\n- [B](tk-b.md) — b\n', `promote takes the pointer and its wrap, and nothing else out of the index (got ${JSON.stringify(readFileSync(join(td, 'MEMORY.md'), 'utf8'))})`);
  ok(readFileSync(sharedIdx, 'utf8').includes('- [A](tk-a.md) — first\n  wrapped onto a second line\n'), 'and the shared index gets the whole line');
  rmSync(join(shared, 'tk-a.md')); writeFileSync(sharedIdx, idxWas);
  // promote called as a library: a note with a secret stays unless force is asked for.
  const key = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
  memory(td, 'tk-secret', 'has a key', `the key is ${key}`);
  const r2 = promote(td, 'tk-secret.md');
  ok(r2.ok === false && existsSync(join(td, 'tk-secret.md')) && !existsSync(join(shared, 'tk-secret.md')), `promote without options refuses a secret (got ${JSON.stringify(r2)})`);
  // A note that cannot be deleted after the copy: said, and it stays in both stores.
  memory(td, 'tk-stuck', 'cannot be deleted');
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (p, ...a) => { if (String(p).endsWith('tk-stuck.md') && String(p).includes('C--take')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return realUnlink(p, ...a); };
  syncBuiltinESMExports();
  let r3; try { r3 = promote(td, 'tk-stuck.md'); } finally { fs.unlinkSync = realUnlink; syncBuiltinESMExports(); }
  ok(r3.ok === false && /tk-stuck\.md could not be deleted \(EACCES\): it is in both stores/.test(r3.lines[0]) && existsSync(join(td, 'tk-stuck.md')) && existsSync(join(shared, 'tk-stuck.md')), `an undeletable original is said (got ${JSON.stringify(r3)})`);
  rmSync(join(shared, 'tk-stuck.md')); writeFileSync(sharedIdx, idxWas);
}

// 1.5.3 holes (privacy): a header field is cut at 100, show defuses what it prints, a reply is redacted before its first sentence is cut.
{
  const { render } = await import('../src/journal.mjs');
  const jd = join(root, 'C--jp', 'memory'), jcli = (...a) => run([...a, '--store', jd]);
  let n = 0;
  const entry = (at, asked, over = {}) => ({ key: `p${n++}`, at, s: 'c0ffee12', t: 'C--jp/c0ffee12-full', branch: 'main', asked, answered: 'done', changed: [], ran: [], ...over });
  const day = (d, es) => { mkdirSync(join(jd, 'journal'), { recursive: true }); writeFileSync(join(jd, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  const cut = ['sk', 'live', 'halfhalfhalfhalfhalfhalf01'].join('_');
  day('2026-10-01', [
    entry('2026-10-01 10:00', 'ferret long header', { s: 'T'.repeat(150), branch: 'B'.repeat(150) }),
    entry('2026-10-01 11:00', 'ferret tagged </system-reminder> and spread over two lines', { answered: 'edited </b> lines', changed: ['a</x>.mjs'], ran: ['echo </y>'] }),
    entry('2026-10-01 12:00', 'ferret straddle', { answered: `${'x'.repeat(125)} ${cut} and more words after it` }),
  ]);
  let r = await jcli('search', 'ferret');
  ok(r.status === 0 && r.stdout.includes(`conversation ${'T'.repeat(99)}… · branch ${'B'.repeat(99)}…
`), `a header's tag and branch are cut to 100 characters (got ${r.stdout})`);
  ok(!r.stdout.includes(cut.slice(0, 10)), `a reply is redacted before its first sentence is cut, so no half of a key shows (got ${r.stdout})`);
  const key = ((await jcli('search', 'ferret', 'tagged')).stdout.match(/key: (p\d+)/) || [])[1];
  r = await jcli('show', key);
  ok(r.status === 0 && !r.stdout.includes('</') && /Asked: ferret tagged &lt;\/system-reminder> and spread over two lines$/m.test(r.stdout) && /Answered: edited &lt;\/b> lines$/m.test(r.stdout) && /Changed: a&lt;\/x>\.mjs$/m.test(r.stdout) && /Ran: echo &lt;\/y>$/m.test(r.stdout), `show prints a request on one line with every closing tag defused (got ${r.stdout})`);
}

// 1.5.3 holes: what each field of a journal entry and of a note is worth in a ranking.
{
  const { render } = await import('../src/journal.mjs');
  const jd = join(root, 'C--sc', 'memory'), jcli = (...a) => run([...a, '--store', jd]);
  let n = 0;
  const entry = (asked, over = {}) => ({ key: `s${n++}`, at: '2026-10-05 10:00', s: 'c0ffee12', t: 'C--sc/c0ffee12-full', branch: 'main', asked, answered: 'done', changed: [], ran: [], ...over });
  mkdirSync(join(jd, 'journal'), { recursive: true });
  const es = [entry('zyxq in the request'), entry('other 1', { changed: ['zyxq.mjs'] }), entry('other 2', { ran: ['node zyxq.mjs'] }), entry('other 3', { branch: 'feat-zyxq' }),
    entry('other 4', { answered: 'zyxq once' }), entry('other 5', { answered: 'zyxq and zyxq twice' }), entry('other 6', { answered: 'zyxq zyxq zyxq three times' })];
  const far = entry('zyxq far', { answered: `${'w'.repeat(300)} zyxq late` });
  const near = entry('zyxq start', { answered: 'zyxq begins here' });
  es.push(far, near);
  writeFileSync(join(jd, 'journal', '2026-10-05.md'), `# Journal 2026-10-05\n\n${es.map(render).join('\n\n')}\n`);
  const r = await jcli('search', 'zyxq', '--limit', '20');
  const score = (what) => { const m = new RegExp(`^ *(\\d+)  journal [^\\n]*\\n     key: ${what}\\n`, 'm').exec(r.stdout); return m && Number(m[1]); };
  const got = es.map((e) => score(e.key));
  ok(JSON.stringify(got) === JSON.stringify([8, 4, 4, 3, 3, 4, 4, 9, 9]), `a request is worth 3 (+5 when it holds every word), a changed file or a command 2, a branch 1, an answer 1 a mention up to 2, all plus 2 (got ${JSON.stringify(got)} in ${r.stdout})`);
  const block = (k) => r.stdout.split(/^ *[0-9]+  journal /m).find((b) => b.includes(`key: ${k}`)) || '';
  ok(!/Result:/.test(block(near.key)) && /Answered: zyxq begins here/.test(block(near.key)), 'a match at the start of the reply is shown, not a Result beside it');
  const res = /^     Result: (w+)…$/m.exec(block(far.key));
  ok(res && res[1].length < 150 && /Answered: .*zyxq late/.test(block(far.key)), `a reply with no sentence end shows its first stretch only, then where the word is (got ${block(far.key).slice(0, 400)})`);
  // A note: its name 3, its description 2 (either, for every word, +5), its text 1 a mention up to 2.
  const nd = join(root, 'C--sn', 'memory'); mkdirSync(nd, { recursive: true });
  memory(nd, 'wobblex-name', 'plain', 'plain');
  memory(nd, 'plain-one', 'wobblex in the description', 'plain');
  memory(nd, 'plain-two', 'plain', 'wobblex once');
  memory(nd, 'plain-three', 'plain', 'wobblex and wobblex twice');
  memory(nd, 'plain-four', 'plain', 'wobblex wobblex wobblex three times');
  writeFileSync(join(nd, 'journal.md'), 'wobblex is in the journal pointer\n'); writeFileSync(join(nd, 'handoff.md'), '# Handoff\n\nwobblex written by hand\n');
  const q = await run(['search', 'wobblex', '--store', nd, '--limit', '20']);
  const ns = (f) => { const m = new RegExp(`^ *(\\d+)  \\S+ +[\\d-]+  [^\\n]*${f}\\.md\\n`, 'm').exec(q.stdout); return m && Number(m[1]); };
  const ngot = ['wobblex-name', 'plain-one', 'plain-two', 'plain-three', 'plain-four'].map(ns);
  ok(/handoff\.md/.test(q.stdout) && !/journal\.md/.test(q.stdout), `the hand-written handoff is a hit and the journal's pointer is none (got ${q.stdout})`);
  ok(JSON.stringify(ngot) === JSON.stringify([8, 7, 3, 4, 4]), `a note's name is worth 3, its description 2, its text a mention up to 2 (got ${JSON.stringify(ngot)} in ${q.stdout})`);
}

// 1.5.3 holes: what tells entries apart in the rank (word rarity, length, a typed phrase), by pairs where one constant flips the order.
{
  const { render } = await import('../src/journal.mjs'), { search: rankOf } = await import(pathToFileURL(CLI).href);
  const keys = (dir, q) => rankOf([dir], q).map((h) => Number(h.key.slice(1)));   // the function, not the CLI: the CLI adds the shared store, whose size moves the weights
  const W = ['zorp', 'quib', 'flum'];
  const rows = [
    ['j_max', 3, [['111', '330', 120, 0], ['111', '111', 1000, 1]], [0, 1]],
    ['i_den', 3, [['000', '311', 1000, 1], ['110', '303', 30, 0]], [1, 0]],
    ['d_init', 2, [['10', '13', 30, 0], ['00', '13', 1000, 1]], [0, 1]],
    ['e_and', 3, [['000', '111', 400, 1], ['110', '233', 120, 0]], [1, 0]],
    ['k_five', 2, [['00', '11', 1000, 1], ['01', '20', 120, 0]], [1, 0]],
    ['a_w1', 3, [['100', '300', 120, 0], ['000', '311', 400, 0]], [1, 0]],
    ['h_init', 2, [['01', '00', 1000, 0], ['00', '02', 400, 0]], [0, 1]],
    ['b_docs', 3, [['010', '121', 1000, 0], ['100', '301', 30, 0]], [0, 1]],
    ['c_n', 2, [['10', '00', 120, 0], ['10', '30', 30, 0], ['10', '03', 1000, 0]], [2, 1, 0]],
  ];
  let r = 0;
  for (const [name, nt, spec, want] of rows) {
    const jd = join(root, `C--rk${r++}`, 'memory'); mkdirSync(join(jd, 'journal'), { recursive: true });
    const q = W.slice(0, nt);
    const es = spec.map(([ak, an, len, ph], i) => {
      const mk = (t) => (ak[t] === '1' ? q[t] : 'lorem');
      let asked = q.map((_, t) => mk(t)).join(' and '); asked += ' ' + 'lorem '.repeat(len).slice(0, Math.max(0, len - asked.length - 1));
      const rep = q.map((w, t) => Array(Number(an[t]) - (ph ? 1 : 0)).fill(w).join(' filler ')).filter(Boolean).join(' filler ');
      const answered = `${ph ? q.join(' ') : ''} ${rep}`.trim() || 'nothing';
      return { key: `r${i}`, at: `2026-10-05 10:${String(50 - i).padStart(2, '0')}`, s: 'c0ffee12', t: 'C--sc/c0ffee12-full', branch: 'main', asked, answered, changed: [], ran: [] };
    });
    writeFileSync(join(jd, 'journal', '2026-10-05.md'), `# Journal 2026-10-05\n\n${es.map(render).join('\n\n')}\n`);
    const got = keys(jd, q.join(' '));
    ok(JSON.stringify(got) === JSON.stringify(want), `rank ${name}: expected entries ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  // One word is no phrase: no bonus for the text over a branch, so equal scores go by date.
  const jd = join(root, 'C--rk-one', 'memory'); mkdirSync(join(jd, 'journal'), { recursive: true });
  const base = { s: 'c0ffee12', t: 'C--sc/c0ffee12-full', changed: [], ran: [] };
  const two = [{ ...base, key: 'r0', at: '2026-10-05 10:50', branch: 'feat-zorp', asked: 'other', answered: 'done' }, { ...base, key: 'r1', at: '2026-10-05 10:49', branch: 'main', asked: 'other', answered: 'zorp once' }];
  writeFileSync(join(jd, 'journal', '2026-10-05.md'), `# Journal 2026-10-05\n\n${two.map(render).join('\n\n')}\n`);
  ok(JSON.stringify(keys(jd, 'zorp')) === '[0,1]', 'a lone word earns no phrase bonus: equal scores go to the newer entry');
}

// 1.5.3 holes: cutting an auto block out of the handoff keeps every hand-written character around it.
{
  const { search: rankOf } = await import(pathToFileURL(CLI).href);
  const hd = join(root, 'C--cutkeep', 'memory'); mkdirSync(hd, { recursive: true });
  writeFileSync(join(hd, 'handoff.md'), '---\nname: handoff\n---\nzebraqq starts the text\n<!-- auto:start -->\nlogzzq line\n<!-- auto:end -->\nbetaqq follows\n');
  ok(rankOf([hd], 'zebraqq').length === 1, 'the first character of the hand-written text is kept when the log is cut out');
  ok(rankOf([hd], 'logzzq').length === 0, 'the log between the markers is not searched');
  // The text before and after the log meet with nothing between them but the line break: a phrase across the cut is found, so the handoff outranks a note that has the words apart.
  memory(hd, 'apart', 'the same words in another order', 'betaqq follows, then text starts zebraqq');
  utimesSync(join(hd, 'handoff.md'), new Date(2020, 1, 1), new Date(2020, 1, 1));
  const hits = rankOf([hd], 'zebraqq starts the text betaqq follows').map((h) => h.file);
  ok(hits[0] === 'handoff.md', `a phrase across the cut counts as typed (got ${JSON.stringify(hits)})`);
}

// 1.5.3 holes: status: a link that names nothing, the size at which handoff.md is called big.
{
  const { handoffBig, status: statusOf } = await import(pathToFileURL(CLI).href);
  const sd = join(root, 'C--statuspins', 'memory'); mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'nameless.md'), '---\ndescription: no name line\ntype: reference\n---\nsee [[ ]] and [[real-target]]\n');
  const dangling = statusOf(sd).filter((l) => /links to no memory/.test(l)).join('\n');
  ok(/nameless\.md → \[\[\]\]/.test(dangling) && /real-target/.test(dangling), `an empty link is dangling even when another note has no name (got ${dangling})`);
  writeFileSync(join(sd, 'handoff.md'), 'x'.repeat(64 * 1024));
  ok(handoffBig(sd) === null, 'a handoff.md of exactly 64 KB is not big');
  writeFileSync(join(sd, 'handoff.md'), 'x'.repeat(64 * 1024 + 1));
  ok(/^handoff\.md is 64 KB \(over 64 KB\)/.test(handoffBig(sd)), 'one byte more is');
  ok(handoffBig(join(sd, 'no-such-dir')) === null, 'no handoff.md is not big');
}

// 1.5.3 holes: rescan counts, in the files and in the snapshots, and what --apply --yes says and backs up. A home of its own, so no other test's history is counted.
{
  const h2 = tempHome('rescan2-'), r2 = join(h2.home, '.claude', 'projects'), key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', key2 = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
  const sh = (cmd, args) => spawnSync(cmd, args, { env: h2.env, encoding: 'utf8' });
  const snap = () => sh(process.execPath, [TIER]);
  const rescan = (...a) => sh(process.execPath, [CLI, 'rescan', ...a]);
  const a = join(r2, 'C--ra', 'memory'), b = join(r2, 'C--rb', 'memory');
  for (const d of [a, b]) mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(join(a, 'MEMORY.md'), '# Memory Index\n'); writeFileSync(join(b, 'MEMORY.md'), '# Memory Index\n');
  writeFileSync(join(a, 'old.md'), `---\nname: old\n---\nthe token was ${key} then\n`);
  writeFileSync(join(a, 'journal', '2020-02-03.md'), `# Journal 2020-02-03\n\nran with ${key}\n`);
  writeFileSync(join(b, 'other.md'), `---\nname: other\n---\nthis one holds ${key2}\n`);
  writeFileSync(join(a, 'notes.txt'), `not a note: ${key}\n`); writeFileSync(join(a, 'journal', 'raw.txt'), `not a day: ${key}\n`);
  const old10 = (...fs) => fs.forEach((f) => utimesSync(f, tenMin, tenMin));
  old10(join(a, 'old.md'), join(a, 'journal', '2020-02-03.md'), join(b, 'other.md'), join(a, 'notes.txt'), join(a, 'journal', 'raw.txt'));
  snap(); snap();
  writeFileSync(join(a, 'old.md'), `---\nname: old\n---\nthe token was ${key} then, and later ${key2}\n`);
  writeFileSync(join(a, 'journal', '2020-02-03.md'), `# Journal 2020-02-03

ran with ${key} and ${key2}
`); writeFileSync(join(a, 'journal', '2020-02-04.md'), `# Journal 2020-02-04

again ${key2}
`);
  old10(join(a, 'old.md'), join(a, 'journal', '2020-02-03.md'), join(a, 'journal', '2020-02-04.md')); snap();
  const git = (...x) => sh('git', ['-C', r2, ...x]).stdout.trim();
  const blob = spawnSync('git', ['-C', r2, 'hash-object', '-w', '--stdin'], { input: `old note ${key}\n`, encoding: 'utf8' }).stdout.trim();
  git('update-ref', 'refs/project-memory/replaced/lab', blob);
  let r = rescan();
  ok(r.status === 0 && r.stdout === 'files now: 6 secrets in 4 files: C--ra/memory/old.md (2), C--ra/memory/journal/2020-02-03.md (2), C--ra/memory/journal/2020-02-04.md (1), C--rb/memory/other.md (1)\n'
    + 'snapshots: 5 secrets in 3 saved versions of 2 files, in 2 snapshots, and 1 kept copies of replaced notes: C--ra/memory/journal/2020-02-03.md, C--ra/memory/journal/2020-02-04.md\n'
    + 'nothing has been changed (dry run); rescan --apply --yes redacts them\n', `the dry run counts secrets, versions, files and snapshots, and skips a .txt (got ${JSON.stringify(r.stdout)}${r.stderr.slice(0, 300)})`);
  r = rescan('--apply', '--yes');
  const bk = readdirSync(join(h2.home, '.claude')).find((n) => n.startsWith('project-memory-rescan-backup')), at = join(h2.home, '.claude', bk ?? 'none');
  ok(r.status === 0 && r.stdout.startsWith('Before you go on, revoke or rotate') && /redacted 6 in files and 5 in the snapshots; the snapshots hold none now\nbackup: /.test(r.stdout) && !r.stdout.includes(key), `the warning comes first, then what was redacted (got ${JSON.stringify(r.stdout)}${r.stderr.slice(0, 300)})`);
  ok(readFileSync(join(at, 'files', 'C--ra', 'memory', 'old.md'), 'utf8').includes(key) && readFileSync(join(at, 'files', 'C--rb', 'memory', 'other.md'), 'utf8').includes(key2) && readFileSync(join(at, 'files', 'kept-lab.md'), 'utf8').includes(key) && existsSync(join(at, 'snapshots.bundle')), 'the backup holds every file with a hit, the kept copy and the old history');
  const text = (f) => readFileSync(f, 'utf8');
  ok(!text(join(a, 'old.md')).includes(key) && !text(join(a, 'journal', '2020-02-04.md')).includes(key2) && !text(join(b, 'other.md')).includes(key2) && text(join(a, 'notes.txt')).includes(key) && text(join(a, 'journal', 'raw.txt')).includes(key), 'every store has its files redacted; a .txt is left alone');
  ok(git('log', '--all', '-S' + key, '--format=%H') === '' && git('log', '--all', '-S' + key2, '--format=%H') === '' && git('cat-file', 'blob', 'refs/project-memory/replaced/lab').includes('[redacted]'), 'no snapshot nor the kept copy holds a key');
  r = rescan();
  ok(/nothing found; nothing changed/.test(r.stdout), `a second run finds nothing (got ${r.stdout})`);
}

// 1.5.3 holes: a purge drops only the named day, in every commit, and leaves the rest of the history as it was (a folder with a non-ASCII name is quoted by git).
{
  const { render } = await import('../src/journal.mjs');
  const h9 = tempHome('purge2-'), r9 = join(h9.home, '.claude', 'projects'), tier = () => spawnSync(process.execPath, [TIER], { env: h9.env, encoding: 'utf8' });
  const pd = join(r9, 'C--pürge-keep', 'memory'), word = 'quokkaz-' + 'purge', other = 'wombatz-' + 'stays';
  mkdirSync(join(pd, 'journal'), { recursive: true });
  const day = (d, text, k) => writeFileSync(join(pd, 'journal', `${d}.md`), `# Journal ${d}\n\n${render({ key: k, at: `${d} 10:00`, s: 'c0ffee12', t: 'C--pürge-keep/c0ffee12-full', branch: 'main', asked: text, answered: 'noted', changed: [], ran: [] })}\n`);
  const git = (...a) => spawnSync('git', ['-C', r9, ...a], { encoding: 'utf8' });
  day('2020-03-01', `remember ${word}`, 'pk1'); day('2020-03-02', `remember ${other}`, 'pk2');
  writeFileSync(join(pd, 'MEMORY.md'), '# Memory Index\n');
  tier(); tier();
  unlinkSync(join(pd, 'journal', '2020-03-01.md'));   // a commit that deletes the day: a D line in the stream
  tier(); tier();
  day('2020-03-01', `remember ${word}`, 'pk1'); tier(); tier();
  const commits = git('rev-list', '--all', '--count').stdout.trim(), held = (w) => git('log', '--all', '-S' + w, '--format=%H').stdout.trim() !== '';
  ok(held(word) && held(other) && Number(commits) >= 3, `fixture: the snapshots hold both days over several commits (${commits})`);
  mkdirSync(join(r9, '.git', 'pm-purge-old'), { recursive: true }); writeFileSync(join(r9, '.git', 'pm-purge-old', 'copy.git'), 'a killed run left this');
  const r = spawnSync(process.execPath, [CLI, 'forget', word, '--yes', '--purge', '--store', pd], { env: h9.env, encoding: 'utf8' });
  ok(/purged from the snapshots/.test(r.stdout) && !held(word), `the named day is gone from every commit (got ${r.stdout})`);
  ok(!existsSync(join(r9, '.git', 'pm-purge-old')), 'the copy a killed run left behind is removed');
  ok(git('grep', '--cached', '-l', word).stdout === '', 'the index holds no old blob of the purged day');
  ok(held(other) && git('rev-list', '--all', '--count').stdout.trim() === commits, 'every commit and the other day stay');
  const tree = git('ls-tree', '-r', '--name-only', '-z', 'HEAD').stdout.split('\0');
  ok(tree.some((p) => p.endsWith('journal/2020-03-02.md')) && tree.some((p) => p.endsWith('/memory/MEMORY.md')) && !tree.some((p) => p.endsWith('2020-03-01.md')), `the latest snapshot keeps every other file (got ${tree.join('|')})`);
  ok(/Memory Index/.test(git('show', `HEAD:C--pürge-keep/memory/MEMORY.md`).stdout) || /Memory Index/.test(git('-c', 'core.quotepath=off', 'show', 'HEAD:C--pürge-keep/memory/MEMORY.md').stdout), 'a kept file reads back as it was');
  // A snapshot in flight (any one of git's own locks, or the purge's) is no time to rewrite: said in words, and the lock is not ours to remove.
  for (const lock of ['index.lock', 'config.lock']) {
    day('2020-03-01', `remember ${word}`, 'pk1');
    const lf = join(r9, '.git', lock); writeFileSync(lf, '');
    const busy = spawnSync(process.execPath, [CLI, 'forget', word, '--yes', '--purge', '--store', pd], { env: h9.env, encoding: 'utf8' });
    ok(/could not be purged \(a snapshot is being taken; try again in a moment\)/.test(busy.stdout) && existsSync(lf), `a purge gives way to ${lock} (got ${busy.stdout})`);
    unlinkSync(lf);
  }
}

// 1.5.3 holes: rescan over a history alone (copies of one blob, a commit message, a BOM, a blob that is not UTF-8, a kept copy), what a failed rewrite or a leftover tag says, and the no-snapshots cases.
{
  const h = tempHome('rescan3-'), pr = join(h.home, '.claude', 'projects'), a = join(pr, 'C--rc', 'memory');
  const key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', key2 = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2', key3 = 'ghp_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8';
  const key4 = 'ghp_' + 'M1n2B3v4C5x6Z7a8S9d0F1g2H3j4K5l6P7o8', key5 = 'ghp_' + 'L9k8J7h6G5f4D3s2A1p0O9i8U7y6T5r4E3w2';
  const sh = (cmd, args) => spawnSync(cmd, args, { env: h.env, encoding: 'utf8' });
  const snap = () => { sh(process.execPath, [TIER]); sh(process.execPath, [TIER]); };
  const rescan = (...x) => sh(process.execPath, [CLI, 'rescan', ...x]);
  const git = (...x) => sh('git', ['-C', pr, ...x]);
  mkdirSync(join(a, 'journal'), { recursive: true });
  writeFileSync(join(a, 'MEMORY.md'), '# Memory Index\n');
  const same = `---\nname: x\n---\nkey ${key}\n`, put = (n, b) => { writeFileSync(join(a, n), b); utimesSync(join(a, n), tenMin, tenMin); };
  put('journal/2020-03-03.md', same);
  put('journal/2020-03-01.md', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(`---\nname: bom\n---\nkey ${key2}\n`)]));
  put('journal/2020-03-02.md', Buffer.concat([Buffer.from([0xFF, 0x20]), Buffer.from(`${key3}\n`)]));
  snap();
  put('journal/2020-03-04.md', same); snap();   // the same text again: the same blob, a second and third snapshot with it
  put('journal/2020-03-05.md', same); snap();
  for (const n of ['03', '04', '05', '01', '02']) unlinkSync(join(a, 'journal', `2020-03-${n}.md`));
  snap();
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-q', '-m', `pasted ${key5}`);   // a secret in a commit message
  const kept = spawnSync('git', ['-C', pr, 'hash-object', '-w', '--stdin'], { input: `old note ${key}\n`, encoding: 'utf8' }).stdout.trim();
  git('update-ref', 'refs/project-memory/replaced/lab', kept);
  put('handoff.md.prev', `the old handoff had ${key4}\n`);
  let r = rescan();
  const dry = r.stdout;
  ok(r.status === 0 && /^files now: 1 secret in 1 file: C--rc\/memory\/handoff\.md\.prev \(1\)\nsnapshots: 4 secrets in 2 saved versions of 4 files, in 4 snapshots, and 1 kept copies of replaced notes: C--rc\/memory\/journal\/2020-03-01\.md, C--rc\/memory\/journal\/2020-03-03\.md, C--rc\/memory\/journal\/2020-03-04\.md, C--rc\/memory\/journal\/2020-03-05\.md\nnothing has been changed \(dry run\); rescan --apply --yes redacts them\n$/.test(dry), `a history alone is counted: copies of one blob are separate snapshots, a message counts, a blob that is not UTF-8 does not (got ${JSON.stringify(dry)}${r.stderr.slice(0, 200)})`);
  r = rescan('--apply');
  ok(r.status === 0 && r.stdout.startsWith('Before you go on, revoke or rotate') && r.stdout.endsWith('nothing has been changed; add --yes to go on\n') && readFileSync(join(a, 'handoff.md.prev'), 'utf8').includes(key4), `--apply without --yes warns and changes nothing (got ${JSON.stringify(r.stdout)})`);
  // One of git's own locks, alone, is a snapshot in flight.
  for (const lock of ['HEAD.lock', 'index.lock']) {
    const lf = join(pr, '.git', lock); writeFileSync(lf, '');
    r = rescan('--apply', '--yes');
    ok(r.status === 1 && r.stdout.trim() === 'a snapshot is being taken; try again in a moment; nothing changed' && existsSync(lf) && readFileSync(join(a, 'handoff.md.prev'), 'utf8').includes(key4), `rescan gives way to ${lock} (got ${JSON.stringify(r.stdout)})`);
    unlinkSync(lf);
  }
  // A kept copy that cannot be rewritten: said, with the backup's place, and not reported as done.
  const rl = join(pr, '.git', 'refs', 'project-memory', 'replaced', 'lab.lock'); writeFileSync(rl, '');
  r = rescan('--apply', '--yes');
  ok(r.status === 1 && /the snapshots could not be rewritten \(.+\); backup: /.test(r.stdout) && !/redacted \d+ in files/.test(r.stdout), `a failed rewrite is said, not reported as done (got ${JSON.stringify(r.stdout)})`);
  unlinkSync(rl);
  // A tag keeps the old history: what is still found is said, and the run does not count as clean.
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', 'v1', '-m', `tag ${key}`);
  r = rescan('--apply', '--yes');
  ok(r.status === 1 && /redacted 0 in files and \d+ in the snapshots; \d+ still found in the snapshots\n/.test(r.stdout), `what a tag still holds is said and fails the run (got ${JSON.stringify(r.stdout)})`);
  const at = (f) => git('log', 'HEAD', '--diff-filter=A', '--format=%H', '--', `C--rc/memory/${f}`).stdout.trim().split('\n')[0];
  const bytes = (f) => spawnSync('git', ['-C', pr, 'show', `${at(f)}:C--rc/memory/${f}`], { encoding: 'buffer' }).stdout;
  const bm = bytes('journal/2020-03-01.md'), bd = bytes('journal/2020-03-02.md');
  ok(bm[0] === 0xEF && bm[1] === 0xBB && bm[2] === 0xBF && !bm.toString().includes(key2) && bm.toString().includes('[redacted]'), 'a blob with a byte order mark is redacted and keeps the mark');
  ok(bd.equals(Buffer.concat([Buffer.from([0xFF, 0x20]), Buffer.from(`${key3}\n`)])), 'a blob that is not UTF-8 is left exactly as it was');
}
{ // No snapshots: a note, a folder named like one, then a repository around the store, then a repository with no commit.
  const h = tempHome('rescan4-'), p = join(h.home, '.claude', 'projects'), d = join(p, 'C--rd', 'memory'), key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const rs = (...x) => spawnSync(process.execPath, [CLI, 'rescan', ...x], { env: h.env, encoding: 'utf8' });
  mkdirSync(join(d, 'dir.md'), { recursive: true });
  writeFileSync(join(d, 'MEMORY.md'), '# Memory Index\n'); writeFileSync(join(d, 'clean.md'), '---\nname: clean\n---\nnothing here\n');
  let r = rs();
  ok(r.status === 0 && r.stdout === 'files now: 0 secrets in 0 files\nsnapshots: none to scan\nnothing found; nothing changed\n', `no snapshots and no secret: nothing found, a folder named dir.md skipped (got ${JSON.stringify(r.stdout)}${r.stderr.slice(0, 200)})`);
  writeFileSync(join(d, 'leak.md'), `---\nname: leak\n---\n${key}\n`);
  r = rs();
  ok(r.status === 0 && r.stdout === 'files now: 1 secret in 1 file: C--rd/memory/leak.md (1)\nsnapshots: none to scan\nnothing has been changed (dry run); rescan --apply --yes redacts them\n', `a secret in a file alone is reported (got ${JSON.stringify(r.stdout)})`);
  unlinkSync(join(d, 'leak.md'));
  spawnSync('git', ['init', '-q', h.home], { encoding: 'utf8' });
  spawnSync('git', ['-C', h.home, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-q', '-m', 'x'], { encoding: 'utf8' });
  r = rs();
  ok(r.stdout.includes('snapshots: none to scan') && r.stdout.includes('nothing found'), `a repository around the store is no snapshot of it (got ${JSON.stringify(r.stdout)})`);
  spawnSync('git', ['init', '-q', p], { encoding: 'utf8' });
  r = rs();
  ok(r.stdout.includes('snapshots: none to scan') && r.stdout.includes('nothing found'), `a repository with no commit has no snapshot (got ${JSON.stringify(r.stdout)})`);
}
{ // Snapshots that cannot be read are no all-clear: rescan says so and fails, even with a clean file beside them.
  const h = tempHome('rescan5-'), pr = join(h.home, '.claude', 'projects'), d = join(pr, 'C--re', 'memory');
  const sh = (cmd, args) => spawnSync(cmd, args, { env: h.env, encoding: 'utf8' });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'MEMORY.md'), '# Memory Index\n'); writeFileSync(join(d, 'n.md'), '---\nname: n\n---\nplain text\n');
  utimesSync(join(d, 'n.md'), tenMin, tenMin);
  sh(process.execPath, [TIER]); sh(process.execPath, [TIER]);
  const blob = sh('git', ['-C', pr, 'rev-parse', 'HEAD:C--re/memory/n.md']).stdout.trim();
  const obj = join(pr, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
  ok(existsSync(obj), 'fixture: the note is a loose object in the snapshots');
  unlinkSync(obj);
  const r = sh(process.execPath, [CLI, 'rescan']);
  ok(r.status === 1 && /^the snapshots could not be read \(.+\); nothing changed\n$/.test(r.stdout) && !/nothing found|none to scan/.test(r.stdout), `an unreadable history is said, not reported as clean (got ${JSON.stringify(r.stdout)})`);
}


// 1.5.3 holes: restore (a byte order mark on disk, what it says about the index line, a busy store, a history it cannot read) and promote (its own defaults, what it refuses and what it says).
{
  const h = tempHome('restore2-'), pr = join(h.home, '.claude', 'projects'), d = join(pr, 'C--rs', 'memory'), sh = join(pr, '_shared', 'memory');
  const run1 = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args, '--store', d], { env: h.env, encoding: 'utf8', ...extra });
  const snap = () => { spawnSync(process.execPath, [TIER], { env: h.env, encoding: 'utf8' }); spawnSync(process.execPath, [TIER], { env: h.env, encoding: 'utf8' }); };
  const gitIn = (...x) => spawnSync('git', ['-C', pr, ...x], { encoding: 'utf8' });
  const age = (f) => utimesSync(f, tenMin, tenMin);
  mkdirSync(d, { recursive: true });
  const C = Buffer.from('---\nname: bom\ndescription: a note with bytes\n---\nthe body\n');
  const idx = (...lines) => writeFileSync(join(d, 'MEMORY.md'), ['# Memory Index', '', ...lines, ''].join('\n'));
  writeFileSync(join(d, 'bom.md'), C); writeFileSync(join(d, 'lined.md'), ['---', 'name: lined', 'description: has a line', '---', 'body', ''].join('\n'));
  idx('- [Bom](bom.md) — a note with bytes', '- [Lined](lined.md) — has a line');
  for (const n of ['bom.md', 'lined.md', 'MEMORY.md']) age(join(d, n));
  snap();
  // What is on disk against what the snapshot holds: a byte order mark alone is no difference, a lookalike prefix is (and is no UTF-8, so it is not written over).
  const BOM = [0xEF, 0xBB, 0xBF], disk = (prefix) => writeFileSync(join(d, 'bom.md'), Buffer.concat([Buffer.from(prefix), C]));
  for (const [prefix, same, what] of [[BOM, true, 'a byte order mark'], [[], true, 'no prefix'], [[0x00, 0xBB, 0xBF], false, 'a first byte that is not one'], [[0xEF, 0x00, 0xBF], false, 'a second byte that is not one'], [[0xEF, 0xBB, 0x00], false, 'a third byte that is not one']]) {
    disk(prefix);
    const r = run1(['restore', 'bom', '--force']);
    ok(same ? r.status === 1 && /already matches/.test(r.stdout) : !/already matches/.test(r.stdout), `restore over ${what}: ${same ? 'already that version' : 'not that version'} (got ${JSON.stringify(r.stdout)})`);
  }
  writeFileSync(join(d, 'bom.md'), Buffer.concat([Buffer.from(BOM), Buffer.from('other text\n')]));
  let r = run1(['restore', 'bom', '--force']);
  ok(r.status === 0 && /restored/.test(r.stdout) && readFileSync(join(d, 'bom.md')).equals(C), `a byte order mark and other text is replaced by the snapshot (got ${JSON.stringify(r.stdout)})`);
  // The index line: absent at that revision, still there, or brought back.
  // The snapshot a tier took has given every note a line, so this one is committed by hand, as the index has it.
  writeFileSync(join(d, 'orphan.md'), ['---', 'name: orphan', 'description: no line', '---', 'body', ''].join('\n'));
  gitIn('add', '-f', 'C--rs/memory/orphan.md'); gitIn('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'an orphan, no line');
  unlinkSync(join(d, 'orphan.md'));
  r = run1(['restore', 'orphan']);
  ok(r.status === 0 && /no index line at that revision/.test(r.stdout) && existsSync(join(d, 'orphan.md')), `a note with no line in its snapshot comes back and says so (got ${JSON.stringify(r.stdout)})`);
  unlinkSync(join(d, 'lined.md'));
  r = run1(['restore', 'lined']);
  ok(r.status === 0 && /its index line is still there/.test(r.stdout), `a line still in the index is said to be there (got ${JSON.stringify(r.stdout)})`);
  unlinkSync(join(d, 'lined.md')); idx('- [Bom](bom.md) — a note with bytes');
  r = run1(['restore', 'lined']);
  ok(r.status === 0 && /with its line: - \[Lined\]\(lined\.md\) — has a line/.test(r.stdout) && readFileSync(join(d, 'MEMORY.md'), 'utf8').includes('[Lined](lined.md)'), `a line gone from the index comes back with the note (got ${JSON.stringify(r.stdout)})`);
  // A store held by another hook is busy for both, and nothing moves (two seconds each).
  writeFileSync(join(d, 'mover.md'), '---\nname: mover\ndescription: to move\n---\nbody\n');
  mkdirSync(join(d, '.lock'));
  const [rb, pb] = [run1(['restore', 'bom', '--force']), run1(['promote', 'mover'])];
  rmSync(join(d, '.lock'), { recursive: true });
  ok(rb.status === 1 && rb.stdout.includes(`${d} is busy (another hook holds it); try again`), `restore says the store is busy (got ${JSON.stringify(rb.stdout)})`);
  ok(pb.status === 1 && pb.stdout.includes('a store is busy (another hook holds it); try again') && existsSync(join(d, 'mover.md')) && !existsSync(join(sh, 'mover.md')), `promote says a store is busy and moves nothing (got ${JSON.stringify(pb.stdout)})`);
  // Promote: what it refuses and what it says.
  r = run1(['promote', 'nosuchnote']);
  ok(r.status === 1 && r.stdout.includes(`no ${join(d, 'nosuchnote.md')}`), `promote of a note that is not there names the path (got ${JSON.stringify(r.stdout)})`);
  mkdirSync(sh, { recursive: true }); writeFileSync(join(sh, 'mover.md'), 'already shared\n');
  r = run1(['promote', 'mover']);
  ok(r.status === 1 && r.stdout.includes('the shared store has a mover.md already: rename one, or merge them by hand') && existsSync(join(d, 'mover.md')), `promote will not overwrite a shared note (got ${JSON.stringify(r.stdout)})`);
  // Called as a function with no options: a key is held back, as with the CLI.
  const key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  writeFileSync(join(d, 'keyed.md'), `---\nname: keyed\ndescription: holds a key\n---\n${key}\n`);
  const fn = spawnSync(process.execPath, ['--input-type=module', '-e', `import { promote } from ${JSON.stringify(pathToFileURL(CLI).href)}; const r = promote(${JSON.stringify(d)}, 'keyed.md'); console.log(JSON.stringify(r));`], { env: h.env, encoding: 'utf8' });
  ok(/"ok":false/.test(fn.stdout) && /holds what looks like a key/.test(fn.stdout) && existsSync(join(d, 'keyed.md')) && !existsSync(join(sh, 'keyed.md')), `promote's own default is no force: a key stays where it is (got ${fn.stdout}${fn.stderr.slice(0, 200)})`);
  // A history git cannot read: its newest commit is gone from the object store.
  const head = gitIn('rev-parse', 'HEAD').stdout.trim(), obj = join(pr, '.git', 'objects', head.slice(0, 2), head.slice(2));
  if (existsSync(obj)) {
    renameSync(obj, obj + '.hidden');
    r = run1(['history', 'bom']);
    renameSync(obj + '.hidden', obj);
    ok(r.status === 1 && /^no snapshots to read: /.test(r.stdout), `history says when the snapshots cannot be read (got ${JSON.stringify(r.stdout)})`);
  }
}


// 1.5.3 holes: incognito's failures, memory off and on when the marker is already there or changes underfoot, doctor's reading of a damaged install, and a promote whose project copy cannot be deleted.
{
  const h = tempHome('incog2-'), pr = join(h.home, '.claude', 'projects'), proj = join(pr, 'C--ig'), d = join(proj, 'memory'), SID = 'eeeeeeee-5555';
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, `${SID}.jsonl`), [{ type: 'user', text: 'tell me about narwhal tusks' }, { type: 'assistant', text: 'a tusk is a tooth' }].map((m) => JSON.stringify({ type: m.type, cwd: 'C:\\ig', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: m.text }] } })).join('\n') + '\n');
  const inc = () => spawnSync(process.execPath, [CLI, 'incognito', '--session', SID], { env: h.env, encoding: 'utf8' });
  let r = inc();
  ok(r.status === 0 && existsSync(d) && readFileSync(join(d, '.private-sessions'), 'utf8').includes('eeeeeeee'), `incognito makes the memory folder when there is none (got ${r.status} ${r.stdout}${r.stderr.slice(0, 200)})`);
  rmSync(join(d, '.private-sessions')); mkdirSync(join(d, '.private-sessions'));
  r = inc();
  ok(r.status === 1 && /^incognito NOT applied: the private-session list in .+ could not be written; nothing was marked$/m.test(r.stdout), `a private-session list that cannot be written: not applied, and says which part (got ${r.status} ${JSON.stringify(r.stdout)})`);
  rmSync(join(d, '.private-sessions'), { recursive: true });
  rmSync(join(d, 'journal'), { recursive: true, force: true }); writeFileSync(join(d, 'journal'), 'a file where the journal folder should be');
  r = inc();
  ok(r.status === 1 && /^incognito is marked for this conversation, but sweeping what it already saved failed: /m.test(r.stdout) && readFileSync(join(d, '.private-sessions'), 'utf8').includes('eeeeeeee'), `a sweep that fails after the mark says so, and the mark stays (got ${r.status} ${JSON.stringify(r.stdout)})`);
  rmSync(join(d, 'journal'));
  rmSync(d, { recursive: true }); writeFileSync(d, 'a file where the memory folder should be');
  r = inc();
  ok(r.status === 1 && /^incognito NOT applied: .+; nothing was marked$/m.test(r.stdout), `a memory folder that cannot be made: not applied, nothing marked (got ${r.status} ${JSON.stringify(r.stdout)})`);
}
{ // memory off and on: the marker already there, one that changes underfoot, one that cannot be read. In this process, so the suite's own home again (tempHome moved it).
  process.env.HOME = process.env.USERPROFILE = home;
  const od = join(root, 'C--off-two', 'memory'), go = (...a) => run([...a, '--store', od]), marker = join(od, '.project-off');
  let r = await go('off');
  ok(r.status === 0 && existsSync(marker), 'fixture: memory off');
  r = await go('off');
  ok(r.status === 0 && /^memory is already off in this project since \d{4}-\d\d-\d\d/.test(r.stdout), `memory off twice says it is already off (got ${JSON.stringify(r.stdout)})`);
  const doc = (await cli('doctor', '--store', od)).stdout;
  ok(/^ok +memory is off in this project since/m.test(doc), `doctor reports a project that is off as fine, with the date (got ${JSON.stringify(doc.slice(0, 300))})`);
  rmSync(marker);
  const undo = meanwhile('writeFileSync', (p) => p.includes('.project-off.tmp'), () => fs.writeFileSync(marker, '{"t":1}'));
  try { r = await go('off'); } finally { undo(); }
  ok(r.status === 1 && /^memory off NOT applied: the marker was changed meanwhile; try again$/m.test(r.stdout), `a marker that changes while it is written: not applied (got ${r.status} ${JSON.stringify(r.stdout)})`);
  rmSync(marker, { force: true });
  // A marker whose state cannot be read is a pause the plugin cannot judge: said, and memory on is not "already on".
  const real = fs.lstatSync;
  fs.lstatSync = function (p, ...a) { if (String(p).endsWith('.project-off')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return real.call(this, p, ...a); };
  syncBuiltinESMExports();
  let unread, back;
  try { unread = await cli('doctor', '--store', od); back = await go('on'); } finally { fs.lstatSync = real; syncBuiltinESMExports(); }
  ok(/^PROBLEM memory is paused here: the off marker can't be read \(EACCES\)/m.test(unread.stdout) && unread.status === 1, `doctor says an unreadable off marker is a problem (got ${JSON.stringify(unread.stdout.slice(0, 400))})`);
}
{ // A promote whose project copy cannot be deleted: in both stores, said so, and the shared copy stays.
  memory(dir, 'stuck-note', 'cannot be deleted');
  const real = fs.unlinkSync;
  fs.unlinkSync = function (p, ...a) { if (String(p).endsWith('stuck-note.md')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return real.call(this, p, ...a); };
  syncBuiltinESMExports();
  let r; try { r = await cli('promote', 'stuck-note'); } finally { fs.unlinkSync = real; syncBuiltinESMExports(); }
  ok(r.status === 1 && /stuck-note\.md could not be deleted \(EACCES\): it is in both stores; delete it by hand/.test(r.stdout) && existsSync(join(shared, 'stuck-note.md')) && existsSync(join(dir, 'stuck-note.md')), `a note that cannot be deleted after the copy is said to be in both stores (got ${r.status} ${JSON.stringify(r.stdout)})`);
}

// 1.5.3 holes: doctor reads a damaged install without failing: a marketplace entry with no source, a plugin.json with an empty version, and an enforce hook whose wiring or run is broken.
{
  const h = tempHome('doctor2-'), cd = join(h.home, '.claude'), pl = join(cd, 'plugins'), at = join(pl, 'cache', 'pm', 'project-memory', '1.0.0');
  mkdirSync(join(at, '.claude-plugin'), { recursive: true }); mkdirSync(join(at, 'hooks'), { recursive: true }); mkdirSync(join(h.home, '.claude', 'projects'), { recursive: true });
  const doctor = () => spawnSync(process.execPath, [CLI, 'doctor'], { env: h.env, cwd: h.home, encoding: 'utf8' });
  const install = (market) => {
    writeFileSync(join(pl, 'installed_plugins.json'), JSON.stringify({ plugins: { 'project-memory@pm': [{ installPath: at }] } }));
    writeFileSync(join(pl, 'known_marketplaces.json'), JSON.stringify(market));
  };
  writeFileSync(join(at, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'project-memory', version: '' }));
  // A marketplace entry with no source: nothing to say of auto-update, and no stack trace.
  install({ pm: {} });
  let r = doctor();
  ok(/^ok +installed as project-memory@pm$/m.test(r.stdout) && !/marketplace auto-update/.test(r.stdout) && !/TypeError/.test(r.stderr), `a marketplace entry with no source is no crash (got ${JSON.stringify(r.stdout.slice(0, 300))}${r.stderr.slice(0, 200)})`);
  install({ pm: { source: { source: 'github', repo: 'a/b' } } });
  r = doctor();
  ok(/^ok +marketplace auto-update is off: /m.test(r.stdout) && /^ok +the plugin runs version  from /m.test(r.stdout), `an empty version is printed as it is, not as "(none)" (got ${JSON.stringify(r.stdout.slice(0, 500))})`);
  // The enforce hook: its file, its two hook groups, then what it does for an empty call.
  // This fixture is flat, as a pre-1.5.6 copy is: doctor reads it as well as a src/ one (above).
  const hooks = join(at, 'hooks', 'hooks.json'), hook = join(at, 'enforce-hook.mjs'), enf = () => doctor().stdout.split('\n').find((l) => /enforce hook|hooks\.json in/.test(l)) ?? '';
  writeFileSync(hooks, '{}');
  ok(/^PROBLEM .*enforce-hook\.mjs is missing: the enforce hook cannot run/.test(enf()), `no enforce-hook.mjs is said (got ${enf()})`);
  writeFileSync(hook, '');
  for (const [json, what, text] of [['{ not json', 'a hooks.json that is not JSON', 'has no PreToolUse group'], ['{}', 'a hooks.json with no hooks', 'has no PreToolUse group'], ['{"hooks":{}}', 'no groups', 'has no PreToolUse group'], ['{"hooks":{"PreToolUse":[]}}', 'an empty PreToolUse', 'has no PreToolUse group'],
    ['{"hooks":{"PreToolUse":[1]}}', 'no SubagentStop', 'has no SubagentStop group'], ['{"hooks":{"PreToolUse":[1],"SubagentStop":[]}}', 'an empty SubagentStop', 'has no SubagentStop group']]) {
    writeFileSync(hooks, json);
    ok(enf().startsWith('PROBLEM') && enf().includes(text), `${what}: ${text} (got ${enf()})`);
  }
  writeFileSync(hooks, '{"hooks":{"PreToolUse":[1],"SubagentStop":[1]}}');
  ok(/^ok +the enforce hook runs and is wired \(PreToolUse\)$/m.test(doctor().stdout), 'a hook that prints nothing and exits 0 is fine');
  writeFileSync(hook, 'console.log("noise");');
  ok(/^PROBLEM the enforce hook printed output for an empty call \(noise\): it must print nothing$/m.test(doctor().stdout), 'a hook that prints for an empty call is a problem');
  writeFileSync(hook, 'process.exit(3);');
  ok(/^PROBLEM the enforce hook failed an empty call \(exit code 3\): /m.test(doctor().stdout), 'a hook that exits 3 is a problem, with its code');
}

// 1.5.3 holes: how search, show and forget print what they find: the range in a line, the stores counted, a short request's reply, show's keys and exit.
{ // In this process, so the suite's own home again (an earlier tempHome moved it).
  process.env.HOME = process.env.USERPROFILE = home;
  const { render } = await import('../src/journal.mjs');
  const jd = join(root, 'C--l2', 'memory'), jcli = (...a) => run([...a, '--store', jd]);
  mkdirSync(jd, { recursive: true });
  let n = 0;
  const entry = (at, asked, over = {}) => ({ key: `l2k${n++}`, at, s: 'c0ffee12', t: 'C--l2/c0ffee12-full', branch: 'main', asked, answered: 'done', changed: [], ran: [], ...over });
  const day = (d, es) => { mkdirSync(join(jd, 'journal'), { recursive: true }); writeFileSync(join(jd, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  // A range is named with one blank before it, whether it has a start, an end or both.
  r = await jcli('search', 'zzzmissing', '--until', '2026-10-02');
  ok(/memory until 2026-10-02; --all searches every project$/m.test(r.stdout), `a miss under --until names it (got ${r.stdout})`);
  r = await jcli('search', 'zzzmissing', '--since', '2026-10-01');
  ok(/memory since 2026-10-01; --all searches every project$/m.test(r.stdout), `a miss under --since names it (got ${r.stdout})`);
  r = await jcli('search', 'zzzmissing', '--since', '2026-10-01', '--until', '2026-10-02');
  ok(/memory since 2026-10-01 until 2026-10-02; --all/m.test(r.stdout), `a miss under both names both (got ${r.stdout})`);
  r = await jcli('search', '--until', '2026-10-02');
  ok(/^no journal entry until 2026-10-02 in /m.test(r.stdout), `an empty listing names its --until (got ${r.stdout})`);
  r = await jcli('search', '--since', '2026-10-01');
  ok(/^no journal entry since 2026-10-01 in /m.test(r.stdout), `an empty listing names its --since (got ${r.stdout})`);
  // --all counts a project whose only memory is its journal, and no folder without one.
  const stores = (o) => Number(/in ([0-9]+) stores/.exec(o)?.[1]), count = async () => stores((await run(['search', 'zzzmissing', '--all'])).stdout);
  for (const x of ['a', 'b', 'c']) mkdirSync(join(root, `C--l2-${x}`, 'memory', 'journal'), { recursive: true });
  const before = await count();
  mkdirSync(join(root, 'C--l2-bare', 'memory'), { recursive: true }); writeFileSync(join(root, 'C--l2-bare', 'memory', 'loose.md'), 'no frontmatter, no journal');
  const bare = await count();
  mkdirSync(join(root, 'C--l2-only', 'memory', 'journal'), { recursive: true });
  const after = await count();
  ok(before >= 3 && bare === before && after === before + 1, `--all counts a store with a journal and no index, and a folder with neither not at all (${before}, ${bare}, ${after})`);
  for (const x of ['only', 'bare', 'a', 'b', 'c']) rmSync(join(root, `C--l2-${x}`), { recursive: true });
  // A short request (25 characters or fewer) shows the reply before it, cut at 200 characters; one character more is not short.
  const w = (c, k) => `${c}`.repeat(k);
  const exact = 'a'.repeat(150) + ' ' + 'b'.repeat(49), over = 'c'.repeat(201);
  const e1 = entry('2026-10-10 09:00', 'first of the day', { answered: exact }), e2 = entry('2026-10-10 09:00', w('y', 25), { answered: 'ok' }), e3 = entry('2026-10-10 09:00', w('z', 26), { answered: 'ok' });
  const e4 = entry('2026-10-10 09:01', 'next, long enough to be no short ask', { answered: over }), e5 = entry('2026-10-10 09:01', w('q', 25), { answered: 'ok' });
  day('2026-10-10', [e1, e2, e3, e4, e5]);
  const sh = async (e) => (await jcli('show', e.key)).stdout;
  ok(exact.length === 200 && (await sh(e2)).includes(`     Reply to key ${e1.key}: ${exact}\n`), `a reply of exactly 200 characters is quoted whole, no ellipsis (got ${await sh(e2)})`);
  ok(!/Reply to key/.test(await sh(e3)), 'a request of 26 characters is no short one');
  ok((await sh(e5)).includes(`     Reply to key ${e4.key}: …${over.slice(1)}\n`), `a reply of 201 characters is cut to its last 200 behind an ellipsis (got ${await sh(e5)})`);
  // Entries of the same minute keep the order of the day file: the reply before the second is the first.
  const t1 = entry('2026-10-11 09:00', 'one of three at one minute', { answered: 'reply one' }), t2 = entry('2026-10-11 09:00', 'ok', { answered: 'reply two' }), t3 = entry('2026-10-11 09:00', 'yes', { answered: 'reply three' });
  day('2026-10-11', [t1, t2, t3]);
  ok((await sh(t3)).includes(`Reply to key ${t2.key}: reply two`) && (await sh(t2)).includes(`Reply to key ${t1.key}: reply one`), 'entries of one minute are ordered as the day file has them');
  // The reply before a short request is the conversation's own previous entry: not another conversation's, nor a subagent's report.
  const u1 = entry('2026-10-12 10:00', 'a first question that is long enough', { answered: 'the main reply' });
  const x1 = entry('2026-10-12 10:01', 'a question in another conversation', { s: 'deadbeef', t: 'C--l2/deadbeef-full', answered: 'the other reply' });
  const sa = entry('2026-10-12 10:01', 'a subagent was asked something long', { key: 'subagent-l2', answered: 'the subagent report' });
  const u2 = entry('2026-10-12 10:02', 'ok', { answered: 'fine' });
  day('2026-10-12', [u1, x1, sa, u2]);
  ok((await sh(u2)).includes(`Reply to key ${u1.key}: the main reply`), `a short request is answered with its own conversation's previous reply (got ${await sh(u2)})`);
  // show: several keys, one unknown, nothing empty printed.
  r = await jcli('show', t1.key, t3.key);
  ok(r.status === 0 && r.stdout.includes('one of three at one minute') && r.stdout.includes('reply three'), `show takes several keys (got ${r.stdout})`);
  r = await jcli('show', t1.key, 'l2nosuch');
  ok(r.status === 1 && r.stdout.includes('one of three at one minute') && /no journal entry has the key l2nosuch and no note has that name in /.test(r.stdout), `show prints the entries it has and names the key it has not, exit 1 (got ${r.status} ${r.stdout})`);
  r = await jcli('show', t1.key);
  ok(!/^ +(Changed|Ran):/m.test(r.stdout) && /^ +Asked:/m.test(r.stdout) && /^ +Answered:/m.test(r.stdout), `show prints no line for a field that is empty (got ${r.stdout})`);
  // A range with no words lists what was asked, newest first, without the subagents' reports, as many as --limit says (30 without it).
  const g1 = entry('2026-10-20 09:00', 'range question first'), g2 = entry('2026-10-20 10:00', 'range question middle'), g3 = entry('2026-10-20 10:00', 'range question later');
  const g4 = entry('2026-10-21 08:00', 'range question last'), gs = entry('2026-10-20 11:00', 'range question by a subagent', { key: 'subagent-l2g' });
  day('2026-10-20', [g1, g2, g3, gs]); day('2026-10-21', [g4]);
  const asks = (o) => o.split('\n').filter((l) => /range question/.test(l)).map((l) => /range question (\w+)/.exec(l)[1]);
  const rng = (...a) => jcli('search', '--since', '2026-10-20', '--until', '2026-10-21', ...a);
  r = await rng();
  ok(asks(r.stdout).join() === 'last,middle,later,first' && /^4 of 4 journal entries in [^;]*$/m.test(r.stdout), `a range lists its entries newest first, a subagent's report left out (got ${r.stdout})`);
  r = await rng('--limit', '1');
  ok(asks(r.stdout).join() === 'last' && /^1 of 4 journal entries in .*; --limit N shows more$/m.test(r.stdout), `--limit 1 shows the newest only (got ${r.stdout})`);
  r = await rng('--limit', '2');
  ok(asks(r.stdout).join() === 'last,middle' && /^2 of 4 journal entries in /m.test(r.stdout), `--limit 2 shows two (got ${r.stdout})`);
  r = await rng('--limit', '0');
  ok(asks(r.stdout).length === 4 && /^4 of 4 journal entries/m.test(r.stdout), `--limit 0 is no limit (got ${r.stdout})`);
  // A search that cannot read one day still prints the hits, and names the day before the count: the count and the last line stay last.
  mkdirSync(join(jd, 'journal', '2026-10-09.md'));
  r = await jcli('search', 'three');
  const ls = r.stdout.trimEnd().split('\n');
  ok(/^could not read .*2026-10-09.md: /.test(ls.at(-3)) && /^2 of 2 match/.test(ls.at(-2)) && ls.at(-1) === 'Not the entry you meant? Search again with other words.', `a day that cannot be read is named above the count, and the count and the last line stay last (got ${r.stdout})`);
  // A miss names the unreadable day above its one line, too.
  r = await jcli('search', 'zzznomatchatall');
  const lm = r.stdout.trimEnd().split(/\r?\n/);
  ok(/^could not read .*2026-10-09.md: /.test(lm.at(-2)) && /^nothing matches "zzznomatchatall"/.test(lm.at(-1)), `a miss names the day it could not read above its last line (got ${r.stdout})`);
  rmSync(join(jd, 'journal', '2026-10-09.md'), { recursive: true });
}

// 1.5.3 holes: an incognito run on a conversation already swept sweeps it again (what the conversation wrote since is not left in the journal).
{
  const h = tempHome('incog3-'), pr = join(h.home, '.claude', 'projects'), proj = join(pr, 'C--ig3'), d = join(proj, 'memory'), SID = 'ffffffff-6666';
  const { render } = await import('../src/journal.mjs');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, `${SID}.jsonl`), [{ type: 'user', text: 'tell me about narwhal tusks' }, { type: 'assistant', text: 'a tusk is a tooth' }].map((m) => JSON.stringify({ type: m.type, cwd: 'C:\ig3', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: m.text }] } })).join('\n') + '\n');
  const inc = () => spawnSync(process.execPath, [CLI, 'incognito', '--session', SID], { env: h.env, encoding: 'utf8' });
  let r = inc();
  ok(r.status === 0, `incognito is applied (got ${r.status} ${r.stdout}${r.stderr.slice(0, 200)})`);
  // An entry of the conversation that reached the journal after that sweep: the next incognito takes it out again.
  const e = { key: 'ig3key01', at: '2026-10-12 09:00', s: 'ffffffff', t: `C--ig3/${SID}`, branch: 'main', asked: 'late pelican question', answered: 'pelican answer', changed: [], ran: [] };
  mkdirSync(join(d, 'journal'), { recursive: true });
  writeFileSync(join(d, 'journal', '2026-10-12.md'), `# Journal 2026-10-12\n\n${render(e)}\n`);
  r = inc();
  ok(r.status === 0 && !existsSync(join(d, 'journal', '2026-10-12.md')), `a second incognito sweeps what came after the first (got ${r.status} ${r.stdout})`);
}

// 1.5.3 holes: a forget --purge of what the journal no longer holds takes the days that held every word, and says so; a failed purge, and a store another hook holds.
{
  process.env.HOME = process.env.USERPROFILE = home;
  const { render } = await import('../src/journal.mjs');
  const pd = join(root, 'C--purge2', 'memory'), wa = 'aardvark-' + 'purge', wb = 'bonobo-' + 'purge', J = join(pd, 'journal');
  mkdirSync(J, { recursive: true });
  const e = (d, asked) => ({ key: `pg${d}`, at: `${d} 10:00`, s: 'c0ffee12', t: 'C--purge2/c0ffee12-full', branch: 'main', asked, answered: 'noted', changed: [], ran: [] });
  const day = (d, asked) => writeFileSync(join(J, `${d}.md`), `# Journal ${d}\n\n${render(e(d, asked))}\n`);
  const both = [1, 2, 3, 4, 5, 6, 7].map((n) => `2020-02-0${n}`);
  for (const d of both) day(d, `remember ${wa} and ${wb}`);
  day('2020-02-08', `remember ${wa}`); day('2020-02-09', `remember ${wb}`);
  writeFileSync(join(J, 'keep.md'), `a note that is no day: ${wa} ${wb}\n`);
  writeFileSync(join(pd, 'MEMORY.md'), '# Memory Index\n');
  tier(); tier();
  const days = (w) => spawnSync('git', ['-C', root, 'log', '--all', '-i', '--format=', '--name-only', '-S' + w], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((p) => p.split('/').pop()).sort();
  ok(days(wa).includes('2020-02-08.md') && days(wb).includes('2020-02-01.md') && days(wa).includes('keep.md'), `fixture: the snapshots hold the days and the loose file (got ${days(wa)})`);
  // The journal no longer holds them: the days are gone from it.
  for (const d of [...both, '2020-02-08', '2020-02-09']) rmSync(join(J, `${d}.md`));
  // A purge that cannot run is said, exit 1, and takes nothing.
  writeFileSync(join(root, '.git', 'HEAD.lock'), '');
  let r = await run(['forget', wa, wb, '--yes', '--purge', '--store', pd]);
  rmSync(join(root, '.git', 'HEAD.lock'));
  ok(r.status === 1 && /the snapshots could not be purged \(a snapshot is being taken; try again in a moment\)/.test(r.stdout) && days(wa).includes('2020-02-01.md'), `a purge that cannot run says so and takes nothing (got ${r.status} ${r.stdout})`);
  // Words with no day in common purge nothing.
  r = await run(['forget', wa, 'zzznoword-purge', '--yes', '--purge', '--store', pd]);
  ok(r.status === 0 && /^nothing in .* matches: no entry holds "aardvark-purge", "zzznoword-purge"$/m.test(r.stdout) && !/purged/.test(r.stdout) && days(wa).includes('2020-02-01.md'), `words that no day holds together purge nothing (got ${r.stdout})`);
  // The days that held every word, by day files only, six named and the rest counted.
  r = await run(['forget', wa, wb, '--yes', '--purge', '--store', pd]);
  ok(r.status === 0 && r.stdout.includes('the journal of ' + pd + ' no longer holds it; purged the journal of 2020-02-01, 2020-02-02, 2020-02-03, 2020-02-04, 2020-02-05, 2020-02-06, and 1 more from the snapshots'), `the days that held both words go, six named (got ${r.stdout})`);
  ok(days(wa).join() === '2020-02-08.md,keep.md' && days(wb).join() === '2020-02-09.md,keep.md', `the days that held one word, and a file that is no day, stay in the snapshots (got ${days(wa)} and ${days(wb)})`);
  // A store another hook holds: forget --yes is busy and removes nothing.
  day('2020-02-10', `remember ${wa}`);
  mkdirSync(join(pd, '.lock'));
  r = await run(['forget', wa, '--yes', '--store', pd]);
  rmSync(join(pd, '.lock'), { recursive: true });
  ok(r.status === 1 && r.stdout.includes(`${pd} is busy (another hook holds it); try again`) && existsSync(join(J, '2020-02-10.md')), `forget in a store another hook holds is busy and removes nothing (got ${r.status} ${r.stdout})`);
}


// 99b. search --file, --asked and --conversation: five made-up entries, two conversations, one helper, one private turn.
{
  const { render } = await import('../src/journal.mjs');
  const sd = join(root, 'C--flt', 'memory'), sj = join(sd, 'journal'), hd = join(root, 'C--flt-helper', 'memory');
  const fcli = (...a) => run([...a, '--store', sd]);
  const at = (a, b, c, d, e) => ({ key: a, at: b, s: c.slice(0, 8), t: `C--flt/${c}`, branch: '', asked: d, answered: e[0], changed: e.slice(1), ran: [] });
  const A = at('kA', '2026-10-20 09:00', 'aaaa1111-0000', 'keep four decimals in cart totals', ['done, the tax export needs them', 'src/cart.js']);
  const B = at('kB', '2026-10-20 10:00', 'aaaa1111-0000', 'add a wishlist', ['the cart totals are untouched', 'src/wishlist.js']);
  const C = at('kC', '2026-10-21 09:00', 'bbbb2222-0000', 'round cart totals', ['rounded to two decimals', 'src/cart.js', 'test/cart.test.js']);
  const D = at('subagent-x1', '2026-10-21 10:00', 'bbbb2222-0000', 'Subagent explore: find cart totals', ['cart totals are in src/cart.js']);
  const E = at('kE', '2026-10-21 11:00', 'bbbb2222-0000', '[private]', ['[private]']);
  const write = (d, xs) => { mkdirSync(join(d, 'journal'), { recursive: true });
    for (const day of new Set(xs.map((x) => x.at.slice(0, 10)))) writeFileSync(join(d, 'journal', `${day}.md`), `# Journal ${day}\n\n${xs.filter((x) => x.at.startsWith(day)).map(render).join('\n\n')}\n`); };
  write(sd, [A, B, C, D, E]); write(hd, [D]);
  const where = `${sd} and ${shared}`, left = '; notes are left out with --file, --asked and --conversation';
  const keys = (r) => [...r.stdout.matchAll(/^ {5}key: (.+)$/gm)].map((m) => m[1]);
  const asked = (r) => [...r.stdout.matchAll(/^\d{4}-\d\d-\d\d \d\d:\d\d {2}conversation \S+ {2}(.*)$/gm)].map((m) => m[1]);
  // words + --asked: B says "cart totals" only in its answer, D is a helper
  let r = await fcli('search', 'cart', 'totals', '--asked');
  ok(r.status === 0 && keys(r).sort().join() === 'kA,kC' && r.stdout.includes(`2 of 2 match(es) in ${where}; --all searches every project; show '<key>' prints an entry whole${left}\n`), `--asked scores the request only, leaves helpers out, and says notes are left out (got ${r.stdout}${r.stderr})`);
  ok(keys(await fcli('search', 'cart', 'totals')).sort().join() === 'kA,kB,kC,subagent-x1', 'without --asked the answer and the helper count as today');
  // a private turn is never an --asked hit
  r = await fcli('search', 'private', '--asked');
  ok(r.status === 0 && r.stdout === `nothing matches "private" in ${where}; --all searches every project\n`, `a private turn is never an --asked hit (got ${r.stdout}${r.stderr})`);
  // words + --file: the end of a path counts only at a folder
  ok(keys(await fcli('search', 'totals', '--file', 'cart.js')).sort().join() === 'kA,kC', '--file keeps the entries that changed it');
  r = await fcli('search', 'totals', '--file', 'art.js');
  ok(r.stdout === `no entry changed art.js in ${where}; try the file's name alone, the journal holds paths as the session saw them\n`, `a name inside another is no match (got ${r.stdout})`);
  // words + --conversation
  ok(keys(await fcli('search', 'cart', '--conversation', 'aaaa')).sort().join() === 'kA,kB', '--conversation keeps one conversation');
  // filters alone are a list, newest first
  r = await fcli('search', '--file', 'src/cart.js');
  ok(r.status === 0 && asked(r).join('|') === 'round cart totals|keep four decimals in cart totals' && r.stdout.endsWith(`2 of 2 journal entries in ${where}\n`), `--file alone lists newest first (got ${r.stdout}${r.stderr})`);
  r = await fcli('search', '--conversation', 'bbbb2222');
  ok(asked(r).join('|') === '[private]|Subagent explore: find cart totals|round cart totals', `--conversation alone lists a helper's report too (got ${r.stdout}${r.stderr})`);
  r = await fcli('search', '--asked');
  ok(asked(r).join('|') === 'round cart totals|add a wishlist|keep four decimals in cart totals', `--asked alone lists the user's requests: no helper, no private turn (got ${r.stdout}${r.stderr})`);
  // together
  r = await fcli('search', '--asked', '--file', 'cart.js', '--since', '2026-10-21');
  ok(asked(r).join('|') === 'round cart totals', `the filters and a range hold together (got ${r.stdout}${r.stderr})`);
  // a day the filter finds nothing on
  r = await fcli('search', '--conversation', 'cccc');
  ok(r.stdout === `no journal entry in ${where}\n`, `a list that finds nothing says so (got ${r.stdout})`);
  // only helpers
  r = await run(['search', 'cart', '--asked', '--store', hd]);
  ok(r.status === 0 && /^nothing matches "cart" in /.test(r.stdout), `a journal of helpers only, searched with --asked, is a miss (got ${r.stdout}${r.stderr})`);
}

// 99c. The three search filters as options: their values, the help text.
{
  const sd = join(root, 'C--flt', 'memory');
  const fcli = (...a) => run([...a, '--store', sd]);
  let r = await fcli('search', 'cart', '--file');
  ok(r.status === 1 && r.stdout === '--file needs a value after it\n', `a filter without its value is refused (got ${r.stdout})`);
  r = await fcli('show', 'x', '--asked');
  ok(r.status === 1 && r.stdout === 'show does not take --asked; help lists the options\n', `show does not take --asked (got ${r.stdout})`);
  ok((await fcli('search', '--file=src/cart.js')).stdout === (await fcli('search', '--file', 'src/cart.js')).stdout, '--file=PATH is --file PATH');
  r = await fcli('search', '--file', 'a.js', '--file', 'src/cart.js');
  ok(r.stdout.startsWith('no entry changed a.js in '), `given twice, the first value wins (got ${r.stdout})`);
  for (const empty of [['--file', ''], ['--file=']]) {
    r = await fcli('search', 'cart', ...empty);
    ok(r.status === 1 && r.stdout === '--file needs a value after it\n', `an empty ${empty.join(' ')} is refused, not ignored (got ${r.stdout})`);
  }
  for (const short of [['--conversation', 'abc'], ['--conversation=a']]) {
    r = await fcli('search', 'cart', ...short);
    ok(r.status === 1 && r.stdout === '--conversation needs at least 4 characters of the id\n', `${short.join(' ')} is too short to name a conversation (got ${r.stdout})`);
  }
  ok(!(await fcli('search', 'cart', '--conversation', 'beef')).stdout.includes('at least 4'), 'four characters are enough');
  ok(!(await fcli('forget', 'cart', '--conversation', 'abc')).stdout.includes('at least 4'), 'forget keeps its own rule');
  ok((await run(['help'])).stdout.includes('  search [terms...] [--file <path>] [--asked] [--conversation <id>] [--since D] [--until D] [--all] [--limit N]\n'), 'the help lists the three filters');
}
// who said it: history and show name the exchange behind a note.
{
  const { render } = await import('../src/journal.mjs');
  const wd = join(root, 'C--who', 'memory'), nj = join(root, 'C--nojournal', 'memory'), wcli = (...a) => run([...a, '--store', wd]);
  mkdirSync(wd, { recursive: true }); mkdirSync(nj, { recursive: true });
  const pad = (v) => String(v).padStart(2, '0'), d5 = new Date(Date.now() - 5 * 60000);
  const today = `${d5.getFullYear()}-${pad(d5.getMonth() + 1)}-${pad(d5.getDate())}`, at = `${today} ${pad(d5.getHours())}:${pad(d5.getMinutes())}`;
  const mk = (key, asked, note, over = {}) => ({ key, at, s: '3f07bb43', t: 'C--who/3f07bb43-aaaa', branch: '', asked, answered: 'done', changed: [join(wd, `${note}.md`)], ran: [], ...over });
  const GHT = ['gh', 'p_', 'Zq8Xk2Lm4Nv6Bt1Rw3Ys5Df7Gh9Jk0Pa2Cd4'].join('');
  const es = [mk('who-1', 'save that as a rule', 'rules'), mk('who-2', 'y'.repeat(300), 'long'), mk('who-3', `keep ${GHT} in the note`, 'leaky'), mk('who-4', 'first of two', 'twice'), mk('who-5', 'second of two', 'twice'), mk('who-6\x1b]0;x\x07', 'clear \x1b[2J then \x1b]0;x\x07 and \u202eevil', 'ctl')];
  const writeDay = (store, list) => { mkdirSync(join(store, 'journal'), { recursive: true }); writeFileSync(join(store, 'journal', `${today}.md`), `# Journal ${today}\n\n${list.map(render).join('\n\n')}\n`); };
  for (const n of ['rules', 'long', 'leaky', 'twice', 'ctl']) memory(wd, n, n, 'v1');
  memory(nj, 'bare-note', 'no journal here', 'v1');
  tier();
  writeDay(wd, es);
  // By hand, so the file's time is now: a note a quarter hour old is not snapshotted again.
  for (const [d, n] of [[wd, 'rules'], [wd, 'long'], [wd, 'leaky'], [wd, 'twice'], [wd, 'ctl'], [nj, 'bare-note']]) writeFileSync(join(d, `${n}.md`), `---\nname: ${n}\ndescription: "${n}"\n---\n\nv2\n`);
  tier();
  const NONE = '    by: no exchange found (changed by hand, by a shell command, by a helper or by the plugin\'s own sorting)';
  r = await wcli('history', 'rules');
  const L = r.stdout.split('\n');
  const snaps = L.map((l, i) => [l, i]).filter(([l]) => /^  \w+ \d{4}-\d\d-\d\d \d\d:\d\d  (added|changed)$/.test(l));
  ok(r.status === 0 && snaps.length === 2 && L[snaps[0][1] + 1] === NONE && /^    by: \d{4}-\d\d-\d\d \d\d:\d\d \[3f07bb43\] asked: "save that as a rule" · key: "who-1"$/.test(L[snaps[1][1] + 1]),
    `history gives the older snapshot its exchange and the newer, a change by hand, none (got ${r.stdout})`);
  r = await run(['history', 'bare-note', '--store', nj]);
  ok(r.status === 0 && (r.stdout.match(/^ {4}by: no exchange found/gm) || []).length === 2, `with no journal every snapshot says no exchange was found (got ${r.stdout})`);
  r = await wcli('history', 'rules', '--limit', '1');
  ok(/^ {4}by: no exchange found/m.test(r.stdout) && /^  and 1 older; --limit N shows more$/m.test(r.stdout) && !/who-1/.test(r.stdout), `--limit cuts the list after the snapshots are paired (got ${r.stdout})`);
  // --limit 1 reads only the journal days from the snapshot just older than the one shown: a day file before that is never opened.
  mkdirSync(join(wd, 'journal', '2001-01-01.md'));
  ok(/could not read/.test((await wcli('history', 'rules')).stdout), 'all the journal days are read when every snapshot is shown');
  r = await wcli('history', 'rules', '--limit', '1');
  ok(!/could not read/.test(r.stdout) && /^  and 1 older/m.test(r.stdout), `--limit 1 opens no journal day older than the snapshot below it (got ${r.stdout})`);
  rmSync(join(wd, 'journal', '2001-01-01.md'), { recursive: true });
  r = await wcli('history', 'long');
  ok(r.stdout.includes(`asked: "${'y'.repeat(99)}…" `) && !r.stdout.includes('y'.repeat(101)), `a long request is cut to 100 characters (got ${r.stdout})`);
  r = await wcli('history', 'leaky');
  ok(!r.stdout.includes(GHT) && /asked: "keep \[redacted\] in the note"/.test(r.stdout), `a request holding a secret prints redacted (got ${r.stdout})`);
  r = await wcli('history', 'twice');
  ok(!/who-[45]|first of two|second of two/.test(r.stdout), `two exchanges before the oldest snapshot: neither is named (got ${r.stdout})`);
  r = await wcli('history', 'ctl');
  ok(/by: .*asked: "clear \uFFFD\[2J then \uFFFD\]0;x\uFFFD and \uFFFDevil"/.test(r.stdout) && !/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(r.stdout.replace(/\r?\n/g, '')), `escape codes and bidi controls in a request print as U+FFFD (got ${JSON.stringify(r.stdout)})`);
  // The shared store: its edits are in the project journals, which are not read for it, so "changed by hand" would be false.
  mkdirSync(shared, { recursive: true });
  memory(shared, 'pm-lesson', 'a lesson', 'v1');
  tier();
  writeFileSync(join(shared, 'pm-lesson.md'), '---\nname: pm-lesson\ndescription: "a lesson"\n---\n\nv2\n');
  tier();
  const SHARED = 'by: not looked up for the shared store (what changed it is in the project journals)';
  r = await run(['history', 'pm-lesson', '--store', shared]);
  ok(r.status === 0 && (r.stdout.match(new RegExp(`^ {4}${SHARED.replace(/[()]/g, '\\$&')}$`, 'gm')) || []).length === 2 && !/changed by hand/.test(r.stdout), `history of a shared note says it did not look (got ${r.stdout})`);
  r = await run(['show', 'pm-lesson', '--store', shared]);
  ok(r.status === 0 && r.stdout.endsWith(`\n  ${SHARED}\n`), `show of a shared note says it did not look (got ${r.stdout})`);
  // A deleted note: an entry sent in the deletion's minute is not named for it.
  memory(wd, 'gone', 'gone', 'v1');
  tier();
  unlinkSync(join(wd, 'gone.md'));
  tier();
  const dline = (await wcli('history', 'gone')).stdout.match(/^  \w+ (\d{4}-\d\d-\d\d \d\d:\d\d)  deleted$/m);
  writeDay(wd, [...es, mk('who-g', 'remove gone', 'gone', { at: dline?.[1] }), mk('who-del', 'delete gone', 'gone', { at: dline?.[1] })]);
  r = await wcli('history', 'gone');
  const G = r.stdout.split('\n'), di = G.findIndex((l) => /  deleted$/.test(l));
  ok(dline && di >= 0 && G[di + 1] === NONE, `a deleted note's snapshot names no exchange (got ${r.stdout})`);
}
// show <note>: the first and the newest exchange behind a note, when no entry has that name as its key.
{
  const { render } = await import('../src/journal.mjs');
  const sd = join(root, 'C--show', 'memory'), scli = (...a) => run([...a, '--store', sd]);
  mkdirSync(join(sd, 'journal'), { recursive: true });
  memory(sd, 'rules', 'how we write rules'); memory(sd, 'quiet', 'nothing changed it');
  const mk = (key, t, asked, over = {}) => ({ key, at: `2026-11-12 ${t}`, s: '3f07bb43', t: 'C--show/3f07bb43-aaaa', branch: '', asked, answered: 'done', changed: [join(sd, 'rules.md')], ran: [], ...over });
  const three = [mk('s-10', '10:00', 'first ask'), mk('s-11', '11:00', 'second ask'), mk('s-12', '12:00', 'third ask')];
  const put = (list) => writeFileSync(join(sd, 'journal', '2026-11-12.md'), `# Journal 2026-11-12\n\n${list.map(render).join('\n\n')}\n`);
  const NONE = "by: no exchange found (changed by hand, by a shell command, by a helper or by the plugin's own sorting)";
  put([mk('rules', '09:00', 'an entry named like the note', { changed: [] }), ...three]);
  r = await scli('show', 'rules');
  ok(r.status === 0 && /^     Asked: an entry named like the note$/m.test(r.stdout) && !/first by/.test(r.stdout), `a key wins over a note's name (got ${r.stdout})`);
  put(three);
  const want = [join(sd, 'rules.md'), '  name: rules', '  description: how we write rules',
    '  first by: 2026-11-12 10:00 [3f07bb43] asked: "first ask" · key: "s-10"', '  last exchange that changed it: 2026-11-12 12:00 [3f07bb43] asked: "third ask" · key: "s-12"'].join('\n') + '\n';
  r = await scli('show', 'rules');
  ok(r.status === 0 && r.stdout === want, `show <note> prints its path, name, description and the first and the newest exchange (got ${r.stdout})`);
  ok((await scli('show', 'rules.md')).stdout === want, 'with .md the same');
  r = await scli('show', 'quiet');
  ok(r.status === 0 && r.stdout === `${join(sd, 'quiet.md')}\n  name: quiet\n  description: nothing changed it\n  ${NONE}\n`, `a note nothing changed says so (got ${r.stdout})`);
  put(three.slice(0, 1));
  ok((await scli('show', 'rules')).stdout.endsWith(`\n  by: 2026-11-12 10:00 [3f07bb43] asked: "first ask" · key: "s-10"\n`), 'one exchange is one by: line');
  put(three);
  r = await scli('forget', '--key', 's-12', '--yes');
  r = await scli('show', 'rules');
  ok(/^  last exchange that changed it: .*key: "s-11"$/m.test(r.stdout) && !/s-12|third ask/.test(r.stdout), `a forgotten entry is never named (got ${r.stdout})`);
  r = await scli('show', 'no-such-thing');
  ok(r.status === 1 && /^no journal entry has the key no-such-thing and no note has that name in .+; --all looks in every project$/m.test(r.stdout), `neither a key nor a note: the miss names both (got ${r.stdout})`);
}
// 1.5.4 the page: `memory page` writes one local HTML file of the journal and prints its link; forget, incognito, off and rescan --apply delete it.
{
  const { render } = await import('../src/journal.mjs');
  const { pagePath, dropPage, local } = await import('../src/store.mjs');
  const saved = process.env.CLAUDE_CONFIG_DIR, cfg = join(tempDir('page-'), 'my config é');
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const proot = join(cfg, 'projects'), ago = (n) => local(Date.now() - n * 864e5).slice(0, 10);
    // A made-up project: its folder, the first line of a conversation file (where its name comes from), and its journal days.
    const proj = (folder, cwd, days) => {
      const d = join(proot, folder, 'memory', 'journal');
      mkdirSync(d, { recursive: true });
      if (cwd) writeFileSync(join(proot, folder, 'c0ffee12-aaaa.jsonl'), `${JSON.stringify({ type: 'user', cwd })}\n`);
      for (const [day, es] of Object.entries(days)) writeFileSync(join(d, `${day}.md`), `# Journal ${day}\n\n${es.map(render).join('\n\n')}\n`);
      return join(proot, folder, 'memory');
    };
    const ent = (folder, key, day, hm, o = {}) => ({ key, at: `${day} ${hm}`, s: 'c0ffee12', t: `${folder}/c0ffee12-aaaa`, branch: 'main', asked: `question ${key}`, answered: `answer ${key}`, changed: [], ran: [], ...o });
    const shop = proj('C--work-bookshop', 'C:\\work\\bookshop', {
      [ago(1)]: [ent('C--work-bookshop', 'bs1', ago(1), '10:00', { asked: 'add the basket page', changed: ['src/basket.js', `${proot.replaceAll('\\', '/')}/C--work-bookshop/memory/notes.md`] }),
        ent('C--work-bookshop', 'bs2', ago(1), '11:00', { answered: 'long answer '.repeat(500), changed: [`${proot}\\C--work-bookshop\\memory\\handoff.md`, `${proot}/C--work-bookshop/memory/journal/${ago(1)}.md`] }),
        ent('C--work-bookshop', 'subagent-bs3', ago(1), '12:00', { asked: 'helper question' })],
      [ago(5)]: [ent('C--work-bookshop', 'bs4', ago(5), '09:00', { asked: 'older basket work' })],
    });
    proj('C--work-garden', '/home/x/garden-site', { [ago(2)]: [ent('C--work-garden', 'gs1', ago(2), '08:00', { asked: 'water the tomato page', answered: '[private]' })] });
    const off = proj('C--work-hidden', '/home/x/hidden', { [ago(1)]: [ent('C--work-hidden', 'hd1', ago(1), '07:00', { asked: 'a switched-off project' })] });
    const page = async (...a) => run(['page', ...a]);
    const dataOf = (html) => { const i = html.indexOf('const DATA='), j = html.indexOf(';\n', i); return JSON.parse(html.slice(i + 11, j)); };
    const write = async (...a) => { const r = await page(...a); return { ...r, html: existsSync(pagePath()) ? readFileSync(pagePath(), 'utf8') : '' }; };
    ok((await run(['off', '--store', off])).status === 0, 'fixture: one project is switched off');

    let r = await write();
    const lines = r.stdout.trimEnd().split('\n');
    ok(r.status === 0 && lines.length === 4 && lines[0] === pathToFileURL(pagePath()).href && /^4 exchanges in 2 projects over 30 days, \d+(\.\d)? (B|KB)$/.test(lines[1]), `written: the link, the counts, what was left out, the hint (got ${r.status} ${r.stdout})`);
    ok(lines[2] === 'left out: 1 helper entry, 1 switched-off project' && /^Open the link in a browser\. Run memory page again to refresh it\. forget, incognito, off and rescan --apply delete it\.$/.test(lines[3]), `and says what it left out and how to refresh and remove it (got ${lines.slice(2).join(' | ')})`);
    ok(/%20config%20%C3%A9/.test(lines[0]) && existsSync(pagePath()), 'the link of a folder with a space and an accent is a valid file URL');
    if (process.platform !== 'win32') ok((statSync(pagePath()).mode & 0o777) === 0o600, 'the file is readable by its owner only');
    let data = dataOf(r.html);
    const by = Object.fromEntries(data.entries.map((e) => [e.d + e.t, e]));
    ok(data.days === 30 && data.today === local().slice(0, 10) && data.entries.length === 4 && data.entries.map((e) => e.d).join() === [ago(1), ago(1), ago(2), ago(5)].join(), `newest first, the helper and the switched-off project are not in it (got ${JSON.stringify(data.entries.map((e) => e.q))})`);
    ok(!/helper question|a switched-off project/.test(r.html), 'their text is nowhere in the file');
    ok(by[ago(1) + '10:00'].p === 'bookshop' && by[ago(2) + '08:00'].p === 'garden-site', 'a project is named by the folder its conversations started in');
    ok(by[ago(1) + '10:00'].n === 1 && by[ago(1) + '11:00'].n === 0 && by[ago(5) + '09:00'].n === 0, 'an exchange that wrote a note of the store is marked; handoff.md and the journal are not notes');
    ok(by[ago(1) + '11:00'].cut === 1 && by[ago(1) + '11:00'].a.length < 4200 && by[ago(1) + '10:00'].cut === 0, 'an answer past 4000 characters is cut, and marked');
    ok(by[ago(2) + '08:00'].priv === 1 && by[ago(2) + '08:00'].q === '' && by[ago(2) + '08:00'].a === '', 'a private turn has no text in the page');

    // --days: a number of days or all.
    r = await write('--days', '3');
    ok(r.status === 0 && dataOf(r.html).entries.length === 3 && /over 3 days/.test(r.stdout), `--days 3 keeps the last three days (got ${r.stdout})`);
    r = await write('--days', 'all');
    ok(r.status === 0 && dataOf(r.html).days === 'all' && dataOf(r.html).entries.length === 4 && /over all days/.test(r.stdout), `--days all keeps every day (got ${r.stdout})`);
    for (const bad of ['0', 'ten', '1.5', '-3']) {
      const g = await page('--days', bad);
      ok(g.status === 1 && g.stdout.trim() === `--days takes a number of days or all, not ${bad}`, `--days ${bad} is refused (got ${g.status} ${g.stdout})`);
    }
    r = await write('--days', '99999999999999999999');
    ok(r.status === 0 && dataOf(r.html).entries.length === 4, 'a huge number of days is the whole journal, no error');

    // --project: a name or its folder, any case.
    r = await write('--project', 'BookShop');
    ok(r.status === 0 && dataOf(r.html).entries.length === 3 && /in 1 project /.test(r.stdout), `--project names a project, in any case (got ${r.stdout})`);
    r = await write('--project', 'c--work-garden');
    ok(r.status === 0 && dataOf(r.html).entries.map((e) => e.p).join() === 'garden-site', 'or its folder name');
    r = await page('--project', 'nope');
    ok(r.status === 1 && r.stdout.trim() === 'no project named nope. Projects with a journal: bookshop, garden-site', `a miss names the projects there are, not the switched-off one (got ${r.stdout})`);

    // Nothing to show: no file.
    dropPage();
    r = await page('--project', 'garden-site', '--days', '1');
    ok(r.status === 1 && r.stdout.trim() === 'nothing to show: no journal entry in the last 1 day' && !existsSync(pagePath()), `nothing in the range: said, exit 1, no file (got ${r.status} ${r.stdout})`);
    dropPage();

    // A project that is switched off is said so, not "nothing to show".
    r = await page('--project', 'hidden');
    ok(r.status === 1 && r.stdout.trim() === 'hidden is switched off (memory on to include it)' && !existsSync(pagePath()), `--project on a switched-off project says so (got ${r.status} ${r.stdout})`);

    // A day that cannot be read is named, exit 1; the rest is still shown.
    writeFileSync(join(shop, 'journal', `${ago(3)}.md`), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Journal\n', 'utf16le')]));
    r = await write();
    ok(r.status === 1 && new RegExp(`^could not read .*${ago(3)}\\.md: `, 'm').test(r.stdout) && dataOf(r.html).entries.length === 4, `an unreadable day is named and fails, and the page has the rest (got ${r.status} ${r.stdout})`);
    rmSync(join(shop, 'journal', `${ago(3)}.md`));

    // Options it does not take, and the help.
    r = await page('--since', ago(3));
    ok(r.status === 1 && /^page does not take --since/.test(r.stdout), `an option of another command is refused (got ${r.stdout})`);
    r = await run(['help']);
    ok(/^ {2}page \[--days N\|all\] \[--project NAME\]/m.test(r.stdout), 'help lists page');

    // Where the journal is forgotten, the page goes.
    const drops = [['forget', '--key', 'bs4', '--yes', '--store', shop], ['off', '--store', shop], ['rescan', '--apply', '--yes'], ['incognito']];
    for (const args of drops) {
      await write();
      ok(existsSync(pagePath()), `fixture: a page before ${args[0]}`);
      await run(args);
      ok(!existsSync(pagePath()), `${args.join(' ')} deletes the page`);
    }
    await write();
    await run(['rescan']);
    await run(['rescan', '--apply']);
    await run(['on', '--store', shop]);
    ok(existsSync(pagePath()), 'rescan without --apply, rescan --apply without --yes (it changes nothing), and on, leave it');

    // The page holds each live store's lock from its read to its write, so a forget cannot slip between and be undone by the write.
    dropPage();
    mkdirSync(join(shop, '.lock'));
    r = await page();
    ok(r.status === 1 && /is busy/.test(r.stdout) && !existsSync(pagePath()), `a store another hook holds is said, and no page is written (got ${r.status} ${r.stdout})`);
    rmSync(join(shop, '.lock'), { recursive: true });
    r = await write();
    ok(r.status === 0 && !existsSync(join(shop, '.lock')) && !existsSync(join(proot, 'C--work-garden', 'memory', '.lock')), 'a free store is locked for the run and left free');

    // A page past the size limit is not written: 20,000 entries made 129 MB.
    const { PAGE_LIMIT } = await import('../src/memory.mjs'), kept = PAGE_LIMIT.bytes;
    PAGE_LIMIT.bytes = 1000; dropPage();
    try { r = await page(); } finally { PAGE_LIMIT.bytes = kept; }
    ok(r.status === 1 && /^the page would be \d+(\.\d)? (KB|MB), over the limit of 1000 B; nothing written\. Use --days N for fewer days/.test(r.stdout) && !existsSync(pagePath()), `past the limit it says so, and writes nothing (got ${r.status} ${r.stdout})`);

    // The stores' locks are held only to read and to write: a page too big by its fields is refused before it is built, and a day that
    // changed while it was built is not overwritten (a forget or a sweep in between would be undone by the write).
    let built = 0;
    PAGE_LIMIT.bytes = 1000; PAGE_LIMIT.built = () => { built++; };
    try { r = await page(); } finally { PAGE_LIMIT.bytes = kept; PAGE_LIMIT.built = null; }
    ok(r.status === 1 && /^the page would be \d/.test(r.stdout) && built === 0, `the estimate from the entries' fields refuses before the page is built (built ${built} times; got ${r.stdout})`);
    await write(); const whole = statSync(pagePath()).size; dropPage();
    PAGE_LIMIT.bytes = whole - 1; PAGE_LIMIT.built = () => { built++; };
    try { r = await page(); } finally { PAGE_LIMIT.bytes = kept; PAGE_LIMIT.built = null; }
    ok(r.status === 1 && /^the page would be \d/.test(r.stdout) && built === 1 && !existsSync(pagePath()), `and the built page is checked against the limit too (built ${built}; got ${r.stdout})`);
    // What blocks the write is a dropPage (forget, a sweep, off, incognito, rescan --apply --yes) while the page was built, not a day
    // file that changed: a reply saved in between rewrites today's day and forgets nothing.
    const CHANGED = 'the journal changed while the page was built; run memory page again';
    const tokens = () => readdirSync(dirname(pagePath())).filter((n) => /^journal\.html\..+\.reading$/.test(n));
    PAGE_LIMIT.built = () => dropPage();
    try { r = await page(); } finally { PAGE_LIMIT.built = null; }
    ok(r.status === 1 && r.stdout.trim() === CHANGED && !existsSync(pagePath()) && !tokens().length, `a dropPage while the page was built: said, exit 1, no page, no token left (got ${r.status} ${r.stdout})`);
    PAGE_LIMIT.built = () => appendFileSync(join(shop, 'journal', `${ago(5)}.md`), '\n');
    try { r = await page(); } finally { PAGE_LIMIT.built = null; }
    ok(r.status === 0 && existsSync(pagePath()) && !tokens().length && !existsSync(join(shop, '.lock')), `a day file that changed meanwhile still writes it (got ${r.status} ${r.stdout})`);
    // A dropPage between the claim check and the rename: the claim is gone once the page is written, so the page goes too.
    PAGE_LIMIT.written = () => rmSync(`${pagePath()}.${process.pid}.reading`);
    try { r = await page(); } finally { PAGE_LIMIT.written = null; }
    ok(r.status === 1 && r.stdout.trim() === CHANGED && !existsSync(pagePath()) && !tokens().length && !readdirSync(dirname(pagePath())).some((n) => /.tmp$/.test(n)), `a dropPage between the claim check and the rename: the page just written is deleted (got ${r.status} ${r.stdout})`);
    dropPage();
    PAGE_LIMIT.built = () => { const o = spawnSync(process.execPath, [CLI, 'off', '--store', shop], { encoding: 'utf8' }); if (o.status !== 0) throw new Error(`fixture: off failed ${o.stdout}${o.stderr}`); };
    try { r = await page(); } finally { PAGE_LIMIT.built = null; }
    ok(r.status === 1 && r.stdout.trim() === CHANGED && !existsSync(pagePath()) && !tokens().length, `memory off while the page was built: no page (got ${r.status} ${r.stdout})`);
    await run(['on', '--store', shop]);
    r = await write();
    ok(r.status === 0 && !existsSync(join(shop, '.lock')) && !tokens().length, 'and run again it is written');

    // A page that will not go is said, and fails the command: the text is still on disk.
    await write();
    rmSync(pagePath()); mkdirSync(join(pagePath(), 'x'), { recursive: true });
    r = await run(['off', '--store', shop]);
    ok(r.status === 1 && /^could not delete the page: /m.test(r.stdout), `a page that will not go is named and the command fails (got ${r.status} ${r.stdout})`);
    rmSync(pagePath(), { recursive: true });
    await run(['on', '--store', shop]);
  } finally { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; }
}


console.log(`memory-switch: ${checks} checks passed`);
