// The secret detector: what in a text is a key, a token or a password. redact() cuts it, holdsSecret() says whether a note holds
// one, BARE() whether a typed answer is one. A leaf with no imports, so store.mjs and every writer use it with no import cycle.
// A secret pasted into a message is never written: the snapshots would keep it
// for good. A key or token is known by its issuer's prefix, or by the word
// before it; anything in <private>...</private> goes whole. Before clipping,
// so no half of a key is left behind.
// A value that is plainly code, not a secret: a type (`password: string`),
// a reference (`${DB_PASSWORD}`, `$(cat f)`, `process.env.X`), a call or an
// index with no digit (`jwt.sign(payload`, `request.form[`), a path of two
// parts or more. 25 of 35 ordinary lines were cut; but a value with a `_` or
// a `.` in it is no code (correct_horse_battery_staple, Summer.Sunshine), and
// a looser rule let those through.
// A member whose last name is the secret's own word (`user.password`,
// `this.apiKey`, `settings.SECRET_KEY`) is a reference to one, not one.
const code = (v, ui) => /^\$[{(]|^(?:process\.env[.[]|os\.environ|os\.getenv|System\.getenv|ENV\[)/.test(v)
  || (!/\d/.test(v) && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v) && /(?:pass|secret|token|key|pwd|auth|cred)\w*$/i.test(v))
  || /^[A-Za-z_$][\w$.]*\(\)$/.test(v)
  || /^(?:string|number|boolean|str|int|bytes|any|unknown|null|undefined|none|true|false|object|bool|float|char|optional|secretstr)$/i.test(v)
  || (!/\d/.test(v) && (/^[A-Za-z_$][\w$.]*[([]/.test(v) || /^(?:\/|~\/|[A-Za-z]:[\\/])[^\s/\\]+[\\/]/.test(v)))
  // 1.4.1 I: a call with a digit in its arguments (`secrets.token_hex(16)`, `uuid.uuid4().hex`, `z.string().min(8)`, `String::new()`), a
  // schema type (`PropTypes.string.isRequired`), a YAML tag, a template, a markup tag, a regex literal, a URL with no login in it, an ARN, a
  // k8s secret's name, a shell variable in capitals, and the secret's own word as a label (`password`, `Password`).
  || (!/["'\s]/.test(v) && v.length <= 80 && ((c) => c && /^(?:secrets|uuid|crypto|random|os|Math|String|Number|Buffer|Joi|z|yup|hashlib|base64|bcrypt|JSON|Object|Array|Column|Field)(?:\.|::|$)|_|::|[a-z][A-Z]/.test(c))((/^((?:[A-Za-z_$][\w$]*(?:\.|::))*[A-Za-z_$][\w$]*)\(/.exec(v) ?? [])[1]))
  || /^(?:PropTypes|Joi|z|yup|v|t|T|types|Types)(?:\.[A-Za-z_$][\w$]*)*\.(?:isRequired|required|optional|nullable|string|number|boolean|object|array|func|bool)$/.test(v)
  || /^!{1,2}(?:vault|secret|encrypted|ref|env|include|str|binary)$/.test(v)
  || /^(?:\{\{|\{%|<%|(?:<|&lt;)\/?[A-Za-z][\w-]*>|\/\^)/.test(v)
  || ((/^[A-Za-z][\w+.-]{1,20}:\/\/[^\s@]*$/.test(v) || /^\.{1,2}[\\/][^\s@]*$/.test(v)) && !/[A-Za-z0-9]{10,}|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}/.test(v)) || /^arn:aws[\w-]*:/.test(v)
  || (ui && (/^(?:password|passwd|passphrase|secret|token|apikey|key|pass|pwd)$/i.test(v) || (/^[A-Z][A-Za-z' ]*[?:!.]?$/.test(v) && /\s/.test(v) && /pass|secret|token|\bkey|\bpin\b/i.test(v))))
  || /^\$[A-Z_][A-Z0-9_]*$/.test(v)
  || /^(?:none|nil|null)[)\]:;]+$/i.test(v);
// `ui` (a quoted JSON key's value, or `self.password`) keeps a label: "password": "Password", "Mot de passe"; elsewhere `password: password` is a real weak password.
// A command's argument that is no secret itself: a reference ($TOKEN,
// ${TOKEN}, $(cat pw): the shell expands it) or a path (~/.ssh/id_ed25519,
// ./pw.txt, /etc/x/y, certs/key.pem). Cut, the word a search would find was
// lost (review, 2026-10-29). Not a number: after --password or TOKEN= it is a
// PIN (R34).
const arg = (v) => /^\$[{(A-Za-z_]|^~|^\.{1,2}[\\/]|^\/[^\s/]+\/|[\\/][^\s\\/]*\.[A-Za-z]\w{0,7}$/.test(v);
// A variable's name that holds a secret: one of its _-parts is the word (not
// KEYBOARD or MONKEY), and it doesn't name a file (KEY_FILE, PUBLIC_KEY_PATH).
const named = (n) => {
  const ps = n.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase().split(/[_.-]/);
  return ps.some((p) => /^(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD)$/.test(p)) && !/^(?:FILE|PATH|DIR|NAME|ID)$/.test(ps.at(-1));
};
// A PHP/Laravel validation rule ('required|min:8'), no secret.
const RULES = /^(?:required|nullable|string|confirmed|sometimes|present|filled|bail|array|email|numeric|integer|alpha|alpha_num|alpha_dash|current_password|min|max|size|same|different|between|regex|unique|exists)(?::[\w,.-]+)?(?:\|(?:required|nullable|string|confirmed|sometimes|present|filled|bail|array|email|numeric|integer|alpha|alpha_num|alpha_dash|current_password|min|max|size|same|different|between|regex|unique|exists)(?::[\w,.-]+)?)*$/;
// A number under a count's name (TOKEN_LIMIT, MAX_TOKEN, SECRET_PORT): no
// secret, as only a count-like whole part says (R34).
const counted = (n, v) => /^\d+$/.test(v) && n.toUpperCase().split('_').some((p) => /^(?:LIMIT|MAX|MIN|SIZE|COUNT|LEN|TTL|TIMEOUT|BYTES|PORT)$/.test(p));
// A .env name that holds a secret: its last `_`-part is the word (SIGNING_KEY, DB_PASSWORD). One whose word comes first names
// something else (KEY_ALGORITHM, TOKEN_URL, SECRET_BACKEND); a name with SECRET or PASSWORD anywhere the setting rule reads anyway.
const envNamed = (n) => /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|AUTH|CREDENTIALS?)$/.test(n);
// A YAML child's value under a secret's key, whose own name says nothing: a secret has a digit or a symbol, a PIN too (not a
// name such as `apiKey`, `tls-cert` or `production`); under `tokens:` a token's length too, 16 or more with a letter and a digit
// (not a colour, `blue-500`, a model's name or a count).
const yamlSecret = (v, tok) => (tok ? v.length >= 16 && /\d/.test(v) && /[A-Za-z]/.test(v) : /[\d!@#$%^&*+=?~]/.test(v));
// 1.4.1 F: a rule for the value after a command's flag or word (`pre`), quoted or bare. Kept: a reference or path, a switch (`/add`), an expression
// (`(ConvertTo-SecureString`), and with `need` a word with no digit or symbol (prose after `net user NAME`).
const VAL = String.raw`((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})`;
const after = (pre, flags = 'gi', need = false) => [new RegExp(`(${pre})["']?${VAL}`, flags),
  (m, p, v) => (arg(v) || /^[(@]|^\/[\w:]+$/.test(v) || (need && !/[\d!@#$%^&*]/.test(v)) ? m : `${p}[redacted]`)];
// Words that make a run of lowercase words a sentence, not a passphrase.
const FUNC = new Set('a an the and or but so if then than that this those these which who what when where why how because since as at by for from in into of off on onto to too with without not no now is are was were be been being am it its you your i my we our they them he she has have had do does did can could will would shall should may might must also only just still always never very more most less than there here incorrect required encrypted different unchanged mandatory important expired stored invalid available confidential sensitive hashed salted'.split(' '));
// A k8s secret's name after a colon (`secret: my-app-secret`; with `=` it stays cut). A lowercase word that a sentence goes on about (`password: required`, `secret: scanning is on`): a function word, or one right after it.
// An IPv6 address (`89dd:6359:e614:3541:4530:f20e:dc94:5ca5/64`) reads like a .pgpass line; a pgpass has 4 colons, an address 6 or more.
// A short form with `::` (`2a02:4780:75:aec3::1`) has fewer, and may end in prose's `)`, `` ` `` or `,`.
const v6 = (s) => /^[0-9a-f:]+(?:[/%]\S*)?[)`'",.;]*$/i.test(s) && (s.split(':').length > 6 || s.includes('::'));
// `pass` the noun after a word that makes it a sentence (`same pass: worked`, `ALL PASS = healthy`), with a value of letters only.
const passNoun = (b, v) => /^(?:[A-Za-z]+|`[A-Za-z_]+`)$/.test(v) && /\b(?:same|audit|all|full|final|first|second|last|green|clean|each|every|this|that|next|another)\s+pass\s*[:=]\s*["']?$/i.test(b);
const prose = (v, rest) => /^[a-z]{4,}$/.test(v) && (FUNC.has(v) || (/(?:ed|ing)$/.test(v) && FUNC.has((/^ ([a-z]+)\b/.exec(rest) ?? [])[1])));
const SECRETS = [
  // From the first opener to the last closer: nested, the text after the inner
  // closer was saved. Self-closed or unclosed, to the end.
  [/<\s*private(?![-_\w])(?:[^>]*>(?:[\s\S]*<\s*\/\s*private\s*>|[\s\S]*)|[^>]*$)/gi, '[private]'],
  // PGP's says PRIVATE KEY BLOCK.
  // Bounded: `-----BEGIN ` then `PRIVATE KEY ` repeated took 20 s a megabyte.
  [/-----BEGIN [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----|$)/g, '[redacted]'],
  // sk-... (Anthropic, OpenAI); sk_live_, pk_test_, rk_live_ (Stripe).
  [/(?<![A-Za-z0-9])(?:sk|rk|pk)(?:-|_(?:live|test|prod)_)[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[\w-]{22,}/g, '[redacted]'],
  // Vendor tokens by prefix (1.4.1): GitLab (all kinds, routable ones with dots), Stripe-style ElevenLabs, Square, Facebook, Plaid, Salesforce, Dropbox, Twitter's bearer (before the Bearer rule),
  // AWS Bedrock, Google refresh, Firebase, Azure AD and DevOps, and the AI keys (HF org, Fireworks, Cerebras, Tavily, Pinecone, LangSmith, Voyage).
  // glft- is split out of the gl* list: feed tokens have a digit or capital, glft- branch names (kebab, 3+ hyphens) do not.
  [/\bgl(?:pat|dt|rt|cbt|imt|agent|oas|soat|ptt)-[\w.-]{20,}|\bglft-(?!(?:[A-Za-z0-9_]*-){3})(?=[\w-]{0,40}[\dA-Z])[\w-]{20,}|\bAC[0-9a-f]{32}:[0-9a-f]{32}\b|\bGR1348941[\w-]{20,}|\b_gitlab_session=[\w-]{20,}|(?<![A-Za-z0-9])sk_[a-f0-9]{48}\b|\bsq0(?:atp|csp)-[\w-]{22,}|\bEAA[A-Za-z][\w-]{50,}|\baccess-(?:sandbox|development|production)-[0-9a-f-]{36}|\b00D[A-Za-z0-9]{12,15}![\w.-]{40,}|(?<![\w.])sl\.(?:u\.)?[\w-]{60,}|(?<![A-Za-z0-9])A{15,}[A-Za-z0-9%_-]{40,}|\bABSK[A-Za-z0-9+/=]{100,}|\bbedrock-api-key-[A-Za-z0-9+/=_-]{40,}|(?<![\w/])1\/\/0[\w-]{40,}|\bAAAA[\w-]{7}:APA91b[\w-]{100,}|(?<![\w-])[\w-]{3}8Q~[\w.~-]{30,}|(?<![\w/+.=-])(?=[a-z0-9]{0,51}\d)(?=[a-z0-9]{0,51}[a-z])(?=[a-z0-9]{0,51}[eout])[a-z0-9]{52}(?![\w/+.=-])|\bapi_org_[A-Za-z]{20,}|\bfw_[A-Za-z0-9]{24}\b|\bcsk-[a-z0-9]{48}\b|\btvly-[A-Za-z0-9]{32}\b|\bpcsk_[A-Za-z0-9]{50,}|\blsv2_(?:pt|sk)_[0-9a-f]{32}_[0-9a-f]{10}\b|(?<![A-Za-z0-9])pa-(?=[\w-]{0,45}\d)(?![\w-]{0,40}[a-z]{4,}-[a-z]{4,}-[a-z]{4,})[\w-]{40,46}(?![\w-])/g, '[redacted]'],
  // Vendor tokens by prefix, part 2 (1.4.1 D): Terraform, Vault batch, Doppler, Pulumi, DigitalOcean, Heroku, Render, Supabase, Neon, Cloudflare, Brevo, Mailchimp, Resend, Notion,
  // Bitbucket, JFrog, Sentry, Grafana, New Relic, Honeycomb, 1Password, OpenShift, CircleCI, Buildkite, SonarQube, Sourcegraph, Cargo, Figma, JetBrains, Mapbox.
  [/\b[A-Za-z0-9]{14}\.atlasv1\.[\w-]{60,}|\bhvb\.[\w-]{100,}|\bdp\.(?:pt|st|sa|ct|scim|audit)\.[A-Za-z0-9]{40,}|\bpul-[0-9a-f]{40}\b|\bdo[opr]_v1_[a-f0-9]{64}|\bHRKU-[\w-]{30,}|(?<![A-Za-z0-9])rnd_[A-Za-z0-9]{32}\b|\bsb_secret_[\w-]{20,}|\bnapi_[a-z0-9]{50,}|\bv1\.0-[0-9a-f]{24}-[0-9a-f]{146}\b|\bcf(?:ut|k)_[A-Za-z0-9]{40,}|\bxkeysib-[0-9a-f]{64}-[A-Za-z0-9]{16}|\b[0-9a-f]{32}-us\d{1,2}\b|(?<![\w-])re_(?=[A-Za-z0-9_-]{0,40}\d)(?=[A-Za-z0-9_-]{0,40}[a-z])[A-Za-z0-9_-]{30,}(?![\w-])|\bapi-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bsecret_[A-Za-z0-9]{43}\b|\bATBB[\w=-]{28,}|\bAKCp[A-Za-z0-9]{60,}|\bcmVmd[A-Za-z0-9]{50,}|\bsntryu_[0-9a-f]{64}|\bglsa_[A-Za-z0-9]{32}_[0-9a-f]{8}\b|\beyJrIjoi[A-Za-z0-9+/=]{60,}|\bNR(?:AK|II|JS|SP|XX)-[A-Za-z0-9]{20,}|\bhc[abx]ik_[a-z0-9]{26}\b|\bops_eyJ[\w+/=-]{100,}|\bA3-[A-Z0-9]{6}-[A-Z0-9]{11}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b|\bsha256~[\w-]{43}|\bCCIPAT_[A-Za-z0-9]{22}_[0-9a-f]{40}|\bbkua_[0-9a-f]{40}|\bsq[pua]_[0-9a-f]{40}\b|\bsgp_(?:[0-9a-f]{16}_)?[0-9a-f]{40}\b|\bcio[A-Za-z0-9]{32}\b|\bfigd_[\w-]{40,}|\bperm:[A-Za-z0-9+/=._-]{40,}|\bpk\.eyJ[\w-]{10,}\.[\w-]{10,}/g, '[redacted]'],
  [/\bxox[abeprs]-[A-Za-z0-9-]{10,}|\bxapp-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  // AWS keys, long-lived and STS.
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[redacted]'],
  [/(?<![A-Za-z0-9_]|eyJ-)eyJ[A-Za-z0-9_-]{10,300}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  // An unsigned JWT, or one with its signature cut: two eyJ parts (1.4.1 D).
  [/(?<![A-Za-z0-9_]|eyJ-)eyJ[A-Za-z0-9_-]{10,300}\.eyJ[A-Za-z0-9_-]{10,}\.?/g, '[redacted]'],
  // With a digit in it, or 32 characters or more: "Basic implementation/approach" and "Bearer authentication-header" were prose,
  // and were cut; a long one with no digit (1 in 400 random ones) was kept (audit #7). A hidden character after the word, as
  // redact() sees the raw text, does not hide the value. The long one has no . or /, so "basic tests/integration/x.rb" is kept.
  // Not after `per-`: `per-token is_open/x_4k` is prose (an `access-token` or `X-Auth-Token` value is still one).
  [/(?<!\bper-)\b(Bearer|Basic|Token)[\s\p{Default_Ignorable_Code_Point}]+(?=[A-Za-z0-9._~+/=-]{0,200}\d|[A-Za-z0-9_~+=-]{32})[A-Za-z0-9._~+/=-]{20,}/giu, '$1 [redacted]'],
  // GitLab, npm and Hugging Face tokens; a Slack webhook is its own secret.
  [/\bglpat-[A-Za-z0-9_-]{20,}|\bnpm_[A-Za-z0-9]{36}\b|\bhf_[A-Za-z0-9]{30,}/g, '[redacted]'],
  // PyPI, Stripe webhooks, SendGrid, Google OAuth, Groq, xAI, Shopify,
  // DigitalOcean, Notion, Atlassian, Vault, Docker; and a PEM key in base64
  // (kubeconfig's client-key-data).
  [/\bpypi-AgE[A-Za-z0-9_-]{20,}|\bwhsec_[A-Za-z0-9+/=]{20,}|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bya29\.[A-Za-z0-9_-]{20,}|\bgsk_[A-Za-z0-9]{20,}|\bxai-[A-Za-z0-9]{20,}|\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}|\bdop_v1_[a-f0-9]{64}|\bntn_[A-Za-z0-9]{20,}|\bATATT[A-Za-z0-9_=-]{20,}|\bhvs\.[A-Za-z0-9_-]{20,}|\bdckr_pat_[A-Za-z0-9_-]{20,}|\bpplx-[A-Za-z0-9]{40,}|(?<!\d)\d{8,10}:AA[\w-]{33}\b|\blin_api_[A-Za-z0-9]{30,}|\bPMAK-[A-Za-z0-9-]{40,}|\br8_[A-Za-z0-9]{30,}|\bsbp_[a-f0-9]{40}\b|\bdapi[a-f0-9]{32}\b|\bsntrys_[A-Za-z0-9+/=_-]{20,}|\bSK[0-9a-f]{32}\b|\bkey-[0-9a-f]{32}\b|\bsk\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}|\brubygems_[A-Za-z0-9]{40,}|\bnfp_[A-Za-z0-9]{30,}|\bfo1_[A-Za-z0-9_-]{30,}|\bpscale_(?:pw|tkn|oauth)_[A-Za-z0-9._-]{30,}|\btskey-(?:auth|api|client)-[A-Za-z0-9-]{20,}|\bglc_[A-Za-z0-9+/=]{30,}|\bxox[cd]-[A-Za-z0-9%+/=_-]{10,}|\bAGE-SECRET-KEY-[A-Z0-9]{20,}|\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b|(?<![\w/+=.-])(?=[A-Za-z0-9+/]{0,39}[A-Z])(?=[A-Za-z0-9+/]{0,39}[a-z])(?=[A-Za-z0-9+/]{0,39}\d)(?=[A-Za-z0-9+/]{0,39}[/+])[A-Za-z0-9+/]{40}(?![\w/+=.-])/g, '[redacted]'],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1[redacted]'],
  [/(discord(?:app)?\.com\/api\/webhooks\/)[\w-]+(?:\/[\w-]+)?/g, '$1[redacted]'],
  // Webhooks whose path is the secret: Teams, Zapier, IFTTT, Mattermost (26 characters).
  [/((?:\.webhook\.office|\boutlook\.office)(?:365)?\.com\/webhook(?:b2)?\/)[^\s\"'<>]+|(hooks\.zapier\.com\/hooks\/(?:catch|standard)\/\d+\/)[\w-]+|(maker\.ifttt\.com\/(?:trigger\/[^/\s]+\/(?:json\/)?with\/key\/|use\/))[\w-]+|(\/hooks\/)(?=[a-z0-9]{0,25}\d)(?=[a-z0-9]{0,25}[a-z])[a-z0-9]{26}\b/g, (m, a, b, c, d) => `${a ?? b ?? c ?? d}[redacted]`],
  // Sidekiq Enterprise's gem server: the user:password in the URL, or in the BUNDLE_ setting.
  [/(\/\/)[^\s:@/]{1,100}:(?:(?!\/\/)[^\s@]){1,200}(?=@gems\.contribsys\.com)|(\bBUNDLE_GEMS__CONTRIBSYS__COM[=:][ \t]*[\"']?)[^\s\"']+|(\bgems\.contribsys\.com[ \t]+)[^\s\"']+/g, (m, a, b, c) => `${a ?? b ?? c}[redacted]`],
  // A session cookie logs anyone in: a Cookie / Set-Cookie header's name=value pairs (nothing after them), and curl's -b / --cookie value (not a jar file).
  // An Authorization value with no scheme word: 20+ characters with a digit. And redis-cli's -a password.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?)(?=[A-Za-z0-9._~+/=-]{0,200}\d)[A-Za-z0-9._~+/=-]{20,}/gi, '$1[redacted]'],
  // Authorization: Basic with a short credential (8+ base64 characters), as the rule above wants 20 and a digit. A word in lower case is prose.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?basic[ \t]+)([A-Za-z0-9+/=]{8,200})/gi, (m, pre, v) => (/^[a-z]+$/.test(v) ? m : `${pre}[redacted]`)],
  // 1.4.1 D: any other scheme (SSWS, Splunk, ApiKey, Negotiate, NTLM, Digest...): its credential, as long and with a digit as the Bearer rule wants.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?[A-Za-z][\w-]{1,30}[ \t]+)(?=[A-Za-z0-9._~+/=-]{0,300}\d|[A-Za-z0-9_~+=-]{32})[A-Za-z0-9._~+/=-]{20,}/gi, '$1[redacted]'],
  // A Digest, Hawk or OAuth1 header's response, mac, signature and token values; an AWS Signature V4's Signature; and OAuth1's signature anywhere.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?(?:Digest|Hawk|OAuth|AWS4-HMAC-SHA\d+)\b)([^\n]{0,1000})/gi, (m, pre, rest) => pre + rest.replace(/\b(response|mac|signature|oauth_(?:token|token_secret|signature|verifier|consumer_secret))(["']?=["']?)[^"',\s]{6,}/gi, '$1$2[redacted]')],
  [/(\boauth_(?:signature|verifier|token_secret)["']?[ \t]*[:=][ \t]*["']?)[^"'&,\s]{6,}/gi, '$1[redacted]'],
  // A webhook's signature header (X-Hub-Signature-256: sha256=...).
  [/(\b(?:x-[\w-]{0,30}|stripe-)signature(?:-256)?["']?[ \t]*[:=][ \t]*["']?(?:sha\d+=|t=\d+,v\d=)?)[A-Za-z0-9+/=]{40,}/gi, '$1[redacted]'],
  [/(\bredis-cli\b(?:(?!\bredis-cli(?![\w.-]))[^\n|;&]){0,200}?\s-a[ \t]+["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|[^\s"']+)/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // The curl rule first: the header rule reads to the next quote, which may be the one that opens a -b value.
  [/(\bcurl\b(?:(?!\bcurl\b)[^\n|;&]){0,300}?\s(?:-b|--cookie)[ =]+["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|[^\s"']+)/g, (m, pre, v) => (v.includes('=') ? `${pre}[redacted]` : m)],
  [/((?:^|[\s'"])(?:set-)?cookie["']?[ \t]*:[ \t]*["']?)[\w.%!#$&*+^~-]{1,100}=[^\s;'"]*(?:;[ \t]*[\w.%!#$&*+^~-]{1,100}=[^\s;'"]*)*/gim,
    // Only a session-like pair (a name that says so, or a long value with a letter and a digit) goes; `theme=dark; lang=en` stays.
    (m, pre) => (m.slice(pre.length).split(';').some((x) => { const [n, ...r] = x.trim().split('='), v = r.join('='); return !/^(?:path|domain|max-age|expires|samesite|secure|httponly)$/i.test(n) && (/sess|(?:^|[_.-])sid(?:$|[_.-])|auth|tok|jwt|login|key|secret|pass|csrf|xsrf|remember|user/i.test(n) || (v.length >= 12 && /\d/.test(v) && /[A-Za-z]/.test(v))); }) ? `${pre}[redacted]` : m)],
  // Docker's config.json: "auth" is base64 of user:password.
  [/("auth"[ \t]*:[ \t]*")(?=[A-Za-z0-9+/]{0,300}[\d=+/])[A-Za-z0-9+/]{20,300}={0,2}(?=")/g, '$1[redacted]'],
  // A signed URL's signature is the credential (Azure SAS, S3, GCS).
  [/([?&](?:sig|X-Amz-Signature|X-Goog-Signature)=)[^&\s]{16,}/gi, '$1[redacted]'],
  // shortcut: a secret holding a ? is cut at it when judged (the lookahead stops there to stay linear), upgrade if such a key appears.
  [/([?&](?:key|code|auth|authorization|access_token|token)=)(?=[^&\s"'?]{0,200}\d)[^&\s"']{12,}/gi, '$1[redacted]'],
  // The password in a URL: postgres://user:it@host, redis://:it@host (no
  // user), one with an @ in it (to the last one). Not a query: a port
  // before `?user=me@x` was cut as a password.
  // A token alone as a URL's user (git clone https://<token>@github.com/…): long, with a digit (1.3.1 audit B-6).
  [/(\/\/)(?=[A-Za-z0-9_-]{0,200}\d)[A-Za-z0-9_-]{30,200}@/g, '$1[redacted]@'],
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{0,100}:)(?!\d{1,5}[/?#])(?:(?!:\/\/)[^\s"'<>]){1,2000}@/gi, '$1[redacted]@'],
  // curl -u user:it, --user user:it, quoted too, to the closing quote (review, 2026-11-01). Not `docker run -u 1000:1000`, a user
  // and group.
  [/((?:^|\s)(?:-[uU]|--(?:proxy-)?user)[ =]+(?!=)(?:\\?["'])?(?!\d+:\d+(?![^\s'"]))[^\s:'"]{1,100}:)((?<=:)\\"[^"\n]{1,200}(?=")|(?<="[^\s:'"]{1,100}:)[^"\n]{1,200}(?=")|(?<='[^\s:'"]{1,100}:)[^'\n]{1,200}(?=')|(?<=:)"[^"\n]{1,200}(?=")|(?<=:)'[^'\n]{1,200}(?=')|[^\s'"]{1,200})/g, (m, pre, v) => (arg(v.replace(/^["']/, '')) ? m : pre + '[redacted]')],
  // --password it (--token, --client-secret); docker login, az login, sshpass
  // and twine take it as -p it. Not --no-password, whose next word is the
  // command's own; nor "the --token flag", in prose.
  // Quoted, as a value with symbols or blanks must be, to its closing quote: the opening quote refused, each was kept (e2e audit,
  // 2026-11-01). A quoted one may start with `-`; a bare one that does is the next option (review, 2026-11-01).
  // sshpass with no \b before it: glued to a word, its -p value was kept (fuzz 1059386132).
  [/(--(?!no-|ask-)(?:[a-z0-9]+-){0,3}(?:password|passwd|token|secret|passphrase|api-?key|access-key|account-key|secret-access-key|secret-string|token-code|creds|oauth2-bearer|requirepass|masterauth|pass|private-key|mnemonic)[ =](?:\\?["'])?|\b(?:(?:docker|podman|az|oc|helm|crane|oras|skopeo|buildah|nerdctl)\b(?:\s+-{1,2}[\w-]+(?:[ =][^\s-]\S*)?|\s+[a-z]+){0,3}\s+login|twine\s+upload|mycli|cqlsh|cypher-shell|rabbitmqadmin|(?<![\w.*])7za?|mongo(?:sh|dump|restore|export|import)?)\b[^\n|;&]{0,200}?\s-p\s+(?:\\?["'])?|sshpass\b[^\n|;&]{0,200}?\s-p\s+(?:\\?["'])?|\b(?:sqlcmd|bcp|unzip|zip)\b[^\n|;&]{0,200}?\s-P\s*(?:\\?["'])?|\b(?:plink|pscp|psftp|putty)\b[^\n|;&]{0,200}?\s-pw\s+(?:\\?["'])?|\bccrypt\b[^\n|;&]{0,200}?\s-K\s+(?:\\?["'])?|\b(?:zip|mosquitto_(?:pub|sub|rr)|ldap(?:search|modify|add|delete|compare))\b[^\n|;&]{0,200}?\s-[Pw]\s+(?:\\?["'])?|\b(?:requirepass|masterauth)[ \t]+(?:\\?["'])?(?=[^\s"']{4}))(?!(?:flag|option|argument|parameter|value|field|setting)s?\b)((?<=\\")[^"\\\n]{1,2000}(?=\\")|(?<=")(?:[^"\n\\]|\\.){1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|(?!-)[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) || /\.(?:7z|zip|rar)$/i.test(v) ? m : `${pre}[redacted]`)],
  // 1.4.1 E: ssh-keygen's -N new and -P old passphrase (both in one command, so one rule reads the whole command).
  [/\bssh-keygen\b[^\n|;&]{0,300}/g, (m) => m.replace(/(\s-[NP]\s*["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})/g, (x, p, v) => (arg(v) ? x : p + '[redacted]'))],
  // mysql, mariadb and mycli: the glued -pPASS (a spaced -p is a prompt).
  [/(\b(?:mysql|mariadb|mycli)\b[^\n|;&]{0,200}?\s-p)((?<=p")[^"\n]{1,200}(?=")|(?<=p')[^'\n]{1,200}(?=')|[^\s"'-]\S{2,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // keytool and jarsigner: -storepass, -keypass (and -srcstorepass, -destkeypass...). Not -storepass:env VAR.
  [/(\s-(?:(?:src|dest)?(?:store|key)pass(?:wd)?)[ \t]+["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // A password piped in (shortcut: a value with no digit or symbol is kept unless the reader is --password-stdin or chpasswd, so `echo hello | sudo -S true` stays; the here-string and send rules keep that limit too): echo / printf of it into a command that reads one from stdin (docker login --password-stdin, sudo -S, kinit, chpasswd, passwd --stdin, ssh-add, gpg --passphrase-fd, openconnect, runas, az devops login, gh secret set, gcloud secrets).
  [/\b((?:echo|printf)(?:[ \t]+-[neE]+)?(?:[ \t]+'%s[^']{0,10}')?[ \t]+)("[^"\n]{3,200}"|'[^'\n]{3,200}'|(?![-$~])[^\s"'|;&<>]{3,200})(?=[ \t]*\|[ \t]*(?:[A-Z_]+=\S+[ \t]+)*(?:(?:\/\S*\/)?sudo\b[^\n|;&]{0,100}?\s-S\b|(?:(?:\/\S*\/)?sudo\s+(?:-\S+\s+)*|\/\S*\/)?(?:(?:docker|podman|helm\s+registry|crane\s+auth|oras|skopeo|az\s+acr)(?:\s+-{1,2}[\w-]+(?:[ =][^\s-]\S*)?)*\s+login\b|az\s+devops\s+login\b|gh\s+(?:secret\s+set|auth\s+login)\b|gcloud\s+(?:secrets|auth)\b|kinit\b|chpasswd\b|passwd\b|openconnect\b|runas\b|ssh-add\b|gpg\b[^\n|;&]{0,100}?--passphrase-fd|vault\s+login\b|npm\s+login\b|realm\s+join\b|adcli\b)))/g, (m, pre, v, at, all) => (arg(v.replace(/^["']/, '')) || (!/[0-9!@#$%^&*]/.test(v) && !/^[ \t]*\|[^\n|;&]*?(?:--password-stdin|\bchpasswd\b)/.test(all.slice(at + m.length))) ? m : pre + '[redacted]')],
  // A password given to a prompt: a here-string into a login-like command, and expect's send "pass\r".
  [/(\b(?:mysql|mariadb|psql|sudo|su|kinit|ssh|ssh-add|passwd|chpasswd|openconnect|runas|docker\s+login)\b[^\n|;&]{0,200}?<<<[ \t]*)("[^"\n]{3,200}"|'[^'\n]{3,200}'|[^\s"'|;&<>]{3,200})/g, (m, pre, v) => (arg(v.replace(/^["']/, '')) || !/[0-9!@#$%^&*]/.test(v) ? m : pre + '[redacted]')],
  [/((?:^|[\s;{])send[ \t]+(?:--[ \t]+)?")((?:[^"\n\\]|\\(?!r"|n"))[^"\n]{2,200}?)(?=\\[rn]")/g, (m, pre, v) => (arg(v) || !/[0-9!@#$%^&*]/.test(v) ? m : pre + '[redacted]')],
  // mc alias set NAME URL ACCESSKEY SECRETKEY; rclone's flag is a long flag above.
  [/(\bmc\s+alias\s+set\s+\S+\s+\S+\s+\S+\s+["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // aws ssm put-parameter and az keyvault secret set take the secret as --value; terraform's -var of a secret under a name that does not say so (a long mixed value).
  [/(\b(?:aws\s+ssm\s+put-parameter|az\s+keyvault\s+secret\s+set)\b[^\n|;&]{0,300}?\s--value[ =]+["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|(?!-)[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  [/(\bterraform\b[^\n|;&]{0,300}?\s-var[ =]+["']?[\w.-]{1,100}=["']?)(?=[^\s"']*[A-Z])(?=[^\s"']*[a-z])(?=[^\s"']*\d)[^\s"']{10,200}/g, '$1[redacted]'],
  // secret-paths-8: smbclient -U user%pass, xfreerdp /p:pass, rabbitmqctl add_user, dotnet user-secrets set, redis ACL SETUSER >pass, reg add /v Password /d pass.
  [/(\s-U[ \t]*["']?[\w.\\@-]{1,100}%)[^\s"']{1,200}/g, '$1[redacted]'],
  [/(\b[wx]?freerdp\d*\b[^\n|;&]{0,200}?\s["']?\/(?:p|password):["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,200})/gi, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  [/(\brabbitmqctl\s+(?:add_user|change_password)\s+\S+\s+["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  [/(\buser-secrets\s+set\s+["']?[\w:.-]{1,100}["']?\s+["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|(?!-)[^\s"']{3,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  [/(\bACL\s+SETUSER\b[^\n|;&]{0,300}?[ \t]["']?[>#])[^\s"']{1,200}/gi, '$1[redacted]'],
  [/(\breg(?:\.exe)?\s+add\b[^\n|;&]{0,300}?\s\/v\s+["']?[\w.-]{0,40}(?:pass|pwd|secret|token|key)[\w.-]{0,40}["']?\s+(?:\/t\s+\S+\s+)?\/d\s+["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,200})/gi, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // The glued -p of rar and unrar (-pPASS, -hpPASS) and the SSHPASS variable sshpass -e reads.
  [/(\b(?:rar|unrar)\b[^\n|;&]{0,200}?\s-h?p)[^\s-]\S{2,}/g, '$1[redacted]'],
  [/(\bSSHPASS=["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]{1,200})/g, (m, pre, v) => (arg(v) ? m : pre + '[redacted]')],
  // redis-cli AUTH [user] pass: both words, each quoted or bare; the user name is no secret worth the parsing (1.3.1 fix
  // review: `> out.txt`, `2>/dev/null`, a quoted pass with a blank and CRLF each kept the password). Two words, not to the
  // end: clip() joins lines first, and the rest of the entry went with it. Not an AUTH already [redacted]: clip() redacts
  // until nothing changes, and each pass took two more words. Only options between redis-cli and AUTH: prose ("redis-cli needs
  // AUTH before") lost two words. Kept only when every word reads as a path or variable: a pass then `./check.sh` was kept.
  // shortcut: a password hand-wrapped onto the next line without `\` slips through clip(); a backslash wrap is caught.
  // Each option one way only (-[\w-]+, not -{1,2}): read two ways, a line of --options took 2^n tries and stalled the Stop.
  // A blank may be a `\` line wrap; an option's value may be quoted. A value never starts with `=`, which is also a blank
  // here (two readings again), and at most 40 options: `-a redis-cli` repeated made each redis-cli a fresh start.
  [/(\bredis-cli(?:(?:[ \t]|\\\r?\n)+-(?!\bredis-cli(?![\w.-]))[\w-]+(?:(?:[ \t=]|\\\r?\n)+(?:"[^"\n]*"|'[^'\n]*'|(?!\bredis-cli(?![\w.-]))[^\s|;&<>"'=-])\S*)?){0,40}(?:[ \t]|\\\r?\n)+AUTH\s+)(?!\[redacted\])(?!(?:flag|option|argument|parameter|value|field|setting)s?\b)((?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+))?)/g,
    (m, pre, v) => (v.split(/\s+/).every(arg) ? m : `${pre}[redacted]`)],
  // 1.4.1 D: a token a vendor's command takes as a flag or word: doctl -t, netlify --auth, ngrok add-authtoken, cargo login, httpie -a / --auth, composer config, bundle config.
  [/(\bdoctl\b[^\n|;&]{0,200}?\s(?:-t|--access-token)[ =]["']?|\bnetlify\b[^\n|;&]{0,200}?\s--auth[ =]["']?|\bngrok\s+(?:config\s+)?(?:add-)?authtoken\s+["']?|\bcargo\s+login\s+(?:--registry[ =]\S+\s+)?["']?|\bhttps?(?=[ \t])[^\n|;&]{0,200}?\s(?:-a|--auth)[ =]+["']?|\bcomposer\s+config\s+(?:-[\w-]+\s+){0,3}(?:(?:github-oauth|gitlab-oauth|gitlab-token|bearer)\.[\w.-]+\s+|http-basic\.[\w.-]+\s+[^\s"']+\s+)["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|(?!-)[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) || /^[^:]*:\$/.test(v) ? m : `${pre}[redacted]`)],
  // bundle config of a gem source's credential, with or without `set` and `--global`: a dotted name, then user:password or a token.
  [/(\bbundle\s+config\s+(?:set\s+)?(?:--?[\w-]+\s+){0,3}[\w-]+(?:\.[\w-]+)+\s+["']?)(?!-)([^\s"']{10,2000})/g, (m, pre, v) => (arg(v) || code(v) ? m : `${pre}[redacted]`)],
  [/(\boathtool\b[^\n|;&]{0,100}?\s["']?)(?!-)[A-Za-z0-9=]{12,}\b/g, '$1[redacted]'],
  // A keyword before a long key with no colon: `secret <base64>`, `key <40 hex>`, `private key <64 hex>` (the name alone is too common, so the value must read as a key).
  [/((?<![A-Za-z0-9])(?:secret|key|private[ _-]?key|token)(?:[ _-]?(?:key|access[ _-]?key))?[ \t]+(?:is[ \t]+)?["']?)(?=[A-Za-z0-9+/]{0,200}\d)(?=[A-Za-z0-9+/]{0,200}[A-Za-z])([A-Za-z0-9+/]{32,200}={0,2})(?![\w+/=-])/gi, (m, pre, v) => (/^[0-9a-f]+$/i.test(v) || (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) ? `${pre}[redacted]` : m)],
  // Vendor names that precede a key in a setting or a variable (Cloudflare, Datadog, Algolia, Mapbox, Honeycomb, PagerDuty's routing key): 32 characters or more with a digit.
  [/(\b(?:cloudflare|datadog|algolia|mapbox|honeycomb|routing)[\w.-]{0,30}[ \t]*[:=][ \t]*["']?)(?=[A-Za-z0-9_-]{0,100}\d)[A-Za-z0-9_-]{32,}/gi, '$1[redacted]'],
  // Key literals: a seed phrase, a Bitcoin WIF, a Solana keypair array, a base64 private key with no header, sops and ansible-vault blobs, PuTTY's private lines.
  [/\b((?:seed[ _-]?(?:phrase|words?)|mnemonic|recovery[ _-]phrase)["']?[ \t]*[:=]?[ \t]*["']?)(?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8}\b/gi, '$1[redacted]'],
  [/(?<![A-Za-z0-9])[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(?![A-Za-z0-9])/g, (m) => (/\d/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) ? '[redacted]' : m)],
  // shortcut: a list of 32 or more numbers under 256 is taken for a Solana keypair, so a long byte array in code is cut too; narrow it if that is ever a problem.
  [/\[\s*(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*){31,}(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\]/g, '[redacted]'],
  [/(?<![A-Za-z0-9+/])(?:MII[A-Z][A-Za-z0-9+/]{200,}|MHcCAQEEI[A-Za-z0-9+/]{60,}|MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{40,})={0,2}/g, '[redacted]'],
  [/\bENC\[AES256_GCM,[^\]\n]{20,2000}\]/g, '[redacted]'],
  [/(\$ANSIBLE_VAULT;[\d.]{1,10};AES256[ \t]*\r?\n?)(?:[0-9a-f]{20,}\r?\n?)+/g, '$1[redacted]'],
  [/(\bPrivate-Lines:[ \t]*\d{1,3}(?:\\n|[\s\\])*)(?:[A-Za-z0-9+/=]{16,}(?:\\n|[\s\\])*)+/g, '$1[redacted]'],
  // The key of a signing or encryption call in code: hmac.new(b"..."), createHmac("sha256", "..."), bytes.fromhex("<hex>"), Fernet(b"..."), and AWS's "AWS4" + secret.
  [/(\bhmac\.(?:new|HMAC)\(\s*(?:key\s*=\s*)?b?["']|\bcreateHmac\(\s*["'][\w-]{1,20}["']\s*,\s*["']|\b(?:bytes\.fromhex|fromhex|unhexlify|a2b_hex)\(\s*b?["']|\bFernet\(\s*b?["'])((?:(?!["']).){8,200})(?=["'])/gi, (m, pre, v) => (arg(v) || code(v) || /\$\{/.test(v) ? m : `${pre}[redacted]`)],
  [/(["']?AWS4["']?[ \t]*\+[ \t]*["']?)[A-Za-z0-9+/]{30,}/g, '$1[redacted]'],
  // A secret as a command's argument, which the journal's Ran field keeps (P1
  // hunt, 2026-10-29): `aws configure set` of a secret, key or token; a
  // SetEnvironmentVariable or setx of one; htpasswd -b's password, after its
  // file (none with -n) and user, before any redirect (-n prints, so one
  // follows: `> .htpasswd` was taken for the password); an exported name whose
  // word is a key's; gh secret set's body; an npm registry's _authToken.
  // Quoted values here and below to the closing quote, as above (review, 2026-11-01).
  [/(\baws\s+configure\s+set\s+(?:--[\w-]+(?:[ =](?!-)\S{1,100})?\s+){0,5}[\w.-]{0,100}(?:secret|key|token)[\w.-]{0,100}\s+["']?)(?!-)(?:(?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,2000})/gi, '$1[redacted]'],
  [/(\b(?:SetEnvironmentVariable|setdefault|putenv|setenv|setItem|define|setProperty)\(\s*["']([^"'\n]{1,100})["']\s*,\s*["'])([^"'\n]{1,2000})/gi, (m, pre, name, v) => (named(name) && !arg(v) && !counted(name, v) ? `${pre}[redacted]` : m)],
  // shortcut: more than 8 flags between htpasswd and its password are not caught (an open-ended run was quadratic), upgrade if such commands appear.
  [/(\bhtpasswd(?=(?:\s+-[A-Za-z]+(?:\s+\d+)?){0,8}?\s+-[A-Za-z]*n)(?:\s+-[A-Za-z]+(?:\s+\d+)?){0,8}?\s+-[A-Za-z]*b[A-Za-z]*(?:\s+\d+)?(?:\s+-[A-Za-z]+(?:\s+\d+)?){0,8}\s+[^\s<>-]\S*\s+)(?!\d*>)[^\s;|&<>]+/g, '$1[redacted]'],
  [/(\bhtpasswd(?!(?:\s+-[A-Za-z]+(?:\s+\d+)?)*?\s+-[A-Za-z]*n)(?:\s+-[A-Za-z]+(?:\s+\d+)?)*?\s+-[A-Za-z]*b[A-Za-z]*(?:\s+\d+)?(?:\s+-[A-Za-z]+(?:\s+\d+)?)*\s+(?:[^\s<>-]\S*\s+)?[^\s<>]+\s+)(?!\d*>)[^\s;|&<>]+/g, '$1[redacted]'],
  // The name read whole, then judged: as words in one pattern, KEY_ repeated
  // took 28 s. PowerShell's `$env:NAME = …` too, in any case, as export's is (e2e audit, 2026-11-01).
  [/((?:\b(?:export\s+([A-Za-z_]\w{0,100})=|setx[ \t]+([A-Za-z_]\w{0,100})[ \t]+)|\$env:([A-Za-z_]\w{0,100})[ \t]*=[ \t]*)(?:\\?["'])?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]{1,2000})/gi, (m, pre, a, b, c, v) => (named(a ?? b ?? c) && !arg(v) && !code(v) && !counted(a ?? b ?? c, v) ? `${pre}[redacted]` : m)],
  // A .env line at a line's start (e2e audit, 2026-11-01): only its own shape, an upper-case name with no blank before `=`, whose
  // last part is the secret's word (envNamed). Any `name = value` was read as one, and Python's `key = item.name`, `CACHE_KEY =
  // "x"` and `TOKEN_URL=https://…` were cut (review, 2026-11-01). Its close relatives too: a compose list item's `- NAME=…`, cmd's
  // `set NAME=…`, and one after a shell's `&&`, `||`, `;` or `|` (an inline variable before a command).
  [/((?:^[ \t]*(?:-[ \t]+)?|(?:&&|\|\||[;|])[ \t]*|(?<=[ \t]))(?:(?:export|set|SET)[ \t]+)?([A-Z][A-Z0-9_]{0,100})=(?:\$?\\?["'])?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]{1,2000})/gm, (m, pre, n, v) => (envNamed(n) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  // 1.4.1 G: a cookie or setting written as a name/value object ({name: 'session', value: '...'}, HAR, Chrome, Postman's {"key": "token", "value": ...}): the name says what the value is.
  [/(\{[^{}\n]{0,200}?["']?(?:name|key)["']?[ \t]*:[ \t]*["']([\w.-]{1,100})["'][^{}\n]{0,200}?,[ \t]*["']?value["']?[ \t]*:[ \t]*["'])([^"'\n]{4,2000})/g,
    (m, pre, n, v) => (/sess|(?:^|[_.-])(?:sid|key|secret|token|password|passwd|pass|pwd|auth|credentials?|cookie)(?:$|[_.-])|apikey|password|secret|token/i.test(n) && !/^(?:\{\{|<|%)/.test(v) && !/(?:^|[_.-])(?:policy|file|path|dir|type|url|length|label|hint)$/i.test(n) && !arg(v) && !code(v) ? pre + '[redacted]' : m)],
  // A JSON password of any length, an escaped quote in it too: to the quote that ends the value (before , } ] or the line's end).
  [/("(?:password|passwd|pwd|pass|passphrase)"[ \t]*:[ \t]*")((?:[^"\\\n]|\\.|"(?![ \t]*(?:[,}\]]|\r?$)))+)(?=")/gim, (m, pre, v) => (v.length < 3 || arg(v) || code(v, true) ? m : pre + '[redacted]')],
  // A long mixed value under a bare key, in JSON or YAML (key, credentials, auth, session): a letter, a digit, 20 or more characters, no path.
  [/((?<![A-Za-z0-9_-])(?:key|credentials?|auth|session)["']?[ \t]*[:=][ \t]*["']?)(?=[A-Za-z0-9+_-]{0,200}\d)(?=[A-Za-z0-9+_-]{0,200}[a-z])(?=[A-Za-z0-9+_-]{0,200}[A-Z])([A-Za-z0-9+_=-]{20,})(?![\w/.-])/g, (m, pre, v) => (code(v) ? m : pre + '[redacted]')],
  [/(::add-mask::)\S+/g, '$1[redacted]'],
  // A Netscape cookie jar's line: domain, flag, path, secure, expiry, name, value.
  [/((?<!\S)\S{1,255}[ \t]+(?:TRUE|FALSE)[ \t]+\S+[ \t]+(?:TRUE|FALSE)[ \t]+\d+[ \t]+\S+[ \t]+)[^\s]{6,}/g, '$1[redacted]'],
  // A literal in code: a PHP 'password' => 'x', a setter (setPassword("x")), the 2nd string of a credential class or auth=("u", "x"), the 3rd of a connect call, a patched getpass.
  [/((["'])([\w.-]{1,100})\2[ \t]*=>[ \t]*["'])([^"'\n]{3,500})/g, (m, pre, q, n, v) => (named(n) && !arg(v) && !code(v) && !RULES.test(v) ? pre + '[redacted]' : m)],
  [/(\.set(?:Password|Passwd|Secret|SecretKey|ApiKey|Token|AccessKey|Passphrase)\(\s*["'])([^"'\n]{3,500})/g, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  [/(\b(?:NetworkCredential|HTTPBasicAuth|HTTPDigestAuth|UsernamePasswordCredentials|PasswordAuthentication|auth[ \t]*=[ \t]*)\(?[ \t]*(?:"[^"\n]{0,100}"|'[^'\n]{0,100}')[ \t]*,[ \t]*["'])([^"'\n]{3,500})/g, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  [/(\b(?:mysqli_connect|new[ \t]+mysqli|PlainAuth|getConnection|new[ \t]+PDO)\([ \t]*(?:"[^"\n]*"|'[^'\n]*'|[^,\n()"']{0,200}),[ \t]*(?:"[^"\n]*"|'[^'\n]*'|[^,\n()"']{0,100}),[ \t]*["'])([^"'\n]{3,500})/g, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  [/(\bgetpass\b[^\n]{0,60}?\blambda\b[^:\n]{0,40}:[ \t]*["'])([^"'\n]{3,500})/g, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  // A base64 credential fed to a decoder: echo X | base64 -d, base64 --decode <<< X (16 or more characters).
  [/(\b(?:echo|printf)(?:[ \t]+-[neE]+)?[ \t]+["']?)(?!\/)(?=[a-z/]*[A-Z0-9+])[A-Za-z0-9+/]{16,}={0,2}(?=["']?[ \t]*\|[ \t]*base64[ \t]+(?:-[dD]|--decode)\b)|(\bbase64[ \t]+(?:-[dD]|--decode)\b[^\n|;&<]{0,50}?<<<[ \t]*["']?)[A-Za-z0-9+/]{16,}={0,2}/g, (m, a, b) => (a ?? b) + '[redacted]'],
  // An echoed prompt: "[sudo] password for bob: X", "Enter passphrase for key '/path': X".
  [/(\b(?:password|passphrase)[ \t]+for[ \t]+(?:key[ \t]+)?(?:'[^'\n]{1,300}'|"[^"\n]{1,300}"|[^\s:'"]{1,100})[ \t]*:[ \t]*)([^\s"']{4,200})/gi, (m, pre, v) => (/[\d!@#$%^&*]/.test(v) && !arg(v) && !code(v) ? pre + '[redacted]' : m)],
  // A Kubernetes env entry, `- name: NAME` then `value: …` on the next line, judged by the name as a .env line is (review,
  // 2026-11-01).
  [/(-[ \t]+name:[ \t]*["']?([A-Za-z_][A-Za-z0-9_]{0,100})["']?[ \t]*\r?\n[ \t]+value:[ \t]*["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,2000})/g,
    (m, pre, n, v) => (envNamed(n.toUpperCase()) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  [/(\bgh\s+secret\s+set\b[^\n|;&]{0,200}?\s(?:--body|-b)[ =]["']?)([^\s"']{1,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  [/((?<![A-Za-z0-9])_auth(?:Token)?(?:[ \t]*=[ \t]*|[ \t])["']?)([^\s"']{1,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // `mysql -pIT`: the password glued to the flag. Case kept: -P is the port.
  // In the mysql command only: `; find . -print` after it was cut. 7z as a command, not a `*.7z` file name before -print.
  [/((?:\b(?:mysql|mysqldump|mysqladmin|mariadb)|(?<![\w.*])7za?)\b[^\n|;&]{0,200}?\s-p)[^\s-][^\s]{2,}/g, '$1[redacted]'],
  // mysql -p at the end of a line: the password typed at the prompt is the next non-empty line (its first word, when it has a digit or symbol: a plain word is a database name or a command; shortcut: a password with no digit or symbol is kept, no way to tell it from a database name).
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*)([^\s"']{3,200})/g, (m, pre, v) => (arg(v) || !/[0-9!@#$%^&*]/.test(v) ? m : pre + '[redacted]')],
  // The same with a line break, a here-string or a non-ASCII blank between the flag and the value; a plain blank is mysql asking for the password, and what follows is a database name.
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p(?:[ \t]*<<<[ \t]*|[^\S \t\r\n]+)["']?)(?![-<])((?<=")[^"\n]{3,2000}(?=")|(?<=')[^'\n]{3,2000}(?=')|[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // -p'x' with no command before it, and an HTML password input.
  [/((?:^|[\s;|&])-p)(?:"[^"\n]{3,2000}"|'[^'\n]{3,2000}')/g, '$1[redacted]'],
  [/(<input\b[^>]{0,200}?\btype=["']?password["']?[^>]{0,200}?\bvalue=["']?)[^"'>\s]{1,2000}/gi, '$1[redacted]'],
  // "my password is IT": one with a digit or a symbol, as a password has --
  // "the password is hashed" names none.
  // Also "the password for the prod db is IT", "the api key is IT", and
  // "password IT" with no verb, when IT has a letter and a digit.
  [/\b((?:password|passwd|passphrase|api[ _-]?key|token|secret)(?:\s{1,5}(?:for|of|to)\s{1,5}[^.,;:\n]{1,40}?)?\s{1,5}(?:is|was)\s{1,5})["']?(?=\S*[0-9!@#$%^&*_+=-])[^\s"',;]{3,}[^\s"',;.]/gi, '$1[redacted]'],
  [/\b((?:password|passwd)\s{1,3})(?=[^\s"',;]{0,200}\d)(?=[^\s"',;]{0,200}[A-Za-z])[^\s"',;:]{6,}/gi, '$1[redacted]'],
  // 1.4.1 H: prose and chat (redaction-corpus-39, secret-paths-7). Each value has a digit or a symbol, as a password has.
  // "set the password to X", "change my pw to X", "the PIN is X".
  [/(\b(?:(?:set|change|reset|update)\b[^\n.;:]{0,30}?\b(?:password|passwd|passphrase|passcode|pwd|pw|pin)\s{1,5}(?:to|as)|(?:pw|pin|passcode)\s{1,5}(?:is|was))\s{1,5}["']?)(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{3,200}[^\s"',;.])/gi, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  // "PW X" in capitals; "and pass X", "with pwd X".
  [/(\bPW[ \t]{1,5})(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{5,200}[^\s"',;.])/g, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  [/(\b(?:and|with|plus)\s{1,5}(?:pass|pwd|pw)\s{1,5}["']?)(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{4,200}[^\s"',;.])/gi, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  // "login with me / X", "creds: bob / X", "the credentials are me:X"; then "credential=X". Not a URL (`login: http://h`).
  [/(\b(?:creds?|credentials?|logins?|log[ -]?in|sign[ -]?in)\b(?:[ \t:]{1,3}(?:with|are|is|as|for))?[ \t:]{1,3}[^\s/:"']{1,40}[ \t]{0,3}[/:][ \t]{0,3}["']?)(?![/\\])(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{5,200}[^\s"',;.])/gi, (m, pre, v) => (arg(v) || code(v) || /^[\w./-]+\.[A-Za-z]{1,5}(?::\d+)*`?$/.test(v) ? m : pre + '[redacted]')],
  [/(\b(?:creds?|credentials?)[ \t]{0,3}[:=][ \t]{0,3}["']?)(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{5,200}[^\s"',;.])/gi, (m, pre, v) => (arg(v) || code(v) || /^[\w./-]+\.[A-Za-z]{1,5}(?::\d+)*$/.test(v) ? m : pre + '[redacted]')],
  // A list of one-time codes: the rest of the sentence, when it holds a digit.
  [/(\b(?:recovery|backup|unlock|reset|verification|2fa|mfa|otp)[ -]?(?:codes?|keys?)\b[ \t]{0,3}(?:are|is|[:=])[ \t]{0,3})(?=[^\n.;]{0,300}\d)([^\n.;]{4,300})/gi, (m, pre, v) => (v.toLowerCase().split(/\s+/).some((x) => FUNC.has(x)) ? m : pre + '[redacted]')],
  // "the password is correct horse battery staple, remember it" or "...is sunshine": a clause-ending run of three to six lowercase words, or one word of 8 or more letters not ending in -ed ("was replaced"), with no function word or adjective in it ("the password is not stored in it", "is hashed").
  [/(\b(?:password|passwd|passphrase|passcode|pw)(?:\s{1,5}(?:for|of)\s{1,5}[^.,;:\n]{1,40}?)?\s{1,5}(?:is|was)\s{1,5}["']?)([a-z]{2,40}(?: [a-z]{2,20}){0,5})(?=["']?[ \t]*(?:[,.;:!?]|$))/gim,
    (m, pre, v) => { const w = v.split(' '); return (w.length === 2 || (w.length === 1 && (w[0].length < 8 || w[0].endsWith('ed'))) || w.some((x) => FUNC.has(x))) ? m : pre + '[redacted]'; }],
  // Other languages in prose: "Passwort ist X", "mot de passe est X", "пароль X".
  [/((?<![\p{L}\d])(?:passwort|kennwort|mot de passe|contrase[nñ]a|senha|wachtwoord|l[öo]senord|adgangskode|kodeord|heslo|salasana|jelsz[oó]|[sş]ifre|has[lł]o|пароль)(?:[ \t]{1,5}(?:ist|lautet|est|es|[eé]|is|[äa]r|er|je|on))?[ \t]{1,5}["']?)(?=[^\s"',;]{0,200}[\d!@#$%^&*])([^\s"',;]{5,200}[^\s"',;.])/giu, (m, pre, v) => (arg(v) || code(v) ? m : pre + '[redacted]')],
  // SQL: `WITH PASSWORD 'x'`, `PASSWORD('x')`, `IDENTIFIED [WITH plugin] BY 'x'`; the value quoted, to its closing quote (1.3.2).
  [/(\b(?:password(?:\s{1,5}\(?|\()|identified\s{1,5}(?:with\s{1,5}\w{1,40}\s{1,5})?by)\s{0,5})(["'])([^"'\n]{1,200})(?=\2)/gi, (m, pre, q, v) => (arg(v) || code(v) ? m : `${pre}${q}[redacted]`)],
  // XML: `<password>x</password>` (the tag's name ends in the word), and `<add key="DbPassword" value="x"/>` (1.3.2).
  [/(<[\w.:-]{0,40}(?:password|passwd|pwd|secret|apikey|token)(?=[\s>])[^>]{0,100}>(?:<!\[CDATA\[)?)([^<\n]{3,500})(?=<)/gi, (m, pre, v) => (arg(v) || code(v) ? m : `${pre}[redacted]`)],
  [/(\bkey=["'][\w.-]{0,40}(?:password|passwd|pwd|secret|apikey|token)["']\s{1,5}value=["'])[^"'\n]{3,500}/gi, '$1[redacted]'],
  // Windows: PowerShell's ConvertTo-SecureString "x" and `$pw = "x"`, `net use Z: \\host\share x`, `schtasks /rp x` (1.3.2).
  [/(\bConvertTo-SecureString\s{1,5}(?:-String\s{1,5})?)("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"'-]\S{0,200})/gi, (m, pre, v) => (arg(v.replace(/^["']/, '')) ? m : `${pre}[redacted]`)],
  [/(\$(?:pw|pwd|pass|passwd|password|passphrase|secret|token|apikey|\w{1,40}(?:password|secret|token|apikey))[ \t]{0,5}=[ \t]{0,5})("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"';|&]{1,200})/gi, (m, pre, v) => (arg(v.replace(/^["']/, '')) || code(v) ? m : `${pre}[redacted]`)],
  [/(\bnet\s{1,5}use\s{1,5}(?:[A-Za-z]:\s{1,5})?\\\\\S{1,200}\s{1,5})(?![/*])(?:"[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"']{1,200})/gi, '$1[redacted]'],
  [/(\bschtasks\b[^\n|;&]{0,300}?\s\/rp\s{1,5})(?!\*)(?:"[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"']{1,200})/gi, '$1[redacted]'],
  // The word can end a longer name, glued (PGPASSWORD=, dbPassword, clientSecret,
  // stripeApiKey) or not (DB_PASSWORD=, AWS_SECRET_ACCESS_KEY=), and the value
  // can sit on the next line (YAML). `pwd` needs its own start. Bounded, so no
  // input backtracks. Not a bare `token`: "input_tokens: 863324" is a count.
  // `pass` alone too (DB_PASS=, pass:), and a key's data. Not a value that
  // is plainly code: `password: string`, `token = jwt.sign(payload`,
  // `secret: process.env.JWT_SECRET`, `${DB_PASSWORD}`, a path.
  // Each child of a YAML parent key that names a secret (`passwords:\n  admin: X\n  root: Y`, `secrets:\n  db: X`): only the
  // parent's name says what they are (e2e audit, 2026-11-01). Only the lines indented under it, and only a value that looks like a
  // secret (yamlSecret): read on to any indented line, the siblings after it were cut (GitHub Actions' runs-on, Helm's username),
  // and so were names and settings under it (OpenAPI's `type: apiKey`, design tokens) (review, 2026-11-01). A child a line, each
  // line read once: linear.
  [/^([ \t]*)((?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?[ \t]*:[ \t]*\r?\n)((?:\1[ \t]+[\w.-]{1,40}[ \t]*:[^\n]{0,500}(?:\n|$))+)/gim,
    (m, ind, head, tok, block) => ind + head + block.replace(/^([ \t]+[\w.-]{1,40}[ \t]*:[ \t]*["']?)([^\s"',;]{6,})/gm, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))],
  // The same in JSON: each string in an object under a key that names a secret (`"secrets": {"db": "…"}`), judged as a YAML child
  // is (review, 2026-11-01). An object of one level only, read to its first `}`, bounded.
  [/("(?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?"[ \t]*:[ \t]*\{)([^{}]{0,2000})\}/gi,
    (m, head, tok, body) => `${head}${body.replace(/("[\w.-]{1,40}"[ \t]*:[ \t]*")([^"\n]{6,200})(?=")/g, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))}}`],
  // A value is never a key (a name and a colon with more after it: blanks then a value on its line, or a line break then an
  // indented child): taken for the parent's value, the child after it was kept (`secret:\n  password: X`, `secret: password: X`;
  // e2e audit, 2026-11-01). Only that shape: a value ending in `:` before a blank or at its line's end was taken for a key, and
  // a password such as `"Tr0ub4dor&3:"` or `Tr0ub4dor3:` was kept (review rounds 1 and 2, 2026-11-01).
  // A quoted value goes whole, blanks and all, as in a command; it is never a key. Unquoted, a value ends at its first blank
  // (`password: p@ss w0rd` keeps all of it: `p@ss` is under 6), since prose follows a value as often as a second word does.
  // An Azure connection string's SharedAccessKey too, not its SharedAccessKeyName (e2e audit, 2026-11-01).
  // Not a note's `originSessionId: <uuid>`: Claude Code's own front matter, and cut it held every edited note out of the snapshots.
  [/((?:password|passwd|passphrase|secret|(?:access|auth|refresh|api|session)[_-]?token|(?<!origin)(?:j|php|asp\.net_)?sess(?:ion)?[_-]?id|connect\.sid|(?:api|account|private|secret|preshared)[ _-]?key|identitytoken|registrytoken|access[ _-]key|(?:access|auth|subscription)key(?!name)|(?:auth|subscription)[ _-]key|sharedaccesskey(?!name)|key-data|(?<![A-Za-z0-9])pwd|(?<![A-Za-z0-9])(?:psw|salt)(?![a-z])|pw(?![a-z])|passwort|kennwort|mot[ _]de[ _]passe|contrase[nñ]a|wachtwoord|senha|has[lł]o|heslo|salasana|jelsz[oó]|[sş]ifre|пароль|l[öo]senord|adgangskode|kodeord|パスワード|密码|密碼|비밀번호|(?<![A-Za-z0-9])pass(?![a-z]))[A-Za-z0-9_]{0,40}(?:\[[\w.-]{0,40}\])*\\*["']?\]?\s{0,20}(?::=|[:=\uFF1A])\s{0,20}(?:[|>][+-]?[ \t]*\r?\n[ \t]*|&\w{1,40}[ \t]+|\[[ \t]*(?=["']))?(?:(?:\\*["']){1,2}|\$'|\{)?)((?<=\\")(?:(?!\\")[^\n]){6,2000}(?=\\")|(?<=")(?![\r\n])(?:[^"\\]|\\.){6,2000}(?:"[ \t]*\+[ \t]*"(?:[^"\\]|\\.){0,2000})*(?=")|(?<=')[^'\n]{6,2000}(?=')|(?<=\{)[^}\n"':{]{6,500}(?=\})|(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))(?:[^\s"',;]|[,;](?=[^\s"',;])){6,})/gi, (m, pre, v, at, all) => (code(v, /["']\s*:\s*["']$/.test(pre) || /\b(?:self|this)\.$/.test(all.slice(Math.max(0, at - 5), at))) || prose(v, all.slice(at + m.length)) || passNoun(all.slice(Math.max(0, at - 40), at + pre.length), v) || ((/:\s*["']*$/.test(pre) || /(?:name|ref)["']?\]?\s*[:=]/i.test(pre)) && /^[a-z]+(?:-[a-z]+)*-(?:secret|credentials?|token|key)s?$/.test(v)) ? m : `${pre}[redacted]`)],
  // A bare `token=` or `token:` whose value has a letter: a key, not a count.
  [/((?<![A-Za-z0-9])tokens?["']?[ \t]{0,20}[:=\uFF1A]\s{0,20}["']?)(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))(?=[^\s"',;]{0,200}[A-Za-z])([^\s"',;]{6,})/gi, (m, pre, v) => (code(v) || (/tokens\W*$/i.test(pre) && /^[a-z]+$/.test(v)) ? m : `${pre}[redacted]`)],   // "the login tokens: restore": prose
  // 1.4.1 F: databases, brokers, mail and file protocols, Windows tools, Wi-Fi and VPN, config files, password hashes (redaction-corpus-24, -25, -27, -28, -29, -32, -33, -37).
  // A hash first, whole (`$6$salt$hash`, with a `\$` as a shell escape shows it): 25 characters or more, so `$1$2$3` stays.
  [/(?<![\w$])\$(?:apr1|2[abxy]|argon2(?:id|i|d)|[156y])(?:\\?\$[\w./,=+-]{1,100}){2,6}/g, (m) => (m.length >= 25 ? '[redacted]' : m)],
  [/(?<![\w-])[0-9a-f]{32}:[0-9a-f]{32}(?![\w-])/gi, '[redacted]'],
  [/\b01000000d08c9ddf0115d1118c7a00c04fc297eb[0-9a-f]{20,}/gi, '[redacted]'],
  // Oracle: user/pass@db after sqlplus and friends, and in a JDBC URL; IDENTIFIED BY with no quotes (a digit or symbol in it, as prose says "identified by the admin").
  [/(\b(?:sqlplus|sqlldr|impdp|expdp|rman|tnsping)\b[^\n|;&]{0,200}?\s["']?[\w$#.-]{1,60}\/"?)([^\s"'@/]{3,200})(?=@|["'\s]|$)/gi, (m, p, v) => (arg(v) ? m : `${p}[redacted]`)],
  [/(\bjdbc:oracle:[a-z]{2,5}\d*:["']?[\w$#.-]{1,60}\/)([^\s"'@/]{3,200})(?=@)/gi, '$1[redacted]'],
  [/(\bidentified\s{1,5}(?:with\s{1,5}\w{1,40}\s{1,5})?by\s{1,5})(?=[^\s"';,()[]*[\d!@#$%^&*])([^\s"';,()[]{3,200})/gi, (m, p, v) => (arg(v) || code(v) ? m : `${p}[redacted]`)],
  [/(\b(?:set\s{1,5}password\b[^\n;=]{0,100}?|password)\s{0,5}=\s{0,5}N?)(["'])([^"'\n]{1,200})(?=\2)/gi, (m, pre, q, v) => (arg(v) || code(v) ? m : `${pre}${q}[redacted]`)],
  [/(\bchangeUserPassword\(\s*["'][^"'\n]{1,100}["']\s*,\s*["'])([^"'\n]{1,200})/g, (m, p, v) => (arg(v) || code(v) ? m : `${p}[redacted]`)],
  // A redis-cli session's prompt line (`127.0.0.1:6379> AUTH [user] pass`), Mosquitto's -b, Confluent's key and secret.
  [/(\d{1,5}(?:\[\d+\])?>[ \t]*AUTH[ \t]+)(?!\[redacted\])((?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+))?)/g, (m, p, v) => (v.split(/\s+/).every(arg) ? m : `${p}[redacted]`)],
  after(String.raw`\bmosquitto_passwd\b[^\n|;&]{0,100}?\s-b\s+\S+\s+\S+\s+`),
  [/(\bapi-key\s+store\s+)["']?[\w+/=-]{8,}["']?(?:\s+["']?[\w+/=-]{8,}["']?)?/g, '$1[redacted]'],
  // Mail and file transfer: postfix's sasl_passwd (`[host]:587 user:pass`), IMAP LOGIN, POP3 and FTP PASS (6 or more characters, a digit or symbol, no path or file name), lftp -u user,pass, curl's -K file `user = "me:pass"`.
  // A clock time, ratio, score or file:line (digits only, or a source file name) before a label is not a host. shortcut: a host name over 253 characters is not matched whole (not a valid host), upgrade if one is seen.
  [/(?<![\w.-])(?!\d+:)(?![\w.-]{0,253}\.(?:m?js|cjs|[jt]sx?|py|go|rs|java|rb|c|h|cpp|cs|php|md|json|ya?ml|txt|sh):)(\[?[\w.-]{1,253}\]?:\d{1,5}[ \t]+[^\s:@[]{1,100}:)(?!\[redacted\])([^\s]{3,200})/g, (m, p, v) => (arg(v) || (/\.(?:m?js|cjs|[jt]sx?|py|go|rs|java|rb|c|h|cpp|cs|php|md|json|ya?ml|txt|sh|s?css|html?):$/.test(p) && /^\d+(?!\w)/.test(v)) ? m : `${p}[redacted]`)],   // a file:line as the user ("1.85:1 (`office.css:309`")
  after(String.raw`\b[A-Za-z]{0,3}\d{1,5}[ \t]+LOGIN[ \t]+(?:"[^"\n]{1,100}"|[^\s"']{1,100})[ \t]+`, 'g', true),
  [/((?<![\w.-])PASS[ \t]+)([^\s"'/\\]{6,200})(?=\s|$)/g, (m, p, v) => (/[\d!@#$%^&*]/.test(v) && !arg(v) && !code(v) && !/\.[A-Za-z]\w{0,6}$/.test(v) && !/^\(?\d{4}-\d\d-\d\d\b/.test(v) ? `${p}[redacted]` : m)],   // a date: "tests PASS (2026-07-16, ...)"
  [/(\b(?:lftp|open)\b[^\n|;&]{0,200}?\s-u[ \t]*["']?[^\s,"']{1,100},)([^\s"']{3,200})/g, (m, p, v) => (arg(v) ? m : `${p}[redacted]`)],
  [/((?<![\w.?&-])user[ \t]*=[ \t]*["']?[^\s:"']{1,100}:)([^\s"']{3,200})/g, (m, p, v) => (/[\d!@#$%^&*]/.test(v) && !arg(v) ? `${p}[redacted]` : m)],
  // Windows: rdesktop -p, net user NAME PASS, net use ... /user:NAME PASS, psexec -p, a Wi-Fi profile's Key Content and netsh's key=.
  after(String.raw`\brdesktop\b[^\n|;&]{0,200}?\s-p\s+`),
  after(String.raw`\bnet1?\s+user\s+(?:"[^"\n]{1,100}"|[^\s"'/*]{1,100})\s+`, 'gi', true),
  after(String.raw`\bnet\s+use\b[^\n|;&]{0,300}?\s\/user:\S+\s+`, 'gi'),
  after(String.raw`\bpsexec6?4?(?:\.exe)?\b[^\n|;&]{0,200}?\s-p\s+`, 'gi'),
  after(String.raw`\bKey Content[ \t]*:[ \t]*`, 'gi'),
  [/(\bnetsh\b[^\n|;&]{0,200}?\skey=)(?!(?:clear|material)\b)["']?[^\s"']{3,200}/gi, '$1[redacted]'],
  // Wi-Fi and VPN: nmcli's wifi-sec.psk, wpa_supplicant's psk=, wpa_passphrase, an OpenVPN inline login, ipsec.secrets.
  after(String.raw`\bnmcli\b[^\n|;&]{0,200}?\s[\w-]+\.(?:psk|password|wep-key\d?|private-key-password|secrets?)\s+`),
  after(String.raw`(?<![\w-])(?:psk|wep_key\d|private_key_passwd)[ \t]*=[ \t]*`, 'g'),
  after(String.raw`\bwpa_passphrase\s+(?:"[^"\n]{1,32}"|[^\s"']{1,32})\s+`, 'g'),
  [/((?:<|&lt;)auth-user-pass>)[^<]{1,400}?(?=(?:<|&lt;)\/auth-user-pass)/g, '$1[redacted]'],
  after(String.raw`:[ \t]*(?:PSK|XAUTH)[ \t]+`, 'g'),
  // PowerShell: -ApiKey, -Token, -Password... given a plain word, and Set-Item of a secret's variable.
  after(String.raw`(?<![\w-])-[A-Za-z]*(?:ApiKey|Token|Secret|Password|Passphrase|AccessKey)[ \t]+`, 'g'),
  after(String.raw`\bSet-Item\b[^\n|;&]{0,200}?Env:\w*(?:PASS|PWD|SECRET|TOKEN|KEY)\w*[^\n|;&]{0,100}?-Value[ \t]+`, 'gi'),
  // Config files and tools: .pgpass, p4 -P, ldappasswd, slapd and sssd's bind password, Jenkins -auth, ASP.NET machineKey.
  [/((?<![\w.:*-])[\w.*-]{1,100}:(?:\d{4,5}|\*):[\w.*-]{1,100}:[\w.*-]{1,100}:)(?!\[redacted\])([^\s]{3,200})/g, (m, p, v) => (arg(v) || v6(p + v) ? m : `${p}[redacted]`)],
  after(String.raw`\bp4\b[^\n|;&]{0,100}?\s-P\s+`, 'g'),
  after(String.raw`\bldappasswd\b[^\n|;&]{0,200}?\s-[swa]\s*`, 'g'),
  after(String.raw`(?<![\w-])(?:bindpw|rootpw|ldap_default_authtok)(?:[ \t]*=[ \t]*|[ \t]+)`, 'g'),
  after(String.raw`\bjenkins[\w.-]*\b[^\n|;&]{0,200}?\s-auth\s+["']?[^\s:"']{1,100}:`, 'g'),
  [/(\b(?:validation|decryption)Key\s*=\s*["']?)(?!AutoGenerate)[^"'\s>]{16,}/gi, '$1[redacted]'],
  // Password tools: openssl enc -k and passwd, gpg-preset-passphrase -P, rclone obscure, elasticsearch-reset-password's output, useradd and usermod -p, mkpasswd.
  after(String.raw`\bopenssl\b[^\n|;&]{0,200}?\s-k\s+`, 'g'),
  after(String.raw`\bopenssl\s+passwd\b(?:\s+(?:-salt\s+\S+|-\w+))*\s+`, 'g'),
  after(String.raw`\bgpg-preset-passphrase\b[^\n|;&]{0,100}?\s-P\s+`, 'g'),
  after(String.raw`\brclone\s+obscure\s+`, 'g'),
  after(String.raw`\bNew value:[ \t]+`, 'g', true),
  after(String.raw`\b(?:useradd|usermod)\b[^\n|;&]{0,200}?\s(?:-p|--password)[ \t]+`, 'g'),
  after(String.raw`\bmkpasswd\b(?:\s+-{1,2}[\w-]+(?:=\S+|\s+[A-Za-z0-9][A-Za-z0-9-]{1,11}(?=\s+[^\s-]))?){0,6}\s+`, 'g'),
];
const redactRaw = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);
// A backslash line wrap is joined first (it cuts a secret in two), then the raw rules run (on the original when the join finds none: it can glue a NAME_KEY= line onto the one above), then the same rules on a folded copy of that:
// look-alike letters, marks and hidden characters gone (NFKD, no marks, no Default_Ignorable), and an entity, a \u00XX or a %XX that
// spells printable ASCII decoded. Text with no secret is returned as written.
// shortcut: homoglyphs from another script (Cyrillic o for Latin o) are not folded; there is no safe map, add one if one is ever seen used.
const fold = (s) => s.normalize('NFKD').replace(/\p{M}|\p{Default_Ignorable_Code_Point}/gu, '')
  .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(quot|apos));/gi, (m, d, h, n) => { const c = n ? (n.toLowerCase() === 'quot' ? 34 : 39) : parseInt(d ?? h, d ? 10 : 16); return c > 31 && c < 127 ? String.fromCharCode(c) : m; })
  .replace(/\\{1,8}u00([2-7][0-9a-f])|%([2-7][0-9a-f])/gi, (m, a, b) => String.fromCharCode(parseInt(a ?? b, 16)));
// Kept by exact text for the process: a Stop redacts the same 80 texts about four times over (clip at each length, and again on what
// it cut). Pure, so a kept result is the result. Emptied once its texts pass 8 M characters; a text under 64 is cheaper to redo.
const kept = new Map();
let keptSize = 0;
export const redact = (s) => {
  if (s.length < 64) return redactOnce(s);
  let out = kept.get(s);
  if (out === undefined) {
    out = redactOnce(s);
    if ((keptSize += s.length) > 8e6) { kept.clear(); keptSize = s.length; }
    kept.set(s, out);
  }
  return out;
};
const redactOnce = (s) => {
  // Not before a bare `key:` line: no shell command goes on with one, and a markdown line break (`\`) glued a YAML head onto prose (fuzz 1059385974).
  const u = s.replace(/\\\r?\n(?![ \t]*[\w.-]{1,40}:[ \t]*(?:\r?\n|$))[ \t]*/g, ''), r0 = redactRaw(u), r = r0 === u && u !== s ? redactRaw(s) : r0, base = r === s ? u : r, f = fold(base), g = f === base ? r : redactRaw(f);
  return g === f ? (r === s ? s : r) : g;   // the folded text only when its pass found a secret the raw one missed
};
// Does a note's own text hold a secret? Anything inside the <private> tag does, closed or not ("<private/>" opens one too): the
// tag is where a user puts what no rule names, such as a PIN (1.4.3 review). A note that only explains the tag holds none (defect
// hunt 1.4.3, L3-3): a tag in backticks, a tag followed by the word "tag" and then a word with no digit ("tag 4821" is a
// PIN, "tag is new in 1.4.2" is prose), or the tag around nothing, "and" or a placeholder ("...", "x", "your secret"), quotes
// and backticks aside. Then the tags are unwrapped and the whole text checked like any other, so a key beside a mention still
// holds. shortcut: a secret of letters only that starts with the word "tag" passes; a word list can't tell it from prose.
// One "\s*" before the optional "/": two in a row made a "<" before 100,000 spaces take 13 s. A placeholder is short, so a long
// span is never tested against them.
const TAG = /<\s*(\/\s*)?private(?![-_\w])([^>]*)>?/gi;
const mention = (s) => /^\s*tags?\b(?!\W*\w*\d)/i.test(s) ||
  (s.length < 40 && /^(?:\.{3}|…|x|and|or|(?:your|the|a|my)?(?:text|secret|value|key|password)s?)?$/i.test(s.replace(/[\s`'"]/g, '')));
export const holdsSecret = (t) => {
  let open = -1;
  for (const m of t.matchAll(TAG)) {
    if (t[m.index - 1] === '`' && t[m.index + m[0].length] === '`') continue;   // `<private>` as inline code names the tag
    if (!m[1]) { if (open < 0) open = m.index + m[0].length; }
    else if (open >= 0) { if (!mention(t.slice(open, m.index))) return true; open = -1; }
  }
  if (open >= 0 && !mention(t.slice(open))) return true;
  const n = t.replace(TAG, (_, c, a) => ` ${a.replace(/\/\s*$/, '')} `); return redact(n) !== n;
};

// A reply that is one token with a digit or a symbol, to a question that asks for a password, token or key: the value alone, with no
// keyword to redact it by (secret-paths-9). shortcut: a one-word answer of letters only ("hunter") is kept.
const ASKS_SECRET = (q) => /\b(?:pass(?:word|phrase|code)|pwd|pin|tokens?|secret|api[ _-]?key|credentials?)\b/i.test(q) && /\?|\b(?:paste|enter|send|share|provide|type|give)\b/i.test(q);
// Also a passphrase typed alone (3 to 8 plain words). Shared with compact-gate's note. shortcut: any 3-word reply to a secret question is cut too.
export const BARE = (a, q) => (/^\S{4,200}$/.test(a) && /[^A-Za-z]/.test(a) || /^[a-z]+(?: [a-z]+){2,7}$/i.test(a) && !a.toLowerCase().split(' ').some((w) => FUNC.has(w))) && ASKS_SECRET(q.slice(-400));
