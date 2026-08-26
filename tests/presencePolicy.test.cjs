const test = require('node:test');
const assert = require('node:assert/strict');
const { expirePresenceLease, toPresenceLease } = require('../src/services/presencePolicy.ts');
const { toEnvelope } = require('../src/services/rrp/envelope.ts');

test('foreground presence is online only while its lease is fresh', () => {
  const lease = toPresenceLease({ presence: 'active', is_online: true, expires_in: 20 }, 1_000_000);
  assert.equal(lease.isOnline, true);
  assert.equal(lease.status, 'active');
  assert.equal(expirePresenceLease(lease, lease.expiresAt - 1), lease);
  const expired = expirePresenceLease(lease, lease.expiresAt);
  assert.equal(expired.isOnline, false);
  assert.equal(expired.status, 'offline');
});

test('background connection is connected but never displayed as online', () => {
  const lease = toPresenceLease({ presence: 'background', is_online: false, expires_in: 30 }, 2_000_000);
  assert.equal(lease.isOnline, false);
  assert.equal(lease.status, 'background');
  assert.ok(lease.expiresAt > lease.observedAt);
});

test('offline presence does not receive a live lease', () => {
  const lease = toPresenceLease({ presence: 'offline', is_online: false }, 3_000_000);
  assert.equal(lease.expiresAt, 0);
  assert.equal(expirePresenceLease(lease, 9_000_000), lease);
});

test('Axion presence frames classify as presence envelopes', () => {
  assert.equal(toEnvelope({ event: 'presence_update', user_id: 7 }).type, 'presence');
  assert.equal(toEnvelope({ event: 'presence_snapshot', presences: [] }).type, 'presence');
});
