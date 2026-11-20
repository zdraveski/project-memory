// The hand-written mutants of page.mjs, which page.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'a week is eight days': ['for (let i = 6; i >= 0; i--)', 'for (let i = 7; i >= 0; i--)'],
  'a private turn answers a search': ['if (e.priv) return false;', ''],
  'a search needs only one of its words': ['words.every(', 'words.some('],
  'a < in the data is not escaped': ["replace(/</g, '\\\\u003c')", "replace(/</g, '<')"],
  'the policy lets anything load': ["default-src 'none'", 'default-src *'],
  'a secret goes into the page as it is': ['redact(tame(String(s ?? \'\')))', 'tame(String(s ?? \'\'))'],
};
