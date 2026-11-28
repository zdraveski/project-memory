// The hand-written mutants of replay.mjs, which replay.test.mjs must catch (mutate.mjs runs them). Each is a label and a pair: the text to
// find and what to put in its place. They break the blind cut and the caps first: a leak in the cut makes every number the gate reads wrong.
export default {
  'a lesson made in the same minute is known to the exchange': ['filter((x) => x.created < entry.at)', 'filter((x) => x.created <= entry.at)'],
  'a lesson newer than its exchange passes the guard': ['if (!(x.created < entry.at)) throw', 'if (false) throw'],
  'a lesson is dated by its file time even when an exchange made it': ['created: made ? made.at : local(x.mtime)', 'created: local(x.mtime)'],
  "another project's note of the same name dates this one": ["&& !others.has(q[n - 3]);", ';'],
  "a note changed under a folder this machine has no store for is not dated by it": ["&& !others.has(q[n - 3]);", '&& q[n - 3] === own;'],
  'a lesson fires more than once in a conversation': ['if (s.seen.has(x.name) || used[trigger] >= 2', 'if (used[trigger] >= 2'],
  'an entry shows more than 2 lessons': ['used[trigger] >= 2 || s.n >= 6', 's.n >= 6'],
  'a conversation shows more than 6 lessons': ['used[trigger] >= 2 || s.n >= 6', 'used[trigger] >= 2'],
  'the errors and file pairs are those of the whole journal, not of what came before': ['mistakes(es.slice(0, lo), t)', 'mistakes(es, t)'],
  'a hidden lesson fires': ['if (l.hidden) { out.hidden++; continue; }', 'if (l.hidden) { out.hidden++; }'],
  'a retired lesson fires': ['mine.filter((x) => !counters.notes[x.name]?.retired)', 'mine'],
  'a recurring error is listed more than 3 times': ['(listed.get(r.id) ?? 0) < 3', 'true'],
  'every firing before a correction is a hit': ['if (isCorr(j) && shares(f, es[j]))', 'if (isCorr(j))'],
  'a ratio with under 20 firings is claimed': ['if (trials < ENOUGH)', 'if (false)'],
};
