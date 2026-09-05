const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyMessageLifecycleEvent,
  mergeMessageById,
  resolveOutgoingMessageStatus,
  shouldSuppressOutboxReplay,
} = require('../src/services/messageLifecycle.ts');
const {
  mergeMessagePreview,
  selectLatestMessagePreview,
} = require('../src/utils/messagePreview.ts');

function state() {
  return {
    pendingIds: new Set(['m1']),
    deliveredIds: new Set(),
    readIds: new Set(),
  };
}

test('server acceptance keeps the first-attempt message pending', () => {
  const before = state();
  const after = applyMessageLifecycleEvent(before, {
    type: 'server_accepted',
    ids: ['m1'],
  });
  assert.equal(after, before);
  assert.deepEqual([...after.pendingIds], ['m1']);
});

test('server acceptance suppresses only immediate recovery replays', () => {
  const now = 50_000;
  assert.equal(shouldSuppressOutboxReplay(true, undefined, now), true);
  assert.equal(shouldSuppressOutboxReplay(false, now - 2_000, now), true);
  assert.equal(shouldSuppressOutboxReplay(false, now - 10_000, now), false);
  assert.equal(shouldSuppressOutboxReplay(false, undefined, now), false);
});

test('delivery and read acknowledgements advance status idempotently', () => {
  const delivered = applyMessageLifecycleEvent(state(), {
    type: 'delivered',
    ids: ['m1', 'm1'],
  });
  assert.equal(delivered.pendingIds.has('m1'), false);
  assert.equal(delivered.deliveredIds.has('m1'), true);
  assert.equal(delivered.readIds.has('m1'), false);

  const read = applyMessageLifecycleEvent(delivered, {
    type: 'read',
    ids: ['m1'],
  });
  assert.equal(read.pendingIds.has('m1'), false);
  assert.equal(read.deliveredIds.has('m1'), true);
  assert.equal(read.readIds.has('m1'), true);
});

test('a live receipt wins over a stale persisted pending status', () => {
  const delivered = applyMessageLifecycleEvent(state(), {
    type: 'delivered',
    ids: ['m1'],
  });
  assert.equal(resolveOutgoingMessageStatus('m1', 'pending', delivered), 'delivered');

  const read = applyMessageLifecycleEvent(delivered, {
    type: 'read',
    ids: ['m1'],
  });
  assert.equal(resolveOutgoingMessageStatus('m1', 'pending', read), 'read');
});

test('SQLite delivery status wins over a persisted pending chat-list preview', () => {
  const persisted = {
    id: 'm1', content: 'hello', created_at: '2026-09-05T10:00:00Z', sender_id: 14, status: 'pending',
  };
  const sqlite = { ...persisted, status: 'delivered' };
  assert.equal(selectLatestMessagePreview([persisted, sqlite]).status, 'delivered');
  assert.equal(mergeMessagePreview(sqlite, persisted).status, 'delivered', 'late stale cache must not downgrade');
});

test('an actually newer message replaces the previous chat-list preview', () => {
  const oldMessage = { id: 'm1', content: 'old', created_at: '2026-09-05T10:00:00Z', status: 'read' };
  const newMessage = { id: 'm2', content: 'new', created_at: '2026-09-05T10:01:00Z', status: 'pending' };
  assert.equal(selectLatestMessagePreview([oldMessage, newMessage]).id, 'm2');
});

test('duplicate incoming message ids are ignored', () => {
  const original = [{ id: 'm1', content: 'hello', file_uri: null }];
  const result = mergeMessageById(
    original,
    { id: 'm1', content: 'duplicate', file_uri: null },
  );
  assert.equal(result.changed, false);
  assert.equal(result.inserted, false);
  assert.equal(result.messages, original);
  assert.equal(result.messages[0].content, 'hello');
});

test('hydration updates an existing message without creating a duplicate', () => {
  const original = [{ id: 'm1', content: '', file_uri: null }];
  const result = mergeMessageById(
    original,
    { id: 'm1', content: '', file_uri: 'file:///voice.m4a' },
    true,
  );
  assert.equal(result.changed, true);
  assert.equal(result.inserted, false);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].file_uri, 'file:///voice.m4a');
});
