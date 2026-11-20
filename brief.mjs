// The plugin's SessionStart starter: it loads handoff-log.mjs itself, so a file that fails to load (a bad deploy, a half-written update) says so in one line
// instead of leaving a silent, empty briefing. PROJECT_MEMORY_BRIEFING=0 turns the briefing off: no output at all.
// Loaded guarded: a timing.mjs that is missing or broken costs the timings only, and never stops the briefing or its failure line below.
const T = await import('./timing.mjs').catch(() => null);
T?.begin('brief');
process.exitCode = 0;
if (process.env.PROJECT_MEMORY_BRIEFING !== '0') {
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  if (Number(process.versions.node.split('.')[0]) < 22) process.stdout.write(`project-memory needs Node 22 or newer, this is Node ${process.versions.node}: the memory hooks may fail until Node is updated.
`);
  try { await (await import('./handoff-log.mjs')).main({ rethrow: true }); }
  catch (e) { process.stdout.write(`Memory briefing failed (${String(e?.message ?? e).split('\n')[0].slice(0, 200)}). Run "memory doctor", or reinstall the project-memory plugin.\n`); }
}
await T?.flush();
