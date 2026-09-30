const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const out = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/services/identity/neuronConnections.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(out);
const { createNeuronConnections } = out;
const account = n => 'axonic:1:' + n.toString(16).padStart(64, '0');
const drain = () => new Promise(r => setImmediate(r));
function fixture(limit) {
  let now = 1000;
  const opens = [], closed = [];
  const open = (c, context) => new Promise(resolve => opens.push({ c, context, resolve }));
  const pool = createNeuronConnections({ localAccount: account(0), now: () => now, open, limit, jitter: () => 0 });
  const candidate = (n, route = 'lan') => ({ account: account(n), route, endpoint: `test:${n}`, expiresAt: now + 120000 });
  const finish = (i, n = Number.parseInt(opens[i].c.account.slice(-4), 16)) => opens[i].resolve({
    peer: { account: account(n), device: 'ab'.repeat(32), instance: 'cd'.repeat(32), expiresAt: now + 60000 },
    close: () => closed.push(i),
  });
  return { pool, opens, closed, candidate, finish, open, advance: ms => { now += ms; } };
}
test('five slots bound concurrent outgoing and incoming authentication, with no self or duplicate peers', async () => {
  const f = fixture();
  assert.equal(f.pool.offer(f.candidate(0)), false);
  for (let i = 1; i <= 12; i++) f.pool.offer(f.candidate(i));
  f.pool.tick(); f.pool.tick(); assert.equal(f.opens.length, 5);
  assert.equal(f.pool.accept(f.candidate(40), f.open), false);
  assert.equal(f.pool.accept(f.candidate(1), f.open), false);
  for (let i = 0; i < 5; i++) f.finish(i);
  await drain(); assert.equal(f.pool.snapshot().connections.filter(s => s.state === 'connected').length, 5);
});
test('local routes are preferred while one slot remains available for wider connectivity', async () => {
  const f = fixture();
  for (let i = 1; i <= 8; i++) f.pool.offer(f.candidate(i));
  f.pool.offer(f.candidate(9, 'internet')); f.pool.tick();
  assert.deepEqual(f.opens.map(o => o.c.route), ['lan', 'lan', 'lan', 'lan', 'internet']);
  const late = fixture(2); late.pool.offer(late.candidate(1)); late.pool.offer(late.candidate(2)); late.pool.tick();
  late.finish(0); late.finish(1); await drain();
  late.pool.offer(late.candidate(3, 'private')); late.pool.tick();
  assert.equal(late.closed.length, 1); assert.equal(late.opens[2].c.route, 'private');
});
test('timeouts retain a slot until the adapter settles and late successful sockets are closed', async () => {
  const f = fixture(1); f.pool.offer(f.candidate(1)); f.pool.offer(f.candidate(2)); f.pool.tick();
  f.advance(10001); f.pool.tick();
  assert.equal(f.opens[0].context.signal.aborted, true);
  assert.equal(f.pool.snapshot().connections[0].state, 'closing');
  assert.equal(f.opens.length, 1);
  f.finish(0); await drain(); assert.deepEqual(f.closed, [0]);
  f.pool.tick(); assert.equal(f.opens[1].c.account, account(2));
});
test('failures back off despite rediscovery; closed peers are replaced and stale callbacks cannot close replacements', async () => {
  const f = fixture(1); f.pool.offer(f.candidate(1)); f.pool.tick(); f.opens[0].resolve(null); await drain();
  f.pool.offer(f.candidate(1)); f.pool.tick(); assert.equal(f.opens.length, 1);
  f.advance(1000); f.pool.tick(); f.finish(1); await drain();
  f.opens[0].context.onClosed(); assert.equal(f.pool.snapshot().connections[0].state, 'connected');
  f.pool.offer(f.candidate(2)); f.opens[1].context.onClosed(); f.pool.tick();
  assert.equal(f.opens[2].c.account, account(2));
});
test('identity mismatches never become connections; stopping cancels pending and prevents late resurrection', async () => {
  const f = fixture(1); f.pool.offer(f.candidate(1)); f.pool.tick(); f.finish(0, 9); await drain();
  assert.equal(f.pool.snapshot().connections.length, 0); assert.deepEqual(f.closed, [0]);
  f.advance(1000); f.pool.tick(); f.pool.stop(); f.finish(1); await drain();
  assert.equal(f.pool.snapshot().connections.length, 0);
  assert.equal(f.pool.offer(f.candidate(2)), false); f.pool.tick(); assert.equal(f.opens.length, 2);
});
test('candidate memory, configurable limits, and authentication expiration are bounded', async () => {
  assert.throws(() => fixture(21)); assert.throws(() => fixture(0));
  const f = fixture(10);
  for (let i = 1; i <= 128; i++) assert.equal(f.pool.offer(f.candidate(i)), true);
  assert.equal(f.pool.offer(f.candidate(129)), false);
  f.pool.tick(); assert.equal(f.opens.length, 10);
  for (let i = 0; i < 10; i++) f.finish(i);
  await drain(); f.advance(60000); f.pool.tick(); assert.equal(f.closed.length, 10);
  assert.equal(f.pool.snapshot().connections.length, 10);
});

