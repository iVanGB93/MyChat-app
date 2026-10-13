const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {patch, directory, names} = require('../scripts/patch-activity-result.cjs');
for (const name of names) test('activity-result patch is repeatable and rejects source drift: ' + name, () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', directory, name), 'utf8');
  const patched = patch(name, source);
  assert.equal(patch(name, patched), patched);
  assert.throws(() => patch(name, patched + '\n// upstream change'), /review required/);
});
