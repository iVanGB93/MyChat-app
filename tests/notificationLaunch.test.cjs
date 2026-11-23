const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/navigation/RootAccountNavigator.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText;
function fixture(target){
 let state=null,owner='owner',ready=false,initialResolve;const effects=[],navigations=[],finished=[],refs=[];let pending=target;let cursor=0,first=true;
 const initial=new Promise(r=>initialResolve=r),identity={status:()=>({account:owner,state:'unlocked'}),subscribe:()=>()=>{}};
 const nav={isReady:()=>ready,navigate:(...v)=>navigations.push(v),getCurrentRoute:()=>null};
 const react={createElement:(type,props,...children)=>({type,props:props??{},children}),useState:()=>[state,v=>state=v],useRef:v=>{const i=cursor++;return refs[i]??={current:v};},useEffect:fn=>{if(first)effects.push(fn);}};
 const notifications={subscribeRootNotificationOpen:()=>()=>{},setRootVisibleConversation:()=>{},queueRootNotificationOpen:async()=>{},pendingRootNotificationOpen:async a=>a===owner?pending:null,finishRootNotificationOpen:async t=>{finished.push(t);if(pending===t)pending=null;},handleRootNotificationAction:async()=>{}};
 const imports={'../services/diagnosticJournal':{diagnosticJournal:{record(){}}},'react':{...react,default:react},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Keyboard:{dismiss(){}},View:'View',ActivityIndicator:'Spinner'},'@react-navigation/native':{NavigationContainer:'Navigation',DarkTheme:{colors:{}},DefaultTheme:{colors:{}},createNavigationContainerRef:()=>nav},'@react-navigation/native-stack':{createNativeStackNavigator:()=>({Navigator:'Stack',Screen:'Screen'})},'@react-navigation/bottom-tabs':{createBottomTabNavigator:()=>({Navigator:'Tabs',Screen:'Tab'})},'@notifee/react-native':{default:{onForegroundEvent:()=>()=>{},getInitialNotification:()=>initial},EventType:{PRESS:1,ACTION_PRESS:2}},'../modules/identity':{localAccount:identity,takeIdentityLink:()=>null,subscribeIdentityLinks:()=>()=>{}},'../modules/messaging/notifications':notifications,'../contexts/ThemeContext':{useTheme:()=>({colors:{},isDark:true})},'./main-tab-options':{useMainTabOptions:()=>({})},'../theme':{Font:{semiBold:{}}}};
 const out={};new Function('exports','require',code)(out,n=>{const localized=require('./helpers/localization.cjs')(n);if(localized)return localized;if(n==='../modules/messaging')throw Error('navigation must not wait for ledger metadata');return imports[n]??{default:'Component'};});
 const render=()=>{cursor=0;const v=out.default({});first=false;return v;};
 return {render,effects,navigations,finished,state:()=>state,resolve:()=>initialResolve(null),owner:v=>owner=v,ready:()=>ready=true};
}
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
test('cold notification selects chat before mounting navigation; no intermediate chat list',async()=>{
 for(const target of [{sender:'sender'},{sender:'sender',group:'group'}]){const f=fixture(target);assert.equal(f.render().type,'View');f.effects.forEach(fn=>fn());assert.equal(f.state(),null);f.resolve();await flush();assert.equal(f.state().index,1);assert.equal(f.state().routes[1].name,target.group?'GroupRoom':'ChatRoom');assert.deepEqual(f.navigations,[]);const tree=f.render();const nav=tree.children.find(x=>x?.type==='Navigation');assert.equal(nav.props.initialState,f.state());f.ready();nav.props.onReady();await flush();assert.equal(f.finished.length,1);assert.deepEqual(f.navigations,[]);}
});
test('normal launch, unresolved hint and changed account never open another account chat',async()=>{
 for(const target of [null,{sender:'sender',inbox:true},{sender:'sender'}]){const f=fixture(target);f.render();f.effects.forEach(fn=>fn());if(target&&!target.inbox)f.owner('other');f.resolve();await flush();assert.equal(f.state().index,0);assert.equal(f.state().routes.length,1);assert.equal(f.state().routes[0].name,'Tabs');}
});
