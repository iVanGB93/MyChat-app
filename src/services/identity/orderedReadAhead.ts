/** Bounded read-ahead. Results stay ordered; a failed read stops new requests. */
export function createOrderedReadAhead<T>(count:number,concurrency:number,read:(index:number)=>Promise<T>){
 if(!Number.isSafeInteger(count)||count<1||count>32||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>4)throw Error('Invalid read-ahead bounds');
 let next=0,stopped=false;
 const resolve:((value:PromiseSettledResult<T>)=>void)[]=[];
 const results=Array.from({length:count},(_,i)=>new Promise<PromiseSettledResult<T>>(r=>{resolve[i]=r;}));
 const workers=Array.from({length:Math.min(count,concurrency)},async()=>{
  while(!stopped&&next<count){const index=next++;
   try{resolve[index]({status:'fulfilled',value:await read(index)});}
   catch(reason){stopped=true;resolve[index]({status:'rejected',reason});}
  }
 });
 const drained=Promise.all(workers).then(()=>{while(next<count)resolve[next++]({status:'rejected',reason:Error('Read-ahead stopped')});});
 return {get:(index:number)=>results[index],async stop(){stopped=true;await drained;}};
}
