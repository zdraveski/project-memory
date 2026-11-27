// Self-check for the transcript reading, called in this process on fixture records: the turns read from them equal what
// turns() gave on the same fixtures before the move to transcript.mjs, and each byte reader is cut at its chunk edge.
// (handoff-log.test.mjs holds the rules' long history; this file watches the reading alone.) Run: node transcript.test.mjs
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, openSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.TZ = 'UTC';   // the expected values hold the turns' clock times
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const home = mkdtempSync(join(tmpdir(), 'transcript-'));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// Fixture records, one transcript each. Words nothing else in the suite searches for: "zanzibar", "kumquat".
let seq = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 24, 10, ++seq)).toISOString();
const u = (content, o = {}) => ({ type: 'user', uuid: `u${seq}`, timestamp: stamp(), message: { role: 'user', content }, ...o });
const a = (content, stop_reason = 'end_turn', o = {}) => ({ type: 'assistant', uuid: `a${seq}`, timestamp: stamp(), message: { role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stop_reason }, ...o });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const res = (id, content, is_error) => ({ type: 'tool_result', tool_use_id: id, content, ...(is_error && { is_error: true }) });
const queued = (prompt) => ({ type: 'attachment', uuid: `q${seq}`, timestamp: stamp(), attachment: { type: 'queued_command', prompt } });
const hook = (content) => ({ type: 'attachment', uuid: `h${seq}`, timestamp: stamp(), attachment: { type: 'hook_additional_context', content } });
const txt = (text) => ({ type: 'text', text });

const FIXTURES = {
  // Edits and commands, a failed one, a refused one, an edit that errored, a retry that worked.
  plain: [
    u('add a retry to the zanzibar fetch'),
    a([txt('looking'), use('e1', 'Edit', { file_path: 'src/a.mjs' }), use('b1', 'Bash', { command: 'npm test' })], 'tool_use'),
    u([res('e1', 'ok'), res('b1', '1 failing: kumquat', true)]),
    a([use('e2', 'Write', { file_path: 'src/b.mjs' }), use('e3', 'Edit', { file_path: 'src/c.mjs' }), use('b2', 'Bash', { command: 'npm run lint' }), use('b3', 'Bash', { command: 'npm run lint' })], 'tool_use'),
    u([res('e3', 'not applied', true), res('e2', 'ok'), res('b2', 'boom', true), res('b3', 'clean')]),
    a('Done: the retry is in.'),
    u('and the docs?'),
    a([use('b4', 'Bash', { command: 'git status' })], 'tool_use'),
    u([res('b4', 'The user doesn\'t want to proceed with this tool use. The tool use was rejected', true)], { toolUseResult: 'User rejected tool use' }),
    a('ok, no docs'),
  ],
  // A private ask in four spellings: its answer is not the turn's, and what follows is a new turn.
  private: [
    u('<private>the kumquat key</private> what next?'),
    a('here is a plan that repeats the kumquat key'),
    u('<PRIVATE level="2">upper case'),
    a('reply to the upper case'),
    u('＜private＞fullwidth＜/private＞ hi'),
    a('reply to the fullwidth'),
    u('a plain ask'),
    a('a plain reply'),
    queued('<private k="1">typed meanwhile'),
    a('the reply the queued message gets'),
    u('the next ask'),
    a('the next reply'),
  ],
  // The whole conversation marked; and a mark only quoted by a task's end, which marks nothing.
  session: [
    u('hello'), a('hi'),
    u('<private-session>'), a('ok, private from here'),
  ],
  quoted: [
    u('hello'), a('hi'),
    u('<task-notification>the report quotes <private-session> as text</task-notification>'),
    a('noted'),
  ],
  // forget kept like a private turn; a bare secret typed as the answer; a pick.
  answers: [
    u('please forget the zanzibar thing'),
    a([use('f1', 'Bash', { command: 'node "/p/src/memory.mjs" --session x forget zanzibar' }), txt('removed zanzibar')], 'tool_use'),
    u([res('f1', 'removed')]),
    a('it is gone'),
    u('go on'),
    a('What is the database password?'),
    u('Tr0ub4dor&3'),
    a('thanks'),
    u('one more'),
    a([use('q1', 'AskUserQuestion', { questions: [{ question: 'Which color?' }] })], 'tool_use'),
    u([res('q1', 'answered')], { toolUseResult: { answers: { 'Which color?': 'kumquat orange' } } }),
    a('orange it is'),
  ],
  // The compaction nudge, in both labels: the answer after it is the memory update.
  nudge: [
    u('build it'),
    a('built'),
    hook('[project-memory: compaction gate] save your memory'),
    a('memory updated'),
    u('<task-notification>a task ended</task-notification>'),
    a('after the task'),
    u('second ask'),
    a('second reply'),
    u('[SYSTEM: compaction gate] save again'),
    a('saved again'),
  ],
  // What the harness adds: none of it is an ask.
  harness: [
    u('subagent says <private-session>', { isSidechain: true }),
    u('<system-reminder>hook said</system-reminder>real words here'),
    a([use('e1', 'Edit', { file_path: 'src/d.mjs' })], 'tool_use'),
    { type: 'assistant', uuid: 'syn', timestamp: stamp(), message: { role: 'assistant', model: '<synthetic>', content: [txt('API Error: kumquat')], stop_reason: 'stop_sequence' } },
    u('[Request interrupted by user]'),
    u('Base directory for this skill: /s\nit says <private> in its own text', { isMeta: true }),
    a('a reply after a skill body'),
    u('<command-name>/memory</command-name><command-args>search zanzibar</command-args>'),
    a('searched'),
    u([{ type: 'image', source: { type: 'base64', data: 'AAAA' } }]),
    a('an image seen'),
    u('This session is being continued from a previous conversation: <private>', { isCompactSummary: true }),
    a('after the summary'),
    u('<ide_opened_file>x.js</ide_opened_file> what is in it?'),
    a('a function'),
  ],
};

