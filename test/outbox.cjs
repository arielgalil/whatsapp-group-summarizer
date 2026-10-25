// Outbox (persistent send queue) simulation: the real code from server.js runs against stub sockets and a temp folder.
// eval only runs the block taken from our own server.js, never outside input.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, process.env.SERVER_JS || path.join('..', 'server.js')), 'utf8').replace(/\r/g, '');
const block = src.slice(src.indexOf('/* OUTBOX START */'), src.indexOf('/* OUTBOX END */'));
let pass = 0, fail = 0;
const t = async (label, fn) => { try { await fn(); pass++; console.log('  ok  ', label); } catch (e) { fail++; console.log('  FAIL', label, '-', e.message); } };

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const env = { sessions: {}, sendHistory: [], alerts: [], errors: [], sent: [] };
function load() {
  // a fresh "process": the block re-reads data/outbox.json exactly as a restarted server would
  const fn = new Function('fs', 'path', 'crypto', 'DATA_DIR', 'HISTORY_FILE', 'sessions', 'sendHistory', 'config', 'rememberSent', 'notify', 'logError', 'console', 'setInterval',
    block + '\nreturn { enqueueSend, outboxTick, outboxMessageId, outboxBackoff, get outbox() { return outbox; } };');
  return fn(fs, path, crypto, DATA_DIR, HISTORY_FILE, env.sessions, env.sendHistory, { accounts: { a: { name: 'A' } } },
    () => {}, (k, text) => env.alerts.push(text), (kind, text) => env.errors.push(kind + ': ' + text),
    { log() {}, error() {} }, () => 0);
}
const sock = (behaviour) => ({ sendMessage: async (to, content, opts) => { env.sent.push({ to, text: content.text, messageId: opts && opts.messageId }); if (behaviour === 'fail') throw new Error('boom'); return { key: { id: opts.messageId }, message: { conversation: content.text } }; } });
const onDisk = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outbox.json'), 'utf8'));

(async () => {
  let ob = load();
  await t('message id is fixed per job and looks like a WhatsApp id', () => {
    assert.strictEqual(ob.outboxMessageId('x|1'), ob.outboxMessageId('x|1'));
    assert.notStrictEqual(ob.outboxMessageId('x|1'), ob.outboxMessageId('x|2'));
    assert.match(ob.outboxMessageId('x|1'), /^3EB0[0-9A-F]{18}$/);
  });
  await t('back-off doubles and caps at 15 minutes', () => assert.deepStrictEqual([1, 2, 3, 10].map(ob.outboxBackoff), [30000, 60000, 120000, 900000]));

  env.sendHistory.push({ id: 'h1', accountId: 'a', label: 'אוסף: עבודה', status: 'queued', recipients: 0 });
  await t('a queued job is written to disk at once', () => { assert.ok(ob.enqueueSend({ id: 'a|col:1|2026-10-25|me', accountId: 'a', to: 'me@s', text: 'hi', historyId: 'h1' })); assert.strictEqual(onDisk()[0].status, 'pending'); });
  await t('the same job id is never queued twice', () => assert.strictEqual(ob.enqueueSend({ id: 'a|col:1|2026-10-25|me', accountId: 'a', to: 'me@s', text: 'hi', historyId: 'h1' }), false));
  await t('no link: the job waits and no attempt is counted', async () => { await ob.outboxTick(); assert.strictEqual(ob.outbox[0].status, 'pending'); assert.strictEqual(ob.outbox[0].attempts, 0); assert.strictEqual(env.sent.length, 0); });

  env.sessions.a = { status: 'connected', sock: sock('fail') };
  await t('a failed send is retried later with back-off', async () => { await ob.outboxTick(); const j = ob.outbox[0]; assert.strictEqual(j.status, 'pending'); assert.strictEqual(j.attempts, 1); assert.ok(j.nextAt > Date.now() + 25000); assert.strictEqual(env.sendHistory[0].status, 'queued'); });

  // crash simulation: the process died after marking "sending" (maybe after WhatsApp already took it)
  const jobs = onDisk(); jobs[0].status = 'sending'; jobs[0].nextAt = 0; fs.writeFileSync(path.join(DATA_DIR, 'outbox.json'), JSON.stringify(jobs));
  ob = load();
  env.sessions.a = { status: 'connected', sock: sock('ok') };
  env.sent.length = 0;
  await t('after a restart an interrupted send is resent with the SAME message id', async () => {
    await ob.outboxTick();
    assert.strictEqual(env.sent.length, 1);
    assert.strictEqual(env.sent[0].messageId, ob.outboxMessageId('a|col:1|2026-10-25|me'));
    assert.strictEqual(ob.outbox[0].status, 'sent');
  });
  await t('delivered: history says sent, the text is not kept in the queue', () => { assert.strictEqual(env.sendHistory[0].status, 'sent'); assert.strictEqual(env.sendHistory[0].recipients, 1); assert.strictEqual(onDisk()[0].text, undefined); });
  await t('a sent job is not sent again on the next ticks', async () => { await ob.outboxTick(); await ob.outboxTick(); assert.strictEqual(env.sent.length, 1); });
  await t('a repeated job id after delivery is still refused (no duplicate summary)', () => assert.strictEqual(ob.enqueueSend({ id: 'a|col:1|2026-10-25|me', accountId: 'a', to: 'me@s', text: 'hi again', historyId: 'h9' }), false));

  // give up after 6 hours without success
  env.sendHistory.push({ id: 'h2', accountId: 'a', label: 'אוסף: משפחה', status: 'queued', recipients: 0 });
  ob.enqueueSend({ id: 'old', accountId: 'a', to: 'me@s', text: 'x', historyId: 'h2' });
  ob.outbox.find(j => j.id === 'old').createdAt = Date.now() - 7 * 3600 * 1000;
  env.sessions.a = { status: 'reconnecting' };
  await t('after 6 hours the job is failed, the history shows it and an alert goes out', async () => {
    await ob.outboxTick();
    assert.strictEqual(ob.outbox.find(j => j.id === 'old').status, 'failed');
    assert.strictEqual(env.sendHistory[1].status, 'failed');
    assert.ok(env.alerts.some(a => a.includes('משפחה')));
    assert.ok(env.errors.some(e => e.startsWith('send:')));
  });
  await t('finished jobs older than 3 days are dropped', async () => {
    ob.outbox.forEach(j => { if (j.status !== 'pending') { j.sentAt = Date.now() - 4 * 86400 * 1000; j.createdAt = j.sentAt; } });
    await ob.outboxTick();
    assert.strictEqual(ob.outbox.length, 0);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
