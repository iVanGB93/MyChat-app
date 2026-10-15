const fs=require('node:fs'),ts=require('typescript'),safety={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/storage/storageReadSafety.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(safety);
module.exports=safety;
