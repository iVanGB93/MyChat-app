const fs=require('node:fs'),{run}=require('./test-two-phone-dev.cjs');
function syntheticPng(){
 const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([head,body,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(16,0);header.writeUInt32BE(16,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc(16*65);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const p=y*65+1+x*4;pixels[p]=20;pixels[p+1]=200;pixels[p+2]=220;pixels[p+3]=255;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',require('node:zlib').deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('hex');
}
(async()=>{
 const ts=(await(await fetch('http://127.0.0.1:8081/json/list')).json()).filter(t=>t.appId==='com.axonic.dev'&&t.deviceName.startsWith('sdk_gphone'));
 const t=ts.find(t=>t.id.startsWith('715a96caaa960e3264b13df66c749e02bda45b9d'));if(!t)throw Error('Expected Dev emulator missing');
 if(process.argv[2]==='open')console.log(await run(t,`
 const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),native=find(/expo[\\/]src[\\/]Expo\\.ts$/).requireOptionalNativeModule('AxonicMediaStore');
 const nearby=find(/modules[\\/]axonic-nearby[\\/]index\\.ts$/).default,id=await nearby.identityRandomBytes(32);
 const photo=new fs.File(fs.Paths.cache,'single-copy-picker-'+id+'.png');
 const hex=${JSON.stringify(syntheticPng())};
 photo.write(Uint8Array.from(hex.match(/../g).map(x=>parseInt(x,16))));
 const uri=await native.save(photo.uri,'AXN_'+id+'__single-copy-picker.png','image/png','image');photo.delete();
 globalThis.__singlePicker={pending:true,expected:uri,id};native.pickMedia().then(value=>{globalThis.__singlePicker={...globalThis.__singlePicker,pending:false,value};},error=>{globalThis.__singlePicker={...globalThis.__singlePicker,pending:false,error:String(error)};});return {opened:true,uri};`));
 else {
  const result=await run(t,`const result=globalThis.__singlePicker;if(!result||result.pending||result.error)throw Error(JSON.stringify(result));
 const assets=result.value.assets;if(assets.length!==1)throw Error('Select the synthetic photo only');
 const media=get('src/services/identity/rootMediaExport.ts');let staged;
 await media.withRootPickedMedia(assets.map(a=>({uri:a.uri,mime:a.mimeType})),async rows=>{
  const fs=find(/expo-file-system[\\/]src[\\/]index\\.ts$/),f=new fs.File(rows[0].uri),marker=new fs.File(rows[0].uri+'.axonic-origin.json');if(!f.exists||!marker.exists)throw Error('Original reference not staged');staged=JSON.parse(marker.textSync()).uri;
 });
 const native=find(/expo[\\/]src[\\/]Expo\\.ts$/).requireOptionalNativeModule('AxonicMediaStore');
 const originalHash=await native.sha256(result.expected),selectedHash=await native.sha256(staged);if(originalHash!==selectedHash)throw Error('Picker changed photo');
 const dimensions=await find(/react-native[\\/]index\\.js$/).Image.getSize(staged);
 return {originalUri:result.expected,selectedUri:staged,hashMatches:true,dimensions,originalAvailable:await native.available(result.expected),selectedAvailable:await native.available(staged)};`);
  fs.writeFileSync('builds/single-copy-picker-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
