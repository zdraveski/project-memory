// The run records: the small status files the hooks write and doctor, status and
// the startup line read (GLOSSARY.md, "Run records"). Store health, the Stop
// record, the two failure records and the deploy record are read and written
// here, one format in one place, and Claude Code's installed_plugins.json is read
// here too. One read rule: a file that is missing is none (null); one that exists
// but cannot be read or parsed is damaged, and each screen shows it as it did
// before (usually as none); a BOM is stripped.
// Imports Node and store.mjs only: journal.mjs imports this, not the other way.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync, renameSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { raw, keyed, replaceIfUnchanged, projectsRoot, configDir, sharedStore, local, reason } from './store.mjs';

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
    const ran = join(projectsRoot(), '.stop-ran');
    // The event too, and whether a block sent it back: a /compact typed
    // right after a reply, or a reply to the nudge, is a second run seconds
    // later, not a second wiring. And the reply's fingerprint, 8 hex of its
    // hash: two quick replies of one conversation read as two wirings (audit H-F10).
    // On a line of its own: before 1.0.7 the file was one time and no newline.
    const prev = raw(ran);
    appendFileSync(ran, (prev && !prev.endsWith('\n') ? '\n' : '') + JSON.stringify({ at: new Date().toISOString(), s: String(payload?.session_id || '').slice(0, 8), e: payload?.hook_event_name, h: payload?.stop_hook_active ? 1 : undefined, m: keyed(payload?.last_assistant_message ?? '', 8), from: dirname(fileURLToPath(import.meta.url)) }) + '\n', { mode: 0o600 });
    // The cut goes to a temp copy that replaces the log only if it is no longer than when read:
    // another session's line appended in between was lost (audit #13).
    // shortcut: an append between the size check and the rename (well under a millisecond) is
    // still lost, which costs one line of the double-wiring check; lock the projects root if that shows.
    const size = statSync(ran).size, cut = `${ran}.tmp${process.pid}`;
    if (size > 8192) {
      try {
        writeFileSync(cut, readFileSync(ran, 'utf8').split('\n').filter(Boolean).slice(-20).join('\n') + '\n', { mode: 0o600 });
        if (statSync(ran).size === size) renameSync(cut, ran);
      } finally { rmSync(cut, { force: true }); }
    }
  } catch {}
}
// The Stop hook's runs, oldest first, one JSON line each (stopRecord).
export const stopRuns = () => (readText(join(projectsRoot(), '.stop-ran')) ?? '').split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r?.at ? [r] : []; } catch { return []; } });

// A Stop's failure to save, in the briefing and in status: the record of where you left off, or with
// auto memory off (`off`) the tag that keeps the conversation out of the journal, which was all a Stop then meant to write.
export const unsaved = (f) => (f.off
  ? `a conversation held with auto memory off could not be marked after the reply at ${local(f.at)}, so the journal may take it in later: ${f.error}`
  : `the record of where you left off could not be saved after the reply at ${local(f.at)}: ${f.error}`);
// What the Stop's record of a failure holds for a store, or null (HANDOFF_FAILED).
export const lostHandoff = (dir) => readJson(join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(dir))}`));

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
  for (const p of [join(dir, 'journal', '.failed'), join(projectsRoot(), `${JOURNAL_FAILED}${basename(dirname(dir))}`)]) {
    try {
      for (const l of (readText(p) ?? '').split(/\r?\n/).filter(Boolean)) {
        const f = JSON.parse(l);
        if (!String(f.error).startsWith('backfill: ')) out.push(`Memory store needs attention (${dir}): the journal could not be written after the reply at ${local(f.at)}: ${f.error}`);
      }
    } catch {}
  }
  return out;
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
