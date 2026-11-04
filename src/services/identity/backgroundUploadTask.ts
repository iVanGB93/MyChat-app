/** Platform adapter supplies durable observations; a checkpoint alone is not custody evidence. */
export async function runBackgroundUpload(d:{current():boolean;unlocked():boolean;now():number;read():Promise<{pending:number;held:number;percent:number;state?:string}>;start():{stop():void;resume():void;tick?():void};wait():Promise<void>;progress(count:number,percent:number,state?:string):void}){
 let runtime:ReturnType<typeof d.start>|undefined;
 const until=d.now()+19*60*1000;
 let lastProgress='';
 try{
  if(!d.current())return 'stopped';
  if(!d.unlocked())return 'locked';
  runtime=d.start();runtime.resume();
  while(d.current()&&d.now()<until){
   if(!d.unlocked())return 'locked';
   runtime.tick?.();
   const work=await d.read();
   if(!d.current())return 'stopped';
   if(!d.unlocked())return 'locked';
   if(!work.pending)return work.held?'paused':'stored';
   const progressKey=work.pending+':'+work.percent+':'+work.state;
   if(progressKey!==lastProgress){if(work.state===undefined)d.progress(work.pending,work.percent);else d.progress(work.pending,work.percent,work.state);lastProgress=progressKey;}
   await d.wait();
  }
  return d.current()?'paused':'stopped';
 }finally{runtime?.stop();}
}
