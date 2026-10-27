import type {AttachmentJobStore} from './attachmentTransferPorts';
import {retiredAttachment} from './retiredAttachment';
import {attachmentChanged} from './attachmentChanges';
import * as SQLite from 'expo-sqlite';
import {validAccountId} from './identityProtocol';
import {validAttachmentJob,type AttachmentJob} from './attachmentTransfer';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,writing:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
// Shared by journal instances: a durable change, rather than elapsed idle time,
// invalidates maintenance observations. Process restart always scans afresh.
const revisions=new Map<string,number>();
const revision=(owner:string)=>revisions.get(owner)??0;
const changed=(owner:string)=>revisions.set(owner,revision(owner)+1);
const activeFormat="COALESCE(json_extract(raw,'$.descriptor.manifest.version'),0) NOT IN (1,2,3)";
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
type JobProgress={owner:string;id:string;phase:AttachmentJob['phase'];cursor:number;bytes:number;failures:number;digest:string;canPause:boolean};
const progressListeners=new Set<(progress:JobProgress)=>void>();
export function subscribeAttachmentJobProgress(listener:(progress:JobProgress)=>void){progressListeners.add(listener);return()=>{progressListeners.delete(listener);};}
function publishProgress(job:AttachmentJob){const progress:JobProgress={owner:job.owner,id:job.descriptor.manifest.id,phase:job.phase,cursor:job.cursor,bytes:job.descriptor.manifest.bytes,failures:job.failures,digest:job.digest,canPause:!job.receipt&&['queued','uploading','downloading'].includes(job.phase)};
 for(const listener of progressListeners)try{listener(progress);}catch{/* Observers cannot invalidate a committed checkpoint. */}}
function db(){return opening??=SQLite.openDatabaseAsync('axonic_own_attachment_jobs_v1.db',{useNewConnection:true}).then(async database=>{
 await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(owner TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest)); CREATE TABLE IF NOT EXISTS finished_jobs(owner TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest));');return database;
}).catch(error=>{opening=undefined;throw error;});}
/** Called only inside the shared write queue. This private connection is never used
 * by readers, so withTransactionAsync cannot capture an unrelated read/write.
 * Reuse it instead of opening and closing a connection for every 4-KiB checkpoint. */
