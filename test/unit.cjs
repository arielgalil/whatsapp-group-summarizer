// Unit checks for pure helpers in server.js (extracted by name, run in isolation).
// eval only runs function bodies taken from our own server.js, never outside input.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r/g, '');
const grab = (name) => { const m = src.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`)); if (!m) throw new Error('not found ' + name); return m[0]; };
let pass = 0, fail = 0;
const t = (label, fn) => { try { fn(); pass++; console.log('  ok  ', label); } catch (e) { fail++; console.log('  FAIL', label, '-', e.message); } };

// normPhone + autoReplyActive
global.countryCode = () => '972';
eval(grab('normPhone').replace('function normPhone', 'global.normPhone = function'));
eval(grab('autoReplyActive').replace('function autoReplyActive', 'global.autoReplyActive = function'));
const at = (d, h, mi) => new Date(2026, 9, d, h, mi); // 18.10.2026 = Sunday
t('normPhone 052-123 4567', () => assert.strictEqual(normPhone('052-123 4567'), '972521234567'));
t('normPhone +972', () => assert.strictEqual(normPhone('+972 52 1234567'), '972521234567'));
t('overnight window Sunday 23:00', () => assert.ok(autoReplyActive({ start: '22:00', end: '07:00', days: [0] }, at(18, 23, 0))));
t('overnight window belongs to start day (Mon 03:00)', () => assert.ok(autoReplyActive({ start: '22:00', end: '07:00', days: [0] }, at(19, 3, 0))));
t('outside window', () => assert.ok(!autoReplyActive({ start: '22:00', end: '07:00', days: [] }, at(19, 12, 0))));
t('disabled rule', () => assert.ok(!autoReplyActive({ start: '00:00', end: '00:00', enabled: false }, at(19, 12, 0))));
t('same start/end = all day', () => assert.ok(autoReplyActive({ start: '08:00', end: '08:00' }, at(19, 3, 0))));

// data minimisation before text goes to Gemini
for (const fn of ['luhnOk', 'israeliIdOk', 'redactSensitive']) eval(grab(fn).replace('function ' + fn, 'global.' + fn + ' = function'));
t('redact: valid card number', () => assert.strictEqual(redactSensitive('הכרטיס 4111 1111 1111 1111 תודה'), 'הכרטיס [כרטיס אשראי] תודה'));
t('redact: card number with dashes', () => assert.ok(redactSensitive('5555-5555-5555-4444').includes('[כרטיס אשראי]')));
t('redact: number failing Luhn is left alone', () => assert.strictEqual(redactSensitive('מספר 4111 1111 1111 1112'), 'מספר 4111 1111 1111 1112'));
t('redact: valid Israeli ID', () => assert.strictEqual(redactSensitive('ת"ז 123456782'), 'ת"ז [ת.ז.]'));
t('redact: invalid 9 digits left alone', () => assert.strictEqual(redactSensitive('קוד 123456789'), 'קוד 123456789'));
t('redact: e-mail', () => assert.strictEqual(redactSensitive('כתבו ל-dana.levi@example.co.il'), 'כתבו ל-[אימייל]'));
t('redact: IBAN', () => assert.ok(redactSensitive('IL62 0108 0000 0009 9999 999').includes('[חשבון בנק]')));
t('redact: password line', () => assert.strictEqual(redactSensitive('הסיסמה לוויי-פיי: abc12345').includes('abc12345'), false));
t('redact: normal text and a phone number untouched', () => assert.strictEqual(redactSensitive('מחר אסיפה ב-18:30, חייגו 050-1234567'), 'מחר אסיפה ב-18:30, חייגו 050-1234567'));
global.config = { redactSensitive: false };
t('redact: can be switched off', () => assert.strictEqual(redactSensitive('a@b.co'), 'a@b.co'));
delete global.config;

// network gate: which clients are served while no password exists
eval(src.match(/const isPrivateIp = ip => \{[\s\S]*?\n\};\n/)[0].replace('const isPrivateIp =', 'global.isPrivateIp ='));
for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.1.2.3', '172.16.0.5', '172.31.255.1', '100.64.1.1', '169.254.3.3', 'fd12:3456::1', 'fe80::1']) t(`private: ${ip}`, () => assert.ok(isPrivateIp(ip)));
for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', '11.0.0.1', '2001:4860::1', '', undefined]) t(`public: ${ip}`, () => assert.ok(!isPrivateIp(ip)));

// pruneSignalSessions on a temporary folder
global.fs = fs; global.path = path;
global.MAX_CLOSED_SESSIONS = 2;
eval(grab('pruneSignalSessions').replace('function pruneSignalSessions', 'global.pruneSignalSessions = function'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
const mk = (n) => { const s = { open: { indexInfo: { closed: -1 } } }; for (let i = 1; i <= n; i++) s['c' + i] = { indexInfo: { closed: 1000 + i } }; return { _sessions: s, version: 'v1' }; };
fs.writeFileSync(path.join(dir, 'session-111.0.json'), JSON.stringify(mk(60)));
fs.writeFileSync(path.join(dir, 'session-222.0.json'), JSON.stringify(mk(1)));
fs.writeFileSync(path.join(dir, 'session-bad.0.json'), '{not json');
fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
const origErr = console.error; console.error = () => {};
pruneSignalSessions('test', dir);
console.error = origErr;
const after = JSON.parse(fs.readFileSync(path.join(dir, 'session-111.0.json'), 'utf8'))._sessions;
t('prune keeps open + 2 newest closed', () => assert.deepStrictEqual(Object.keys(after).sort(), ['c59', 'c60', 'open']));
t('prune leaves small records alone', () => assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'session-222.0.json'), 'utf8'))._sessions).length, 2));
t('prune survives a broken file', () => assert.strictEqual(fs.readFileSync(path.join(dir, 'session-bad.0.json'), 'utf8'), '{not json'));
t('prune never touches creds.json', () => assert.strictEqual(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'), '{}'));

// backup-folder retention rule
const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', 'auth-x.tgz'];
const re = /^\d{4}-\d{2}-\d{2}$/;
const rm = days.filter(d => re.test(d)).sort().slice(0, -7);
t('backups: only the oldest day folders are removed, archives untouched', () => assert.deepStrictEqual(rm, ['2026-10-10', '2026-10-11']));

// reconnect back-off schedule
const delayFor = n => Math.min(5000 * 2 ** Math.max(0, n - 3), 2 * 60 * 1000);
t('backoff: first drops reconnect after 5s', () => assert.deepStrictEqual([1, 2, 3].map(delayFor), [5000, 5000, 5000]));
t('backoff: grows and caps at 2 minutes', () => assert.deepStrictEqual([4, 5, 8, 20].map(delayFor), [10000, 20000, 120000, 120000]));

// static checks on the source
t('no leftover stanza diagnostics', () => assert.ok(!src.includes('Stanzas/2min')));
t('every fs.writeFileSync of state is atomic (tmp + rename)', () => {
  const lines = src.split('\n').filter(l => /fs\.writeFileSync\(/.test(l) && !/\.tmp|\+ '\.tmp'|tmp,/.test(l));
  assert.deepStrictEqual(lines.map(l => l.trim().slice(0, 90)), []);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