const jsonl = (recs) => `${recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
// Lines a reader must pass over: not JSON, a type nothing reads, a line cut by the tail.
const NOISE = ['{"type":"api-request-blob","x":"' + 'z'.repeat(50) + '"}', 'not json', '{"type":"user","message":'];

// What turns() gave on these fixtures before the move (captured from master at dafebae, TZ=UTC).
const EXPECTED = {
 "plain": {
  "turns": [
   {
    "at": "2026-11-24 10:01",
    "ms": 1795514460000,
    "ask": "add a retry to the zanzibar fetch",
    "raw": "add a retry to the zanzibar fetch",
    "queued": false,
    "did": "Done: the retry is in.",
    "changed": [
     "src/a.mjs",
     "src/b.mjs"
    ],
    "ran": [
     "npm test → failed: 1 failing: kumquat",
     "npm run lint",
     "npm run lint"
    ],
    "base": [
     "npm test",
     "npm run lint",
     "npm run lint"
    ],
    "ids": [
     "b1",
     "b2",
     "b3"
    ],
    "edits": [
     [
      "e1",
      "src/a.mjs"
     ],
     [
      "e2",
      "src/b.mjs"
     ]
    ],
    "said": "looking\n\n⁣Done: the retry is in.",
    "picked": [],
    "id": "u0",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:07",
    "ms": 1795514820000,
    "ask": "and the docs?",
    "raw": "and the docs?",
    "queued": false,
    "did": "ok, no docs",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "ok, no docs",
    "picked": [],
    "id": "u6",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 10:07",
   "ms": 1795514820000,
   "ask": "and the docs?",
   "raw": "and the docs?",
   "queued": false,
   "did": "ok, no docs",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "ok, no docs",
   "picked": [],
   "id": "u6",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u0",
   "u6"
  ],
  "hush": false
 },
 "private": {
  "turns": [
   {
    "at": "2026-11-24 10:11",
    "ms": 1795515060000,
    "ask": "<private>the kumquat key</private> what next?",
    "raw": "<private>the kumquat key</private> what next?",
    "queued": false,
    "did": "here is a plan that repeats the kumquat key",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "here is a plan that repeats the kumquat key",
    "picked": [],
    "id": "u10",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:13",
    "ms": 1795515180000,
    "ask": "<PRIVATE level=\"2\">upper case",
    "raw": "<PRIVATE level=\"2\">upper case",
    "queued": false,
    "did": "reply to the upper case",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "reply to the upper case",
    "picked": [],
    "id": "u12",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:15",
    "ms": 1795515300000,
    "ask": "<private>fullwidth</private> hi",
    "raw": "<private>fullwidth</private> hi",
    "queued": false,
    "did": "reply to the fullwidth",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "reply to the fullwidth",
    "picked": [],
    "id": "u14",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:17",
    "ms": 1795515420000,
    "ask": "a plain ask",
    "raw": "a plain ask",
    "queued": false,
    "did": "a plain reply",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "a plain reply",
    "picked": [],
    "id": "u16",
    "branch": "",
    "cwd": "",
    "reopened": false,
    "frozen": true
   },
   {
    "at": "2026-11-24 10:21",
    "ms": 1795515660000,
    "ask": "the next ask",
    "raw": "the next ask",
    "queued": false,
    "did": "the next reply",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "the next reply",
    "picked": [],
    "id": "u20",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 10:21",
   "ms": 1795515660000,
   "ask": "the next ask",
   "raw": "the next ask",
   "queued": false,
   "did": "the next reply",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "the next reply",
   "picked": [],
   "id": "u20",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u10",
   "u12",
   "u14",
   "u16",
   "u20"
  ],
  "hush": false
 },
 "session": {
  "turns": [
   {
    "at": "2026-11-24 10:23",
    "ms": 1795515780000,
    "ask": "hello",
    "raw": "hello",
    "queued": false,
    "did": "hi",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "hi",
    "picked": [],
    "id": "u22",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:25",
    "ms": 1795515900000,
    "ask": "<private-session>",
    "raw": "<private-session>",
    "queued": false,
    "did": "ok, private from here",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "ok, private from here",
    "picked": [],
    "id": "u24",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 10:25",
   "ms": 1795515900000,
   "ask": "<private-session>",
   "raw": "<private-session>",
   "queued": false,
   "did": "ok, private from here",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "ok, private from here",
   "picked": [],
   "id": "u24",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u22",
   "u24"
  ],
  "hush": true
 },
 "quoted": {
  "turns": [
   {
    "at": "2026-11-24 10:27",
    "ms": 1795516020000,
    "ask": "hello",
    "raw": "hello",
    "queued": false,
    "did": "noted",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "hi\n\n⁣noted",
    "picked": [],
    "id": "u26",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 10:27",
   "ms": 1795516020000,
   "ask": "hello",
   "raw": "hello",
   "queued": false,
   "did": "noted",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "hi\n\n⁣noted",
   "picked": [],
   "id": "u26",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u26"
  ],
  "hush": false
 },
 "answers": {
  "turns": [
   {
    "at": "2026-11-24 10:31",
    "ms": 1795516260000,
    "ask": "please forget the zanzibar thing",
    "raw": "please forget the zanzibar thing",
    "queued": false,
    "did": "it is gone",
    "changed": [],
    "ran": [
     "node \"/p/src/memory.mjs\" --session x forget zanzibar"
    ],
    "base": [
     "node \"/p/src/memory.mjs\" --session x forget zanzibar"
    ],
    "ids": [
     "f1"
    ],
    "edits": [],
    "said": "removed zanzibar\n\n⁣it is gone",
    "picked": [],
    "id": "u30",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:35",
    "ms": 1795516500000,
    "ask": "go on",
    "raw": "go on",
    "queued": false,
    "did": "What is the database password?",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "What is the database password?",
    "picked": [],
    "id": "u34",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:37",
    "ms": 1795516620000,
    "ask": "[redacted]",
    "raw": "Tr0ub4dor&3",
    "queued": false,
    "did": "thanks",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "thanks",
    "picked": [],
    "id": "u36",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 10:39",
    "ms": 1795516740000,
    "ask": "one more",
    "raw": "one more",
    "queued": false,
    "did": "orange it is",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "orange it is",
    "picked": [
     "kumquat orange"
    ],
    "id": "u38",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 10:39",
   "ms": 1795516740000,
   "ask": "one more",
   "raw": "one more",
   "queued": false,
   "did": "orange it is",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "orange it is",
   "picked": [
    "kumquat orange"
   ],
   "id": "u38",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u30",
   "u34",
   "u36",
   "u38"
  ],
  "hush": false
 },
 "nudge": {
  "turns": [
   {
    "at": "2026-11-24 10:43",
    "ms": 1795516980000,
    "ask": "build it",
    "raw": "build it",
    "queued": false,
    "did": "after the task",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "built\n\n⁣after the task",
    "picked": [],
    "id": "u42",
    "branch": "",
    "cwd": "",
    "reopened": false,
    "frozen": false,
    "ended": true
   },
   {
    "at": "2026-11-24 10:49",
    "ms": 1795517340000,
    "ask": "second ask",
    "raw": "second ask",
    "queued": false,
    "did": "second reply",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "second reply",
    "picked": [],
    "id": "u48",
    "branch": "",
    "cwd": "",
    "reopened": false,
    "frozen": "nudge",
    "ended": true
   }
  ],
  "open": {
   "at": "2026-11-24 10:49",
   "ms": 1795517340000,
   "ask": "second ask",
   "raw": "second ask",
   "queued": false,
   "did": "second reply",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "second reply",
   "picked": [],
   "id": "u48",
   "branch": "",
   "cwd": "",
   "reopened": false,
   "frozen": "nudge",
   "ended": true
  },
  "opened": [
   "u42",
   "u48"
  ],
  "hush": false
 },
 "harness": {
  "turns": [
   {
    "at": "2026-11-24 10:54",
    "ms": 1795517640000,
    "ask": "real words here",
    "raw": "real words here",
    "queued": false,
    "did": "a reply after a skill body",
    "changed": [
     "src/d.mjs"
    ],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [
     [
      "e1",
      "src/d.mjs"
     ]
    ],
    "said": "a reply after a skill body",
    "picked": [],
    "id": "u53",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 11:00",
    "ms": 1795518000000,
    "ask": "/memory search zanzibar",
    "raw": "<command-name>/memory</command-name><command-args>search zanzibar</command-args>",
    "queued": false,
    "did": "searched",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "searched",
    "picked": [],
    "id": "u59",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 11:02",
    "ms": 1795518120000,
    "ask": "[image]",
    "raw": "",
    "queued": false,
    "did": "after the summary",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "an image seen\n\n⁣after the summary",
    "picked": [],
    "id": "u61",
    "branch": "",
    "cwd": "",
    "reopened": false
   },
   {
    "at": "2026-11-24 11:06",
    "ms": 1795518360000,
    "ask": "what is in it?",
    "raw": "<ide_opened_file>x.js</ide_opened_file> what is in it?",
    "queued": false,
    "did": "a function",
    "changed": [],
    "ran": [],
    "base": [],
    "ids": [],
    "edits": [],
    "said": "a function",
    "picked": [],
    "id": "u65",
    "branch": "",
    "cwd": "",
    "reopened": false
   }
  ],
  "open": {
   "at": "2026-11-24 11:06",
   "ms": 1795518360000,
   "ask": "what is in it?",
   "raw": "<ide_opened_file>x.js</ide_opened_file> what is in it?",
   "queued": false,
   "did": "a function",
   "changed": [],
   "ran": [],
   "base": [],
   "ids": [],
   "edits": [],
   "said": "a function",
   "picked": [],
   "id": "u65",
   "branch": "",
   "cwd": "",
   "reopened": false
  },
  "opened": [
   "u53",
   "u59",
   "u61",
   "u65"
  ],
  "hush": false
 }
}
;

// The code under test, from where it is.
const { turns, readTail, promptBefore, chunk, past, records } = await import('../src/transcript.mjs');

// A record a crash cut mid-write, and the next record appended onto the same line: the whole one is still read, and only
// the cut one is lost. Skipping the line lost the prompt after it, and its reply was filed under the ask before (1.6.1).
{
  const cut = JSON.stringify(a('half a reply about the zanzibar')).slice(0, 70);
  const text = [JSON.stringify(u('first ask')), cut + JSON.stringify(u('second ask kumquat')), JSON.stringify(a('second reply'))].join('\n');
  for (const types of [null, ['user', 'assistant']]) {
    const said = [...records(text, { types })].map((r) => JSON.stringify(r.message.content));
    ok(said.length === 3 && /second ask kumquat/.test(said[1]), `the record after a cut one on the same line is read (got ${said})`);
  }
  const all = turns(text), got = [...all, all.open].filter(Boolean).map((t) => [t.ask, t.did]);
  ok(got.some(([q, d]) => q === 'second ask kumquat' && d === 'second reply') && !got.some(([q, d]) => q === 'first ask' && d === 'second reply'), `and its reply is filed under it (got ${JSON.stringify(got)})`);
  // A whole record of a type not asked for is left out (and not parsed).
  {
    // Not parsed: such records can be megabytes (api-request-blob). Counted on JSON.parse itself.
    const parse = JSON.parse; let calls = 0; JSON.parse = (...x) => (calls++, parse(...x));
    try { [...records([JSON.stringify({ type: 'api-request', body: 'x' }), JSON.stringify(u('a counted ask'))].join('\n'), { types: ['user'] })]; } finally { JSON.parse = parse; }
    ok(calls === 1, `a record of a type not asked for is not parsed (${calls} parses for 2 lines)`);
  }
  ok([...records([JSON.stringify({ type: 'api-request', body: 'x' }), JSON.stringify(u('fourth ask'))].join('\n'), { types: ['user'] })].map((r) => r.type).join() === 'user', 'a record of a type not asked for is left out');
  // The likeliest cut: a big record of a type nothing reads (api-request), with the next prompt glued on.
  const big = '{"type":"api-request","body":"' + 'x'.repeat(200);
  const t2 = [JSON.stringify(u('first ask')), big + JSON.stringify(u('third ask quince'))].join('\n');
  ok([...records(t2, { types: ['user', 'assistant', 'attachment'] })].some((r) => /third ask quince/.test(JSON.stringify(r.message.content))), 'a prompt glued onto a cut record of an unread type is read');
  // A cut record holding thousands of objects: the glued prompt after it is still found (starts are tried from the right).
  const t3 = '{"type":"api-request","b":[' + '{"a":1,'.repeat(5000) + JSON.stringify(u('fifth ask after a big cut'));
  ok([...records(t3, { types: ['user'] })].some((r) => /fifth ask/.test(JSON.stringify(r.message.content))), 'a prompt glued after a cut record of 5000 objects is read');
  // A cut after the first byte: the glued record starts at index 1.
  ok([...records('{' + JSON.stringify(u('ask after a 1-byte cut')), { types: ['user'] })].length === 1, 'a prompt glued after a 1-byte cut is read');
  // A whole record of an unread type that nests a read one is still left out.
  ok([...records(JSON.stringify({ type: 'api-request-blob', data: { messages: [{ type: 'user', content: 'nested' }] } }), { types: ['user'] })].length === 0, 'a whole unread record that nests a read type is left out');
  // A cut line of many small objects stops trying after a bounded number of starts, so every later read stays cheap.
  const many = '{"a":[' + '{"b":1},'.repeat(200_000);
  // Counted, not timed: a busy CI machine took 698 ms where this one takes 30.
  const parse = JSON.parse; let calls = 0; JSON.parse = (...x) => (calls++, parse(...x));
  try { [...records(many)]; } finally { JSON.parse = parse; }
  ok(calls <= 1001, `a cut line of 200,000 objects is given up after 1000 starts (${calls} parses)`);
}

// turns(): each fixture, behind a line the tail cut through, a type nothing reads, a line that is no JSON, and a last line cut.
const flat = (t) => ({ ...t, edits: [...t.edits] });
const shape = (all) => ({ turns: [...all].map(flat), open: all.open ? flat(all.open) : null, opened: all.opened.map((t) => t.id), hush: all.hush ?? false });
for (const [name, recs] of Object.entries(FIXTURES)) {
  const text = `cut mid line"}\n${NOISE[0]}\n${NOISE[1]}\n${jsonl(recs)}${NOISE[2]}\n`;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(shape(turns(text)))), EXPECTED[name], `the turns of the ${name} fixture`);
  checks++;
}

