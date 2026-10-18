const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};cache.set(name,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n.startsWith('./')?load(n.slice(2).replace(/\.(ts|js)$/,'')):require(n),out);return out;}
const {createSessionRouting}=load('sessionRouting'),{createPeerRanking}=load('peerRanking');

const q=(ms=20)=>({samples:10,responseMs:ms,mediaSamples:10,mediaResponseMs:ms,mediaBytesPerSecond:100000,failures:0,updatedAt:1000});
const session=(account,state='connected',quality=q())=>({snapshot:()=>({account,state,quality})});
test('shared view ranks connected pool entries and preserves exact-target lookup',()=>{
 const a=session('a'),b=session('b'),pending=session('c','authenticating');
 const sessions=new Set([b,pending,a]),connections=[{account:'a',route:'lan',state:'connected'},{account:'b',route:'internet',state:'connected'},{account:'c',route:'lan',state:'authenticating'}];
 const r=createSessionRouting({now:()=>1000,sessions:()=>sessions,connections:()=>connections});
 assert.deepEqual(r.rankedSessions().map(s=>s.snapshot().account),['a','b']);
 assert.equal(r.connectedSession('b'),b);assert.equal(r.connectedSession('c'),undefined);
 sessions.delete(b);assert.equal(r.connectedSession('b'),undefined);
});
test('close penalties exclude intentional shutdown and clear removes prior identity measurements',()=>{
 const connections=['a','b'].map(account=>({account,route:'internet',state:'connected'}));
 const r=createSessionRouting({now:()=>1000,sessions:()=>[],connections:()=>connections});
 for(const closeReason of ['session-stopped','inactive-session']){r.closed({account:'a',state:'closed',quality:q(),closeReason});assert.equal(r.rankedConnections()[0].account,'a');}
 r.closed({account:'a',state:'closed',quality:q(),closeReason:'transport-closed'});
 assert.equal(r.rankedConnections()[0].account,'b');
 r.clear();assert(r.rankedConnections().every(c=>c.quality==='learning'));
});
test('ranking matches the former adapter algorithm for both transport-independent modes',()=>{
 const sessions=[session('a','connected',q(300)),session('b','connected',{...q(20),mediaBytesPerSecond:2000}),session(null)];
 const connections=[{account:'a',route:'lan',state:'connected'},{account:'b',route:'internet',state:'connected'}];
 const old=createPeerRanking(()=>1000),r=createSessionRouting({now:()=>1000,sessions:()=>sessions,connections:()=>connections});
 for(const mode of ['text','media','text','media']){
  for(const s of sessions){const snap=s.snapshot();if(snap.account)old.observe(snap.account,snap.quality);}
  assert.deepEqual(r.rankedConnections(mode),old.rank(connections,mode));
 }
});

