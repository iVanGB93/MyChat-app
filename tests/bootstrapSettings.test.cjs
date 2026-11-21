const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const first = {account:'first', endpoint:'wss://143.198.121.2/v2/axon'};
const second = {account:'second', endpoint:'wss://second.example/v2/axon'};
const source = ts.transpileModule(fs.readFileSync('src/services/identity/bootstrapSettings.ts','utf8'),
  {compilerOptions:{module:1,target:9}}).outputText;
const transport = {};
const transportSource = ts.transpileModule(fs.readFileSync('src/services/identity/internetAxonTransport.ts','utf8'),
  {compilerOptions:{module:1,target:9}}).outputText;
new Function('exports','require','URL',transportSource)(transport,()=>({
  openNativeWire:(_native,_context,connect)=>connect(),
}),undefined);

function fixture(value, put = async () => {}) {
  const exports = {};
  const deps = {
    '@react-native-async-storage/async-storage': {default:{getItem:async()=>value,setItem:put}},
    './internetAxonTransport': {...transport,FIRST_NEURON:first,SECOND_NEURON:second},
  };
  new Function('exports','require',source)(exports,id=>deps[id]);
  return exports;
}

test('bootstrap parser accepts HTTPS-compatible hostnames without ambiguous URL forms', () => {
  const {parseBootstrapEndpoint:parse} = fixture(null);
  assert.equal(parse(' wss://New.Example:443/v2/axon '),'wss://new.example/v2/axon');
  assert.equal(parse(first.endpoint),first.endpoint);
  for (const address of ['ws://new.example/v2/axon','wss://@new.example/v2/axon',
    'wss://new.example:8443/v2/axon','wss://new.example/v2/axon#','wss://new.example/v2/axon?',
    'wss://new.example/a/../v2/axon','wss://127.1/v2/axon','wss://-host.example/v2/axon']) {
    assert.equal(parse(address),null,address);
  }
});

test('the Android connector receives the verified locator hostname without relying on global URL', async () => {
  const account = 'axonic:1:'+'ab'.repeat(32);
  const seed = {account, endpoint:first.endpoint};
  const connect = transport.createInternetAxonConnector({
    axonWssConnect:async(host,owner)=>({host,owner}),
  },()=>account,()=>[seed]);
  assert.deepEqual(await connect({...seed,route:'internet'},{signal:new AbortController().signal}),
    {host:'143.198.121.2',owner:account});
});

test('saved locator keeps the expected identity and a failed write keeps the active route', async () => {
  const endpoint = 'wss://new.example/v2/axon';
  const settings = fixture(endpoint,async()=>{throw Error('storage unavailable');});
  await settings.loadBootstrapEndpoint();
  assert.deepEqual(settings.bootstrapPeers(),[{...first,endpoint,preferredBootstrap:true},second]);
  await assert.rejects(settings.saveBootstrapEndpoint(first.endpoint),/storage unavailable/);
  assert.equal(settings.bootstrapEndpoint(),endpoint);
  const corrupt = fixture('ws://new.example/v2/axon');
  await corrupt.loadBootstrapEndpoint();
  assert.equal(corrupt.bootstrapEndpoint(),first.endpoint);
});
