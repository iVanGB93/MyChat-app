const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const shared={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/ui/sharedContent.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(shared);
const photo=()=>({files:[{path:'content://photos/new',fileName:'Photo.jpg',mimeType:'image/jpeg',size:123}]});
function fixture(input=photo()){
 let slots=[],cursor=0,context,resolvePreview,reads=0,copyGate,metadataGate;const cleanups=[],sent=[],reviewed=[];
 const account={account:'owner',state:'unlocked'},intent={hasShareIntent:true,shareIntent:input,error:null,resetShareIntent(){intent.resets=(intent.resets||0)+1;}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),createContext:()=>({Provider:'Provider'}),useContext:()=>context,
 useRef:v=>{const i=cursor++;return slots[i]??=( {current:v});},useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],n=>slots[i]=typeof n==='function'?n(slots[i]):n];},
 useMemo:fn=>fn(),useEffect:fn=>{const i=cursor++;if(!(i in slots)){slots[i]=true;const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}};
 const imports={react,'expo-image':{Image:'Image'},'react-native':{Text:'Text',View:'View'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-share-intent':{useShareIntent:()=>intent},
 './ConversationRecipientPicker':{__esModule:true,default:'Picker'},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'../../modules/identity':{localAccount:{status:()=>account},shortIdentity:x=>x},'../../modules/ui/sharedContent':shared,
 '../../modules/ui/useChatSnapshot':{useConversationIndex:()=>({index:{state:{contacts:[{account:'peer',accepted:true}],groups:[]}},error:''})},
 '../../modules/messaging':{conversations:()=>({metadataSnapshot:async()=>{reads++;if(metadataGate)await metadataGate;return{contacts:[{account:'peer',accepted:true}],groups:[]};}}),messaging:{sendText:async(...args)=>sent.push(['text',...args]),sendGroupText:async()=>{}}},
 '../../modules/media':{queueRootAttachmentSource:async(...args)=>sent.push(['file',...args])},'../../modules/storage':{withRootSharedFile:async(_o,uri,fn)=>{if(copyGate)await copyGate;return fn(uri);}},
 './AttachmentPreview':{useAttachmentPreview:()=>({isOpen:false,modal:null,confirm:files=>{reviewed.push(files);return new Promise(r=>resolvePreview=r);}})}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/chat/RootSharePicker.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2,esModuleInterop:true}}).outputText+'\nexports.Session=ShareSession;')(n=>(require('./helpers/localization.cjs')(n)??(imports[n])),out);
 context={intent,pending:{current:null},revision:1};
 const nodes=n=>!n||typeof n!=='object'?[]:[n,...(n.props?.children??[]).flat(Infinity).flatMap(nodes)];
 return {intent,account,context,sent,reviewed,out,provider(){cursor=0;return out.RootShareProvider({children:null}).props.value;},render(){cursor=0;return nodes(out.Session({onSent:target=>sent.push(['navigation',target])})).find(n=>n.type==='Picker').props;},select(){this.render().onSelect('peer');return this.render();},resolve:files=>resolvePreview(files),unmount(){cleanups.forEach(f=>f());},supersede(){context.pending.current=null;context.revision++;},copyWait(p){copyGate=p;},metadataWait(p){metadataGate=p;},reads:()=>reads};
}
const settle=()=>new Promise(setImmediate);
test('provider gives identical new OS shares distinct lifetimes without replacing a draft on ordinary renders',()=>{
 const f=fixture();const first=f.provider();first.pending.current={marker:true};const second=f.provider();assert.equal(second.revision,first.revision);assert.equal(second.pending.current.marker,true);
 f.intent.shareIntent=photo();const next=f.provider();assert.equal(next.revision,first.revision+1);assert.equal(next.pending.current,null);
});
test('new photo is shown ahead of accompanying text and retains its size for review',async()=>{
 const f=fixture({...photo(),text:'Current photo link'});const ui=f.select();assert.equal(ui.preview.props.children[0].type,'Image');ui.onSubmit();await settle();assert.equal(f.reviewed[0][0].size,123);f.resolve(null);await settle();assert.equal(f.sent.length,0);
});
test('new share during review cancels old send and cannot clear the new intent',async()=>{
 const f=fixture();f.select().onSubmit();await settle();f.supersede();f.resolve([{uri:'file:///old',name:'Old',mime:'image/jpeg'}]);await settle();assert.equal(f.sent.length,0);assert.equal(f.intent.resets,undefined);
});
test('double tap before React renders opens one review; cancel does not enqueue',async()=>{
 const f=fixture(),ui=f.select();ui.onSubmit();ui.onSubmit();await settle();assert.equal(f.reviewed.length,1);f.resolve(null);await settle();assert.equal(f.sent.length,0);
});
test('superseding a share during file copy prevents dispatch of old bytes',async()=>{
 const f=fixture();let release;f.copyWait(new Promise(r=>release=r));f.select().onSubmit();await settle();f.resolve([{uri:'content://photos/new',name:'Photo',mime:'image/jpeg'}]);await settle();f.supersede();release();await settle();assert.equal(f.sent.length,0);
});
test('account switch or unmount during review cannot send',async()=>{
 for(const mode of ['account','unmount']){const f=fixture();f.select().onSubmit();await settle();if(mode==='account')f.account.account='other';else f.unmount();f.resolve([{uri:'file:///x',name:'Photo',mime:'image/jpeg'}]);await settle();assert.equal(f.sent.length,0);}
});
test('successful review queues exactly the selected photo and clears only its own draft',async()=>{
 const f=fixture();f.select().onSubmit();await settle();f.resolve([{uri:'file:///reviewed',name:'Photo',mime:'image/jpeg',caption:'Caption'}]);await settle();assert.equal(f.sent.filter(x=>x[0]==='file').length,1);assert.equal(f.sent[0][2],'file:///reviewed');assert.equal(f.intent.resets,1);assert.equal(f.context.pending.current,null);
});
test('native error cannot expose or send the previous content',async()=>{
 const f=fixture({text:'Old link'});f.intent.error='New photo cannot be read';const ui=f.select();assert.equal(ui.preview,null);ui.onSubmit();await settle();assert.equal(f.sent.length,0);
});


test('an Android PDF keeps its exact URI and MIME type through confirmation',async()=>{
 const file={path:'content://docs/report',fileName:'Report.pdf',mimeType:'application/pdf',size:123};
 const f=fixture({files:[file]}),ui=f.select();
 assert.equal(f.reads(),0,'recipient rendering reuses the existing index');
 assert.notEqual(ui.preview.props.children[0].type,'Image');
 ui.onSubmit();await settle();
 assert.deepEqual(f.reviewed[0],[{uri:file.path,name:file.fileName,mime:file.mimeType,size:file.size}]);
 f.resolve(f.reviewed[0]);await settle();
 assert.deepEqual(f.sent[0].slice(0,5),['file','peer',file.path,file.fileName,file.mimeType]);
});
