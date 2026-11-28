// PreToolUse hook. For Bash and PowerShell: logs which note's enforce: rule a git command matches, to <store>/.enforce-log (note,
// session tag, agent, tool-call id, what the hook did; never the command). Only a rule the user allowed to block (L11, `decide` below)
// denies its command, as a deny in JSON with exit 0; any other hit prints at most its `instead:` line. For Edit, Write, NotebookEdit and
// MultiEdit (1.7.0, H1): prints the lessons for the file as additionalContext, once per lesson per context (lessons.mjs onEdit),
// never a permission decision. A shell command whose family (familyOf) is push, merge, publish, release, deploy or destroy gets the same
// for its lessons (H2, onCommand), unless `-command`. Any failure lets the call go on. A shell command loads store.mjs, enforce.mjs and timing.mjs (deployed
// with them), and lessons.mjs only for a family with its trigger on. An edit asks switches.mjs (no imports) first and, with the trigger off, ends there: lessons.mjs is not loaded and no timing
// line is written. Each starts fast.
import * as T from './timing.mjs';
T.begin('enforce');
// L11. What a hit of `rule` (in the note `file`, which says `instead`) does: 'blocked', 'said' (its instead line; the command runs) or
// 'watched'. A rule blocks only when it has an instead, is on the block list with its current hash, PROJECT_MEMORY_ENFORCE is not
// `watch`, the newest request does not itself name the command (the rule's subcommand and one of its `has` words), and fewer than 3
// calls of this turn were blocked already. Doubt is never a block. A throw is the caller's: its hit is then only watched.
const words = (ask) => ask.split(/\s+/).map((w) => w.replace(/^[(['"`]+/, '').replace(/(?<=.)[.,;:!?)\]'"`]+$/, ''));
async function decide({ store, file, rule, instead, s, id }, { blockList, ruleHash, blockedSince }) {
  if (!instead) return 'watched';
  if (process.env.PROJECT_MEMORY_ENFORCE === 'watch' || blockList(store)?.get(file) !== ruleHash(rule)) return 'said';
  const { readSession, sessionsOf } = await import('./sessions.mjs'), { join } = await import('node:path');
  const asked = /^[\w-]+$/.test(s) ? readSession(join(sessionsOf(store), s))?.findLast((x) => x.kind === 'asked' || x.kind === 'quiet') : undefined;
  if (!asked || !(Date.parse(asked.at) > 0)) return 'said'; // no request to compare with, or a session file that will not read
  if (asked.kind === 'quiet') return 'watched';
  const named = words(asked.rest);
  if (named.includes(rule.on) && rule.has.some((w) => named.includes(w))) return 'watched';
  return blockedSince(store, file, s, Date.parse(asked.at), id) < 3 ? 'blocked' : 'said';
}
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
    const enforce = await import('./enforce.mjs'), { ruleSet, hits, record, privateTurn, familyOf } = enforce; // inside the try: a missing sibling file fails open
    T.mark('load');
    let deny = '', note = '', lesson = ''; // L11: the reason of the first deny; the instead lines of the rules that said; H2's lesson block
    // The `if` filter in hooks.json is a speed-up; this is the check. Most calls end here, before any file is read.
    if (typeof command === 'string' && command.includes('git')) {
      const { store, rules, off } = ruleSet(input);
      let priv; // the transcript is read once a run, not once a rule
      if (!off) for (const { file, rule, l } of rules) if (hits(rule, command).hit && !(priv ??= privateTurn(input))) {
        const s = String(input.session_id || '').slice(0, 8), id = String(input.tool_use_id || '').slice(0, 64), instead = l?.lesson && !l.lesson.hidden ? l.lesson.instead : '';
        let did = 'watched';
        try { did = await decide({ store, file, rule, instead, s, id }, enforce); } catch {}
        record(store, { t: new Date().toISOString(), note: file, s, agent: typeof input.agent_type === 'string' ? input.agent_type.slice(0, 64) : '', id, did });
        if (did === 'blocked') deny ||= `project-memory: blocked by the rule in ${file}. Instead: ${instead}\nIf the user asked for exactly this command, say so and ask them to run it or to unblock the rule.`;
        if (did === 'said') note += `${note ? '\n' : ''}project-memory: the rule in ${file} matches this command. Instead: ${instead}`;
      }
    }
    T.mark('rules');
    // H2 (1.7.0): lessons for the command's families, on unless `-command`; a command with no family or the trigger off loads nothing more.
    const families = typeof command === 'string' ? familyOf(command) : [];
    if (families.length && (await import('./switches.mjs')).lessonsOn('command')) {
      T.name('lesson');
      const { onCommand, EDIT_MS } = await import('./lessons.mjs');
      const { say, shown } = onCommand(input, families, { deadline: t0 + EDIT_MS });
      T.mark('look');
      T.shown(shown.length);
      lesson = say;
    }
    // One JSON object, whatever was decided: a deny keeps the lesson block after its own text; the others put the instead lines before it.
    const out = deny ? { permissionDecision: 'deny', permissionDecisionReason: [deny, lesson].filter(Boolean).join('\n') } : note || lesson ? { additionalContext: [note, lesson].filter(Boolean).join('\n') } : null;
    if (out) await new Promise((done) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }) + '\n', done));
    T.tag('PreToolUse');
  }
} catch {}
if (!quiet) await T.flush();
process.exitCode = 0;
