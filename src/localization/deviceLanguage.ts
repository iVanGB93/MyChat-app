import {AppState,NativeModules,Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {applyLanguage,languagePreference,type LanguagePreference} from './language';
const KEY='@axonic_language_preference';
export function deviceLocale():string{
 try{
  if(Platform.OS==='android'){const module=NativeModules.I18nManager;const locale=module?.getConstants?.().localeIdentifier??module?.localeIdentifier;if(typeof locale==='string')return locale;}
  const settings=NativeModules.SettingsManager?.getConstants?.().settings??NativeModules.SettingsManager?.settings;
  const locale=settings?.AppleLanguages?.[0]??settings?.AppleLocale;if(typeof locale==='string')return locale;
  return Intl.DateTimeFormat().resolvedOptions().locale;
 }catch{return 'en';}
}
let loaded:Promise<void>|undefined,writes=Promise.resolve();
applyLanguage('system',deviceLocale());
export function initializeLanguage(){return loaded??=AsyncStorage.getItem(KEY).then(value=>{applyLanguage(value==='en'||value==='es'?value:'system',deviceLocale());}).catch(()=>{});}
export async function setLanguagePreference(value:LanguagePreference){
 // Serialize rapid taps so an older storage write cannot win after a newer one.
 const saved=writes.then(()=>AsyncStorage.setItem(KEY,value));writes=saved.catch(()=>{});await saved;applyLanguage(value,deviceLocale());
}
export function observeDeviceLanguage(){const sub=AppState.addEventListener('change',state=>{if(state==='active')applyLanguage(languagePreference(),deviceLocale());});return()=>sub.remove();}
