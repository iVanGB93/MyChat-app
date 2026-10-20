// Isolated in-memory ledger tests in one emulator Dev Hermes runtime.
// No real messages, invitations, account writes, resets, or network calls.
const fs=require('node:fs'),ts=require('typescript');
const {run}=require('./test-two-phone-dev.cjs');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
(async()=>{
 const candidates=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.title?.startsWith('com.axonic.dev')&&t.title.includes('sdk_gphone'));
 if(candidates.length!==1)throw Error('Exactly one emulator Dev target required');
 const result=await run(candidates[0],`
 const groups={},chat={},assert=(v,s)=>{if(!v)throw Error(s);};
 const dependency=n=>get('src/services/identity/'+n.replace(/^\\.\\//,'').replace(/\\.ts$/,'')+'.ts');
 new Function('exports','require',${JSON.stringify(compile('src/services/identity/rootGroups.ts'))})(groups,n=>n.startsWith('./')?dependency(n):get('node_modules/'+n));
 new Function('exports','require',${JSON.stringify(compile('src/services/identity/rootChatLedger.ts'))})(chat,n=>n==='./rootGroups.ts'?groups:dependency(n));
 const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64),id=n=>n.toString(16).padStart(64,'0');
 let raw=null,writes=0;
 const open=()=>chat.createRootChatLedger({owner,current:()=>true,now:()=>1800000000000,read:async()=>raw,write:async v=>{raw=v;writes++;}});
 const api=open();await api.createGroup(id(1),id(2),'Fixture',[peer]);
 const state=JSON.parse(raw),sample=state.groupPackets[0];
 state.groupPackets=Array.from({length:2000},(_,i)=>({...sample,id:id(i+100),status:'delivered'}));
 raw=JSON.stringify(state);
 await api.updateGroup(id(1),id(3),'Updated fixture',[peer]);
 let s=await open().snapshot();
 assert(s.groupPackets.length===2001,'old history blocked update');
 assert(JSON.stringify(s.groupPackets.slice(0,2000))===JSON.stringify(state.groupPackets),'history changed');
 for(let i=0;i<12;i++)await api.recoverGroupsForPeer(peer,id(i+5000));
 s=await api.snapshot();assert(s.groupPackets.length===2001,'recovery duplicated pending metadata');
 const pending=s.groupPackets.find(p=>p.status==='pending');await api.delivered(peer,pending.id);
 await api.recoverGroupsForPeer(peer,id(6000));
 assert((await api.snapshot()).groupPackets.length===2002,'delivered recovery not resent');
 return {passed:true,retainedHistory:2000,repeatedRecoveries:12,reopenVerified:true,fixtureWrites:writes,realStorageWrites:0,networkCalls:0};
 `);
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
