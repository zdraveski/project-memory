// PreToolUse hook for Bash and PowerShell: logs which note's enforce: rule a git command matches, to
// <store>/.enforce-log (note, session tag, agent, tool-call id; never the command). It blocks nothing and prints
// nothing, and any failure lets the call go on. Imports store.mjs and enforce.mjs only, so it starts fast.

let ruleSet, hits, record, privateTurn;
try {
  ({ ruleSet, hits, record, privateTurn } = await import('./enforce.mjs')); // inside the try: a missing sibling file fails open
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) text += c;
  const input = JSON.parse(text), command = input?.tool_input?.command;
  // The `if` filter in hooks.json is a speed-up; this is the check. Most calls end here, before any file is read.
  if (typeof command === 'string' && command.includes('git')) {
    const { store, rules, off } = ruleSet(input);
    if (!off) for (const { file, rule } of rules) if (hits(rule, command).hit && !privateTurn(input))
      record(store, { t: new Date().toISOString(), note: file, s: String(input.session_id || '').slice(0, 8), agent: typeof input.agent_type === 'string' ? input.agent_type.slice(0, 64) : '', id: String(input.tool_use_id || '').slice(0, 64) });
  }
} catch {}
process.exitCode = 0;
