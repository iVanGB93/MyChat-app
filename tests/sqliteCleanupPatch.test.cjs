const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patch,target}=require('../scripts/patch-sqlite-cleanup.cjs');
test('SQLite cleanup snapshots connections before clearing and isolates close failures',()=>{
 const source=fs.readFileSync(target,'utf8'),next=patch(source);
 assert.equal(patch(next),next);
 assert.match(next,/val databases = cachedDatabases\.toList\(\)\s+cachedDatabases.clear\(\)\s+return databases/);
 assert.match(next,/removeAllCachedDatabases\(\).forEach \{\s+try \{ closeDatabase\(it\) \} catch/);
 assert.throws(()=>patch(source+'\n// dependency drift'),/review required/);
});
