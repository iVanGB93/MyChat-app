import { validAccountId } from './identityProtocol.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encode58(bytes:Uint8Array){
 let n=BigInt('0x'+bytesToHex(bytes)),text='';while(n){text=alphabet[Number(n%58n)]+text;n/=58n;}
 for(const byte of bytes){if(byte!==0)break;text='1'+text;}return text;
}
function decode58(text:string){
 if(!/^[1-9A-HJ-NP-Za-km-z]{36,50}$/.test(text))throw Error('Invalid address');
 let n=0n;for(const char of text)n=n*58n+BigInt(alphabet.indexOf(char));
 let hex=n.toString(16);if(hex.length%2)hex='0'+hex;
 const body=n===0n?new Uint8Array():hexToBytes(hex),zeros=text.length-text.replace(/^1+/,'').length;
 const bytes=new Uint8Array(zeros+body.length);bytes.set(body,zeros);return bytes;
}
const checksum=(bytes:Uint8Array)=>sha256(sha256(bytes)).slice(0,4);
/** Lossless Base58Check presentation. Signed records and stored IDs retain all 256 bits. */
export function displayIdentity(account:string):string{
 if(!validAccountId(account))return account;
 const bytes=hexToBytes(account.slice('axonic:1:'.length)),checked=new Uint8Array(36);checked.set(bytes);checked.set(checksum(bytes),32);
 return 'axon:'+encode58(checked);
}
/** Visual abbreviation only; never use this value for addressing, copying or QR codes. */
export function shortIdentity(account:string):string{
 const code=displayIdentity(account);return validAccountId(account)?code.slice(0,11)+'…'+code.slice(-6):code;
}
export function parseIdentityCode(code:string):string|null{
 const value=code.trim();if(validAccountId(value as unknown))return value;
 if(/^axon[0-9a-f]{64}$/.test(value))return 'axonic:1:'+value.slice(4);
 if(!value.startsWith('axon:'))return null;
 try{const bytes=decode58(value.slice(5));if(bytes.length!==36)return null;
 const body=bytes.slice(0,32),check=checksum(body);if(check.some((b,i)=>bytes[32+i]!==b)||encode58(bytes)!==value.slice(5))return null;
 return 'axonic:1:'+bytesToHex(body);
 }catch{return null;}
}

export async function chooseBackupWords(count: number, random: (size: number) => Promise<Uint8Array>): Promise<[number, number]> {
  if (count !== 12 && count !== 24) throw Error('Invalid recovery phrase');
  const chosen = new Set<number>(), ceiling = 256 - (256 % count);
  while (chosen.size < 2) {
    for (const byte of await random(8)) {
      if (byte < ceiling) chosen.add(byte % count);
      if (chosen.size === 2) break;
    }
  }
  return [...chosen].sort((a, b) => a - b) as [number, number];
}
export function checkBackupWords(phrase: string, positions: [number, number], answers: [string, string]): boolean {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  return positions[0] !== positions[1] && positions.every((position, i) =>
    Number.isInteger(position) && position >= 0 && position < words.length &&
    answers[i].trim().toLowerCase() === words[position]);
}
