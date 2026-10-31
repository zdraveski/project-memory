#!/usr/bin/env node
// Fuzz: random, hostile conversations and notes through the real hooks and
// the memory CLI, and the rules that hold whatever they hold. The reviews of
// 2026-10-29/30 found their bugs by reading for input like this (a BOM, CRLF,
// half an emoji, a quoted forget, a clock moved to another zone); this looks
// for the next one by itself. A round is its seed: generate(seed) decides it
// as steps, all its randomness spent there, and execute(steps) runs them. A
// failing round is printed, shrunk to the steps it still fails with, replays
// exactly (--seed N), and becomes a test.
//
// A round: notes (a BOM, CRLF, half an emoji, hand-written and doubled index
// lines); an older conversation already on disk for the journal to take in;
// one or two conversations, a Stop after each turn in a random time zone,
// sometimes two Stops at once; transcripts that open with 600 KB (read in
// part), a last line half written, a broken line; <private> secrets, forget
// turns in three spellings, <private-session> marks; replies of growing sizes
// (up to past the compaction ceiling) and turns cut mid-way, some with
// background launches and their end notices; the compaction gate, after a cut
// turn too; the CLI's status, search, show and forget, and a `forget --key ... --yes`.
// Disk faults and kills: 15 % of the Stops, gates and CLI runs (never the forget by key,
// nor the settling Stops that end a round) run under fuzz-faults.cjs, a preload that
// fails the hook's own disk calls under the round's temp home (EBUSY, EPERM, EACCES,
// ENOSPC) at a rate of 2, 10 or 30 % from a seeded stream; 10 % of Stops are killed
// 5-300 ms in, and every .lock under the home is then dated back past LOCK_STALE (a
// lock a refused unlock left is the same case). Before the settling Stops a journal
// look is made due, as the wait of ACTIVE would, and a transcript listed as failing
// to open is tried again, as RETRY would. A kill, and two faulted Stops at once,
// are races: a failing seed may need a few --seed replays.
// The older conversation is dated three days back, as a real user's earlier session
// is, so the journal's import takes it in (written now it was an active session's and
// was skipped); 25 % of them are ones it must leave alone (a <private-session> typed
// in it, or its tag already in .memory-off or .private-sessions). 20 % of turns hold
// a message queued while Claude works (a string or blocks; 30 % with a <private>
// secret, which the answer and a command after it repeat, so a freeze that fails
// leaks it). 25 % of plain turns hold secrets of five of the shapes redact() knows
// (every shape is tried at start-up, and again with two blanks or a tab before its
// value), built from pieces, 40 % of them with that wider blank, and near-misses
// (process.env.API_KEY, user.password). 10 % of conversations are held with auto
// memory off from some Stop on: a Stop with CLAUDE_CODE_DISABLE_AUTO_MEMORY set.
// What must hold: every hook and command exits as it should (the gate with 2
// exactly for an automatic compaction mid-turn between the floor and the
// ceiling); no private or forgotten text is written, briefed or printed, a gate's
// note included; a private conversation leaves nothing; every other exchange is
// in handoff.md once and in the journal once (an older conversation's: in the
// journal once; one held with auto memory off: in the journal never); a gate over
// the ceiling leaves a cut-turn note naming the launches not yet done and no
// ended one, gone after the turn's Stop; the nudge comes once between dips under the trigger, never in
// a private conversation, and at the first Stop of a plain turn past it; every
// note keeps its text and one index line; repeating the last Stop settles within four.
// Under faults or a kill: a hook exits 0 (the gate 0 or 2, a command 0 or 1; not a killed
// one), prints no stack trace (a frame line in stderr or stdout) and no private text, and
// changes no note; after settling no .handoff-failed-* file and no journal/.failed (but a
// store whose conversations are all private or held with auto memory off keeps its
// live-write failure: a Stop that writes nothing clears none), and no *.tmp<digits> file is named in MEMORY.md or in
// `status`. The nudge rules rest after a hurt Stop until the next dip under the trigger.
// More of the CLI: a note is edited before some Stops (its texts are recorded); then, each with a
// 40 % chance, history, restore (a commit from the history, forced), promote and doctor. After a
// restore the note is one of the texts it had, and one that fails or is not forced changes nothing;
// a promoted note is in _shared/memory once, with one index line, and none is left in the project;
// doctor's lines are ok or PROBLEM, its exit 1 exactly when one is, and none names the user's own
// ~/.claude. The startup briefing (handoff-log.mjs --print) is within 9,500 characters, a line of a
// startup or a /clear within 1,000, and a startup of a new conversation names the ask of the newest
// plain exchange of the conversation handoff.md lists last (`[private]` when the last entry is a
// turn that ran forget, as PRIVACY.md saves it), when that is under a week old.
// Time: a round's clock starts at one of INSTANTS: the default, the year's end
// (2026-12-31 23:20 UTC), or 40 minutes before a daylight-saving change in Berlin,
// Los Angeles or Chatham, so turns and Stops straddle the change. Some turns are
// placed (searched minute by minute, in generate) so their local minute in their
// Stop's zone equals an earlier turn's in that turn's zone: a forget by key lists
// an exchange by key and minute, and must not take out another turn that reads as
// that minute after a move to another zone (F5, c59deeb). A forget by key often picks
// such a turn and runs its Stops in the colliding turn's zone.
// Run: node fuzz.mjs [seconds, default 60] [--seed N] [--keep-going] [--no-shrink]
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, existsSync, utimesSync, cpSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, availableParallelism, homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tool, tempHome, storeFor } from './harness.mjs';
import { LOCK_STALE } from './store.mjs';
import { NUDGE_TAG, ACTIVE, tag, parse, sectionOf } from './handoff-log.mjs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--seed') ?? 60);
const only = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : null;
const REAL = join(homedir(), '.claude').replaceAll('\\', '/').toLowerCase();   // the user's own folder, read before tempHome moves HOME: no command may name it
const OWN = new RegExp(`${dirname(fileURLToPath(import.meta.url)).replaceAll('\\', '/').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
const homes = tempHome('fuzz-').home, kept = new Set();
// The hooks and this file must read the same numbers: the four variables that
// set the windows are gone from this process (the hooks inherit that) before
// compact-gate.mjs is loaded, which a static import would do first.
for (const v of ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_DISABLE_1M_CONTEXT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) delete process.env[v];
const { MODEL_WINDOW, WINDOW, TRIGGER } = await import('./compact-gate.mjs');
// Reply sizes, in tokens: a small start, two under the trigger, one just past it, one past the ceiling.
const SIZES = [1_000, 199_000, 500_000, Math.ceil(TRIGGER * WINDOW) + 1_000, Math.ceil(0.95 * MODEL_WINDOW)];
const TIER = tool('memory-tier.mjs'), LOG = tool('handoff-log.mjs'), GATE = tool('compact-gate.mjs'), CLI = tool('memory.mjs');

// mulberry32: a seed replays its round exactly.
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// What broke something before, and its neighbours.
const PIECES = ['\uFEFF', '\r\n', '\n', '\u2028', '\u0085', '\uD83D', '\uDE00', '\u{1F600}', '\u{1F469}\u200D\u{1F4BB}', '\u212A', 'e\u0301', '"', "'", '`', '```', '---', '<!-- auto:end -->',
  '<!-- auto:start -->', '- [x](y.md) — z', '**asked**', '&lt;', '<system-reminder>', '</system-reminder>', '%s', '$&', '\t', '    ', '请修复（登录）', '…', '(', '[', '*', '\\'];
const WORDS = ['deploy', 'the', 'fix', 'plan', 'logo', 'tests', 'continue', 'why', 'ok', 'run', 'notes', 'branch'];
const ZONES = ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Chatham'];
const FORGET = ["node memory.mjs forget x", "node \"C:/x/memory.mjs\" 'forget' 'x'", 'node memory.mjs --store "C:/s" "forget" x',
  "node \"C:/x/memory.mjs\" '--shared' 'forget' 'x' --session y", 'node memory.mjs --limit -5 forget x', 'node memory.mjs --conversation= forget x'];
const LINE_ENDS = /[\r\n\u2028\u0085]/g;
// A stack trace's frame line (`    at f (file:1:2)` or `    at file:1:2`), and a half-written file's name (`MEMORY.md.tmp123`).
const STACK = /^\s+at (?:.+ \(.+:\d+:\d+\)|\S+:\d+:\d+)$/m, TMP = /\S*\.tmp\d+\S*/;
// shortcut: hooks read the real clock, so replaying a seed on another day may differ in those two messages ("another session is working", "hooks look stopped"); upgrade if a failure ever depends on them.
// Where a round's clock starts. A `zone` marks a daylight-saving change in it 40
// minutes after `at`; the first is the default, the last the year's end.
const INSTANTS = [{ at: '2026-10-30T08:00:00Z' }, { at: '2026-10-25T00:20:00Z', zone: 'Europe/Berlin' }, { at: '2026-11-01T08:20:00Z', zone: 'America/Los_Angeles' },
  { at: '2026-03-29T00:20:00Z', zone: 'Europe/Berlin' }, { at: '2026-03-08T09:20:00Z', zone: 'America/Los_Angeles' }, { at: '2026-04-04T13:20:00Z', zone: 'Pacific/Chatham' },
  { at: '2026-09-26T13:20:00Z', zone: 'Pacific/Chatham' }, { at: '2026-12-31T23:20:00Z' }];
// A zone's offset and the local minute (`2026-10-27 01:07`, as store.mjs local() reads it) at an instant, by Intl: this
// file's own TZ stays as it is (R20).
const COLLIDE = 0.3, FORGET_KEY = 0.5, PICK_HIT = 0.8, HIT_ZONE = 0.8;   // the chances: a turn placed to collide; a forget by key; it picks a collided turn; the Stops after it use the colliding zone
const fmtCache = new Map();
const fmt = (zone, opts) => { const k = zone + JSON.stringify(opts); if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('sv-SE', { timeZone: zone, ...opts })); return fmtCache.get(k); };
const offsetAt = (zone, ms) => fmt(zone, { timeZoneName: 'longOffset' }).formatToParts(ms).find((p) => p.type === 'timeZoneName').value;
const minuteIn = (ms, zone) => fmt(zone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
for (const { at, zone } of INSTANTS) {
  const t = Date.parse(at);
  if (zone && offsetAt(zone, t + 39 * 60_000) === offsetAt(zone, t + 41 * 60_000)) { console.error(`fuzz: ${at} is no daylight-saving change in ${zone}: the instant list is wrong`); process.exit(1); }
}

// Secrets of every shape handoff-log.mjs's redact() knows, built here from pieces (no source line is one) with
// a stream x. Each is [the text, the part that must never be written], or [the text] for a near-miss, which
// redact may keep or cut and no rule follows. A token holds a letter and a digit (several patterns want both).
const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', SAFE = `${AL}_-`, HEX = '0123456789abcdef', UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PREFIXED = [['sk-ant-', SAFE, 30], ['sk_live_', AL, 26], ['rk_test_', AL, 26], ['pk_live_', AL, 24], ['ghp_', AL, 36], ['gho_', AL, 36], ['ghu_', AL, 36], ['ghs_', AL, 36], ['ghr_', AL, 36], ['xoxa-', `${AL}-`, 24], ['xoxp-', `${AL}-`, 24], ['xoxr-', `${AL}-`, 24], ['xoxs-', `${AL}-`, 24], ['shpca_', HEX, 32], ['shppa_', HEX, 32], ['github_pat_', `${AL}_`, 50], ['xoxb-', `${AL}-`, 24], ['xapp-', `${AL}-`, 24],
  ['AKIA', UPPER, 16], ['ASIA', UPPER, 16], ['AIza', SAFE, 35], ['glpat-', SAFE, 22], ['npm_', AL, 36], ['hf_', AL, 34], ['pypi-AgE', SAFE, 30], ['whsec_', AL, 28], ['GOCSPX-', SAFE, 28], ['ya29.', SAFE, 30],
  ['gsk_', AL, 30], ['xai-', AL, 30], ['shpat_', HEX, 32], ['shpss_', HEX, 32], ['dop_v1_', HEX, 64], ['ntn_', AL, 30], ['ATATT', SAFE, 30], ['hvs.', SAFE, 30], ['dckr_pat_', SAFE, 30], ['LS0tLS1CRUdJTi', AL, 30]];
const shapesOf = (x) => {
  const t = (n, set = AL) => {
    const letters = [...set].filter((c) => /[A-Za-z]/.test(c));   // the first two characters are in the set too: a letter, then a digit
    return `${letters[Math.floor(x() * letters.length)]}${1 + Math.floor(x() * 9)}${Array.from({ length: n - 2 }, () => set[Math.floor(x() * set.length)]).join('')}`;
  };
  const key = t(64), v = () => t(14), sec = (text, s) => [text.replace('@@', s), s];
  const all = PREFIXED.map(([p, set, n]) => { const s = p + t(n, set); return [`key ${s}`, s]; });
  all.push([`${['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join('')}\n${key}\n${['-----END ', 'RSA PRIVATE', ' KEY-----'].join('')}`, key]);
  const jwt = ['ey', 'J'].join('') + [t(12, SAFE), t(12, SAFE), t(12, SAFE)].join('.');
  const sg = `SG.${t(20, SAFE)}.${t(20, SAFE)}`;
  all.push([`jwt ${jwt}`, jwt], [`mail ${sg}`, sg]);
  const hook = `T${t(8)}/B${t(8)}/${t(24)}`; all.push([`webhook ${['https://hooks.', 'slack.com/services/'].join('')}${hook}`, hook]);
  for (const [text, s] of [['Authorization: Bearer @@', t(30, `${AL}._~`)], ['postgres://admin:@@@db.example.com/app', v()], ['curl -u bob:@@ https://example.com', v()], ['deploy --password @@', v()], ['deploy --token @@', v()], ['deploy --client-secret @@', v()], ['Authorization: Basic @@', t(30, `${AL}._~`)], ['Authorization: Token @@', t(30, `${AL}._~`)], ['az login -u me -p @@', v()], ['sshpass -p @@ ssh host', v()], ['twine upload -p @@ dist', v()], ['mysqldump -u root -p@@ app', v()], ['mariadb -u root -p@@ app', v()], ['passphrase: @@', v()], ['pwd=@@', v()], ['pass: @@', v()], ['docker login -u me -p @@', v()],
    ['aws configure set aws_secret_access_key @@', v()], ['[Environment]::SetEnvironmentVariable("MY_API_TOKEN", "@@", "User")', v()], ['htpasswd -b .htpasswd bob @@', v()], ['export MY_API_KEY=@@', v()], ['setx DB_PASSWORD @@', v()],
    ['gh secret set DEPLOY --body @@', v()], ['//registry.npmjs.org/:_authToken=@@', t(4)], ['mysql -u root -p@@ app', v()], ['my password is @@', v()], ['the api key is @@', v()], ['password @@', v()],
    ['DB_PASSWORD: @@', v()], ['clientSecret=@@', v()], ['client-key-data: @@', v()], ['token=@@', v()]]) all.push(sec(text, s));
  const near = [['api_key = process.env.API_KEY'], ['password: user.password'], ['secret = correct_horse_battery_staple'], ['token: this.apiKey'], ['password: string']];
  return { secrets: all, near };
};
// A shape with the blank before its value made sep (two spaces, a tab): redacted before the blanks were squeezed, such a value was
// stored whole in the journal (F19). A shape with no blank there is left as it is.
const widen = ([text, s], sep) => [text.replace(` ${s}`, () => `${sep}${s}`), s];

// A process, as Claude Code runs a hook: its input on stdin, cut off at 30 s.
// Disk faults (fuzz-faults.cjs) reach only the hook's own process, not the git it spawns.
const FAULTS = fileURLToPath(new URL('./fuzz-faults.cjs', import.meta.url));
// o.fault { seed, rate, root }: a preload that fails disk calls under root. o.kill: ms until child.kill().
const spawnHook = (file, argv, input, tz, o = {}) => new Promise((done) => {
  // `env` stays undefined, which is "inherit" (harness.mjs); the zone and the
  // faults are set on this process just before the spawn, which copies them at
  // that call (a spawn is synchronous up to there, so concurrent ones each get
  // their own). The date maths here is UTC and does not read them.
  process.env.TZ = tz;
  if (o.home) process.env.HOME = process.env.USERPROFILE = o.home;   // the round's own, so rounds can overlap
  if (o.off) process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';   // as the user turns auto memory off
  if (o.fault) process.env.FUZZ_FAULTS = `${o.fault.seed}:${o.fault.rate}:${o.fault.root}`; else delete process.env.FUZZ_FAULTS;
  const c = spawn(process.execPath, o.fault ? ['--require', FAULTS, file, ...argv] : [file, ...argv]);
  delete process.env.FUZZ_FAULTS; delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  let killed = false;
  const killer = o.kill && setTimeout(() => { killed = true; c.kill(); }, o.kill);
  let out = '', err = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { err += b; });
  const timer = setTimeout(() => c.kill(), 30000);
  c.on('close', (status, signal) => { clearTimeout(timer); clearTimeout(killer); done({ status, signal, out, err, killed }); });
  c.stdin.on('error', () => {});
  c.stdin.end(input ?? '');
});

// A round as steps, each { type, ... } with its content decided: every random
// choice is made here, so the same steps run the same way again.
function generate(seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const text = (n) => Array.from({ length: n }, () => (r() < 0.6 ? pick(WORDS) : pick(PIECES))).join(r() < 0.5 ? ' ' : '');
  const u = seed >>> 0, hex = u.toString(16).padStart(6, '0').slice(-6), cwd = `C:\\fuzz-${u}`, steps = [];

  // Notes, some with a hand-written index line, some twice.
  const index = [];
  for (let i = 0, n = int(0, 6); i < n; i++) {
    const name = `note-${u}-${i}`, eol = r() < 0.3 ? '\r\n' : '\n';
    const body = `${r() < 0.2 ? '\uFEFF' : ''}---\nname: ${name}\ndescription: "${text(int(1, 8)).replace(/["\r\n\u2028\u0085]/g, ' ')}"\nmetadata:\n  type: project\n${r() < 0.2 ? '  tier: hot\n' : ''}---\n\n${text(int(1, 40))}\n`.replace(/\n/g, eol);
    steps.push({ type: 'note', name, body });
    if (r() < 0.5) for (let k = 0, m = r() < 0.2 ? 2 : 1; k < m; k++) index.push(`- [${name}](${name}.md) — ${text(int(1, 5)).replace(LINE_ENDS, ' ')}`);
  }
  for (let i = 0, n = int(0, 3); i < n; i++) index.push(text(int(1, 6)).replace(LINE_ENDS, ' '));
  steps.push({ type: 'index', lines: index });

  // An older conversation already on disk: the journal takes it in.
  if (r() < 0.3) {
    const st = { type: 'old', id: `o${hex}0-${int(1000, 9999)}`, exchanges: [] };
    for (let i = 0, n = int(1, 3); i < n; i++) {
      const mark = `OLD${u}n${i}`, x = { mark, ask: `${mark} ${text(int(1, 6))}`, did: `done ${text(int(1, 10))}` };
      if (r() < 0.4) { x.secret = `ZQXO${u}n${i}`; x.ask = `<private>${x.secret}</private> ${x.ask}`; x.did = `${x.did} ${x.secret}`; }
      st.exchanges.push(x);
    }
    // 25 %: a conversation the journal must not take in -- a <private-session> typed in it, or its tag already in .memory-off or in .private-sessions.
    // (A stream of its own, as the faults have: no other choice moves.)
    const ox = rng(seed ^ 0x01D0), how = ox() < 0.25 ? ['mark', 'off', 'list'][Math.floor(ox() * 3)] : null;
    if (how) st.how = how;
    if (how === 'mark') st.exchanges[0].ask = `<private-session> ${st.exchanges[0].ask}`;
    steps.push(st);
  }

  // One or two conversations; distinct 8-character tags. Opened with 600 KB, a Stop reads it in part.
  // idx: the size of its last reply, in SIZES; sizes only grow until a compaction lets through and they fall back (fell).
  const sessions = Array.from({ length: int(1, 2) }, (_, k) => ({ id: `f${k}${hex}-${int(1000, 9999)}`, private: false, n: 0, idx: 0, fell: false }));
  for (const s of sessions) steps.push({ type: 'session', id: s.id, big: r() < 0.25 });
  // The queued messages, secret shapes and memory-off marks draw from a stream of their own: no other choice moves.
  const x = rng(seed ^ 0x0FF5E7), xint = (a, b) => a + Math.floor(x() * (b - a + 1));
  for (const s of sessions) s.off = x() < 0.1;   // 10 %: held with auto memory off from some Stop on
  // Which shapes get two blanks or a tab before their value: a stream of its own too.
  const bx = rng(seed ^ 0xB1A4C5);
  const marks = new Map(), top = SIZES.length - 1;
  const inst = pick(INSTANTS), zones = inst.zone ? [...ZONES, inst.zone, inst.zone] : ZONES;
  let clock = Date.parse(inst.at);
  // hit: a turn another collides with (by local minute) and the zone of the last that does; seen: turns so far.
  const hit = new Map(), seen = [];
  // Makes a turn whose Stop is in zone tz and returns the gate step that follows it (a turn cut mid-way, 70 % of them), or null.
  const turn = (s, tz) => {
    clock += int(1, inst === INSTANTS[0] ? 90 : 40) * 60_000;
    // Only a plain turn takes part (kind >= 0.3: no secret, no forget, not private), or a collision proves nothing.
    // COLLIDE %: the time is searched, a minute at a time up to 24 hours ahead, for one whose local minute in tz is an earlier
    // turn's in that turn's Stop's zone (another zone first; then the same conversation's: only a forget of a turn in the colliding turn's own transcript can lose it, F5).
    let collides = null;
    const kind = r();
    if (kind >= 0.3 && r() < COLLIDE && seen.length) {
      const mins = Array.from({ length: 1440 }, (_, m) => minuteIn(clock + (m + 1) * 60_000, tz));
      const order = seen.map((e) => [(e.zone === tz ? 2 : 0) + (e.s === s.id ? 0 : 1) + r() / 2, e]).sort((a, b) => a[0] - b[0]);
      for (const [, e] of order) {
        const m = mins.indexOf(minuteIn(e.at, e.zone));
        if (m !== -1) { clock += (m + 1) * 60_000; collides = e.mark; if (e.s === s.id) hit.set(e.mark, { tz, zone: e.zone }); break; }
      }
    }
    const i = s.n++, mark = `ASK${u}${s.id[1]}n${i}`;
    // 20 % are cut mid-way; after one the gate runs 70 % of the time, over 90 % of the window in 40 % of those.
    const isCut = r() < 0.2, gated = isCut && r() < 0.7, over = gated && r() < 0.4;
    // The size never falls, but for the first turn after a compaction; a gate not over 90 % is not given the top size.
    const max = s.fell ? 2 : gated ? top - 1 : top;
    s.idx = over ? top : int(s.idx, Math.max(s.idx, max)); s.fell = false;
    if (kind >= 0.3) seen.push({ mark, at: clock, zone: tz, s: s.id });
    const st = { type: 'turn', s: s.id, at: clock, mark, uuid: `u-${u}-${s.id[1]}-${i}`, kind: 'plain', ask: `${mark} ${text(int(1, 12))}`, did: `done ${text(int(1, 30))}`, size: SIZES[s.idx] };
    if (collides) st.collides = collides;
    if (kind < 0.15) { st.secret = `ZQXP${u}${s.id[1]}n${i}`; st.ask = `${pick(['<private>', '<PRIVATE>', '<private reason="x">'])}${st.secret}</private> ${st.ask}`; st.did = `${st.did} ${st.secret}`; }
    else if (kind < 0.25) { st.secret = `ZQXF${u}${s.id[1]}n${i}`; st.ask = `${st.ask} ${st.secret}`; st.did = `${st.did} ${st.secret}`; st.kind = 'forget'; st.tool = { type: 'tool_use', id: `f${i}`, name: 'Bash', input: { command: pick(FORGET) } }; }
    else if (kind < 0.3) { st.ask = `<private-session> ${st.ask}`; s.private = true; }
    // 20 %: a message queued while Claude works, a string or blocks (text beside an image); 30 % of those hold a <private> secret.
    // A plain turn (25 %) also holds secrets of five shapes and the near-misses, in its ask, its answer and a Bash command.
    if (x() < 0.2) {
      const words = Array.from({ length: xint(1, 5) }, () => WORDS[Math.floor(x() * WORDS.length)]).join(' '), q = { blocks: x() < 0.5 };
      if (x() < 0.3) {
        // The reply to a private message is the leak to look for: the secret rides in the answer and in a command after the message, which the freeze keeps out (I1, R39).
        q.secret = `ZQXQ${u}${s.id[1]}n${i}`; q.text = `<private>${q.secret}</private> ${words}`;
        st.did = `${st.did} ${q.secret}`;
        st.tool ??= { type: 'tool_use', id: `q${i}`, name: 'Bash', input: { command: `echo ${q.secret}` } };
      } else q.text = words;
      st.queued = q;
    }
    if (kind >= 0.3 && x() < 0.25) {
      const { secrets, near } = shapesOf(x), drawn = Array.from({ length: 5 }, () => secrets[Math.floor(x() * secrets.length)]), nm = near[Math.floor(x() * near.length)][0];
      const few = drawn.map((sh) => (bx() < 0.4 ? widen(sh, bx() < 0.5 ? '  ' : '\t') : sh));
      st.shapes = { text: [...few.map(([t]) => t), nm].join('\n'), secrets: few.map(([, sc]) => sc) };
    }
    marks.set(mark, { kind: st.kind, s, uuid: st.uuid });
    // The ask as a string or a text block; the answer half written when the Stop comes, or a broken line after it.
    st.block = r() >= 0.5;
    st.half = !isCut && r() < 0.1;
    st.broken = !isCut && !st.half && r() < 0.05;
    // Cut mid-way: half of those after a background launch (or two), and a launch's end may be noticed later.
    if (isCut) {
      st.cut = true;
      st.launches = r() < 0.5 ? Array.from({ length: int(1, 2) }, (_, j) => ({ id: `bg${u}${s.id[1]}n${i}x${j}`, done: r() < 0.5 })) : [];
    }
    steps.push(st);
    if (!gated) return null;
    const trigger = r() < 0.85 ? 'auto' : 'manual';
    // Any compaction that is not deferred (a manual one, or auto under the floor or over the ceiling) brings the size down.
    if (trigger === 'manual' || s.idx === top || SIZES[s.idx] < 200_000) { s.idx = 0; s.fell = true; }
    return { type: 'gate', s: s.id, trigger };
  };
  for (let k = 0, n = int(1, 6); k < n; k++) {
    const tz = pick(zones);
    if (sessions.length === 2 && r() < 0.3) { const gs = sessions.map((s) => turn(s, tz)).filter(Boolean); steps.push(...gs.map((g) => ({ ...g, tz }))); steps.push({ type: 'stops', ss: sessions.map((s) => s.id), tz }); }
    else { const s = pick(sessions), g = turn(s, tz); if (g) steps.push({ ...g, tz }); steps.push({ type: 'stop', s: s.id, tz }); }
    if (r() < 0.15) { const s = pick(sessions), trigger = pick(['auto', 'manual']); steps.push({ type: 'gate', s: s.id, trigger, tz }); s.idx = 0; s.fell = true; }   // after a Stop: a turn boundary, never deferred, so the compaction goes through
    // Memory off from here on, for a conversation chosen to be (its Stop with the variable set tags it; a SessionStart would too).
    for (const s of sessions) if (s.off && !s.offDone && x() < 0.5) { s.offDone = true; steps.push({ type: 'off', s: s.id, tz }); }
  }
  for (const s of sessions) if (s.off && !s.offDone) steps.push({ type: 'off', s: s.id, tz: 'UTC' });

  // The CLI's status, search, show and forget; a forget by key and the conversation's next Stop.
  let tz = pick(zones);
  const arg = () => text(int(1, 3)).replace(/[\uD800-\uDFFF\r\n\u2028\u0085\0]/g, ' ').trim() || 'x';
  for (const a of [['status'], ['search', pick(WORDS)], ['search', arg(), arg()], ['show', pick([...marks.values()].map((m) => m.uuid).concat('no-such-key'))], ['forget', arg()]]) steps.push({ type: 'cli', args: a, tz });
  const plain = [...marks].filter(([, m]) => m.kind === 'plain' && !m.s.private && !m.s.off);   // an off conversation's exchanges are not in the journal: no key of theirs was ever listed
  if (plain.length && r() < FORGET_KEY) {
    // Half the time a turn another collides with, and the Stops after it in the colliding turn's zone: coincidences are the point.
    const hits = plain.filter(([mark]) => hit.has(mark)), [mark, m] = hits.length && r() < PICK_HIT ? pick(hits) : pick(plain);
    // A Stop in the target's zone first, so its minute is read there (a Stop dates the entries it writes in its own zone).
    if (hit.has(mark) && r() < HIT_ZONE) { steps.push({ type: 'stop', s: m.s.id, tz: hit.get(mark).zone }); tz = hit.get(mark).tz; }
    steps.push({ type: 'forgetKey', mark, uuid: m.uuid, s: m.s.id, tz });
  }
  // Disk faults on 15 % of Stop, gate and CLI runs (never the forget by key, nor the settling Stops, which are no steps);
  // 10 % of Stops are killed after 5-300 ms. A stream of its own: no other choice moves.
  const fr = rng(seed ^ 0x5EED5), rate = [0.02, 0.1, 0.3];
  for (const st of steps) {
    if (!['stop', 'stops', 'gate', 'cli'].includes(st.type)) continue;
    if (fr() < 0.15) st.fault = { seed: Math.floor(fr() * 2 ** 31), rate: rate[Math.floor(fr() * 3)] };
    if ((st.type === 'stop' || st.type === 'stops') && fr() < 0.1) st.kill = 5 + Math.floor(fr() * 296);
  }
  // The rest of the CLI, from a stream of its own (no other choice moves): a note edited before 25 % of the Stops (the snapshots
  // keep each text), then history, restore, promote and doctor, each once at the round's end with a 40 % chance, on a note of the
  // round (one in ten names a note that does not exist).
  const cx = rng(seed ^ 0xC11E5), cpick = (xs) => xs[Math.floor(cx() * xs.length)], names = steps.filter((st) => st.type === 'note').map((st) => st.name);
  const aim = () => (!names.length || cx() < 0.1 ? 'no-such-note' : cpick(names));
  if (names.length) for (let i = steps.length - 1; i >= 0; i--) {
    if (['stop', 'stops'].includes(steps[i].type) && cx() < 0.25) steps.splice(i, 0, { type: 'edit', name: cpick(names), text: Array.from({ length: 1 + Math.floor(cx() * 6) }, () => (cx() < 0.7 ? cpick(WORDS) : cpick(PIECES))).join(cx() < 0.5 ? ' ' : '') });
  }
  if (cx() < 0.4) steps.push({ type: 'history', name: aim(), tz: cpick(ZONES), all: cx() < 0.3, limit: cx() < 0.5 ? 1 + Math.floor(cx() * 3) : 0 });
  if (cx() < 0.4) steps.push({ type: 'restore', name: aim(), tz: cpick(ZONES), rev: cx() < 0.5, force: cx() < 0.7, pick: cx() });
  if (cx() < 0.4) steps.push({ type: 'promote', name: aim(), tz: cpick(ZONES) });
  if (cx() < 0.4) steps.push({ type: 'doctor', tz: cpick(ZONES) });
  return { steps, meta: { u, cwd, tz, briefing:{ session: sessions[0].id, source: pick(['startup', 'resume', 'compact', 'clear']) } } };
}

// The steps through the real hooks and the CLI, then the round's end, then what
// must hold. Any list of a round's steps is a whole round: a step whose
// conversation no step opened opens it, and the end is no step, so a shrink
// cannot cut it: every conversation's closing Stop, then the last Stops again.
async function execute(steps, meta) {
  const { u, cwd, tz: lastTz, briefing } = meta;
  // A home of the round's own, made afresh: a replay sees nothing an earlier
  // one left (the shared store included), and the paths it prints are the same.
  const home = join(homes, meta.home ?? `r${u}`);
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  // Every spawn names its home (process.env is shared by rounds that overlap).
  const run = (file, argv, input, tz, o = {}) => spawnHook(file, argv, input, tz, { ...o, home });
  const dir = storeFor(home, cwd), proj = dirname(dir), problems = [], log = [];
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 3 * 86400_000);
  // texts: every text a note has had (restore may bring back any); promoted: a note moved to the shared store, and the text it moved with.
  const texts = new Map(), promoted = new Map();
  const notes = new Map(), secrets = [], ended = new Set(), marks = new Map(), forgotten = new Set(), sessions = new Map();
  const rec = (s, type, ts, content, uuid, size = 1000, stop = 'end_turn') => JSON.stringify({ type, uuid, sessionId: s.id, cwd, timestamp: ts,
    message: type === 'user' ? { role: 'user', content } : { role: 'assistant', content, stop_reason: stop, usage: { input_tokens: size } } });
  // What the hooks will read of a conversation, kept as its lines are written:
  // ctx and mid are the size and stop_reason of the last whole assistant line;
  // nudges and givenAt follow the nudges given since the last dip under the trigger; open is a turn cut mid-way, not yet ended.
  const session = (id) => {
    if (!sessions.has(id)) { sessions.set(id, { id, t: join(proj, `${id}.jsonl`), private: false, did: '', rest: '', restSize: 0, open: null, ctx: 0, mid: false, nudges: 0, givenAt: 0, lastPlain: false, turns: 0, stopped: 0 }); writeFileSync(sessions.get(id).t, ''); }
    return sessions.get(id);
  };
  // A half-written answer is finished, and a turn cut mid-way ends, before the next turn or Stop.
  const flush = (s) => { if (s.rest) { appendFileSync(s.t, s.rest); s.rest = ''; s.ctx = s.restSize; s.mid = false; } };
  const endCut = (s) => { if (s.open) { appendFileSync(s.t, s.open.rest); s.mid = false; s.open = null; } };   // its answer has the cut reply's size: ctx stays
  // o.fault / o.kill: this Stop is run with disk faults, or killed after o.kill ms. A faulted or killed Stop may save nothing:
  // it is not counted as seen, and the nudge rules (which follow what the hook recorded) stop for that conversation.
  const faultOf = (o) => (o.fault ? { ...o.fault, root: home } : undefined);
  const hurt = (o) => o.fault || o.kill;
  const stop = async (s, tz, solo = true, o = {}) => {
    endCut(s);
    log.push(`stop ${s.id} TZ=${tz}${o.fault ? ` with faults (seed ${o.fault.seed}, rate ${o.fault.rate})` : ''}${o.kill ? `, killed after ${o.kill} ms` : ''}`);
    if (!hurt(o)) s.stopped = s.turns; else s.nudgeOff = true;
    const p = await run(TIER, ['--stop'], JSON.stringify({ cwd, transcript_path: s.t, session_id: s.id, hook_event_name: 'Stop', last_assistant_message: s.did }), tz, { fault: faultOf(o), kill: o.kill });
    if (hurt(o)) hurtRules(p, `the Stop hook (${s.id})`, o);
    if (p.killed) return;
    if (p.status !== 0) { problems.push(`the Stop hook (${s.id}, TZ=${tz}) exited ${p.status ?? p.signal}: ${p.err.trim().split('\n').slice(-2).join(' | ')}`); return; }
    // The nudge: its tag in a line of stdout. At most once between dips under the
    // trigger (a size smaller than the last nudge's is a dip too), never in a
    // <private-session> conversation, and on the first Stop of a plain turn past it.
    const gave = p.out.split('\n').some((l) => { try { return JSON.parse(l).hookSpecificOutput?.additionalContext?.includes(NUDGE_TAG); } catch { return false; } });
    // The hook records a nudge only when it prints one: a Stop of a private turn that printed none spent none.
    // A dip under the trigger, seen by a Stop that ran whole, restarts the hook's count and the rules (a hurt Stop may have left its record as it was).
    if (s.ctx < TRIGGER * WINDOW) { s.nudges = 0; if (!hurt(o)) s.nudgeOff = false; }
    else {
      if (gave && s.private) problems.push(`the Stop of a <private-session> conversation (${s.id}) gave a nudge`);
      if (s.nudgeOff) { /* a hurt Stop's record is unknown */ }
      else if (gave) {
        if (s.nudges > 0 && s.ctx >= s.givenAt) problems.push(`a second nudge for ${s.id} between dips under the trigger: at ${s.givenAt}, then at ${s.ctx} tokens`);
        s.nudges++; s.givenAt = s.ctx;
      } else if (s.nudges === 0 && !s.private && s.lastPlain) problems.push(`no nudge on the first Stop of a plain turn past the trigger (${s.id}, ${s.ctx} tokens)`);
    }
    // A turn that has ended and stopped leaves no cut-turn note (the Stop rebuilds the section); not two Stops at once, which can leave one to the other.
    if (solo && !s.rest && !s.private && !hurt(o)) {
      const h = existsSync(join(dir, 'handoff.md')) ? readFileSync(join(dir, 'handoff.md'), 'utf8') : '';
      if (h.includes(`**cut mid-turn** [${s.id.slice(0, 8)}]`)) problems.push(`handoff.md still has the cut-turn note of ${s.id} after its turn ended and stopped`);
    }
  };
  // The CLI: every command exits 0 or 1, prints no stack and no private text.
  const cli = async (tz, a, o = {}) => {
    const c = await run(CLI, [...a, '--store', dir], '', tz, { fault: faultOf(o) });
    if (o.fault) hurtRules(c, `memory.mjs ${a.join(' ')}`, o);
    if (c.status !== 0 && c.status !== 1) problems.push(`memory.mjs ${a.join(' ')} exited ${c.status ?? c.signal}: ${c.err.trim().split('\n').slice(-1)}`);
    else if (/\n\s+at /.test(c.err)) problems.push(`memory.mjs ${a.join(' ')} threw: ${c.err.trim().split('\n')[0]}`);
    for (const sec of secrets) if (c.out.includes(sec)) problems.push(`memory.mjs ${a[0]} printed private text ${sec}`);
    return c;
  };
  const files = () => {
    const out = new Map();
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.set(f, readFileSync(join(dir, f), 'utf8'));
    if (existsSync(join(dir, 'journal'))) for (const f of readdirSync(join(dir, 'journal'))) if (f.endsWith('.md')) out.set(`journal/${f}`, readFileSync(join(dir, 'journal', f), 'utf8'));
    return out;
  };
  // What a faulted or killed run must still hold: no stack trace (a frame line, `    at f (file:1:2)` or `    at file:1:2`,
  // in stderr or stdout), no private text in its output, and no note changed. (Its exit code is the caller's rule.)
  const hurtRules = (p, what, o) => {
    const how = o.fault ? 'with faults' : 'killed';
    if (STACK.test(p.err) || STACK.test(p.out)) problems.push(`${what}, ${how}, printed a stack trace: ${(STACK.exec(p.err) ?? STACK.exec(p.out))[0].trim()}`);
    for (const sec of secrets) if ((p.out + p.err).includes(sec)) problems.push(`${what}, ${how}, printed private text ${sec}`);
    for (const [f, body] of notes) { let now = null; try { now = readFileSync(join(dir, f), 'utf8'); } catch {} if (now !== body) problems.push(`${f} changed by ${what}, ${how}`); }
  };
  // A killed Stop's lock is its own and outlives it: dated back past LOCK_STALE, as the time that stale lock would take to pass.
  const ageLocks = () => {
    const t = new Date(Date.now() - LOCK_STALE - 1000);
    for (const f of readdirSync(home, { recursive: true })) if (basename(f).endsWith('.lock')) try { utimesSync(join(home, f), t, t); } catch {}
  };
  const finish = () => { for (const s of sessions.values()) flush(s); };

  const act = {
    note: ({ name, body }) => {
      const f = join(dir, `${name}.md`);
      log.push(`note ${name}.md`);
      writeFileSync(f, body);
      utimesSync(f, old, old);
      // As the disk holds it: half an emoji is written as U+FFFD.
      notes.set(`${name}.md`, readFileSync(f, 'utf8'));
      texts.set(`${name}.md`, new Set([notes.get(`${name}.md`)]));
    },
    // A note edited by hand between Stops (as the model's Edit does): the snapshot at the next Stop keeps the text.
    edit: ({ name, text }) => {
      const f = `${name}.md`, cur = notes.get(f);
      if (cur === undefined) { log.push(`edit ${f}: not run, no such note`); return; }
      log.push(`edit ${f}`);
      const eol = cur.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(join(dir, f), `${cur}${text}${eol}`);
      utimesSync(join(dir, f), old, old);   // as the note step: a fresher note is left to its writer to index, for ORPHAN_GRACE (2 min)
      notes.set(f, readFileSync(join(dir, f), 'utf8'));
      texts.get(f).add(notes.get(f));
    },
    index: ({ lines }) => {
      log.push(`MEMORY.md, ${lines.length} line(s)`);
      writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...lines].join('\n') + '\n');
      utimesSync(join(dir, 'MEMORY.md'), old, old);
    },
    // The journal's import takes in a transcript quiet for ACTIVE, at the first look (which a Stop makes): the file is
    // dated three days back, as one a real user's earlier session left. Written now, it was an active session's, and
    // importOne never ran. `how`: a conversation it must leave alone, tagged before (.memory-off beside the projects,
    // .private-sessions in the store) or by a <private-session> typed in it.
    old: ({ id, exchanges, how }) => {
      log.push(`an older conversation ${id}${how ? ` (${how})` : ''}: ${exchanges.map((x) => x.mark).join(' ')}`);
      const f = join(proj, `${id}.jsonl`);
      writeFileSync(f, exchanges.map(({ mark, ask, did, secret }, i) => {
        const ts = new Date(Date.UTC(2026, 9, 20, 9, i)).toISOString();
        if (secret) secrets.push(secret);
        marks.set(mark, how ? { kind: 'old', s: { private: true, why: { mark: 'a <private-session> conversation', off: 'an older conversation tagged .memory-off', list: 'an older conversation tagged in .private-sessions' }[how] } } : { kind: 'old' });
        return `${rec({ id }, 'user', ts, ask, `uo-${u}-${i}`)}\n${rec({ id }, 'assistant', ts, [{ type: 'text', text: did }], `ao-${u}-${i}`)}`;
      }).join('\n') + '\n');
      utimesSync(f, old, old);
      if (how === 'off') appendFileSync(join(dirname(proj), '.memory-off'), `${tag(id)}\n`);
      if (how === 'list') appendFileSync(join(dir, '.private-sessions'), `${tag(id)}\n`);
    },
    // Auto memory off: a Stop with the variable set, which tags the conversation and records nothing; the Stops after
    // it (the variable gone) keep it out of the journal, and take out what the journal had of it (PRIVACY.md).
    off: async ({ s, tz }) => {
      const c = session(s);
      endCut(c);
      log.push(`auto memory off: a Stop of ${s} TZ=${tz}`);
      const p = await run(TIER, ['--stop'], JSON.stringify({ cwd, transcript_path: c.t, session_id: s, hook_event_name: 'Stop', last_assistant_message: c.did }), tz, { off: true });
      if (p.status !== 0) problems.push(`the Stop hook with auto memory off (${s}) exited ${p.status ?? p.signal}: ${p.err.trim().split('\n').slice(-2).join(' | ')}`);
      else if (p.out.trim() || STACK.test(p.err)) problems.push(`the Stop hook with auto memory off (${s}) printed: ${(p.out + p.err).trim().slice(0, 200)}`);
      for (const sec of secrets) if ((p.out + p.err).includes(sec)) problems.push(`the Stop with auto memory off printed private text ${sec}`);
      // And at its start: handoff-log.mjs without --print tags the conversation the same way.
      const b = await run(LOG, [], JSON.stringify({ cwd, transcript_path: c.t, session_id: s, source: 'startup', hook_event_name: 'SessionStart' }), tz, { off: true });
      if (b.status !== 0 || b.out.trim() || STACK.test(b.err)) problems.push(`the start hook with auto memory off (${s}) exited ${b.status ?? b.signal} and printed: ${(b.out + b.err).trim().slice(0, 200)}`);
      c.off = true;
    },
    session: ({ id, big }) => {
      log.push(`${id}${big ? ': opens with 600 KB' : ''}`);
      writeFileSync(session(id).t, big ? JSON.stringify({ type: 'user', sessionId: id, cwd, timestamp: new Date(Date.UTC(2026, 9, 30, 8, 0, 0)).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(600_000) }] } }) + '\n' : '');
    },
    turn: (st0) => {
      // The secret shapes ride in the ask, the answer and a Bash command (the journal's Ran field).
      const st = st0.shapes && !st0.tool ? { ...st0, ask: `${st0.ask}\n${st0.shapes.text}`, did: `${st0.did}\n${st0.shapes.text}`, tool: { type: 'tool_use', id: `s${st0.uuid}`, name: 'Bash', input: { command: st0.shapes.text.replace(/\n/g, ' ; ') } } } : st0;
      const s = session(st.s), ts = (ms) => new Date(st.at + ms).toISOString(), size = st.size ?? 1000, id = (p) => st.uuid.replace('u-', p);
      endCut(s); flush(s);
      if (st.secret) secrets.push(st.secret);
      if (st.queued?.secret) secrets.push(st.queued.secret);
      if (st.shapes) secrets.push(...st.shapes.secrets.filter(Boolean));
      if (st.ask.startsWith('<private-session>')) s.private = true;
      s.did = st.did;
      s.lastPlain = st.kind === 'plain' && !st.secret && !st.queued?.secret && !st.ask.startsWith('<private-session>');
      marks.set(st.mark, { kind: st.kind, s, turn: ++s.turns });
      const askLine = rec(s, 'user', ts(0), st.block ? [{ type: 'text', text: st.ask }] : st.ask, st.uuid);
      // A message queued while Claude works: an attachment record whose prompt is a string, or blocks (text, an image).
      const q = st.queued, queued = q ? [JSON.stringify({ type: 'attachment', uuid: id('q-'), sessionId: s.id, cwd, timestamp: ts(5000),
        attachment: { type: 'queued_command', prompt: q.blocks ? [{ type: 'text', text: q.text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } }] : q.text } })] : [];
      log.push(`turn ${st.mark} ${st.kind}${st.ask.startsWith('<private-session>') ? ' <private-session>' : ''}${q ? `, a queued message (${q.blocks ? 'blocks' : 'string'}${q.secret ? ', private' : ''})` : ''}${st.shapes ? ', with secret shapes' : ''} at ${ts(0)}, ${size} tokens${st.collides ? `, collides with ${st.collides}` : ''}${st.cut ? ', cut mid-way' : ''}${st.half ? ', answer half written' : ''}${st.broken ? ', then a broken line' : ''}`);
      if (st.cut) {
        // Cut mid-way: background launches (and the notices of some that ended),
        // then a tool call with no result and no answer yet. The turn ends at the next Stop.
        let k = 0;
        const lines = [askLine, ...queued], last = st.tool ?? { type: 'tool_use', id: `c${st.uuid}`, name: 'Read', input: { file_path: 'C:\\fuzz\\a.txt' } };
        for (const l of st.launches) {
          lines.push(rec(s, 'assistant', ts(1000 * ++k), [{ type: 'tool_use', id: `b${l.id}`, name: 'Bash', input: { command: 'npm test' } }], id(`b${k}-`), size, 'tool_use'));
          lines.push(rec(s, 'user', ts(1000 * ++k), [{ type: 'tool_result', tool_use_id: `b${l.id}`, content: `Command running in background with ID: ${l.id}. Output is being written to: C:\\fuzz\\tasks\\${l.id}.output` }], id(`b${k}-`)));
          log.push(`  launch ${l.id}${l.done ? ', then its notice' : ''}`);
        }
        for (const l of st.launches) if (l.done) ended.add(l.id), lines.push(JSON.stringify({ type: 'attachment', uuid: id(`n${++k}-`), sessionId: s.id, cwd, timestamp: ts(1000 * k), attachment: { type: 'queued_command', prompt: `<task-notification><task-id>${l.id}</task-id></task-notification>` } }));
        lines.push(rec(s, 'assistant', ts(1000 * ++k), [last], id('c-'), size, 'tool_use'));
        appendFileSync(s.t, `${lines.join('\n')}\n`);
        s.ctx = size; s.mid = true;
        s.open = { st, rest: `${rec(s, 'user', ts(1000 * ++k), [{ type: 'tool_result', tool_use_id: last.id, content: 'removed 0' }], id('r-'))}\n${rec(s, 'assistant', ts(1000 * ++k), [{ type: 'text', text: st.did }], id('a-'), size)}\n` };
        return;
      }
      // As Claude Code writes a turn: a tool call and its result on lines of their
      // own, when it runs, before the answer; only the answer can be half written.
      const user = [askLine, ...queued,
        ...(st.tool ? [rec(s, 'assistant', ts(10_000), [st.tool], id('t-'), size),
          rec(s, 'user', ts(20_000), [{ type: 'tool_result', tool_use_id: st.tool.id, content: 'removed 0' }], id('r-'))] : [])].join('\n');
      const asst = rec(s, 'assistant', ts(30_000), [{ type: 'text', text: st.did }], id('a-'), size);
      // A Stop may come while the answer's line is half written; it is finished before the next turn.
      if (st.half) { const at = Math.floor(asst.length / 2); appendFileSync(s.t, `${user}\n${asst.slice(0, at)}`); s.rest = `${asst.slice(at)}\n`; s.restSize = size; if (st.tool) { s.ctx = size; s.mid = false; } }
      else { appendFileSync(s.t, `${user}\n${asst}\n${st.broken ? '{"type":"user","message":\n' : ''}`); s.ctx = size; s.mid = false; }
    },
    stop: async (st) => { await stop(session(st.s), st.tz, true, st); },
    // Concurrent: each spawn takes the fault setting of its own call. A kill falls on the first only.
    stops: async (st) => { log.push('both Stops at once:'); await Promise.all(st.ss.map((id, i) => stop(session(id), st.tz, false, { fault: st.fault, kill: i ? 0 : st.kill }))); },
    gate: async ({ s, trigger, tz, fault }) => {
      const c = session(s), file = join(dir, 'handoff.md');
      log.push(`the compaction gate (${trigger}) for ${s} TZ=${tz}, at ${c.ctx} tokens${c.mid ? ' mid-turn' : ''}`);
      const marked = existsSync(file) && readFileSync(file, 'utf8').includes('<!-- auto:start -->');
      const g = await run(GATE, [], JSON.stringify({ cwd, transcript_path: c.t, session_id: s, hook_event_name: 'PreCompact', trigger }), tz, { fault: faultOf({ fault }) });
      if (fault) hurtRules(g, 'the compaction gate', { fault });
      // 2 exactly for an automatic compaction in the middle of a turn, from the floor to the ceiling.
      const want = trigger === 'auto' && c.mid && c.ctx >= 200_000 && c.ctx < 0.9 * MODEL_WINDOW ? 2 : 0;
      if (g.status !== 0 && g.status !== 2) problems.push(`the compaction gate exited ${g.status ?? g.signal}: ${g.err.trim().split('\n').slice(-1)}`);
      else if (g.status !== want && !fault) problems.push(`the compaction gate exited ${g.status}, not ${want} (${trigger}, ${c.mid ? 'mid-turn' : 'at a turn boundary'}, ${c.ctx} tokens)`);
      for (const sec of secrets) if ((g.out + g.err).includes(sec)) problems.push(`the compaction gate printed private text ${sec}`);
      // What it wrote, read now: the next Stop takes the note out again.
      const h = existsSync(file) ? readFileSync(file, 'utf8') : '';
      for (const sec of secrets) if (h.includes(sec)) problems.push(`private text ${sec} is in handoff.md after the compaction gate`);
      for (const [mark, m] of marks) if (m.kind === 'forget' && h.includes(mark)) problems.push(`a turn that ran forget: ${mark} is in handoff.md after the compaction gate`);
      // A compaction let through over the ceiling, in a conversation that is not private, leaves a note
      // that names each of the turn's launches not yet done, and none whose notice has come, from this turn or an
      // earlier one (whether an earlier launch is named depends on how much of the file is read) -- when the file had its section to put it in.
      const turnCut = c.open?.st;
      if (trigger === 'auto' && c.mid && c.ctx >= 0.9 * MODEL_WINDOW && turnCut?.kind === 'plain' && !turnCut.secret && !turnCut.queued?.secret && !c.private && marked && !fault) {
        const head = `**cut mid-turn** [${s.slice(0, 8)}]`, i = h.indexOf(head), note = i === -1 ? '' : h.slice(i, h.indexOf('**edited this turn:**', i));
        if (i === -1) problems.push(`no cut-turn note in handoff.md after the gate over 90% (${s}, ${c.ctx} tokens)`);
        else {
          for (const l of turnCut.launches) if (!l.done && !note.includes(l.id)) problems.push(`the cut-turn note does not name launch ${l.id}, not yet done`);
          for (const id of ended) if (note.includes(id)) problems.push(`the cut-turn note names launch ${id}, done`);
        }
      }
    },
    cli: async (st) => { log.push(`memory.mjs ${st.args.join(' ')}${st.fault ? ` with faults (seed ${st.fault.seed}, rate ${st.fault.rate})` : ''}`); await cli(st.tz, st.args, st); },
    // A forget by key, then the conversation's next Stop: the exchange stays out.
    // Only of an exchange a Stop has seen, as in a whole round: a shrunk one can
    // lose the turn or its Stop, and a key not yet saved is no forget.
    forgetKey: async ({ mark, uuid, s, tz }) => {
      const m = marks.get(mark);
      if (!m || m.turn > m.s.stopped) { log.push(`forget --key ${uuid}: not run, no Stop has seen ${mark}`); return; }
      log.push(`forget --key ${uuid} --yes (${mark})`);
      const c = await cli(tz, ['forget', '--key', uuid, '--yes']);
      if (c.status !== 0) problems.push(`forget --key ${uuid} --yes exited ${c.status}: ${c.out.trim().split('\n').slice(-1)}`);
      forgotten.add(mark);
      await stop(session(s), tz);
    },
    // The snapshots of a note: no more lines than --limit (30 without), and nothing of the user's real folder.
    history: async ({ name, tz, all, limit }) => {
      const a = ['history', name, ...(all ? ['--all'] : []), ...(limit ? ['--limit', String(limit)] : [])];
      log.push(`memory.mjs ${a.join(' ')}`);
      const c = await cli(tz, a);
      if (c.out.split('\n').filter((l) => /^ {2}[0-9a-f]{7,40} /.test(l)).length > (limit || 30)) problems.push(`memory.mjs ${a.join(' ')} listed more than ${limit || 30} snapshots`);
      realFolder(c, a);
    },
    // A note back from the snapshots (a commit from its history in half the runs): it is then one of the texts it has had, and a
    // restore that fails (exit 1), or that is not forced over a note there, changes nothing. A note promoted is not brought back
    // (no --force: that would make a second copy).
    restore: async ({ name, tz, rev, force, pick }) => {
      const f = `${name}.md`, mine = notes.has(f), p = join(dir, f);
      let from = [];
      if (rev) {
        const hs = [...(await cli(tz, ['history', name, '--limit', '100'])).out.matchAll(/^ {2}([0-9a-f]{7,40}) /gm)].map((m) => m[1]);
        if (hs.length) from = ['--rev', hs[Math.floor(pick * hs.length)]];
      }
      const a = ['restore', name, ...from, ...(force && mine ? ['--force'] : []), '--yes'];
      log.push(`memory.mjs ${a.join(' ')}`);
      const was = mine ? notes.get(f) : null;
      const c = await cli(tz, a);
      realFolder(c, a);
      let now = null; try { now = readFileSync(p, 'utf8'); } catch {}
      if (!mine) { if (now !== null) problems.push(`restore ${name}, which the round does not hold (promoted or never made), wrote ${p}`); return; }
      if (now === null) { problems.push(`${f} is gone after restore`); return; }
      if (!texts.get(f).has(now)) problems.push(`restore left ${f} with a text the round never gave it: ${JSON.stringify(now.slice(0, 120))}`);
      else if ((c.status !== 0 || !force) && now !== was) problems.push(`restore ${a.slice(1).join(' ')} exited ${c.status}${force ? '' : ' without --force'} and changed ${f}`);
      notes.set(f, now);
    },
    // A note moved to the shared store, once, with one index line there and none in the project.
    promote: async ({ name, tz }) => {
      const f = `${name}.md`, text = notes.get(f), shared = join(home, '.claude', 'projects', '_shared', 'memory');
      log.push(`memory.mjs promote ${name} --yes`);
      const c = await cli(tz, ['promote', name, '--yes']);
      realFolder(c, ['promote', name]);
      if (c.status !== 0) { if (text !== undefined && existsSync(join(dir, f)) && readFileSync(join(dir, f), 'utf8') !== text) problems.push(`promote ${name} exited ${c.status} and changed ${f}`); return; }
      if (text === undefined) { problems.push(`promote ${name}, which the round does not hold, exited 0`); return; }
      promoted.set(f, { text, shared }); notes.delete(f);
    },
    // Every line says ok or PROBLEM, the exit is 1 exactly when one says PROBLEM, and none names the user's own folder.
    doctor: async ({ tz }) => {
      log.push('memory.mjs doctor');
      const c = await cli(tz, ['doctor']);
      realFolder(c, ['doctor']);
      const lines = c.out.split('\n').filter(Boolean);
      if (lines.some((l) => !/^(ok {5}|PROBLEM) /.test(l))) problems.push(`doctor printed a line that is neither ok nor PROBLEM: ${lines.find((l) => !/^(ok {5}|PROBLEM) /.test(l)).slice(0, 160)}`);
      else if ((c.status === 0) === lines.some((l) => l.startsWith('PROBLEM'))) problems.push(`doctor exited ${c.status} with ${lines.filter((l) => l.startsWith('PROBLEM')).length} PROBLEM line(s)`);
    },
  };
  // A command run in the round's temp home reads that home: the user's own ~/.claude is named in none of its output.
  // (The folder these files are in may be under it, and the Stop hook logs where it runs from: that path is not the home's.)
  const realFolder = (c, a) => {
    const l = (c.out + c.err).split('\n').find((x) => x.replaceAll('\\', '/').toLowerCase().replace(OWN, '').includes(REAL));
    if (l) problems.push(`memory.mjs ${a[0]} named the user's own ${REAL}: ${l.slice(0, 200)}`);
  };
  // A store has its MEMORY.md (a Stop leaves a folder without one alone): with
  // the index step cut, an empty one, as generate makes when it draws no line.
  if (!steps.some((st) => st.type === 'index')) act.index({ lines: [] });
  for (const st of steps) {
    if (!['turn', 'stop', 'stops', 'gate'].includes(st.type)) finish();
    await act[st.type](st);
    if (st.fault || st.kill) ageLocks();   // a lock a refused unlock left is a killed hook's: the designed LOCK_STALE case
  }
  finish();
  // The round's end. Each conversation's closing Stop, for a turn no Stop has
  // seen (none in a whole round); with no conversation, one in a fresh one, as
  // a Stop is what indexes the notes. Then the last Stops again, nothing new:
  // the store settles.
  // A look at the journal is made once ACTIVE has passed, not at every Stop (journal.mjs): the wait is dated away, so an older
  // conversation a faulted or killed look left is taken in, and a failed one is retried.
  if (existsSync(join(dir, 'journal'))) writeFileSync(join(dir, 'journal', '.looked'), String(Date.now() - ACTIVE - 1000));
  // A transcript a faulted look could not open is listed ` failed <ms>` and tried again after RETRY (journal.mjs, 24 h): that wait is dated away too (C1, R38).
  const imported = join(dir, 'journal', '.imported');
  if (existsSync(imported)) writeFileSync(imported, readFileSync(imported, 'utf8').replace(/ failed \d+/g, ` failed ${Date.now() - 25 * 3600e3}`));
  if (!sessions.size) session(briefing.session);
  for (const s of sessions.values()) if (s.turns > s.stopped) await stop(s, lastTz);
  let before = files(), settled = false;
  for (let k = 0; k < 4 && !settled; k++) {
    for (const s of sessions.values()) await stop(s, lastTz);
    const after = files();
    settled = after.size === before.size && [...after].every(([f, s]) => before.get(f) === s);
    before = after;
  }
  if (!settled) problems.push('repeating the last Stop never settled: a file changed on each of four');

  // A hook exits 0 whatever happens, and says what failed in a file: none may
  // be there. Not .health: it names what is wrong with the store (a hand-written
  // line pointing at no file), which hostile notes are meant to make.
  for (const f of readdirSync(dirname(proj)).filter((n) => n.startsWith('.handoff-failed-'))) problems.push(`${f}: ${readFileSync(join(dirname(proj), f), 'utf8').trim().slice(0, 300)}`);
  // A store whose every conversation is private or held with auto memory off writes nothing, and a Stop that writes nothing clears no failure (a memory-off sweep returns hush=false, journal.mjs take(); seed 705302203) (journal.test.mjs:324-330, "clears no failure"), so a failure it left stays: not a rule there.
  // Only its live-write lines: a backfill's line (`"error":"backfill: `) is cleared by the look the settle phase makes due, private conversations or not.
  const failedLines = existsSync(join(dir, 'journal', '.failed')) ? readFileSync(join(dir, 'journal', '.failed'), 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const stale = [...sessions.values()].every((c) => c.private || c.off) ? failedLines.filter((l) => l.includes('"error":"backfill: ')) : failedLines;
  if (stale.length) problems.push(`journal/.failed: ${stale.join(' ').slice(0, 300)}`);
  const after = files();
  const brief = await run(LOG, ['--print'], JSON.stringify({ cwd, session_id: briefing.session, source: briefing.source }), lastTz);
  if (brief.status !== 0) problems.push(`the startup briefing exited ${brief.status ?? brief.signal}`);
  // The briefing's limit as the code defines it (handoff-log.mjs fit()): 9,500 characters in all, whatever the source, and at a
  // startup or a /clear no line over 1,000 (and the ellipsis a cut line ends with).
  const SAY = 9500, LINE = 1001;
  if (brief.out.length > SAY) problems.push(`the ${briefing.source} briefing is ${brief.out.length} characters, over ${SAY}`);
  if (['startup', 'clear'].includes(briefing.source) && brief.out.split('\n').some((l) => l.length > LINE)) problems.push(`a line of the ${briefing.source} briefing is over ${LINE} characters`);
  // A startup of a conversation the round does not hold: the briefing names where the last session ended, the ask of the
  // newest exchange of the conversation handoff.md lists last -- when that is under a week old and no other session is working.
  const fresh = await run(LOG, ['--print'], JSON.stringify({ cwd, session_id: 'zzbrief0-1', source: 'startup' }), lastTz);
  if (fresh.status !== 0) problems.push(`the startup briefing of a new conversation exited ${fresh.status ?? fresh.signal}`);
  if (fresh.out.length > SAY) problems.push(`the startup briefing of a new conversation is ${fresh.out.length} characters, over ${SAY}`);
  if (fresh.out.split('\n').some((l) => l.length > LINE)) problems.push(`a line of the startup briefing of a new conversation is over ${LINE} characters`);
  {
    const doc = existsSync(join(dir, 'handoff.md')) ? readFileSync(join(dir, 'handoff.md'), 'utf8') : '', { a, b } = sectionOf(doc);
    const listed = a === -1 ? [] : parse(doc.slice(a + '<!-- auto:start -->'.length, b)), last = listed.at(-1);
    const days = last && (Date.now() - Date.parse(`${last.at.replace(' ', 'T')}:00Z`)) / 86400_000;
    // The clock gap between a zone and UTC is a day at most: under 5 days it is under 7, over 9 it is over.
    const due = last && days < 5, notDue = !last || days > 9;
    // The newest plain exchange of that conversation, as handoff.md lists it: the last entry. Entries carry the local minute only and are
    // ordered by it (byAt), so in the hour a clock goes back the real newest can be listed before an older one: the briefing follows the list.
    const mk = /ASK\d+n\d+/.exec(last?.ask ?? '')?.[0], want = mk && marks.get(mk)?.kind === 'plain' && !forgotten.has(mk) ? { mark: mk } : null;
    const said = /^Last session here ended .*$/m.exec(fresh.out)?.[0];
    if (!fresh.out.includes('Another session is working') && fresh.status === 0) {
      // A turn that ran forget is saved as `[private]` (PRIVACY.md) and is the last entry: the briefing names that, as the code does.
      if (due && last.ask === '[private]') { if (!said?.includes('on: [private] (log:')) problems.push(`the startup briefing does not name the last entry, [private]: ${(said ?? fresh.out).slice(0, 200)}`); }
      else if (due && want && !said?.includes(want.mark)) problems.push(`the startup briefing does not name ${want.mark}, the last plain exchange handoff.md lists (${last.s}): ${(said ?? fresh.out).slice(0, 200)}`);
      else if (notDue && said) problems.push(`the startup briefing names a last session that handoff.md ${last ? `lists ${Math.round(days)} days old` : 'does not list'}: ${said.slice(0, 200)}`);
    }
  }

  // A round with faults or kills: no half-written *.tmp<digits> file is named in the index or in `status`.
  if (steps.some((st) => st.fault || st.kill)) {
    const st = await run(CLI, ['status', '--store', dir], '', lastTz);
    for (const [where, text] of [['MEMORY.md', after.get('MEMORY.md') ?? ''], ['the output of status', st.out]]) { const m = TMP.exec(text); if (m) problems.push(`a half-written file, ${m[0]}, is named in ${where}`); }
  }
  // What was written: no secret, nothing forgotten, nothing of a private conversation.
  const handoff = after.get('handoff.md') ?? '', journal = [...after].filter(([f]) => f.startsWith('journal/')).map(([, s]) => s).join('\n');
  const places = [...[...after].filter(([f]) => f === 'handoff.md' || f.startsWith('journal/') || f.startsWith('MEMORY')), ['the briefing', brief.out], ['the briefing of a new conversation', fresh.out]];
  const count = (hay, w) => hay.split(w).length - 1;
  for (const sec of secrets) for (const [f, body] of places) if (body.includes(sec)) problems.push(`private text ${sec} is in ${f}`);
  for (const [mark, m] of marks) {
    const gone = m.kind === 'forget' || m.s?.private || forgotten.has(mark), why = m.kind === 'forget' ? 'a turn that ran forget' : m.s?.private ? (m.s.why ?? 'a <private-session> conversation') : 'an exchange forget --key removed';
    if (gone) { for (const [f, body] of places) if (body.includes(mark)) problems.push(`${why}: ${mark} is in ${f}`); }
    // Held with auto memory off, from a Stop on: never in the journal, even resumed with it on (PRIVACY.md). Its handoff.md lines
    // are not ruled: those of turns before the tag stay, as the docs do not say they go.
    else if (m.s?.off) { if (count(journal, mark) !== 0) problems.push(`a conversation held with auto memory off: ${mark} is in the journal ${count(journal, mark)} times`); }
    else if (m.kind === 'old') { if (count(journal, mark) !== 1) problems.push(`${mark} is in the journal ${count(journal, mark)} times`); }
    else {
      if (count(handoff, mark) !== 1) problems.push(`${mark} is in handoff.md ${count(handoff, mark)} times`);
      if (count(journal, mark) !== 1) problems.push(`${mark} is in the journal ${count(journal, mark)} times`);
    }
  }
  // Every note kept as written, with one index line.
  const lines = `${after.get('MEMORY.md') ?? ''}\n${after.get('MEMORY-archive.md') ?? ''}`;
  for (const [f, body] of notes) {
    if (!existsSync(join(dir, f))) { problems.push(`${f} is gone`); continue; }
    const now = readFileSync(join(dir, f), 'utf8');
    let k = 0; while (k < body.length && body[k] === now[k]) k++;
    if (now !== body) problems.push(`${f} was rewritten, from character ${k}: ${JSON.stringify(body.slice(Math.max(0, k - 20), k + 40))} -> ${JSON.stringify(now.slice(Math.max(0, k - 20), k + 40))}`);
    const n = lines.split('\n').filter((l) => l.includes(`](${f})`)).length;
    if (n !== 1) problems.push(`${f} has ${n} index lines`);
  }
  // A promoted note: in the shared store once, as it was, with one index line there; gone from the project, with no line left.
  for (const [f, { text, shared }] of promoted) {
    const at = (n) => { try { return readFileSync(join(shared, n), 'utf8'); } catch { return ''; } };
    if (at(f) !== text) problems.push(`promoted ${f} is not in the shared store as it was`);
    const k = (t) => t.split('\n').filter((l) => l.includes(`](${f})`)).length, n = k(at('MEMORY.md')) + k(at('MEMORY-archive.md'));
    if (n !== 1) problems.push(`promoted ${f} has ${n} index lines in the shared store`);
    if (existsSync(join(dir, f))) problems.push(`promoted ${f} is still in the project`);
    if (k(lines)) problems.push(`promoted ${f} still has ${k(lines)} index line(s) in the project`);
  }
  // What happened, for the one who replays it: every step, repeats too. With
  // FUZZ_KEEP=<folder>, a failing round's project folder is kept there as
  // round-<u>, an older copy replaced: its first failing run here, the whole
  // round, not a shrink's replays.
  const found = [...new Set(problems)], keep = process.env.FUZZ_KEEP && join(process.env.FUZZ_KEEP, `round-${u}`);
  if (found.length && keep && !kept.has(u)) { kept.add(u); rmSync(keep, { recursive: true, force: true, maxRetries: 5 }); cpSync(proj, keep, { recursive: true }); }
  return { found, story: ['--- the round:', ...log, '--- handoff.md entries:', ...handoff.split('\n').filter((l) => l.startsWith('- **asked**')).map((l) => l.slice(0, 120))] };
}

