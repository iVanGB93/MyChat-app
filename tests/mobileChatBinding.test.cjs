const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
test('app composition isolates account vaults, routes authenticated challenges, and locks on background',async()=>{
 const memory=new Map(),secure=new Map(),frames=[],cache=new Map(),listeners=new Set();let timer;
 const room='22222222-2222-4222-8222-222222222222';
 let state={user:{id:14},authLoading:false,appLifecycle:'active',blockedIds:{},activeRoomId:room};
 const store={getState:()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}};
 const change=patch=>{state={...state,...patch};for(const f of listeners)f();};
 const storage=map=>({getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{map.set(k,v);}});
 const s=storage(secure);
 const mocks={
  '@react-native-async-storage/async-storage':{default:storage(memory)},
  'expo-secure-store':{getItemAsync:s.getItem,setItemAsync:s.setItem,WHEN_UNLOCKED_THIS_DEVICE_ONLY:'device-only'},
  '../../../modules/axonic-nearby':{default:{identityRandomBytes:async n=>crypto.randomBytes(n).toString('hex'),
   identityScrypt:async(p,s)=>crypto.createHash('sha256').update(p).update(Buffer.from(s,'hex')).digest('hex')}},
  '../../store/appStore':{useAppStore:store},
  '../localMessageStore':{getCachedRooms:async()=>[{id:room,room_type:'direct',members:[14,18]}]},
  '../notificationWsManager':{isNotifWsReady:()=>true,sendRawNotif:f=>{frames.push(f);return true;}},
  './chatIdentityPinStore':{createChatIdentityPinStore:()=>({read:async()=>null,pin:async()=>true})},
  './mobileNormalChatRuntime':{startMobileNormalChatRuntime:()=>()=>{}},
 };
 function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports','__DEV__','process','setInterval','clearInterval',
 ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(
  p=>mocks[p]??(p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p)),out,false,{env:{EXPO_PUBLIC_AXONIC_CHAT_IDENTITY:'1'}},
  fn=>{timer=fn;return 1;},()=>{timer=null;});cache.set(name,out);return out;}
 const waitFor=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setImmediate(r));}throw Error('Composition did not settle');};
 const stop=load('mobileChatBinding').startAccountChatBinding();
 try {
  await waitFor(()=>frames.length===1);const first=frames[0];assert.equal(first.payload.requester,14);
  const c={version:1,roomId:room,requester:18,requesterAccount:'axonic:1:'+'a1'.repeat(32),peer:14,
   nonce:'ab'.repeat(32),expiresAt:Date.now()+50000};
  assert.equal(await load('chatBindingBridge').routeChatBindingFrame({event:'chat_identity_binding',protocol:1,kind:'challenge',room_id:room,from_user_id:18,payload:c}),true);
  const proof=frames[1].payload;assert.equal(load('chatIdentityBinding').verifyChatBinding(proof,c,14,Date.now()),true);
  assert.equal(proof.record.account,first.payload.requesterAccount);
  change({appLifecycle:'background'});
  assert.equal(await load('chatBindingBridge').routeChatBindingFrame({}),false);
  change({user:{id:18},appLifecycle:'active'});await waitFor(()=>frames.some(f=>f.kind==='challenge'&&f.payload.requester===18));
  const second=frames.find(f=>f.kind==='challenge'&&f.payload.requester===18);assert.notEqual(second.payload.requesterAccount,first.payload.requesterAccount);
  assert(memory.has('@axonic_chat_identity_14_v1'));assert(memory.has('@axonic_chat_identity_18_v1'));
  assert([...memory.keys()].every(k=>k.startsWith('@axonic_chat_identity_')));
  change({user:null});assert.equal(await load('chatBindingBridge').routeChatBindingFrame({}),false);
 } finally {stop();}
 assert.equal(listeners.size,0);assert.equal(timer,null);
});
