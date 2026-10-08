export type StickerDraft={id:string;uri:string;name:string};
export type StickerDraftStorage={load():Promise<StickerDraft|null>;replace(uri:string,name?:string):Promise<StickerDraft>;rename(id:string,name:string):Promise<void>;clear(id:string):Promise<void>};

/** Serialize edits; a stale editor can never clear a newer selection. */
export function createStickerDraftStore(d:{read():Promise<StickerDraft|null>;write(value:StickerDraft|null):Promise<void>;stage(uri:string):{id:string;uri:string};remove(draft:StickerDraft):void;current():boolean}):StickerDraftStorage{
 let tail:Promise<unknown>=Promise.resolve();
 const run=<T>(work:()=>Promise<T>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
 const check=()=>{if(!d.current())throw Error('Account changed. Reopen your sticker editor.');};
 return {
  load:()=>run(async()=>{check();const draft=await d.read();check();return draft;}),
  replace(uri,name=''){
   check();const staged={...d.stage(uri),name:name.slice(0,80)};
   return run(async()=>{let committed=false;try{check();const previous=await d.read();check();await d.write(staged);committed=true;if(previous)d.remove(previous);return staged;}finally{if(!committed)d.remove(staged);}});
  },
  rename:(id,name)=>run(async()=>{check();const draft=await d.read();check();if(draft?.id===id)await d.write({...draft,name:name.slice(0,80)});}),
  clear:id=>run(async()=>{check();const draft=await d.read();check();if(draft?.id===id){await d.write(null);d.remove(draft);}}),
 };
}
