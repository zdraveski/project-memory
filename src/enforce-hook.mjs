// PreToolUse hook. For Bash and PowerShell: logs which note's enforce: rule a git command matches, to <store>/.enforce-log (note,
// session tag, agent, tool-call id; never the command). It blocks nothing and prints nothing. For Edit, Write, NotebookEdit and
// MultiEdit (1.7.0, H1): prints the lessons for the file as additionalContext, once per lesson per context (lessons.mjs onEdit),
// never a permission decision. Any failure lets the call go on. A shell command loads store.mjs, enforce.mjs and timing.mjs (deployed
// with them) only. An edit asks switches.mjs (no imports) first and, with the trigger off, ends there: lessons.mjs is not loaded and no timing
// line is written. Each starts fast.
import * as T from './timing.mjs';
T.begin('enforce');
let quiet = false; // an edit with its trigger off: nothing runs, nothing is timed
try {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) text += c;
  const input = JSON.parse(text), command = input?.tool_input?.command;
  T.mark('input');
  const t0 = performance.now(); // the edit's 150 ms count from here, the load of lessons.mjs included
  const edit = /^(?:Edit|Write|NotebookEdit|MultiEdit)$/.test(input?.tool_name); // MultiEdit no longer exists (probe P6); harmless in the matcher
  if (edit) quiet = !(await import('./switches.mjs')).lessonsOn('edit'); // inside the try: a missing sibling file fails open
  if (quiet) {
    // off: nothing more to load or write
  } else if (edit) {
    T.name('lesson');
    const { onEdit, EDIT_MS } = await import('./lessons.mjs'); // inside the try: a missing sibling file fails open
    T.mark('load');
    const { say, shown } = onEdit(input, { deadline: t0 + EDIT_MS });
    T.mark('look');
    T.shown(shown.length);
    T.tag('PreToolUse');
    // Written whole before the exit: on macOS a pipe is written asynchronously.
    if (say) await new Promise((done) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: say } }) + '\n', done));
  } else {
    const { ruleSet, hits, record, privateTurn } = await import('./enforce.mjs'); // inside the try: a missing sibling file fails open
    T.mark('load');
    // The `if` filter in hooks.json is a speed-up; this is the check. Most calls end here, before any file is read.
    if (typeof command === 'string' && command.includes('git')) {
      const { store, rules, off } = ruleSet(input);
      let priv; // the transcript is read once a run, not once a rule
      if (!off) for (const { file, rule } of rules) if (hits(rule, command).hit && !(priv ??= privateTurn(input)))
        record(store, { t: new Date().toISOString(), note: file, s: String(input.session_id || '').slice(0, 8), agent: typeof input.agent_type === 'string' ? input.agent_type.slice(0, 64) : '', id: String(input.tool_use_id || '').slice(0, 64) });
    }
    T.mark('rules');
    T.tag('PreToolUse');
  }
} catch {}
if (!quiet) await T.flush();
process.exitCode = 0;
