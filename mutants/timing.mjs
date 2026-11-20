// The hand-written mutants of timing.mjs, which timing.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'the off switch ignored': ["process.env.PROJECT_MEMORY_TIMING === '0'", 'false'],
  'an unknown hook name accepted': ['!HOOKS.includes(hook) || ', ''],
  'an event that is not a name kept': ['/^[A-Za-z]{1,24}$/', '/^.{1,24}$/'],
  'an event that is not text kept': ["typeof event === 'string' && ", ''],
  'a detail that is not a word kept': ['/^[a-z]{1,12}$/', '/^.*$/'],
  'a detail added to an event that is not a name': ["run.e !== '?' && ", ''],
  'two marks of one phase not added': ['(run.p[phase] ?? 0) + (now - run.last)', 'now - run.last'],
  'the file never cut': ['256 * 1024', '256 * 4096'],
  'the cut keeps most of the file': ['lines.length / 2', 'lines.length / 10'],
  'a cut that lost the race still replaces the file': ['stat(file).size === size', 'true'],
  'the temp copy of a lost cut stays': ['rmSync(tmp, { force: true })', '0'],
  'a failed write thrown into the hook': ['  } catch {}\n}\n\n// Lines of', '  } catch (e) { throw e; }\n}\n\n// Lines of'],
  'a run written twice': ['const r = run; run = null;', 'const r = run;'],
  'a line without a number kept': ["typeof o.ms === 'number' && ", ''],
  'a line older than since kept': ['&& o.t >= since', ''],
};
