const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {patchHook,patchParser}=require('../scripts/patch-share-intent.cjs');
const empty={files:null,text:null,webUrl:null,type:null};
function load(file,imports){const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>imports[n]??{},out);return out;}
const parser=load('node_modules/expo-share-intent/build/utils.js',{'./useShareIntent':{SHAREINTENT_DEFAULTVALUE:empty}}).parseShareIntent;
test('upstream parser never replaces a shared photo with its text, and handles missing MIME metadata',()=>{
 const image={contentUri:'content://photos/1',mimeType:'image/jpeg',fileName:'Photo',fileSize:'123'};
 const first=parser({text:'https://example.com/previous'},{}),next=parser({files:[image]},{});
 assert.equal(first.webUrl,'https://example.com/previous');assert.equal(next.text,null);assert.equal(next.webUrl,null);assert.equal(next.files[0].path,image.contentUri);
 const mixed=parser({text:'Current caption',files:[image]},{});assert.equal(mixed.text,'Current caption');assert.equal(mixed.files.length,1);
 assert.doesNotThrow(()=>parser({files:[{contentUri:'content://files/1'}]},{}));
});
test('hook clears obsolete content on errors and obsolete errors on a fresh share',()=>{
 let slots=[],cursor=0,requests=0;const effects=[],listeners={};const react={useRef:v=>({current:v}),useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],n=>slots[i]=n];},useEffect:f=>effects.push(f)};
 const native={getShareIntent(){assert.ok(listeners.onChange&&listeners.onError&&listeners.onStateChange);requests++;},addListener:(name,fn)=>{listeners[name]=fn;return{remove(){}};}};
 const hook=load('node_modules/expo-share-intent/build/useShareIntent.js',{'react':react,'react-native':{Platform:{OS:'android'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'expo-linking':{useLinkingURL:()=>null},'./ExpoShareIntentModule':{default:native},'./utils':{parseShareIntent:parser,getShareExtensionKey:()=>'',getScheme:()=>''}}).default;
 const render=()=>{cursor=0;return hook({resetOnBackground:false});};render();effects.forEach(f=>f());
 assert.equal(requests,1);
 listeners.onChange({value:{text:'Old link'}});assert.equal(render().shareIntent.text,'Old link');
 listeners.onError({value:'Unreadable photo'});assert.equal(render().hasShareIntent,false);assert.equal(render().error,'Unreadable photo');
 listeners.onChange({value:{files:[{contentUri:'content://photos/fresh',mimeType:'image/jpeg'}]}});assert.equal(render().error,null);assert.equal(render().shareIntent.text,null);assert.equal(render().shareIntent.files.length,1);
 listeners.onStateChange({value:'pending'});
 assert.equal(requests,2);
 assert.equal(render().hasShareIntent,false);
 listeners.onChange({value:{files:[{contentUri:'content://files/report',mimeType:'application/pdf',fileName:'Report.pdf'}]}});
 assert.deepEqual(render().shareIntent.files.map(file=>[file.path,file.mimeType]),[['content://files/report','application/pdf']]);
});
test('JS dependency patches are idempotent and fail on unknown dependency structure',()=>{
 for(const [file,patch] of [['useShareIntent.js',patchHook],['utils.js',patchParser]]){const s=fs.readFileSync('node_modules/expo-share-intent/build/'+file,'utf8');assert.equal(patch(s),s);assert.throws(()=>patch('unknown source'),/Unsupported/);}
});
