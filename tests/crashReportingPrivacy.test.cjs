const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/crashReportingPrivacy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox);
const sanitize = sandbox.exports.sanitizeCrashEvent;

test('safe diagnostic reasons and source-map matching survive sanitization', () => {
  const result = sanitize({ tags: { notification_blocker: 'authentication' },
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///index.android.bundle', debug_id: 'test-id' }] },
    exception: { values: [{ value: 'notification-open-timeout', stacktrace: { frames: [{ filename: 'app:///index.android.bundle', abs_path: 'app:///index.android.bundle' }] } }] } });
  assert.equal(result.tags.notification_blocker, 'authentication');
  assert.equal(result.exception.values[0].value, 'notification-open-timeout');
  assert.equal(result.debug_meta.images[0].code_file, result.exception.values[0].stacktrace.frames[0].abs_path);
  assert.equal(result.debug_meta.images[0].debug_id, 'test-id');
  assert.equal(sanitize({ tags: { notification_blocker: 'private-chat' } }).tags.notification_blocker, undefined);
});

test('crash reports remove private payloads while preserving stack coordinates', () => {
  const result = sanitize({
    type: undefined, release: 'com.axonic@1.0.38+40',
    user: { email: 'private@example.com', id: 'secret-user', ip_address: '1.2.3.4' },
    message: 'private-message', request: { headers: { Authorization: 'secret-token' } },
    extra: { roomName: 'private-room' }, breadcrumbs: [{ message: 'private-message' }],
    tags: { operation: 'notification-open-timeout', roomId: 'secret-room', axion_state: 'connected' },
    contexts: { device: { model: 'SM-S948U1', name: 'private-name', id: 'secret-device' }, os: { version: '17' }, arbitrary: { password: 'secret-password' } },
    exception: { values: [{ type: 'TypeError', value: "Cannot read property 'interpolate' of undefined", stacktrace: { frames: [{ filename: 'https://example.com/index.android.bundle?token=secret', function: 'SyncingHeaderTitle', lineno: 1, colno: 100, vars: { secret: 'password' }, context_line: 'private-message' }] } }] },
  });
  const json = JSON.stringify(result);
  assert.ok(!/private-|secret-|secret|1\.2\.3\.4/.test(json));
  assert.equal(result.exception.values[0].stacktrace.frames[0].colno, 100);
  assert.equal(result.exception.values[0].stacktrace.frames[0].filename, 'index.android.bundle');
  assert.equal(result.tags.axion_state, 'connected');
  assert.equal(result.contexts.device.model, 'SM-S948U1');
});

test('arbitrary exception messages and unknown state tags are not transmitted', () => {
  const result = sanitize({ type: undefined, tags: { operation: 'private-message', axion_state: 'secret-token' }, exception: { values: [{ type: 'Error', value: 'Upload failed for family-photo.jpg' }] } });
  assert.equal(result.exception.values[0].value, 'Error details omitted for privacy');
  assert.equal(Object.keys(result.tags).length, 0);
});

test('minimal and native-style events do not crash the JavaScript sanitizer', () => {
  assert.doesNotThrow(() => sanitize({ type: undefined }));
  assert.doesNotThrow(() => sanitize({ type: undefined, exception: { values: [{ type: 'java.lang.RuntimeException' }] } }));
});
