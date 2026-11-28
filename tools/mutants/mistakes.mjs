// The hand-written mutants of mistakes.mjs, which test/mistakes.test.mjs and briefing.test.mjs must catch (mutate.mjs runs them; the automatic ones come from automut.mjs).
export default {
  'a shared lesson resolves no recurring error': ['new Set([store, sharedStore()])', 'new Set([store])'],
};
