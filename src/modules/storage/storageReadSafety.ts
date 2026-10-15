export type StorageReason='backup_unavailable'|'storage_full'|'history_too_large'|'storage_corrupt'|'storage_busy'|'account_locked'|'storage_unavailable';
export function storageReason(error:unknown):StorageReason{
 const message=String((error as {message?:unknown})?.message??'');
 if(/AXONIC_BACKUP|snapshot/i.test(message))return 'backup_unavailable';
 if(/AXONIC_STORAGE_FULL|SQLiteFull|SQLITE_FULL|database or disk is full/i.test(message))return 'storage_full';
 if(/AXONIC_HISTORY_TOO_LARGE|CursorWindow|SQLiteBlobTooBig/i.test(message))return 'history_too_large';
 if(/AXONIC_STORAGE_CORRUPT|AXONIC_STORAGE_SCHEMA|needs recovery|malformed|not a database/i.test(message))return 'storage_corrupt';
 if(/SQLITE_BUSY|database is locked|SQLiteDatabaseLocked/i.test(message))return 'storage_busy';
 if(/Unlock your account/i.test(message))return 'account_locked';
 return 'storage_unavailable';
}
const descriptions:Record<StorageReason,string>={backup_unavailable:'Could not verify a safety backup.',storage_full:'Storage is full or too little free space remains.',history_too_large:'Chat history exceeds the supported storage limit.',storage_corrupt:'Saved data needs recovery; automatic reset is disabled.',storage_busy:'Chat storage is busy.',account_locked:'Unlock your account to load chats.',storage_unavailable:'Chat storage is temporarily unavailable.'};
export const storageErrorText=(error:unknown)=>descriptions[storageReason(error)]+' Saved data was not replaced. Retrying with backoff.';
export const storageRetryDelay=(failures:number)=>Math.min(60000,2000*2**Math.min(5,Math.max(0,failures-1)));
/** One gate per owner, shared across UI and background reads; no timers or raw-error logging. */
export function createStorageReadGate(now=Date.now){
 let failures=0,until=0,last:unknown,flight:Promise<string|null>|undefined,generation=0;
 return {invalidate(){generation++;flight=undefined;failures=0;until=0;last=undefined;},read(work:()=>Promise<string|null>):Promise<string|null>{
  if(flight)return flight;
  if(now()<until)return Promise.reject(last);
  const started=generation;
  const next=Promise.resolve().then(work).then(value=>{if(started===generation){failures=0;until=0;last=undefined;}return value;},error=>{if(started===generation){last=error;until=now()+storageRetryDelay(++failures);}throw error;});
  flight=next;void next.finally(()=>{if(flight===next)flight=undefined;}).catch(()=>{});return next;
 }};
}
