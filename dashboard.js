// Daily counters for the dashboard: summaries sent and failed, and messages collected, per account and per day.
// Pure functions. The server keeps the counters in data/daily-stats.json and calls these to update them.

const TZ = 'Asia/Jerusalem';

// Day key in Israel time, like "2026-10-27".
export function dayKey(ts = Date.now()) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
}

// The last n day keys, oldest first, ending with the day of `now`.
export function lastDays(n, now = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now - i * 24 * 3600 * 1000));
  return out;
}

// Adds n to counters[day][accountId][key]. Returns the same object.
export function bumpDaily(counters, day, accountId, key, n = 1) {
  const byAcc = (counters[day] = counters[day] || {});
  const rec = (byAcc[accountId] = byAcc[accountId] || {});
  rec[key] = (rec[key] || 0) + n;
  return counters;
}

// Keeps the newest `keep` days only, so the file stays small on the Pi.
export function pruneDaily(counters, keep = 30) {
  const days = Object.keys(counters).sort();
  for (const d of days.slice(0, Math.max(0, days.length - keep))) delete counters[d];
  return counters;
}

// Totals of one key over the given days, for the accounts given (or all of them when accountIds is null).
export function seriesOf(counters, days, key, accountIds = null) {
  return days.map(d => {
    const byAcc = counters[d] || {};
    return Object.entries(byAcc)
      .filter(([id]) => !accountIds || accountIds.includes(id))
      .reduce((sum, [, rec]) => sum + (rec[key] || 0), 0);
  });
}

// Sums one key over the given days for the given accounts.
export function totalOf(counters, days, key, accountIds = null) {
  return seriesOf(counters, days, key, accountIds).reduce((a, b) => a + b, 0);
}
