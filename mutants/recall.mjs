// The hand-written mutants of recall.mjs, which recall.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'a path ends inside a name, not at a folder': ['f.endsWith(`/${p}`)', 'f.endsWith(p)'],
  'a helper is not told by its key': ["e.key.startsWith('subagent-')", "e.key.startsWith('subagent_')"],
  'a conversation id matches anywhere inside': ['id.startsWith(g)', 'id.includes(g)'],
};
