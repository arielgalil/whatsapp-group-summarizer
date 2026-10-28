import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureGeneral, collectionOf, setMembership, deleteCollection, dailyJobs, GENERAL_ID } from '../collections.js';

const group = (enabled) => ({ name: 'g', enabled, tags: [] });

test('migration: enabled groups without a collection go to the default collection', () => {
  const acc = { summaryTime: '10:00', monitoredGroups: { a: group(true), b: group(false) }, collections: {} };
  assert.equal(ensureGeneral(acc), true);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, ['a']);
  assert.equal(acc.collections[GENERAL_ID].time, '10:00');
  assert.equal(acc.monitoredGroups.b.enabled, false);
});

test('migration: a group in two collections keeps only the first', () => {
  const acc = {
    monitoredGroups: { a: group(true) },
    collections: { x: { id: 'x', name: 'X', jids: ['a'], enabled: true }, y: { id: 'y', name: 'Y', jids: ['a'], enabled: true } },
  };
  ensureGeneral(acc);
  assert.deepEqual(acc.collections.x.jids, ['a']);
  assert.deepEqual(acc.collections.y.jids, []);
  assert.equal(collectionOf(acc, 'a').id, 'x');
});

test('migration: a collected group is enabled, and it is not added to the default collection twice', () => {
  const acc = { monitoredGroups: { a: group(false) }, collections: { x: { id: 'x', name: 'X', jids: ['a'], enabled: true } } };
  ensureGeneral(acc);
  assert.equal(acc.monitoredGroups.a.enabled, true);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, []);
});

test('migration is idempotent', () => {
  const acc = { monitoredGroups: { a: group(true) }, collections: {} };
  ensureGeneral(acc);
  assert.equal(ensureGeneral(acc), false);
});

test('setMembership moves a group and enables it', () => {
  const acc = { monitoredGroups: { a: group(false) }, collections: { x: { id: 'x', jids: [] }, [GENERAL_ID]: { id: GENERAL_ID, jids: ['a'] } } };
  setMembership(acc, 'a', 'x');
  assert.deepEqual(acc.collections[GENERAL_ID].jids, []);
  assert.deepEqual(acc.collections.x.jids, ['a']);
  assert.equal(acc.monitoredGroups.a.enabled, true);
});

test('setMembership(null) takes the group out and disables it', () => {
  const acc = { monitoredGroups: { a: group(true) }, collections: { [GENERAL_ID]: { id: GENERAL_ID, jids: ['a'] } } };
  setMembership(acc, 'a', null);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, []);
  assert.equal(acc.monitoredGroups.a.enabled, false);
});

test('deleting a collection moves its groups to the default collection', () => {
  const acc = { collections: { x: { id: 'x', jids: ['a', 'b'] }, [GENERAL_ID]: { id: GENERAL_ID, jids: ['b'] } } };
  assert.equal(deleteCollection(acc, 'x'), true);
  assert.equal(acc.collections.x, undefined);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, ['b', 'a']);
});

test('the default collection cannot be deleted', () => {
  const acc = { collections: { [GENERAL_ID]: { id: GENERAL_ID, jids: ['a'] } } };
  assert.equal(deleteCollection(acc, GENERAL_ID), false);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, ['a']);
});

test('dailyJobs: one job per timed, enabled, non-empty collection', () => {
  const accounts = {
    acc1: { collections: {
      a: { id: 'a', name: 'A', time: '08:00', jids: ['1'], enabled: true },
      b: { id: 'b', name: 'B', time: '09:00', jids: [], enabled: true },
      c: { id: 'c', name: 'C', time: null, jids: ['2'], enabled: true },
      d: { id: 'd', name: 'D', time: '07:00', jids: ['3'], enabled: false },
    } },
  };
  const jobs = dailyJobs(accounts);
  assert.deepEqual(jobs.map(j => j.key), ['acc1:col:a']);
  assert.equal(jobs[0].time, '08:00');
});
