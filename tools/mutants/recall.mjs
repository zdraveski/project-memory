// The hand-written mutants of recall.mjs, which recall.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'a path ends inside a name, not at a folder': ['f.endsWith(`/${p}`)', 'f.endsWith(p)'],
  'a helper is not told by its key': ["e.key.startsWith('subagent-')", "e.key.startsWith('subagent_')"],
  'a conversation id matches anywhere inside': ['id.startsWith(g)', 'id.includes(g)'],
  "a combining mark splits a word": ["n.replace(VERSION, ' ').split(/[^\\p{L}\\p{M}\\p{N}]+/u)", "n.replace(VERSION, ' ').split(/[^\\p{L}\\p{N}]+/u)", { test: 'test/memory.test.mjs' }],
  "a decomposed accent in a note is not the typed one": ["plain(t) ? hay.normalize('NFC').includes(t)", "plain(t) ? hay.includes(t)", { test: 'test/memory.test.mjs' }],
  "a decomposed accent in the query is not the noted one": ["q.normalize('NFC').toLowerCase()", "q.toLowerCase()", { test: 'test/memory.test.mjs' }],
  "stop words searched": ["const kept = all.filter((t) => !STOP.has(t)), as = new Map();", "const kept = all.filter((t) => true), as = new Map();"],
  "two-letter words dropped": ["filter((t) => t.length >= 2 || CJK.test(t))", "filter((t) => t.length >= 3 || CJK.test(t))", { test: 'test/memory.test.mjs' }],
  "a two-letter word found inside a word": ["`(?<!${NC}[\\\\p{L}\\\\p{M}\\\\p{N}])${t}(?!${NC}[\\\\p{L}\\\\p{M}\\\\p{N}])`", "`${t}`", { test: 'test/memory.test.mjs' }],
  "two-letter stop words searched": ["'am', 'an', 'as', 'at', 'be', 'by', 'do', ", "", { test: 'test/memory.test.mjs' }],
};
