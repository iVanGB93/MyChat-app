export type MotionPhotoClip={offset:number;length:number};
type Read=(offset:number,length:number)=>Uint8Array;

function ascii(bytes:Uint8Array){
 let text='';
 for(let i=0;i<bytes.length;i+=4096)text+=String.fromCharCode(...bytes.subarray(i,i+4096));
 return text;
}
const view=(bytes:Uint8Array)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const xmpHeader='http://ns.adobe.com/xap/1.0/\0';
const samsungVideo='MotionPhoto_Data';

function samsungClip(read:Read,size:number):MotionPhotoClip|undefined{
 const footer=read(size-8,8);
 if(footer.length!==8||ascii(footer.subarray(4))!=='SEFT')return;
 const length=view(footer).getUint32(0,true),start=size-8-length;
 if(start<4||length<12||length>=65536)return;
 const directory=read(start,length);
 if(directory.length!==length||ascii(directory.subarray(0,4))!=='SEFH')return;
 const index=view(directory),count=index.getUint32(8,true);
 if(count>Math.floor((length-12)/12))return;
 for(let i=12;i<12+count*12;i+=12){
  if(index.getUint16(i+2,true)!==0xa30)continue;
  const distance=index.getUint32(i+4,true),bytes=index.getUint32(i+8,true);
  const headerLength=8+samsungVideo.length,entry=start-distance;
  if(entry<4||bytes<=headerLength||bytes>distance)continue;
  const header=read(entry,headerLength);
  if(header.length!==headerLength||view(header).getUint32(4,true)!==samsungVideo.length||ascii(header.subarray(8))!==samsungVideo)continue;
  const offset=entry+headerLength,length=bytes-headerLength;
  if(length!==12)return {offset,length};
  const pointer=read(offset,12);
  if(pointer.length===12&&ascii(pointer.subarray(0,4))==='mpv2')return {offset:view(pointer).getUint32(4),length:view(pointer).getUint32(8)};
 }
}

function xmpClip(read:Read,size:number):MotionPhotoClip|undefined{
 // Only parse JPEG metadata segments before scan data. Large images are never decoded.
 for(let offset=2,markers=0;offset+4<=size&&offset<512*1024&&markers<128;markers++){
  const marker=read(offset,4);
  if(marker.length!==4||marker[0]!==255||marker[1]===0xda||marker[1]===0xd9)return;
  if(marker[1]===255){offset++;continue;}
  const length=view(marker).getUint16(2);
  if(length<2||offset+2+length>size)return;
  if(marker[1]===0xe1&&length>2+xmpHeader.length&&ascii(read(offset+4,xmpHeader.length))===xmpHeader){
   const xml=ascii(read(offset+4+xmpHeader.length,length-2-xmpHeader.length));
   const flag=/\b(?:MotionPhoto|MicroVideo)\s*=\s*["']([01])["']/.exec(xml)?.[1];
   if(flag==='0')return;
   const item=xml.match(/<[^<>]+\bSemantic\s*=\s*["']MotionPhoto["'][^<>]*>/)?.[0];
   const bytes=Number(item?/\bLength\s*=\s*["'](\d+)["']/.exec(item)?.[1]:/\bMicroVideoOffset\s*=\s*["'](\d+)["']/.exec(xml)?.[1]);
   if(bytes>0&&size-bytes>=offset+2+length)return {offset:size-bytes,length:bytes};
  }
  offset+=2+length;
 }
}

function heifClip(read:Read,size:number):MotionPhotoClip|undefined{
 // Android's HEIF Motion Photo stores the MP4 in a top-level mpvd box.
 for(let offset=0,boxes=0;offset+8<=size&&boxes<256;boxes++){
  const header=read(offset,8);
  if(header.length!==8)return;
  const shortLength=view(header).getUint32(0),headerSize=shortLength===1?16:8;
  const extended=shortLength===1?read(offset+8,8):undefined;
  if(extended&&(extended.length!==8||view(extended).getUint32(0)!==0))return;
  const length=extended?view(extended).getUint32(4):shortLength||size-offset;
  if(length<headerSize||length>size-offset)return;
  if(ascii(header.subarray(4))==='mpvd')return {offset:offset+headerSize,length:length-headerSize};
  offset+=length;
 }
}

export function findMotionPhotoClip(read:Read,size:number):MotionPhotoClip|undefined{
 if(!Number.isSafeInteger(size)||size<32)return;
 const header=read(0,12);
 if(header.length!==12)return;
 const jpeg=header[0]===255&&header[1]===216;
 const heif=ascii(header.subarray(4,8))==='ftyp';
 if(!jpeg&&!heif)return;
 const clip=samsungClip(read,size)??(jpeg?xmpClip(read,size):heifClip(read,size));
 if(!clip||clip.offset<4||clip.length<16||clip.offset+clip.length>size)return;
 const video=read(clip.offset,8);
 if(video.length===8&&ascii(video.subarray(4))==='ftyp'){
  const length=view(video).getUint32(0);
  if(length>=16&&length<=clip.length)return clip;
 }
}
