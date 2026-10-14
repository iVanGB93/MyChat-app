const test = require('node:test');
const assert = require('node:assert/strict');
const { configureManifest } = require('../plugins/withSideBySideDev');

test('upgrading an existing Dev Gradle configuration preserves following customizations and is idempotent', () => {
  const { configureGradle } = require('../plugins/withSideBySideDev');
  const existing = '// Axonic optional side-by-side development build\nandroid { }\n// Custom configuration\n';
  const updated = configureGradle(existing);
  assert(updated.endsWith('android { }\n// Custom configuration\n'));
  assert(updated.includes("if (project.findProperty('axonicSideBySide') == 'true') {\n    react { debuggableVariants = [] }"));
  assert.equal(configureGradle(updated), updated);
  const fresh = configureGradle('android {}\n');
  assert.equal(configureGradle(fresh), fresh);
});

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

test('repeated prebuilds deduplicate deep links without removing distinct share filters',()=>{
 const manifest={application:[{$:{},activity:[{'intent-filter':[{data:[{$:{'android:scheme':'axonic'}},{$:{'android:scheme':'${axonicScheme}'}},{$:{'android:scheme':'exp+mychat-app'}},{$:{'android:scheme':'${axonicExpoScheme}'}}]}]}]}]};
 const result=configureManifest(manifest);assert.equal(result.application[0].activity[0]['intent-filter'][0].data.length,2);
 assert.deepEqual(configureManifest(result),result);
});
test('native display version comes from app config without changing release version codes',()=>{
 const {configureVersionName}=require('../plugins/withSideBySideDev');const output=configureVersionName('versionCode 123\nversionName "1.1.6"');
 assert(output.includes('versionCode 123'));assert(output.includes("parse(rootProject.file('../app.json')).expo.version"));assert.equal(configureVersionName(output),output);
});
