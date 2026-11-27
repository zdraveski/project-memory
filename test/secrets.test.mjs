// Self-check for secrets.mjs, the secret detector: redact, holdsSecret and BARE, called in this process on fixtures.
// (handoff-log.test.mjs still holds most of the rules' long corpus; this file watches the module alone.) Run: node secrets.test.mjs
import assert from 'node:assert';
import { redact, holdsSecret, BARE } from '../src/secrets.mjs';

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
// Built from parts: no whole token sits in this file.
const GH = ['gh', 'p_', 'Zq8Xk2Lm4Nv6Bt1Rw3Ys5Df7Gh9Jk0Pa2Cd4'].join('');

// What redact() keeps and what it hides, one line each, picked so that every change to a rule's guards (a call or a path that is
// no secret, a word that is no password, the JSON "password" rule, the self./this. prefix, a cookie, a hash) alters one of them.
// The first of each pair is the text, the second what is stored.
{
  const cases = [
    ["export DB_PASSWORD={{secret}}", "export DB_PASSWORD={[redacted]"],
    ["pw is Foo::bar(12)", "pw is Foo::bar(12)"],
    ["xself.apiKey = \"Secret\"", "xself.apiKey = \"Secret\""],
    ["'KEY_FILE_X' => 'Password'", "'KEY_FILE_X' => '[redacted]'"],
    ["{name: 'api_key', value: 'foo.apiKey'}", "{name: 'api_key', value: 'foo.apiKey'}"],
    ["- name: AUTH\n  value: jwt.sign(payload", "- name: AUTH\n  value: jwt.sign(payload"],
    ["'api_key' => 'https://example.com/a'", "'api_key' => 'https://example.com/a'"],
    ["ALL PASS = correct horse battery staple", "ALL PASS = correct horse battery staple"],
    ["PASS !vault", "PASS !vault"],
    ["Cookie: x=abcdefgh1234; Domain=a.b", "Cookie: [redacted]"],
    ["pw is Optional", "pw is [redacted]"],
    ["\"tokens\": {\"db\": \"hello1\"}", "\"tokens\": {\"db\": \"hello1\"}"],
    ["putenv(\"TOKEN_LIMIT\", \"100\")", "putenv(\"TOKEN_LIMIT\", \"100\")"],
    ["{\"name\":\"password\",\"value\":\"foo(12)\"}", "{\"name\":\"password\",\"value\":\"[redacted]\"}"],
    ["&quot;password&quot;: &quot;hunter22xyz&quot; &#31;", "\"password\": \"[redacted]\" &#31;"],
    ["AUTH=100", "AUTH=[redacted]"],
    ["New value: the", "New value: the"],
    ["pass: scanning", "pass: [redacted]"],
    ["Cookie: a=hello1", "Cookie: a=hello1"],
    ["Fernet(\"Optional\")", "Fernet(\"Optional\")"],
    ["echo true | kinit bob", "echo true | kinit bob"],
    ["password for bob: !vault", "password for bob: !vault"],
    ["\"tokens\": {\"db\": \"abcdefgh12345678\"}", "\"tokens\": {\"db\": \"[redacted]\"}"],
    ["tokens:\n  db: secrets.token_hex(16)\n  admin: secrets.token_hex(16)", "tokens:\n  db: secrets.token_hex(16)\n  admin: secrets.token_hex(16)"],
    ["psk=the", "psk=[redacted]"],
    ["creds=!vault", "creds=!vault"],
    ["\"pwd\": \"ab1\"", "\"pwd\": \"[redacted]\""],
    ["PASS foo(12)", "PASS [redacted]"],
    ["psql <<< true", "psql <<< true"],
    ["\"pwd\": \"nil;\"", "\"pwd\": \"nil;\""],
    [" send \"true\\n\"", " send \"true\\n\""],
    ["setx API_KEY is", "setx API_KEY [redacted]"],
    ["user=bob:~pw1234", "user=bob:~pw1234"],
    ["a:5432:b:c:dd:ee", "a:5432:b:c:[redacted]"],
    ["pass: scanning the", "pass: scanning the"],
    ["a:5432:b:c:dd:ee:ff", "a:5432:b:c:dd:ee:ff"],
    ["mysql -u root -p\nhello", "mysql -u root -p\nhello"],
    ["- name: AUTH\n  value: is", "- name: AUTH\n  value: [redacted]"],
    ["\"password\": \"Mypassword\"", "\"password\": \"[redacted]\""],
    ["export SECRET_NAME=my-app-secret", "export SECRET_NAME=my-app-secret"],
    ["secret A8Q4E9U5J1Y6N2C7S3G8W4L9A5Q1E6U2J7Y3N8C4", "secret A8Q4E9U5J1Y6N2C7S3G8W4L9A5Q1E6U2J7Y3N8C4"],
    ["KA8Q4E9U5J1Y6N2C7S3G8W4L9A5Q1E6U2J7Y3N8C4S9G5W1L6A2", "KA8Q4E9U5J1Y6N2C7S3G8W4L9A5Q1E6U2J7Y3N8C4S9G5W1L6A2"],
    ["password(\"secrets.token_hex(1111111111111111111111111111111111111111111111111111111111111)\")", "password(\"secrets.token_hex(1111111111111111111111111111111111111111111111111111111111111)\")"],
    ["psk=/add", "psk=/add"],
    ["PW !vault", "PW !vault"],
    ["\"pwd\": \"ab\"", "\"pwd\": \"ab\""],
    ["--token ../x/y", "--token ../x/y"],
    ["{\"pass\": \"key\"}", "{\"pass\": \"key\"}"],
    ["doctl -t ../x/y", "doctl -t ../x/y"],
    ["and pass !vault", "and pass !vault"],
    ["net user bob the", "net user bob the"],
    ["a1 LOGIN bob the", "a1 LOGIN bob the"],
    ["creds: ./pw1.txt", "creds: ./pw1.txt"],
    ["1> AUTH $(cat p1)", "1> AUTH [redacted]"],
    ["login: bob:~/pw12", "login: bob:~/pw12"],
    [".setSecret(\"true\")", ".setSecret(\"true\")"],
    ["$password = !vault", "$password = !vault"],
    ["pw is Your password", "pw is Your password"],
    ["mot de passe !vault", "mot de passe !vault"],
    ["identified by !vault", "identified by !vault"],
    ["password = N'!vault'", "password = N'!vault'"],
    ["this.password = secret", "this.password = secret"],
    ["printf true | chpasswd", "printf [redacted] | chpasswd"],
    ["auth = (\"u\", \"!vault\")", "auth = (\"u\", \"!vault\")"],
    ["password for bob: a1!b", "password for bob: [redacted]"],
    ["putenv(\"API_KEY\", \"is\")", "putenv(\"API_KEY\", \"[redacted]\")"],
    ["redis-cli AUTH $(cat p1)", "redis-cli AUTH [redacted]"],
    ["backup keys are ab and 99", "backup keys are ab and 99"],
    ["$1$aaaaaaaaaa$bbbbbbbbbbb", "[redacted]"],
    ["<password>!vault</password>", "<password>!vault</password>"],
    ["password is the horse battery", "password is the horse battery"],
    ["changeUserPassword(\"u\", \"!vault\")", "changeUserPassword(\"u\", \"!vault\")"],
    ["&#112;assword: hunter22xyz &#127;", "password: [redacted] &#127;"],
    ["mysqli_connect(\"h\", \"u\", \"!vault\")", "mysqli_connect(\"h\", \"u\", \"!vault\")"],
    ["getpass.getpass = lambda x: \"!vault\"", "getpass.getpass = lambda x: \"!vault\""],
    ["secrets:\n  db: hello1\n  admin: hello1", "secrets:\n  db: [redacted]\n  admin: [redacted]"],
    ["bundle config gems.corp.com {{secret}}", "bundle config gems.corp.com {{secret}}"],
    ["secret ABCDEF0123456789ABCDEF0123456789", "secret [redacted]"],
    // 1.5.3: six rules the handoff-log suite alone watched, each leaked or mangled under its mutant.
    ["x <private hunter2", "x [private]"],
    ["<private", "[private]"],
    ["Bearer\u00adabcdefghijklmnopqrstuvwxyzabcdef", "Bearer [redacted]"],
    ["deploy --token \"-Zq99x PlmN0aQ\" go", "deploy --token \"[redacted]\" go"],
    ["htpasswd -nb admin > .htpasswd", "htpasswd -nb admin > .htpasswd"],
    ["htpasswd -nb admin 2>/dev/null", "htpasswd -nb admin 2>/dev/null"],
    ["true&&STRIPE_KEY=rk9abcdefghij", "true&&STRIPE_KEY=[redacted]"],
    ["6379> AUTH Zq99xPlmN0aQ ./check.sh", "6379> AUTH [redacted]"],
    // 1.6.1: two fuzz leaks (a markdown line break before a YAML block, sshpass glued to a word), then seven false alarms from real notes.
    ["the logo \\\ntokens:\n  github: J4srMH9bHwtqKj3MYC6Eg4qo", "the logo \\\ntokens:\n  github: [redacted]"],
    ["okplantestssshpass -p Z58Oxw0sAG9lmQ ssh host key", "okplantestssshpass -p [redacted] ssh host key"],
    ["contrast of 1.85:1 (`office.css:309`, opacity .35).", "contrast of 1.85:1 (`office.css:309`, opacity .35)."],
    ["A 2.24.82.159 + AAAA 2a02:4780:75:aec3::1) is served", "A 2.24.82.159 + AAAA 2a02:4780:75:aec3::1) is served"],
    ["`2a02:4780:75:aec3::1`, created 2026-08-11.", "`2a02:4780:75:aec3::1`, created 2026-08-11."],
    ["`2a02:4780:75:aec3::/64` host 1", "`2a02:4780:75:aec3::/64` host 1"],
    ["E2E verification PASS (2026-07-16, later session): headless", "E2E verification PASS (2026-07-16, later session): headless"],
    ["created-tokens (incl. per-token is_open/liquidity_less_4k/logo", "created-tokens (incl. per-token is_open/liquidity_less_4k/logo"],
    // ...but a token after any other hyphen is one (review of 1.6.1).
    ["use the access-token abcd1234efgh5678ijkl9012 for it", "use the access-token [redacted] for it"],
    ["X-Vault-Token s.Zx9yW8vU7tS6rQ5pO4nM3lK2", "X-Vault-Token [redacted]"],
    ['curl -H "X-Auth-Token abcd1234efgh5678ijkl9012"', 'curl -H "X-Auth-Token [redacted]"'],
    ["vhost, the password was replaced, and only then", "vhost, the password was replaced, and only then"],
    ["It signs the login tokens: restore", "It signs the login tokens: restore"],
    // "log in <path>" is prose, not a login (bug list item 10).
    ["log in `reports/RESUME-1.6.0.md` \"1.5.4 build log\".", "log in `reports/RESUME-1.6.0.md` \"1.5.4 build log\"."],
    ["the build log in `reports/RESUME-1.6.0.md` says", "the build log in `reports/RESUME-1.6.0.md` says"],
    ["login bob/Sunny2day!x", "login bob/[redacted]"],
    ["Also from that pass: `CORE_JS_BUDGET` (16 KB)", "Also from that pass: `CORE_JS_BUDGET` (16 KB)"],
  ];
  for (const [text, stored] of cases) { const got = redact(text); ok(got === stored, `redact(${JSON.stringify(text)}) is ${JSON.stringify(stored)} (got ${JSON.stringify(got)})`); }
  // holdsSecret: a <private> span with anything real in it (a text, a number), and not one that holds nothing or only a word for one.
  const holds = [
    ['<private>' + ' '.repeat(39) + 'x</private>', true],   // a span of 40 characters is too long to be a placeholder
    ['<private>' + ' '.repeat(38) + 'x</private>', false],
    ["<private>`</private>`", true],
    ["<private>…</private>", false],
    ["<private>yy</private>", true],
  ];
  for (const [text, held] of holds) ok(holdsSecret(text) === held, `holdsSecret(${JSON.stringify(text)}) is ${held}`);
}

