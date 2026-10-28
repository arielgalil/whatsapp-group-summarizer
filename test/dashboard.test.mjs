import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, lastDays, bumpDaily, pruneDaily, seriesOf, totalOf } from '../dashboard.js';

test('dayKey uses the Israel calendar day', () => {
  // 2026-10-26 22:30 UTC is already 2026-10-27 in Israel (UTC+2 in late October)
  assert.equal(dayKey(Date.UTC(2026, 9, 26, 22, 30)), '2026-10-27');
});

test('lastDays: oldest first, ending today', () => {
  const now = Date.UTC(2026, 9, 27, 12, 0);
  assert.deepEqual(lastDays(3, now), ['2026-10-25', '2026-10-26', '2026-10-27']);
});

test('bumpDaily adds per account and per key', () => {
  const c = {};
  bumpDaily(c, '2026-10-27', 'acc1', 'sent');
  bumpDaily(c, '2026-10-27', 'acc1', 'sent', 2);
  bumpDaily(c, '2026-10-27', 'acc2', 'collected', 5);
  assert.deepEqual(c, { '2026-10-27': { acc1: { sent: 3 }, acc2: { collected: 5 } } });
});

test('seriesOf and totalOf filter by account', () => {
  const c = { '2026-10-26': { acc1: { sent: 1 }, acc2: { sent: 4 } }, '2026-10-27': { acc1: { sent: 2 } } };
  const days = ['2026-10-26', '2026-10-27'];
  assert.deepEqual(seriesOf(c, days, 'sent'), [5, 2]);
  assert.deepEqual(seriesOf(c, days, 'sent', ['acc1']), [1, 2]);
  assert.equal(totalOf(c, days, 'sent', ['acc2']), 4);
  assert.equal(totalOf(c, ['2026-09-01'], 'sent'), 0);
});

test('pruneDaily keeps the newest days', () => {
  const c = { '2026-10-01': {}, '2026-10-02': {}, '2026-10-03': {} };
  pruneDaily(c, 2);
  assert.deepEqual(Object.keys(c), ['2026-10-02', '2026-10-03']);
});
