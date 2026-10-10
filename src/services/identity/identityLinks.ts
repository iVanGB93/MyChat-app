import {parseIdentityCode,displayIdentity} from './identityPresentation';
/** Links contain public addresses only. Opening one never accepts a contact or sends data. */
export function identityLink(account:string){const parsed=parseIdentityCode(account);if(!parsed)throw Error('Invalid identity');return 'axonic://identity/'+encodeURIComponent(displayIdentity(parsed));}
export function parseIdentityLink(url:unknown):string|null{
 if(typeof url!=='string'||url.length>256)return null;
 const match=/^axonic:\/\/identity\/([^/?#]+)$/.exec(url);if(!match)return null;
 try{return parseIdentityCode(decodeURIComponent(match[1]));}catch{return null;}
}
let pending:string|null=null;
export function queueIdentityLink(url:unknown){const account=parseIdentityLink(url);if(account)pending=account;return !!account;}
export function takeIdentityLink(){const account=pending;pending=null;return account;}
