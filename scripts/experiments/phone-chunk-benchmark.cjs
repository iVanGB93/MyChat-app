// Injected only into an unlocked com.axonic.dev debugger by the companion runner.
// Synthetic identities/files; no account keys, chat writes or production peers.
module.exports=async function phoneChunkBenchmark(input,get,find,account){
 if(typeof __DEV__==='undefined'||!__DEV__||account.status().state!=='unlocked')throw Error('Dev-only benchmark');
 const owner=account.status().account,fs=find(/expo-file-system.*index\.(ts|js)$/),native=get('modules/axonic-nearby/index.ts').default;
 const sha=get('node_modules/@noble/hashes/sha2.js').sha256,utils=get('node_modules/@noble/hashes/utils.js');
 const identity=get('src/services/identity/identityProtocol.ts'),a={},b={};
 const requireLocal=n=>n==='./identityProtocol.ts'?identity:n==='./attachmentProtocol.ts'?a:n.startsWith('@')?get('node_modules/'+n):find(new RegExp(n+'/index\\.js$'));
 new Function('require','exports',input.codec.protocol)(requireLocal,a);
 new Function('require','exports',input.codec.batch)(requireLocal,b);
 const key=utils.hexToBytes(input.key),recipientSeed=utils.hexToBytes(input.recipientSeed),senderSeed=utils.hexToBytes(input.senderSeed);
 const pause=()=>new Promise(r=>setTimeout(r,0));
 const live=()=>{if(globalThis.__actualChunkExperiment?.cancelled)throw Error('Synthetic experiment cancelled');if(account.status().state!=='unlocked'||account.status().account!==owner)throw Error('Dev account changed');};
 const leaf=input.nativeLeaf?value=>native.attachmentSha256(value):undefined;
 const file=new fs.File(fs.Paths.cache,'chunk-size-experiment-'+input.runId+'.bin');
 if(file.exists)throw Error('Synthetic output already exists');
 let socket,handle,timeout,tick,maxLagMs=0,lastTick=performance.now(),peakHeapBytes=null;
 const heap=()=>{try{const s=globalThis.HermesInternal?.getInstrumentedStats?.();const n=s?.js_heapSize;if(Number.isFinite(n))peakHeapBytes=Math.max(peakHeapBytes??0,n);}catch{}};
 const out={chunkBytes:input.codec.size,bytes:input.manifest.bytes,chunks:Math.ceil(input.manifest.bytes/input.codec.size),nativeLeaf:!!input.nativeLeaf,requests:0,wireBytes:0,unpackMs:0,decryptMs:0,writeMs:0,maxChunkMs:0,maxDecodeMs:0,writeCalls:0};
 let resolveReply,rejectReply;
 try{
  tick=setInterval(()=>{const now=performance.now();maxLagMs=Math.max(maxLagMs,now-lastTick-16);lastTick=now;heap();},16);
  const started=performance.now();live();
  if(!a.verifyAttachmentManifest(input.manifest,input.senderRecord,Date.now()))throw Error('Experimental manifest rejected');
  file.create();handle=file.open();
  socket=new WebSocket(input.url);
  socket.onmessage=e=>{const resolve=resolveReply;resolveReply=null;rejectReply=null;if(!resolve){socket.close();return;}resolve(e.data);};
  socket.onerror=()=>rejectReply?.(Error('Synthetic transport error'));
  socket.onclose=()=>rejectReply?.(Error('Synthetic transport closed'));
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error('Synthetic connection failed'));timeout=setTimeout(()=>reject(Error('Synthetic connect timeout')),10000);});clearTimeout(timeout);
  socket.onerror=()=>rejectReply?.(Error('Synthetic transport error'));
  for(let start=0;start<out.chunks;start+=input.codec.batchCount){
   live();const count=Math.min(input.codec.batchCount,out.chunks-start);
   const raw=await new Promise((resolve,reject)=>{resolveReply=resolve;rejectReply=reject;timeout=setTimeout(()=>reject(Error('Synthetic batch timeout')),20000);socket.send(JSON.stringify({start,count}));});clearTimeout(timeout);
   out.requests++;out.wireBytes+=raw.length;
   let at=performance.now();if(raw.length>850000)throw Error('Oversized synthetic frame');const frame=JSON.parse(raw);
   if(frame.start!==start||frame.count!==count)throw Error('Unexpected experimental range');
   const chunks=b.unpackAttachmentBatch(input.manifest,start,count,frame.data),decode=performance.now()-at;out.unpackMs+=decode;out.maxDecodeMs=Math.max(out.maxDecodeMs,decode);
   const buffer=new Uint8Array(Math.min(input.codec.batchBytes,input.manifest.bytes-start*input.codec.size));let offset=0,yieldedBytes=0;
   try{for(const c of chunks){live();at=performance.now();const plain=a.decryptAttachmentChunk(input.manifest,c,key,leaf);const elapsed=performance.now()-at;
    out.decryptMs+=elapsed;out.maxChunkMs=Math.max(out.maxChunkMs,elapsed);
    try{buffer.set(plain,offset);offset+=plain.length;yieldedBytes+=plain.length;}finally{plain.fill(0);}
    if(yieldedBytes>=65536){await pause();yieldedBytes=0;}
   }
   if(offset!==buffer.length)throw Error('Incomplete experimental batch');
   live();at=performance.now();for(let i=0;i<buffer.length;i+=131072){handle.writeBytes(buffer.subarray(i,i+131072));out.writeCalls++;}out.writeMs+=performance.now()-at;
   }finally{buffer.fill(0);}
   await pause();
  }
  handle.close();handle=null;live();
  const verifyStart=performance.now(),digest=sha.create();handle=file.open();let read=0;
  while(read<input.manifest.bytes){const bytes=handle.readBytes(Math.min(262144,input.manifest.bytes-read));if(!bytes.length)throw Error('Short synthetic file');digest.update(bytes);read+=bytes.length;bytes.fill(0);await pause();}
  handle.close();handle=null;
  if(file.size!==input.manifest.bytes||utils.bytesToHex(digest.digest())!==input.checksum)throw Error('Synthetic checksum mismatch');
  out.finalVerifyMs=performance.now()-verifyStart;
  const receipt=a.signAttachmentReceipt(input.manifest,recipientSeed,input.recipientRecord,Date.now());
  if(!a.verifyAttachmentReceipt(receipt,input.manifest,input.recipientRecord,Date.now()))throw Error('Synthetic receipt rejected');
  out.downloadAndVerifyMs=performance.now()-started;out.checksumVerified=true;out.receipt=receipt;
  socket.close();socket=null;
  // Separate local JS preparation diagnostic, NOT native production preparation.
  // Fresh key + identity-independent id; never reuse a nonce/key across sources.
  const prepareKey=utils.hexToBytes(await native.identityRandomBytes(32)),fields={...input.manifest,id:await native.identityRandomBytes(32)};
  const cipherFile=new fs.File(fs.Paths.cache,'chunk-size-experiment-'+input.runId+'.cipher');
  if(cipherFile.exists)throw Error('Synthetic ciphertext already exists');cipherFile.create();
  const prepAt=performance.now(),leaves=[],writer=cipherFile.open();handle=file.open();let preparedBytes=0,maxEncryptMs=0;
  try{for(let i=0;i<out.chunks;i++){
   live();const plain=handle.readBytes(Math.min(input.codec.size,input.manifest.bytes-i*input.codec.size));let cipher;
   try{const at=performance.now();cipher=a.encryptAttachmentChunkBytes(fields,i,plain,prepareKey);leaves.push(a.attachmentLeafBytes(i,cipher,leaf));maxEncryptMs=Math.max(maxEncryptMs,performance.now()-at);writer.writeBytes(cipher);preparedBytes+=plain.length;}
   finally{plain.fill(0);cipher?.fill(0);}
   if(preparedBytes>=65536){await pause();preparedBytes=0;}
  }
  const tree=a.buildAttachmentTree(leaves),prepared=a.signAttachmentManifest({...fields,root:tree.root},senderSeed,input.senderRecord,Date.now());
  if(!a.verifyAttachmentManifest(prepared,input.senderRecord,Date.now()))throw Error('Prepared experimental signature failed');
  out.jsPreparationMs=performance.now()-prepAt;out.maxEncryptMs=maxEncryptMs;
  // Audit first and last encrypted chunks after the preparation timer, using
  // the independent downloaded source bytes. Never report unverified output.
  const audit=cipherFile.open();try{for(const index of [0,out.chunks-1]){
   const length=Math.min(input.codec.size,input.manifest.bytes-index*input.codec.size);
   audit.offset=index*(input.codec.size+16);const ciphertext=utils.bytesToHex(audit.readBytes(length+16));
   const plain=a.decryptAttachmentChunk(prepared,{index,ciphertext,proof:tree.proof(index)},prepareKey,leaf);
   handle.offset=index*input.codec.size;const original=handle.readBytes(length);
   try{if(plain.length!==original.length||plain.some((byte,n)=>byte!==original[n]))throw Error('Prepared bytes differ');}finally{plain.fill(0);original.fill(0);}
  }}finally{audit.close();}out.preparedBoundaryVerified=true;
  }finally{writer.close();handle.close();handle=null;prepareKey.fill(0);}
  out.maxObservedEventLoopLagMs=maxLagMs;out.sampledHeapBytes=peakHeapBytes;out.heapScope='Hermes sampled runtime, not peak process memory; null if unavailable';
  out.scope='Isolated actual-chunk experiment over USB loopback, no normal network jobs or chat delivery';
  return out;
 }finally{clearTimeout(timeout);clearInterval(tick);socket?.close();try{handle?.close();}catch{}key.fill(0);recipientSeed.fill(0);senderSeed.fill(0);}
};
