import { createHash } from 'node:crypto';
import { redact } from './store.mjs';
import { tame } from './recall.mjs';

// The page of the journal: one local HTML file built from plain data. This file
// touches no disk; memory.mjs reads the journal, calls pageHtml and writes the result.
// The helpers below are also pasted into the page's script (String(fn)), so each
// stands on its own arguments and on the helpers above it, nothing else.

// A day 'YYYY-MM-DD' moved by n days, worked out at noon UTC so no clock change shifts it.
export function addDays(day, n) {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// The seven days ending on `end`, oldest first.
export function weekOf(end) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(end, -i));
  return days;
}

// Whether an entry shows for a search `q` (every word, anywhere in its text) and a project `p` ('' is all).
// A private turn has no text kept, so it never answers a search.
export function matches(e, q, p) {
  if (p && e.p !== p) return false;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (e.priv) return false;
  const hay = e.h ??= [e.p, e.q, e.a, e.c, e.b, ...(e.f || [])].join('\n').toLowerCase(); // kept on the entry: a keystroke searched them all again
  return words.every((w) => hay.includes(w));
}

// The shade 0-4 of a day with n exchanges when the busiest has max.
export function level(n, max) {
  return n > 0 ? Math.ceil((n / max) * 4) : 0;
}

// Whole days from the day the page was built to `now`.
export function daysAgo(built, now) {
  return Math.round((Date.parse(`${now}T12:00:00Z`) - Date.parse(`${built}T12:00:00Z`)) / 86400000);
}

