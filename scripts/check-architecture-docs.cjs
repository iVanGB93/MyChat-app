// Read-only reference check; never syncs source, changes data or starts devices.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'docs/architecture');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--aon-root'))throw Error('Usage: node scripts/check-architecture-docs.cjs [--aon-root PATH]');
const aon=args.length?path.resolve(root,args[1]):null,failures=[];
let checked=0,hosted=0;
for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.txt')).sort()){
 const content=fs.readFileSync(path.join(dir,name),'utf8');
 for(const match of content.matchAll(/^(File|Test|AoN|Guide): (.+)$/gm)){
  const [,kind,raw]=match,ref=raw.trim();
  const base=kind==='Guide'?dir:kind==='AoN'?aon:root;
  if(kind==='AoN')hosted++;
  if(!base)continue;
  const resolved=path.resolve(base,ref),relative=path.relative(base,resolved);
  if(path.isAbsolute(ref)||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.existsSync(resolved))failures.push(name+': missing/outside '+kind+' '+ref);
  checked++;
 }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Architecture references passed: ${checked} checked; ${aon?'hosted references included':hosted+' hosted references deferred (supply --aon-root)'}. Runtime behavior not tested.`);
