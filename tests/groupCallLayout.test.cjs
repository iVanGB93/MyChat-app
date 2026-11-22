const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('group video gives remote participants equal vertical space and keeps self in a small draggable preview',()=>{
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const imports={react:{default:react,...react},'react-native':{View:'View',Modal:'Modal',Text:'Text',Platform:{OS:'android'},StyleSheet:{absoluteFill:{position:'absolute'}}},'react-native-webrtc':{RTCView:'RTCView'},'@expo/vector-icons':{Ionicons:'Icon'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,right:0})},'../../contexts/ThemeContext':{useTheme:()=>({colors:{}})},'./CallAppearance':{makeStyles:()=>({selfView:{width:110},pipWrap:{height:150},pip:{flex:1}})},'./DraggableCallPreview':{default:'Preview'},'./CallStage':{CallLayout:'Layout'}};
 const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/screens/calls/CallSessionScreen.tsx','utf8'),{compilerOptions:{module:1,target:9,jsx:2}}).outputText)(mod,n=>(require('./helpers/localization.cjs')(n)??(imports[n]??{})));
 const tree=mod.default({video:true,participants:[{id:'self',local:true,stream:'self'},{id:'a',stream:'a'},{id:'b',stream:'b'}]});
 const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
 const animation=(video,incoming)=>walk(mod.default({video,incoming})).find(n=>n.type==='Modal').props.animationType;
 assert.equal(animation(true,true),'none');
 assert.equal(animation(true,false),'slide');
 assert.equal(animation(false,true),'slide');
 const layout=walk(tree).find(n=>n.type==='Layout'),nodes=walk(layout.props.background);
 const tiles=nodes.filter(n=>n.props?.testID==='axonic-group-remote-tile');assert.equal(tiles.length,2);const label=walk(tiles[1]).find(n=>n.props?.style?.top===12);assert(label,'lower participant label belongs at the top of its half');tiles.forEach(n=>assert.equal(n.props.style.flex,1));
 const remote=tiles.flatMap(walk).filter(n=>n.type==='RTCView');assert.deepEqual(remote.map(n=>n.props.streamURL),['a','b']);
 const four=mod.default({video:true,participants:[{id:'self',local:true,stream:'self'},{id:'a',stream:'a'},{id:'b',stream:'b'},{id:'c',stream:'c'}]});
 const grid=walk(walk(four).find(n=>n.type==='Layout').props.background);
 const cells=grid.filter(n=>['axonic-group-remote-tile','axonic-group-self-tile'].includes(n.props?.testID));
 assert.equal(cells.length,4);for(const cell of cells){assert.equal(cell.props.style.width,'50%');assert.equal(cell.props.style.height,'50%');}
 assert.equal(grid.filter(n=>n.type==='Preview').length,0,'self is a quadrant, not an extra floating preview');
 assert.equal(grid.filter(n=>n.type==='RTCView'&&n.props.mirror===true).length,1,'only own camera is mirrored');
 const preview=nodes.find(n=>n.type==='Preview');assert.equal(preview.props.style[0].width,110);assert.equal(walk(preview).find(n=>n.type==='RTCView').props.streamURL,'self');
 // Keep the same roster while live media leaves/rejoins: no stale video slots.
 const roster=[{id:'self',local:true,stream:'self',speaking:true},{id:'a',stream:'a',connected:true,speaking:true},{id:'b',stream:'b',connected:true},{id:'c',stream:'c',connected:true}];
 const render=()=>walk(walk(mod.default({video:true,participants:roster})).find(n=>n.type==='Layout').props.background);
 const tileNodes=nodes=>nodes.filter(n=>['axonic-group-remote-tile','axonic-group-self-tile'].includes(n.props?.testID));
 assert.equal(tileNodes(render()).length,4);
 roster[3].connected=false;
 assert.equal(tileNodes(render()).length,2,'three connected people use two remote halves plus own preview');
 roster[2].connected=false;
 let live=render();assert.equal(tileNodes(live).length,1,'one remaining remote fills the stage');
 assert.deepEqual(live.filter(n=>n.type==='RTCView').map(n=>n.props.streamURL),['a','self'],'disconnected streams must not remain as placeholders');
 for(const tile of tileNodes(live))assert.equal(tile.props.style.borderWidth??0,0,'speaking never adds a video outline');
 assert.equal(live.find(n=>n.type==='Preview').props.children[0].props.style.borderWidth,undefined,'self preview has no speaking border override');
 roster[1].stream=undefined;live=render();assert.equal(tileNodes(live).length,1,'connected camera-off participant retains their place');
 roster[2].connected=true;assert.equal(tileNodes(render()).length,2,'rejoining participant restores the split');
 roster[3].connected=true;assert.equal(tileNodes(render()).length,4,'four connected participants restore quadrants');
});
