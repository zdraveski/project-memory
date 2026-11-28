// The hand-written mutants of lessons.mjs, which lessons.test.mjs and briefing.test.mjs must catch (mutate.mjs runs them).
export default {
  'a shared lesson listed as a dead end of the project': ['.filter((x) => !x.shared && x.l.instead)', '.filter((x) => x.l.instead)'],
};
