const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UPDATE_REMINDER_INTERVAL_MS,
  compareVersions,
  isValidVersion,
  resolveUpdateStatus,
  serializeUpdateDismissal,
  shouldShowOptionalUpdate,
} = require('../src/services/versionPolicy.ts');

test('compares dotted versions numerically', () => {
  assert.equal(compareVersions('1.0.9', '1.0.10'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('rejects malformed version values', () => {
  assert.equal(isValidVersion('1.0.26'), true);
  assert.equal(isValidVersion('1.0.beta'), false);
  assert.equal(isValidVersion(''), false);
});

test('resolves optional and forced update policies', () => {
  assert.equal(resolveUpdateStatus('1.0.25', '1.0.26', '1.0.0'), 'optional');
  assert.equal(resolveUpdateStatus('1.0.25', '1.0.26', '1.0.26'), 'forced');
  assert.equal(resolveUpdateStatus('1.0.26', '1.0.26', '1.0.0'), 'ok');
});

test('shows a dismissed optional update again after the cooldown', () => {
  const now = 1_000_000_000;
  const stored = serializeUpdateDismissal('1.0.26', now);
  assert.equal(shouldShowOptionalUpdate('1.0.26', stored, now + 1_000), false);
  assert.equal(
    shouldShowOptionalUpdate('1.0.26', stored, now + UPDATE_REMINDER_INTERVAL_MS),
    true,
  );
  assert.equal(shouldShowOptionalUpdate('1.0.27', stored, now + 1_000), true);
});

test('does not let a legacy permanent dismissal suppress future reminders', () => {
  assert.equal(shouldShowOptionalUpdate('1.0.26', '1.0.26'), true);
});
