// The hand-written mutants of recall-hook.mjs, which recall-hook.test.mjs must catch (mutate.mjs runs them). None yet: its
// logic is onChange() in recall.mjs, whose mutants recall-hook.test.mjs runs too.
export default {
  'the stuck-streak event is not handled': ["} else if (event === 'PostToolUseFailure') {", "} else if (false) {"],
  'a hook behind a switch that is off still logs a timing line': ["if (!L.lessonsOn('stuck')) T.skip();", "if (false) T.skip();"],
};
