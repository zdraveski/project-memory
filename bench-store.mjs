// A made-up busy store for the bench, built the same way every time: 60 day files of about 2,000
// entries (10 MB, about half of it Ran lines), 150 notes, a 3,000-byte shared index, a 50 MB
// conversation file whose last turn is complete. Every word comes from a fixed list and a seeded
// generator, so the same seed and time give the same bytes. Nothing in it is from a real conversation.
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render } from './journal.mjs';
import { local } from './store.mjs';

const WORDS = ('harbor lantern orchard meadow copper violet ledger compass thistle quarry beacon willow ember saddle mirror ' +
  'anchor falcon garnet hollow juniper kettle lagoon marble nectar opal pebble quill ripple summit timber umber velvet wicker ' +
  'yarrow zephyr bramble cinder dapple fennel glacier heron isle jasper kelp lichen mosaic nettle onyx prism rapids sorrel tundra ' +
  'upland vessel warden xenon yonder zenith alder birch cedar dune elm fern grove hazel iris juno knoll larch moss').split(' ');
const SHARED_BYTES = 3000;
export const PROJECT = 'C--bench-project', CWD = 'C:\\bench-project';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function build(home, { now = Date.now(), seed = 1, scale = 1 } = {}) {
  const rand = rng(seed), pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const words = (chars) => { let s = ''; while (s.length < chars) s += (s ? ' ' : '') + pick(WORDS); return s.slice(0, chars); };
  const root = join(home, '.claude', 'projects'), proj = join(root, PROJECT), store = join(proj, 'memory');
  const shared = join(root, '_shared', 'memory');
  mkdirSync(join(store, 'journal'), { recursive: true }); mkdirSync(shared, { recursive: true });
  const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

  // Notes: one rule note (the enforce case needs it) and the rest plain, each in the index.
  const notes = Math.max(2, Math.round(150 * scale)), index = [];
  const note = (dir, i, name, extra = '', hook = 40) => {
    const file = `note-${i}.md`, desc = words(Math.max(60, hook));
    writeFileSync(join(dir, file), `---\nname: ${name}\ndescription: ${desc}\ntype: feedback\n${extra}---\n\n${words(600)}\n`);
    return `- [${name}](${file}) — ${desc.slice(0, hook)}`;
  };
  for (let i = 0; i < notes; i++) index.push(note(store, i, `Note ${i} ${pick(WORDS)}`, i === 0 ? 'enforce:\n  on: git add\n  has: [-A, --all]\n' : ''));
  writeFileSync(join(store, 'MEMORY.md'), index.join('\n') + '\n');
  writeFileSync(join(store, 'handoff.md'), `# Handoff\n\n${words(1500)}\n`);

  // Shared index: exactly 3,000 bytes, the last line padded.
  const sh = Array.from({ length: 10 }, (_, i) => note(shared, i, `Shared ${i} ${pick(WORDS)}`, '', 240));
  const text = sh.join('\n') + '\n';
  writeFileSync(join(shared, 'MEMORY.md'), text.slice(0, -1) + 'x'.repeat(SHARED_BYTES - Buffer.byteLength(text)) + '\n');

  // Journal: 60 day files, about 5,000 bytes an entry, 54% of them the Ran line.
  const entries = Math.round(2000 * scale), DAYS = 60, per = (i) => Math.floor(entries / DAYS) + (i < entries % DAYS ? 1 : 0);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  let n = 0, journalBytes = 0;
  for (let d = 0; d < DAYS; d++) {
    const start = new Date(midnight); start.setDate(start.getDate() - (DAYS - 1 - d));
    const es = Array.from({ length: per(d) }, (_, j) => {
      const at = local(+start + (9 * 60 + j * 13) * 60e3), id = n++ % 40 + 1;
      return {
        key: `bench${n}`, at, s: uuid(id).slice(0, 8), t: `${PROJECT}/${uuid(id)}`, branch: 'main',
        asked: words(200), answered: words(1900), changed: [1, 2, 3, 4].map(() => `src/${pick(WORDS)}/${pick(WORDS)}.js`),
        ran: Array.from({ length: 9 }, () => `${pick(['node', 'git', 'npm'])} ${words(290)}`),
      };
    });
    const body = `# Journal ${local(+start).slice(0, 10)}\n\n` + es.map(render).join('\n\n') + (es.length ? '\n' : '');
    writeFileSync(join(store, 'journal', `${local(+start).slice(0, 10)}.md`), body);
    journalBytes += Buffer.byteLength(body);
  }

  // The conversation file, written in pieces; its last turn is whole.
  const transcript = join(proj, `${uuid(99)}.jsonl`), target = 50e6 * scale, blobs = Array.from({ length: 64 }, () => words(4000));
  const fd = openSync(transcript, 'w', 0o600);
  let k = 0, at = now - 3600e3 * 24 * 30;
  const rec = (type, content) => JSON.stringify({ type, uuid: `u${++k}`, sessionId: uuid(99), cwd: CWD, gitBranch: 'main', timestamp: new Date(at += 20e3).toISOString(), message: { role: type, content } }) + '\n';
  const turn = (last) => {
    if (last) at = now - 120e3;
    const id = `toolu_${k}`;
    return rec('user', words(150)) + (last ? '' : rec('assistant', [{ type: 'tool_use', id, name: 'Bash', input: { command: `git ${words(60)}` } }]) +
      rec('user', [{ type: 'tool_result', tool_use_id: id, content: pick(blobs) }])) + rec('assistant', [{ type: 'text', text: last ? words(300) : pick(blobs).slice(0, 800) }]);
  };
  let written = 0;
  while (written < target) written += writeSync(fd, turn(false));
  writeSync(fd, turn(true));
  closeSync(fd);
  // The journal already holds its turns: a backfill would import them again, a different number each run.
  const size = statSync(transcript).size;
  writeFileSync(join(store, 'journal', '.imported'), `${PROJECT}/${uuid(99)} ${size}
`);

  return { proj, transcript, store, shared, sizes: { journalBytes, entries, notes, transcriptBytes: size } };
}
