import es from './es.json';
export type AppLanguage='en'|'es';
export type LanguagePreference='system'|AppLanguage;
let language:AppLanguage='en';
let preference:LanguagePreference='system';
let revision=0;
const listeners=new Set<()=>void>();
export const languageSnapshot=()=>revision;
export const appLanguage=()=>language;
export const languagePreference=()=>preference;
export const subscribeLanguage=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function resolveLanguage(preference:LanguagePreference,deviceLocale:string):AppLanguage{return preference==='system'?(/^es(?:[-_]|$)/i.test(deviceLocale)?'es':'en'):preference;}
export function applyLanguage(next:LanguagePreference,deviceLocale:string){const resolved=resolveLanguage(next,deviceLocale);if(preference===next&&language===resolved)return;preference=next;language=resolved;revision++;for(const listener of listeners)listener();}
const catalog=es as Record<string,string>;
const normalized=new Map(Object.entries(catalog).map(([key,value])=>[key.toLocaleLowerCase('en'),value]));
/** Only app-authored presentation strings belong here. Never translate chat content,
 * names, recovery words, protocol tokens or persisted message payloads. */
export function t(source:string,values:Record<string,string|number|null|undefined>={}){
 let result=source;
 if(language==='es'){
  result=catalog[source]??normalized.get(source.toLocaleLowerCase('en'))??source;
  if(source===source.toLocaleUpperCase('en')&&/[A-Z]/.test(source))result=result.toLocaleUpperCase('es');
 }
 return result.replace(/\{(\d+)\}/g,(token,key)=>key in values?String(values[key]??''):token);
}
