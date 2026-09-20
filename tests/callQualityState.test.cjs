const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/services/call-quality-state.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const read = context.exports.readNewCallQuality;
test('shared quality rejects duplicate, stale, malformed and other-call updates', () => {
  const data = { call_id: 'a', video_quality: 'low', quality_revision: 2 };
  assert.equal(read(data, 'a', 1).mode, 'low');
  assert.equal(read(data, 'a', 2), null);
  assert.equal(read(data, 'a', 3), null);
  assert.equal(read(data, 'b', 0), null);
  assert.equal(read({ ...data, video_quality: 'invalid' }, 'a', 0), null);
  assert.equal(read({ ...data, quality_revision: -1 }, 'a', -2), null);
});
test('initial default and recovered call settings are accepted', () => {
  assert.equal(read({ call_id: 'a', video_quality: 'automatic', quality_revision: 0 }, 'a', -1).mode, 'automatic');
  assert.equal(read({ call_id: 'a', video_quality: 'high', quality_revision: 6 }, 'a', 1).revision, 6);
});
