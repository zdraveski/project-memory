// The hand-written mutants of enforce-hook.mjs, which enforce-hook.test.mjs must catch (mutate.mjs runs them).
export default {
  // 1.7.0 step 8: an edit with its trigger off asks switches.mjs and stops; the 150 ms count from the input.
  'an edit with the trigger off still loads lessons.mjs': ["quiet = !(await import('./switches.mjs')).lessonsOn('edit');", 'quiet = false;'],
  'an edit with the trigger off still writes a timing line': ['if (!quiet) await T.flush();', 'await T.flush();'],
  'the 150 ms count after lessons.mjs has loaded': ['onEdit(input, { deadline: t0 + EDIT_MS })', 'onEdit(input, {})'],
  'the 150 ms never ends': ['onEdit(input, { deadline: t0 + EDIT_MS })', 'onEdit(input, { deadline: Infinity })'],
  'the number of lessons shown is not timed': ['T.shown(shown.length);\n    T.tag', 'T.tag'],
  'a lesson is not printed': ['asynchronously.\n    if (say) await new Promise', 'asynchronously.\n    if (false) await new Promise'],
  // 1.7.0 step 9: a shell command asks for a lesson only when it has a family and `command` is on.
  'a command with no family still loads lessons.mjs': ['if (families.length && ', 'if ('],
  'a command with the trigger off still loads lessons.mjs': ["&& (await import('./switches.mjs')).lessonsOn('command')", ''],
  'a command: the 150 ms count after lessons.mjs has loaded': ['onCommand(input, families, { deadline: t0 + EDIT_MS })', 'onCommand(input, families, {})'],
  'a command: the 150 ms never ends': ['onCommand(input, families, { deadline: t0 + EDIT_MS })', 'onCommand(input, families, { deadline: Infinity })'],
  'a command: the lesson hook is not named in the timing': ["T.name('lesson');\n      const { onCommand", 'const { onCommand'],
  'a command: the number of lessons shown is not timed': ['T.shown(shown.length);\n      if (say)', 'if (say)'],
  'a command: a lesson is not printed': ['      if (say) await new Promise', '      if (false) await new Promise'],
};
