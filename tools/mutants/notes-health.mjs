// The hand-written mutants of notes-health.mjs, which notes-health.test.mjs and memory-doctor.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place; { full: true } runs the whole suite.
export default {
  "a fence in a quote or a list counted": ["(?<![^\\n])[ \\t]*(?:(?:>|[*+-]|\\d+[.)])[ \\t]*)*(`{3,}|~{3,}(?!~))", "(?<![^\\n])[ \\t]*(`{3,}|~{3,}(?!~))"],
  "a lone CR starts a fence": ["t.replace(/(?<![^\\n])[ \\t]*", "t.replace(/^[ \\t]*", { full: true }],
  "a ~~~ fence counted": ["(`{3,}|~{3,}(?!~))[^`", "(`{3,})[^`"],
  "a ```` fence closed by a ``` one": ["(`{3,}|~{3,}(?!~))[^`", "(```|~{3,}(?!~))[^`"],
  "an inline fence in prose hides the links after it": ["(`{3,}|~{3,}(?!~))[^`\\n]*\\n", "(`{3,}|~{3,}(?!~))"],
  "a tilde run gives tildes back": ["~{3,}(?!~))[^`", "~{3,})[^`", { full: true }],
  "a link in code counted": [".replace(/`[^`\\n]*`/g, '')", ""],
  "a link named with .md is to nothing": [".trim().replace(/\\.md$/i, ''))", ".trim())"],
  "the shared store resolves no link": ["new Set([...shared, ...OWN", "new Set([...OWN"],
  "handoff and journal are linkable": [".filter((f) => has.has(f)).map((f) => f.replace(", ".filter((f) => false).map((f) => f.replace("],
  "an old commit counts": ["t > n.mtime && fs.some", "fs.some"],
  "a name is the start of another": ["f.startsWith(`${q}/`)", "f.startsWith(q)"],
  "the lesson's to: is not first": ["l.to.length ? l.to : [...l.named.paths, ...l.named.files]", "[...l.named.paths, ...l.named.files]"],
  "a hidden lesson is checked": ["!l || l.hidden ? [] :", "!l ? [] :"],
  "a word pair with a slash is a gone path": ["existsSync(join(repo, p.split('/')[0])) && ", ""],
  "a home path is read": ["/^(?:~|[A-Za-z]:", "/^(?:[A-Za-z]:"],
  "the near-duplicate test uses the shorter": ["Math.max(a.set.size, b.set.size)", "Math.min(a.set.size, b.set.size)"],
};
