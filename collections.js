// Collections come in two kinds:
// - "groups": a set of monitored WhatsApp groups. Every monitored group belongs to exactly one group collection.
// - "people": up to MAX_PEOPLE contacts, whose private chats (both directions) are summarized together.
// The default group collection ("כללי") replaces the old "main summary": it has its own time like any other.
// Pure functions only (no I/O), so they can be tested without WhatsApp.

export const GENERAL_ID = 'general';
export const GENERAL_NAME = 'כללי';
export const MAX_PEOPLE = 10;

export const kindOf = c => (c && c.kind) || 'groups';
const groupCollections = acc => Object.values(acc.collections || {}).filter(c => kindOf(c) === 'groups');

// Makes sure the default collection exists and that the group model holds:
// a group is in at most one group collection, every collected group is enabled, and every enabled group is collected.
// People collections are not touched here. Returns true when something changed. Idempotent.
export function ensureGeneral(acc) {
  let changed = false;
  acc.collections = acc.collections || {};
  if (!acc.collections[GENERAL_ID]) {
    acc.collections[GENERAL_ID] = { id: GENERAL_ID, name: GENERAL_NAME, time: acc.summaryTime || null, jids: [], enabled: true, prompt: '', kind: 'groups' };
    changed = true;
  }
  const groups = acc.monitoredGroups || {};
  const seen = new Set();
  for (const c of groupCollections(acc)) {
    const clean = [];
    for (const j of c.jids || []) {
      if (seen.has(j)) { changed = true; continue; }
      seen.add(j);
      clean.push(j);
    }
    if (clean.length !== (c.jids || []).length) changed = true;
    c.jids = clean;
  }
  for (const j of seen) {
    if (groups[j] && !groups[j].enabled) { groups[j].enabled = true; changed = true; }
  }
  for (const [jid, g] of Object.entries(groups)) {
    if (seen.has(jid) || !g.enabled) continue;
    acc.collections[GENERAL_ID].jids.push(jid);
    seen.add(jid);
    changed = true;
  }
  return changed;
}

// The one group collection a group belongs to, or null (not monitored).
export function collectionOf(acc, jid) {
  return groupCollections(acc).find(c => (c.jids || []).includes(jid)) || null;
}

// Put a group in one group collection (enables it), or take it out of the model (disables it).
export function setMembership(acc, jid, collectionId) {
  const groups = acc.monitoredGroups || {};
  for (const c of groupCollections(acc)) c.jids = (c.jids || []).filter(j => j !== jid);
  if (collectionId) {
    acc.collections[collectionId].jids.push(jid);
    if (groups[jid]) groups[jid].enabled = true;
  } else if (groups[jid]) {
    groups[jid].enabled = false;
  }
}

// Deleting a group collection never stops monitoring: its groups move to the default collection.
// The default collection cannot be deleted. Returns false when nothing was deleted.
export function deleteCollection(acc, cid) {
  if (cid === GENERAL_ID || !acc.collections || !acc.collections[cid]) return false;
  const col = acc.collections[cid];
  delete acc.collections[cid];
  if (kindOf(col) === 'people') return true;
  const general = acc.collections[GENERAL_ID];
  general.jids.push(...(col.jids || []).filter(j => !general.jids.includes(j)));
  return true;
}

// The people collection a private chat belongs to, or null. jid is the contact's "<phone>@s.whatsapp.net".
export function peopleCollectionFor(acc, jid) {
  return Object.values(acc.collections || {}).find(c => kindOf(c) === 'people' && c.enabled !== false && (c.jids || []).includes(jid)) || null;
}

// One scheduled summary per collection that has a time and at least one member.
export function dailyJobs(accounts) {
  const jobs = [];
  for (const [accId, acc] of Object.entries(accounts)) {
    for (const col of Object.values(acc.collections || {})) {
      if (col.enabled === false || !col.time || !(col.jids || []).length) continue;
      jobs.push({ key: `${accId}:col:${col.id}`, accId, time: col.time, jids: col.jids, label: `אוסף: ${col.name}`, meta: { collectionId: col.id } });
    }
  }
  return jobs;
}

// Same rule as the server: a leading 0 is an Israeli number.
export function normPhone(p) {
  const d = String(p || '').replace(/[^0-9]/g, '');
  return d.startsWith('0') ? '972' + d.slice(1) : d;
}

// The record to store for a private message of a contact in a people collection, or null when it should not be stored.
// A message counts when its chat resolves to a phone number (an @lid chat needs its phone-number alternative)
// and that number is in an enabled people collection. Both directions are kept: sender is "אני" for the user's own.
export function directMessageRecord({ acc, msg, contacts = {}, seen = {}, extractText }) {
  if (!acc || !msg || !msg.message || !msg.key || !msg.key.id) return null;
  const k = msg.key;
  const cand = [k.remoteJidAlt, k.remoteJid, k.senderPn, k.participantPn].find(j => j && String(j).endsWith('@s.whatsapp.net'));
  if (!cand) return null;
  const phone = normPhone(String(cand).split('@')[0].split(':')[0]);
  const jid = `${phone}@s.whatsapp.net`;
  if (!peopleCollectionFor(acc, jid)) return null;
  const text = String(extractText(msg.message) || '').trim();
  if (!text) return null;
  const c = contacts[phone] || {};
  const name = c.name || c.notify || (seen[phone] || {}).name || msg.pushName || `+${phone}`;
  const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
  return { id: k.id, jid, groupName: name, sender: k.fromMe ? 'אני' : (msg.pushName || name), text, timestamp, kind: 'dm' };
}
