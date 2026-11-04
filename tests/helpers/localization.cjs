// Existing UI fixtures isolate React/native dependencies. Keep English defaults
// here; localization.test.cjs exercises the actual catalog and language state.
module.exports=function localization(name){
 if(name.endsWith('/localization/useLanguage'))return {useLanguage:()=>0};
 if(name.endsWith('/localization/language'))return {t:(s,values={})=>s.replace(/\{(\d+)\}/g,(v,k)=>k in values?String(values[k]??''):v),languageSnapshot:()=>0,appLanguage:()=> 'en'};
};
