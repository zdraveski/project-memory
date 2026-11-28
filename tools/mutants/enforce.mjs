// The hand-written mutants of enforce.mjs, which enforce.test.mjs must catch (mutate.mjs runs them).
export default {
  'tally: the same note and call id counted twice': ['!(j.id && once.has(k))', 'true'],
  'tally: a hit with no id taken for a repeat': ['!(j.id && once.has(k))', '!once.has(k)'],
  'tally: a call id shared by two notes counted once': ['`${j.note}\\0${j.id}`', '`${j.id}`'],
};
