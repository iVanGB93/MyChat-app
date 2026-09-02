const test = require('node:test');
const assert = require('node:assert/strict');

const { parseNotificationDestination: parse } = require('../src/services/notificationDestination.ts');

test('notification navigation accepts snake_case direct-message payloads', () => {
  assert.deepEqual(parse({ type: 'new_message', room_id: 'r1', room_name: 'Ana', sender: 'Ana', sender_id: '7' }), {
    type: 'message', roomId: 'r1', roomName: 'Ana', otherUserId: 7,
  });
});

test('group notification navigation never creates a private-chat header', () => {
  assert.deepEqual(parse({ type: 'new_message', roomId: 'g1', roomName: 'Family', senderName: 'Ana', senderId: '7' }), {
    type: 'message', roomId: 'g1', roomName: 'Family',
  });
});
