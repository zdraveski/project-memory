// The hand-written mutants of deploy.mjs, which handoff-log.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place; { full: true } runs the whole suite.
export default {
  'a shared-layer change checks only its own mutants': ['changed.some((f) => SHARED.includes(f))', 'false'],
  'a change to the harness checks only its own mutants': ["['store.mjs', 'harness.mjs', 'mutate.mjs']", "['store.mjs', 'mutate.mjs']"],
  'an unknown live commit checks no mutant': ['(!changed || changed.some', '(changed.some'],
  'the plugin version not stamped': ["if (patch !== undefined && f === '.claude-plugin/plugin.json') {", 'if (false) {'],
  'the live plugin runs node from PATH': ["if (node && f === 'hooks/hooks.json') {", 'if (false) {'],
  'each copy written in place, its temp left': ['renameSync(join(to, `${f}.tmp`), join(to, f));', 'writeFileSync(join(to, f), readFileSync(join(to, `${f}.tmp`)));'],
  'the manifest hashes nothing': ['files[f] = hash(buf);', ''],
  'deploys from a branch': ["if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'master') fail(", 'if (false) fail('],
  'deploys uncommitted changes': ["if (dirty()) fail('uncommitted changes: commit first');", ''],
  'no stat in the manifest': ['files, stat })', 'files })'],
  'journal.mjs never deployed': ["'handoff-log.mjs', 'journal.mjs', 'compact-gate.mjs'", "'handoff-log.mjs', 'compact-gate.mjs'"],
};
