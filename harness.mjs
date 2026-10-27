// Shared by the harnesses: the four lines every one of them had copied.
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Path of a sibling tool, as execFileSync wants it.
export const tool = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// The store the hook derives from a cwd, under a given home.
export const slug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
export const storeFor = (home, cwd) => join(home, '.claude', 'projects', slug(cwd), 'memory');

// Throwaway folders go when the process does -- an assertion that throws
// included. A cleanup line at the end of a test never ran for a killed mutant,
// and 1,202 such folders had piled up in TEMP by 2026-10-26.
const made = new Set();
process.on('exit', () => { for (const d of made) try { rmSync(d, { recursive: true, force: true }); } catch {} });
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.add(dir);
  return dir;
}

// A throwaway HOME: a store built under the real projects dir is committed by
// the next Stop hook that fires while it exists.
export function tempHome(prefix) {
  const home = tempDir(prefix);
  return { home, env: { ...process.env, HOME: home, USERPROFILE: home } };
}

// This machine's largest store (most files), resolved: what the soak, the break
// harness and the bench copy when given none. Only ever read. null: none yet.
export function largestStore() {
  const root = join(homedir(), '.claude', 'projects');
  let dirs = []; try { dirs = readdirSync(root).map((p) => join(root, p, 'memory')).filter((d) => existsSync(join(d, 'MEMORY.md'))); } catch {}
  const best = dirs.sort((a, b) => readdirSync(b).length - readdirSync(a).length)[0];
  return best ? realpathSync(best) : null;
}

// Pointer targets of an index, minus the archive line.
export const pointers = (text) => [...text.matchAll(/^- \[[^\]]*\]\(([^)]+)\)/gm)].map((m) => m[1]).filter((x) => x !== 'MEMORY-archive.md');

// Integrity of a store: what the soak and the break harness both assert.
export function audit(dir) {
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const main = read('MEMORY.md'), arc = read('MEMORY-archive.md');
  const all = [...pointers(main), ...pointers(arc)];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY') && !f.includes('.tmp'));
  return {
    bytes: Buffer.byteLength(main), hot: pointers(main).length, cold: pointers(arc).length,
    dupes: all.length - new Set(all).size,
    orphans: files.filter((f) => !all.includes(f)),
    dangling: all.filter((t) => !files.includes(t)),
    stray: readdirSync(dir).filter((f) => f.includes('.tmp')),
    archiveLines: (main.match(/\(MEMORY-archive\.md\)/g) || []).length,
  };
}
