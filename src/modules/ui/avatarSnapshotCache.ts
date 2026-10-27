/** Bounded derived-avatar cache shared by screens. Clear on avatar changes and
 * account lock/switch; an old asynchronous read must never refill a cleared cache. */
export function createAvatarSnapshotCache(d:{read(owner:string,peer:string):Promise<string|null>;current(owner:string):boolean},limit=128){
 const values=new Map<string,{promise:Promise<string|null>;value?:string|null}>();let epoch=0;
 return {
  clear(){epoch++;values.clear();},
  invalidate(owner:string,peer:string){values.delete(owner+':'+peer);},
  peek(owner:string,peer:string){return d.current(owner)?values.get(owner+':'+peer)?.value:undefined;},
  read(owner:string,peer:string):Promise<string|null>{
   if(!d.current(owner))return Promise.resolve(null);
   const key=owner+':'+peer,existing=values.get(key);if(existing){values.delete(key);values.set(key,existing);return existing.promise;}
   const started=epoch;
   const promise=Promise.resolve().then(()=>d.read(owner,peer)).then(value=>{if(started!==epoch||!d.current(owner)||values.get(key)!==entry)return null;entry.value=value;return value;});
   const entry:{promise:Promise<string|null>;value?:string|null}={promise};
   if(values.size>=limit)values.delete(values.keys().next().value!);values.set(key,entry);
   void promise.catch(()=>{if(values.get(key)===entry)values.delete(key);});return promise;
  },
 };
}
