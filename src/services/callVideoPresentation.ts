export const CALL_VIDEO_STATE = 'axonic-call-video-state-v1';
/** Presentation hints on the call's authenticated, ordered WebRTC channel only. */
export function readCallVideoState(raw:unknown):boolean|null {
 if(typeof raw!=='string'||raw.length>64)return null;
 try{const value=JSON.parse(raw);return value?.version===1&&typeof value.sharing==='boolean'?value.sharing:null;}catch{return null;}
}
export function callVideoState(sharing:boolean):string{return JSON.stringify({version:1,sharing});}
