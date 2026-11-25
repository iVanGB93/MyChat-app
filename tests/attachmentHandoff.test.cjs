const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function setup(){let selectionEvent,accountEvent,jobEvent,receiveEvent,hold,progress={jobs:[],selections:[]},account='owner';const listeners=new Set();
 const createStore=init=>{let state=init();return {getState:()=>state,getInitialState:()=>state,setState:next=>{state={...state,...next};listeners.forEach(fn=>fn());},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};};
 const mocks={'zustand/vanilla':{createStore},zustand:{useStore:()=>{}},react:{useMemo:f=>f()},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'@react-navigation/native':{useIsFocused:()=>true},'./liveState':{useForeground:()=>true},'../identity':{localAccount:{status:()=>({state:account?'unlocked':'locked',account}),subscribe:fn=>accountEvent=fn}},'../../services/identity/rootAttachmentSelections':{rootAttachmentProgress:async()=>{const snapshot=progress;if(hold)await new Promise(resolve=>hold.resolve=resolve);return snapshot;},subscribeAttachmentSelections:fn=>{selectionEvent=fn;return()=>{};}},'../../services/identity/mobileAttachmentJobs':{subscribeAttachmentJobProgress:fn=>{jobEvent=fn;return()=>{};},subscribeAttachmentReceiveProgress:fn=>{receiveEvent=fn;return()=>{};}},'../../services/identity/sharedState':{retainEqual:(_a,b)=>b},'../../utils/attachment-progress':{createAttachmentProgressLookup:()=>()=>undefined}};
 mocks['zustand/react/shallow']={useShallow:selector=>selector};
 mocks.zustand.useStore=(source,selector)=>selector(source.getState());
 const api={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/ui/transferState.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{if(!mocks[name])throw Error(name);return mocks[name];},api);
 api.transferState.subscribe(()=>{});
 return {api,hold(){hold={};},release(){const h=hold;hold=undefined;h.resolve();},job(row){jobEvent({owner:'owner',...row});},receive(account,bytes,digest){receiveEvent(account,'message',bytes,digest);},async sync(selections,published){progress={jobs:[],selections};selectionEvent('owner',!!selections.length,published);await new Promise(r=>setTimeout(r,10));},async ready(){await new Promise(r=>setTimeout(r,10));},lock(){account=null;accountEvent();},rows:()=>api.transferState.getState().value.selections};
}
test('published media stays visible between selection removal and durable chat render',async()=>{const t=setup();await t.ready();const s={id:'m',peer:'p',createdAt:1};await t.sync([s]);await t.sync([],[s]);assert.deepEqual(t.rows(),[s]);t.api.acknowledgeAttachmentHandoffs([{id:'other',peer:'p',direction:'outgoing'}]);assert.equal(t.rows().length,1);t.api.acknowledgeAttachmentHandoffs([{id:'m',peer:'p',direction:'outgoing'}]);assert.equal(t.rows().length,0);});
test('removed preparation is not kept unless publication is confirmed',async()=>{const t=setup();await t.ready();await t.sync([{id:'m',peer:'p'}]);await t.sync([]);assert.equal(t.rows().length,0);});
test('conversation selections isolate private chats and groups',async()=>{const t=setup();await t.ready();const direct={id:'a',peer:'p'},other={id:'b',peer:'q'},group={id:'c',peer:'p',group:{id:'g'}};await t.sync([direct,other,group]);assert.deepEqual(t.api.useChatTransferSelections('p'),[direct]);assert.deepEqual(t.api.useChatTransferSelections('g',true),[group]);});
test('group handoff clears all recipient copies by logical ID; lock clears owner state',async()=>{const t=setup();await t.ready();const rows=['a','b'].map(id=>({id,peer:id,group:{id:'g',messageId:'logical'}}));await t.sync([],rows);assert.equal(t.rows().length,2);t.api.acknowledgeAttachmentHandoffs([{id:'delivery',direction:'outgoing',group:{id:'g',messageId:'logical'}}]);assert.equal(t.rows().length,0);await t.sync([],rows);t.lock();assert.equal(t.rows().length,0);});

test('progress during hydration cannot starve selections or roll back newer job progress',async()=>{const t=setup();await t.ready();t.hold();const s={id:'m',peer:'p'};await t.sync([s]);t.job({digest:'d',phase:'uploading',cursor:7});t.release();await t.ready();assert.deepEqual(t.rows(),[s]);assert.equal(t.api.transferState.getState().value.jobs[0].cursor,7);});

test('only the matching owner and file see transient stream progress, and fallback clears it',async()=>{
 const t=setup();await t.ready();
 t.receive('another-account',500,'one');assert.equal(t.api.useReceivingProgress('one')[1],0);
 t.receive('owner',600,'one');t.receive('owner',800,'two');
 assert.equal(t.api.useReceivingProgress('one')[1],600);
 t.receive('owner',0,'one');assert.equal(t.api.useReceivingProgress('one')[1],0);
 assert.equal(t.api.useReceivingProgress('two')[1],800);
 t.job({digest:'two',phase:'confirming'});assert.equal(t.api.useReceivingProgress('two')[1],0);
 t.receive('owner',1500,'one');t.lock();assert.equal(t.api.useReceivingProgress('one')[1],0);
});
