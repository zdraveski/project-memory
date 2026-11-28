// The hand-written mutants of switches.mjs, which lessons.test.mjs must catch (mutate.mjs runs them).
export default {
  'an unknown trigger is on': ['if (!TRIGGERS.includes(name)) return false;', ''],
  '0 does not turn every trigger off': ["if (v === '0') return false;", ''],
  '1 does not turn every trigger on': ["if (v === '1') return true;", ''],
  'a name does not turn its trigger on': ['if (w === name) on = true; else', 'if (false) on = true; else'],
  '-name does not turn its trigger off': ['else if (w === `-${name}`) on = false;', ''],
  'a word is not trimmed': ['.map((x) => x.trim())', '.map((x) => x)'],
  'the trigger starts on': ['let on = DEFAULTS[name];', 'let on = true;'],
  'the trigger starts off': ['let on = DEFAULTS[name];', 'let on = false;'],
};
