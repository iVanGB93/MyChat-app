const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/services/identity/nativeAxonTransport.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
new Function('require', 'exports', code)(() => ({ AXON_FRAME_BYTES: 20000 }), api);
const candidate = { account: 'axonic:1:' + 'ab'.repeat(32), endpoint: 'axon-lan://192.168.1.9:9000', route: 'lan', expiresAt: Date.now() + 60000 };
function fixture(overrides = {}) {
  const calls = { reads: 0, closed: [], writes: [] }, controller = new AbortController();
  const native = { axonConnect: async () => 'socket', axonRead: async () => { calls.reads++; return new Promise(() => {}); },
    axonWrite: async (id, raw) => { calls.writes.push(raw); return true; }, axonClose: id => { calls.closed.push(id); }, ...overrides };
  return { calls, controller, connect: c => api.createNativeAxonConnector(native)(c ?? candidate, { signal: controller.signal, onClosed() {} }) };
}
const flush = () => new Promise(r => setImmediate(r));
test('native reads wait for listener attachment and abort closes exactly once', async () => {
  const f = fixture(), wire = await f.connect(); let closed = 0;
  assert.equal(f.calls.reads, 0);
  wire.listen(() => {}, () => { closed++; }); assert.equal(f.calls.reads, 1);
  f.controller.abort(); wire.close(); assert.equal(closed, 1); assert.deepEqual(f.calls.closed, ['socket']);
});
test('late native connect results are closed after cancellation', async () => {
  let resolve;
  const f = fixture({ axonConnect: () => new Promise(r => { resolve = r; }) });
  const pending = f.connect(); f.controller.abort(); resolve('late');
  await assert.rejects(pending, /canceled/); assert.deepEqual(f.calls.closed, ['late']);
});
test('native sends serialize, bound queued bytes and close on write failure', async () => {
  let finish, calls = 0;
  const f = fixture({ axonWrite: () => { calls++; return new Promise(r => { finish = r; }); } }), wire = await f.connect();
  wire.send('x'.repeat(20000)); wire.send('x'.repeat(20000)); assert.equal(calls, 1);
  assert.throws(() => wire.send('x'), /capacity/); assert.deepEqual(f.calls.closed, ['socket']);
  finish(true); await flush(); assert.equal(calls, 1);
  const g = fixture({ axonWrite: async () => false }), failed = await g.connect();
  failed.send('test'); await flush(); assert.deepEqual(g.calls.closed, ['socket']);
});
test('non-LAN routes, hostnames, normalized alternatives and malformed endpoints never dial', async () => {
  const f = fixture({ axonConnect: () => { assert.fail('must not dial'); } });
  for (const endpoint of ['axon-lan://127.0.0.1:90', 'axon-lan://8.8.8.8:90', 'axon-lan://192.168.01.9:90',
    'axon-lan://192.168.1.9:65536', 'axon-lan://192.168.1.9:90/path', 'axon-lan://peer.test:90', 'ws://192.168.1.9:90']) {
    await assert.rejects(f.connect({ ...candidate, endpoint }), /Unsupported/);
  }
  await assert.rejects(f.connect({ ...candidate, route: 'internet' }), /Unsupported/);
});
test('native read errors and oversized replies close the wire without delivery', async () => {
  for (const axonRead of [async () => { throw Error('closed'); }, async () => 'x'.repeat(20001)]) {
    const f = fixture({ axonRead }), wire = await f.connect(); let closed = 0;
    wire.listen(() => assert.fail('must not deliver'), () => { closed++; }); await flush();
    assert.equal(closed, 1); assert.deepEqual(f.calls.closed, ['socket']);
  }
});
test('adopted sockets replay the consumed hello before reading more native frames', async () => {
  let reads = 0, closed = 0;
  const controller = new AbortController(), received = [];
  const native = { axonRead: async () => { reads++; return new Promise(() => {}); }, axonClose() { closed++; },
    axonConnect() { assert.fail('accepted socket must not redial'); }, axonWrite: async () => true };
  const wire = await api.adoptNativeAxonWire(native, 'accepted', '{"kind":"hello"}', { signal: controller.signal, onClosed() {} });
  assert.equal(reads, 0);
  wire.listen(raw => received.push(raw), () => {});
  assert.deepEqual(received, ['{"kind":"hello"}']); assert.equal(reads, 1);
  controller.abort(); assert.equal(closed, 1);
});
