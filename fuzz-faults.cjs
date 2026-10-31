// Dev tool of fuzz.mjs, not shipped: a preload (`node --require fuzz-faults.cjs hook.mjs`) that makes
// disk calls fail the way a busy or full disk does. FUZZ_FAULTS=<seed>:<rate>:<root>. A synchronous
// call of node:fs whose first argument is a path under <root> (the fuzz round's own temp home, and
// nothing else) fails with probability <rate>, drawn from a seeded stream (mulberry32), one draw per
// such call, so the same run injects the same faults. File descriptors, URLs and Buffers pass through.
// It reaches only the process it is loaded into, not the git or node children that process spawns.
'use strict';
const fs = require('node:fs'), path = require('node:path');

const spec = process.env.FUZZ_FAULTS || '';
const m = /^(-?\d+):([0-9.]+):(.+)$/s.exec(spec);
if (m) {
  let seed = Number(m[1]);
  const rate = Number(m[2]), win = process.platform === 'win32';
  const norm = (p) => (win ? p.toLowerCase() : p);
  const root = norm(path.resolve(m[3]));
  const next = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const under = (p) => {
    if (typeof p !== 'string') return false;   // a descriptor, a URL, a Buffer: not ours to fault
    const rel = path.relative(root, norm(path.resolve(p)));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const READS = ['EBUSY', 'EPERM', 'EACCES'], WRITES = [...READS, 'ENOSPC'];
  // openSync can write too: only its flags say.
  const writes = { writeFileSync: 1, appendFileSync: 1 };
  for (const name of ['openSync', 'readFileSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'readdirSync']) {
    const real = fs[name];
    fs[name] = function (...a) {
      if (under(a[0]) && next() < rate) {
        const codes = writes[name] || (name === 'openSync' && /[wa+]/.test(String(a[1]))) ? WRITES : READS;
        const code = codes[Math.floor(next() * codes.length)];
        const e = new Error(`${code}: injected fault, ${name} '${a[0]}'`);
        throw Object.assign(e, { code, errno: -1, syscall: name.replace(/Sync$/, ''), path: a[0] });
      }
      return real.apply(this, a);
    };
  }
  require('node:module').syncBuiltinESMExports();
}
