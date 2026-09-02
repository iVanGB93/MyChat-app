const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MEDIA_MAX_UPLOAD_BYTES,
  classifyMediaHttpFailure,
  mapWithConcurrency,
  validateMediaSize,
} = require('../src/services/mediaTransferPolicy.ts');

test('rejects an oversized attachment before upload', () => {
  assert.equal(MEDIA_MAX_UPLOAD_BYTES, 250 * 1024 * 1024);
  assert.equal(validateMediaSize(MEDIA_MAX_UPLOAD_BYTES), null);
  const failure = validateMediaSize(MEDIA_MAX_UPLOAD_BYTES + 1);
  assert.equal(failure.code, 'too_large');
  assert.equal(failure.retryable, false);
  assert.equal(failure.status, 413);
});

test('classifies permanent and temporary HTTP failures', () => {
  assert.equal(classifyMediaHttpFailure(413).retryable, false);
  assert.equal(classifyMediaHttpFailure(403).retryable, false);
  assert.equal(classifyMediaHttpFailure(429).retryable, true);
  assert.equal(classifyMediaHttpFailure(503).retryable, true);
});

test('bounded mapper preserves result order and never exceeds its limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 8 : 2));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40]);
  assert.equal(peak, 2);
});
