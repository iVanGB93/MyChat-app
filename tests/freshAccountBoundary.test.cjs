const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

test('fresh-account runtime cannot load legacy login, history or migration adapters',()=>{
 const seen=new Set();
 function walk(file){
  if(seen.has(file))return;
  seen.add(file);
  const source=fs.readFileSync(file,'utf8');
  for(const item of ts.preProcessFile(source).importedFiles){
   if(!item.fileName.startsWith('.'))continue;
   const base=path.resolve(path.dirname(file),item.fileName);
   const next=[base+'.ts',base+'.tsx',path.join(base,'index.ts'),path.join(base,'index.tsx')].find(p=>fs.existsSync(p));
   if(next)walk(next);
  }
 }
 walk(path.resolve('src/screens/LocalAccountApp.tsx'));
 const forbidden=['localAccountMigration.ts','legacyHistoryArchive.ts','localMessageStore.ts','AuthContext.tsx','api.ts','legacyEntry.ts'];
 for(const file of seen)assert.ok(!forbidden.includes(path.basename(file)), 'Fresh account depends on '+file);
});
