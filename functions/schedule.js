// Builds the season calendar from team.json (copied here by scripts/sync-config.js).
// Written into Firestore (config/season) by the adminSetup function; organizers can turn days off later.
const TEAM = require("./team.json");

function buildSeasonDays(team = TEAM) {
  const s = team.schedule;
  const weekdays = new Set(s.practiceWeekdays || [1, 2, 3, 4, 5]);
  const breaks = s.breaks || {};
  const ev = {};
  for (const e of s.events || []) {
    ev[e.date] = {
      key: e.date, kind: "event", name: e.name, where: e.where || "", label: e.label || e.name,
      post: !!e.postseason, end: e.end || null, priceCents: e.priceCents || null,
    };
  }
  // Coaches can add practices on non-practice weekdays (a Saturday session, say).
  const extra = new Set(s.extraPractices || []);
  const days = [];
  const first = [s.practiceStart, ...Object.keys(ev)].sort()[0];
  const last = [s.lastDay, ...Object.keys(ev), ...[...extra]].sort().pop();
  const d = new Date(first + "T00:00:00Z");
  const stop = new Date(last + "T00:00:00Z");
  for (; d <= stop; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (ev[key]) { days.push(ev[key]); continue; }
    if (breaks[key]) continue;
    if (!extra.has(key) && (key < s.practiceStart || key > s.practiceEnd || !weekdays.has(d.getUTCDay()))) continue;
    days.push({ key, kind: "practice", name: "Practice", where: "", label: (team.labels && team.labels.practice) || "Practice", post: false, end: null, priceCents: null });
  }
  return days;
}

/* The UTC instant of a wall-clock time in a time zone (handles daylight saving correctly). */
function zonedTimeToUtc(dayKey, hour, timeZone) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - tzOffsetMs(t, timeZone);
  return new Date(t);
}
function tzOffsetMs(t, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}

module.exports = { TEAM, buildSeasonDays, zonedTimeToUtc };
