import {requireOptionalNativeModule} from 'expo';
import {Platform} from 'react-native';
export const isSharedMediaUri=(uri:string)=>/^content:\/\/(media|com\.android\.providers\.media\.documents)\//.test(uri);

/** MediaStore is the permanent file, not an export backed by a private replica.
 * Expo's File.open cannot seek content URIs, so use read-only native descriptors. */
export const sharedMediaNative=Platform.OS==='android'?requireOptionalNativeModule<{
 singleCopy?:boolean;
 stat(uri:string):{exists:boolean;size:number};
 openRead(uri:string):number;
 read(handle:number,offset:number,length:number):Uint8Array;
 closeRead(handle:number):void;
 sha256(uri:string):Promise<string>;
 hashBlocks?(uri:string,bytes:number):Promise<{bytes:number;checksum:string;blocks:string[]}>;
 adopt(source:string,uri:string):Promise<void>;
}>('AxonicMediaStore'):null;

export class SharedMediaFile {
 constructor(readonly uri:string){}
 get contentUri(){return this.uri;}
 get exists(){return sharedMediaNative?.stat(this.uri).exists??false;}
 get size(){return sharedMediaNative?.stat(this.uri).size??0;}
 open(){
  if(!sharedMediaNative?.singleCopy)throw Error('Update Axonic to read shared media');
  const id=sharedMediaNative.openRead(this.uri);let offset=0,closed=false;
  return {get offset(){return offset;},set offset(value:number){offset=value;},
   readBytes(length:number){if(closed)throw Error('Media reader closed');const bytes=sharedMediaNative!.read(id,offset,length);offset+=bytes.length;return bytes;},
   close(){if(!closed){closed=true;sharedMediaNative!.closeRead(id);}}};
 }
}