// A problem's kind: what it says, its numbers, ids and marks left out.
const kindOf = (problem) => problem.replace(/ASK\w+|OLD\w+|ZQX\w+|[0-9a-f]{6,}|\d+/g, '#');

// The fewest steps found that still fail with a problem of the kind: runs of
// half the steps taken out, then quarters, down to single steps, a cut kept
// when a replay without those steps fails with the kind (delta debugging).
// The kind leaves counts out, so what is left can fail another way (a turn
// listed 0 times, not 3): the whole round's problems are printed first. A
// failure that needs a race (two Stops at once) and does not come back on a
// replay keeps steps it could lose: the list can be longer than it needs.
async function shrinkWith(exec, steps, kind, { replays = 200, ms = 120_000 } = {}) {
  const end = Date.now() + ms, fails = async (xs) => (await exec(xs)).some((p) => kindOf(p) === kind);
  for (let size = Math.max(1, steps.length >> 1); replays > 0 && Date.now() < end;) {
    let cut = false;
    for (let i = 0; i < steps.length && replays > 0 && Date.now() < end; replays--) {
      const rest = steps.toSpliced(i, size);
      if (await fails(rest)) { steps = rest; cut = true; } else i += size;
    }
    if (!cut && size === 1) break;
    if (!cut) size = Math.max(1, size >> 1);
  }
  return steps;
}
const shrink = (steps, meta, kind, opts) => shrinkWith(async (xs) => (await execute(xs, meta)).found, steps, kind, opts);

