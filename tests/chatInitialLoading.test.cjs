const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){let i=0,wakes=0,callbacks,write;const slots=[],effects=[],owner='axonic:1:'+'a'.repeat(64),empty={version:1,contacts:[],messages:[]};
 const react={useRef:v=>{const n=i++;return slots[n]??={current:v};},useState:v=>{const n=i++;if(!(n in slots))slots[n]=v;return[slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v];},useMemo:f=>f(),useCallback:f=>f,useSyncExternalStore:()=>0,useEffect:(f,deps)=>{const n=i++,old=effects[n];if(!old||deps.some((d,k)=>d!==old.deps[k])){old?.cleanup?.();effects[n]={deps,cleanup:f()};}}};
 const mocks={react,'@react-navigation/native':{useIsFocused:()=>true},zustand:{useStore:(_store,selector)=>selector({index:{state:empty},error:''})},'zustand/react/shallow':{useShallow:selector=>selector},'../identity':{localAccount:{status:()=>({state:'unlocked',account:owner})}},'../messaging':{pendingMessages:{version:()=>0,subscribe:()=>()=>{},merge:(_o,s)=>s,reconcile(){}}},'../storage/chatStore':{ownConversationPages:()=>({}),subscribeOwnChatWrites:fn=>{write=fn;return()=>{write=undefined;};}},'../storage/storageReadSafety':{storageErrorText:()=> 'Read failed'},'../../services/identity/conversationProjection':{comparePositions:()=>0},'../../services/identity/sharedState':{retainEqual:(_a,b)=>b},'../../services/diagnosticJournal':{diagnosticJournal:{record(){}}},'./chatRefresh':{createChatRefresh:d=>{callbacks=d;return {wake(){wakes++;},stop(){}};}},'./conversationState':{conversationState:{}},'./liveState':{useForeground:()=>true}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/ui/useConversationPages.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>{if(!mocks[n])throw Error(n);return mocks[n];},out);
 return {render(key='room'){i=0;return out.useConversationWindow(key);},ready:v=>callbacks.ready(v,1),fail:()=>callbacks.failed(Error('fixture')),wakes:()=>wakes,write:(rooms,visible=true,account=owner)=>write?.(account,visible,rooms)};
}
test('initial history remains gated on failure; an empty successful page is ready',()=>{const f=fixture();assert.equal(f.render().initialLoading,true);f.fail();let v=f.render();assert.equal(v.initialLoading,true);assert.equal(v.error,'Read failed');f.ready({generation:1,messages:[],references:[],hasMore:false});v=f.render();assert.equal(v.initialLoading,false);assert.equal(v.error,'');});
test('older-page loading preserves current timeline; changing chats gates old data',()=>{const f=fixture();f.render();f.ready({generation:1,messages:[],references:[],hasMore:true});let v=f.render();v.loadMore();v=f.render();assert.equal(v.loading,true);assert.equal(v.initialLoading,false);assert.equal(f.render('another').initialLoading,true);});

test('pagination combines repeat scroll events and can retry after a read failure',()=>{
 const f=fixture(),page={generation:1,messages:[],references:[],hasMore:true};
 f.render();f.ready(page);const loaded=f.render();loaded.loadMore();loaded.loadMore();
 assert.equal(f.wakes(),1);f.fail();f.render().loadMore();assert.equal(f.wakes(),2);
});

test('an open chat reloads pages only for its own scoped writes and unscoped changes',()=>{
 const f=fixture();
 f.render('group:family');
 f.write(['private']);
 f.write(['group:work']);
 f.write([]);
 f.write(['group:family'],false);
 f.write(['group:family'],true,'another account');
 assert.equal(f.wakes(),0);
 f.write(['private','group:family']);
 f.write(undefined);
 assert.equal(f.wakes(),2);
 f.render('private');
 f.write(['group:family']);
 f.write(['private']);
 assert.equal(f.wakes(),3);
});
