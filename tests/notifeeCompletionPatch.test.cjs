const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {patch,target,before,after}=require('../scripts/patch-notifee-block-completion.cjs');
const installed=fs.readFileSync(path.resolve(__dirname,'..',target),'utf8').replace(/\r\n/g,'\n');
const original=installed.replace(after,before);
test('Notifee completion patch is idempotent, pinned and limited to settings events',()=>{
 const result=patch(original);assert.equal(patch(result),result);assert.equal(patch(original.replace(/\n/g,'\r\n')),result);
 assert.equal(result.replace(after,before),original);
 assert.throws(()=>patch(original+'\n// unreviewed vendor change'),/review required/);
 assert(result.includes('FOREGROUND_NOTIFICATION_TASK_KEY, eventMap, 0, foregroundServiceEvent::setCompletionResult'));
 assert(after.includes('finally {\n        blockStateEvent.setCompletionResult();'));
 assert(after.includes('handler.postDelayed(complete, 10000)'));
 assert(after.includes('completed.compareAndSet(false, true)'));
});
