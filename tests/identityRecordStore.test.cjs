const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
function fixture() {
  const database = new DatabaseSync(':memory:'), cache = new Map(); let writing = false;
  const tx = { getFirstAsync: async (sql, ...args) => database.prepare(sql).get(...args) ?? null,
    runAsync: async (sql, ...args) => database.prepare(sql).run(...args) };
  const sqlite = { openDatabaseAsync: async () => ({ ...tx, execAsync: async sql => database.exec(sql),
    withExclusiveTransactionAsync: async work => {
      // Match Expo's separate write connections: overlapping writers can fail,
      // rather than silently serializing them in the test adapter.
      if (writing) throw Error('database is locked');
      writing = true; database.exec('BEGIN IMMEDIATE');
      try { await work(tx); database.exec('COMMIT'); } catch (e) { database.exec('ROLLBACK'); throw e; }
      finally { writing = false; }
    } }) };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const code = ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(n => n === 'expo-sqlite' ? sqlite : n.startsWith('./') ? load(n.slice(2).replace(/\.(js|ts)$/, '')) : require(n), exports);
    cache.set(name, exports); return exports;
  }
  return { database, load };
}
test('mobile record store uses real SQLite for immutable identity updates, capacity and rollback rejection', async t => {
  const f = fixture(); t.after(() => f.database.close());
  const p = f.load('identityProtocol'), { createMobileIdentityRecordStore } = f.load('identityRecordStore');
  const now = 1_800_000_000_000, root = crypto.randomBytes(32), device = p.publicDevice(crypto.randomBytes(32), crypto.randomBytes(32));
  const first = p.issueRecord(root, [device], now), store = createMobileIdentityRecordStore(() => now, 1);
  assert.equal(await store.compareAndSet(first.account, null, first), true);
  assert.equal(await store.compareAndSet(first.account, null, first), false);
  const copy = await store.read(first.account); copy.devices.length = 0;
  assert.equal((await store.read(first.account)).devices.length, 1);
  const other = p.issueRecord(crypto.randomBytes(32), [device], now);
  assert.equal(await store.compareAndSet(other.account, null, other), false);
  const next = p.issueRecord(root, [device], now, first), fork = p.issueRecord(root, [device], now + 1, first);
  assert.equal((await Promise.all([next, fork].map(r => store.compareAndSet(first.account, p.recordDigest(first), r)))).filter(Boolean).length, 1);
  assert.equal(await store.compareAndSet(first.account, p.recordDigest(next), first), false);
  const reopened = createMobileIdentityRecordStore(() => now, 1);
  assert.equal((await reopened.read(first.account)).revision, 1);
  f.database.prepare('UPDATE identity_records SET record = ? WHERE account = ?').run('{}', first.account);
  await assert.rejects(reopened.read(first.account), /Invalid stored identity/);
});

test('concurrent first pins across mobile store instances serialize and preserve CAS', async t => {
  const f = fixture(); t.after(() => f.database.close());
  const p = f.load('identityProtocol'), create = f.load('identityRecordStore').createMobileIdentityRecordStore;
  const now = 1_800_000_000_000, device = p.publicDevice(crypto.randomBytes(32), crypto.randomBytes(32));
  const record = p.issueRecord(crypto.randomBytes(32), [device], now);
  const a = create(() => now), b = create(() => now);
  assert.deepEqual(await Promise.all([a.compareAndSet(record.account, null, record), b.compareAndSet(record.account, null, record)]), [true, false]);
  f.database.prepare('UPDATE identity_records SET record = ? WHERE account = ?').run('{}', record.account);
  await assert.rejects(a.compareAndSet(record.account, p.recordDigest(record), record));
  const next = p.issueRecord(crypto.randomBytes(32), [device], now);
  assert.equal(await b.compareAndSet(next.account, null, next), true, 'failed transaction must not poison the queue');
});

test('SQLite atomically catches up through expired signed history and refuses missing ancestry', async t => {
  const f=fixture();t.after(()=>f.database.close());const p=f.load('identityProtocol');let clock=1800000000000;
  const root=crypto.randomBytes(32), device=p.publicDevice(crypto.randomBytes(32),crypto.randomBytes(32));
  const first=p.issueRecord(root,[device],clock), store=f.load('identityRecordStore').createMobileIdentityRecordStore(()=>clock);
  await store.compareAndSet(first.account,null,first);let state={record:first,history:[]};
  for(let i=0;i<3;i++){clock+=24*86400000;state=p.renewIdentityRecord(root,state.record,state.history,clock);}
  assert.equal(await store.compareAndSet(first.account,p.recordDigest(first),state.record),false);
  assert.equal(await store.compareAndSet(first.account,p.recordDigest(first),state.record,state.history),true);
  assert.equal((await store.read(first.account)).revision,3);
});
