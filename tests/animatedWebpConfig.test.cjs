const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('animated WebP configuration is registered and survives repeated prebuilds', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(config.expo.plugins.includes('./plugins/withAnimatedWebp'));
  const context = {
    module: { exports: {} },
    require: (name) => {
      assert.equal(name, '@expo/config-plugins');
      return { withGradleProperties: (value, action) => action(value) };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'plugins/withAnimatedWebp.js'), 'utf8'), context);
  let mod = { modResults: [
    { type: 'property', key: 'expo.webp.animated', value: 'false' },
    { type: 'property', key: 'unrelated', value: 'keep' },
  ] };
  mod = context.module.exports(context.module.exports(mod));
  for (const key of ['expo.webp.enabled', 'expo.webp.animated']) {
    const entries = mod.modResults.filter((entry) => entry.key === key);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].value, 'true');
  }
  assert.equal(mod.modResults.find((entry) => entry.key === 'unrelated').value, 'keep');
});
