/** Progress means a new authenticated connection or admission milestone, not a retry. */
export function createMessageNotificationDeadline(now=Date.now){
 const started=now();let lastProgress=started;
 const milestones=new Set<string>();
 return {
  progress(milestone:string){if(milestones.has(milestone)||milestones.size>=16)return;milestones.add(milestone);lastProgress=now();},
  remaining(){return Math.max(0,Math.min(started+10000,lastProgress+3000)-now());},
 };
}
