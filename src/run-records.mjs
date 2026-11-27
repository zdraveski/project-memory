// The run records: the small status files the hooks write and doctor, status and
// the startup line read (GLOSSARY.md, "Run records"). Store health, the Stop
// record, the two failure records and the deploy record are read and written
// here, one format in one place, and Claude Code's installed_plugins.json is read
// here too. One read rule: a file that is missing is none (null); one that exists
// but cannot be read or parsed is damaged, and each screen shows it as it did
// before (usually as none); a BOM is stripped.
// Imports Node and store.mjs only: journal.mjs imports this, not the other way.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { raw, keyed, replaceIfUnchanged, appendCapped, projectsRoot, configDir, sharedStore, local, reason, isIndex } from './store.mjs';

// What a Stop could not save, `<projects>/<this><project folder>`: memory-tier writes it, the briefing and status read it. One
// name for the three: spelt in four places, a change to one would have left the warning silent (release review).
export const HANDOFF_FAILED = '.handoff-failed-';
// A journal write's failure its own folder would not take (journal/.failed is in it), `<projects>/<this><project folder>`:
// journal.mjs writes it, the briefing and status read it, beside journal/.failed (audit H-F4).
export const JOURNAL_FAILED = '.journal-failed-';
// journal.mjs's own folder name, which this module cannot import: a test checks that the two agree.
export const JOURNAL = 'journal';
export const FAILED = '.failed';
export const DEPLOYED = '.deployed.json';

// The text of a file, or null for any error; a BOM is stripped.
export const readText = (p) => { try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
export const readJson = (p) => { try { return JSON.parse(readText(p)); } catch { return null; } };

// Claude Code's own records of what is installed and where it came from (`installed_plugins.json`, `known_marketplaces.json`).
export const plugins = (f) => readJson(join(configDir(), 'plugins', f));

// The only route to the owner's eyes: Stop output is shown to nobody, and the
// startup line (handoff-log --print) reads these.
export function health(dir, problems) {
  const p = join(dir, '.health');
  const want = problems.length ? problems.join('\n') + '\n' : null;
  const have = raw(p);
  if (want === have) return;
  // Through a temp file: the startup line read a half-written one (1.3.1 audit D-5).
  if (want === null) unlinkSync(p); else replaceIfUnchanged(p, have, want);
}
// What the last tiering pass found in a store, one problem a line, trimmed: '' when there is none.
export const healthOf = (dir) => (readText(join(dir, '.health')) ?? '').trim();

// The Stop hook's proof of life, `.stop-ran`, for the startup line and doctor.
export function stopRecord(payload) {
  // One line a run: when, which conversation, which copy. Two runs for one
  // reply, seconds apart, are hooks wired twice (memory.mjs doctor, which
  // reads this and never settings.json). Appended, so two copies running at
  // once both land; cut back to the newest 20 past 8 KB.
  try {
    const ran = stopRan();
    // The event too, and whether a block sent it back: a /compact typed
    // right after a reply, or a reply to the nudge, is a second run seconds
    // later, not a second wiring. And the reply's fingerprint, 8 hex of its
    // hash: two quick replies of one conversation read as two wirings (audit H-F10).
    appendCapped(ran, JSON.stringify({ at: new Date().toISOString(), s: String(payload?.session_id || '').slice(0, 8), e: payload?.hook_event_name, h: payload?.stop_hook_active ? 1 : undefined, m: keyed(payload?.last_assistant_message ?? '', 8), from: dirname(fileURLToPath(import.meta.url)) }) + '\n', 8192, 20);
  } catch {}
}
// Where the Stop record is: its mtime is the last save (handoff-log's stalled()), and snapshot keeps it 0600.
export const stopRan = () => join(projectsRoot(), '.stop-ran');
// The Stop hook's runs, oldest first, one JSON line each (stopRecord).
export const stopRuns = () => (readText(stopRan()) ?? '').split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r?.at ? [r] : []; } catch { return []; } });

