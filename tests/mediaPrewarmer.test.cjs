const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaPrewarmer } = require('../src/services/media-prewarmer.ts');
function deferred() {
  let resolve; const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
test('cancel during camera acquisition releases the late stream', async () => {
  const camera = deferred(), stopped = [];
  const preview = createMediaPrewarmer(() => camera.promise, (stream) => stopped.push(stream));
  const pending = preview.warm();
  const rejected = assert.rejects(pending, /cancelled/);
  preview.discard();
  camera.resolve('camera');
  await rejected;
  assert.deepEqual(stopped, ['camera']);
  assert.equal(await preview.take(), null);
});
test('simultaneous preview and accept share one acquisition and transfer ownership', async () => {
  const camera = deferred(); let acquisitions = 0, stopped = 0;
  const preview = createMediaPrewarmer(() => { acquisitions++; return camera.promise; }, () => stopped++);
  const first = preview.warm();
  assert.equal(preview.warm(), first);
  const accepted = preview.take();
  camera.resolve('camera');
  assert.equal(await accepted, 'camera');
  preview.discard();
  assert.equal(acquisitions, 1);
  assert.equal(stopped, 0);
});
