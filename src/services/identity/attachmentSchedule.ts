import type {AttachmentJob} from './attachmentTransfer.ts';
/** No queued work means no clock. Blocked/disconnected jobs only need expiry. */
export function attachmentWorkDelay(jobs:AttachmentJob[],now:number,canRun:(job:AttachmentJob)=>boolean){
 let delay=Infinity;
 for(const job of jobs)if(!['complete','expired','cancelled'].includes(job.phase)){
  delay=Math.min(delay,Math.max(200,job.descriptor.manifest.expires-now));
  if(canRun(job))delay=Math.min(delay,Math.max(500,job.next-now));
 }
 return delay;
}
