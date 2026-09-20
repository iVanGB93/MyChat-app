const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/media-export-service.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  const events = [];
  const source = 'file:///documents/photo.jpg';
  const destination = 'content://media/external_primary/images/media/123';
  let exists = true;
  const modules = {
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null } },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-file-system': {
      Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///documents/' } },
      File: class {
        constructor(uri) { this.uri = uri; }
        get exists() { return this.uri === source && exists; }
        delete() { events.push('delete-private'); exists = false; }
      },
    },
    'expo-file-system/legacy': {},
    './android-media-store': {
      hasAutomaticDeviceStorage: () => true,
      isMediaStoreUri: uri => uri.startsWith('content://media/'),
      androidMediaStore: {
        save: async (...args) => {
          events.push(['save', ...args]);
          if (options.failSave) throw new Error('Disk full');
          return destination;
        },
        available: async () => options.available !== false,
      },
    },
    './localMessageStore': {
      initDB: async () => {},
      queueMediaExport: async () => 'pending',
      markMediaExported: async () => events.push('record-export'),
      setMessageFileUri: async () => {
        if (options.failRelink) throw new Error('Database unavailable');
        events.push('relink');
      },
    },
  };
  const sandbox = { exports: {}, console, setTimeout, require(name) {
    assert.ok(modules[name], `Unexpected permission/library access: ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(code, sandbox);
  const request = { messageId: 'm1', mediaType: 'image', localUri: source, fileName: 'photo.jpg', mime: 'application/octet-stream' };
  return { ...sandbox.exports, request, events, exists: () => exists };
}

test('native export verifies and relinks before removing private copy, without Gallery permissions', async () => {
  const app = fixture();
  const result = await app.autoExportReceivedMedia(app.request);
  assert.equal(result.state, 'saved');
  assert.equal(app.events[0][3], 'image/jpeg');
  assert.deepEqual(app.events.slice(1), ['record-export', 'relink', 'delete-private']);
  assert.equal(app.exists(), false);
});

test('failed native export keeps private media', async () => {
  const app = fixture({ failSave: true });
  assert.equal((await app.autoExportReceivedMedia(app.request)).state, 'failed');
  assert.equal(app.exists(), true);
  assert.equal(app.events.length, 1);
});

test('unreadable destination never replaces or deletes private media', async () => {
  const app = fixture({ available: false });
  assert.equal((await app.autoExportReceivedMedia(app.request)).state, 'failed');
  assert.equal(app.exists(), true);
  assert.ok(!app.events.includes('relink'));
});

test('failed database relink preserves the source', async () => {
  const app = fixture({ failRelink: true });
  await assert.rejects(app.autoExportReceivedMedia(app.request), /Database unavailable/);
  assert.equal(app.exists(), true);
});

test('concurrent requests for the same message export only once', async () => {
  const app = fixture();
  await Promise.all([app.autoExportReceivedMedia(app.request), app.autoExportReceivedMedia(app.request)]);
  assert.equal(app.events.filter(event => Array.isArray(event) && event[0] === 'save').length, 1);
});
