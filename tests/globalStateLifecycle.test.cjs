const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const settle=()=>new Promise(r=>setTimeout(r,15));
function fixture(){
 const accountListeners=new Set(),writeListeners=new Set(),appListeners=new Set(),jobs=new Set(),selections=new Set();
 let account='owner',unlocked=true,revision=0,reads=0,fail=false,defer=false,progressReads=0;
 const pending=[];let data={version:1,contacts:[],messages:[]},progress={jobs:[],selections:[]};
 const app={currentState:'active',addEventListener:(_,fn)=>{appListeners.add(fn);return {remove:()=>appListeners.delete(fn)};}};
 const identity={status:()=>({state:unlocked?'unlocked':'locked',account}),subscribe:fn=>{accountListeners.add(fn);return()=>accountListeners.delete(fn);}};
 const overrides=new Map(Object.entries({
  'src/modules/identity/index.ts':{localAccount:identity},
  'src/modules/messaging/index.ts':{pendingMessages:{reconcile(){}},conversations:()=>({snapshot:async()=>{reads++;if(fail)throw Error('disk');const snapshot=structuredClone(data);return defer?new Promise(r=>pending.push(()=>r(snapshot))):snapshot;}})},
  'src/modules/storage/chatStore.ts':{ownChatRevision:()=>revision,subscribeOwnChatWrites:fn=>{writeListeners.add(fn);return()=>writeListeners.delete(fn);}},
  'src/services/diagnosticJournal.ts':{diagnosticJournal:{record(){}}},
  'src/modules/ui/liveState.ts':{useForeground:()=>true},
  'src/services/identity/rootAttachmentSelections.ts':{rootAttachmentProgress:async()=>{progressReads++;return structuredClone(progress);},subscribeAttachmentSelections:fn=>{selections.add(fn);return()=>selections.delete(fn);}},
  'src/services/identity/mobileAttachmentJobs.ts':{subscribeAttachmentJobProgress:fn=>{jobs.add(fn);return()=>jobs.delete(fn);}},
 }).map(([k,v])=>[path.resolve(k),v]));
 const cache=new Map();function load(file){file=path.resolve(file);if(overrides.has(file))return overrides.get(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(exports,n=>{
   if(n==='react-native')return {AppState:app};if(n==='@react-navigation/native')return {useIsFocused:()=>true};
   if(!n.startsWith('.'))return require(n);const base=path.resolve(path.dirname(file),n.replace(/\.ts$/,''));return load(fs.existsSync(base+'.ts')?base+'.ts':path.join(base,'index.ts'));
  });return exports;
 }
 const chat=load('src/modules/ui/chatState.ts').chatState,transfer=load('src/modules/ui/transferState.ts').transferState;
 return {chat,transfer,pending,reads:()=>reads,progressReads:()=>progressReads,
  data(next){data=next;},defer(value){defer=value;},fail(value){fail=value;},
  write(who=account){revision++;for(const fn of writeListeners)fn(who);},
  lock(){unlocked=false;for(const fn of accountListeners)fn();},unlock(){unlocked=true;for(const fn of accountListeners)fn();},
  switch(next){account=next;for(const fn of accountListeners)fn();},
  background(){app.currentState='background';for(const fn of appListeners)fn('background');},foreground(){app.currentState='active';for(const fn of appListeners)fn('active');},
  progress(value){progress=value;},job(value){for(const fn of jobs)fn(value);},selection(){for(const fn of selections)fn(account);},
 };
}
test('chat observers share one read, ignore unrelated owners, stop in background and on detach',async()=>{
 const f=fixture(),a=f.chat.subscribe(()=>{}),b=f.chat.subscribe(()=>{});
 try{await settle();assert.equal(f.reads(),1);f.write('different');await settle();assert.equal(f.reads(),1);
  f.background();f.write();await settle();assert.equal(f.reads(),1);f.foreground();await settle();assert.equal(f.reads(),2);
 }finally{a();b();}f.write();await settle();assert.equal(f.reads(),2);
});
test('late history from before lock/unlock cannot replace the new session',async()=>{
 const f=fixture();f.defer(true);const off=f.chat.subscribe(()=>{});
 try{await settle();assert.equal(f.pending.length,1);f.lock();assert.equal(f.chat.getState().state.messages.length,0);
  f.unlock();await settle();assert.equal(f.pending.length,2);f.pending[1]();await settle();const fresh=f.chat.getState().state;
  f.pending[0]();await settle();assert.equal(f.chat.getState().state,fresh);
 }finally{off();}
});
test('failed history refresh keeps last good state and reports an error without reset',async()=>{
 const f=fixture(),off=f.chat.subscribe(()=>{});
 try{await settle();const before=f.chat.getState().state;f.fail(true);f.write();await settle();assert.equal(f.chat.getState().state,before);assert.match(f.chat.getState().error,/Saved data was not replaced/);
 }finally{off();}
});
test('progress checkpoints update one row without rereading the job list or selections',async()=>{
 const f=fixture(),off=f.transfer.subscribe(()=>{});
 try{await settle();assert.equal(f.progressReads(),1);const row={owner:'owner',id:'one',digest:'a',phase:'uploading',cursor:1,bytes:10,failures:0,canPause:true};
  f.job(row);const selections=f.transfer.getState().value.selections;for(let i=2;i<12;i++)f.job({...row,cursor:i});
  assert.equal(f.progressReads(),1);assert.equal(f.transfer.getState().value.jobs[0].cursor,11);assert.equal(f.transfer.getState().value.selections,selections);
  f.job({...row,owner:'other',cursor:99});assert.equal(f.transfer.getState().value.jobs[0].cursor,11);
  f.job({...row,phase:'complete'});assert.equal(f.transfer.getState().value.jobs.length,0);
  f.lock();assert.equal(f.transfer.getState().value.jobs.length,0);
 }finally{off();}
});
test('inactive progress observers detach and rehydrate after returning',async()=>{
 const f=fixture(),off=f.transfer.subscribe(()=>{});await settle();off();f.job({owner:'owner',digest:'ignored'});assert.equal(f.transfer.getState().value.jobs.length,0);
 const again=f.transfer.subscribe(()=>{});try{await settle();assert.equal(f.progressReads(),2);}finally{again();}
});
