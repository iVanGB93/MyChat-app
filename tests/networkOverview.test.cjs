const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const exportsObject = {};
new Function('exports', ts.transpileModule(fs.readFileSync('src/services/networkOverview.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(exportsObject);
const { networkOverview } = exportsObject;
const fixture = () => ({ user: 14, enabled: true, lifecycle: 'active', online: true,
  session: { owner: 14, restoring: false, error: null, discovered: [18, 18, 14],
    signaling: { ready: true }, directStored: 2 } });
test('network overview reports observations without treating introductions as connections', () => {
  const input = fixture(), result = networkOverview(input);
  assert.equal(result.hostedReachable, true);
  assert.equal(result.introducedPeers, 1);
  assert.equal(result.directDelivered, 2);
  input.session.signaling.ready = false;
  assert.equal(networkOverview(input).state, 'Waiting for peer');
  assert.equal(networkOverview(input).introducedPeers, 1);
});
test('account transitions never show another account’s session counters or ready state', () => {
  const input = fixture(); input.user = 18;
  const result = networkOverview(input);
  assert.equal(result.hostedReachable, false);
  assert.equal(result.introducedPeers, 0);
  assert.equal(result.directDelivered, 0);
  assert.equal(result.state, 'Not connected');
});
test('background, offline and disabled states cannot show a reachable hosted connection', () => {
  for (const change of [{ lifecycle: 'background' }, { online: false }, { enabled: false }, { user: null }]) {
    assert.equal(networkOverview({ ...fixture(), ...change }).hostedReachable, false);
  }
  const input = fixture(); input.session.restoring = true; input.session.signaling = null;
  assert.equal(networkOverview(input).state, 'Restoring connection');
});
