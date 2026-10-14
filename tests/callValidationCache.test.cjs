const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const {createCallValidationCache}=load('callValidationCache');

test('only identical successful inputs are reused and results cannot poison the cache',()=>{
 const check=createCallValidationCache();let calls=0;
 const verify=()=>{calls++;return {nested:{value:1}};};
 const first=check('event','identity',100,verify);first.nested.value=9;
 const second=check('event','identity',100,verify);assert.equal(second.nested.value,1);second.nested.value=8;
 assert.equal(check('event','identity',100,verify).nested.value,1);assert.equal(calls,1);
 check('changed','identity',100,verify);check('event','updated identity',100,verify);
 check('event','identity',101,verify);check('event','identity',99,verify);assert.equal(calls,5);
});

test('negative results are never cached and expired-time checks are not reused',()=>{
 const check=createCallValidationCache();let calls=0;
 assert.equal(check('event','identity',100,()=>{calls++;return null;}),null);
 assert.deepEqual(check('event','identity',100,()=>{calls++;return {ok:true};}),{ok:true});
 assert.equal(check('event','identity',200,()=>{calls++;return null;}),null);assert.equal(calls,3);
 for(const time of [-1,NaN,Infinity,1.5])assert.equal(check('event','identity',time,()=>{throw Error('Invalid time admitted');}),null);
});

test('entry and aggregate size limits evict old results',()=>{
 for(const size of [1,10000]){
  const check=createCallValidationCache();let old=0;
  const verify=()=>{old++;return {ok:true};};check('first','context',100,verify);
  for(let i=0;i<65;i++)check(String(i).padEnd(size,'x'),'context',100,()=>({ok:true}));
  check('first','context',100,verify);assert.equal(old,2);
 }
});
