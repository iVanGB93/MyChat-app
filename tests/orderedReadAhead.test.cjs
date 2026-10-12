const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/orderedReadAhead.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
const {createOrderedReadAhead}=out;
test('completed later reads replenish slots while ordered consumer waits for first',async()=>{
 let release,active=0,peak=0;const gate=new Promise(r=>release=r),started=[];
 const reads=createOrderedReadAhead(8,2,async i=>{started.push(i);active++;peak=Math.max(peak,active);try{if(i===0)await gate;return i;}finally{active--;}});
 try{for(let i=0;i<20;i++)await Promise.resolve();assert.equal(started.length,8);assert.equal(peak,2);release();
 for(let i=0;i<8;i++)assert.deepEqual(await reads.get(i),{status:'fulfilled',value:i});
 }finally{release();await reads.stop();}assert.equal(active,0);
});
test('stop prevents new requests and drains existing reads',async()=>{
 let release;const gate=new Promise(r=>release=r),started=[];
 const reads=createOrderedReadAhead(8,2,async i=>{started.push(i);await gate;return i;});let done=false;
 const stopping=reads.stop().then(()=>done=true);await Promise.resolve();assert.equal(done,false);release();await stopping;
 assert.deepEqual(started,[0,1]);assert.equal((await reads.get(2)).status,'rejected');
});
test('failed read stops scheduling and releases all waiting consumers',async()=>{
 const started=[];const reads=createOrderedReadAhead(8,2,async i=>{started.push(i);throw Error('lost');});
 for(let i=0;i<8;i++)assert.equal((await reads.get(i)).status,'rejected');await reads.stop();assert.deepEqual(started,[0,1]);
});
test('invalid budgets cannot start work',()=>{for(const [n,c]of [[0,2],[33,2],[8,0],[8,5],[1.5,2]])assert.throws(()=>createOrderedReadAhead(n,c,async()=>assert.fail()),/bounds/);});
