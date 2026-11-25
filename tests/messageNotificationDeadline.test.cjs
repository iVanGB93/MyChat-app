const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n]);return out;}
const stickerFormat=load('src/services/sticker-file-format.ts',{'./identity/stickerProtocol':load('src/services/identity/stickerProtocol.ts')});
const avatarFormat=load('src/services/group-avatar-file.ts');
const {createMessageNotificationDeadline}=load('src/services/identity/messageNotificationDeadline.ts');
test('stalled retrieval falls back after inactivity; progress extends but repeats do not',()=>{let now=0;const d=createMessageNotificationDeadline(()=>now);now=2500;assert.equal(d.remaining(),500);d.progress('account-ready');assert.equal(d.remaining(),3000);now=4000;d.progress('account-ready');assert.equal(d.remaining(),1500);d.progress('connected:peer');assert.equal(d.remaining(),3000);now=7000;assert.equal(d.remaining(),0);});
test('even continuing genuine progress cannot exceed ten seconds',()=>{let now=0;const d=createMessageNotificationDeadline(()=>now);for(now=1000;now<10000;now+=1000)d.progress(String(now));assert.equal(d.remaining(),0);});
test('media metadata yields a preview without full-file completion or changing delivery state',()=>{const {rootNotificationPreviewText}=load('src/services/identity/rootNotificationPreviewText.ts',{'../stickers':{parseSticker:()=>false},'../sticker-file-format':stickerFormat,'../group-avatar-file':avatarFormat});for(const [mime,label] of [['image/jpeg','Photo'],['video/mp4','Video'],['audio/mp4','Voice message'],['application/pdf','File']]){const m={text:'private filename',status:'pending',attachment:{mime,name:'private filename'}};const before=JSON.stringify(m);assert.equal(rootNotificationPreviewText(m),label);assert.equal(JSON.stringify(m),before);}assert.equal(rootNotificationPreviewText({text:'hello'}),'hello');});
test('imported image stickers are labeled Sticker before download, ordinary images remain Photo',()=>{
 const format=stickerFormat;const {rootNotificationPreviewText:preview}=load('src/services/identity/rootNotificationPreviewText.ts',{'../stickers':{parseSticker:text=>text==='bundled-sticker'},'../sticker-file-format':format,'../group-avatar-file':avatarFormat});
 for(const mime of ['image/png','image/webp','image/gif']){const message={text:'',attachment:{mime,name:format.IMPORTED_STICKER_CONTENT}};assert.equal(preview(message),'Sticker');assert.equal(preview({...message,attachment:{mime,name:'Sticker.png'}}),'Photo');}
 assert.equal(preview({text:'bundled-sticker'}),'Sticker');
});
test('dedicated avatar images use a group avatar preview, ordinary group images still use Photo',()=>{
 const {rootNotificationPreviewText:preview}=load('src/services/identity/rootNotificationPreviewText.ts',{'../stickers':{parseSticker:()=>false},'../sticker-file-format':stickerFormat,'../group-avatar-file':avatarFormat});
 const attachment={mime:'image/jpeg',name:avatarFormat.GROUP_AVATAR_FILE};
 const message={text:'',group:{id:'group'},attachment};
 assert.equal(preview(message),'Group avatar');
 assert.equal(preview({...message,group:undefined}),'Photo');
 assert.equal(preview({...message,attachment:{...attachment,name:'family.jpg'}}),'Photo');
 assert.equal(preview({...message,attachment:{...attachment,mime:'application/pdf'}}),'File');
});
