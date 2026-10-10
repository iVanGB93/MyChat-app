type Stage='prepare'|'network'|'checkpoint'|'readFile'|'writeFile'|'verifyFile'|'receipt'|'chat';
/** Local aggregate timings only: never accepts identities, filenames, payloads or keys. */
export function createAttachmentTiming(enabled:boolean,now:()=>number=Date.now){
 const rows=new Map<Stage,{calls:number;milliseconds:number;maximum:number;errors:number}>();
 return {
  async measure<T>(stage:Stage,work:()=>Promise<T>):Promise<T>{
   if(!enabled)return work();
   const start=now();let failed=false;
   try{return await work();}catch(error){failed=true;throw error;}
   finally{
    const elapsed=Math.max(0,now()-start),row=rows.get(stage)??{calls:0,milliseconds:0,maximum:0,errors:0};
    row.calls++;row.milliseconds+=elapsed;row.maximum=Math.max(row.maximum,elapsed);if(failed)row.errors++;
    rows.set(stage,row);
   }
  },
  snapshot(){return Object.fromEntries([...rows].map(([stage,row])=>[stage,{...row}]));},
 };
}
