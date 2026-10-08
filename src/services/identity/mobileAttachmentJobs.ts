import * as SQLite from 'expo-sqlite';
import {validAccountId} from './identityProtocol';
import {validAttachmentJob,type AttachmentJob,type AttachmentJobStore} from './attachmentTransfer';
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function db(){return opening??=SQLite.openDatabaseAsync('axonic_own_attachment_jobs_v1.db',{useNewConnection:true}).then(async database=>{
 await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(owner TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest)); CREATE TABLE IF NOT EXISTS finished_jobs(owner TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,digest));');return database;
}).catch(error=>{opening=undefined;throw error;});}
function parse(row:{raw:string;revision:number}|null){
 if(!row)return null;if(row.raw.length>10000)throw Error('Invalid attachment job');const job=JSON.parse(row.raw);
 if(!validAttachmentJob(job)||job.revision!==row.revision)throw Error('Invalid attachment job');return job as AttachmentJob;
}
/** Private own-transfer journal. Public custodians never see file keys or this database. */
export function createMobileAttachmentJobs(now:()=>number=Date.now):AttachmentJobStore {
 let retiredOwner:string|null=null,retireAfter=0;
 return {
  async retire(owner,current){
   if(!validAccountId(owner))throw Error('Invalid attachment owner');if(retiredOwner===owner&&now()<retireAfter)return;
   const work=tail.then(async()=>{if(!current())return;await(await db()).withExclusiveTransactionAsync(async tx=>{
    const rows=await tx.getAllAsync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? LIMIT 129',owner);
    const jobs=rows.map(r=>parse(r)!);if(jobs.length>128||jobs.some(j=>j.owner!==owner))throw Error('Invalid attachment jobs');
    const finished=jobs.filter(j=>j.phase==='complete'||j.phase==='expired'||j.descriptor.manifest.expires<=now()).map(j=>j.phase==='complete'||j.phase==='expired'?j:{...j,phase:'expired' as const,revision:j.revision+1});
    const count=await tx.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM finished_jobs WHERE owner=?',owner);
    if((count?.n??5000)+finished.length>5000)throw Error('Attachment history is full');
    for(const j of finished){await tx.runAsync('INSERT INTO finished_jobs(owner,digest,revision,raw) VALUES(?,?,?,?)',owner,j.digest,j.revision,JSON.stringify(j));await tx.runAsync('DELETE FROM jobs WHERE owner=? AND digest=?',owner,j.digest);}
    if(!current())throw Error('Attachment account locked');
   });retiredOwner=owner;retireAfter=now()+60000;});tail=work.catch(()=>{});await work;
  },
  async get(owner,digest){if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid attachment owner');
   const job=parse(await(await db()).getFirstAsync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? AND digest=? UNION ALL SELECT raw,revision FROM finished_jobs WHERE owner=? AND digest=?',owner,digest,owner,digest));
   if(job&&(job.owner!==owner||job.digest!==digest))throw Error('Attachment owner mismatch');return job;
  },
  async list(owner){if(!validAccountId(owner))throw Error('Invalid attachment owner');
   const rows=await(await db()).getAllAsync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? LIMIT 129',owner);
   const jobs=rows.map(r=>parse(r)!);if(jobs.length>128||jobs.some(j=>j.owner!==owner))throw Error('Invalid attachment jobs');return jobs;
  },
  save(job,expected,current){
   const next=clone(job);if(!validAttachmentJob(next)||next.revision!==(expected===null?0:expected+1)||JSON.stringify(next).length>10000)return Promise.resolve(false);
   const work=tail.then(async()=>{let saved=false;if(!current())return false;
    await(await db()).withExclusiveTransactionAsync(async tx=>{
     const previous=parse(await tx.getFirstAsync<{raw:string;revision:number}>('SELECT raw,revision FROM jobs WHERE owner=? AND digest=? UNION ALL SELECT raw,revision FROM finished_jobs WHERE owner=? AND digest=?',next.owner,next.digest,next.owner,next.digest));
     if((previous?.revision??null)!==expected||!current())return;
     if(previous&&(previous.owner!==next.owner||previous.digest!==next.digest||previous.direction!==next.direction||JSON.stringify(previous.descriptor)!==JSON.stringify(next.descriptor)))return;
     if(previous&&['complete','expired'].includes(previous.phase)&&next.phase!==previous.phase)return;
     const finished=next.phase==='complete'||next.phase==='expired',table=finished?'finished_jobs':'jobs',limit=finished?5000:128;
     if(!previous||finished){const count=await tx.getFirstAsync<{n:number}>(`SELECT COUNT(*) AS n FROM ${table} WHERE owner=?`,next.owner);
      if((count?.n??limit)>=limit&&(!finished||!await tx.getFirstAsync<{revision:number}>('SELECT revision FROM finished_jobs WHERE owner=? AND digest=?',next.owner,next.digest)))return;}
     await tx.runAsync(`INSERT INTO ${table}(owner,digest,revision,raw) VALUES(?,?,?,?) ON CONFLICT(owner,digest) DO UPDATE SET revision=excluded.revision,raw=excluded.raw`,next.owner,next.digest,next.revision,JSON.stringify(next));
     if(finished)await tx.runAsync('DELETE FROM jobs WHERE owner=? AND digest=?',next.owner,next.digest);
     if(!current())throw Error('Attachment account locked');saved=true;
    });return saved;
   });tail=work.catch(()=>{});return work;
  },
 };
}
