const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {checkAssets} = require('../scripts/check-assets.cjs');

test('maintained app configuration and source reference existing assets', () => {
  assert.deepEqual(checkAssets(path.resolve(__dirname, '..')).failures, []);
});
test('asset check resolves component-relative paths and detects missing config assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axonic-asset-test-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.mkdirSync(path.join(root, 'src', 'components'), {recursive: true});
    fs.writeFileSync(path.join(root, 'assets', 'icon.png'), 'fixture');
    fs.writeFileSync(path.join(root, 'src', 'components', 'Logo.tsx'), "const logo=require('../../assets/icon.png');");
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({expo: {icon: './assets/icon.png', web: {favicon: './assets/missing.png'}}}));
    const result = checkAssets(root);
    assert.equal(result.checked, 2);
    assert.deepEqual(result.failures, ['app.json: missing ./assets/missing.png']);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
