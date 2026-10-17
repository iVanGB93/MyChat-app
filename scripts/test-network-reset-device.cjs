// Dev-only device harness. Fixture mode redirects every database to a unique
// synthetic namespace. Request mode invokes the real confirmed Dev reset.
// Never target com.axonic; never print chat content, identities or credentials.
const fs=require('node:fs'),ts=require('typescript'),WebSocket=require('ws');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
const file=p=>compile(fs.readFileSync(p,'utf8'));
function evaluate(target,expression){return new Promise((resolve,reject)=>{
 const socket=new WebSocket(target.webSocketDebuggerUrl),timer=setTimeout(()=>{socket.close();reject(Error('Dev debugger timeout'));},25000);
 socket.on('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
 socket.on('error',e=>{clearTimeout(timer);reject(e);});socket.on('message',raw=>{const m=JSON.parse(raw);if(m.id!==1)return;clearTimeout(timer);socket.close();if(m.result?.exceptionDetails)reject(Error('Dev evaluation failed: '+m.result.exceptionDetails.text));else resolve(m.result?.result?.value);});
});}
const prelude=`
 const get=name=>{const entry=[...__r.getModules()].find(([id,m])=>m.verboseName===name);if(!entry)throw Error('Module unavailable '+name);return __r(entry[0]);};
 const find=pattern=>{const entry=[...__r.getModules()].find(([id,m])=>pattern.test(m.verboseName));if(!entry)throw Error('Native dependency unavailable');return __r(entry[0]);};
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const sql=find(/expo-sqlite[\\/]build[\\/]index\\.js$/);
 const accountModule=get('src/services/identity/localAccount.ts'),status=accountModule.localAccount.status();
 const storage=get('node_modules/@react-native-async-storage/async-storage/src/index.ts').default;
 const policy=get('src/services/identity/networkWorkReset.ts');
`;
const inspect=`
 assert(status.account,'Dev account unavailable');
 const hash=value=>get('node_modules/@noble/hashes/utils.js').bytesToHex(get('node_modules/@noble/hashes/sha2.js').sha256(new TextEncoder().encode(JSON.stringify(value))));
 const raw=await get('src/modules/storage/chatStore.ts').ownChatStore(status.account).read(),state=raw?JSON.parse(raw):{messages:[],contacts:[]};
 const messages=state.messages.map(({networkCancelledAt,...m})=>m);
 const tables=[];
 for(const [name,table] of policy.networkResetTables){const db=await sql.openDatabaseAsync(name,{useNewConnection:true});try{
  const exists=await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table);
  tables.push({table,rows:exists?(await db.getFirstAsync('SELECT COUNT(*) AS n FROM '+table+' WHERE owner=?',status.account)).n:0});
 }finally{await db.closeAsync();}}
 const marker=await storage.getItem(policy.NETWORK_WORK_RESET_KEY);
 const runtime=get('src/composition/neuronRuntime.ts'),snapshot=runtime.localAccountNetworkSnapshot();
 const statusCounts={};for(const m of state.messages){const label=get('src/services/identity/rootMessageStatus.ts').rootMessageStatus(m);statusCounts[label]=(statusCounts[label]??0)+1;}
 return {state:status.state,busy:status.busy,historyHash:hash(messages),contactsHash:hash(state.contacts),groupsHash:hash(state.groups??[]),vaultHash:hash(await storage.getItem('@axonic_local_account_v1')),messages:messages.length,pending:messages.filter(m=>m.status==='pending').length,cancelled:state.messages.filter(m=>m.networkCancelledAt!==undefined).length,schedulablePackets:get('src/services/identity/rootChatLedger.ts').pendingRootChat(state,status.account).length,statusCounts,relayRecords:(await runtime.localAccountRelayInventory())?.rows.length??null,networkResetAt:state.networkResetAt??null,resetPending:!!marker,tables,activeCall:!!runtime.localAccountCalls()?.snapshot(),networkActive:!!snapshot,connectedPeers:snapshot?.sessions.filter(s=>s.state==='connected').length??0};
`;
const fixture=`
 const p=get('src/services/identity/identityProtocol.ts'),api=get('src/services/identity/rootChatLedger.ts');
 const owner='axonic:1:'+'ab'.repeat(32),other='axonic:1:'+'cd'.repeat(32),at=Date.now();
 assert(owner!==status.account&&other!==status.account,'Synthetic owner collision');
 const prefix='network-reset-fixture-'+at+'-',names=new Set();
 let raw=JSON.stringify({version:1,messages:[{id:'11'.repeat(32),peer:other,direction:'outgoing',text:'Synthetic reset fixture',at:1,status:'pending'}],contacts:[]});
 const keys=new Map(policy.networkResetKeys(owner).map(k=>[k,'fixture'])),notices=[];
 const open=async name=>{const n=prefix+name;names.add(n);return sql.openDatabaseAsync(n,{useNewConnection:true});};
 try{
  for(const [name,table] of policy.networkResetTables){const db=await open(name);try{await db.execAsync('CREATE TABLE IF NOT EXISTS '+table+'(owner TEXT,raw TEXT)');for(const who of [owner,other])await db.runAsync('INSERT INTO '+table+' VALUES (?,?)',who,'synthetic');}finally{await db.closeAsync();}}
  const call=await open('axonic_call_control_v1.db');try{await call.execAsync('CREATE TABLE call_journal(owner TEXT,call_id TEXT,data TEXT)');for(const who of [owner,other])await call.runAsync('INSERT INTO call_journal VALUES (?,?,?)',who,'fixture-call','synthetic');}finally{await call.closeAsync();}
  const deps={'expo-sqlite':{openDatabaseAsync:open},'@react-native-async-storage/async-storage':{default:{multiRemove:async ks=>ks.forEach(k=>keys.delete(k)),setItem:async(k,v)=>keys.set(k,v)}},'@notifee/react-native':{default:{getDisplayedNotifications:async()=>[owner,other].map(account=>({notification:{id:account,data:{account}}})),cancelNotification:async id=>notices.push(id)}},'../../modules/storage/chatStore':{ownChatStore:()=>({read:async()=>raw,write:async v=>raw=v})},'./rootChatLedger':api,'./networkWorkReset':policy};
  const purge={};new Function('require','exports',${JSON.stringify(file('src/services/identity/networkWorkResetStorage.ts'))})(n=>{assert(n in deps,'Unexpected dependency');return deps[n];},purge);
  let marker=null;const ports={read:async()=>marker,write:async v=>marker=v,clear:async()=>marker=null,vaultAccount:async()=>owner,purge:purge.purgeNetworkWork};
  const live=policy.createNetworkWorkReset(ports);await live.beforeStartup();await live.request(owner,at);let blocked=false;try{await live.beforeStartup();}catch{blocked=true;}assert(blocked,'Live process purge allowed');
  const cold=policy.createNetworkWorkReset(ports);await cold.beforeStartup();assert(marker===null,'Reset marker retained');await purge.purgeNetworkWork({version:1,account:owner,at});
  for(const [name,table] of policy.networkResetTables){const db=await open(name);try{assert((await db.getFirstAsync('SELECT COUNT(*) n FROM '+table+' WHERE owner=?',owner)).n===0,'Owner queue retained');assert((await db.getFirstAsync('SELECT COUNT(*) n FROM '+table+' WHERE owner=?',other)).n===1,'Other owner damaged');}finally{await db.closeAsync();}}
  const s=JSON.parse(raw);assert(s.messages[0].text==='Synthetic reset fixture','History lost');assert(s.messages[0].networkCancelledAt===at,'Cancellation missing');assert(api.pendingRootChat(s,owner).length===0,'Old work recreated');
  const ledger=api.createRootChatLedger({owner,read:async()=>raw,write:async v=>raw=v,current:()=>true,now:()=>at+1});await ledger.enqueue(other,'22'.repeat(32),'Synthetic fresh send');assert(api.pendingRootChat(await ledger.snapshot(),owner).length===1,'New work blocked');
  assert(notices.every(id=>id===owner),'Foreign notice canceled');
  return {passed:true,nativeSQLiteTables:policy.networkResetTables.length,otherOwnerPreserved:true,historyPreserved:true,cancelledNotRequeued:true,newWorkAllowed:true,liveProcessBlocked:true,idempotent:true};
 }finally{for(const name of names)await sql.deleteDatabaseAsync(name);}
`;
async function main(){
 const mode=process.argv[2]??'inspect';if(!['inspect','fixture','request'].includes(mode))throw Error('Use inspect, fixture or request');
 const targets=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev');
 const target=process.env.AXONIC_DEV_TARGET?targets.find(t=>t.id===process.env.AXONIC_DEV_TARGET):targets.length===1?targets[0]:null;if(!target)throw Error('Choose one connected Axonic Dev with AXONIC_DEV_TARGET');
 const work=mode==='fixture'?fixture:mode==='inspect'?inspect:`assert(status.state==='unlocked'&&!status.busy,'Unlock Axonic Dev first');assert(!get('src/composition/neuronRuntime.ts').localAccountCalls()?.snapshot(),'Finish Dev call first');setTimeout(()=>{get('src/composition/neuronRuntime.ts').resetLocalNetworkWork(true).catch(error=>globalThis.__networkResetDevice={error:String(error)});},1500);return {requested:true,app:'com.axonic.dev'};`;
 await evaluate(target,compile(`(()=>{globalThis.__networkResetDevice={pending:true};(async()=>{${prelude}${work}})().then(value=>globalThis.__networkResetDevice={value},error=>globalThis.__networkResetDevice={error:String(error)});return true;})()`));
 for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,250));const result=await evaluate(target,'globalThis.__networkResetDevice');if(result&&!result.pending){if(result.error)throw Error(result.error);console.log(JSON.stringify(result.value));await evaluate(target,'delete globalThis.__networkResetDevice');return;}}
 throw Error('Device test timed out');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
