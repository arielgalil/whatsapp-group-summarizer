import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureGeneral, collectionOf, deleteCollection, peopleCollectionFor, dailyJobs as collectionJobs, GENERAL_ID, MAX_PEOPLE } from '../collections.js';

const P = '972501234567@s.whatsapp.net';

test('people collections do not change the group model', () => {
  const acc = {
    summaryTime: '10:00',
    monitoredGroups: { g1: { enabled: true } },
    collections: { p: { id: 'p', kind: 'people', name: 'עבודה', jids: [P], enabled: true } },
  };
  ensureGeneral(acc);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, ['g1']);
  assert.deepEqual(acc.collections.p.jids, [P]);
  assert.equal(collectionOf(acc, P), null);
});

test('a contact is not treated as a group member', () => {
  const acc = { monitoredGroups: {}, collections: { p: { id: 'p', kind: 'people', jids: [P] } } };
  assert.equal(peopleCollectionFor(acc, P).id, 'p');
  assert.equal(peopleCollectionFor(acc, '972509999999@s.whatsapp.net'), null);
});

test('deleting a people collection does not move anyone into the group default', () => {
  const acc = { collections: { [GENERAL_ID]: { id: GENERAL_ID, jids: [] }, p: { id: 'p', kind: 'people', jids: [P] } } };
  assert.equal(deleteCollection(acc, 'p'), true);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, []);
});

test('a disabled people collection does not match a chat', () => {
  const acc = { collections: { p: { id: 'p', kind: 'people', enabled: false, jids: [P] } } };
  assert.equal(peopleCollectionFor(acc, P), null);
});

test('the limit is ten contacts', () => {
  assert.equal(MAX_PEOPLE, 10);
});

import { directMessageRecord, normPhone } from '../collections.js';

const acc = { collections: { p: { id: 'p', kind: 'people', enabled: true, jids: ['972501234567@s.whatsapp.net'] } } };
const text = m => (m && m.conversation) || '';
const msg = (extra = {}) => ({ key: { id: 'A1', remoteJid: '972501234567@s.whatsapp.net', fromMe: false, ...extra.key }, message: { conversation: 'שלום' }, messageTimestamp: 1700000000, pushName: 'דנה', ...extra.top });

test('normPhone turns a leading 0 into 972', () => {
  assert.equal(normPhone('050-123-4567'), '972501234567');
});

test('an incoming private message from a person in the collection is stored', () => {
  const r = directMessageRecord({ acc, msg: msg(), extractText: text });
  assert.deepEqual(r, { id: 'A1', jid: '972501234567@s.whatsapp.net', groupName: 'דנה', sender: 'דנה', text: 'שלום', timestamp: 1700000000, kind: 'dm' });
});

test('the user own message is stored with sender אני, under the contact', () => {
  const r = directMessageRecord({ acc, msg: msg({ key: { fromMe: true } }), contacts: { '972501234567': { name: 'דנה כהן' } }, extractText: text });
  assert.equal(r.sender, 'אני');
  assert.equal(r.groupName, 'דנה כהן');
});

test('an @lid chat is matched through its phone-number alternative', () => {
  const r = directMessageRecord({ acc, msg: msg({ key: { remoteJid: '123456@lid', remoteJidAlt: '972501234567@s.whatsapp.net' } }), extractText: text });
  assert.equal(r.jid, '972501234567@s.whatsapp.net');
});

test('an @lid chat without a phone number is not stored', () => {
  assert.equal(directMessageRecord({ acc, msg: msg({ key: { remoteJid: '123456@lid' } }), extractText: text }), null);
});

test('a contact outside any people collection, or a message without text, is not stored', () => {
  assert.equal(directMessageRecord({ acc, msg: msg({ key: { remoteJid: '972509999999@s.whatsapp.net' } }), extractText: text }), null);
  assert.equal(directMessageRecord({ acc, msg: { ...msg(), message: { imageMessage: {} } }, extractText: text }), null);
});

test('a paused people collection does not store', () => {
  const paused = { collections: { p: { ...acc.collections.p, enabled: false } } };
  assert.equal(directMessageRecord({ acc: paused, msg: msg(), extractText: text }), null);
});

import { PEOPLE_ID } from '../collections.js';

test('a fresh account gets General and an empty people collection', () => {
  const acc = { summaryTime: '20:00', monitoredGroups: {} };
  assert.equal(ensureGeneral(acc), true);
  assert.deepEqual(acc.collections[GENERAL_ID].jids, []);
  assert.deepEqual(acc.collections[PEOPLE_ID], { id: PEOPLE_ID, kind: 'people', name: 'אנשי קשר', time: null, jids: [], names: {}, enabled: true, prompt: '' });
});

test('the default people collection is seeded once: deleting it keeps it deleted', () => {
  const acc = { monitoredGroups: {} };
  ensureGeneral(acc);
  assert.equal(deleteCollection(acc, PEOPLE_ID), true);
  ensureGeneral(acc);
  assert.equal(acc.collections[PEOPLE_ID], undefined);
});

test('an account that already has a people collection does not get a second one', () => {
  const acc = { monitoredGroups: {}, collections: { p: { id: 'p', kind: 'people', name: 'צוות', jids: [P] } } };
  ensureGeneral(acc);
  assert.deepEqual(Object.keys(acc.collections).sort(), ['general', 'p']);
});

test('empty collections are never scheduled', () => {
  const acc = { summaryTime: '20:00', monitoredGroups: {} };
  ensureGeneral(acc);
  assert.deepEqual(collectionJobs({ x: acc }), []);
});
