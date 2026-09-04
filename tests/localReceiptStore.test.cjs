const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/localMessageStore.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function fixture(database = new DatabaseSync(':memory:')) {
  function statement(sql, args, method) {
    const prepared = database.prepare(sql);
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      const params = Object.fromEntries([...sql.matchAll(/\$\w+/g)].map(([name]) => [name, null]));
      return prepared[method]({ ...params, ...args[0] });
    }
    return prepared[method](...args);
  }
  const adapter = {
    execAsync: async (sql) => database.exec(sql),
    runAsync: async (sql, ...args) => statement(sql, args, 'run'),
    getAllAsync: async (sql, ...args) => statement(sql, args, 'all'),
    getFirstAsync: async (sql, ...args) => statement(sql, args, 'get') ?? null,
    withTransactionAsync: async (work) => {
      database.exec('BEGIN');
      try { const result = await work(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  const modules = {
    'expo-sqlite': { openDatabaseAsync: async () => adapter },
    'expo-file-system': { Paths: { cache: { uri: 'file://cache' }, document: { uri: 'file://documents' } } },
    './syncDelta': {},
  };
  const sandbox = { exports: {}, console, setTimeout, require(name) {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  } };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.exports.initDB();
  return { ...sandbox.exports, database, row: () => database.prepare("SELECT * FROM messages WHERE id='m1'").get(),
    receipts: () => database.prepare("SELECT * FROM delivery_tracking WHERE message_id='m1' ORDER BY recipient_id").all() };
}

const message = {
  id: 'm1', room_id: 'room', sender_id: 14, sender_name: 'Sender', content: 'Hello', type: 'text',
  file_uri: null, created_at: '2026-09-03T10:00:00Z', is_mine: true, sync: false, status: 'pending',
  reactions: {}, is_deleted: false, is_read: false, reply_to: null, duration_ms: null,
};

test('original recipient snapshot survives duplicate acceptance and a process restart', async () => {
  const app = await fixture();
  await app.saveMessage(message);
  await app.setMessageExpectedRecipients('m1', [18, 19, 18]);
  await app.setMessageExpectedRecipients('m1', [18, 20]);
  assert.deepEqual([...await app.getMessageExpectedRecipients('m1')], [18, 19]);
  const restarted = await fixture(app.database);
  assert.deepEqual([...await restarted.getMessageExpectedRecipients('m1')], [18, 19]);
  assert.deepEqual(app.receipts().map((r) => r.recipient_id), [18, 19]);
});

test('interrupted recipient snapshot rolls back completely and can be retried', async () => {
  const app = await fixture();
  await app.saveMessage(message);
  app.database.exec(`CREATE TRIGGER fail_recipient BEFORE INSERT ON delivery_tracking
    WHEN NEW.recipient_id=19 BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END;`);
  await assert.rejects(app.setMessageExpectedRecipients('m1', [18, 19]), /simulated/);
  assert.equal(app.row().expected_recipient_ids, null);
  assert.equal(app.receipts().length, 0);
  app.database.exec('DROP TRIGGER fail_recipient');
  await app.setMessageExpectedRecipients('m1', [18, 19]);
  assert.equal(app.receipts().length, 2);
});

test('partial group receipts keep pending; all delivered advances, late receipt cannot downgrade read', async () => {
  const app = await fixture();
  await app.saveMessage(message);
  await app.setMessageExpectedRecipients('m1', [18, 19]);
  await app.markDelivered('m1', 18, '2026-09-03T10:01:00Z');
  assert.equal(app.row().status, 'pending');
  await app.markDelivered('m1', 19, '2026-09-03T10:02:00Z');
  assert.equal(app.row().status, 'delivered');
  await app.markReadByRecipient('m1', 18, '2026-09-03T10:03:00Z');
  await app.markDelivered('m1', 18, '2026-09-03T10:04:00Z');
  assert.equal(app.row().status, 'read');
  assert.equal(app.receipts()[0].delivered_at, '2026-09-03T10:01:00Z');
  assert.equal(app.receipts()[0].read_at, '2026-09-03T10:03:00Z');
});

test('one reader does not stop reconciliation for undelivered group members', async () => {
  const app = await fixture();
  await app.saveMessage(message);
  await app.setMessageExpectedRecipients('m1', [18, 19]);
  await app.markReadByRecipient('m1', 18);
  assert.equal(app.row().status, 'read');
  assert.equal((await app.getPendingSentMessageIds()).length, 1);
  await app.markDelivered('m1', 19);
  assert.equal((await app.getPendingSentMessageIds()).length, 0);
});

test('receipt confirmation work survives restart and only clears acknowledged recipients', async () => {
  const app = await fixture();
  await app.saveMessage(message);
  await app.markDelivered('m1', 18);
  await app.markDelivered('m1', 19);
  const restarted = await fixture(app.database);
  const pending = await restarted.getStoredReceiptConfirmations();
  assert.equal(pending.length, 1);
  assert.deepEqual([...pending[0].recipient_ids], [18, 19]);
  await restarted.markStoredReceiptConfirmations([{ message_id: 'm1', recipient_ids: [18] }]);
  assert.deepEqual([...(await restarted.getStoredReceiptConfirmations())[0].recipient_ids], [19]);
});

test('legacy receipt rows migrate without fabricating timestamps or losing delivery', async () => {
  const original = await fixture();
  await original.saveMessage(message);
  const database = original.database;
  database.exec(`DROP TABLE delivery_tracking;
    CREATE TABLE delivery_tracking(message_id TEXT, recipient_id INTEGER, delivered INTEGER DEFAULT 0,
    PRIMARY KEY(message_id,recipient_id)); INSERT INTO delivery_tracking VALUES('m1',18,1);
    PRAGMA user_version=4;`);
  const app = await fixture(database);
  assert.equal(app.receipts()[0].delivered, 1);
  assert.equal(app.receipts()[0].delivered_at, null);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 7);
});

test('locally removed media stays unavailable and is excluded from recovery', async () => {
  const app = await fixture();
  await app.saveMessage({
    ...message,
    id: 'media-1',
    type: 'image',
    content: 'Photo',
    file_uri: 'file://documents/media-1.jpg',
    is_mine: false,
    sync: true,
    status: 'delivered',
    media_ptr: { media_id: 'blob-1' },
  });
  const target = await app.getLocalMediaRemovalTarget('media-1');
  assert.equal(target.fileUri, 'file://documents/media-1.jpg');
  assert.equal(target.otherReferences, 0);
  assert.equal(await app.markLocalMediaRemoved('media-1', target.fileUri), true);
  const row = app.database.prepare("SELECT file_uri, media_evicted FROM messages WHERE id='media-1'").get();
  assert.equal(row.file_uri, null);
  assert.equal(row.media_evicted, 1);
  assert.equal((await app.getIncompletePointerMedia('room')).length, 0);
  assert.equal((await app.getIncompleteMediaDigest()).length, 0);
});

test('call refresh merges history and metadata pruning does not discard old calls', async () => {
  const app = await fixture();
  const old = { id: 'old', started_at: '2025-01-01', status: 'ended' };
  await app.cacheCallHistory(14, [old]);
  await app.cacheCallHistory(14, [{ id: 'new', started_at: '2026-09-03', status: 'ringing' }]);
  await app.cacheCallHistory(14, [{ id: 'new', started_at: '2026-09-03', status: 'ended' }]);
  await app.pruneLocalData();
  const calls = await app.getCachedCallHistory(14);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].status, 'ended');
  assert.equal(calls[1].id, 'old');
  assert.equal((await app.getCachedCallHistory(99)).length, 0);
});

test('persisted profile caches never revive old online flags', async () => {
  const app = await fixture();
  await app.cacheRooms(14, [{ id: 'room', members_detail: [{ id: 18, is_online: true }] }]);
  await app.cacheContacts(14, [{ contact: 18, contact_detail: { id: 18, is_online: true } }]);
  assert.equal((await app.getCachedRooms(14))[0].members_detail[0].is_online, false);
  assert.equal((await app.getCachedContacts(14))[0].contact_detail.is_online, false);
});
