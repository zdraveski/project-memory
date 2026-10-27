#!/usr/bin/env node
// What a person, or the model, asks of the memory the hooks keep: find a
// memory, see a store's state, take one back from the snapshots, share one with
// every project, check the hooks are wired. The hooks write on their own; this
// writes only when told to, under the same lock.
const USAGE = `node memory.mjs <command> [--store <dir> | --shared]
  search <terms...> [--all] [--limit N]   ranked: name, description, then body; archive included
  status [--all]                          index size, hot/archived, problems, dangling [[links]]
  history <memory> [--all]                the snapshots that changed it
  restore <memory> [--rev <commit>] [--force]   back from the snapshots, with its index line
  promote <memory>                        move it to the shared store, for every project
  doctor                                  wiring, live copy, Stop hook, locks, git
The store is this session's own (outside a session: the cwd's project, or the nearest
folder above it with one) unless --store or --shared says otherwise.`;
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { storeOf, sharedStore, isShared, projectsRoot, withLock, replaceIfUnchanged, budgetOf, POINTER, ARCHIVE, LOCK_STALE, raw, gitWhy, front, allStores, same } from './store.mjs';
import { sectionOf, parse, transcripts, stalled, lastTurn, GRACE, edited, local, clip } from './handoff-log.mjs';

const OVERFLOW = /\s*<!-- overflow -->$/;

// What wire.mjs and deploy.mjs need to agree with doctor about, defined once:
// the plugin, the live copy, which handlers are these hooks, and what runs.
export const PLUGIN = 'project-memory@project-memory';
export const LIVE = join(homedir(), '.claude', 'hooks-live');
const HOOK_FILES = ['memory-tier.mjs', 'handoff-log.mjs', 'compact-gate.mjs'];
export const ours = (h) => [h.command, ...(h.args || [])].some((c) => HOOK_FILES.some((f) => String(c || '').includes(f)));
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const plugins = (f) => json(join(homedir(), '.claude', 'plugins', f));
// The installed plugin's id, from whichever marketplace added it: this repo's
// own (GitHub, or the live copy) or another that lists it.
const installedId = () => Object.keys(plugins('installed_plugins.json')?.plugins ?? {}).find((k) => k.split('@')[0] === 'project-memory');
// Where the installed plugin is copied to: one folder per version in Claude Code's cache.
export const installPath = () => plugins('installed_plugins.json')?.plugins?.[installedId()]?.[0]?.installPath ?? null;
// Where it runs from. Installed from a local folder -- for the maintainer, the
// live copy -- it is read in place (`claude plugin list`: readFromFolder), and
// the cache copy only sits beside it (measured 2026-10-27, Claude Code 2.1.311).
export const marketplace = () => plugins('known_marketplaces.json')?.[installedId()?.split('@')[1]]?.source ?? null;
export const pluginRoot = () => installPath() && (marketplace()?.source === 'directory' ? marketplace().path : installPath());
// The commit deploy.mjs checked and copied into a folder.
export const deployedCommit = (dir) => json(join(dir, '.deployed.json'))?.commit ?? null;

// `raw` (store.mjs) is what replaceIfUnchanged compares against; `read` is for parsing.
const read = (p) => { try { return readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch { return null; } };
// A BOM before the first line hid its pointer: promote left that line behind.
const target = (line) => (line.replace(/^\uFEFF/, '').match(POINTER) || [])[1];
const targets = (text) => (text ?? '').split(/\r?\n/).map(target).filter((t) => t && t !== ARCHIVE);
const no = (why) => ({ ok: false, lines: [why] });

// Every memory in a store: what its frontmatter says, its [[links]], and which
// index names it.
export function memories(dir) {
  let files; try { files = readdirSync(dir); } catch { return []; }
  const hot = new Set(targets(read(join(dir, 'MEMORY.md')))), cold = new Set(targets(read(join(dir, ARCHIVE))));
  return files.filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).flatMap((file) => {
    const path = join(dir, file);
    const text = read(path);
    if (text === null) return [];
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1;
    const head = end === -1 ? '' : text.slice(0, end);
    const { name, desc, type, modified: stamp, superseded } = front(head);
    let mtime = 0; try { mtime = statSync(path).mtimeMs; } catch {}
    return [{
      file, path, dir, name, desc, type, superseded,
      body: end === -1 ? text : text.slice(text.indexOf('\n', end + 1) + 1),
      links: [...new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))],
      modified: Number.isNaN(stamp) ? mtime : stamp,
      where: hot.has(file) ? 'hot' : cold.has(file) ? 'archived' : 'unindexed',
    }];
  });
}

