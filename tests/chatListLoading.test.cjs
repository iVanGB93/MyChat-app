const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 let value={owner:'owner',index:null,error:''};const store={getState:()=>value,subscribe:()=>()=>{}},out={};
 const mocks={react:{useMemo:fn=>fn()},zustand:{useStore:s=>s.getState()},'@react-navigation/native':{useIsFocused:()=>true},'./liveState':{useForeground:()=>true},'./conversationState':{conversationState:store}};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/modules/ui/useConversationPages.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>mocks[name]??{},out);
 return {set:next=>value=next,read:out.useConversationSummaries};
}
test('cold chat list remains loading until summaries have actually loaded, including a genuinely empty account',()=>{
 const f=fixture();assert.equal(f.read().loading,true);
 f.set({owner:'owner',index:{state:{contacts:[],messages:[]},summaries:{}},error:''});assert.equal(f.read().loading,false);
});
test('failed startup displays an error rather than endless loading or a successful empty account',()=>{
 const f=fixture();f.set({owner:'owner',index:null,error:'Storage unavailable'});assert.equal(f.read().loading,false);assert.equal(f.read().error,'Storage unavailable');
});
test('refresh failures retain loaded conversations and never replace them with a startup spinner',()=>{
 const f=fixture(),state={contacts:[{account:'peer'}],messages:[]},summaries={peer:{unread:1}};
 f.set({owner:'owner',index:{state,summaries},error:'Retrying storage'});
 assert.equal(f.read().loading,false);assert.equal(f.read().state,state);assert.equal(f.read().summaries,summaries);
 f.set({owner:'new-owner',index:null,error:''});assert.equal(f.read().loading,true);assert.equal(f.read().state.contacts.length,0);
});
