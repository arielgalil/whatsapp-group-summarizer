// Numbers for the home dashboard that are worked out from what the server already keeps: stored messages,
// the send history, the daily counters and the device samples. Pure functions, no file or network access.

const TZ = 'Asia/Jerusalem';
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

// Messages per hour of the day (Israel time), from stored message records (timestamp in seconds).
export function hourlyCounts(msgs, since = 0) {
  const out = new Array(24).fill(0);
  for (const m of msgs) {
    if (!m || !m.timestamp || m.timestamp * 1000 < since) continue;
    out[Number(hourFmt.format(new Date(m.timestamp * 1000)))]++;
  }
  return out;
}

// Monitored groups with no message for `days` days (never active counts too). Oldest first.
export function quietGroups(groups, now = Date.now(), days = 7) {
  const limit = days * 86400e3;
  return Object.values(groups || {})
    .filter(g => g && g.enabled && (!g.lastActivity || now - g.lastActivity > limit))
    .map(g => ({ name: g.name, daysSince: g.lastActivity ? Math.floor((now - g.lastActivity) / 86400e3) : null }))
    .sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9));
}

// Groups that are not monitored but wrote something in the last `hours` hours. Most recent first, at most `limit`.
export function activeUnmonitored(groups, now = Date.now(), hours = 48, limit = 5) {
  return Object.values(groups || {})
    .filter(g => g && !g.enabled && g.lastActivity && now - g.lastActivity <= hours * 3600e3)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, limit)
    .map(g => ({ name: g.name, hoursAgo: Math.max(0, Math.round((now - g.lastActivity) / 3600e3)) }));
}

// Bullet lines in a summary text ("•", "-" or "*" at the start of a line).
export function countBullets(text) {
  return String(text || '').split('\n').filter(l => /^\s*[•\-*]\s+\S/.test(l)).length;
}

// What one collection produced in the history: how many runs, how many had nothing important, and the last run.
export function collectionStats(history, collectionId) {
  const runs = (history || []).filter(h => h.collectionId === collectionId && ['sent', 'skipped', 'failed', 'empty'].includes(h.status));
  const sent = runs.filter(h => h.status === 'sent').length;
  const skipped = runs.filter(h => h.status === 'skipped').length;
  const failed = runs.filter(h => h.status === 'failed').length;
  const last = runs[runs.length - 1] || null;
  const answered = sent + skipped;
  return {
    runs: runs.length, sent, skipped, failed,
    quietPct: answered ? Math.round(skipped / answered * 100) : null,
    lastMessages: last ? (last.messages || 0) : null,
    lastBullets: last && last.status === 'sent' ? countBullets(last.text) : null,
    lastStatus: last ? last.status : null,
  };
}

// Private chats of a people collection: messages in and out per contact, from stored message records.
export function peopleStats(msgs, jids, since = 0) {
  const byJid = Object.fromEntries((jids || []).map(j => [j, { name: '', in: 0, out: 0 }]));
  for (const m of msgs) {
    if (!m || m.kind !== 'dm' || !byJid[m.jid] || m.timestamp * 1000 < since) continue;
    const r = byJid[m.jid];
    if (m.groupName) r.name = m.groupName;
    if (m.sender === 'אני') r.out++; else r.in++;
  }
  return Object.entries(byJid).map(([jid, r]) => ({ jid, ...r }));
}

// Share of the minutes in the given days that the account was connected. Null when nothing was measured.
export function uptimePct(counters, days, accountId) {
  let up = 0, ticks = 0;
  for (const d of days) { const r = ((counters || {})[d] || {})[accountId]; if (r) { up += r.up || 0; ticks += r.ticks || 0; } }
  return ticks ? Math.round(up / ticks * 1000) / 10 : null;
}

// Change from `before` to `now` as a rounded percent. Null when there is no base to compare with.
export function trendPct(now, before) {
  if (!before) return null;
  return Math.round((now - before) / before * 100);
}

// At most `n` evenly spaced values of one field from samples (nulls skipped), for a small chart.
export function downsample(samples, field, n = 48) {
  const vals = (samples || []).map(s => (field === 'wifi' ? s.wifi && s.wifi.signalDbm : s[field])).filter(v => typeof v === 'number');
  if (vals.length <= n) return vals;
  const out = [];
  for (let i = 0; i < n; i++) out.push(vals[Math.floor(i * (vals.length - 1) / (n - 1))]);
  return out;
}
