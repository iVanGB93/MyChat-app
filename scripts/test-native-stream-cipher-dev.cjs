const fs=require('node:fs'),{createDevSession,run}=require('./test-two-phone-dev.cjs');
async function main(){
 const t=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).find(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('SM-S948U1'));if(!t)throw Error('Open Dev');const s=createDevSession(t);await s.call('Runtime.enable');
 try{const result=await run(s,`
 const native=get('modules/axonic-nearby/index.ts').default,create=get('src/services/identity/wssStreamCipher.ts').createWssStreamCipher;
 if(!native?.attachmentStreamSeal||!native?.attachmentStreamOpen)throw Error('Native cipher unavailable');
 const crypto={seal:(...args)=>native.attachmentStreamSeal(...args),open:(...args)=>native.attachmentStreamOpen(...args)};
 const input={key:'01'.repeat(32),digest:'02'.repeat(32),id:'03'.repeat(32),salt:new Uint8Array(16).fill(4),role:'send'};
 const reference=create(input),fast=create({...input,crypto}),receiver=create({...input,salt:new Uint8Array(16).fill(5),role:'receive',crypto});
 const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);let records=0,rejected=0;const started=performance.now();
 for(const value of ['ready',new Uint8Array(1).fill(9),new Uint8Array(8192).fill(10),new Uint8Array(32768).fill(11),'complete']){
  const expected=reference.sealBinary(value),actual=fast.sealBinary(value);if(!eq(expected,actual))throw Error('Native ciphertext differs');
  const bad=actual.slice();bad[bad.length-1]^=1;try{receiver.openBinary(bad);throw Error('Tamper accepted');}catch(e){if(String(e).includes('Tamper accepted'))throw e;rejected++;}
  const plain=receiver.openBinary(actual);if(typeof value==='string'?plain!==value:!eq(new Uint8Array(plain),value))throw Error('Plaintext differs');
  try{receiver.openBinary(actual);throw Error('Replay accepted');}catch(e){if(String(e).includes('Replay accepted'))throw e;rejected++;}records++;
 }
 // Actual bridge must copy inputs: native erasure cannot zero JS key/nonce state.
 const key=new Uint8Array(32).fill(7),nonce=new Uint8Array(24).fill(8),aad=new TextEncoder().encode(JSON.stringify(['axonic-wss-stream-v1','fixture'])),plain=new Uint8Array(33).fill(9);
 crypto.seal(key,nonce,aad,plain);if(!key.every(x=>x===7)||!nonce.every(x=>x===8)||!plain.every(x=>x===9))throw Error('Bridge mutated input');
 reference.close();fast.close();receiver.close();return {native:true,records,rejected,inputPreserved:true,milliseconds:performance.now()-started};
 `);fs.writeFileSync('builds/native-stream-phone-parity.json',JSON.stringify(result,null,2));console.log(result);}finally{s.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
