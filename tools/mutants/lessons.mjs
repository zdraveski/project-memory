// The hand-written mutants of lessons.mjs, which lessons.test.mjs, briefing.test.mjs, enforce-hook.test.mjs and memory-cli.test.mjs must catch (mutate.mjs runs them).
const HOOK = { test: 'test/enforce-hook.test.mjs' }, CLI = { test: 'test/memory-cli.test.mjs' }, SRC = { test: 'test/lessons.test.mjs' };
// onEdit and onCommand share most lines, and a mutant's find-text must occur once. Each of these is a shared line with the line before or after
// that only one of them has: a mutant of it is built from them (`.replace` of the part to break).
const GATE = 'const { why, store } = gate(input, s, 1);\n  if (why) return none;\n  const all = lessonsFor(store, dry ? { write: false } : undefined);\n  if (!all.length || performance.now() > deadline) return none;\n  const first';
const SESSION = "if (!first.size) return none;\n  const at = join(sessionsOf(store), s), lines = dry ? [] : readSession(at);\n  if (!lines || lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet') return none;";
const TOLD = "const by = typeof input.agent_id === 'string' ? input.agent_id.replace(/[^\\w-]/g, '').slice(0, 64) : '';\n  const told = lines.slice(lines.findLastIndex((l) => l.kind === 'compact') + 1).filter((l) => l.kind === 'lesson' && l.by === by);\n  const seen = new Set(told.map((l) => parseLesson(l.rest)?.name)), room";
const AFTER = `${SESSION}\n  ${TOLD}`; // TOLD alone is in onEdit too; with the lines before it, only here
const SEEN ="const seen = new Set(told.map((l) => parseLesson(l.rest)?.name)), room = Math.min(EDIT_SHOW, EDIT_CAP - told.length);\n  const ordered = order([...first.values()].filter((x) => !seen.has(x.lesson.name)), readCounters(store), now), shown = ordered.slice(0, Math.max(0, room));";
const EGATE = GATE.replace('const first', 'const hits');
const ESESSION = SESSION.replace('if (!first.size)', 'if (!hits.length)');
const ETOLD = `${ESESSION}\n  ${TOLD}`;
const ESEEN = 'const ordered = order(hits.filter((x) => !seen.has(x.lesson.name)), readCounters(store), now), shown = ordered.slice(0, Math.max(0, room));';
const EAPP = "appendFileSync(at, shown.map((x) => sessionLine('lesson', lessonLine(x.lesson.name, `edit:";
const EDRY = 'if (!dry) try {\n    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });\n    appendFileSync';
const ESAY = "const say = blockText(shown, rel, 'edit', ordered.length - shown.length, now);\n  if (!say) return none;";
const ECATCH = "`edit:${rel}`), by, new Date(now).toISOString())).join(''), { mode: 0o600 });\n  } catch { return none; }";
export default {
  'a shared lesson listed as a dead end of the project': ['.filter((x) => !x.shared && x.l.instead)', '.filter((x) => x.l.instead)'],
  // H1, lessons before an edit (1.7.0 step 8)
  'edit lessons shown with the trigger off': ["if (!lessonsOn('edit')) return none;", '', CLI],
  'edit lessons: a path with a line break accepted': ['if (!rel || /[\\r\\n]/.test(rel)) return none;', 'if (!rel) return none;', HOOK],
  'edit lessons: a session id that is no tag accepted': ['!input.cwd.trim() || !/^[\\w-]+$/.test(s)) return none;', '!input.cwd.trim() || false) return none;', HOOK],
  'edit lessons: a quiet project or conversation still told': [EGATE, EGATE.replace('  if (why) return none;\n', ''), HOOK],
  'edit lessons: the deadline ignored': [EGATE, EGATE.replace('performance.now() > deadline', 'false'), HOOK],
  'edit lessons: three at a time': ['EDIT_SHOW = 2', 'EDIT_SHOW = 3', HOOK],
  'edit lessons: no cap a context': ['EDIT_CAP = 6', 'EDIT_CAP = 600', HOOK],
  'edit lessons: a negative room shows lessons': [ESEEN, ESEEN.replace('Math.max(0, room)', 'room'), HOOK],
  'edit lessons: a private turn still told': [ESESSION, ESESSION.replace("lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet'", 'false'), HOOK],
  'edit lessons: a session file that will not read still told': [ESESSION, ESESSION.replace('if (!lines || lines.findLast', 'if (lines.findLast'), HOOK],
  'edit lessons: a compact line does not start a new context': [ETOLD, ETOLD.replace("lines.findLastIndex((l) => l.kind === 'compact') + 1", '0'), HOOK],
  'edit lessons: a lesson told again in the context': ['hits.filter((x) => !seen.has(x.lesson.name))', 'hits', HOOK],
  'edit lessons: a helper shares the main conversation\'s lines': [ETOLD, ETOLD.replace("l.kind === 'lesson' && l.by === by", "l.kind === 'lesson'"), HOOK],
  'edit lessons: the helper id not cleaned': [ETOLD, ETOLD.replace(".replace(/[^\\w-]/g, '')", ''), HOOK],
  'edit lessons: the helper id not cut': [ETOLD, ETOLD.replace('.slice(0, 64)', ''), HOOK],
  'edit lessons: the order ignored': ['order(hits.filter((x) => !seen.has(x.lesson.name)), readCounters(store), now)', 'hits.filter((x) => !seen.has(x.lesson.name))', HOOK],
  'edit lessons: nothing written to the session file': [EAPP, EAPP.replace('appendFileSync(at,', 'String(at,'), HOOK],
  'edit lessons: the line has no path': ['`edit:${rel}`', "'edit:'", HOOK],
  'edit lessons: a dry run writes its line': [EDRY, EDRY.replace('if (!dry) try', 'try'), CLI],
  'edit lessons: a dry run reads the session file': [ESESSION, ESESSION.replace('dry ? [] : readSession(at)', 'readSession(at)'), CLI],
  'edit lessons: a dry run writes the cache': [EGATE, EGATE.replace('dry ? { write: false } : undefined', 'undefined'), CLI],
  'preview why: a listed path worded as a glob': ['if (how === 1) return', 'if (how === 9) return', SRC],
  'preview why: a glob worded as a name': ['if (how === 2) return', 'if (how === 9) return', SRC],
  // the root of a path: the nearest folder with a `.git` (a folder or a file), a worktree its own
  'relPath: only a .git folder is a root': ["existsSync(join(d, '.git'))", "existsSync(join(d, '.git', 'HEAD'))", SRC],
  'relPath: the root is never looked for above the cwd': ['if (dirname(d) === d) return cwd;', 'if (true) return cwd;', SRC],
  'relPath: a relative cwd is resolved against the hook\'s folder': ['if (!isAbsolute(cwd)) return cwd;', '', SRC],
  'relPath: a blank cwd is a place': ['if (!given || !cwd) return null;', 'if (!given) return null;', SRC],
  'edit lessons: a cwd that is no string accepted': ["typeof input.cwd !== 'string' || ", '', HOOK],
  'edit lessons: a cwd of blanks is a place': ['|| !input.cwd.trim()', '', HOOK],
  'edit lessons: a block over the limit is told as lines': [ESAY, ESAY.replace('\n  if (!say) return none;', ''), HOOK],
  'edit lessons: a session line that will not write is still told': [ECATCH, ECATCH.replace('catch { return none; }', 'catch {}'), HOOK],
  // H2, lessons before a risky command (1.7.0 step 9)
  'command lessons shown with the trigger off': ["if (!lessonsOn('command') || ", 'if (', CLI],
  'command lessons: families that are no list accepted': ['|| !Array.isArray(families)', '', HOOK],
  'command lessons: a session id that is no tag accepted': ['!Array.isArray(families) || !/^[\\w-]+$/.test(s)) return none;', '!Array.isArray(families) || false) return none;', HOOK],
  'command lessons: a quiet project or conversation still told': [GATE, GATE.replace('  if (why) return none;\n', ''), HOOK],
  'command lessons: the deadline ignored': [GATE, GATE.replace('performance.now() > deadline', 'false'), HOOK],
  'command lessons: a dry run writes the cache': [GATE, GATE.replace('dry ? { write: false } : undefined', 'undefined'), CLI],
  'command lessons: only the first family': ['for (const family of families) for', 'for (const family of families.slice(0, 1)) for', HOOK],
  'command lessons: a lesson for two families told twice': ['if (!first.has(h.lesson.name)) first.set', 'first.set', HOOK],
  'command lessons: the block is about the last family': ['families.find((f) => shown.some((x) => x.family === f))', 'families.findLast((f) => shown.some((x) => x.family === f))', HOOK],
  'command lessons: the block is about a family that is not shown': ['families.find((f) => shown.some((x) => x.family === f))', '[...first.values()][0].family', HOOK],
  'command lessons: nothing matched is not stopped': ['if (!first.size) return none;', '', HOOK],
  'command lessons: a private turn still told': [SESSION, SESSION.replace("?.kind === 'quiet'", '=== 0'), HOOK],
  'command lessons: a session file that will not read still told': [SESSION, SESSION.replace('if (!lines || lines.findLast', 'if (lines.findLast'), HOOK],
  'command lessons: a dry run reads the session file': [SESSION, SESSION.replace('dry ? [] : readSession(at)', 'readSession(at)'), CLI],
  'command lessons: a helper shares the main conversation\'s lines': [AFTER, AFTER.replace("l.kind === 'lesson' && l.by === by", "l.kind === 'lesson'"), HOOK],
  'command lessons: the helper id not cleaned': [AFTER, AFTER.replace(".replace(/[^\\w-]/g, '')", ''), HOOK],
  'command lessons: the helper id not cut': [AFTER, AFTER.replace('.slice(0, 64)', ''), HOOK],
  'command lessons: a compact line does not start a new context': [AFTER, AFTER.replace("lines.findLastIndex((l) => l.kind === 'compact') + 1", '0'), HOOK],
  'command lessons: no cap a context': [SEEN, SEEN.replace('EDIT_CAP - told.length', 'EDIT_SHOW'), HOOK],
  'command lessons: three at a time': [SEEN, SEEN.replace('Math.min(EDIT_SHOW,', 'Math.min(3,'), HOOK],
  'command lessons: a negative room shows lessons': [SEEN, SEEN.replace('Math.max(0, room)', 'room'), HOOK],
  'command lessons: a lesson told again in the context': [SEEN, SEEN.replace('.filter((x) => !seen.has(x.lesson.name))', ''), HOOK],
  'command lessons: the order ignored': [SEEN, SEEN.replace('order([...first.values()].filter((x) => !seen.has(x.lesson.name)), readCounters(store), now)', '[...first.values()].filter((x) => !seen.has(x.lesson.name))'), HOOK],
  'command lessons: a block that is not told leaves its marker': ['if (!say) return none;\n  if (!dry) try {', 'if (!dry) try {', HOOK],
  'command lessons: a dry run writes its line': ['if (!dry) try {\n    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });\n    const id', 'try {\n    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });\n    const id', CLI],
  'command lessons: the tool id not cleaned in the marker': ["String(input.tool_use_id ?? '').replace(/[^\\w-]/g, '')", "String(input.tool_use_id ?? '')", HOOK],
  'command lessons: the tool id not cut in the marker': ["String(input.tool_use_id ?? '').replace(/[^\\w-]/g, '').slice(0, 64)", "String(input.tool_use_id ?? '').replace(/[^\\w-]/g, '')", HOOK],
  'command lessons: a call with no id leaves a marker': ['if (id) try { writeFileSync', 'try { writeFileSync', HOOK],
  'command lessons: the second start of a call speaks': ["if (e.code === 'EEXIST') return none;", '', HOOK],
  'command lessons: a marker that can be overwritten': ["flag: 'wx'", "flag: 'w'", HOOK],
  'command lessons: the line has no family': ['`cmd:${x.family}`', "'cmd:'", HOOK],
  'command lessons: a session line that will not write is still told': ["`cmd:${x.family}`), by, new Date(now).toISOString())).join(''), { mode: 0o600 });\n  } catch { return none; }", "`cmd:${x.family}`), by, new Date(now).toISOString())).join(''), { mode: 0o600 });\n  } catch {}", HOOK],
  'preview why: a family listed in applies_when worded as a name': ['(how === 3 ?', '(how === 9 ?', CLI],
};
