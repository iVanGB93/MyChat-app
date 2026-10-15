(async()=>{try{
 let now=0,calls=0,fail=true;const gate=exports.createStorageReadGate(()=>now);
 const work=async()=>{calls++;if(fail)throw Error('AXONIC_BACKUP_FAILED');return 'saved';};
 for(const delay of [2000,4000,8000,16000,32000,60000,60000]){
  const first=gate.read(work);if(first!==gate.read(work))throw Error('not coalesced');
  try{await first;throw Error('expected failure');}catch(e){if(e.message!=='AXONIC_BACKUP_FAILED')throw e;}
  const count=calls;for(let i=0;i<20;i++){try{await gate.read(work);}catch{}}
  if(calls!==count)throw Error('retry storm');now+=delay;
 }
 fail=false;if(await gate.read(work)!=='saved')throw Error('no recovery');
 let rejectOld;const old=gate.read(()=>new Promise((_,reject)=>rejectOld=reject));await Promise.resolve();gate.invalidate();
 if(await gate.read(async()=>'fresh')!=='fresh')throw Error('stale read joined');
 rejectOld(Error('old failure'));try{await old;}catch{}
 if(await gate.read(async()=>'newest')!=='newest')throw Error('stale failure imposed backoff');
 if(exports.storageErrorText(Error('AXONIC_STORAGE_FULL secret')).includes('secret'))throw Error('privacy');
 probe.finish('PASS');
}catch(e){probe.finish(String(e));}})();