// A Stop's failure to save, in the briefing and in status: the record of where you left off, or with
// auto memory off (`off`) the tag that keeps the conversation out of the journal, which was all a Stop then meant to write.
export const unsaved = (f) => (f.off
  ? `a conversation held with auto memory off could not be marked after the reply at ${local(f.at)}, so the journal may take it in later: ${f.error}`
  : `the record of where you left off could not be saved after the reply at ${local(f.at)}: ${f.error}`);
// The Stop's record of a failure for a store (HANDOFF_FAILED). One per project, beside the projects, not in the store
// that refused it: shared, another project's next save cleared this one's.
const lost = (dir) => join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(dir))}`);
// What it holds, or null.
export const lostHandoff = (dir) => readJson(lost(dir));
// Kept for the next start to read: swallowed, nothing was saved and nothing said. Throws when it cannot be written.
export const handoffFailed = (dir, e, off) => writeFileSync(lost(dir), JSON.stringify({ at: new Date().toISOString(), error: reason(e), ...(off && { off: true }) }), { mode: 0o600 });
// A Stop that saved clears it.
export const handoffSaved = (dir) => { try { unlinkSync(lost(dir)); } catch {} };

// A throw kept in .failed for `status` to report: swallowed, the journal would
// stop and nothing say so. `from` names the writer when it is not the sink.
// One line a writer, the newest first: each writes and clears its own only.
// The next reply's write cleared a backfill that kept failing, and a failed
// backfill overwrote the live write's failure: status said nothing of either.
const own = (text, backfill) => (text ?? '').split(/\r?\n/).filter((l) => l && l.includes('"error":"backfill: ') === backfill);
// A live write's failure the journal folder would not take is kept beside the projects: kept in the folder that refused
// it, it was lost with every reply's entry, and nothing said so (audit H-F4).
export const aside = (dir) => join(projectsRoot(), JOURNAL_FAILED + basename(dirname(dir)));
export function fault(dir, e, from = '') {
  const f = join(dir, JOURNAL, FAILED), line = JSON.stringify({ at: new Date().toISOString(), error: from + reason(e) });
  try {
    mkdirSync(join(dir, JOURNAL), { recursive: true, mode: 0o700 });
    const before = raw(f);
    replaceIfUnchanged(f, before, [line, ...own(before, !from)].join('\n') + '\n');
  } catch { if (!from) try { writeFileSync(aside(dir), line + '\n', { mode: 0o600 }); } catch {} }
}
// The failures kept, in the journal and beside the projects: one line each.
export const failures = (dir) => [raw(join(dir, JOURNAL, FAILED)), raw(aside(dir))].flatMap((t) => (t ?? '').split(/\r?\n/).filter(Boolean));
export function clear(dir, backfill) {
  if (!backfill) try { unlinkSync(aside(dir)); } catch {}
  const f = join(dir, JOURNAL, FAILED), before = raw(f), left = own(before, !backfill);
  if (before == null) return;
  if (left.length) replaceIfUnchanged(f, before, left.join('\n') + '\n');
  else try { unlinkSync(f); } catch {}
}

// Warnings only: the startup line costs every session, so it says nothing
// here when all is well. The shared store's problems are every project's.
export function notes(dir) {
  const out = [];
  for (const d of [dir, sharedStore()]) {
    const h = healthOf(d);
    if (h) out.push(`Memory store needs attention (${d}): ${h.split('\n').join('; ')}`);
  }
  // What the last Stop could not save.
  try {
    const f = lostHandoff(dir);
    out.push(`Memory store needs attention (${dir}): ${unsaved(f)}`);
  } catch {}
  // A journal write that failed after a reply (journal/.failed; not a backfill,
  // which is retried): only status said so, and every reply went unrecorded.
  // And one its folder would not take, kept beside the projects (JOURNAL_FAILED).
  for (const p of [join(dir, JOURNAL, FAILED), aside(dir)]) {
    try {
      for (const l of (readText(p) ?? '').split(/\r?\n/).filter(Boolean)) {
        const f = JSON.parse(l);
        if (!String(f.error).startsWith('backfill: ')) out.push(`Memory store needs attention (${dir}): the journal could not be written after the reply at ${local(f.at)}: ${f.error}`);
      }
    } catch {}
  }
  return out;
}

// A project that moved gets a new folder (the key is its path): another project folder under the same projects folder whose slug ends in
// the same last name and holds notes (by file name) this one lacks. [{ at, notes }]; none when the slugs have no such sibling.
// "Same last name" is the slug's last two "-" parts, so a folder whose own name holds a dash (`my-app`) is matched as `-my-app`.
export function moved(dir) {
  const slug = basename(dirname(dir)), root = dirname(dirname(dir)), parts = slug.toLowerCase().split('-');
  if (parts.length < 2) return [];
  const tail = '-' + parts.slice(-2).join('-');
  const out = [];
  try {
    const mine = new Set(readdirSync(dir).map((f) => f.toLowerCase()).filter((f) => f.endsWith('.md')));
    for (const s of readdirSync(root)) {
      if (s === slug || s.startsWith('_') || !s.toLowerCase().endsWith(tail)) continue;
      const at = join(root, s, 'memory');
      let extra = []; try { extra = readdirSync(at).filter((f) => f.endsWith('.md') && !isIndex(f) && !mine.has(f.toLowerCase())); } catch {}
      if (extra.length) out.push({ at, notes: extra.sort() });
    }
  } catch {}
  return out;
}
// What doctor and the startup line say of one: no merge is made for the user.
export const movedText = (dir, { at, notes: n }) => `Notes may have been left behind when this project moved: ${at} holds ${n.length} note(s) this folder (${dir}) lacks: ${n.slice(0, 5).join(', ')}${n.length > 5 ? ` and ${n.length - 5} more` : ''}. Nothing is merged for you; to merge by hand, copy the notes you want from there into this folder and add a line for each to this folder's MEMORY.md.`;
// The startup line says it once: a marker in this folder holds the notes it named; a new note there is said again.
export function movedOnce(dir) {
  const f = join(dir, '.moved-said'), said = (readText(f) ?? '').split('\n');
  const out = moved(dir).filter((m) => m.notes.some((n) => !said.includes(`${m.at}/${n}`)));
  if (!out.length) return [];
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(f, moved(dir).flatMap((m) => m.notes.map((n) => `${m.at}/${n}`)).join('\n') + '\n', { mode: 0o600 }); } catch {}
  return out.map((m) => movedText(dir, m));
}

