// The hand-written mutants of page.mjs, which page.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'a week is eight days': ['for (let i = 6; i >= 0; i--)', 'for (let i = 7; i >= 0; i--)'],
  'a private turn answers a search': ['if (e.priv) return false;', ''],
  'a search needs only one of its words': ['words.every(', 'words.some('],
};
