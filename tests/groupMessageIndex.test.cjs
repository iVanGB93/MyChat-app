const test=require('node:test'),assert=require('node:assert/strict');
const {rootGroupMessages,rootGroupMessageIndex}=require('./helpers/attachment.cjs').load('rootGroups');
// Frozen historical reference to detect changes to order or receipt aggregation.
function previous(s,id){const rows=new Map();for(const m of s.messages.filter(m=>m.group?.id===id)){const key=(m.direction==='outgoing'?'own':m.peer)+':'+m.group.messageId,old=rows.get(key);if(!old)rows.set(key,{...m});else{if(m.networkCancelledAt!==undefined)old.networkCancelledAt??=m.networkCancelledAt;const desc=v=>v.status==='delivered'||v.descriptorDelivered?Number.MAX_SAFE_INTEGER:v.networkStoredUntil??0,file=v=>v.status==='delivered'?Number.MAX_SAFE_INTEGER:v.attachmentStoredUntil??0;old.networkStoredUntil=Math.min(desc(old),desc(m));old.attachmentStoredUntil=Math.min(file(old),file(m));old.descriptorDelivered=!!old.descriptorDelivered&&!!m.descriptorDelivered;old.read=!!old.read&&!!m.read;if(m.status==='pending')old.status='pending';}}return [...rows.values()];}
test('one-pass previews preserve mixed recipient states, media, cancelled work and first-seen order',()=>{
 const state={messages:Array.from({length:5000},(_,i)=>({id:String(i),peer:'peer'+i%3,direction:i%4?'outgoing':'incoming',at:5000-i,text:'synthetic',status:i%3?'delivered':'pending',
  ...(i%3?{group:{id:'group'+i%8,messageId:String(Math.floor(i/24)),revision:1}}:{}),
  ...(i%5?{networkStoredUntil:100+i}:{}),...(i%7?{attachmentStoredUntil:200+i,attachment:{mime:'image/jpeg'}}:{}),
  ...(i%9===0?{networkCancelledAt:300+i}:{}),read:i%2===0,descriptorDelivered:i%4===0}))};
 const original=JSON.stringify(state),index=rootGroupMessageIndex(state);
 for(let i=0;i<8;i++){const id='group'+i;assert.deepEqual(index.get(id),previous(state,id));assert.deepEqual(rootGroupMessages(state,id),previous(state,id));}
 assert.equal(JSON.stringify(state),original);assert.equal(index.get('absent'),undefined);assert.deepEqual(rootGroupMessages(state,'absent'),[]);
});
test('incoming authors with matching logical IDs remain distinct; own recipient copies collapse',()=>{
 const group={id:'g',messageId:'same',revision:1};const state={messages:[{id:'a',peer:'one',direction:'incoming',group},{id:'b',peer:'two',direction:'incoming',group},{id:'c',peer:'one',direction:'outgoing',group,status:'delivered',read:true},{id:'d',peer:'two',direction:'outgoing',group,status:'pending',read:false}]};
 const rows=rootGroupMessageIndex(state).get('g');assert.equal(rows.length,3);assert.equal(rows[2].status,'pending');assert.equal(rows[2].read,false);assert.equal(state.messages[2].status,'delivered');
});
