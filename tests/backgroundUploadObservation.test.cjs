const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>{if(!(n in deps))throw Error(n);return deps[n];});return out;}
function fixture(){const rows=[],messages=[],selected=[],actions=[],groups=[],contacts=[{account:'peer',accepted:true,blocked:false},{account:'peer2',accepted:true,blocked:false}];let reads=0;const deps={
 'react-native':{},'../../modules/axonic-nearby':{default:null},'../services/identity/localAccount':{},
 '../services/identity/rootAttachmentSelections':{selections:async()=>selected},
 '../services/identity/mobileAttachmentJobs':{createMobileAttachmentJobs:()=>({list:async()=>rows})},
 '../services/identity/localRootChat':{localRootChat:()=>({messageIdSnapshot:async id=>{reads++;return {messages:messages.filter(m=>m.id===id),contacts,actions,groups};}})},
 '../services/identity/rootGroups':{rootGroupAllowed:(s,owner,peer,c)=>{const g=s.groups.find(g=>g.id===c.id);return !!g&&!g.blocked&&!g.recoveryPending&&g.members.includes(owner)&&g.members.includes(peer)&&g.revision>=c.revision;}},
 '../services/identity/rootChatActions':load('src/services/identity/rootChatActions.ts',{'./rootChatTypes.ts':{compareRootMessages:()=>0}}),
 '../services/identity/rootMessageStatus':load('src/services/identity/rootMessageStatus.ts'),
 '../services/identity/attachmentProtocol':{attachmentBlockBytes:()=>3000000},
 '../services/identity/backgroundUploadTask':{},'./neuronRuntime':{},
 };const {readBackgroundUploadWork:read,backgroundUploadNeedsRefresh:refresh}=load('src/composition/backgroundMediaUploads.ts',deps);const job={direction:'outgoing',phase:'confirming',cursor:1,descriptor:{manifest:{id:'one',recipient:'peer',bytes:1000000,expires:Date.now()+60000}}};const message={direction:'outgoing',status:'pending',peer:'peer',id:'one',attachment:{}};return {refresh,rows,messages,selected,actions,contacts,groups,job,message,read:()=>read('owner'),reads:()=>reads};}
test('all bytes uploaded still waits for explicit chat custody evidence',async()=>{const t=fixture();t.rows.push(t.job);t.messages.push(t.message);assert.equal((await t.read()).state,"waiting");assert.equal((await t.read()).percent,99);t.message.attachmentStoredUntil=Date.now()+60000;assert.equal((await t.read()).pending,1);t.message.networkStoredUntil=Date.now()+60000;assert.equal((await t.read()).pending,0);});
test('preparation is kept alive; failed selections and paused jobs remain held',async()=>{const t=fixture();t.selected.push({failed:false},{failed:true});t.rows.push({...t.job,phase:'cancelled'});assert.deepEqual(await t.read(),{state:"preparing",expiresAt:Infinity,pending:1,held:2,percent:-1});});
test('incoming transfers do not launch an upload task and delivered/deleted records do not keep it alive',async()=>{const t=fixture();t.rows.push({...t.job,direction:'incoming'});assert.equal((await t.read()).pending,0);assert.equal(t.reads(),0);t.rows.splice(0,1,t.job);t.messages.push({...t.message,status:'delivered'});assert.equal((await t.read()).pending,0);t.messages[0]={...t.message};t.actions.push({peer:'peer',kind:'delete',target:{id:'one',author:'owner'}});assert.equal((await t.read()).pending,0);});
test('missing chat metadata is held, never active or falsely completed',async()=>{const t=fixture();t.rows.push(t.job);const before=JSON.stringify(t.rows);const result=await t.read();assert.equal(result.pending,0);assert.equal(result.held,1);assert.equal(JSON.stringify(t.rows),before);t.messages.push(t.message);assert.equal((await t.read()).pending,1);assert.equal((await t.read()).held,0);});

test('prepared job cannot keep a failed selection running or double count active preparation',async()=>{const t=fixture();t.selected.push({id:'one',failed:true});t.rows.push({...t.job,phase:'queued'});assert.deepEqual(await t.read(),{state:"waiting",expiresAt:Infinity,pending:0,held:1,percent:-1});assert.equal(t.reads(),0);t.selected[0].failed=false;assert.deepEqual(await t.read(),{state:"preparing",expiresAt:Infinity,pending:1,held:0,percent:-1});});


test('group recipient observations reuse one scoped message read',async()=>{const t=fixture();t.rows.push(t.job,{...t.job,descriptor:{manifest:{...t.job.descriptor.manifest,recipient:'peer2'}}});t.messages.push(t.message,{...t.message,peer:'peer2'});const result=await t.read();assert.equal(t.reads(),1);assert.equal(result.pending,2);assert.equal(result.expiresAt,t.job.descriptor.manifest.expires);});
test('queued and confirming work is waiting, not active sending',async()=>{const t=fixture();t.rows.push(t.job);t.messages.push(t.message);for(const phase of ['queued','confirming']){t.job.phase=phase;assert.equal((await t.read()).state,'waiting');}t.job.phase='uploading';assert.equal((await t.read()).state,'sending');t.selected.push({id:'new'});assert.equal((await t.read()).state,'preparing');});
test('expired work is held without inventing completion',async()=>{const t=fixture();t.job.descriptor.manifest.expires=Date.now()-1;t.rows.push(t.job);const result=await t.read();assert.equal(result.pending,0);assert.equal(result.held,1);assert.equal(result.expiresAt,Infinity);assert.equal(t.rows.length,1);});

test('cached status refreshes at expiry without requiring a progress event',()=>{const t=fixture();assert.equal(t.refresh(undefined,false,100),true);assert.equal(t.refresh({expiresAt:200},false,199),false);assert.equal(t.refresh({expiresAt:200},false,200),true);assert.equal(t.refresh({expiresAt:Infinity},true,200),true);assert.equal(t.refresh({expiresAt:Infinity},false,200),false);});

test('blocked or unaccepted recipients are held without mutating jobs',async()=>{const t=fixture();t.rows.push(t.job);t.messages.push(t.message);for(const change of [()=>t.contacts[0].blocked=true,()=>{t.contacts[0].blocked=false;t.contacts[0].accepted=false;}]){change();const work=await t.read();assert.equal(work.pending,0);assert.equal(work.held,1);assert.equal(t.job.phase,'confirming');}t.contacts[0].accepted=true;assert.equal((await t.read()).pending,1);});

test('group work held by membership, approval or recovery does not keep uploads active',async()=>{const t=fixture();t.rows.push(t.job);t.messages.push({...t.message,group:{id:'group',messageId:'logical',revision:1}});const g={id:'group',members:['owner','peer'],accepted:true,revision:1};t.groups.push(g);assert.equal((await t.read()).pending,1);for(const patch of [{blocked:true},{recoveryPending:true},{accepted:false},{members:['owner']},{revision:0}]){t.groups[0]={...g,...patch};assert.equal((await t.read()).pending,0);assert.equal((await t.read()).held,1);}t.groups[0]=g;assert.equal((await t.read()).pending,1);});
test('accepted group membership can keep uploads active without private contact approval',async()=>{
 const t=fixture();t.rows.push(t.job);t.messages.push({...t.message,group:{id:'group',messageId:'logical',revision:1}});
 t.groups.push({id:'group',members:['owner','peer'],accepted:true,revision:1});
 t.contacts[0].accepted=false;
 assert.equal((await t.read()).pending,1);
 t.contacts[0].blocked=true;
 assert.equal((await t.read()).held,1);
});
