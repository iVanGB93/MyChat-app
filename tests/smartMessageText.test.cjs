const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 let deps,value,parses=0;const opened=[],copied=[],alerts=[];
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props,children}),useMemo:(fn,next)=>{if(!deps||next.some((v,i)=>v!==deps[i])){value=fn();deps=next;parses++;}return value;}};
 const mod={},requireMock=name=>name==='react'?react:name==='react-native'?{Text:'Text',StyleSheet:{create:v=>v},Linking:{openURL:url=>{opened.push(url);return Promise.resolve();}},Alert:{alert:(...args)=>alerts.push(args)}}:name==='expo-clipboard'?{setStringAsync:v=>{copied.push(v);return Promise.resolve();}}:(()=>{throw Error(name);})();
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/SmartMessageText.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2,esModuleInterop:true}}).outputText)(requireMock,mod);
 return {render:(text,color='cyan')=>mod.default({children:text,linkColor:color}),parses:()=>parses,opened,copied,alerts,mod};
}
test('message parsing is reused for status/theme renders but invalidated by edits',()=>{
 const f=fixture(),text='Hello https://example.com, user@example.com +1 (212) 555-1234';
 const first=f.render(text);for(let i=0;i<20;i++)f.render(text,i%2?'pink':'cyan');assert.equal(f.parses(),1);
 assert.equal(first.props.selectable,true);assert.equal(first.children[0].map(n=>n.children.join('')).join(''),text);
 const changed=f.render('Updated https://other.example/path','pink');assert.equal(f.parses(),2);
 const link=changed.children[0].find(n=>n.props.accessibilityRole==='link');assert.equal(link.props.style[1].color,'pink');link.props.onPress();assert.deepEqual(f.opened,['https://other.example/path']);
 // A separate mounted message has no shared cache of another message's text.
 const second=fixture();second.render(text);assert.equal(second.parses(),1);
});
test('cached smart text keeps URL, email, phone, coordinates and copy actions',()=>{
 const f=fixture(),text='example.com/path, user@example.com; +1 (212) 555-1234; 25.7617, -80.1918';
 const node=f.render(text),links=node.children[0].filter(n=>n.props.accessibilityRole==='link');
 for(const link of links)link.props.onPress();
 assert.deepEqual(f.opened,['https://example.com/path','mailto:user@example.com','tel:+12125551234','geo:25.7617,-80.1918']);
 const phone=links.find(n=>n.props.accessibilityLabel==='Open phone');phone.props.onLongPress();
 f.alerts[0][2].find(action=>action.text==='Copy').onPress();assert.deepEqual(f.copied,['+12125551234']);
 assert.equal(f.mod.getFirstMessageUrl(text),'https://example.com/path');
 assert.equal(f.mod.getFirstMessageUrl('plain message'),null);
});