// 1.5.1 PR 10: redact remembers a text of 64 characters or more by its exact text; the count of regexp replaces shows it.
{
  const sym = Symbol.replace, orig = RegExp.prototype[sym];
  const count = (f) => { let n = 0; RegExp.prototype[sym] = function (...a) { n++; return orig.apply(this, a); }; try { f(); } finally { RegExp.prototype[sym] = orig; } return n; };
  const long = `note one ${GH} then ${'plain words '.repeat(8)}`, short = `short ${GH}`;
  let first; const a = count(() => { first = redact(long); });
  let again; const b = count(() => { again = redact(long); });
  ok(a > 0 && b === 0 && again === first && !first.includes(GH), `a repeated text of 64 or more is redacted once (${a} replaces, then ${b})`);
  redact(short); ok(count(() => redact(short)) > 0 && !redact(short).includes(GH), 'a short text is not remembered');
  // Cleared once it holds 8 MB: nine 1 MB texts, then the first costs replaces again and the last none.
  const mb = (i) => `${i} ${'abcdefg '.repeat(131072)}`;
  for (let i = 0; i < 9; i++) redact(mb(i));
  ok(count(() => redact(mb(8))) === 0 && count(() => redact(mb(0))) > 0, 'the memory is cleared at 8 MB');
}

