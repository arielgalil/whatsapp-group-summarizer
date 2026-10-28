import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourlyCounts, quietGroups, activeUnmonitored, countBullets, collectionStats, peopleStats, uptimePct, trendPct, downsample } from '../insights.js';

const sec = iso => Math.floor(Date.parse(iso) / 1000);

test('hourlyCounts: Israel hour of the day (winter time is UTC+2)', () => {
  const out = hourlyCounts([{ timestamp: sec('2026-01-10T08:30:00Z') }, { timestamp: sec('2026-01-10T08:59:00Z') }, { timestamp: sec('2026-01-10T22:10:00Z') }]);
  assert.equal(out.length, 24);
  assert.equal(out[10], 2);
  assert.equal(out[0], 1);
});

test('hourlyCounts: messages older than `since` are left out', () => {
  const out = hourlyCounts([{ timestamp: sec('2026-01-10T08:30:00Z') }], Date.parse('2026-01-11T00:00:00Z'));
  assert.equal(out.reduce((a, b) => a + b, 0), 0);
});

test('quietGroups: only monitored groups, never-active ones first', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const g = { a: { name: 'A', enabled: true, lastActivity: now - 10 * 86400e3 }, b: { name: 'B', enabled: true, lastActivity: now - 2 * 86400e3 }, c: { name: 'C', enabled: false, lastActivity: 0 }, d: { name: 'D', enabled: true, lastActivity: 0 } };
  assert.deepEqual(quietGroups(g, now).map(x => x.name), ['D', 'A']);
  assert.equal(quietGroups(g, now)[1].daysSince, 10);
});

test('activeUnmonitored: recent groups that are off, newest first, limited', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const g = { a: { name: 'A', enabled: false, lastActivity: now - 3 * 3600e3 }, b: { name: 'B', enabled: false, lastActivity: now - 1 * 3600e3 }, c: { name: 'C', enabled: true, lastActivity: now }, d: { name: 'D', enabled: false, lastActivity: now - 5 * 86400e3 } };
  assert.deepEqual(activeUnmonitored(g, now, 48, 5).map(x => x.name), ['B', 'A']);
  assert.equal(activeUnmonitored(g, now, 48, 1).length, 1);
});

test('countBullets counts bullet lines only', () => {
  assert.equal(countBullets('📌 *דחוף*\n• אחד\n• שניים\n\nסיום'), 2);
  assert.equal(countBullets('- a\n* b\nplain'), 2);
  assert.equal(countBullets(''), 0);
});

test('collectionStats: counts by outcome and describes the last run', () => {
  const h = [
    { collectionId: 'k', status: 'sent', messages: 100, text: '• a\n• b' },
    { collectionId: 'k', status: 'skipped', messages: 50 },
    { collectionId: 'x', status: 'sent', messages: 9, text: '• z' },
    { collectionId: 'k', status: 'sent', messages: 200, text: '• a\n• b\n• c' },
  ];
  const s = collectionStats(h, 'k');
  assert.deepEqual([s.runs, s.sent, s.skipped, s.failed, s.quietPct, s.lastMessages, s.lastBullets], [3, 2, 1, 0, 33, 200, 3]);
  assert.equal(collectionStats(h, 'none').runs, 0);
  assert.equal(collectionStats(h, 'none').quietPct, null);
});

test('peopleStats: messages in and out per contact, from dm records only', () => {
  const J = '972500000001@s.whatsapp.net';
  const msgs = [
    { kind: 'dm', jid: J, groupName: 'נועה', sender: 'נועה', timestamp: 2000 },
    { kind: 'dm', jid: J, groupName: 'נועה', sender: 'אני', timestamp: 2001 },
    { kind: 'dm', jid: J, groupName: 'נועה', sender: 'נועה', timestamp: 2002 },
    { jid: J, groupName: 'קבוצה', sender: 'x', timestamp: 2003 },
    { kind: 'dm', jid: 'other@s.whatsapp.net', sender: 'y', timestamp: 2004 },
  ];
  assert.deepEqual(peopleStats(msgs, [J, '972500000002@s.whatsapp.net']), [
    { jid: J, name: 'נועה', in: 2, out: 1 },
    { jid: '972500000002@s.whatsapp.net', name: '', in: 0, out: 0 },
  ]);
});

test('uptimePct: connected minutes over measured minutes', () => {
  const c = { '2026-10-27': { a: { up: 1430, ticks: 1440 } }, '2026-10-28': { a: { up: 60, ticks: 60 } } };
  assert.equal(uptimePct(c, ['2026-10-27', '2026-10-28'], 'a'), 99.3);
  assert.equal(uptimePct(c, ['2026-10-26'], 'a'), null);
});

test('trendPct: percent change, null without a base', () => {
  assert.equal(trendPct(150, 100), 50);
  assert.equal(trendPct(50, 100), -50);
  assert.equal(trendPct(5, 0), null);
});

test('downsample: keeps short series, thins long ones, reads wifi dBm, skips nulls', () => {
  assert.deepEqual(downsample([{ tempC: 40 }, { tempC: null }, { tempC: 42 }], 'tempC'), [40, 42]);
  assert.equal(downsample(Array.from({ length: 300 }, (_, i) => ({ cpuPct: i })), 'cpuPct', 48).length, 48);
  assert.deepEqual(downsample([{ wifi: { signalDbm: -60 } }, { wifi: null }], 'wifi'), [-60]);
});