type JournalMeasure=<T>(stage:'checkpointQueue'|'checkpointTransaction'|'checkpointPublish'|'checkpointWrite'|'checkpointCount'|'checkpointReady'|'checkpointBody'|'checkpointBegin'|'checkpointCommit'|'checkpointRollback',work:()=>Promise<T>)=>Promise<T>;
const unmeasured:JournalMeasure=(_stage,work)=>work();
async function transaction(work:(tx:SQLite.SQLiteDatabase)=>Promise<void>,measure:JournalMeasure=unmeasured){
 const writer=await measure('checkpointReady',async()=>{
 await db();
 return await(writing??=SQLite.openDatabaseAsync('axonic_own_attachment_jobs_v1.db',{useNewConnection:true})
  .catch(error=>{writing=undefined;throw error;}));
 });
 // Same BEGIN/work/COMMIT/ROLLBACK sequence as Expo's transaction helper.
 // Explicit phases distinguish durable commit time from query/JS work.
 try{
  await measure('checkpointBegin',()=>writer.execAsync('BEGIN'));
  await measure('checkpointBody',()=>work(writer));
  await measure('checkpointCommit',()=>writer.execAsync('COMMIT'));
 }catch(error){await measure('checkpointRollback',()=>writer.execAsync('ROLLBACK'));throw error;}
}
function parse(row:{raw:string;revision:number}|null){
 if(!row)return null;if(row.raw.length>10000)throw Error('Invalid attachment job');const job=JSON.parse(row.raw);
 if(retiredAttachment(job?.descriptor))return null;
 if(!validAttachmentJob(job)||job.revision!==row.revision)throw Error('Invalid attachment job');return job as AttachmentJob;
}
/** Private own-transfer journal. Public custodians never see file keys or this database. */
export function createMobileAttachmentJobs(now:()=>number=Date.now,
 measure:JournalMeasure=unmeasured):AttachmentJobStore {
 let retiredOwner:string|null=null,retiredRevision=-1,retireAfter=0;
 function observed(owner:string,jobs:AttachmentJob[]){retiredOwner=owner;retiredRevision=revision(owner);retireAfter=jobs.reduce((at,j)=>Math.min(at,j.descriptor.manifest.expires),Infinity);}
 return {
  async retire(owner,current){
   if(!validAccountId(owner))throw Error('Invalid attachment owner');if(retiredOwner===owner&&retiredRevision===revision(owner)&&now()<retireAfter)return;
   const work=tail.then(async()=>{if(!current())return;
    if(retiredOwner===owner&&retiredRevision===revision(owner)&&now()<retireAfter)return;
    // Most startups have no retirement work. Check the bounded active queue on
    // the WAL reader before opening a writer/transaction or counting history.
    // Keep this inside the write queue; actual retirement rechecks in its transaction.
    const rows=await(await db()).getAllAsync<{raw:string;revision:number}>(`SELECT raw,revision FROM jobs WHERE owner=? AND ${activeFormat} LIMIT 129`,owner);
    const jobs=rows.map(r=>parse(r)).filter((j):j is AttachmentJob=>j!==null);
    if(jobs.length>128||jobs.some(j=>j.owner!==owner))throw Error('Invalid attachment jobs');
    if(!current())return;
    if(!jobs.some(j=>j.phase==='complete'||j.phase==='expired'||j.descriptor.manifest.expires<=now())){
     observed(owner,jobs);return;
    }
    await transaction(async tx=>{
    const rows=await tx.getAllAsync<{raw:string;revision:number}>(`SELECT raw,revision FROM jobs WHERE owner=? AND ${activeFormat} LIMIT 129`,owner);
    const jobs=rows.map(r=>parse(r)).filter((j):j is AttachmentJob=>j!==null);if(jobs.length>128||jobs.some(j=>j.owner!==owner))throw Error('Invalid attachment jobs');
    const finished=jobs.filter(j=>j.phase==='complete'||j.phase==='expired'||j.descriptor.manifest.expires<=now()).map(j=>j.phase==='complete'||j.phase==='expired'?j:{...j,phase:'expired' as const,revision:j.revision+1});
    const count=await tx.getFirstAsync<{n:number}>(`SELECT COUNT(*) AS n FROM finished_jobs WHERE owner=? AND ${activeFormat}`,owner);
    if((count?.n??5000)+finished.length>5000)throw Error('Attachment history is full');
    for(const j of finished){await tx.runAsync('INSERT INTO finished_jobs(owner,digest,revision,raw) VALUES(?,?,?,?)',owner,j.digest,j.revision,JSON.stringify(j));await tx.runAsync('DELETE FROM jobs WHERE owner=? AND digest=?',owner,j.digest);}
    if(!current())throw Error('Attachment account locked');
   });changed(owner);observed(owner,jobs.filter(j=>j.phase!=='complete'&&j.phase!=='expired'&&j.descriptor.manifest.expires>now()));});tail=work.catch(()=>{});await work;
  },
  async get(owner,digest){if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid attachment owner');
   // One indexed checkpoint (<=10 KiB), on the separate WAL reader. Avoid four
   // asynchronous bridge round trips for every cancellation/revision check.
   // Bulk listing and durable writes stay asynchronous to keep UI work bounded.
   const job=parse((await db()).getFirstSync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? AND digest=? UNION ALL SELECT raw,revision FROM finished_jobs WHERE owner=? AND digest=?',owner,digest,owner,digest));
   if(job&&(job.owner!==owner||job.digest!==digest))throw Error('Attachment owner mismatch');return job;
  },
  async isCurrent(owner,digest,revision){
   if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(revision)||revision<0)return false;
   // The worker already validated the descriptor. All journal writes are CAS
   // updates with a new revision, including pause/receipt/expiry. Read the WAL
   // on every check, but avoid copying, parsing and hashing the whole descriptor.
   // Archived rows cannot be active; no second lookup is needed.
   const row=(await db()).getFirstSync<{revision:number;phase:string}>("SELECT revision,json_extract(raw,'$.phase') AS phase FROM jobs WHERE owner=? AND digest=?",owner,digest);
   return !!row&&row.revision===revision&&['queued','uploading','downloading','confirming'].includes(row.phase);
  },
  async list(owner){if(!validAccountId(owner))throw Error('Invalid attachment owner');
   const rows=await(await db()).getAllAsync<{raw:string;revision:number}>(`SELECT raw,revision FROM jobs WHERE owner=? AND ${activeFormat} LIMIT 129`,owner);
   const jobs=rows.map(r=>parse(r)).filter((j):j is AttachmentJob=>j!==null);if(jobs.length>128||jobs.some(j=>j.owner!==owner))throw Error('Invalid attachment jobs');return jobs;
  },
  save(job,expected,current){
   const next=clone(job);if(!validAttachmentJob(next)||next.revision!==(expected===null?0:expected+1)||JSON.stringify(next).length>10000)return Promise.resolve(false);
   const work=measure('checkpointQueue',()=>tail).then(async()=>{let saved=false,maintenanceChanged=false;if(!current())return false;
    await measure('checkpointTransaction',()=>transaction(async tx=>{
     // Bounded indexed metadata read on the private transaction connection.
     // Avoid an extra native scheduling turn; durable writes remain asynchronous.
     const previousRow=tx.getFirstSync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? AND digest=? UNION ALL SELECT raw,revision FROM finished_jobs WHERE owner=? AND digest=?',next.owner,next.digest,next.owner,next.digest);
     if(previousRow&&retiredAttachment(JSON.parse(previousRow.raw)?.descriptor))return;
     const previous=parse(previousRow);
     if((previous?.revision??null)!==expected||!current())return;
     if(previous&&(previous.owner!==next.owner||previous.digest!==next.digest||previous.direction!==next.direction||JSON.stringify(previous.descriptor)!==JSON.stringify(next.descriptor)))return;
     if(previous&&['complete','expired'].includes(previous.phase)&&next.phase!==previous.phase)return;
     const finished=next.phase==='complete'||next.phase==='expired',table=finished?'finished_jobs':'jobs',limit=finished?5000:128;
     if(!previous||finished){// Only the capacity threshold matters. Bound the indexed read and avoid
     // native scheduling turns while holding the private write transaction.
     const count=await measure('checkpointCount',async()=>tx.getFirstSync<{n:number}>(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} WHERE owner=? AND ${activeFormat} LIMIT ${limit})`,next.owner));
      if((count?.n??limit)>=limit&&(!finished||!tx.getFirstSync<{revision:number}>('SELECT revision FROM finished_jobs WHERE owner=? AND digest=?',next.owner,next.digest)))return;}
     await measure('checkpointWrite',()=>tx.runAsync(`INSERT INTO ${table}(owner,digest,revision,raw) VALUES(?,?,?,?) ON CONFLICT(owner,digest) DO UPDATE SET revision=excluded.revision,raw=excluded.raw`,next.owner,next.digest,next.revision,JSON.stringify(next)));
     if(finished)await measure('checkpointWrite',()=>tx.runAsync('DELETE FROM jobs WHERE owner=? AND digest=?',next.owner,next.digest));
     if(!current())throw Error('Attachment account locked');maintenanceChanged=!previous||finished;saved=true;
    },measure));if(saved){if(maintenanceChanged)changed(next.owner);await measure('checkpointPublish',async()=>{publishProgress(next);attachmentChanged();});}return saved;
   });tail=work.catch(()=>{});return work;
  },
 };
}
