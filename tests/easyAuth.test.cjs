const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function fixture({ clientId = '', native = false, result = { type: 'cancelled' }, response = {} } = {}) {
  const saved = [], requests = [];
  let imports = 0;
  const modules = {
    'react-native': { Platform: { OS: 'android' }, TurboModuleRegistry: { get: () => native ? {} : null } },
    '../config/appConfig': { APP_CONFIG: { SERVER_URL: 'https://example.test' } },
    './authTokens': { saveTokens: async (...tokens) => saved.push(tokens) },
    '@react-native-google-signin/google-signin': { GoogleSignin: {
      configure() {}, hasPlayServices: async () => true, signIn: async () => result,
    } },
  };
  const context = {
    exports: {}, process: { env: { EXPO_PUBLIC_GOOGLE_SIGNIN_WEB_CLIENT_ID: clientId } },
    setTimeout, clearTimeout, AbortController,
    fetch: async (...args) => { requests.push(args); return { ok: true, json: async () => response }; },
    require: (name) => { assert.ok(name in modules, name); if (name.includes('google-signin')) imports++; return modules[name]; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/easy-auth.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { ...context.exports, saved, requests, imports: () => imports };
}

test('older builds and missing Google configuration do not load the enforcing native module', async () => {
  for (const config of [{}, { clientId: 'web-id' }, { native: true }]) {
    const f = fixture(config);
    assert.equal(f.googleSignInAvailable(), false);
    await assert.rejects(f.signInWithGoogle());
    assert.equal(f.imports(), 0);
  }
});
test('Google cancellation sends no backend request', async () => {
  const f = fixture({ clientId: 'web-id', native: true });
  assert.equal(await f.signInWithGoogle(), null);
  assert.equal(f.requests.length, 0);
});
test('Google sends a credential in the request body, not the URL', async () => {
  const f = fixture({ clientId: 'web-id', native: true, result: { type: 'success', data: { idToken: 'test-token' } } });
  await f.signInWithGoogle();
  assert.equal(f.requests[0][0], 'https://example.test/api/users/signin/google/');
  assert.deepEqual(JSON.parse(f.requests[0][1].body), { id_token: 'test-token' });
  assert.equal(f.requests[0][1].headers.Authorization, undefined);
});
test('email proof and username prompts never persist session credentials', async () => {
  const f = fixture();
  assert.equal(await f.adoptEasyAuthResult({ needs_username: true }), false);
  assert.equal(await f.adoptEasyAuthResult({ challenge_id: 'challenge', email: 'a@example.test' }), false);
  assert.equal(f.saved.length, 0);
});
test('only a complete token pair is handed to secure storage', async () => {
  const f = fixture();
  await assert.rejects(f.adoptEasyAuthResult({ access: 'access' }));
  assert.equal(f.saved.length, 0);
  assert.equal(await f.adoptEasyAuthResult({ access: 'access', refresh: 'refresh' }), true);
  assert.deepEqual(f.saved, [['access', 'refresh']]);
});
