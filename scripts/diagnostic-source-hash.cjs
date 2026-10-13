const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=function(root){
 const hash=createHash('sha256'),files=[];
 function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+e.name;if(e.isDirectory())walk(name);else if(/\.(ts|tsx)$/.test(name))files.push(name);}}
 walk('src');files.push('index.ts','package-lock.json');
 for(const file of files.sort()){hash.update(file);hash.update('\0');hash.update(fs.readFileSync(path.join(root,file)));}
 return hash.digest('hex');
};