// readTail: the last bytes, and whether they are the whole file.
{
  const f = join(home, 'rt.jsonl');
  writeFileSync(f, 'aaaa\nbbbb\ncccc\n');
  let r = readTail(f, 15);
  ok(r.text === 'aaaa\nbbbb\ncccc\n' && r.whole === true, 'a tail as long as the file is the whole file');
  r = readTail(f, 10);
  ok(r.text === 'bbbb\ncccc\n' && r.whole === false, 'a shorter tail starts where the bytes do, mid-line if need be');
  r = readTail(f, 7);
  ok(r.text === 'b\ncccc\n' && r.whole === false, 'a tail may start inside a line');
  r = readTail(f, Infinity);
  ok(r.text === 'aaaa\nbbbb\ncccc\n' && r.whole === true, 'an endless tail is the whole file');
  writeFileSync(f, '');
  ok(readTail(f, 10).whole === true, 'an empty file is whole');
}

// chunk and past: the whole lines in a segment of bytes; a line longer than the segment is passed over, and a line
// that fills it exactly is not.
{
  const g = join(home, 'chunk.jsonl'), lines = ['a'.repeat(9), 'b'.repeat(9), 'c'.repeat(299), 'd'.repeat(9)];
  writeFileSync(g, `${lines.join('\n')}\n`);
  const size = statSync(g).size;
  const read = (seg, file = g, to = size) => {
    const fd = openSync(file, 'r'), got = [];
    try { for (let pos = 0, b; (b = chunk(fd, pos, seg, to)); pos = b.pos + b.buf.length) got.push(...b.buf.toString().split('\n').filter(Boolean)); } finally { closeSync(fd); }
    return got;
  };
  ok(size === 330, 'the fixture is 330 bytes');
  ok(same(read(1000), lines), 'a segment past the file reads every line');
  ok(same(read(300), lines), 'a segment that a line fills exactly reads it');
  ok(same(read(299), [lines[0], lines[1], lines[3]]), 'a segment one byte short of a line passes it over, unread');
  ok(same(read(20), [lines[0], lines[1], lines[3]]), 'a segment of exactly two lines reads them, and passes the long one');
  ok(same(read(19), [lines[0], lines[1], lines[3]]) && same(read(21), [lines[0], lines[1], lines[3]]), 'a segment one byte either side of a line edge cuts at the line before');
  const h = join(home, 'chunk2.jsonl');
  writeFileSync(h, 'x\nlast with no newline');
  ok(same(read(1000, h, statSync(h).size), ['x', 'last with no newline']), 'a last line with no line break is read whole');
  const fd = openSync(g, 'r');
  try {
    ok(past(fd, 5, size) === 10 && past(fd, 9, size) === 10 && past(fd, 10, size) === 20, 'past a line: the byte after its line break, a break itself included');
    ok(past(fd, size, size) === size && past(fd, size - 1, size) === size, 'past the last line: the end');
  } finally { closeSync(fd); }
  // A line that runs over several 1 MB reads: its break is found, never decoded.
  const w = join(home, 'wide.jsonl');
  writeFileSync(w, `${'x'.repeat(2_500_000)}\ny\n`);
  const fw = openSync(w, 'r');
  try { ok(past(fw, 0, statSync(w).size) === 2_500_001, 'a break more than two reads away is found'); } finally { closeSync(fw); }
  writeFileSync(w, 'x'.repeat(2_500_000));
  const fv = openSync(w, 'r');
  try { ok(past(fv, 0, 2_500_000) === 2_500_000, 'a line with no break runs to the end'); } finally { closeSync(fv); }
}