// Self-checks, before any round.
assert.equal(kindOf('ASK123f0n4 is in handoff.md 0 times'), '# is in handoff.md # times');
// shrink keeps a step list only while the same kind fails (a fake executor: fails when steps 2 and 5 are both there,
// another way with 2 alone), and stops once no single step can go.
let calls = 0;
const fakeExec = async (xs) => { calls++; return xs.includes(2) ? [xs.includes(5) ? 'boom 1' : 'bang 1'] : []; };
assert.deepEqual((await shrinkWith(fakeExec, [0, 1, 2, 3, 4, 5, 6], 'boom #')).sort(), [2, 5]);
assert.ok(calls <= 20, `shrinking 7 steps took ${calls} replays`);
// All of a round's randomness is in generate: a seed gives the same steps twice.
assert.deepEqual(generate(7), generate(7));
// Faults stay under their root: the preload, at rate 1, fails a write under it with one of four codes, and nothing else (a folder
// beside it with the same start, a file descriptor, a file outside), and the plugin's modules still import.
{
  const root = mkdtempSync(join(tmpdir(), 'fuzz-root-')), outside = mkdtempSync(join(tmpdir(), 'fuzz-out-')), beside = `${root}x`;
  mkdirSync(beside);
  // fs.promises is not wrapped: its handle is an fd whose file is under the root, which a wrapped call must let through.
  const script = `const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url'), [root, out, beside, store] = process.argv.slice(1);
    const t = (f) => { try { f(); return 'ok'; } catch (e) { return e.code; } };
    (async () => { const h = await fs.promises.open(path.join(root, 'fd'), 'w');
      console.log(JSON.stringify({ under: t(() => fs.writeFileSync(path.join(root, 'a'), 'x')), outside: t(() => fs.writeFileSync(path.join(out, 'b'), 'x')),
        beside: t(() => fs.writeFileSync(path.join(beside, 'c'), 'x')), fd: t(() => fs.writeFileSync(h.fd, 'x')),
        url: t(() => fs.writeFileSync(pathToFileURL(path.join(root, 'u')), 'x')), buffer: t(() => fs.writeFileSync(Buffer.from(path.join(root, 'b')), 'x')),
        folded: process.platform === 'win32' ? t(() => fs.writeFileSync(path.join(root.toUpperCase(), 'f'), 'x')) : 'skip', dotted: t(() => fs.writeFileSync(path.join(root, '..x'), 'x')),
        imported: typeof (await import(store)).LOCK_STALE })); })();`;
  process.env.FUZZ_FAULTS = `1:1:${root}`;
  const r = spawnSync(process.execPath, ['--require', FAULTS, '-e', script, root, outside, beside, pathToFileURL(join(dirname(FAULTS), 'store.mjs')).href], { encoding: 'utf8' });
  delete process.env.FUZZ_FAULTS;
  const got = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : r.stderr.trim().split('\n').slice(-3).join(' | ');
  for (const d of [root, outside, beside]) rmSync(d, { recursive: true, force: true });
  const four = (c) => ['EBUSY', 'EPERM', 'EACCES', 'ENOSPC'].includes(c);
  assert.ok(four(got.under) && four(got.dotted) && (got.folded === 'skip' || four(got.folded)) && got.outside === 'ok' && got.beside === 'ok' && got.fd === 'ok' && got.url === 'ok' && got.buffer === 'ok' && got.imported === 'number', `the fault preload: ${JSON.stringify(got)}`);
}
// The two rules that read a process's output read what Node really prints, and a half-written file's name, and not an ordinary line.
{
  const real = new Error('boom').stack.replace(/^Error: boom\n/, '');
  assert.ok(STACK.test(real) && STACK.test('    at file:///C:/x/y.mjs:3:9') && STACK.test('Error: x\r\n    at f (C:\\x\\y.mjs:1:2)\r\n'), `the stack-trace rule misses a real stack: ${real}`);
  assert.ok(!STACK.test('memory: 3 notes, last at 10:30') && !STACK.test('it stopped at the gate'), 'the stack-trace rule fires on an ordinary line');
  assert.ok(TMP.test('MEMORY.md.tmp123') && TMP.test('- [x](C:\\s\\2026-10-31.md.tmp4242) y') && !TMP.test('MEMORY.md') && !TMP.test('a note about .tmp files'), 'the half-written-file rule misreads a name');
}
// Every list of a round's steps is a whole round: a lone turn, a lone note hold on correct code.
let nextLone = 0;
const lone = generate(12345), allShapes = shapesOf(rng(99));
const oldOne = (how) => ({ type: 'old', id: 'oabcdef0-1234', how, exchanges: [{ mark: `OLD${how ?? 'plain'}n0`, ask: `${how === 'mark' ? '<private-session> ' : ''}OLD${how ?? 'plain'}n0 first`, did: 'done first' }, { mark: `OLD${how ?? 'plain'}n1`, ask: `OLD${how ?? 'plain'}n1 second`, did: 'done second' }] });
const plain = lone.steps.find((x) => x.type === 'turn' && x.kind === 'plain' && !x.ask.startsWith('<private-session>'));
// A turn cut mid-way (past the ceiling, one launch), a turn past the trigger, and a gate alone or after the cut turn.
const cutTurn = { ...plain, cut: true, size: SIZES[4], launches: [{ id: 'bgx0', done: false }] }, gate = { type: 'gate', s: plain.s, trigger: 'auto', tz: 'UTC' };
const oneNote = lone.steps.find((x) => x.type === 'note'), stopOf = { type: 'stop', s: plain.s, tz: 'UTC' };
const LONE = [['turn', [plain]], ['note', [lone.steps.find((x) => x.type === 'note')]], ['cut turn', [cutTurn]], ['turn past the trigger', [{ ...plain, size: SIZES[3] }]], ['gate', [gate]], ['turn that collides', [{ ...plain, collides: 'ASK1' }]], ['cut turn, gate', [cutTurn, gate]],
  ['Stop with faults', [{ type: 'stop', s: plain.s, tz: 'UTC', fault: { seed: 3, rate: 0.3 } }]], ['Stop killed', [{ type: 'stop', s: plain.s, tz: 'UTC', kill: 40 }]],
  ['gate with faults', [{ ...gate, fault: { seed: 5, rate: 0.3 } }]], ['CLI with faults', [{ type: 'cli', args: ['status'], tz: 'UTC', fault: { seed: 7, rate: 0.3 } }]],
  ['queued string', [{ ...plain, queued: { blocks: false, text: 'queued words' } }]], ['queued blocks, private', [{ ...plain, did: `${plain.did} ZQXQlone`, tool: { type: 'tool_use', id: 'qlone', name: 'Bash', input: { command: 'echo ZQXQlone' } }, queued: { blocks: true, secret: 'ZQXQlone', text: '<private>ZQXQlone</private> words' } }]],
  ['every secret shape', [{ ...plain, shapes: { text: [...allShapes.secrets.map(([t]) => t), ...allShapes.near.map(([t]) => t)].join('\n'), secrets: allShapes.secrets.map(([, s]) => s) } }]],
  ['every secret shape, two blanks or a tab before its value', [{ ...plain, shapes: { text: allShapes.secrets.map((sh, k) => widen(sh, k % 2 ? '\t' : '  ')[0]).join('\n'), secrets: allShapes.secrets.map(([, s]) => s) } }]],
  ['auto memory off', [{ type: 'off', s: plain.s, tz: 'UTC' }]], ['turn, Stop, auto memory off', [plain, { type: 'stop', s: plain.s, tz: 'UTC' }, { type: 'off', s: plain.s, tz: 'UTC' }]],
  ['history', [{ type: 'history', name: 'no-such-note', tz: 'UTC', all: true, limit: 2 }]], ['restore', [{ type: 'restore', name: 'no-such-note', tz: 'UTC', rev: true, force: true, pick: 0.5 }]],
  ['promote', [{ type: 'promote', name: 'no-such-note', tz: 'UTC' }]], ['doctor', [{ type: 'doctor', tz: 'UTC' }]],
  ['note, edit, Stop, restore', [oneNote, { type: 'edit', name: oneNote.name, text: 'edited' }, plain, stopOf, { type: 'restore', name: oneNote.name, tz: 'UTC', rev: true, force: true, pick: 0 }, { type: 'history', name: oneNote.name, tz: 'UTC', all: false, limit: 1 }]],
  ['note, Stop, promote', [oneNote, plain, stopOf, { type: 'promote', name: oneNote.name, tz: 'UTC' }, { type: 'restore', name: oneNote.name, tz: 'UTC', rev: false, force: true, pick: 0 }]],
  ['older conversation', [oldOne()]], ...['mark', 'off', 'list'].map((how) => [`older conversation (${how})`, [oldOne(how)]])];
