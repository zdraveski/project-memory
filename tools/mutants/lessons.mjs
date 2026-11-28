// The hand-written mutants of lessons.mjs, which lessons.test.mjs and briefing.test.mjs must catch (mutate.mjs runs them).
// The L2 ones (onFailure, the stuck streak) are caught by recall-hook.test.mjs.
const hook = { test: 'test/recall-hook.test.mjs' };
export default {
  'a shared lesson listed as a dead end of the project': ['.filter((x) => !x.shared && x.l.instead)', '.filter((x) => x.l.instead)'],
  'L2 an interrupt counts as a failure': ['input.is_interrupt === true ||', 'false ||', hook],
  'L2 a timeout or a refused call counts as a failure': ['|| NOT_FAILURE.test(error) ||', '||', hook],
  'L2 a command with no target is counted': ['    if (!target) return none;\n    const { why, store } = gate', '    const { why, store } = gate', hook],
  'L2 a private turn is counted': ["?.kind === 'quiet') return none;\n    const by", "?.kind === 'x') return none;\n    const by", hook],
  'L2 a helper and the main conversation share a count': ['l.by === by && l.kind === kind &&', 'l.kind === kind &&', hook],
  'L2 a streak runs across turns': ["cur.findLastIndex((l) => l.kind === 'asked' || l.kind === 'quiet') + 1)", '0)', hook],
  'L2 two failures of different targets make a streak': [': l.rest.startsWith(`${th} `));', ': true);', hook],
  'L2 it speaks twice in one context': ["|| cur.some((l) => theirs(l, 'stuck'))) return none;", ') return none;', hook],
  'L2 a success in between is no reset': ['.includes(true);\n  } catch { return null; }', '.includes(false);\n  } catch { return null; }', hook],
  'L2 a call with no result is taken for a success': ['done.get(id) === false', 'done.get(id) !== true', hook],
  'L2 a success before the typed prompt resets': ['{ calls = []; continue; }', '{ continue; }', hook],
  'L2 an unreadable transcript speaks anyway': ['await wentThrough(input.transcript_path, target) !== false', 'await wentThrough(input.transcript_path, target) === true', hook],
  'L2 a fix seen in one conversation is named': ['m.fixSessions >= 2', 'm.fixSessions >= 1', hook],
  'L2 a long fix is not cut': ['m.fix.length > 160 ?', 'm.fix.length > 16000 ?', hook],
  'L2 a lesson that resolves the error is not preferred': ['if (lesson) second =', 'if (false) second =', hook],
};