// Words that say nothing about which memory: in a model's natural-language
// query they scored like content -- "the" in a file name took the name bonus,
// and "how do we deploy the site" filled its last places with them (review).
const STOP = new Set(['the', 'and', 'for', 'how', 'what', 'why', 'with', 'was', 'are', 'not', 'this', 'that', 'from',
  'when', 'where', 'who', 'did', 'does', 'have', 'has', 'can', 'you', 'our', 'about', 'into', 'there', 'their', 'then', 'than']);
const words = (q) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOP.has(t)))];
const count = (hay, t) => hay.split(t).length - 1;

// Ranked, not grepped: a name says more than a description, a description more
// than a passing mention. Every term in the name or description is the strong
// match; every term somewhere in the body is a weak one, or a month-long log
// that mentions everything outranked the memory named for the thing ("deploy
// checklist", 2026-10-27).
export function search(dirs, query, limit = 8) {
  const terms = words(query), hits = [];
  for (const dir of terms.length ? dirs : []) for (const m of memories(dir)) {
    if (m.file === 'handoff.md') continue;   // a log the startup line prints, not a memory
    const name = `${m.file} ${m.name}`.toLowerCase(), desc = m.desc.toLowerCase(), body = m.body.toLowerCase();
    let score = 0, strong = true, every = true;
    for (const t of terms) {
      const s = (name.includes(t) ? 3 : 0) + (desc.includes(t) ? 2 : 0);
      const b = Math.min(2, count(body, t));
      if (!s) strong = false;
      if (!s && !b) every = false;
      score += s + b;
    }
    if (score) hits.push({ ...m, score: score + (strong ? 5 : every ? 2 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || b.modified - a.modified).slice(0, limit);
}

// What a [[link]] may name: a memory's file name without `.md`, or its `name:`.
const names = (ms) => ms.flatMap((m) => [m.file.replace(/\.md$/, ''), m.name].filter(Boolean));

export function status(dir, sharedNames = []) {
  const ms = memories(dir), main = read(join(dir, 'MEMORY.md'));
  const lines = [`${dir}${isShared(dir) ? '  (shared by every project)' : ''}`];
  if (main === null && !ms.length) return [...lines, '  no store here yet'];
  const n = (w) => ms.filter((m) => m.where === w).length;
  lines.push(`  index ${Buffer.byteLength(main ?? '')} / ${budgetOf(dir)} B · ${n('hot')} hot · ${n('archived')} archived` +
    (n('unindexed') ? ` · ${n('unindexed')} with no pointer yet` : ''));
  const health = (read(join(dir, '.health')) ?? '').trim();
  if (health) lines.push(...health.split('\n').map((h) => `  needs attention: ${h}`));
  const known = new Set([...names(ms), ...sharedNames]);
  const dangling = ms.flatMap((m) => m.links.filter((l) => !known.has(l)).map((l) => `${m.file} → [[${l}]]`));
  if (dangling.length) lines.push(`  links to no memory: ${dangling.join(', ')}`);
  const bare = ms.filter((m) => !m.desc || !m.type).map((m) => m.file);
  if (bare.length) lines.push(`  frontmatter without a description or type: ${bare.join(', ')}`);
  const doc = read(join(dir, 'handoff.md'));
  const { a, b } = sectionOf(doc ?? '');
  const all = a === -1 ? [] : parse(doc.slice(a, b));
  if (all.length) lines.push(`  handoff: ${all.length} exchanges from ${new Set(all.map((t) => t.s)).size} session(s), newest ${all.at(-1).at}`);
  const ch = recent(dir);
  if (ch) lines.push(`  changed in the last ${RECENT_DAYS} days: ${ch}`);
  return lines;
}

// The first n of a list, and how many it leaves out.
const more = (xs, n) => xs.slice(0, n).join(', ') + (xs.length > n ? `, and ${xs.length - n} more` : '');

// What the snapshots saw change in a store lately, so the user can see what
// Claude wrote down or dropped. The index and the handoff change every turn
// and are left out.
const RECENT_DAYS = 7;
function recent(dir) {
  let out; try { out = git('log', `--since=${RECENT_DAYS}.days`, '--no-renames', '--name-status', '--format=', '--', tracked(dir, '')); } catch { return ''; }
  const last = new Map(), born = new Set();
  for (const l of out.split('\n')) {
    const [st, p] = l.trim().split('\t');
    const f = p && p.split('/').pop();
    if (!f || !f.endsWith('.md') || f === 'handoff.md' || f.startsWith('MEMORY')) continue;
    if (!last.has(f)) last.set(f, st);                 // git lists the newest first
    if (st === 'A') born.add(f);
  }
  const of = (want) => [...last].filter(([f, st]) => want(f, st)).map(([f]) => f.replace(/\.md$/, ''));
  return [['added', of((f, st) => st !== 'D' && born.has(f))], ['edited', of((f, st) => st !== 'D' && !born.has(f))], ['deleted', of((f, st) => st === 'D')]]
    .filter(([, xs]) => xs.length).map(([w, xs]) => `${w} ${more(xs, 6)}`).join(' · ');
}

function snapshots() {
  let h = null; try { h = JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8')); } catch {}
  if (!h) return 'snapshots: none recorded yet';
  return h.failures ? `snapshots: failing, ${h.failures} in a row (${h.error}); last ok ${h.lastOk ? local(h.lastOk) : 'never'}`
    : `snapshots: ok, last ${local(h.lastOk)}`;
}

// The store the hooks give this session: Claude Code names the transcript by
// the session id, in the project folder it chose, whatever the cwd is now --
// a Bash cwd moved into another project once wrote that project's store.
// Outside a session, the cwd's project or the nearest folder above it with a
// store: a subdirectory's own slug has none, and searching it said "nothing".
function sessionStore() {
  const id = process.env.CLAUDE_CODE_SESSION_ID, root = projectsRoot();
  if (id) {
    let all = []; try { all = readdirSync(root); } catch {}
    for (const p of all) if (existsSync(join(root, p, `${id}.jsonl`))) return storeOf({ transcript_path: join(root, p, `${id}.jsonl`) });
  }
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(storeOf({ cwd: d }))) return storeOf({ cwd: d });
    if (dirname(d) === d) return storeOf({ cwd: process.cwd() });
  }
}

// The snapshot repo is ~/.claude/projects and tracks each store by its real
// path: memory-tier.mjs ignores the junctions.
const git = (...a) => execFileSync('git', ['-C', projectsRoot(), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
// The on-disk spelling: git's paths are case-sensitive, and the JS realpath
// keeps whatever case it was handed (a cwd typed in lower case).
const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const tracked = (dir, file) => relative(real(projectsRoot()), join(real(dir), file)).replace(/\\/g, '/');

export function history(dirs, file, everywhere = false) {
  const verb = { A: 'added', M: 'changed', D: 'deleted' };
  try {
    for (const dir of dirs) {
      const out = git('log', '--format=@%h %ad%x09%s', '--date=format:%Y-%m-%d %H:%M', '--name-status', '--', tracked(dir, file));
      const lines = [];
      let head = null;
      for (const l of out.split('\n')) {
        if (l.startsWith('@')) head = l.slice(1).split('\t');
        // The first snapshot took in what was already there: not when it was written.
        else if (head && verb[l[0]]) { lines.push(`  ${head[0]}  ${head[1] === 'memory: first snapshot' ? 'in the first snapshot' : verb[l[0]]}`); head = null; }
      }
      // The command that shows a change, with the path git tracks: a junctioned
      // store's own path shows nothing, and PowerShell expands no `~`.
      const moved = !isShared(dir) && existsSync(join(sharedStore(), file)) ? [`  promoted: it is in ${sharedStore()} now`] : [];
      if (lines.length) return { ok: true, lines: [join(dir, file), ...lines, ...moved, `  a change: git -C "${real(projectsRoot())}" show <commit> -- ${tracked(dir, file)}`] };
    }
  } catch (e) { return no(`no snapshots to read: ${gitWhy(e)}`); }
  return no(`no snapshot holds ${file} (looked in ${dirs.join(', ')}): search <words> finds a memory's name${everywhere ? '' : '; --all looks in every project'}`);
}

// By default the newest snapshot that has it: the last one, or, when the last
// one has it deleted, the one before that deletion. (The parent of the newest
// deletion alone brought back a version older than one made since.) The index
// line it had at that revision comes back with it: hand-written, where
// tiering's orphan recovery would give it a machine line in the archive.
export function restore(dir, file, { rev, force = false } = {}) {
  const path = join(dir, file), at = tracked(dir, file);
  if (existsSync(path) && !force) return no(`${path} exists; restore --force replaces it with the snapshot`);
  // Deleted here by a promote: brought back, it would be in both stores, loaded twice, drifting apart.
  if (!isShared(dir) && existsSync(join(sharedStore(), file)) && !force) return no(`${file} was promoted: it is in ${sharedStore()}; restore --force brings a second copy back here`);
  let from = rev, text;
  try {
    if (!from) {
      try { git('cat-file', '-e', `HEAD:${at}`); from = 'HEAD'; }
      catch { const gone = git('log', '-1', '--format=%h', '--diff-filter=D', '--', at).trim(); from = gone ? `${gone}^` : 'HEAD'; }
    }
    text = git('show', `${from}:${at}`);
  } catch (e) { return no(`no snapshot of ${at} at ${from || 'HEAD'}: ${gitWhy(e)}`); }
  let line = null;
  if (!file.startsWith('MEMORY')) {
    for (const idx of ['MEMORY.md', ARCHIVE]) {
      let t; try { t = git('show', `${from}:${tracked(dir, idx)}`); } catch { continue; }
      line = t.split(/\r?\n/).find((l) => target(l) === file)?.replace(OVERFLOW, '') ?? null;
      if (line) break;
    }
  }
  mkdirSync(dir, { recursive: true });
  const r = withLock(dir, () => {
    const cur = raw(path);
    if (cur !== null && !force) return `${path} appeared meanwhile; nothing written`;
    // Already that version: "restored" here told the model a bad version was gone.
    if (cur !== null && cur.replace(/^\uFEFF/, '') === text) return `${path} already matches ${from}: nothing to restore; history lists older versions, --rev <commit> picks one`;
    // What --force replaces is kept in the repo, not lost: no snapshot may hold it yet.
    let kept = '';
    if (cur !== null) { try { kept = `; what it replaced is kept: git -C "${real(projectsRoot())}" cat-file -p ${execFileSync('git', ['-C', projectsRoot(), 'hash-object', '-w', '--stdin'], { input: cur, encoding: 'utf8' }).trim()}`; } catch {} }
    if (replaceIfUnchanged(path, cur, text) === 'conflict') return `${path} changed meanwhile; nothing written`;
    if (file.startsWith('MEMORY')) return `restored ${path} from ${from}${kept}`;
    const idx = join(dir, 'MEMORY.md'), main = raw(idx);
    if ([main, raw(join(dir, ARCHIVE))].some((t) => targets(t).includes(file))) return `restored ${path} from ${from}; its index line is still there${kept}`;
    if (!line) return `restored ${path} from ${from}; no index line at that revision: the next turn's tiering gives it one${kept}`;
    const next = main ? main.replace(/\n*$/, '\n') + line + '\n' : line + '\n';
    if (replaceIfUnchanged(idx, main, next) === 'conflict') return `restored ${path} from ${from}; the index changed meanwhile, so the next turn's tiering gives it a line${kept}`;
    return `restored ${path} from ${from}, with its line: ${line}${kept}`;
  });
  if (r === null) return no(`${dir} is busy (another hook holds it); try again`);
  return { ok: r.startsWith('restored'), lines: [r] };
}

// Copy, index, and only then remove: a failure part-way leaves the memory in
// both stores, never in neither.
export function promote(dir, file) {
  const to = sharedStore(), src = join(dir, file), dst = join(to, file);
  if (isShared(dir)) return no(`${file} is in the shared store already`);
  if (file.startsWith('MEMORY') || file === 'handoff.md') return no('only a memory is shared, not an index or the handoff');
  if (!existsSync(src)) return no(`no ${src}`);
  if (existsSync(dst)) return no(`the shared store has a ${file} already: rename one, or merge them by hand`);
  mkdirSync(to, { recursive: true });
  // Project, then shared: whatever takes both locks takes them in this order.
  const r = withLock(dir, () => withLock(to, () => {
    const text = raw(src);
    if (text === null) return `${src} went away meanwhile; nothing moved`;
    let home = null, homeText = null, line = null;
    for (const p of [join(dir, 'MEMORY.md'), join(dir, ARCHIVE)]) {
      const t = raw(p), l = t?.split(/\r?\n/).find((x) => target(x) === file);
      if (l) { home = p; homeText = t; line = l.replace(OVERFLOW, ''); break; }
    }
    line ??= `- [${file.replace(/\.md$/, '').replace(/-/g, ' ')}](${file}) — ${front(text).desc || 'promoted'}`;
    if (replaceIfUnchanged(dst, null, text) === 'conflict') return `the shared store got a ${file} meanwhile; nothing moved`;
    const idx = join(to, 'MEMORY.md'), idxText = raw(idx);
    const next = (idxText ? idxText.replace(/\n*$/, '\n') : '# Shared memory\n\n') + line + '\n';
    if (replaceIfUnchanged(idx, idxText, next) === 'conflict') return `the shared index changed meanwhile: ${file} is in both stores, not yet in the shared index`;
    // The model's Edit takes no lock: one that landed since the copy keeps the
    // project copy, and its index line, where it was written.
    const edited = `${src} changed while it was copied: it is in both stores; merge the edit into ${dst}, then delete ${src} and its line by hand`;
    if (raw(src) !== text) return edited;
    if (home && replaceIfUnchanged(home, homeText, homeText.split(/\r?\n/).filter((x) => target(x) !== file).join('\n')) === 'conflict') {
      return `the project index changed meanwhile: ${file} is in both stores; delete ${src} and its line by hand`;
    }
    if (raw(src) !== text) return edited;
    try { unlinkSync(src); } catch (e) { return `${src} could not be deleted (${e.code}): it is in both stores; delete it by hand`; }
    return true;
  }));
  if (r === null) return no('a store is busy (another hook holds it); try again');
  return r === true ? { ok: true, lines: [`moved ${file} to ${to}; every project's sessions see its line from their next start`] } : no(r);
}

export function doctor() {
  const lines = [];
  let bad = 0;
  const say = (fine, text) => { lines.push(`${fine ? 'ok     ' : 'PROBLEM'} ${text}`); if (!fine) bad++; };
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch (e) { if (existsSync(settingsPath)) say(false, `${settingsPath} does not parse: ${e.message}`); }
  const wired = Object.entries(settings.hooks || {}).filter(([, es]) => (es || []).some((e) => (e.hooks || []).some(ours))).map(([ev]) => ev);
  const plugin = Object.entries(settings.enabledPlugins || {}).some(([k, v]) => v && k.split('@')[0] === 'project-memory');
  if (wired.length && plugin) say(false, `wired twice, by settings.json (${wired.join(', ')}) and by the project-memory plugin: every hook runs twice. The user's fix: delete those entries from settings.json, or disable the plugin`);
  else if (plugin) say(true, 'wired by the project-memory plugin');
  else if (wired.length) {
    const missing = ['Stop', 'SessionStart', 'PreCompact'].filter((ev) => !wired.includes(ev));
    say(!missing.length, missing.length ? `settings.json wires ${wired.join(', ')} but not ${missing.join(', ')}` : 'wired by settings.json: Stop, SessionStart, PreCompact (the memory skill comes only with the plugin, a switch for the user to make: in ~/.claude/hooks, node wire.mjs --plugin, then /reload-plugins in each open session)');
  } else say(false, `not wired: no hook in settings.json runs these, and the project-memory plugin is not enabled. The user's fix: claude plugin install ${PLUGIN} (after claude plugin marketplace add zdraveski/project-memory)`);
  if (existsSync(join(LIVE, '.deployed.json'))) { const e = edited(LIVE); say(!e.length, e[0] || `${LIVE} matches what deploy.mjs checked`); }
  // Installed from the live copy, the plugin runs it in place; from anywhere
  // else, a cached copy that only `claude plugin update` refreshes.
  if (plugin) {
    const at = pluginRoot();
    if (!at) say(false, `${PLUGIN} is enabled but not installed. The user's fix: claude plugin install ${PLUGIN}`);
    // From GitHub, or from any copy where nothing was deployed: it runs that copy.
    else if (!existsSync(join(LIVE, '.deployed.json')) || (marketplace()?.source !== 'directory' && !deployedCommit(at))) {
      say(true, `the plugin runs version ${json(join(at, '.claude-plugin', 'plugin.json'))?.version ?? '(none)'} from ${at}`);
    }
    // Added from anywhere but the live copy (the repo, a worktree), it runs
    // untested edits, and no plugin update fixes that.
    else if (marketplace()?.source === 'directory' && !same(at, LIVE)) say(false, `the plugin is read from ${at}, not the live copy. The user's fix: claude plugin marketplace remove ${installedId().split('@')[1]}, then in ~/.claude/hooks node wire.mjs --plugin`);
    else if (deployedCommit(at) !== deployedCommit(LIVE)) say(false, `the plugin runs ${deployedCommit(at) || 'an undeployed copy'} from ${at}, the last deploy is ${deployedCommit(LIVE)}. The user's fix: claude plugin update ${PLUGIN}`);
    else { const e = edited(at); say(!e.length, e[0] || `the plugin runs the last deploy, ${deployedCommit(at)}, from ${at}`); }
  }
  const ran = join(projectsRoot(), '.stop-ran');
  if (!existsSync(ran)) {
    // Nothing has saved before Claude's first reply ends: that is waiting, and
    // a new install checked at once said PROBLEM. It is one when this
    // conversation finished a reply over a minute ago and still nothing saved.
    const id = process.env.CLAUDE_CODE_SESSION_ID;
    let end = NaN; try { if (id) end = lastTurn(join(dirname(sessionStore()), `${id}.jsonl`)).end; } catch {}
    if (Date.now() - end > GRACE) say(false, `Claude finished a reply at ${local(end)}, but project-memory has not saved after any reply: its Stop hook is not running. The user's fix: restart Claude Code; if this line stays, check that Node.js is installed (node --version)`);
    else say(true, "waiting for Claude's first reply: project-memory saves each time Claude finishes one");
  } else { const s = stalled(transcripts(sessionStore(), '')[0]); say(!s.length, s[0] || `the Stop hook last ran ${local(statSync(ran).mtime)}`); }
  const stale = allStores().map((d) => join(d, '.lock')).filter((l) => { try { return Date.now() - statSync(l).mtimeMs > LOCK_STALE; } catch { return false; } });
  if (stale.length) say(true, `locks a killed hook left, taken over at the next write: ${stale.join(', ')}`);
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); say(true, 'git on PATH'); } catch { say(false, 'git is not on PATH: no memory snapshots'); }
  // A repack Windows could not finish leaves an index with no pack: harmless,
  // but git warns of each one on every command the snapshot runs.
  const pack = join(projectsRoot(), '.git', 'objects', 'pack');
  let packs = []; try { packs = readdirSync(pack); } catch {}
  const orphans = packs.filter((f) => f.endsWith('.idx') && !packs.includes(f.replace(/\.idx$/, '.pack')));
  if (orphans.length) say(true, `${orphans.length} pack index file(s) in ${pack} have no pack (a repack that could not finish): harmless, but git warns of each on every command; the user can delete them: ${orphans.join(', ')}`);
  const snap = snapshots();
  say(!snap.startsWith('snapshots: failing'), snap);
  return { ok: !bad, lines };
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const valued = new Set(['--store', '--rev', '--limit']);
  const opt = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
  const args = rest.filter((a, i) => !a.startsWith('--') && !valued.has(rest[i - 1]));
  const here = rest.includes('--shared') ? sharedStore() : opt('--store') || sessionStore();
  // --all includes the shared store before it has an index, as the default does.
  const scope = rest.includes('--all') ? [...new Set([...allStores(), sharedStore()])] : isShared(here) ? [here] : [here, sharedStore()];
  // A memory is named by its file, with or without `.md`; never by a path.
  const file = args[0] && basename(args[0]).replace(/(\.md)?$/, '.md');
  let r;
  if (cmd === 'search' && args.length) {
    const q = args.join(' '), all = search(scope, q, Infinity), n = Number(opt('--limit')), hits = all.slice(0, n > 0 ? n : 8);
    // What the model reads back: a hit's lines stay short (a 13-link hit was a
    // quarter of its output), and a miss says where it looked in one line.
    const where = scope.length <= 2 ? scope.join(' and ') : `${scope.length} stores`;
    r = { ok: true, lines: !words(q).length ? [`nothing to search for: "${q}" has no word of 3+ letters that says which memory`]
      : hits.length ? [...hits.flatMap((h) => [`${String(h.score).padStart(3)}  ${isShared(h.dir) ? 'shared ' : ''}${h.where.padEnd(9)} ${local(h.modified).slice(0, 10)}  ${h.path}`,
        `     ${clip(h.desc || '(no description)', 200)}`, ...(h.superseded ? [`     replaced by ${h.superseded}: read that one`] : []),
        ...(h.links.length ? [`     links: ${more(h.links, 5)}`] : [])]),
        // A hit's date, and what was not shown or not searched.
        `${hits.length} of ${all.length} match(es) in ${where}${all.length > hits.length ? '; --limit N shows more' : ''}${rest.includes('--all') ? '' : '; --all searches every project'}`]
      : [`nothing matches "${q}" in ${where}${rest.includes('--all') ? '' : '; --all searches every project'}`] };
  } else if (cmd === 'status') {
    const sharedNames = names(memories(sharedStore()));
    r = { ok: true, lines: [...scope.flatMap((d) => status(d, sharedNames)), snapshots()] };
  } else if (cmd === 'history' && file) r = history(scope, file, rest.includes('--all'));
  else if (cmd === 'restore' && file) r = restore(here, file, { rev: opt('--rev'), force: rest.includes('--force') });
  else if (cmd === 'promote' && file) r = promote(here, file);
  else if (cmd === 'doctor') r = doctor();
  else r = { ok: !cmd || cmd === 'help', lines: [USAGE] };
  console.log(r.lines.join('\n'));
  process.exit(r.ok ? 0 : 1);
}
