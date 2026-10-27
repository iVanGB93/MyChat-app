const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target='node_modules/expo-sqlite/android/src/main/java/expo/modules/sqlite/SQLiteModule.kt';
const edits=[
 ['val databases = cachedDatabases\n    cachedDatabases.clear()', 'val databases = cachedDatabases.toList()\n    cachedDatabases.clear()'],
 ['    OnDestroy {\n      try {\n        removeAllCachedDatabases().forEach {\n          closeDatabase(it)\n        }\n      } catch (_: Throwable) {}\n    }',
  '    OnDestroy {\n      removeAllCachedDatabases().forEach {\n        try { closeDatabase(it) } catch (_: Throwable) {}\n      }\n    }'],
];
function patch(input){
 let original=input.replace(/\r\n/g,'\n');
 for(const [before,after] of [...edits].reverse())original=original.replace(after,before);
 if(crypto.createHash('sha256').update(original).digest('hex')!=='d4197a3729f96c0550698f15b12508dc4b9f83704a59be1ccb965579b8d64b4b')throw Error('SQLite source changed; cleanup patch review required');
 return edits.reduce((s,[before,after])=>s.replace(before,after),original);
}
if(require.main===module){const file=path.resolve(__dirname,'..',target),source=fs.readFileSync(file,'utf8'),next=patch(source);if(source!==next)fs.writeFileSync(file,next);console.log('SQLite reload cleanup ready');}
module.exports={patch,target};