// The look is the approved mock-up (docs/plans/page-look/reference.html); the logo is docs/art/brain.png, inside the page.
const LOGO = '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';
const STYLE = String.raw`
:root{
  --ink:#f4f8ff;--body:#c3cfea;--muted:#94a3c8;--cyan:#22d3ee;--cyan-ink:#a5f3fc;
  --line:rgba(130,170,255,.2);--line-2:rgba(130,170,255,.4);
  --surface:linear-gradient(180deg,rgba(80,125,255,.14),rgba(40,60,150,.06));
  --sans:Inter,"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
  --mono:"JetBrains Mono","Cascadia Code",Consolas,ui-monospace,monospace;
  --ease-out:cubic-bezier(.23,1,.32,1);--ease-in-out:cubic-bezier(.77,0,.175,1);
  --r:18px;
}
.p0{--c:#22d3ee}.p1{--c:#a78bfa}.p2{--c:#f472b6}.p3{--c:#fbbf24}.p4{--c:#34d399}.p5{--c:#60a5fa}
*{box-sizing:border-box}
html{color-scheme:dark;scrollbar-color:rgba(130,170,255,.45) #050a23}
::selection{background:rgba(34,211,238,.35);color:var(--ink)}
[hidden]{display:none!important}
body{margin:0;min-height:100vh;color:var(--body);font:400 15.5px/1.55 var(--sans);background:#050a23;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-2;background:radial-gradient(900px 520px at 8% -10%,rgba(37,99,235,.5),transparent 62%),radial-gradient(760px 480px at 104% 4%,rgba(124,58,237,.42),transparent 62%),radial-gradient(700px 420px at 50% 112%,rgba(34,211,238,.13),transparent 60%),linear-gradient(180deg,#081133,#050a23 55%,#040719)}
body::after{content:"";position:fixed;inset:0;z-index:-1;background-image:radial-gradient(rgba(160,190,255,.17) 1px,transparent 1.2px);background-size:26px 26px;-webkit-mask-image:radial-gradient(900px 560px at 50% 0,#000,transparent 75%);mask-image:radial-gradient(900px 560px at 50% 0,#000,transparent 75%)}
:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
button{font:inherit}
.skip{position:absolute;left:16px;top:-80px;z-index:30;padding:10px 14px;border-radius:10px;border:1px solid var(--cyan);background:#0b143f;color:var(--ink);font-weight:650;text-decoration:none}
.skip:focus{top:12px}
main:focus-visible{outline:0}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.i{width:1em;height:1em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--c)}
.glass{border-radius:var(--r);border:1px solid var(--line);background:var(--surface);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 24px 48px -22px rgba(0,0,0,.75)}
.wrap,.top-in{max-width:1200px;margin:0 auto;padding:0 28px}

/* Top bar: glass that content scrolls under */
.top{position:sticky;top:0;z-index:20;-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);background:rgba(6,12,40,.5);border-bottom:1px solid transparent;transition:border-color .2s,background-color .2s}
.top.stuck{border-color:var(--line);background:rgba(6,12,40,.8)}
/* The title, the logo in the middle, the search: two equal side columns keep the logo centred. */
.top-in{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:14px;height:68px}
.brand{grid-column:1;grid-row:1;min-width:0}
/* The logo of the project page: the brain, a ring carrying one moon, and a recall trace. Every size follows --w.
   --kx and --ky turn the ring's size into background-position percentages for the moon. */
.logo-orbit{--w:100px;--kx:56.4%;--ky:84.5%;position:relative;display:grid;place-items:center;grid-column:2;grid-row:1;width:var(--w);height:calc(var(--w)/2)}
.logo-orbit::before,.logo-orbit::after{content:"";position:absolute;left:50%;top:50%;width:var(--w);height:calc(var(--w)*.292);margin:calc(var(--w)*-.146) 0 0 calc(var(--w)*-.5);border:1px solid rgba(125,211,252,.4);border-radius:50%;transform:rotate(-12deg);pointer-events:none}
.logo-orbit::after{clip-path:inset(50% 0 0 0);background:radial-gradient(circle at 84% 86%,#cffafe 0 calc(var(--w)*.014),rgba(34,211,238,.45) calc(var(--w)*.021),transparent calc(var(--w)*.05))}
.logo-orbit img{position:relative;width:calc(var(--w)*.4167);height:auto;filter:drop-shadow(0 0 9px rgba(34,211,238,.55))}
.nn{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.nn .glow{filter:drop-shadow(0 0 3px #fff) drop-shadow(0 0 10px rgba(34,211,238,.95))}
.nn .dot{fill:#f0fdff;stroke:#071033;stroke-width:1.2;opacity:.95}
.nn .c2{fill:#cffafe;opacity:0;transform-box:fill-box;transform-origin:center}
.nn .b2,.nn .r2{fill:none;stroke:#cffafe;stroke-width:3;opacity:0;transform-box:fill-box;transform-origin:center}
.nn .t2{fill:none;stroke:#e6fdff;stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:101 120;stroke-dashoffset:101;opacity:0}
.nn .hd2{fill:none;stroke:#fff;stroke-width:9;stroke-linecap:round;stroke-dasharray:5 200;stroke-dashoffset:7;opacity:0}
.nn .g1{--d:.8s}.nn .g2{--d:4.8s}.nn .g3{--d:8.8s}
/* The moon goes round once in 40 s, behind the brain on the far half and in front on the near half.
   A spark leaves the code sign every 4 s, runs to one memory point, and that point ripples. */
@property --orbit{syntax:"<angle>";inherits:false;initial-value:47deg}
@media (prefers-reduced-motion:no-preference){
  @supports (width:calc(1px*cos(1deg))){
    .logo-orbit::before,.logo-orbit::after{animation:orbit 40s linear infinite;background:radial-gradient(circle,#cffafe 0 calc(var(--w)*.014),rgba(34,211,238,.45) calc(var(--w)*.021),transparent calc(var(--w)*.05)) no-repeat;background-size:calc(var(--w)/9) calc(var(--w)/9);background-position:calc(50% + var(--kx)*cos(var(--orbit,47deg))) calc(50% + var(--ky)*sin(var(--orbit,47deg)))}
  }
  .nn .t2{animation:trail 12s linear var(--d) infinite}
  .nn .hd2{animation:head 12s linear var(--d) infinite}
  .nn .b2{animation:ask 12s linear var(--d) infinite}
  .nn .c2{animation:found 12s linear var(--d) infinite}
  .nn .r2{animation:ripple 12s linear var(--d) infinite}
}
h1{margin:0;color:var(--ink);font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.25;white-space:nowrap}
.brand p{margin:0;font-size:12.5px;color:var(--muted)}
.search{grid-column:3;justify-self:end;display:flex;align-items:center;gap:10px;width:100%;max-width:430px;height:42px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:rgba(10,20,60,.6);color:var(--muted);font-size:16px;transition:border-color .15s,box-shadow .15s}
.search:focus-within{border-color:var(--cyan);box-shadow:0 0 0 4px rgba(34,211,238,.16)}
.search input{flex:1;align-self:stretch;min-width:0;border:0;outline:0;background:none;color:var(--ink);caret-color:var(--cyan);font:400 15px var(--sans);text-overflow:ellipsis}
.search input::placeholder{color:var(--muted)}
kbd{padding:2px 7px;border-radius:6px;border:1px solid var(--line-2);color:var(--muted);font:600 12px var(--mono)}
.search:focus-within kbd,.search input:not(:placeholder-shown)~kbd{display:none}
/* Shown when the page is opened on a later day than it was built */
.stale{margin:16px 0 0;padding:10px 14px;border-radius:12px;border:1px solid rgba(251,191,36,.5);background:rgba(251,191,36,.1);color:#fde68a;font-weight:600}

/* Hero: the week in one look */
.hero{position:relative;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:40px;margin-top:20px;padding:24px 30px 22px;animation:rise .5s var(--ease-out) both}
.hero::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(135deg,rgba(34,211,238,.85),rgba(124,58,237,.12) 42%,rgba(244,114,182,.55));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.range{display:flex;align-items:center;gap:10px;color:var(--ink);font-size:14px;font-weight:700}
.range span+span{color:var(--muted);font-size:13px;font-weight:500}
.ib{display:grid;place-items:center;width:36px;height:36px;padding:0;border-radius:10px;border:1px solid var(--line);background:rgba(10,20,60,.5);color:var(--ink);font-size:17px;cursor:pointer;transition:transform .12s var(--ease-out),border-color .15s}
.ib:active{transform:scale(.94)}
.ib:disabled{opacity:.35;cursor:default}
.range .ib:first-child{margin-right:2px}.range .ib:last-child{margin-left:auto}
.hero h2{margin:14px 0 0;color:var(--ink);font-size:clamp(34px,4.3vw,56px);font-weight:800;line-height:1.02;letter-spacing:-.035em}
.num{color:#67e8f9;font-variant-numeric:tabular-nums}
.hero h2 small{display:block;margin-top:8px;color:var(--body);font-size:.4em;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.lede{max-width:46ch;margin:14px 0 0;font-size:16px}
.lede b{color:var(--ink);font-weight:650}
.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.stat{display:flex;align-items:baseline;gap:7px}
.stat .i{align-self:center;color:var(--cyan);font-size:16px}
.stat b{color:var(--ink);font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
.stat span{font-size:13px;color:var(--muted)}
.cap{margin:0;color:var(--body);font-size:13px;font-weight:650}

/* Week chart: one column a day, one colour a project */
.chart{position:relative;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:10px}
.sel{position:absolute;top:0;bottom:0;left:0;border-radius:14px;border:1px solid rgba(34,211,238,.6);background:linear-gradient(180deg,rgba(34,211,238,.17),rgba(34,211,238,.04));box-shadow:0 0 28px rgba(34,211,238,.22);opacity:0;pointer-events:none;transition:transform .28s var(--ease-in-out),opacity .15s}
.sel.live{opacity:1}.sel.jump{transition:none}.sel.off{opacity:0}
.col{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px 10px;border:0;border-radius:14px;background:none;color:var(--body);cursor:pointer;transition:transform .12s var(--ease-out)}
.col:active{transform:scale(.97)}
.col .n{height:22px;color:var(--ink);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.track{display:flex;align-items:flex-end;justify-content:center;width:100%;height:128px;margin-bottom:5px;border-bottom:1px solid var(--line)}
.col.z .track::after{content:"";width:18px;height:3px;border-radius:2px;background:var(--line-2)}
.stack{display:flex;flex-direction:column-reverse;gap:3px;width:min(46px,62%);transform-origin:50% 100%;animation:grow .6s var(--ease-out) both;animation-delay:calc(var(--i)*45ms + 120ms)}
.seg{min-height:6px;border-radius:5px;background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 60%,#0a1245));transition:opacity .2s}
.chart.dim .seg:not(.on){opacity:.2}
.wd{font-size:13px;font-weight:650}
.col[aria-pressed=true] .wd{color:var(--ink)}
.dd{font-size:12px;color:var(--muted)}
.dd.now{color:var(--cyan-ink);font-weight:700}
.tip{position:absolute;bottom:calc(100% + 6px);left:50%;z-index:5;display:grid;gap:3px;min-width:150px;padding:9px 11px;border-radius:11px;border:1px solid var(--line-2);background:#0b143f;box-shadow:0 14px 30px -10px rgba(0,0,0,.8);font-size:12.5px;text-align:left;opacity:0;pointer-events:none;transform:translateX(-50%) scale(.97);transform-origin:50% 100%;transition:opacity .13s var(--ease-out),transform .13s var(--ease-out)}
.tr{display:flex;align-items:center;gap:7px}
.tr b{margin-left:auto;padding-left:10px;color:var(--ink)}
.col:focus-visible .tip{opacity:1;transform:translateX(-50%)}
/* The colour key, where the tooltip and the project cards are out of sight */
.legend{display:none;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:13px}
.legend span{display:inline-flex;align-items:center;gap:7px}

/* 30 days at a glance */
.month{margin-top:18px}
.heat{display:grid;grid-template-columns:repeat(15,minmax(0,1fr));gap:4px;margin-top:8px}
.cell{height:26px;padding:0;border:0;border-radius:4px;background:rgba(130,170,255,.1);cursor:pointer;animation:fade .4s both;animation-delay:calc(var(--i)*12ms + 300ms);transition:transform .12s var(--ease-out)}
.cell.l1{background:rgba(34,211,238,.3)}.cell.l2{background:rgba(34,211,238,.52)}.cell.l3{background:rgba(34,211,238,.76)}
.cell.l4{background:#22d3ee}
/* Rings as shadows, so the outline stays free for the keyboard focus */
.cell.in{box-shadow:0 0 0 1px #0a1238,0 0 0 2px rgba(165,243,252,.55)}
.cell.on{box-shadow:0 0 0 1px #0a1238,0 0 0 3px var(--ink)}
.cell:focus-visible{position:relative;z-index:1;outline-offset:4px}
.heat-x{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--muted)}

/* Projects: the legend of the chart, and the filter */
.projs{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:16px}
.proj{display:grid;grid-template-columns:minmax(0,1fr) 64px;gap:10px 14px;align-items:end;padding:16px 18px;color:var(--body);text-align:left;cursor:pointer;transition:transform .12s var(--ease-out),border-color .18s,box-shadow .18s}
.proj:active{transform:scale(.98)}
.proj[aria-pressed=true]{border-color:var(--c);box-shadow:0 0 0 1px var(--c),0 0 30px color-mix(in srgb,var(--c) 28%,transparent)}
.pr-top{grid-column:1/-1;display:flex;align-items:center;gap:9px}
.pr-name{color:var(--ink);font-size:16px;font-weight:700}
.pr-n{margin-left:auto;color:var(--ink);font-size:24px;font-weight:800;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.pr-u{font-size:12px;color:var(--muted)}
.pr-last{display:grid;gap:3px;min-width:0;font-size:13px;color:var(--muted)}
.pr-last span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spark{display:flex;align-items:flex-end;gap:3px;height:34px}
.spark i{flex:1;border-radius:2px;background:var(--c)}
.spark i.z{background:var(--line-2)}

/* The day, or the search results */
.dh{display:flex;align-items:flex-end;gap:12px;margin:28px 0 16px;scroll-margin-top:84px}
.dh h2{margin:0;color:var(--ink);font-size:28px;font-weight:800;line-height:1.1;letter-spacing:-.025em}
.dh p{margin:5px 0 0;font-size:13.5px;color:var(--muted)}
.nav{display:flex;align-items:center;gap:6px;margin-left:auto}
.nav kbd{margin-right:4px}
.sub{margin:20px 0 10px 88px;color:var(--cyan-ink);font-size:13px;font-weight:700}
.e{position:relative;display:grid;grid-template-columns:58px 30px minmax(0,1fr);padding-bottom:14px;animation:rise .32s var(--ease-out) both;animation-delay:calc(var(--i)*40ms)}
.instant .e{animation:none}
.e::before{content:"";position:absolute;left:72.5px;top:0;bottom:0;width:1px;background:var(--line-2)}
.e:first-of-type::before{top:24px}
.e:last-of-type::before{bottom:auto;height:24px}
.t{padding-top:15px;color:var(--ink);font:700 14.5px var(--mono);text-align:right}
.node{z-index:1;justify-self:center;width:12px;height:12px;margin-top:19px;border-radius:50%;border:2.5px solid var(--c);background:#070d2b}
.card{padding:16px 18px 14px;transition:border-color .18s}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:11px;font-size:12.5px}
.pill{display:inline-flex;align-items:center;gap:7px;padding:3px 10px 3px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--c) 42%,transparent);background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--ink);font-weight:650}
.tag{display:inline-flex;align-items:center;gap:5px;font:12px var(--mono)}
.cv{color:var(--muted);font:12px var(--mono)}
.note{display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:3px 10px;border-radius:999px;border:1px solid rgba(244,114,182,.42);background:rgba(244,114,182,.13);color:#f9a8d4;font-weight:650}
.row{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start}
.row+.row{margin-top:8px}
.ri{margin-top:4px;color:var(--muted);font-size:16px}
.ri.sp{color:var(--cyan)}
.q{margin:0;color:var(--ink);font-size:17px;font-weight:650;line-height:1.4;letter-spacing:-.005em}
.a{margin:0;font-size:15px;line-height:1.6}
.q,.a{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.q{-webkit-line-clamp:3}.a{-webkit-line-clamp:2}
.open .q,.open .a{display:block}
mark{padding:0 2px;border-radius:3px;background:rgba(34,211,238,.3);color:var(--ink)}
.files{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:12px 0 0 32px}
.lab{margin-right:2px;font-size:12px;color:var(--muted)}
.f{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 9px;border-radius:8px;border:1px solid var(--line);background:rgba(130,170,255,.07);font:12.5px var(--mono)}
.fn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.open .fn{white-space:normal;word-break:break-all}
.cutnote{display:none;margin:8px 0 0 32px;font-size:12.5px;color:var(--muted)}
.open .cutnote{display:block}
.more{display:inline-flex;align-items:center;gap:5px;min-height:28px;margin:8px 0 0 32px;padding:4px 0;border:0;background:none;color:var(--cyan-ink);font:650 13px var(--sans);cursor:pointer}
.more .i{transition:transform .16s var(--ease-out)}
.open .more .i{transform:rotate(180deg)}
.priv{background:repeating-linear-gradient(135deg,rgba(130,170,255,.06) 0 10px,transparent 10px 20px),var(--surface)}
.priv .q{color:var(--body)}
.empty{display:grid;justify-items:center;gap:6px;padding:44px 20px;border:1px dashed var(--line-2);border-radius:var(--r);text-align:center}
.empty svg{width:56px;height:56px;color:var(--cyan);font-size:56px;stroke-width:1.3;opacity:.9}
.empty h3{margin:6px 0 0;color:var(--ink);font-size:18px}
.empty p{margin:0;color:var(--muted)}
.btn{margin-top:10px;padding:8px 16px;border-radius:10px;border:1px solid var(--cyan);background:rgba(34,211,238,.12);color:var(--cyan-ink);font-weight:650;cursor:pointer;transition:transform .12s var(--ease-out)}
.btn:active{transform:scale(.97)}
.foot{display:flex;align-items:center;gap:10px;margin:40px 0 60px;font-size:13px;color:var(--muted)}
.foot code{color:var(--body);font:12.5px var(--mono)}

@keyframes orbit{to{--orbit:407deg}}
@keyframes trail{0%{stroke-dashoffset:101;opacity:.95}16%{stroke-dashoffset:0;opacity:.95}30%,100%{stroke-dashoffset:0;opacity:0}}
@keyframes head{0%{stroke-dashoffset:7;opacity:1}16%{stroke-dashoffset:-95;opacity:1}20%,100%{stroke-dashoffset:-95;opacity:0}}
@keyframes ask{0%{opacity:1;transform:scale(.6)}6%,100%{opacity:0;transform:scale(2.4)}}
@keyframes found{0%,15%{opacity:0;transform:scale(.5)}17.5%{opacity:1;transform:scale(1.5)}25%{opacity:1;transform:scale(1.1)}34%,100%{opacity:0;transform:scale(1)}}
@keyframes ripple{0%,16%{opacity:0;transform:scale(.6)}17%{opacity:.9;transform:scale(.8)}31%,100%{opacity:0;transform:scale(3.6)}}
@keyframes grow{from{opacity:0;transform:scaleY(.08)}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@keyframes fade{from{opacity:0}}
@media (hover:hover) and (pointer:fine){
  .col:hover .tip{opacity:1;transform:translateX(-50%)}
  .col:hover .stack{filter:brightness(1.15)}
  .cell:hover{transform:scale(1.12)}
  .ib:not(:disabled):hover{border-color:var(--cyan)}
  .proj:hover,.card:hover{border-color:var(--line-2)}
  .more:hover{color:var(--ink)}
}
@media (max-width:900px){
  .hero{grid-template-columns:minmax(0,1fr);gap:26px;padding:22px 18px}
  .wrap,.top-in{padding:0 16px}
  .brand p,kbd,.tip{display:none}
  .logo-orbit{--w:72px;--kx:56.5%;--ky:86.3%}
  .ib{width:44px;height:44px}
  .e{grid-template-columns:minmax(0,1fr)}
  .e::before,.node{display:none}
  .t{padding:0 0 6px;text-align:left}
  .sub{margin-left:0}
  .files,.more{margin-left:0}
  .more{min-height:44px}
  .legend{display:flex}
  .search{min-width:0;height:44px}
  .chart{gap:2px}
  .heat{grid-template-columns:repeat(10,minmax(0,1fr))}
  .cell{height:32px}
}
/* Less motion: the fades stay, the movement goes */
/* A phone has no room for two equal side columns: the logo goes back to the left of the title. */
@media (max-width:480px){
  .top-in{grid-template-columns:auto auto minmax(0,1fr)}
  .logo-orbit{grid-column:1;margin:0 -10px 0 -14px}
  .brand{grid-column:2}
}
@media (prefers-reduced-motion:reduce){
  .hero,.stack,.e{animation-name:fade}
  .hero,.stack,.e,.cell{animation-duration:.2s;animation-delay:0s}
  .sel{transition:opacity .15s}
  .tip{transform:translateX(-50%);transition:opacity .13s}
  .col,.ib,.proj,.btn,.cell,.more .i{transition:none}
}
@media (prefers-contrast:more){
  .nn{display:none}
  :root{--line:rgba(190,215,255,.6);--line-2:rgba(210,230,255,.85);--muted:#c3cfea;--body:#e6edff}
}
@media (prefers-reduced-transparency:reduce){
  :root{--surface:#0b1440}
  .top{-webkit-backdrop-filter:none;backdrop-filter:none;background:#070d2b}
}
`;
const BODY = String.raw`
<a class="skip" href="#list">Skip to the entries</a>
<header class="top" id="top"><div class="top-in">
  <span class="logo-orbit" aria-hidden="true"><img src="@@LOGO@@" alt="" width="148" height="136"><svg class="nn" viewBox="-103.6 -20.8 355.2 177.6" aria-hidden="true"><circle class="dot" cx="38" cy="9" r="2.8"/><circle class="dot" cx="63" cy="12" r="2.8"/><circle class="dot" cx="64" cy="63" r="2.8"/><circle class="dot" cx="15" cy="40" r="2.8"/><circle class="dot" cx="5" cy="75" r="2.8"/><circle class="dot" cx="41" cy="47" r="2.8"/><circle class="dot" cx="28" cy="66" r="2.8"/><circle class="dot" cx="48" cy="92" r="2.8"/><circle class="dot" cx="22" cy="110" r="2.8"/><circle class="dot" cx="52" cy="127" r="2.8"/><circle class="dot" cx="80" cy="9" r="2.8"/><circle class="dot" cx="80" cy="54" r="2.8"/><circle class="dot" cx="108" cy="13" r="2.8"/><circle class="dot" cx="112" cy="42" r="2.8"/><circle class="dot" cx="138" cy="52" r="2.8"/><g class="glow"><g class="g1"><path class="t2" pathLength="100" d="M141 92 L103 92 L66 90 L48 92 L22 110"/><path class="hd2" pathLength="100" d="M141 92 L103 92 L66 90 L48 92 L22 110"/><circle class="b2" cx="141" cy="92" r="6"/><circle class="c2" cx="22" cy="110" r="7"/><circle class="r2" cx="22" cy="110" r="8"/></g><g class="g2"><path class="t2" pathLength="100" d="M141 92 L138 52 L108 13 L80 9 L63 12 L38 9"/><path class="hd2" pathLength="100" d="M141 92 L138 52 L108 13 L80 9 L63 12 L38 9"/><circle class="b2" cx="141" cy="92" r="6"/><circle class="c2" cx="38" cy="9" r="7"/><circle class="r2" cx="38" cy="9" r="8"/></g><g class="g3"><path class="t2" pathLength="100" d="M141 92 L103 92 L80 54 L64 63 L41 47 L15 40"/><path class="hd2" pathLength="100" d="M141 92 L103 92 L80 54 L64 63 L41 47 L15 40"/><circle class="b2" cx="141" cy="92" r="6"/><circle class="c2" cx="15" cy="40" r="7"/><circle class="r2" cx="15" cy="40" r="8"/></g></g></svg></span>
  <div class="brand"><h1>Project memory</h1><p id="meta"></p></div>
  <label class="search"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search requests, answers, files" aria-label="Search the journal" autocomplete="off"><kbd aria-hidden="true">/</kbd></label>
</div></header>
<div class="wrap">
  <p class="stale" id="stale" role="status" hidden></p>
  <section class="hero glass" aria-labelledby="h-week">
    <div>
      <div class="range"><button class="ib" id="prev" type="button" aria-label="The 7 days before"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><span id="range"></span><span id="dates"></span><button class="ib" id="next" type="button" aria-label="The 7 days after"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div>
      <h2 id="h-week"><span class="num" id="n-ex">0</span> <span id="u-ex">exchanges</span> <small id="in"></small></h2>
      <p class="lede" id="sum"></p>
      <div class="stats">
        <div class="stat"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><b id="s-f">0</b><span>files changed</span></div>
        <div class="stat"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg><b id="s-n">0</b><span>notes written</span></div>
        <div class="stat"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg><b id="s-c">0</b><span>conversations</span></div>
      </div>
    </div>
    <div>
      <p class="cap">Exchanges a day</p>
      <div class="chart" id="chart" role="group" aria-label="Exchanges a day. Pick a day."></div>
      <div class="legend" id="legend" aria-hidden="true"></div>
      <div class="month"><p class="cap" id="h-cap">The last 30 days</p><div class="heat" id="heat" role="group" aria-label="Days of the journal. Pick a day."></div><div class="heat-x"><span id="h-from"></span><span id="h-to"></span></div></div>
    </div>
  </section>
  <h2 class="vh">Projects</h2>
  <div class="projs" id="projs" role="group" aria-label="Show one project"></div>
  <p class="vh" id="status" role="status"></p>
  <main id="list" tabindex="-1"></main>
  <footer class="foot"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>Built <span id="built"></span> from the journal on this PC. This page loads nothing from the internet. Run <code>memory page</code> to build it again.</span></footer>
</div>
<template id="icons">
  <svg class="i" data-i="branch" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 3.5-3 4.5-9.5 5"/></svg>
  <svg class="i" data-i="file" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
  <svg class="i" data-i="note" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>
  <svg class="i" data-i="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
  <svg class="i" data-i="user" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
  <svg class="i" data-i="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 17v4M17 19h4"/></svg>
  <svg class="i" data-i="down" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  <svg class="i" data-i="left" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>
  <svg class="i" data-i="right" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
  <svg class="i" data-i="empty" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13.5 5.5 6h13L21 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.500z"/><path d="M3 13.500h5l1.500 2.500h5l1.500-2.500h5"/><path d="M12 2.500v1M8.500 3l.4.900M15.500 3l-.4.900"/></svg>
</template>
`;
const SCRIPT = String.raw`
const E=DATA.entries,TODAY=DATA.today,DAYS=DATA.days==="all"?30:Math.min(DATA.days,30);
const WD=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MO=["January","February","March","April","May","June","July","August","September","October","November","December"];
const $=(id)=>document.getElementById(id);
const h=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const ic=(name,cls)=>{const s=$("icons").content.querySelector('[data-i="'+name+'"]').cloneNode(true);if(cls)s.classList.add(...cls.split(" "));return s};
const dt=(s)=>new Date(s+"T12:00:00Z");
const add=addDays;
const wd=(s)=>WD[dt(s).getUTCDay()],dn=(s)=>dt(s).getUTCDate(),mo=(s)=>MO[dt(s).getUTCMonth()];
const short=(s)=>wd(s).slice(0,3)+" "+dn(s)+" "+mo(s).slice(0,3);
const some=(n,one,many)=>n+" "+(n===1?one:many||one+"s");
const ALL=Array.from({length:DAYS},(_,i)=>add(TODAY,i-DAYS+1));
const count=(p)=>E.filter((e)=>e.p===p).length;
const P=[...new Set(E.map((e)=>e.p))].sort((a,b)=>count(b)-count(a)||(a<b?-1:a>b?1:0));
const pi=(p)=>P.indexOf(p)%6;
const of=(d,p)=>E.filter((e)=>e.d===d&&(!p||e.p===p));
const PAGE=100;
const S={end:TODAY,day:TODAY,p:"",q:"",kb:false,lim:PAGE};
const win=()=>weekOf(S.end);
const calm=matchMedia("(prefers-reduced-motion: reduce)").matches;
// The reader's own date. A page opened on a later day than it was built says so, and stops saying "Today".
const NOW=(()=>{const x=new Date(),two=(n)=>String(n).padStart(2,"0");return x.getFullYear()+"-"+two(x.getMonth()+1)+"-"+two(x.getDate())})();
const AGE=daysAgo(TODAY,NOW),FRESH=AGE<=0;
// Weeks go back to the oldest day the page holds, and no further.
const OLD=E.reduce((m,e)=>e.d<m?e.d:m,TODAY),LO=add(OLD,6)>TODAY?TODAY:add(OLD,6);
const SPAN=DATA.days===1?"today":DATA.days==="all"?"all the journal":"the last "+DATA.days+" days";
const dm=(s)=>dn(s)+" "+mo(s).slice(0,3);
let first=true;

// A number counts up once, when the page opens. Never again: a repeat would only slow the reader.
function num(el,to){
  if(!first||calm||!to){el.textContent=to;return}
  const t0=performance.now();
  (function step(t){const k=Math.min((t-t0)/700,1);el.textContent=Math.round(to*(1-Math.pow(1-k,4)));if(k<1)requestAnimationFrame(step)})(t0);
}
// Text with the search words marked, built from text nodes only.
function mark(el,text,q){
  // A lowercase of another length (a dotted I) moves every offset: nothing is marked.
  if(!q||text.toLowerCase().length!==text.length){el.append(text);return}
  const low=text.toLowerCase();let i=0,j;
  while((j=low.indexOf(q,i))>-1){el.append(text.slice(i,j),h("mark","",text.slice(j,j+q.length)));i=j+q.length}
  el.append(text.slice(i));
}

function hero(){
  const w=win(),es=E.filter((e)=>w.includes(e.d)&&(!S.p||e.p===S.p)),n=es.length,ps=[...new Set(es.map((e)=>e.p))];
  $("range").textContent=S.end===TODAY&&FRESH?"Last 7 days":"7 days to "+dm(S.end);
  $("dates").textContent=dm(w[0])+" to "+dm(w[6]);
  $("prev").disabled=S.end<=LO;$("next").disabled=S.end>=TODAY;
  num($("n-ex"),n);$("u-ex").textContent=n===1?"exchange":"exchanges";
  $("in").textContent=S.p?"in "+S.p:n?"in "+some(ps.length,"project"):"in these 7 days";
  num($("s-f"),es.reduce((a,e)=>a+e.f.length,0));num($("s-n"),es.filter((e)=>e.n).length);num($("s-c"),new Set(es.map((e)=>e.c)).size);
  const sum=$("sum");sum.replaceChildren();
  if(!n){sum.textContent=S.p?"Nothing from "+S.p+" in these 7 days.":"Nothing was saved in these 7 days.";return}
  const top=w.map((d)=>[of(d,S.p).length,d]).sort((a,b)=>b[0]-a[0])[0];
  const most=ps.map((p)=>[es.filter((e)=>e.p===p).length,p]).sort((a,b)=>b[0]-a[0])[0];
  sum.append("Busiest day was ",h("b","",wd(top[1]))," with "+top[0]+".");
  if(!S.p)sum.append(" Most of the work was in ",h("b","",most[1]),".");
}

function buildChart(){
  const box=$("chart"),w=win(),max=Math.max(1,...w.map((d)=>of(d).length));
  box.replaceChildren(h("span","sel"));box.firstChild.id="sel";
  w.forEach((d,i)=>{
    const es=of(d),n=es.length,b=h("button","col"+(n?"":" z"));
    const parts=P.map((p)=>[p,es.filter((e)=>e.p===p).length]).filter((x)=>x[1]);
    b.type="button";b.dataset.d=d;b.style.setProperty("--i",i);
    b.setAttribute("aria-label",short(d)+": "+(n?some(n,"exchange")+", "+parts.map((x)=>x[0]+" "+x[1]).join(", "):"no exchanges"));
    if(n){const tip=h("span","tip");parts.forEach((x)=>{const r=h("span","tr p"+pi(x[0]));r.append(h("i","dot"),h("span","",x[0]),h("b","",x[1]));tip.append(r)});b.append(tip)}
    const track=h("span","track"),stack=h("span","stack");
    if(n)stack.style.height=Math.max(n/max*100,9)+"%";
    parts.forEach((x)=>{const s=h("span","seg p"+pi(x[0]));s.dataset.p=x[0];s.style.flexGrow=x[1];stack.append(s)});
    if(n)track.append(stack);
    b.append(h("span","n",n||""),track,h("span","wd",wd(d).slice(0,3)),h("span","dd"+(d===TODAY&&FRESH?" now":""),d===TODAY&&FRESH?"Today":dm(d)));
    b.onclick=(e)=>{setDay(d);if(e.detail)show()};box.append(b);
  });
}
function buildHeat(){
  const max=Math.max(...ALL.map((d)=>of(d).length));
  $("h-from").textContent=dm(ALL[0]);$("h-to").textContent=FRESH?"Today":dm(TODAY);
  P.forEach((p)=>{const s=h("span","p"+pi(p));s.append(h("i","dot"),h("span","",p));$("legend").append(s)});
  ALL.forEach((d,i)=>{
    const n=of(d).length,b=h("button","cell l"+level(n,max));
    b.type="button";b.dataset.d=d;b.style.setProperty("--i",i);b.title=short(d)+": "+some(n,"exchange");b.setAttribute("aria-label",b.title);
    b.onclick=(e)=>{goto(d);if(e.detail)show()};$("heat").append(b);
  });
}
function buildProjs(){
  const box=$("projs"),w=win();box.replaceChildren();
  P.forEach((p)=>{
    const es=E.filter((e)=>e.p===p&&w.includes(e.d)),b=h("button","proj glass p"+pi(p)),top=h("span","pr-top"),last=h("span","pr-last"),spark=h("span","spark");
    const max=Math.max(1,...w.map((d)=>of(d,p).length));
    b.type="button";b.dataset.p=p;b.setAttribute("aria-label",p+": "+some(es.length,"exchange")+" in these 7 days. Show only this project.");
    top.append(h("i","dot"),h("span","pr-name",p),h("b","pr-n",es.length),h("span","pr-u","in 7 days"));
    es.filter((e)=>!e.priv).slice(0,2).forEach((e)=>last.append(h("span","",e.q)));
    if(!es.length)last.append(h("span","","Nothing in these 7 days"));
    w.forEach((d)=>{const n=of(d,p).length,bar=h("i",n?"":"z");bar.style.height=Math.max(n/max*100,8)+"%";spark.append(bar)});
    b.append(top,last,spark);b.onclick=()=>setProj(S.p===p?"":p);box.append(b);
  });
}
// What is picked, shown everywhere at once. The marker slides for a click and jumps for a key.
function sync(){
  const w=win(),sel=$("sel");
  document.querySelectorAll(".col").forEach((b)=>{
    const on=b.dataset.d===S.day&&!S.q;b.setAttribute("aria-pressed",on);
    if(!on)return;
    sel.classList.toggle("jump",S.kb||!sel.classList.contains("live"));
    sel.style.width=b.offsetWidth+"px";sel.style.transform="translateX("+b.offsetLeft+"px)";sel.classList.add("live");
  });
  sel.classList.toggle("off",!!S.q||!w.includes(S.day));
  $("chart").classList.toggle("dim",!!S.p);
  document.querySelectorAll(".seg").forEach((s)=>s.classList.toggle("on",s.dataset.p===S.p));
  document.querySelectorAll(".cell").forEach((c)=>{c.classList.toggle("in",w.includes(c.dataset.d));const on=c.dataset.d===S.day&&!S.q;c.classList.toggle("on",on);c.setAttribute("aria-pressed",on)});
  document.querySelectorAll(".proj").forEach((b)=>b.setAttribute("aria-pressed",b.dataset.p===S.p));
}

function entry(e,i,q){
  const a=h("article","e p"+pi(e.p)),card=h("div","card glass"+(e.priv?" priv":"")),meta=h("div","meta"),pill=h("span","pill"),br=h("span","tag");
  a.style.setProperty("--i",Math.min(i,8));
  pill.append(h("i","dot"),h("span","",e.p));meta.append(pill);
  if(e.b){br.append(ic("branch"),h("span","",e.b));meta.append(br)}
  meta.append(h("span","cv","#"+e.c));
  if(e.n){const n=h("span","note");n.append(ic("note"),h("span","","Wrote a note"));meta.append(n)}
  card.append(meta);
  const row=(icon,tag,cls,label,text)=>{const r=h("div","row"),x=h(tag,cls);r.append(ic(icon,"ri"+(icon==="spark"?" sp":"")));x.append(h("span","vh",label));mark(x,text,q);r.append(x);return r};
  if(e.priv)card.append(row("lock","h3","q","","Private exchange"),row("spark","p","a","","Its text was not kept."));
  else{
    card.append(row("user","h3","q","Asked: ",e.q),row("spark","p","a","Answer: ",e.a));
    if(e.f.length){
      const fs=h("div","files");fs.append(h("span","lab",some(e.f.length,"file")+" changed"));
      e.f.forEach((f)=>{const x=h("span","f"),nm=h("span","fn"),cut=f.length>46?"…/"+f.split("/").slice(-2).join("/"):f;
        nm.dataset.full=f;nm.dataset.cut=cut;if(cut!==f){card.dataset.long=1;nm.textContent=cut}else mark(nm,f,q);x.title=f;x.append(ic("file"),nm);fs.append(x)});
      card.append(fs);
    }
    if(e.cut){card.dataset.long=1;card.append(h("p","cutnote","Cut here. The journal holds the rest: memory show"))}
    const more=h("button","more");more.type="button";more.setAttribute("aria-expanded","false");more.append(h("span","","Show more"),ic("down"));
    more.onclick=()=>{const open=card.classList.toggle("open");more.setAttribute("aria-expanded",open);more.firstChild.textContent=open?"Show less":"Show more";card.querySelectorAll(".fn").forEach((n)=>{if(n.dataset.cut!==n.dataset.full)n.textContent=open?n.dataset.full:n.dataset.cut})};
    card.append(more);
  }
  a.append(h("time","t",e.t),h("span","node"),card);return a;
}
function empty(title,text,label,act){
  const box=h("div","empty");box.append(ic("empty"),h("h3","",title),h("p","",text));
  if(label){const b=h("button","btn",label);b.type="button";b.onclick=act;box.append(b)}
  return box;
}
function list(){
  const box=$("list"),q=S.q.trim().toLowerCase(),head=h("div","dh"),txt=h("div");
  box.replaceChildren(head);box.classList.toggle("instant",S.kb||!!q);
  let es;
  if(q){
    es=E.filter((e)=>matches(e,q,S.p));
    txt.append(h("h2","",some(es.length,"match","matches")+" for “"+S.q.trim()+"”"),h("p","","In "+SPAN+(S.p?", only "+S.p:"")));head.append(txt);
    if(!es.length)box.append(empty("Nothing matches","Try fewer words, or a file name."+(S.p?" Only "+S.p+" was searched.":""),S.p?"Search all projects":"Clear the search",()=>S.p?setProj(""):clear()));
  }else{
    es=of(S.day,S.p);
    const all=of(S.day),nav=h("div","nav"),back=h("button","ib"),fwd=h("button","ib"),keys=h("kbd","","← →");
    keys.title="The Left and Right arrow keys change the day";keys.setAttribute("aria-hidden","true");
    back.setAttribute("aria-keyshortcuts","ArrowLeft");fwd.setAttribute("aria-keyshortcuts","ArrowRight");
    txt.append(h("h2","",wd(S.day)+" "+dn(S.day)+" "+mo(S.day)),h("p","",es.length?some(es.length,"exchange")+" · "+some(es.reduce((a,e)=>a+e.f.length,0),"file")+" changed · "+some(es.filter((e)=>e.n).length,"note")+" written"+(S.p?" · only "+S.p:""):S.p&&all.length?"Nothing from "+S.p+" on this day":"Nothing was saved on this day"));
    back.type=fwd.type="button";back.setAttribute("aria-label","The day before");fwd.setAttribute("aria-label","The day after");back.append(ic("left"));fwd.append(ic("right"));
    back.disabled=S.day<=OLD;fwd.disabled=S.day>=TODAY;back.onclick=()=>stepDay(-1);fwd.onclick=()=>stepDay(1);nav.append(keys,back,fwd);head.append(txt,nav);
    if(!es.length)box.append(S.p&&all.length?empty("Nothing from "+S.p+" on this day",some(all.length,"exchange")+" from other projects.","Show all projects",()=>setProj("")):empty("A quiet day","Nothing was saved on "+short(S.day)+"."));
  }
  let day="";
  es.slice(0,q?S.lim:es.length).forEach((e,i)=>{if(q&&e.d!==day){day=e.d;box.append(h("p","sub",short(e.d)))}box.append(entry(e,i,q))});
  if(q&&es.length>S.lim){const b=h("button","btn","Show "+Math.min(PAGE,es.length-S.lim)+" more");b.type="button";b.onclick=()=>{S.lim+=PAGE;list()};box.append(b)}
  fit();
  // One short line for a screen reader, not the whole list read again.
  if(!first)$("status").textContent=[...txt.children].map((n)=>n.textContent).join(". ");
  S.kb=false;
}
// "Show more" only where something is cut. An open card keeps its button.
function fit(){
  document.querySelectorAll(".more").forEach((m)=>{const c=m.parentNode;if(!c.classList.contains("open"))m.hidden=!c.dataset.long&&![...c.querySelectorAll(".q,.a")].some((n)=>n.scrollHeight>n.clientHeight+1)});
}
// After a click or a tap on a day, bring its heading into view when it sits below the screen.
function show(){
  const hd=document.querySelector(".dh");
  if(hd&&hd.getBoundingClientRect().top>innerHeight-140)hd.scrollIntoView({behavior:calm?"auto":"smooth",block:"start"});
}

function setWin(end,day){
  S.end=end<LO?LO:end>TODAY?TODAY:end;S.day=day||win().reverse().find((d)=>of(d).length)||S.end;
  buildChart();buildProjs();hero();sync();list();
}
// One project, or all of them: the week's numbers, the chart and the list change together.
function setProj(p){S.p=p;S.lim=PAGE;hero();sync();list()}
function clear(){S.q="";S.lim=PAGE;$("q").value="";sync();list()}
function setDay(d,kb){S.lim=PAGE;S.day=d;S.kb=!!kb;S.q="";$("q").value="";sync();list()}
function goto(d,kb){
  if(d<OLD||d>TODAY)return;
  if(win().includes(d)){setDay(d,kb);return}
  S.kb=!!kb;S.q="";$("q").value="";setWin(add(TODAY,-7*Math.floor((dt(TODAY)-dt(d))/6048e5)),d);
}
const stepDay=(n,kb)=>goto(add(S.day,n),kb);

$("prev").onclick=()=>setWin(add(S.end,-7));
$("next").onclick=()=>setWin(add(S.end,7));
let lag;$("q").oninput=(e)=>{S.q=e.target.value;S.lim=PAGE;sync();clearTimeout(lag);lag=setTimeout(list,120)};
addEventListener("keydown",(e)=>{
  const typing=e.target.matches("input");
  if(e.key==="/"&&!typing){e.preventDefault();$("q").focus()}
  else if(e.key==="Escape"&&typing){$("q").blur();clear()}
  else if(e.key==="Escape"&&S.q)clear();
  else if(e.key==="Escape"&&S.p)setProj("");
  else if(!typing&&!S.q&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="ArrowLeft"||e.key==="ArrowRight")){e.preventDefault();stepDay(e.key==="ArrowLeft"?-1:1,true)}
});
addEventListener("scroll",()=>$("top").classList.toggle("stuck",scrollY>8),{passive:true});
addEventListener("resize",()=>{S.kb=true;sync();S.kb=false;fit()});
if(!FRESH){$("stale").textContent="Built "+some(AGE,"day")+" ago. Run memory page for today.";$("stale").hidden=false}

$("meta").textContent=some(P.length,"project")+" · "+some(E.length,"exchange")+" in "+SPAN;
$("built").textContent=DATA.built;
$("h-cap").textContent=DAYS===1?"Today":"The last "+DAYS+" days";
$("q").setAttribute("aria-label","Search "+SPAN);
buildHeat();setWin(TODAY);first=false;
`;