test('a preferred route authenticates in a spare slot before replacing the working connection', async () => {
  const f = fixture(2); f.pool.offer(f.candidate(1, 'internet')); f.pool.tick(); f.finish(0); await drain();
  f.pool.offer(f.candidate(1, 'lan')); f.pool.tick();
  assert.equal(f.opens.length, 2); assert.deepEqual(f.closed, []);
  assert.deepEqual(f.pool.snapshot().connections.map(c => c.state), ['connected', 'authenticating']);
  assert.equal(f.pool.accept(f.candidate(2), f.open), false);
  f.finish(1); await drain();
  assert.deepEqual(f.closed, [0]);
  assert.deepEqual(f.pool.snapshot().connections.map(c => [c.route,c.state]), [['lan','connected']]);
  f.opens[0].context.onClosed(); assert.equal(f.pool.snapshot().connections.length, 1);
  f.pool.offer(f.candidate(1, 'internet')); f.pool.tick(); assert.equal(f.opens.length, 2);
});

test('failed or wrong-identity promotions preserve the working link and honor backoff', async () => {
  const f = fixture(2); f.pool.offer(f.candidate(1, 'internet')); f.pool.tick(); f.finish(0); await drain();
  f.pool.offer(f.candidate(1)); f.pool.tick(); f.finish(1,9); await drain();
  assert.deepEqual(f.closed, [1]); assert.equal(f.pool.snapshot().connections[0].route, 'internet');
  f.pool.offer(f.candidate(1)); f.pool.tick(); assert.equal(f.opens.length, 2);
  f.advance(1000); f.pool.tick(); f.opens[2].resolve(null); await drain();
  assert.equal(f.pool.snapshot().connections[0].state, 'connected');
  assert.deepEqual(f.closed, [1]);
});

test('incoming promotions are bounded and a timed-out upgrade retains its reservation until settled', async () => {
  const f = fixture(2); f.pool.offer(f.candidate(1, 'internet')); f.pool.tick(); f.finish(0); await drain();
  assert.equal(f.pool.accept(f.candidate(1),f.open),true);
  assert.equal(f.pool.accept(f.candidate(1),f.open),false);
  f.advance(10001); f.pool.tick();
  assert.equal(f.pool.snapshot().connections.length,2); assert.deepEqual(f.closed,[]);
  assert.equal(f.opens[1].context.signal.aborted,true);
  f.finish(1); await drain(); assert.deepEqual(f.closed,[1]);
  assert.equal(f.pool.snapshot().connections[0].route,'internet');
  f.advance(1000); assert.equal(f.pool.accept(f.candidate(1),f.open),true);
  f.pool.stop(); f.finish(2); await drain();
  assert.equal(f.pool.snapshot().connections.length,0); assert.ok(f.closed.includes(0)&&f.closed.includes(2));
});

test('a full pool postpones upgrades and a lost original does not cancel a pending replacement', async () => {
  const full=fixture(1); full.pool.offer(full.candidate(1,'internet'));full.pool.tick();full.finish(0);await drain();
  full.pool.offer(full.candidate(1));full.pool.tick();assert.equal(full.opens.length,1);assert.deepEqual(full.closed,[]);
  const f=fixture(2);f.pool.offer(f.candidate(1,'internet'));f.pool.tick();f.finish(0);await drain();
  f.pool.offer(f.candidate(1));f.pool.tick();f.opens[0].context.onClosed();f.pool.tick();
  assert.equal(f.opens.length,2);f.finish(1);await drain();
  assert.deepEqual(f.pool.snapshot().connections.map(c=>c.route),['lan']);
});

test('live axon limit shrinks established links and raises capacity up to twenty', async()=>{
 const f=fixture(10);for(let n=1;n<=25;n++)f.pool.offer(f.candidate(n));f.pool.tick();for(let i=0;i<10;i++)f.finish(i);await drain();
 f.pool.setLimit(3);assert.equal(f.pool.snapshot().limit,3);assert.equal(f.pool.snapshot().connections.length,3);assert.equal(f.closed.length,7);
 f.pool.setLimit(20);assert.equal(f.pool.snapshot().limit,20);assert.equal(f.pool.snapshot().connections.length,20);
 assert.throws(()=>f.pool.setLimit(21));assert.throws(()=>f.pool.setLimit(2.5));f.pool.stop();
});
test('lowering capacity cancels excess pending work without releasing reservations early',async()=>{
 const f=fixture(5);for(let n=1;n<=8;n++)f.pool.offer(f.candidate(n));f.pool.tick();f.pool.setLimit(3);
 assert.equal(f.opens.filter(o=>o.context.signal.aborted).length,2);assert.equal(f.pool.snapshot().connections.length,5);
 f.pool.tick();assert.equal(f.opens.length,5);for(let i=0;i<5;i++)f.finish(i);await drain();f.pool.tick();
 assert.equal(f.pool.snapshot().connections.filter(c=>c.state==='connected').length,3);assert.equal(f.opens.length,5);f.pool.stop();
});
