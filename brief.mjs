// The plugin's SessionStart starter: it loads handoff-log.mjs itself, so a file that fails to load (a bad deploy, a half-written update) says so in one line
// instead of leaving a silent, empty briefing. PROJECT_MEMORY_BRIEFING=0 turns the briefing off: no output at all.
process.exitCode = 0;
if (process.env.PROJECT_MEMORY_BRIEFING !== '0') {
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  try { await (await import('./handoff-log.mjs')).main(); }
  catch (e) { process.stdout.write(`Memory briefing failed to load (${String(e?.message ?? e).split('\n')[0].slice(0, 200)}). Run "memory doctor", or reinstall the project-memory plugin.\n`); }
}