// Each in a home of its own, a few at a time: they wait on processes, not on each other.
const alone = [];
await Promise.all(Array.from({ length: Math.min(LONE.length, availableParallelism()) }, async () => {
  for (let i; (i = nextLone++) < LONE.length; ) alone[i] = [LONE[i][0], (await execute(LONE[i][1], { ...lone.meta, home: `lone${i}` })).found];
}));
assert.deepEqual(alone.map(([n, f]) => [n, f.length]), alone.map(([n]) => [n, 0]), `a lone step fails on correct code: ${JSON.stringify(alone.filter(([, f]) => f.length))}`);
assert.equal(alone.length, 27, 'the lone-step list changed size');

// --keep-going: every failing round named, not just the first (a bug hunt),
// with its story, 60 lines at most. Otherwise the first failing round, shrunk
// unless --no-shrink, and the story of what is left of it.
const keepGoing = args.includes('--keep-going'), noShrink = args.includes('--no-shrink'), start = Date.now(), first = only ?? Math.floor(Math.random() * 2 ** 31);
let rounds = 0, failed = 0;
for (let seed = first; only === null ? Date.now() - start < seconds * 1000 : rounds < 1; seed++) {
  rounds++;
  const { steps, meta } = generate(seed), { found, story } = await execute(steps, meta);
  if (!found.length) continue;
  failed++;
  console.log(`fuzz: round ${seed} failed (round number ${rounds} of this run; replay: node fuzz.mjs --seed ${seed}):`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- seed ${seed}: ${found[0].replace(/\n/g, ' ')}\n`);
  if (keepGoing) { for (const p of [...found, ...story].slice(0, 60)) console.log(`  ${p}`); continue; }
  for (const p of noShrink ? [...found, ...story] : found) console.log(`  ${p}`);
  if (!noShrink) {
    const small = await shrink(steps, meta, kindOf(found[0])), again = await execute(small, meta);
    console.log(`fuzz: shrunk to ${small.length} of ${steps.length} steps:`);
    if (!again.found.length) console.log('  (they held on this replay: the failure needs a race)');
    for (const p of [...again.found, ...again.story]) console.log(`  ${p}`);
  }
  break;
}
// Not process.exit(): a pipe's output can be cut short (CONTRIBUTING).
console.log(failed ? `fuzz: ${failed} of ${rounds} round(s) failed` : `fuzz: ${rounds} round(s) from seed ${first} held, ${Math.round((Date.now() - start) / 1000)} s`);
process.exitCode = failed ? 1 : 0;
