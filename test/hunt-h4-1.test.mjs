// hunt h4-1: an empty <projects>/.hash-salt is never repaired, so keyed() differs on every call, for good.
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert';

for (const [name, content] of [['empty', '']]) {
  test(`keyed(): a ${name} .hash-salt is repaired, so the same text keeps the same key`, async () => {
    const cfg = mkdtempSync(join(tmpdir(), 'hunt-h4-1-'));
    process.env.CLAUDE_CONFIG_DIR = cfg;
    mkdirSync(join(cfg, 'projects'), { recursive: true });
    const f = join(cfg, 'projects', '.hash-salt');
    writeFileSync(f, content);
    const { keyed } = await import('../src/store.mjs');
    const a = keyed('same prompt', 12), b = keyed('same prompt', 12);
    assert.strictEqual(a, b, `keyed() gave ${a} then ${b} for the same text; .hash-salt is still ${JSON.stringify(readFileSync(f, 'utf8'))}`);
  });
}
