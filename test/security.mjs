// Security regression checks against a locally running server (fresh install, port 3123)
const B = 'http://127.0.0.1:3123';
let jar = '';
let pass = 0, fail = 0;
const t = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? '  ok  ' : '  FAIL', label, extra); };
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar ? { Cookie: jar } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && /sid=[^;]+/.test(sc) && !/sid=;/.test(sc)) jar = sc.match(/sid=[^;]+/)[0]; if (sc && /sid=;/.test(sc)) jar = '';
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j, h: r.headers };
};

// headers
const idx = await fetch(B + '/');
for (const [k, v] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'no-referrer']]) t(`header ${k}`, idx.headers.get(k) === v);
t('CSP present', /default-src 'self'/.test(idx.headers.get('content-security-policy') || ''));
t('no X-Powered-By', !idx.headers.get('x-powered-by'));

// prototype keys
t('/api/accounts/__proto__/settings -> 400', (await call('POST', '/api/accounts/__proto__/settings', { name: 'x' })).status === 400);
t('/api/accounts/constructor/settings -> 400', (await call('POST', '/api/accounts/constructor/settings', { name: 'x' })).status === 400);
t('unknown account -> 404', (await call('POST', '/api/accounts/nope/settings', { name: 'x' })).status === 404);
t('body jid __proto__ -> 400', (await call('POST', '/api/accounts/main/toggle-group', { jid: '__proto__', enabled: true })).status === 400);
t('body jids [constructor] -> 400', (await call('POST', '/api/accounts/main/collections', { name: 'x', jids: ['constructor'] })).status === 400);
t('Object.prototype untouched', ({}).enabled === undefined && ({}).name === undefined);
t('oversized body rejected', (await call('POST', '/api/accounts/main/settings', { prompt: 'x'.repeat(200000) })).status === 413);

// passwords
t('password < 8 rejected', (await call('POST', '/api/auth/password', { accountId: 'main', password: 'abc1234' })).status === 400);
const set = await call('POST', '/api/auth/password', { accountId: 'main', password: 'correct horse battery' });
t('password set', set.j && set.j.ok === true);
const cookieHeader = set.h.get('set-cookie') || '';
t('session cookie is HttpOnly + SameSite=Strict', /HttpOnly/.test(cookieHeader) && /SameSite=Strict/.test(cookieHeader));
const saved = jar; jar = '';
t('no cookie -> API 401', (await call('GET', '/api/status')).status === 401);
t('wrong password -> 401', (await call('POST', '/api/auth/login', { password: 'nope-nope-nope' })).status === 401);
jar = saved;
const st = await call('GET', '/api/status');
t('with cookie -> status 200', st.status === 200 && st.j && st.j.accounts && st.j.accounts.main);
const dl = await call('POST', '/api/accounts/main/delivery-settings', { sendToSelf: true });
t('settings response has no password hash', dl.j && dl.j.account && !('auth' in dl.j.account) && !JSON.stringify(dl.j).includes('"hash"'));
const st2 = JSON.stringify(st.j);
t('status never contains hash/salt/api key', !/"hash"|"salt"|geminiApiKey/.test(st2));
t('static: path traversal blocked', (await fetch(B + '/..%2f..%2fserver.js')).status !== 200 || !(await (await fetch(B + '/..%2f..%2fserver.js')).text()).includes('express'));
t('static: server.js not served', !(await (await fetch(B + '/server.js')).text()).includes("import express"));
t('static: config.json not served', (await fetch(B + '/config.json')).status === 404);
// brute force limiter
let limited = false;
jar = '';
for (let i = 0; i < 8; i++) { const r = await call('POST', '/api/auth/login', { password: 'wrong-' + i }); if (r.status === 429) limited = true; }
t('login brute force limited (429)', limited);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
