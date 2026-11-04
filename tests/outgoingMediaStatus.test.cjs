const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n]);return out;}
const status=load('src/services/identity/rootMessageStatus.ts');
const {outgoingMediaStatus:label}=load('src/utils/outgoing-media-status.ts',{'../services/identity/rootMessageStatus':status});
const message={direction:'outgoing',status:'pending',attachment:{}};
test('local media and 100 percent upload never imply accepted or delivered',()=>{assert.match(label(message,200,'uploading',100,100).hint,/Not yet confirmed sent/);assert.match(label({...message,descriptorDelivered:true},200,'confirming',100,100).label,/confirmation/);});
test('storage requires both descriptor and attachment custody evidence',()=>{assert.match(label({...message,networkStoredUntil:200},300,'uploading',50,100).label,/Sending/);assert.equal(label({...message,networkStoredUntil:200,attachmentStoredUntil:200},300,'confirming',100,100).label,'Stored on Axonic network');});
test('delivered and incoming media do not show upload warnings; paused and expired stay explicit',()=>{assert.equal(label({...message,status:'delivered'},200,undefined,0,100),null);assert.equal(label({...message,direction:'incoming'},200,undefined,0,100),null);assert.equal(label(message,200,'cancelled',30,100).label,'Transfer paused');assert.equal(label(message,90,undefined,30,100).label,'Attachment expired');});

test('expired authorization takes priority over a longer retained custody observation',()=>{assert.equal(label({...message,networkStoredUntil:500,attachmentStoredUntil:500},90,'confirming',100,100).label,'Attachment expired');});
