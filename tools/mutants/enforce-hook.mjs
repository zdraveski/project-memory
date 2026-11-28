// The hand-written mutants of enforce-hook.mjs, which enforce-hook.test.mjs must catch (mutate.mjs runs them).
export default {
  // 1.7.0 step 8: an edit with its trigger off asks switches.mjs and stops; the 150 ms count from the input.
  'an edit with the trigger off still loads lessons.mjs': ["quiet = !(await import('./switches.mjs')).lessonsOn('edit');", 'quiet = false;'],
  'an edit with the trigger off still writes a timing line': ['if (!quiet) await T.flush();', 'await T.flush();'],
  'the 150 ms count after lessons.mjs has loaded': ['{ deadline: t0 + EDIT_MS }', '{}'],
  'the 150 ms never ends': ['{ deadline: t0 + EDIT_MS }', '{ deadline: Infinity }'],
  'the number of lessons shown is not timed': ['T.shown(shown.length);', ''],
  'a lesson is not printed': ['if (say) await new Promise', 'if (false) await new Promise'],
};
