const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyMessageLifecycleEvent,
  mergeMessageById,
} = require('../src/services/messageLifecycle.ts');

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
