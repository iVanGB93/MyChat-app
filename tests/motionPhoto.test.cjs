const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');

const output={};
const compiled=ts.transpileModule(fs.readFileSync('src/modules/storage/motionPhotoFormat.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
new Function('exports',compiled)(output);
const {findMotionPhotoClip}=output;
const find=bytes=>findMotionPhotoClip((offset,length)=>bytes.subarray(offset,offset+length),bytes.length);
const jpegStart=Buffer.from([255,216]);
const jpegEnd=Buffer.from([255,217]);
function box(name,data){
 const header=Buffer.alloc(8);
 header.writeUInt32BE(header.length+data.length);
 header.write(name,4);
 return Buffer.concat([header,data]);
}
const video=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.alloc(64))]);
function jpegWithXmp(xml,trailing=video){
 const xmp=Buffer.from('http://ns.adobe.com/xap/1.0/\0'+xml);
 const marker=Buffer.from([255,225,0,0]);
 marker.writeUInt16BE(xmp.length+2,2);
 return Buffer.concat([jpegStart,marker,xmp,jpegEnd,trailing]);
}
function samsungWithSef(payload,offset=0){
 const name=Buffer.from('MotionPhoto_Data');
 const entry=Buffer.alloc(8);
 entry.writeUInt16LE(0xa30,2);
 entry.writeUInt32LE(name.length,4);
 const entryLength=entry.length+name.length+payload.length;
 const data=Buffer.alloc(24);
 data.write('SEFH');data.writeUInt32LE(1,8);data.writeUInt16LE(0xa30,14);
 data.writeUInt32LE(entryLength,16);data.writeUInt32LE(entryLength,20);
 const footer=Buffer.alloc(8);
 footer.writeUInt32LE(data.length);footer.write('SEFT',4);
 return Buffer.concat([jpegStart,Buffer.alloc(offset),jpegEnd,entry,name,payload,data,footer]);
}

test('detects standard and legacy XMP videos without reading the image or video payload',()=>{
 const standard=jpegWithXmp(`<rdf:Description GCamera:MotionPhoto="1"><Container:Item Item:Length="${video.length}" Item:Semantic="MotionPhoto"/></rdf:Description>`);
 const legacy=jpegWithXmp(`<rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="${video.length}"/>`);
 for(const bytes of [standard,legacy]){
  const clip=find(bytes);
  assert.deepEqual(clip,{offset:bytes.length-video.length,length:video.length});
  assert.deepEqual(bytes.subarray(clip.offset,clip.offset+clip.length),video);
 }
});

test('detects Samsung SEF videos and HEIF mpvd boxes',()=>{
 const samsung=samsungWithSef(video,32768);
 const clip=find(samsung);
 assert.deepEqual(samsung.subarray(clip.offset,clip.offset+clip.length),video);
 assert.equal(clip.length,video.length);
 const heif=Buffer.concat([box('ftyp',Buffer.from('heic0000')),box('mdat',Buffer.alloc(100)),box('mpvd',video)]);
 assert.deepEqual(find(heif),{offset:heif.length-video.length,length:video.length});
});

test('plain stills and malformed offsets fall back to an image',()=>{
 const disabled=jpegWithXmp(`<rdf:Description GCamera:MotionPhoto="0" GCamera:MicroVideoOffset="${video.length}"/>`);
 const invalid=jpegWithXmp('<rdf:Description GCamera:MicroVideoOffset="123456789"/>');
 const wrongVideo=jpegWithXmp('<rdf:Description GCamera:MicroVideoOffset="40"/>',Buffer.alloc(40));
 const plain=Buffer.concat([jpegStart,Buffer.alloc(30),jpegEnd]);
 for(const image of [disabled,invalid,wrongVideo,plain,video])assert.equal(find(image),undefined);
 const corrupt=samsungWithSef(video,100);
 corrupt.writeUInt32LE(0xffffffff,corrupt.length-16);
 assert.equal(find(corrupt),undefined);
});
