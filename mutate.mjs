// Mutation check for the six suites: break one rule of a tool at a time in a
// copy and confirm its test fails. A mutant that survives is a rule the test
// does not watch. Run: node mutate.mjs
import { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { tool, tempDir } from './harness.mjs';

// Every file a suite may import, copied beside the mutant.
const FILES = ['harness.mjs', 'store.mjs', 'handoff-log.mjs', 'compact-gate.mjs', 'memory-tier.mjs', 'deploy.mjs', 'memory.mjs', 'wire.mjs',
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json', 'skills/memory/SKILL.md'];

const suites = {
  'store.mjs': ['store.test.mjs', {
    'transcript ignored': ['if (t && same(', 'if (false && same('],
    'path case and slashes matter': ['resolve(a).toLowerCase() === resolve(b).toLowerCase()', 'a === b'],
    'lock not exclusive': ['try { mkdirSync(lock); break; }', 'try { mkdirSync(lock, { recursive: true }); break; }'],
    'a dead lock is never taken over': ['statSync(lock).mtimeMs > LOCK_STALE;', 'statSync(lock).mtimeMs > LOCK_STALE * 1e6;'],
    'a dead lock of any shape is not taken over': ['rmSync(lock, { recursive: true, force: true })', 'rmdirSync(lock)'],
    'an unremovable dead lock is busy forever': ['catch (err) { if (Date.now() > until) throw err; }', 'catch {}'],
    'EACCES on the lock throws': ["if (e.code !== 'EEXIST' && !BUSY.includes(e.code)) throw e;", "if (e.code !== 'EEXIST' && e.code !== 'EPERM') throw e;"],
    'a held lock is not given up on': ['if (Date.now() > until) return null;', 'if (Date.now() > until) break;'],
    'lock kept after a throw': ['try { return fn(); } finally { try { rmdirSync(lock); } catch {} }', 'const out = fn(); try { rmdirSync(lock); } catch {} return out;'],
    'nothing-to-write rewrites': ['if (read() === next) return false;', ''],
    'a write it did not see is overwritten': ["if (read() !== expected) return 'conflict';", ''],
    'the shared store under a slug a cwd can make': ["join(projectsRoot(), '_shared', 'memory')", "join(projectsRoot(), '-shared', 'memory')"],
    'a junctioned store listed twice': ['seen.has(real) || ', ''],
    "git's reason discarded": ["String(e.stderr || '').split('\\n').map((l) => l.trim()).find((l) => l && !l.startsWith('warning:')) || ", ''],
    "a warning taken for git's reason": [".find((l) => l && !l.startsWith('warning:'))", '.find((l) => l)'],
    'escaped quotes kept in a description': [".replace(/\\\\\"/g, '\"')", ''],
    'the shared store on the project budget': ['(isShared(dir) ? SHARED_BUDGET : BUDGET)', 'BUDGET'],
    'local time counts months from zero': ['pad(d.getMonth() + 1)', 'pad(d.getMonth())'],
    'local time unpadded': ["const pad = (n) => String(n).padStart(2, '0');", 'const pad = (n) => String(n);'],
    'temp file left behind': ['} finally { try { unlinkSync(tmp); } catch {} }', '} finally {}'],
  }],
  'compact-gate.mjs': ['compact-gate.test.mjs', {
    'a run through a symlink does nothing': ['pathToFileURL(realpathSync(process.argv[1])).href', 'pathToFileURL(process.argv[1]).href'],
    'a PreCompact payload is nudged too': ["payload.hook_event_name !== 'Stop' || ", ''],
    'no ceiling: mid-turn always deferred': ['if (s.ctx < CEILING * MODEL_WINDOW) return', 'if (true) return'],
    'a turn boundary is deferred too': ['if (!s.midTurn) return { code: 0', 'if (false) return { code: 0'],
    'in-flight note not written': ['const n = inflight(payload, s);', 'const n = true;'],
    'gate skips the handoff': ['const h = handoff(payload);', 'const h = true;'],
    'a silent handoff reads as written': ["else if (!h) failed.push('handoff: nothing written", "else if (h === 'never') failed.push('handoff: nothing written"],
    'a silent note reads as written': ['else if (!n) failed.push', "else if (n === 'never') failed.push"],
    'a held store reads as no handoff': ["if (h === 'busy') failed.push", 'if (false) failed.push'],
    'a held store reads as no markers': ["if (n === 'busy') failed.push", 'if (false) failed.push'],
    'a held store reads as a written note': ["return r ?? 'busy';", 'return r ?? false;'],
    'edited list uncapped': ['ed.slice(-LIST_MAX).join', 'ed.join'],
    'floor removed: a 200k model is deferred': ['if (s.ctx < FLOOR) return { code: 0', 'if (false) return { code: 0'],
    'running tasks forgotten at each prompt': ['s.edited.clear(); }', 's.edited.clear(); s.running.clear(); }'],
    'notebook edits unlisted': ['b.input?.file_path || b.input?.notebook_path', 'b.input?.file_path'],
    'nudge reason untagged': ['`${NUDGE_TAG} Context is at', '`Context is at'],
    're-arm on drop removed': ['if (given) arm(0);', ''],
    'nudge repeats every turn': ['if (given && s.ctx >= given) return null;', ''],
    'agent launches missed': ['[\\s\\S]*?(?:Output is being written to|output_file)', '[\\s\\S]{0,200}?(?:Output is being written to|output_file)'],
    'recovery never runs': ["if (!s.midTurn) return '';", "return '';"],
    'a finished turn gets a note': ["if (!s.midTurn) return '';", ''],
    'nudge back at 0.95':['export const TRIGGER = 0.85;', 'export const TRIGGER = 0.95;'],
    'old nudge files never pruned': ['if (Date.now() - statSync(p).mtimeMs > WEEK) unlinkSync(p);', ''],
    'notes untagged': ["**cut mid-turn**${t ? ` [${t}]` : ''}", '**cut mid-turn**'],
    'the note is built from the short read': ['  s = state(payload.transcript_path);', ''],
    'the tail stops before the prompt': ['if ((ask ? s.ask : s.ctx) || whole) return s;', 'if (s.ctx || whole) return s;'],
    'notified tasks still listed as running':['for (const hit of t.matchAll(DONE)) s.running.delete(hit[1]);', ''],
  }],
  'handoff-log.mjs': ['handoff-log.test.mjs', {
    'a run through a symlink does nothing': ['pathToFileURL(realpathSync(process.argv[1])).href', 'pathToFileURL(process.argv[1]).href'],
    'a /clear names the conversation it cleared': ["input.source === 'clear' ? [] : others.length", 'others.length'],
    'every deployed file read and hashed': ['if (was && s.size === was[0] && s.mtimeMs === was[1]) return false;', ''],
    'a same-size edit taken as deployed': ['if (was && s.size === was[0] && s.mtimeMs === was[1]) return false;', 'if (was && s.size === was[0]) return false;'],
    'a moved stat taken as an edit': ['return hash(readFileSync(join(here, f))) !== m.files[f];', 'return true;'],
    'a nudge does not freeze the answer': ['if (!pending.frozen) pending.did = t;', 'pending.did = t;'],
    'a nudge counts as an ask': ["!s.startsWith('[SYSTEM') && ", ''],
    'isMeta records count as asks': ['!r.isMeta && ', ''],
    'compaction summaries count as asks': ['!r.isCompactSummary && ', ''],
    'tail never grows': ['if (got.length || whole) return got;', 'return got;'],
    'no merge with existing entries': ['keep([...kept, ...fresh])', 'keep(fresh)'],
    'the key ignores the session': ['const key = (t) => `${t.s} ${t.at} ${t.ask}`;', 'const key = (t) => `${t.at} ${t.ask}`;'],
    'an untagged entry kept beside its tagged re-sighting': [" && !(t.s === '' && seenBare.has(bare(t)))", ''],
    'first start marker, not last': ['doc.lastIndexOf(START, b)', 'doc.indexOf(START)'],
    'interrupts count as asks': [" && !s.startsWith('[Request interrupted')", ''],
    'no cap at TURNS': ['.slice(-TURNS)', ''],
    'rewrite even when unchanged': ["if (have.map(render).join('\\n') === core) return 'unchanged';", ''],
    'no frontmatter on an empty file': ["if (!doc.startsWith('---')) doc = FRONT + doc;", ''],
    'marker text in a prompt not defused': [".replace(/<!--/g, '<!- -')", ''],
    'a prefixed nudge counts as an ask': ['!nudged(s) && ', ''],
    'a prefixed nudge does not freeze the answer': ['pending && nudged(t)', 'pending && t.startsWith(NUDGE_TAG)'],
    'no cap at SESSIONS': ['.slice(0, SESSIONS)', ''],
    'the newest session kept last': ['.sort((x, y) => byAt(y[y.length - 1], x[x.length - 1]))', '.sort((x, y) => byAt(x[x.length - 1], y[y.length - 1]))'],
    'entries out of time order': ['const byAt = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);', 'const byAt = () => 0;'],
    'entries not tagged': ["${t.s ? ` [${t.s}]` : ''}: ${clip(t.ask, ASK)}", ': ${clip(t.ask, ASK)}'],
    'the tag is not read back': ['(?: \\[([\\w-]+)\\])?', ''],
    'handoff written without the lock': ['const r = withLock(dir, () => {', 'const r = ((f) => f())(() => {'],
    'compaction shows every session': ['const shown = (mine.length ? mine : all.slice(-TURNS))', 'const shown = (all)'],
    'none of its own: every entry shown': ['mine : all.slice(-TURNS))', 'mine : all)'],
    'a held store reads as nothing to write': ["return r ?? 'busy';", 'return r ?? false;'],
    'other sessions never named': ["f.endsWith('.jsonl') && tag(f) !== me", 'false'],
    'a session named to itself': [' && tag(f) !== me', ''],
    'a quiet session called working': ['.filter((t) => Date.now() - t.m < ACTIVE)', ''],
    'startup line ignores age': ['last && age(last) < RECENT', 'last'],
    'health not shown at startup': ['...health(dir), ', ''],
    'a stopped Stop hook unseen': [', ...(doc ? stalled(live[0]) : [])', ''],
    'a project with no handoff judged': ['doc ? stalled(live[0]) : []', 'stalled(live[0])'],
    'a stall judged without the last run': ['end - ran > GRACE', 'end > GRACE'],
    'no .stop-ran read as never ran': [".stop-ran')).mtimeMs; } catch { return []; }", ".stop-ran')).mtimeMs; } catch { ran = 0; }"],
    'a turn just ended called stalled': [' && Date.now() - end > GRACE', ''],
    'a transcript format drift unseen': ['if (seen >= 50 && !known)', 'if (false)'],
    'start-up records counted as drift': ["if (r.type === 'user' || r.type === 'assistant') seen++;", 'seen++;'],
    'an edit to the live copy unseen': [', ...edited()', ''],
    'a file gone from the live copy unseen': ['} catch { return true; }', '} catch { return false; }'],
    'a damaged manifest takes the startup line with it': ['  } catch { return []; }\n}\n\n// The shared store', '  } catch (e) { throw e; }\n}\n\n// The shared store'],
    'main awaits at the top level':['  (async () => {', '  await (async () => {'],
    'a prompt naming tool_use_id dropped': ["!s.startsWith('[SYSTEM') && ", "!s.includes('tool_use_id') && !s.startsWith('[SYSTEM') && "],
    'every other session named': ['.slice(0, 2)', ''],
    'an untagged [word]: ask reads as tagged': ['(\\S+ \\S+?)', '(\\S+ \\S+)'],
    "the shared store's problems unsaid": ['for (const d of [dir, sharedStore()]) {', 'for (const d of [dir]) {'],
    'markdown kept in an answer': ['did: clip(plain(t.did), DID)', 'did: clip(t.did, DID)'],
    'table rules kept in an answer': [".filter((l) => !(l.includes('-') && /^[ \\t|:-]*$/.test(l)))", ''],
    'every pipe in an answer dropped': ["l.trimStart().startsWith('|') ? l.replace(/\\|/g, ' ') : l", "l.replace(/\\|/g, ' ')"],
    'every ** in an answer dropped': [".replace(/(^|[ \\t(])\\*\\*(?=[^\\s*])([^*]*?[^\\s*])\\*\\*(?=$|[\\s).,:;!?])/g, '$1$2')", ".replace(/\\*\\*/g, '')"],
    'bold opens mid-word': ['(^|[ \\t(])\\*\\*(?=[^\\s*])', '()\\*\\*(?=[^\\s*])'],
    'the printed shared lines uncapped': ['if (bytes + Buffer.byteLength(l) + 1 > SHARED_BUDGET) { cut++; continue; }', ''],
    'a /clear gets no startup line': [" || input.source === 'clear'", ''],
    'the stopped warning names no check': ['Run: node \"${join(dirname(fileURLToPath(import.meta.url)), \'memory.mjs\')}\" doctor', 'Check settings.json.'],
    'shared memory not printed at startup': ['...edited(), ...shared());', '...edited());'],
    'shared memory lost at a compaction': ['return [...lines, ...shared()]', 'return [...lines]'],
    'no hint while nothing is shared': ['lines.some((l) => !l.includes(`](${ARCHIVE})`))', 'true'],
    'a BOM hides the first shared line': [String.raw`index.replace(/^﻿/, '')`, 'index'],
    'CRLF entries unparseable':['(.*?)\\r?\\n  \\*\\*did:\\*\\* (.*?)\\r?$', '(.*)\\n  \\*\\*did:\\*\\* (.*)$'],
  }],
  'memory-tier.mjs': ['memory-tier.test.mjs', {
    'working rules age out': ['if (shared || KEEP_TYPES.has(f.type)) return true;', 'if (shared) return true;'],
    'a shared lesson ages out': ['if (shared || KEEP_TYPES.has(f.type)) return true;', 'if (KEEP_TYPES.has(f.type)) return true;'],
    'the Stop hook leaves no proof of life': ["try { writeFileSync(join(projectsRoot(), '.stop-ran'), new Date().toISOString()); } catch {}", ''],
    'a held memory reads as missing': ['catch (e) { if (BUSY.includes(e.code)) throw e; return null; }', 'catch { return null; }'],
    'tier: hot ignored': ["if (f.tier === 'hot') return true;", ''],
    'tier: archive ignored': ["if (f.tier === 'archive') return false;", ''],
    'event window never closes': ['return now - f.eventDate < EVENT_DAYS * DAY;', 'return true;'],
    'stale window never closes': ['return now - f.modified < STALE_DAYS * DAY;', 'return true;'],
    'archive is not sticky': ["place(p, p.f && (p.f.tier === 'hot' || (overflow && isHot(p.f, now, shared))) ? hot : cold);", 'place(p, isHot(p.f, now, shared) ? hot : cold);'],
    'duplicates kept': ['if (seen.has(p.target)) { dupes.push(p.target); return; }', ''],
    'orphans not recovered': ["place({ line: `- [${title}](${f}) — ${hook}`, target: f, f: facts }, (shared ? facts.tier !== 'archive' : facts.tier === 'hot') ? hot : cold);", ''],
    'pinned orphan recovered cold': ["target: f, f: facts }, (shared ? facts.tier !== 'archive' : facts.tier === 'hot') ? hot : cold);", 'target: f, f: facts }, (shared ? facts.tier !== \'archive\' : false) ? hot : cold);'],
    'a shared orphan filed cold': ["(shared ? facts.tier !== 'archive' : facts.tier === 'hot') ? hot : cold);", "facts.tier === 'hot' ? hot : cold);"],
    'an archived shared orphan recovered hot': ["shared ? facts.tier !== 'archive' : ", 'shared ? true : '],
    'prose dropped': ['const render = () => [...main.preamble, ...hot.map((p) => p.line),', 'const render = () => [...hot.map((p) => p.line),'],
    'archive line duplicated': ['if (m && m[1] === ARCHIVE_TARGET) continue;', ''],
    'BOM not stripped': ["text.replace(/^﻿/, '')", 'text'],
    'event logs not evicted first': ['.sort(byAge), ...work.filter((p) => p.f.eventDate === null).sort(byAge)]', ', ...work.filter((p) => p.f.eventDate === null)].sort(byAge)'],
    'an overflow victim never returns': ['(overflow && isHot(p.f, now, shared))', 'false'],
    'overflow victims unmarked': ["victim.line += ' ' + OVERFLOW;", ''],
    'recovered pointer carries its filename as facts': ['target: f, f: facts }', 'target: f, f }'],
    'failed snapshot still stamps': ['if (gated && snapOk) for', 'if (gated) for'],
    'every store tiered on --stop': [": stop ? [storeOf(payload || {}), sharedStore()].filter((d) => existsSync(join(d, 'MEMORY.md')))", ': stop ? allStores()'],
    'the shared store not tiered on --stop': ['[storeOf(payload || {}), sharedStore()]', '[storeOf(payload || {})]'],
    'tier runs without the lock': ['withLock(dir, () => tier(dir, now))', 'tier(dir, now)'],
    'the model\'s edit overwritten': ['write(mainPath, mainText, nextMain)', "write(mainPath, readFileSync(mainPath, 'utf8'), nextMain)"],
    'a reorder rewrites the index': ['read !== null && sameLines(read, next) ? false : ', ''],
    'no orphan grace': ['now - statSync(join(dir, f)).mtimeMs < ORPHAN_GRACE) { waiting = true; continue; }', 'false) { waiting = true; continue; }'],
    'the handoff waits out the grace every turn': ["f !== 'handoff.md' && ", ''],
    'a junctioned store committed twice': ['.filter((d) => !same(realpathSync(d), join(real, d.slice(root.length + 1))))', '.filter(() => false)'],
    'a symlinked home snapshots nothing': ['!same(realpathSync(d), join(real, d.slice(root.length + 1)))', '!same(realpathSync(d), d)'],
    'a young orphan stamps its store': ['< ORPHAN_GRACE) { waiting = true; continue; }', '< ORPHAN_GRACE) continue;'],
    'a pointer before its file is a problem at once': ['missing: young ? [] : missing', 'missing'],
    'a young pointer stamps its store': ['waiting: waiting || (young && missing.length > 0)', 'waiting'],
    'a waiting store is stamped': ['if (!r.waiting && gated) try', 'if (gated) try'],
    '.gitignore written in place': ['replaceIfUnchanged(ignorePath, have, want);', 'writeFileSync(ignorePath, want);'],
    'a fresh git lock is deleted': ["if (Date.now() - statSync(lock).mtimeMs < GIT_LOCK_STALE) return 'busy';", ''],
    'a stale git lock is never cleared': ['      unlinkSync(lock);', "      return 'busy';"],
    'a busy snapshot stamps': ["snapOk = s !== 'busy' && ", 'snapOk = '],
    'nothing to commit read as a failure': ['if (/nothing (added )?to commit/.test(String(e.stdout))) return null;', ''],
    'snapshot failures never counted': ['failures: (h.failures || 0) + 1', 'failures: 0'],
    'health never written': ['if (!dry) try { health(dir, problems); } catch {}', ''],
    'health throws out of the hook': ['if (!dry) try { health(dir, problems); } catch {}', 'if (!dry) health(dir, problems);'],
    'stamp write throws out of the hook': ['try { writeFileSync(stampOf(d), seen); } catch {}', 'writeFileSync(stampOf(d), seen);'],
    'index.lock mid-sequence is a failure': ["if (/index\\.lock/.test(why)) return 'busy';", ''],
    'health never cleared': ['if (want === null) unlinkSync(p); else writeFileSync(p, want);', 'if (want !== null) writeFileSync(p, want);'],
    'date not in the fingerprint': ['new Date().toDateString() + JSON.stringify', 'JSON.stringify'],
    'budget ceiling removed': ['while (Buffer.byteLength(render()) > budget && queue.length) {', 'while (false) {'],
    'rule share removed': ['while (ruleBytes > share && rules.length) {', 'while (false) {'],
    'rule share measured on the whole budget': ['Math.max(0, budget - pinnedBytes) * RULE_SHARE', 'budget * RULE_SHARE'],
  }],
  'memory.mjs': ['memory.test.mjs', {
    'the first reply called a problem': ['if (Date.now() - end > GRACE) say(false, `Claude finished', 'if (true) say(false, `Claude finished'],
    'a dead Stop hook called waiting': ['if (Date.now() - end > GRACE) say(false, `Claude finished', 'if (false) say(false, `Claude finished'],
    'a reply seconds old called a dead hook': ['if (Date.now() - end > GRACE) say(false, `Claude finished', 'if (Date.now() - end > 0) say(false, `Claude finished'],
    'a run through a symlink does nothing': ['pathToFileURL(realpathSync(process.argv[1])).href', 'pathToFileURL(process.argv[1]).href'],
    'a name weighs no more than a mention': ['(name.includes(t) ? 3 : 0)', '(name.includes(t) ? 1 : 0)'],
    'no strong-match bonus': ['(strong ? 5 : every ? 2 : 0)', '(every ? 2 : 0)'],
    'body hits uncapped': ['Math.min(2, count(body, t))', 'count(body, t)'],
    'an archived memory unlabelled': ["cold.has(file) ? 'archived' : 'unindexed'", "'unindexed'"],
    'the shared store not searched': ['isShared(here) ? [here] : [here, sharedStore()]', '[here]'],
    'a BOM hides the frontmatter': ["readFileSync(p, 'utf8').replace(/^﻿/, '')", "readFileSync(p, 'utf8')"],
    'the shared store resolves no link': ['new Set([...names(ms), ...sharedNames])', 'new Set(names(ms))'],
    'restore replaces a memory that exists': ['if (existsSync(path) && !force) return no(', 'if (false) return no('],
    'restore drops the hand-written line': ["line = t.split(/\\r?\\n/).find((l) => target(l) === file)?.replace(OVERFLOW, '') ?? null;", 'line = null;'],
    'restore adds a second line': ['if ([main, raw(join(dir, ARCHIVE))].some((t) => targets(t).includes(file))) return', 'if (false) return'],
    'restore from the deletion itself': ["from = gone ? `${gone}^` : 'HEAD'", "from = gone || 'HEAD'"],
    'a path reaches outside the store': ['basename(args[0])', 'args[0]'],
    'promote leaves the project copy': ['try { unlinkSync(src); } catch (e) {', 'try { } catch (e) {'],
    'promote without the lock': ['const r = withLock(dir, () => withLock(to, () => {', 'const r = ((f) => f())(() => ((f) => f())(() => {'],
    'restore without the lock': ['const r = withLock(dir, () => {\n    const cur = raw(path);', 'const r = ((f) => f())(() => {\n    const cur = raw(path);'],
    'restore keeps the overflow mark': [".find((l) => target(l) === file)?.replace(OVERFLOW, '') ?? null;", '.find((l) => target(l) === file) ?? null;'],
    'restore ignores the archive': ["for (const idx of ['MEMORY.md', ARCHIVE])", "for (const idx of ['MEMORY.md'])"],
    'a shared memory promoted again': ['if (isShared(dir)) return no(', 'if (false) return no('],
    "the session's own store ignored": ['if (id) {', 'if (false) {'],
    'a subdirectory finds no store': ['if (existsSync(storeOf({ cwd: d }))) return storeOf({ cwd: d });', ''],
    'restore skips the newest snapshot': ["try { git('cat-file', '-e', `HEAD:${at}`); from = 'HEAD'; }", 'try { throw 0; }'],
    'a store path in another case misses its snapshots': ['realpathSync.native(p)', 'realpathSync(p)'],
    'doctor: an old plugin copy unseen': ['else if (deployedCommit(at) !== deployedCommit(LIVE))', 'else if (false)'],
    'the plugin taken to run its cache copy': ["(marketplace()?.source === 'directory' ? marketplace().path : installPath())", '(installPath())'],
    'a plugin read from the repo unseen': ["else if (marketplace()?.source === 'directory' && !same(at, LIVE)) say(false,", 'else if (false) say(false,'],
    'stop words searched': [' && !STOP.has(t)', ''],
    'the handoff is a search hit': ["if (m.file === 'handoff.md') continue;", ''],
    'every link of a hit listed': ['more(h.links, 5)', "h.links.join(', ')"],
    'short words read as no match': ['!words(q).length ? [', 'false ? ['],
    'the first snapshot called its writing': ["head[1] === 'memory: first snapshot' ? 'in the first snapshot' : verb[l[0]]", 'verb[l[0]]'],
    'no next step when a name is not found': [": search <words> finds a memory's name", ''],
    'the count hides what was left out': ['${hits.length} of ${all.length} match(es)', '${hits.length} of ${hits.length} match(es)'],
    'hits without their dates': ["${local(h.modified).slice(0, 10)}  ", ''],
    'a BOM hides the first index line': ["(line.replace(/^\\uFEFF/, '').match(POINTER) || [])[1]", '(line.match(POINTER) || [])[1]'],
    'restore over the same version says restored': ["if (cur !== null && cur.replace(/^\\uFEFF/, '') === text) return", 'if (false) return'],
    'what --force replaced is lost': ["input: cur, encoding: 'utf8' }).trim()}`;", "input: '', encoding: 'utf8' }).trim()}`;"],
    'a promoted memory restored unasked': ["if (!isShared(dir) && existsSync(join(sharedStore(), file)) && !force) return no(", 'if (false) return no('],
    'history hides a promote': ["const moved = !isShared(dir) && existsSync(join(sharedStore(), file)) ?", 'const moved = false ?'],
    'the wired-twice fix given as the model\'s': ["every hook runs twice. The user's fix: ", 'every hook runs twice. '],
    'a GitHub install named a problem': ["else if (!existsSync(join(LIVE, '.deployed.json')) || (marketplace()?.source !== 'directory' && !deployedCommit(at))) {", 'else if (false) {'],
    'the plugin found only under this repo\'s marketplace': ["find((k) => k.split('@')[0] === 'project-memory')", 'find((k) => k === PLUGIN)'],
    'not wired gives no install': ["The user's fix: claude plugin install ${PLUGIN} (after", "(after"],
    'hits dated by now': ['${local(h.modified).slice(0, 10)}', '${local().slice(0, 10)}'],
    'the --limit hint with nothing left out': ["${all.length > hits.length ? '; --limit N shows more' : ''}", '; --limit N shows more'],
    'the --all hint under --all': ["${rest.includes('--all') ? '' : '; --all searches every project'}", '; --all searches every project'],
    'a negative --limit taken as is': ['all.slice(0, n > 0 ? n : 8)', 'all.slice(0, n || 8)'],
    'history suggests --all under --all': ["${everywhere ? '' : '; --all looks in every project'}", '; --all looks in every project'],
    'history gives no command': ['  a change: git -C', '  git -C'],
    'promote leaves the project line': ['if (home && replaceIfUnchanged(home,', 'if (false && replaceIfUnchanged(home,'],
    'promote shares the handoff': ["if (file.startsWith('MEMORY') || file === 'handoff.md') return no(", 'if (false) return no('],
    'doctor: two wirings read as one': ['if (wired.length && plugin)', 'if (false)'],
    'doctor: half wired reads as wired': ['say(!missing.length,', 'say(true,'],
    'doctor: an orphaned pack index unseen': [".endsWith('.idx') && !packs.includes(", ".endsWith('.never') && !packs.includes("],
  }],
  'wire.mjs': ['wire.test.mjs', {
    'unwire drops a foreign hook': ['.filter((h) => !ours(h))', '.filter(() => false)'],
    'an emptied entry kept': ['.filter((e) => e.hooks.length);', ';'],
    'settings take the checkout\'s entries': ["rewire(settings, LIVE, process.execPath, live)", 'rewire(settings)'],
    'rewire doubles the entries': ['const base = unwire(settings), hooks', 'const base = settings, hooks'],
    'a dry run writes': ['if (dry) process.exit(0);', ''],
    'a failed uninstall puts the entries back': ["if (mode === 'settings' && enabled()) fail(", 'if (false) fail('],
  }],
  'hooks/hooks.json': ['wire.test.mjs', {
    'the plugin starts handoff-log without --print': ['handoff-log.mjs", "--print"]', 'handoff-log.mjs"]'],
    'the plugin forgets the auto compaction gate': ['"matcher": "auto"', '"matcher": "never"'],
    '/clear left out of the matcher': ['"matcher": "startup|clear|compact"', '"matcher": "startup|compact"'],
  }],
  'deploy.mjs': ['handoff-log.test.mjs', {
    'the plugin version not stamped': ["if (patch !== undefined && f === '.claude-plugin/plugin.json') {", 'if (false) {'],
    'the live plugin runs node from PATH': ["if (node && f === 'hooks/hooks.json') {", 'if (false) {'],
    'each copy written in place, its temp left': ['renameSync(join(to, `${f}.tmp`), join(to, f));', 'writeFileSync(join(to, f), readFileSync(join(to, `${f}.tmp`)));'],
    'the manifest hashes nothing': ['files[f] = hash(buf);', ''],
    'deploys from a branch': ["if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'master') fail(", 'if (false) fail('],
    'deploys uncommitted changes': ["if (dirty()) fail('uncommitted changes: commit first');", ''],
    'no stat in the manifest': ['files, stat })', 'files })'],
  }],
};

// Side by side, one per core but one: each mutant has its own folder and HOME,
// and one after another the check took ~15 minutes of a 20-minute deploy.
// `node mutate.mjs <text>` runs only the mutants whose label contains it.
// Every file is read once, here: an edit made while the check runs must not
// reach half the mutants.
const only = process.argv[2];
const tests = [...new Set(Object.values(suites).map(([t]) => t))];
const code = Object.fromEntries([...FILES, ...tests].filter((f) => existsSync(tool(f))).map((f) => [f, readFileSync(tool(f))]));
const jobs = [];
for (const [name, [testName, mutants]] of Object.entries(suites)) {
  for (const [label, [from, to]] of Object.entries(mutants)) if (!only || label.includes(only)) jobs.push({ name, testName, label, from, to });
}
// A suite that fails unmutated kills every mutant, and the check then proves
// nothing: a missing file once passed 132 mutants in 6 seconds.
const run = (testName, name, from, to) => new Promise((done) => {
  const src = name && code[name].toString('utf8');
  if (name && !src.includes(from)) return done('MUTATION DID NOT APPLY');
  const dir = tempDir('mut-');
  for (const [f, buf] of Object.entries(code)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), f === name ? src.replace(from, to) : buf); }
  const child = spawn(process.execPath, [join(dir, testName)], { stdio: 'ignore' });
  // A suite cut off by the clock proved nothing: not a kill.
  let late = false;
  const timer = setTimeout(() => { late = true; child.kill(); }, 120_000);
  // A child a killed suite left behind can still hold the folder: TEMP keeps it.
  child.on('exit', (status) => { clearTimeout(timer); try { rmSync(dir, { recursive: true, force: true }); } catch {} done(late ? 'TIMED OUT' : status === 0 ? 'SURVIVED' : 'killed'); });
});
// Controls run as many at once as the mutants do: a suite that passes alone but
// fails under that load would kill mutants by timing, not by the rule.
const pool = async (items, fn) => {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, worker));
};
const took = {};
await pool([...new Set(jobs.map((j) => j.testName))], async (t) => {
  const t0 = Date.now();
  if (await run(t) !== 'SURVIVED') { console.log(`${t} fails unmutated: fix it before the mutants can say anything`); process.exit(1); }
  took[t] = Date.now() - t0;
});
// Longest suites first, timed by their controls: in file order the last
// handoff-log mutants ran on alone while the other workers sat idle.
jobs.sort((a, b) => took[b.testName] - took[a.testName]);
let survived = 0;
await pool(jobs, async (job) => {
  const verdict = await run(job.testName, job.name, job.from, job.to);
  if (verdict !== 'killed') survived++;
  console.log(`${job.name.padEnd(17)} ${job.label.padEnd(48)} ${verdict}`);
});
console.log(survived ? `${survived} of ${jobs.length} mutant(s) survived` : `all ${jobs.length} mutants killed`);
process.exit(survived ? 1 : 0);
