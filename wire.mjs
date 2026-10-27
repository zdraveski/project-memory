#!/usr/bin/env node
// How the memory hooks are wired: by settings.json entries that run the live
// copy (~/.claude/hooks-live), or by the project-memory plugin whose root is
// that same copy. Never both: every hook would run twice, and two Stop hooks
// race each other for the same store.
//
// Run: node wire.mjs --plugin | --settings [--dry-run]
//   --plugin    once the plugin is installed from the live copy, drop the settings.json entries
//   --settings  once the plugin is uninstalled, put the settings.json entries back
// It installs and uninstalls nothing: when the plugin is not in the state the
// switch needs, it prints the claude plugin command to run first. (Running the
// signed-in claude CLI from the plugin is what the plugin directory's security
// scan holds.) settings.json is backed up beside itself first. Deploy before --plugin.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { replaceIfUnchanged, raw } from './store.mjs';
import { PLUGIN, LIVE, ours } from './memory.mjs';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
// The plugin's own wiring is the one table: settings.json gets the same
// entries, so the two ways of wiring cannot drift apart.
const PLUGGED = JSON.parse(readFileSync(new URL('./hooks/hooks.json', import.meta.url), 'utf8')).hooks;

// settings without these hooks' handlers. Every other hook (rtk, the
// context-mode heal) and every other key stays as it was.
export function unwire(settings) {
  const hooks = {};
  for (const [ev, entries] of Object.entries(settings.hooks || {})) {
    const kept = (entries || []).map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !ours(h)) })).filter((e) => e.hooks.length);
    if (kept.length) hooks[ev] = kept;
  }
  const next = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}

// And back: the plugin's entries, running the live copy with this node. Exec
// form, as hooks.json has them -- node and its arguments with no shell between:
// a shell start cost ~55 ms of every Stop and ~40 ms of every SessionStart.
export function rewire(settings, live = LIVE, node = process.execPath, plugged = PLUGGED) {
  const slash = (p) => p.replace(/\\/g, '/');
  const run = (h) => ({ ...h, command: slash(node), args: h.args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', slash(live))) });
  const base = unwire(settings), hooks = { ...base.hooks };
  for (const [ev, es] of Object.entries(plugged)) hooks[ev] = [...(hooks[ev] || []), ...es.map((e) => ({ ...e, hooks: e.hooks.map(run) }))];
  return { ...base, hooks };
}

const handlers = (s) => Object.entries(s.hooks || {}).flatMap(([ev, es]) => (es || []).flatMap((e) => (e.hooks || []).filter(ours).map((h) => `${ev}${e.matcher ? ` (${e.matcher})` : ''}: ${[h.command, ...(h.args || [])].join(' ')}`)));

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const mode = process.argv.includes('--plugin') ? 'plugin' : process.argv.includes('--settings') ? 'settings' : null;
  const dry = process.argv.includes('--dry-run');
  const fail = (why) => { console.error(`wire: ${why}`); process.exit(1); };
  if (!mode) fail('say --plugin or --settings');
  if (!existsSync(join(LIVE, '.claude-plugin', 'plugin.json'))) fail(`no plugin in ${LIVE}: run node deploy.mjs first`);
  // The live copy's entries, which the check passed: this checkout's may be ahead of the last deploy.
  let live; try { live = JSON.parse(readFileSync(join(LIVE, 'hooks', 'hooks.json'), 'utf8')).hooks; } catch { fail(`no hooks/hooks.json in ${LIVE}: run node deploy.mjs first`); }
  // null when there is no settings.json: what replaceIfUnchanged expects then.
  const read = () => raw(SETTINGS);
  const text = read();
  let settings; try { settings = JSON.parse(text ?? '{}'); } catch (e) { fail(`${SETTINGS} does not parse: ${e.message}`); }
  const want = mode === 'plugin' ? unwire(settings) : rewire(settings, LIVE, process.execPath, live);
  console.log(`settings.json runs now:\n  ${handlers(settings).join('\n  ') || '(none of these hooks)'}`);
  console.log(`${dry ? 'it would run' : 'and from now'}:\n  ${handlers(want).join('\n  ') || '(none: the plugin runs them)'}`);
  if (dry) process.exit(0);
  // The plugin's state decides: entries dropped before it is installed leave no
  // hook running, and entries put back while it is enabled run every hook twice.
  const enabled = settings.enabledPlugins?.[PLUGIN] === true;
  if (mode === 'settings' && enabled) fail(`${PLUGIN} is still enabled; settings.json unchanged. Uninstall it first, then run this again:\n  claude plugin uninstall ${PLUGIN} --scope user`);
  if (mode === 'plugin' && !enabled) fail(`${PLUGIN} is not enabled yet; settings.json unchanged. Install it first, then run this again:\n  claude plugin marketplace add "${LIVE}"\n  claude plugin install ${PLUGIN} --scope user`);
  const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (text !== null) writeFileSync(backup, text);
  if (replaceIfUnchanged(SETTINGS, text, JSON.stringify(want, null, 2) + '\n') === 'conflict') fail('settings.json changed meanwhile: run again');
  console.log(`wired by ${mode === 'plugin' ? `the ${PLUGIN} plugin` : 'settings.json'}; backup ${backup}.`);
  // Claude Code's file watcher applies a settings.json hook edit to running
  // sessions at once; a plugin loads only at a session's start or /reload-plugins.
  console.log(mode === 'plugin'
    ? 'Running sessions lost the settings.json hooks just now and have not loaded the plugin: run /reload-plugins in each one, or restart it.'
    : 'Running sessions have the settings.json hooks now; one that loaded the plugin still runs it too until /reload-plugins.');
}