// The memo of redact(): a text of 64 characters or more is kept by its exact text, and all of them are let go once the texts
// kept pass 8,000,000 characters. Seen by what a kept text does not do: work out its fold a second time.
{
  const m = await import('../src/secrets.mjs?memo'), norm = String.prototype.normalize;
  let runs = 0;
  String.prototype.normalize = function (...x) { runs++; return norm.apply(this, x); };
  const ran = (text) => { const was = runs; m.redact(text); return runs > was; };
  try {
    const d64 = 'd'.repeat(64), w1 = 'w'.repeat(100), big = 'a'.repeat(4_000_000), rest = 'b'.repeat(8_000_000 - 64 - 100 - 4_000_000);
    ok(ran('c'.repeat(63)) && ran('c'.repeat(63)), 'a text of 63 characters is worked out each time');
    ok(ran(d64) && !ran(d64), 'one of 64 characters is kept');
    ok(ran(w1) && ran(big) && ran(rest), 'texts not seen are worked out');
    ok(!ran(w1) && !ran(d64), 'with exactly 8,000,000 characters kept, none is let go');
    ok(ran('e'.repeat(64)), 'a text not seen is worked out');
    ok(ran(w1) && ran(d64), 'one character more, and all the kept are let go');
  } finally { String.prototype.normalize = norm; }
}

// BARE: a typed answer that is a secret by the question it answers, not by a keyword of its own.
{
  const asked = 'What is the password?';
  ok(BARE('Zq9!x7', asked), 'a token with a digit or a symbol, answering a password question, is one');
  ok(BARE('correct horse battery staple', 'Paste your passphrase'), 'a passphrase of plain words typed alone is one');
  ok(!BARE('the horse is here', asked), 'a sentence (a function word in it) is no passphrase');
  ok(!BARE('hunter', asked), 'one word of letters only is kept (the shortcut)');
  ok(!BARE('Zq9!x7', 'What is the weather like?'), 'a token answering a question that asks for no secret is kept');
  ok(!BARE('Zq9!x7', 'The password is set.'), 'a secret named with no ask is no question for one');
  ok(!BARE('Zq9!x7', `${asked} ${'x'.repeat(400)}`), 'only the last 400 characters of the question are read');
}

console.log(`secrets.test.mjs: ${checks} checks passed`);
