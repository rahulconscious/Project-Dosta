// Run with the server up: npm start (in another terminal), then: npm test
const B = process.env.BASE || 'http://localhost:3000'; let cookie = '';
const call = async (m, p, b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie; return { s: r.status, j: await r.json() }; };
const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) process.exitCode = 1; };
const email = `t${Date.now()}@example.com`;
ok((await call('GET', '/me')).s === 401, 'unauthenticated blocked');
const r = await call('POST', '/register', { email, password: 'password123', name: 'Test' }); ok(r.s === 200 && r.j.profiles.length === 1, 'register creates default companion');
const pid = r.j.profiles[0].id;
const p2 = await call('POST', '/profiles', { name: 'Second', intensity: 2 }); ok(p2.s === 200, 'second companion');
const m = await call('POST', `/p/${pid}/memories`, { text: 'likes filter coffee' }); ok(m.s === 200, 'add memory');
ok((await call('GET', `/p/${p2.j.id}/memories`)).j.length === 0, 'memory isolated per profile');
ok((await call('PATCH', `/p/${pid}/memories/${m.j.id}`, { text: 'likes tea' })).j.text === 'likes tea', 'edit memory');
const g = await call('POST', `/p/${pid}/goals`, { text: 'walk' }); ok((await call('PATCH', `/p/${pid}/goals/${g.j.id}`, { done: true })).j.done === 1, 'goal done');
ok((await call('DELETE', `/p/${pid}/memories/${m.j.id}`)).s === 200, 'delete memory');
ok((await call('POST', `/p/${pid}/chat`, { text: 'hi' })).s !== 401, 'chat reachable (503 without API key is expected)');
await call('POST', '/logout'); ok((await call('GET', '/me')).s === 401, 'logout');
const l = await call('POST', '/login', { email, password: 'wrong' }); ok(l.s === 401, 'bad password rejected');
ok((await call('POST', '/login', { email, password: 'password123' })).s === 200, 'login');
ok((await call('DELETE', '/me')).s === 200, 'delete account');
