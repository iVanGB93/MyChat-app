const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function compile(name,imports,clock){const out={};new Function('exports','require','Date',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>{if(!(n in imports))throw Error('Unexpected dependency '+n);return imports[n];},clock??Date);return out;}
test('lookup and inbox leases release independently and double release is harmless',()=>{const calls=[],lease=compile('messageWakeLease',{'../../../modules/axonic-nearby':{default:{axonMessageWake:ms=>calls.push(ms)}}});const a=lease.acquireMessageWakeLease(),b=lease.acquireMessageWakeLease();a();a();assert.deepEqual(calls,[30000,30000]);b();assert.deepEqual(calls,[30000,30000,0]);});
test('mobile public lookup closes and releases its lease on success, failure and native deadline',async()=>{for(const mode of ['success','failure','timeout']){let now=0,closed=0,released=0;const imports={
 '../../../modules/axonic-nearby':{default:{axonMessageWait:async ms=>{now+=ms;}}},
 './mobileRecoveryDiscovery':{createMobileRecoveryDiscovery:()=>({lookup:async()=>{if(mode==='failure')throw Error('synthetic');if(mode==='timeout')return new Promise(()=>{});return {status:'found'};},stop:()=>closed++})},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({})},
 './rootCallWake':{rootWakeContext:async()=>null,rootWakeBlocked:async()=>false},
 './wakeSenderRecovery':{createWakeSenderRecovery:d=>d.lookup},
 './messageWakeLease':{acquireMessageWakeLease:()=>()=>released++}};
 const m=compile('mobileWakeSenderRecovery',imports,{now:()=>now});if(mode==='failure')await assert.rejects(m.recoverWakeSender('synthetic'));else assert.equal((await m.recoverWakeSender('synthetic')).status,mode==='success'?'found':'unavailable');assert.equal(released,1);assert(closed>=1);assert(now<=10250);
}});
