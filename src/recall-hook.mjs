// The one entry point of the 1.6.0 recall hooks. Today PostToolUse for Edit, Write and NotebookEdit (headline 1b, "a file
// with a past"): after a change that worked, it names earlier exchanges that changed the same file, as additionalContext.
// Modelled on enforce-hook.mjs: the import sits inside the try (a missing sibling fails open), the cheapest check comes first,
// and the exit code is always 0 with nothing printed on any failure. PROJECT_MEMORY_RECALL=0 turns every pointer off.
import * as T from './timing.mjs';
T.begin('recall');
try {
  if (process.env.PROJECT_MEMORY_RECALL !== '0') {
    const { onChange } = await import('./recall.mjs');
    T.mark('load');
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) text += c;
    const input = JSON.parse(text);
    T.tag(input?.hook_event_name);
    if (input?.hook_event_name === 'PostToolUse') {
      const { say, n } = await onChange(input);
      T.mark('look');
      T.shown(n);
      // Written whole before the exit: on macOS a pipe is written asynchronously.
      if (say) await new Promise((done) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: say } }) + '\n', done));
    }
  }
} catch {}
await T.flush();
process.exitCode = 0;
