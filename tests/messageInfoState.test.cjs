const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n]);return out;}
const status=load('src/services/identity/rootMessageStatus.ts'),info=load('src/modules/messaging/messageInfoState.ts',{'../../services/identity/rootMessageStatus':status});
test('status timeline preserves unknown historical times and expired custody evidence',()=>{
 const legacy={direction:'outgoing',at:1,status:'delivered',read:true};
 assert.deepEqual(info.messageInfoTimeline(legacy).map(r=>r.at),[undefined,undefined,undefined]);
 const expired={direction:'outgoing',at:1,status:'pending',storedAt:20,networkStoredUntil:100};
 const rows=info.messageInfoTimeline(expired,101);assert.equal(rows.find(r=>r.label==='First confirmed Stored').at,20);assert.equal(status.rootMessageStatus(expired,101),'pending');
 const media={...expired,attachment:{},descriptorReceivedAt:50};assert.equal(info.messageInfoTimeline(media,101).find(r=>r.label==='Message information receipt confirmed').at,50);
});
test('private and group incoming media explanations do not claim full-file receipt',()=>{
 const m={status:'pending',attachment:{},direction:'incoming',read:true};assert.match(info.messageInfoDescription(m),/full attachment has not been received/);assert.equal(status.rootMessageStatus(m),'pending');
 assert.match(info.messageInfoDescription({...m,status:'delivered',read:false}),/complete attachment was received/);
 assert.match(info.messageInfoDescription({...m,status:'delivered'}),/Read on this device/);
 const group=load('src/modules/messaging/groupMessageInfo.ts',{'../../services/identity/rootMessageStatus':status,'./messageInfoState':info});
 const row={...m,peer:'sender',id:'transport',at:1,text:'photo',group:{id:'g',messageId:'logical'}};
 const result=group.groupMessageInfo({messages:[row]},'owner','g',{id:'logical',author:'sender'});
 assert.equal(result.status,'pending');assert.equal(result.description,info.messageInfoDescription(row));assert.deepEqual(result.recipients,[]);
});
test('expiry follows the first required custody deadline, never completed delivery',()=>{
 const m={status:'pending',attachment:{},networkStoredUntil:200,attachmentStoredUntil:300};
 assert.equal(info.nextMessageStateExpiry([m],100),200);
 assert.equal(info.nextMessageStateExpiry([{...m,descriptorDelivered:true}],100),300);
 assert.equal(info.nextMessageStateExpiry([{...m,status:'delivered'}],100),undefined);
 assert.equal(info.nextMessageStateExpiry([m],200),undefined);
 assert.equal(status.rootMessageStatus(m,200),'pending');
 assert.equal(info.nextMessageStateExpiry([{status:'pending',networkStoredUntil:200}],100),200);
});
test('expiry clock updates without storage changes, pauses in background, and cleans up',()=>{
 let now=100,cleanup,listener;const updates=[],timers=new Map();let sequence=0;
 const app={currentState:'active',addEventListener:(_event,fn)=>{listener=fn;return {remove:()=>listener=null};}};
 const deps={'react':{useState:init=>[init(),value=>updates.push(value)],useEffect:fn=>cleanup=fn()},'react-native':{AppState:app},'@react-navigation/native':{useIsFocused:()=>true},'../messaging/messageInfoState':info};
 const out={};new Function('exports','require','Date','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/modules/ui/useMessageStateClock.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n],{now:()=>now},(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},id=>timers.delete(id));
 out.useMessageStateClock([{status:'pending',networkStoredUntil:200}]);assert.equal([...timers.values()][0].ms,101);
 app.currentState='background';listener();assert.equal(timers.size,0);
 now=201;app.currentState='active';listener();assert.equal(updates.at(-1),201);assert.equal(timers.size,0);cleanup();assert.equal(listener,null);
 now=100;out.useMessageStateClock([{status:'pending',networkStoredUntil:200}]);const timer=[...timers.values()][0];now=201;timer.fn();assert.equal(updates.at(-1),201);assert.equal(timers.size,0);cleanup();
});
