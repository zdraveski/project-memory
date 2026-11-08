// The hand-written mutants of hooks/hooks.json, which memory.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place; { full: true } runs the whole suite.
export default {
  'the plugin starts handoff-log without --print': ['handoff-log.mjs", "--print"]', 'handoff-log.mjs"]'],
  'the plugin forgets the auto compaction gate': ['"matcher": "auto"', '"matcher": "never"'],
  '/clear left out of the matcher': ['"matcher": "startup|resume|clear|compact"', '"matcher": "startup|resume|compact"'],
  'a resumed conversation left out of the matcher (memory off untagged)': ['"matcher": "startup|resume|clear|compact"', '"matcher": "startup|clear|compact"'],
};
