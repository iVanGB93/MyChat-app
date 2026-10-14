/** Reuse only successful deterministic validation with identical public inputs.
 * Time is part of the key: this never extends expiry or pins an old identity.
 * Store serialized values so a caller cannot mutate a cached admission result.
 */
export function createCallValidationCache<T>(){
 const entries=new Map<string,string>();let characters=0;
 const capacity=256*1024;
 return (raw:string,context:string,now:number,verify:()=>T|null):T|null=>{
  if(typeof raw!=='string'||typeof context!=='string'||!Number.isSafeInteger(now)||now<0)return null;
  // Unusually large contexts still take the normal verification path.
  if(raw.length+context.length>24000)return verify();
  const key=JSON.stringify([raw,context,now]),saved=entries.get(key);
  if(saved!==undefined){entries.delete(key);entries.set(key,saved);return JSON.parse(saved) as T;}
  const result=verify();if(result===null)return null;
  const value=JSON.stringify(result),size=key.length+value.length;
  if(size<=capacity){
   while(entries.size>=64||characters+size>capacity){const oldest=entries.keys().next().value!;characters-=oldest.length+entries.get(oldest)!.length;entries.delete(oldest);}
   entries.set(key,value);characters+=size;
  }
  return result;
 };
}
