const test = require('node:test');
const assert = require('node:assert/strict');
const { configureManifest } = require('../plugins/withSideBySideDev');

test('side-by-side manifest keeps native classes and sharing filters while separating launcher identity', () => {
  const manifest = { application: [{ $: { 'android:name': '.MainApplication', 'android:label': '@string/app_name' },
    activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [
      { data: [{ $: { 'android:scheme': 'axonic' } }, { $: { 'android:scheme': 'exp+mychat-app' } }] },
      { data: [{ $: { 'android:mimeType': 'image/*' } }] },
    ] }],
  }] };
  const first = configureManifest(manifest);
  const snapshot = JSON.stringify(first);
  assert.equal(JSON.stringify(configureManifest(first)), snapshot);
  const app = first.application[0];
  assert.equal(app.$['android:name'], '.MainApplication');
  assert.equal(app.$['android:label'], '${axonicAppLabel}');
  assert.equal(app.activity[0].$['android:name'], '.MainActivity');
  const filters = app.activity[0]['intent-filter'];
  assert.deepEqual(filters[0].data.map(d => d.$['android:scheme']), ['${axonicScheme}', '${axonicExpoScheme}']);
  assert.equal(filters[1].data[0].$['android:mimeType'], 'image/*');
});
