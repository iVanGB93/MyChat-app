/** Bounded derived-avatar cache shared by screens. Clear on avatar changes and
 * account lock/switch; an old asynchronous read must never refill a cleared cache. */
export function createAvatarSnapshotCache(d:{read(owner:string,peer:string):Promise<string|null>;current(owner:string):boolean},limit=128){
 const values=new Map<string,Promise<string|null>>();let epoch=0;
 return {
  clear(){epoch++;values.clear();},
  read(owner:string,peer:string):Promise<string|null>{
   if(!d.current(owner))return Promise.resolve(null);
   const key=owner+':'+peer,existing=values.get(key);if(existing){values.delete(key);values.set(key,existing);return existing;}
   const started=epoch;
   const promise=Promise.resolve().then(()=>d.read(owner,peer)).then(value=>started===epoch&&d.current(owner)?value:null);
   if(values.size>=limit)values.delete(values.keys().next().value!);values.set(key,promise);
   void promise.catch(()=>{if(values.get(key)===promise)values.delete(key);});return promise;
  },
 };
}
