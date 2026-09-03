const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/messageAckTransport.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function fixture(post) {
  const requests = [];
  const sandbox = { exports: {}, setTimeout, require(name) {
    assert.equal(name, './api');
    return { __esModule: true, default: { post: async (url, data) => {
      requests.push({ url, data });
      return post(url, data);
    } } };
  } };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, requests };
}
const receipt = (id) => ({ message_id: id, sender_id: 1, room_id: 'room' });

test('receipt burst uses one HTTP request and preserves per-message outcomes', async () => {
  const app = fixture(async (_, data) => ({ data: { results: data.receipts.map((r, i) => ({
    message_id: r.message_id, http_status: 200, status: i === 0 ? 'delivered' : 'not_found',
  })) } }));
  const results = await Promise.all(['a', 'b', 'c'].map((id) => app.sendMessageAck(receipt(id))));
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/chat/messages/ack-batch/');
  assert.deepEqual(results.map((r) => r.data.status), ['delivered', 'not_found', 'not_found']);
});

test('older backend falls back to bounded individual receipt requests', async () => {
  const app = fixture(async (url) => {
    if (url.endsWith('ack-batch/')) throw { response: { status: 404 } };
    return { status: 200, data: { status: 'delivered' } };
  });
  const results = await Promise.all(['a', 'b'].map((id) => app.sendMessageAck(receipt(id))));
  assert.equal(app.requests.length, 3);
  assert.ok(results.every((r) => r.data.status === 'delivered'));
});

test('failed batch rejects every waiter so durable ingress retries remain pending', async () => {
  const app = fixture(async () => { throw Error('offline'); });
  const results = await Promise.allSettled(['a', 'b'].map((id) => app.sendMessageAck(receipt(id))));
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal(app.requests.length, 1);
});

test('mismatched or malformed batch results cannot acknowledge the wrong message', async () => {
  const app = fixture(async () => ({ data: { results: [
    { message_id: 'wrong', http_status: 200, status: 'delivered' },
    { message_id: 'b', http_status: 200, status: 'delivered' },
  ] } }));
  const results = await Promise.allSettled(['a', 'b'].map((id) => app.sendMessageAck(receipt(id))));
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
});
