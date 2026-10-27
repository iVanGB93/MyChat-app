const test=require('node:test'),assert=require('node:assert/strict');
const {messageRetryDeadline}=require('./helpers/attachment.cjs').load('messageRetryDeadline');
test('outbox deadlines sleep for empty/active lanes and preserve custody/retry deadlines',()=>{
 const rows=[{peer:'a',id:'1'},{peer:'b',id:'2'}];
 assert.equal(messageRetryDeadline([],100,2000,new Set(),()=>0),Infinity);
 assert.equal(messageRetryDeadline(rows,100,2000,new Set(['a','b']),()=>0),Infinity);
 assert.equal(messageRetryDeadline(rows,100,2000,new Set(['a']),()=>60000),60000);
 assert.equal(messageRetryDeadline(rows,100,2000,new Set(),()=>0),2100);
 assert.equal(messageRetryDeadline(rows,100,0,new Set(),()=>undefined),100);
});
