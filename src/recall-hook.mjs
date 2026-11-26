// The one entry point of the 1.6.0 recall hooks. PostToolUse for Edit, Write and NotebookEdit (headline 1b, "a file with a
// past"): after a change that worked, it names earlier exchanges that changed the same file. UserPromptSubmit (headline 1c, "a
// prompt that names something old"): it names earlier exchanges that share rare words with the request. Both as additionalContext,
// with another live session that works here (headline 4). SessionEnd: the session file's `end` line, nothing printed.
// Modelled on enforce-hook.mjs: the import sits inside the try (a missing sibling fails open), the cheapest check comes first,
// and the exit code is always 0 with nothing printed on any failure. Pointers are opt-in (PROJECT_MEMORY_RECALL=1);
// unset, only the session lines and the other-session warnings; PROJECT_MEMORY_RECALL=0 turns everything off.
// stdout is empty unless a pointer is shown (tools/recall-eval.mjs reads that).
import * as T from './timing.mjs';
try {
  if (process.env.PROJECT_MEMORY_RECALL !== '0') {
    // Inside the switch: a run that does nothing must not count in the doctor as a look-up.
    T.begin('recall');
    const { onChange, onPrompt, onEnd } = await import('./recall.mjs');
    T.mark('load');
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) text += c;
    const input = JSON.parse(text), event = input?.hook_event_name;
    T.tag(event);
    const on = event === 'PostToolUse' ? onChange : event === 'UserPromptSubmit' ? onPrompt : null;
    if (on) {
      if (on === onPrompt) T.name('prompt');
      const { say, n } = await on(input);
      T.mark('look');
      T.shown(n);
      // Written whole before the exit: on macOS a pipe is written asynchronously.
      if (say) await new Promise((done) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: say } }) + '\n', done));
    } else if (event === 'SessionEnd') {
      T.name('end');
      onEnd(input);
      T.mark('end');
    }
  }
} catch {}
await T.flush();
process.exitCode = 0;
