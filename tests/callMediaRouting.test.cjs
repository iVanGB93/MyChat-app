const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs'),{routeCallMedia}=load('callMediaRouting');
const target='axonic:1:'+'a'.repeat(64),device='b'.repeat(64),raw=JSON.stringify({target,targetDevice:device,signature:'opaque signed payload'});
test('call-bound signaling selects the exact direct device and preserves the signed bytes',async()=>{
 let relays=0;assert(await routeCallMedia(raw,{current:()=>true,direct:async(...args)=>{assert.deepEqual(args,[target,device,raw]);return true;},relay:async()=>{relays++;return true;}}));assert.equal(relays,0);
});
for(const mode of ['unavailable','disconnect'])test(`call signaling falls back to relay after direct ${mode}`,async()=>{
 const order=[];assert(await routeCallMedia(raw,{current:()=>true,direct:async()=>{order.push('direct');if(mode==='disconnect')throw Error('closed');return false;},relay:async body=>{assert.equal(body,raw);order.push('relay');return true;}}));assert.deepEqual(order,['direct','relay']);
});
test('account invalidation during direct signaling suppresses relay and stale success',async()=>{
 for(const result of [false,true]){let active=true,relays=0;assert.equal(await routeCallMedia(raw,{current:()=>active,direct:async()=>{active=false;return result;},relay:async()=>{relays++;return true;}}),false);assert.equal(relays,0);}
});
test('malformed routes and oversized signals never reach either transport',async()=>{
 for(const input of ['{',JSON.stringify({target:'invalid',targetDevice:device}),JSON.stringify({target,targetDevice:'bad'}),' '.repeat(12001)]){
  assert.equal(await routeCallMedia(input,{current:()=>true,direct:async()=>{assert.fail('direct');},relay:async()=>{assert.fail('relay');}}),false);
 }
});
