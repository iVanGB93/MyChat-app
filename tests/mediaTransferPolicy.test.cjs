const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MEDIA_MAX_UPLOAD_BYTES,
  classifyMediaHttpFailure,
  mapWithConcurrency,
  validateMediaSize,
  createTransferScheduler,
  getTransferFeedback,
} = require('../src/services/mediaTransferPolicy.ts');

test('normal queued transfers are silent without changing pending results', () => {
  const results = [{ state: 'queued' }, { state: 'sent' }];
  assert.equal(getTransferFeedback(results), null);
  assert.equal(results[0].state, 'queued');
  assert.equal(getTransferFeedback([]), null);
});

test('retryable transfer errors still explain the interruption', () => {
  const error = classifyMediaHttpFailure(503);
  assert.deepEqual(getTransferFeedback([{ state: 'queued', error }]), {
    title: 'Transfer interrupted', message: error.message,
  });
});

test('partial failures keep accurate counts and actionable error details', () => {
  const error = classifyMediaHttpFailure(413);
  const result = getTransferFeedback([{ state: 'sent' }, { state: 'queued' }, { state: 'failed', error }]);
  assert.equal(result.title, 'Some items were not sent');
  assert.equal(result.message, `2 of 3 queued or sent. ${error.message}`);
  assert.equal(getTransferFeedback([{ state: 'failed' }]).title, 'Could not send');
});

test('rejects an oversized attachment before upload', () => {
  assert.equal(MEDIA_MAX_UPLOAD_BYTES, 250 * 1024 * 1024);
  assert.equal(validateMediaSize(MEDIA_MAX_UPLOAD_BYTES), null);
  const failure = validateMediaSize(MEDIA_MAX_UPLOAD_BYTES + 1);
  assert.equal(failure.code, 'too_large');
  assert.equal(failure.retryable, false);
  assert.equal(failure.status, 413);
});

test('transfer scheduler caps all batches and shares work by identity', async () => {
  const schedule = createTransferScheduler(2);
  let active = 0, peak = 0, calls = 0;
  const operation = async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return calls;
  };
  const first = schedule('same-message', operation);
  assert.equal(first, schedule('same-message', operation));
  await Promise.all([first, ...[1, 2, 3, 4].map((id) => schedule(String(id), operation))]);
  assert.equal(peak, 2);
  assert.equal(calls, 5);
});

test('transfer scheduler releases a failed identity before its caller retries', async () => {
  const schedule = createTransferScheduler(1);
  await assert.rejects(schedule('message', async () => { throw new Error('failure'); }));
  assert.equal(await schedule('message', async () => 'resumed'), 'resumed');
});

test('bounded mapper drains active workers and stops dispatch after a failure', async () => {
  let active = 0;
  const started = [];
  await assert.rejects(mapWithConcurrency([1, 2, 3, 4], 2, async (id) => {
    started.push(id); active++;
    try {
      if (id === 1) throw new Error('part failed');
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally { active--; }
  }), /part failed/);
  assert.equal(active, 0);
  assert.deepEqual(started, [1, 2]);
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
