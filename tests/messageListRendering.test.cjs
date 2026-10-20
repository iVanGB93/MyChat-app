const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/components/chat/message-list-rendering.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('chat rendering retains the initial batch, variable heights and adequate overscan',()=>{
 assert.deepEqual(mod.messageListRendering,{initialNumToRender:10,maxToRenderPerBatch:4,windowSize:7});
 assert.equal('getItemLayout' in mod.messageListRendering,false);
 assert.equal('removeClippedSubviews' in mod.messageListRendering,false);
});
test('private and group lists share the render policy without slicing history or changing inversion',()=>{
 for(const file of ['src/navigation/RootAccountNavigator.tsx','src/screens/chat/RootGroupScreens.tsx']){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),matches=[];
  function visit(n){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(source)==='FlatList'&&n.attributes.properties.some(a=>ts.isJsxSpreadAttribute(a)&&a.expression.getText(source)==='messageListRendering'))matches.push(n);ts.forEachChild(n,visit);}visit(source);
  assert.equal(matches.length,1,file);const props=matches[0].attributes.properties;
  assert(props.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='inverted'&&!p.initializer));
  const data=props.find(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='data');assert.equal(data.initializer.expression.getText(source),'messages');
  // Progress events must keep the same state when an unchanged snapshot returns.
  assert.match(fs.readFileSync(file,'utf8'),/setTransfers\(previous=>JSON\.stringify\(previous\)===JSON\.stringify\(v\)\?previous:v\)/);
 }
});
