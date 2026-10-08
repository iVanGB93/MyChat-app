const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),crypto=require('crypto');
const cache=new Map();function load(n){if(cache.has(n))return cache.get(n);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+n+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(x=>x.startsWith('./')?load(x.slice(2).replace(/\.ts$/,'')):require(x),out);cache.set(n,out);return out;}
const p=load('identityProtocol'),a=load('attachmentProtocol'),random=n=>new Uint8Array(crypto.randomBytes(n)),now=1800000000000;
function fixture(size=9001){const ids=[0,1,2].map(()=>{const signingSeed=random(32),encryptionSeed=random(32),device=p.publicDevice(signingSeed,encryptionSeed);return {signingSeed,device,record:p.issueRecord(random(32),[device],now)};});
 const key=random(32),plain=random(size),fields={version:1,id:Buffer.from(random(32)).toString('hex'),sender:ids[0].record.account,senderDevice:ids[0].device.id,recipient:ids[1].record.account,recipientDevice:ids[1].device.id,created:now,expires:now+a.ATTACHMENT_TTL-30000,bytes:size};
 const encrypted=[];for(let i=0;i<Math.ceil(size/a.ATTACHMENT_CHUNK_BYTES);i++)encrypted.push(a.encryptAttachmentChunk(fields,i,plain.slice(i*a.ATTACHMENT_CHUNK_BYTES,(i+1)*a.ATTACHMENT_CHUNK_BYTES),key));
 const tree=a.buildAttachmentTree(encrypted.map((value,i)=>a.attachmentLeaf(i,value))),manifest=a.signAttachmentManifest({...fields,root:tree.root},ids[0].signingSeed,ids[0].record,now);
 const chunks=encrypted.map((ciphertext,index)=>({index,ciphertext,proof:tree.proof(index)}));return {ids,key,plain,manifest,chunks};}

module.exports={load,fixture,now};
