// The hand-written mutants of brief.mjs, which handoff-log.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place; { full: true } runs the whole suite.
export default {
  'the off switch ignored': ["process.env.PROJECT_MEMORY_BRIEFING !== '0'", 'true'],
  'a failure while running not reported': ['main({ rethrow: true })', 'main()'],
};
