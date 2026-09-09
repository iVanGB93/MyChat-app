const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('Metro excludes generated native build trees but keeps native module JS sources', () => {
  const original = /original-exclusion/;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../metro.config.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '..'),
    require: (name) => name === 'expo/metro-config'
      ? { getDefaultConfig: () => ({ resolver: { blockList: original } }) }
      : require(name),
  });
  const excluded = (file) => module.exports.resolver.blockList.some((rule) => rule.test(file));
  assert.equal(excluded('original-exclusion'), true);
  for (const file of ['D:\\app\\android\\app\\build\\output.apk',
    'D:\\app\\android\\.gradle\\cache', '/app/modules/update/android/build/output',
    '/app/modules/update/android/.gradle/cache']) assert.equal(excluded(file), true);
  for (const file of ['/app/src/App.tsx', '/app/modules/update/src/index.ts',
    '/app/modules/update/android/src/main/Module.kt']) assert.equal(excluded(file), false);
});
