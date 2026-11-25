// The hand-written mutants of privacy.mjs, which privacy.test.mjs, store.test.mjs and handoff-log.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place; { full: true } runs the whole suite.
export default {
  "F12 a list that won't read taken for no tags": ["unread = e.code !== 'ENOENT';", 'unread = false;'],
  "a list held for a moment read again at once": [" if (i < tries - 1 && BUSY.includes(e.code)) sleep(STEP); }", " }"],
  "only one spelling of the mark": ["export const PRIVATE_SESSION = /<\\s*private[-_]session\\b[^>]{0,200}>/i;", "export const PRIVATE_SESSION = /<private-session>/i;"],
  "a CRLF list of private conversations misread": ["const have = listOf(before);", "const have = (before ?? '').split('\\n').filter(Boolean);"],
  "a private tag with attributes kept": ["export const PRIVATE = /<\\s*private(?![-_\\w])(?:[^>]*>|[^>]*$)/i;", "export const PRIVATE = /<private>/i;"],
  "the mark forgotten after its turn": ["if (!mark || have.includes(s)) return have.includes(s);", "if (!mark || have.includes(s)) return mark;"],
  "a tag lost to a write that landed first": ["[...prune(have), s].join('\\n') + '\\n') !== 'conflict') return true;", "[...prune(have), s].join('\\n') + '\\n') !== 'never') return true;"],
  "a tag that lost every race reported written": ["    if (replaceIfUnchanged(p, before, [...prune(have), s].join('\\n') + '\\n') !== 'conflict') return true;\n  }\n  return unread ? null : false;", "    if (replaceIfUnchanged(p, before, [...prune(have), s].join('\\n') + '\\n') !== 'conflict') return true;\n  }\n  return true;"],
  "a memory-off tag written without the projects' lock": ["return withLock(root, () => {", "return ((f) => f())(() => {"],
  "R67 a memory-off list that won't read is silence": ["    if (r === null) throw unreadable(root, OFF);\n", ""],
  "memory-off tags kept by count": ["const live = onDisk(root);", "const live = new Set();"],
  "a memory-off tag dropped before its transcript is made": [" || i >= have.length - OFF_NEW", ""],
  "a failed listing prunes every memory-off tag": ["!live || live.has(t)", "live?.has(t)"],
  "memory-off tags never capped": [").slice(-OFF_MOST);", ");"],
  'private marks kept for 50': ['have.slice(-999)', 'have.slice(-49)'],
  'forget undone by a padded line': ["listOf(text).map((l) => l.split('\\t'))", "(text ?? '').split('\\n').filter(Boolean).map((l) => l.split('\\t'))"],
  "startup takes a missing forgotten list for one that will not read": ["shut: e.code !== 'ENOENT' }", "shut: true }", {"test":["test/privacy.test.mjs","test/handoff-log.test.mjs"]}],
  "a forgotten list that will not read taken for an empty one": ["shut: e.code !== 'ENOENT' }", "shut: false }", {"test":["test/privacy.test.mjs","test/handoff-log.test.mjs"]}],
  "a list that cannot be read taken for no tags": ["list, undefined, tries) !== false;", "list, undefined, tries) === true;"],
  "a caller that asks for one try gets three": ["for (let i = 0; i < tries; i++) {", "for (let i = 0; i < 3; i++) {"],
};
