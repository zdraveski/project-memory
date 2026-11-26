// The hand-written mutants of sessions.mjs, which recall-hook.test.mjs and sessions.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  "one conversation's drop takes the project's": ['s ? join(sessionsOf(store), s) : sessionsOf(store)', 'sessionsOf(store)'],
  'the sweep takes a session file of today': ['if (statSync(join(root, d, f)).mtimeMs < now - WEEK) {', 'if (true) {'],
};
