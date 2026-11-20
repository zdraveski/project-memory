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
  const hay = [e.p, e.q, e.a, e.c, e.b, ...(e.f || [])].join('\n').toLowerCase();
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