// The page. The policy comes first: nothing is loaded from anywhere, one style
// block and one script block run, each only by its hash, and the only picture
// is the logo inside the page. Every journal string below goes in as data.
const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
// JSON inside a script: no `<` (so no `</script>` or `<!--`) and no line separator that ends a string in older engines.
const inScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
// Cleaned of control characters, then of secrets: the page is a copy of the journal, and a copy must not hold more than it.
const clean = (s) => redact(tame(String(s ?? '')));
const HELPERS = [addDays, weekOf, matches, level, daysAgo].map(String).join('\n');

// data: { built: 'YYYY-MM-DD HH:MM', today: 'YYYY-MM-DD', days: a number or 'all', entries: newest first }
// entry: { d, t, c, b, p, q, a, f: [paths], n: 1 for a note written, priv: 1 for a private turn, cut: 1 for an answer cut short }
export function pageHtml(data) {
  const entries = data.entries.map((e) => ({
    d: clean(e.d), t: clean(e.t), c: clean(e.c), b: clean(e.b), p: clean(e.p), q: clean(e.q), a: clean(e.a),
    f: e.f.map(clean), n: e.n ? 1 : 0, priv: e.priv ? 1 : 0, cut: e.cut ? 1 : 0,
  }));
  const days = data.days === 'all' ? 'all' : Math.max(1, Math.floor(Number(data.days)) || 1);
  const script = `const DATA=${inScript({ built: clean(data.built), today: clean(data.today), days, entries })};\n${HELPERS}${SCRIPT}`;
  const csp = `default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src ${sha(STYLE)}; script-src ${sha(script)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Project memory: journal</title>
<style>${STYLE}</style>
</head>
<body>${BODY.replace('@@LOGO@@', `data:image/png;base64,${LOGO}`)}<script>${script}</script>
</body></html>
`;
}
