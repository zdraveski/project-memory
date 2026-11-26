// The hand-written mutants of timing.mjs, which timing.test.mjs must catch (mutate.mjs runs them).
// Each is a label and a pair: the text to find and what to put in its place.
export default {
  'the off switch ignored': ["process.env.PROJECT_MEMORY_TIMING === '0'", 'false'],
  'an unknown hook name accepted': ['!HOOKS.includes(hook) || ', ''],
  'an event outside the list kept': ['EVENTS.includes(event)', "typeof event === 'string'"],
  'a detail outside the list kept': ['DETAILS.includes(detail)', "typeof detail === 'string'"],
  'a detail added to an event that is not a name': ["run.e !== '?' && ", ''],
  'two marks of one phase not added': ['(run.p[phase] ?? 0) + (now - run.last)', 'now - run.last'],
  'the file never cut': ['256 * 1024', '256 * 4096'],
  'a failed write thrown into the hook': ['  } catch {}\n}\n\n// Lines of', '  } catch (e) { throw e; }\n}\n\n// Lines of'],
  'a run written twice': ['const r = run; run = null;', 'const r = run;'],
  'a line without a number kept': ["typeof o.ms === 'number' && ", ''],
  'a line older than since kept': ['&& o.t >= since', ''],
};
