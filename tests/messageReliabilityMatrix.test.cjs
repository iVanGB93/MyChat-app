const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyMessageLifecycleEvent,
  mergeMessageById,
} = require('../src/services/messageLifecycle.ts');
const {
  decideInAppMessageToast,
  decideLocalMessageNotification,
} = require('../src/services/notificationDecision.ts');
const {
  idempotencyId,
  toEnvelope,
} = require('../src/services/rrp/envelope.ts');

const ROOM_ID = 'room-private';
const MESSAGE_ID = 'message-1';

function messagePayload(overrides = {}) {
  return {
    event: 'new_message',
    message_id: MESSAGE_ID,
    room_id: ROOM_ID,
    sender_id: 10,
    content: 'hello',
    message_type: 'text',
    ...overrides,
  };
}

function pendingState() {
  return {
    pendingIds: new Set([MESSAGE_ID]),
    deliveredIds: new Set(),
    readIds: new Set(),
  };
}

test('same-room conversation stores once, suppresses notification, and reaches read', () => {
  const payload = messagePayload();
  const context = { appActive: true, activeRoomId: ROOM_ID, mutedRooms: {} };

  assert.deepEqual(decideInAppMessageToast(payload, context), {
    allow: false,
    reason: 'viewing_room',
  });
  assert.deepEqual(decideLocalMessageNotification(payload, context), {
    allow: false,
    reason: 'app_active',
  });

  const first = mergeMessageById([], payload);
  const duplicate = mergeMessageById(first.messages, payload);
  assert.equal(first.messages.length, 1);
  assert.equal(duplicate.messages.length, 1);
  assert.equal(duplicate.changed, false);

  const delivered = applyMessageLifecycleEvent(pendingState(), {
    type: 'delivered',
    ids: [MESSAGE_ID],
  });
  const read = applyMessageLifecycleEvent(delivered, {
    type: 'read',
    ids: [MESSAGE_ID],
  });
  assert.equal(read.pendingIds.has(MESSAGE_ID), false);
  assert.equal(read.deliveredIds.has(MESSAGE_ID), true);
  assert.equal(read.readIds.has(MESSAGE_ID), true);
});

test('active recipient outside the room gets one in-app toast and no OS duplicate', () => {
  const payload = messagePayload();
  const context = { appActive: true, activeRoomId: 'another-room', mutedRooms: {} };

  assert.deepEqual(decideInAppMessageToast(payload, context), {
    allow: true,
    reason: 'eligible',
  });
  assert.deepEqual(decideLocalMessageNotification(payload, context), {
    allow: false,
    reason: 'app_active',
  });
});

test('background or killed recipient relies on push floor without local duplication', () => {
  const payload = messagePayload({ push_floor: true });
  const context = { appActive: false, activeRoomId: null, mutedRooms: {} };

  assert.deepEqual(decideInAppMessageToast(payload, context), {
    allow: false,
    reason: 'app_inactive',
  });
  assert.deepEqual(decideLocalMessageNotification(payload, context), {
    allow: false,
    reason: 'push_floor',
  });
});

test('background recipient without a push floor gets the local fallback', () => {
  const payload = messagePayload({ push_floor: false });
  const context = { appActive: false, activeRoomId: null, mutedRooms: {} };

  assert.deepEqual(decideLocalMessageNotification(payload, context), {
    allow: true,
    reason: 'eligible',
  });
});

test('WebSocket and push copies share the same stable message identity', () => {
  const websocketCopy = messagePayload({ route_reason: 'axion' });
  const pushCopy = messagePayload({ route_reason: 'push_floor' });

  assert.equal(toEnvelope(websocketCopy).id, MESSAGE_ID);
  assert.equal(toEnvelope(pushCopy).id, MESSAGE_ID);

  const first = mergeMessageById([], websocketCopy);
  const second = mergeMessageById(first.messages, pushCopy);
  assert.equal(second.messages.length, 1);
  assert.equal(second.changed, false);
});

test('group delivery acknowledgements dedupe per message and recipient', () => {
  const firstPeer = {
    event: 'message_delivery_ack',
    message_id: 'group-message-1',
    room_id: 'group-room',
    by_user_id: 20,
  };
  const samePeerAgain = { ...firstPeer };
  const secondPeer = { ...firstPeer, by_user_id: 30 };

  assert.equal(idempotencyId('message.delivered', firstPeer), 'dlv:group-message-1:20');
  assert.equal(
    idempotencyId('message.delivered', samePeerAgain),
    idempotencyId('message.delivered', firstPeer),
  );
  assert.notEqual(
    idempotencyId('message.delivered', secondPeer),
    idempotencyId('message.delivered', firstPeer),
  );
});

test('out-of-order read acknowledgement safely implies delivered', () => {
  const read = applyMessageLifecycleEvent(pendingState(), {
    type: 'read',
    ids: [MESSAGE_ID, MESSAGE_ID],
  });
  assert.equal(read.pendingIds.has(MESSAGE_ID), false);
  assert.equal(read.deliveredIds.has(MESSAGE_ID), true);
  assert.equal(read.readIds.has(MESSAGE_ID), true);

  const lateDelivery = applyMessageLifecycleEvent(read, {
    type: 'delivered',
    ids: [MESSAGE_ID],
  });
  assert.equal(lateDelivery.readIds.has(MESSAGE_ID), true);
});
