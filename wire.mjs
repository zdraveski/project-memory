#!/usr/bin/env node
// How the memory hooks are wired: by settings.json entries that run the live
// copy (~/.claude/hooks-live), or by the project-memory plugin whose root is
// that same copy. Never both: every hook would run twice, and two Stop hooks
// race each other for the same store.
//
// Run: node wire.mjs --plugin | --settings [--dry-run]
//   --plugin    install the plugin from the live copy, then drop the settings.json entries
//   --settings  uninstall the plugin, then put the settings.json entries back
// settings.json is backed up beside itself first. Deploy before --plugin.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { replaceIfUnchanged, raw } from './store.mjs';
import { PLUGIN, LIVE, ours, claude } from './memory.mjs';

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
  const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (text !== null) writeFileSync(backup, text);
  const enabled = () => { try { return JSON.parse(read() ?? '{}').enabledPlugins?.[PLUGIN] === true; } catch { return false; } };
  try {
    if (mode === 'plugin') {
      // Installed first: a failed install leaves the settings.json wiring running.
      try { claude(['plugin', 'marketplace', 'add', LIVE]); } catch {}   // already added is no failure; the install says if it is
      claude(['plugin', 'install', PLUGIN, '--scope', 'user']);
    } else {
      try { claude(['plugin', 'uninstall', PLUGIN, '--scope', 'user']); } catch {}
    }
  } catch (e) { fail(`claude plugin: ${String(e.stderr || e.message).trim().split('\n')[0]}; settings.json unchanged`); }
  // Either way the plugin's state decides, not the CLI's exit: an uninstall
  // that failed quietly, with the entries put back, wired every hook twice.
  if (mode === 'settings' && enabled()) fail(`${PLUGIN} is still enabled (claude plugin uninstall failed?); settings.json unchanged`);
  if (mode === 'plugin' && !enabled()) fail(`${PLUGIN} did not end up enabled; settings.json unchanged`);
  // The CLI rewrote settings.json (enabledPlugins): edit what it wrote.
  const now = read();
  const next = JSON.stringify(mode === 'plugin' ? unwire(JSON.parse(now ?? '{}')) : rewire(JSON.parse(now ?? '{}'), LIVE, process.execPath, live), null, 2) + '\n';
  if (replaceIfUnchanged(SETTINGS, now, next) === 'conflict') fail('settings.json changed meanwhile: run again');
  console.log(`wired by ${mode === 'plugin' ? `the ${PLUGIN} plugin` : 'settings.json'}; backup ${backup}.`);
  // Claude Code's file watcher applies a settings.json hook edit to running
  // sessions at once; a plugin loads only at a session's start or /reload-plugins.
  console.log(mode === 'plugin'
    ? 'Running sessions lost the settings.json hooks just now and have not loaded the plugin: run /reload-plugins in each one, or restart it.'
    : 'Running sessions have the settings.json hooks now; one that loaded the plugin still runs it too until /reload-plugins.');
}
