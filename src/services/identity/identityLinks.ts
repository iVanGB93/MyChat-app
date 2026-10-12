import {parseIdentityCode,displayIdentity} from './identityPresentation';
/** Links contain public addresses only. Opening one never accepts a contact or sends data. */
export function identityLink(account:string){const parsed=parseIdentityCode(account);if(!parsed)throw Error('Invalid identity');return 'https://chat.qbared.com/identity/'+encodeURIComponent(displayIdentity(parsed))+'/';}
export function parseIdentityLink(url:unknown):string|null{
 if(typeof url!=='string'||url.length>256)return null;
 const match=/^(?:axonic:\/\/identity\/|https:\/\/chat\.qbared\.com\/identity\/)([^/?#]+)\/?$/.exec(url);if(!match)return null;
 try{return parseIdentityCode(decodeURIComponent(match[1]));}catch{return null;}
}
/** Clipboard formatting is not part of an address; its checksum still validates every byte. */
export function parseIdentityInput(value:string):string|null{
 const normalized=value.replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'');
 return parseIdentityLink(normalized)||parseIdentityCode(normalized);
}
let pending:string|null=null;
export function queueIdentityLink(url:unknown){const account=parseIdentityLink(url);if(account)pending=account;return !!account;}
export function takeIdentityLink(){const account=pending;pending=null;return account;}