// typedMark and markFrom: the one reading of a typed <private-session> mark (the git-rule hook, the compaction gate, the journal).
{
  const { typedMark, markFrom } = await import('../src/transcript.mjs');
  const P = '<private-session>', f = join(home, 'mark.jsonl'), line = (r) => (typeof r === 'string' ? r : JSON.stringify(r));
  const put = (recs, nl = '\n') => { writeFileSync(f, recs.map(line).join(nl) + nl); return f; };
  const ask = a([use('k1', 'AskUserQuestion', { questions: [{ question: 'Which color?' }] })], 'tool_use');
  const answer = u([res('k1', 'answered')], { toolUseResult: { answers: { 'Which color?': `red ${P}` } } });
  for (const [recs, want, why] of [
    [[u('hi'), a('hello')], false, 'no mark'],
    [[u(`go on ${P}`), a('ok')], true, 'a typed mark'],
    [[u([txt('x'), txt('＜private-session＞')])], true, 'a full-width mark in a text block'],
    [[u('<private​-session>')], true, 'a mark with a hidden character'],
    [[u('work'), a('working', 'tool_use'), queued(`and ${P}`)], true, 'a mark queued while Claude worked'],
    [[u('pick one'), ask, answer], true, "a mark in the answer to Claude's question"],
    [[u([res('t1', `the log says ${P}`)])], false, "a tool's output that quotes it"],
    [[u(`<task-notification>agent said ${P}</task-notification>`)], false, 'a mark only quoted by the harness'],
    [[u(`Summary: the user typed ${P}`, { isCompactSummary: true })], false, 'a compaction summary that names it'],
    [[u(`x ${P}`, { isSidechain: true })], false, "a helper's record"],
    [[a(P)], false, "Claude's own words"],
    [[`${P} not json`, u('hi')], false, 'a line that is no JSON'],
  ]) ok(typedMark(put(recs)) === want, `typedMark: ${why} (${want})`);
  ok(typedMark(put([u('hi'), u(`x ${P}`)], '\r\n')) === true, 'CRLF line ends');
  ok(typedMark(join(home, 'gone.jsonl')) === true, 'an unreadable transcript counts as marked');
  // In pieces: a line cut by a piece, a multi-byte character cut by one, a line many pieces long, and a last line without a newline.
  writeFileSync(f, `${line(u('hi'))}\n${line(u(`${'é'.repeat(40)} ＜private-session＞`))}`);
  ok(typedMark(f, 7) === true, 'pieces of 7 bytes: a long last line with no newline, a character cut by a piece');
  put([a(P), 'y'.repeat(40), u('fine')]);
  ok(typedMark(f, 7) === false, 'pieces of 7 bytes, no typed mark');
  // The known hole (markFrom's shortcut): an answer whose question was read in an earlier piece is not read as typed.
  const pick = u('pick one'), upTo = Buffer.byteLength(`${line(pick)}\n${line(ask)}\n`);
  put([pick, ask, answer]);
  ok(typedMark(f, upTo) === false && typedMark(f) === true, 'question and answer in two pieces: missed; in one: found');
  // The look, resumed: `more()` stops it after a piece, at a line's start, and the next look from there finds the mark.
  const one = u('one');
  put([one, u('two'), u(`three ${P}`)]);
  const fd = openSync(f, 'r'), size = statSync(f).size;
  try {
    const first = markFrom(fd, 0, 10, size, () => false);
    ok(!first.hit && first.pos === Buffer.byteLength(line(one)) + 1, `stopped by more() at a line's start (got ${JSON.stringify(first)})`);
    ok(markFrom(fd, first.pos, 10, size).hit === true, 'the next look goes on from there and finds the mark');
    ok(same(markFrom(fd, size, 10, size), { hit: false, pos: size }), 'nothing left to look at: no mark, at the end');
  } finally { closeSync(fd); }
}

// 1.6.6 item 41: a prompt line longer than the 64 KB peek, cut through by the tail, is the prompt before it, not an earlier one.
{
  const { promptBefore } = await import('../src/transcript.mjs');
  const f = join(home, 'longprompt.jsonl'), long = JSON.stringify(u(`wombat ${'x'.repeat(150000)}`)), rest = JSON.stringify(a('answer'));
  writeFileSync(f, [JSON.stringify(u('earlier ask')), long, rest].join('\n') + '\n');
  const got = promptBefore(f, Buffer.byteLength(rest) + 1 + 90000);   // the tail starts 90 KB before the end of the long line
  ok(got === long, `a prompt line longer than 64 KB, cut by the tail, is returned whole (got ${got?.slice(0, 60)})`);
}

rmSync(home, { recursive: true, force: true });
console.log(`transcript.test.mjs: ${checks} checks passed`);
