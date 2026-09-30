const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
function load(name) {
  const out = {}, code = ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'require', code)(out, name => load(name.slice(2).replace(/\.ts$/, ''))); return out;
}
const { createIdentityHttpTransport } = load('identityHttpTransport');
const { createIdentityHttpGate, identityHttpReply } = load('identityHttp');
test('HTTP admission caps concurrent work, charges failed requests, and release is idempotent', () => {
  let now = 0; const gate = createIdentityHttpGate(() => now), releases = [];
  for (let i = 0; i < 8; i++) releases.push(gate('source'));
  assert.equal(gate('other'), null);
  for (const release of releases) { release(); release(); }
  for (let i = 0; i < 8; i++) gate('source')();
  assert.equal(gate('source'), null);
  for (let i = 0; i < 48; i++) gate('other-' + i)();
  assert.equal(gate('fresh'), null);
  now = 60000; assert.equal(typeof gate('source'), 'function');
});
test('wire dispatcher rejects invalid routes and oversized UTF-8 before cryptographic work', async () => {
  const service = { describe: () => { throw Error('should not run'); }, authenticate: async () => { throw Error('should not run'); } };
  assert.equal((await identityHttpReply(service, '/v2/identity/authenticate', '🙂'.repeat(5000))).status, 413);
  assert.equal((await identityHttpReply(service, '/v2/identity/describe?x=1', '{}')).status, 404);
  assert.equal((await identityHttpReply(service, '/v2/identity/describe', '{')).status, 400);
});
test('remote origins require HTTPS and requests never carry cookies or follow redirects', async () => {
  for (const url of ['http://example.com', 'http://localhost', 'https://x.test/path', 'https://a:b@x.test', 'https://x.test?x=1']) {
    assert.throws(() => createIdentityHttpTransport(url, async () => {}));
  }
  let request;
  const t = createIdentityHttpTransport('https://peer.test', async (url, init) => {
    request = { url, init }; return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  assert.equal(await t.exchange('describe', '{}'), '{}');
  assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.redirect, 'error');
  assert.equal(request.url, 'https://peer.test/v2/identity/describe'); t.close();
});
test('streamed bodies stop at the byte cap even without Content-Length, and close listeners run once', async () => {
  let reads = 0, cancelled = 0, closed = 0;
  const t = createIdentityHttpTransport('https://peer.test', async () => ({ ok: true, redirected: false,
    headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: new Uint8Array(9000) }; },
      cancel: async () => { cancelled++; },
    }) },
  }));
  t.onClosed(() => { closed++; }); await assert.rejects(t.exchange('describe', '{}'), /too large/);
  t.close(); assert.equal(reads, 2); assert.equal(cancelled, 1); assert.equal(closed, 1);
});
test('missing streams, redirects, oversized declared responses and invalid UTF-8 fail closed', async () => {
  const responses = [
    { ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), body: null },
    { ok: true, redirected: true, headers: new Headers({ 'content-type': 'application/json' }) },
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '16001' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of responses) {
    const t = createIdentityHttpTransport('https://peer.test', async () => response);
    await assert.rejects(t.exchange('describe', '{}'));
    await assert.rejects(t.exchange('describe', '{}'), /unavailable/);
  }
});
test('a stalled native fetch is aborted at the exchange deadline', { timeout: 6000 }, async () => {
  const t = createIdentityHttpTransport('https://peer.test', async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  await assert.rejects(t.exchange('describe', '{}'), /aborted/);
});
