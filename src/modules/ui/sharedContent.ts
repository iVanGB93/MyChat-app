export type SharedItem = {text:string} | {uri:string;name:string;mime:string;caption?:string};
export function sharedItems(input:{text?:string|null;webUrl?:string|null;files?:{path:string;fileName:string;mimeType:string;size?:number|null}[]|null}):SharedItem[]{
 const files=input.files??[];
 if(files.length>4)throw Error('Share up to four files at a time.');
 for(const f of files)if(!/^(file|content):\/\//i.test(f.path)||f.size!=null&&(f.size<1||f.size>250*1024*1024))throw Error('Choose local files between 1 byte and 250 MiB.');
 const text=input.text?.trim()||input.webUrl?.trim()||'';
 const items:SharedItem[]=text?[{text}]:[];
 for(const f of files)items.push({uri:f.path,name:f.fileName||'Attachment',mime:f.mimeType||'application/octet-stream'});
 if(!items.length)throw Error('There is no supported content to share.');
 return items;
}
/** Advances only after durable enqueue. Retries cannot repeat completed items or change recipient/account. */
export function sharedBatch(items:SharedItem[]){
 let next=0,busy=false,binding:{owner:string;target:string}|undefined;
 return {get completed(){return next;},get target(){return binding?.target;},get busy(){return busy;},
 async send(owner:string,target:string,current:()=>boolean,enqueue:(item:SharedItem)=>Promise<unknown>){
  if(busy)return false;
  if(binding&&(binding.owner!==owner||binding.target!==target))throw Error('Continue with the original account and conversation, or cancel.');
  if(!current())throw Error('Unlock your account to continue.');
  binding={owner,target};busy=true;
  try{while(next<items.length){if(!current())throw Error('Unlock your account to continue.');await enqueue(items[next]);next++;}return true;}finally{busy=false;}
 }};
}