// The deploy record: what tools/deploy.mjs copied into a folder.
export const hash = (buf) => createHash('sha256').update(buf).digest('hex');
export const deployed = (dir) => readJson(join(dir, DEPLOYED));
export const writeDeployed = (dir, record) => writeFileSync(join(dir, DEPLOYED), JSON.stringify(record) + '\n');
// The commit deploy.mjs checked and copied into a folder.
export const deployedCommit = (dir) => deployed(dir)?.commit ?? null;

// The hooks run from the copy deploy.mjs made after the full check. A file
// changed or gone there since is live and untested: name it. Run from the
// repo, with no manifest, there is nothing to say; nor with a damaged one:
// thrown, it took every other line of the startup message with it.
export function edited(here = dirname(dirname(fileURLToPath(import.meta.url)))) {
  try {
    const m = deployed(here);
    const bad = Object.keys(m.files).filter((f) => {
      try {
        // Size and mtime as deployed: not read, as git's index judges. Hashing all
        // nine files was 8-11 ms of every startup (measured 2026-10-27).
        const s = statSync(join(here, f)), was = m.stat?.[f];
        if (was && s.size === was[0] && s.mtimeMs === was[1]) return false;
        return hash(readFileSync(join(here, f))) !== m.files[f];
      } catch { return true; }
    });
    return bad.length ? [`Memory hooks changed outside deploy.mjs, live and untested: ${bad.join(', ')} in ${here}. For the user: edit ${m.repo ? (existsSync(m.repo) || !m.origin ? m.repo : `${m.repo} (gone; clone ${m.origin})`) : 'the hooks repo'} and run node tools/deploy.mjs there (a deploy replaces these edits).`] : [];
  } catch { return []; }
}
