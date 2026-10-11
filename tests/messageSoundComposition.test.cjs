const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(){const app={currentState:'active'},status={state:'unlocked',account:'owner'},timers=new Set(),received=[];let feedback,lifecycle,accountChanged,stops=0;
 const deps={'react-native':{AppState:{...app,get currentState(){return app.currentState;},addEventListener:(name,fn)=>{lifecycle=fn;return {remove(){}};}}},'../services/messageSounds':{createMessageSounds:()=>({receive:async e=>received.push(e),stop(){}})},'../services/identity/rootMessageFeedback':{subscribeRootMessageFeedback:fn=>{feedback=fn;return()=>feedback=null;}},'../services/identity/rootNotificationRoute':{},'../services/identity/rootNotificationPreferences':{},'../services/identity/localAccount':{localAccount:{status:()=>status,subscribe:fn=>{accountChanged=fn;return()=>{};}}},'../services/identity/rootVoiceRecorder':{},'./neuronRuntime':{},'../services/soundService':{stopMessageSounds:()=>stops++}};
 const out={};new Function('exports','require','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/composition/messageSounds.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>deps[n],fn=>{timers.add(fn);return fn;},fn=>timers.delete(fn));const stop=out.startMessageSounds();
 return {received,stop,stops:()=>stops,event:()=>feedback({owner:'owner',peer:'peer',id:'id',direction:'outgoing'}),flush:()=>{for(const fn of timers)fn();timers.clear();},state:next=>{app.currentState=next;lifecycle(next);},owner:next=>{status.account=next;accountChanged();}};
}
test('background events and foreground events interrupted by backgrounding cannot sound after resume',()=>{
 const f=fixture();f.state('background');f.event();f.state('active');f.flush();assert.equal(f.received.length,0);
 f.event();f.state('background');f.state('active');f.flush();assert.equal(f.received.length,0);f.event();f.flush();assert.equal(f.received.length,1);f.stop();
});
test('account replacement and cleanup cancel scheduled foreground effects',()=>{
 const f=fixture();f.event();f.owner('another');f.flush();assert.equal(f.received.length,0);assert(f.stops()>0);f.owner('owner');f.event();f.stop();f.flush();assert.equal(f.received.length,0);
});
