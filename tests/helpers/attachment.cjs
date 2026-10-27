const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),crypto=require('crypto');
const cache=new Map();function load(n){if(cache.has(n))return cache.get(n);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+n+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(x=>x==='expo'?{requireOptionalNativeModule:()=>null}:x==='react-native'?{Platform:{OS:'test'}}:x.startsWith('./')?load(x.slice(2).replace(/\.ts$/,'')):require(x),out);cache.set(n,out);return out;}
const p=load('identityProtocol'),a=load('attachmentProtocol'),random=n=>new Uint8Array(crypto.randomBytes(n)),now=1800000000000;
function fixture(size=9001){const ids=[0,1,2].map(()=>{const signingSeed=random(32),encryptionSeed=random(32),device=p.publicDevice(signingSeed,encryptionSeed);return {signingSeed,device,record:p.issueRecord(random(32),[device],now)};});
 const key=random(32),signer=random(32),plain=random(size),checksum=crypto.createHash('sha256').update(plain).digest('hex'),fields={version:4,id:Buffer.from(random(32)).toString('hex'),sender:ids[0].record.account,senderDevice:ids[0].device.id,recipient:ids[1].record.account,recipientDevice:ids[1].device.id,created:now,expires:now+a.ATTACHMENT_TTL-30000,bytes:size,checksum:a.attachmentChecksumCommitment(checksum,Buffer.from(key).toString('hex'))};
 const encrypted=[];for(let i=0;i<Math.ceil(size/a.ATTACHMENT_STREAM_BLOCK_BYTES);i++)encrypted.push(a.encryptAttachmentChunk(fields,i,plain.slice(i*a.ATTACHMENT_STREAM_BLOCK_BYTES,(i+1)*a.ATTACHMENT_STREAM_BLOCK_BYTES),key));
 const manifest=a.signAttachmentManifest({...fields,root:a.attachmentBlockPublicKey(signer)},ids[0].signingSeed,ids[0].record,now);
 const chunks=encrypted.map((ciphertext,index)=>a.signAttachmentBlock(manifest,index,ciphertext,signer));return {ids,key,signer,plain,manifest,chunks};}

module.exports={load,fixture,now};
