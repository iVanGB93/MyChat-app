const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/message-info.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const classify = (ids, receipts) => JSON.parse(JSON.stringify(context.exports.messageInfoRecipients(ids, receipts)));
test('read, delivered and pending recipients are exclusive and preserve receipt times', () => {
  const result = classify([2, 3, 4], [
    { recipient_id: 2, read: 1, delivered: 1, read_at: 'read-time', delivered_at: 'delivery-time' },
    { recipient_id: 3, read: 0, delivered: 1 },
  ]);
  assert.deepEqual(result.map(p => p.status), ['Read', 'Delivered', 'Pending']);
  assert.equal(result[0].readAt, 'read-time');
  assert.equal(result[0].deliveredAt, 'delivery-time');
  assert.equal(result[2].deliveredAt, null);
});
test('frozen audience excludes outsiders and deduplicates recipients', () => {
  assert.deepEqual(classify([2, 2, -1], [{ recipient_id: 5, read: 1 }]).map(p => p.id), [2]);
  assert.deepEqual(classify([], [{ recipient_id: 5, read: 1 }]), []);
});
test('unknown audience lists only actual receipts without inventing pending users', () => {
  assert.deepEqual(classify(null, []), []);
  assert.equal(classify(null, [{ recipient_id: 5, read: 1 }])[0].status, 'Read');
});
