// The hand-written mutants of lessons.mjs, which lessons.test.mjs, briefing.test.mjs, enforce-hook.test.mjs and memory-cli.test.mjs must catch (mutate.mjs runs them).
const HOOK = { test: 'test/enforce-hook.test.mjs' }, CLI = { test: 'test/memory-cli.test.mjs' }, SRC = { test: 'test/lessons.test.mjs' };
export default {
  'a shared lesson listed as a dead end of the project': ['.filter((x) => !x.shared && x.l.instead)', '.filter((x) => x.l.instead)'],
  // H1, lessons before an edit (1.7.0 step 8)
  'edit lessons shown with the trigger off': ["if (!lessonsOn('edit')) return none;", '', HOOK],
  'edit lessons: a path with a line break accepted': ['if (!rel || /[\\r\\n]/.test(rel)) return none;', 'if (!rel) return none;', HOOK],
  'edit lessons: a session id that is no tag accepted': ['!/^[\\w-]+$/.test(s)) return none;', 'false) return none;', HOOK],
  'edit lessons: a quiet project or conversation still told': ['  if (why) return none;\n  const all', '  const all', HOOK],
  'edit lessons: the deadline ignored': ['performance.now() > deadline', 'false', HOOK],
  'edit lessons: three at a time': ['EDIT_SHOW = 2', 'EDIT_SHOW = 3', HOOK],
  'edit lessons: no cap a context': ['EDIT_CAP = 6', 'EDIT_CAP = 600', HOOK],
  'edit lessons: a negative room shows lessons': ['shown = ordered.slice(0, Math.max(0, room))', 'shown = ordered.slice(0, room)', HOOK],
  'edit lessons: a private turn still told': ["lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet'", 'false', HOOK],
  'edit lessons: a session file that will not read still told': ['if (!lines || lines.findLast', 'if (lines.findLast', HOOK],
  'edit lessons: a compact line does not start a new context': ["lines.findLastIndex((l) => l.kind === 'compact') + 1", '0', HOOK],
  'edit lessons: a lesson told again in the context': ['hits.filter((x) => !seen.has(x.lesson.name))', 'hits', HOOK],
  'edit lessons: a helper shares the main conversation\'s lines': ["l.kind === 'lesson' && l.by === by", "l.kind === 'lesson'", HOOK],
  'edit lessons: the helper id not cleaned': ["input.agent_id.replace(/[^\\w-]/g, '').slice(0, 64)", 'input.agent_id.slice(0, 64)', HOOK],
  'edit lessons: the helper id not cut': ["input.agent_id.replace(/[^\\w-]/g, '').slice(0, 64)", "input.agent_id.replace(/[^\\w-]/g, '')", HOOK],
  'edit lessons: the order ignored': ['order(hits.filter((x) => !seen.has(x.lesson.name)), readCounters(store), now)', 'hits.filter((x) => !seen.has(x.lesson.name))', HOOK],
  'edit lessons: nothing written to the session file': ['appendFileSync(at,', 'String(at,', HOOK],
  'edit lessons: the line has no path': ['`edit:${rel}`', "'edit:'", HOOK],
  'edit lessons: a dry run writes its line': ['if (!dry) try {', 'try {', CLI],
  'edit lessons: a dry run reads the session file': ['dry ? [] : readSession(at)', 'readSession(at)', CLI],
  'edit lessons: a dry run writes the cache': ['dry ? { write: false } : undefined', 'undefined', CLI],
  'preview why: a listed path worded as a glob': ['if (how === 1) return', 'if (how === 9) return', SRC],
  'preview why: a glob worded as a name': ['if (how === 2) return', 'if (how === 9) return', SRC],
};
