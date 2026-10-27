const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function uiFiles(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?uiFiles(dir+'/'+e.name):/\.tsx?$/.test(e.name)?[dir+'/'+e.name]:[]);}
const screens=['src/screens','src/components','src/navigation'].flatMap(uiFiles);
const failures=[];
function imports(file){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);const entries=[];
 function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))entries.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require'))entries.push(n.arguments[0].text);ts.forEachChild(n,visit);}visit(source);return entries;}
for(const file of screens)for(const request of imports(file)){
 if(/services\/identity\//.test(request)||/modules\/axonic-nearby/.test(request)||/composition\/neuronRuntime/.test(request)||request==='@react-native-async-storage/async-storage')failures.push(file+' bypasses module API: '+request);
 if(/\/modules\//.test(request)&&! /\/modules\/(identity|maintenance|network|messaging|calls|media|storage|diagnostics|messaging\/notifications|ui\/keyboard|ui\/attachmentPreview|ui\/openAttachmentPreview|ui\/mediaPicker|ui\/documentPicker|ui\/sharedContent|ui\/useChatSnapshot|ui\/useChatActivity|ui\/useMessageStateClock|ui\/liveState|ui\/transferState)$/.test(request))failures.push(file+' imports a module implementation instead of its public API: '+request);
 if(/modules\/network$/.test(request)&&!['src/screens/LocalAccountApp.tsx','src/screens/profile/RootNetworkPanel.tsx','src/components/AxonLimitSetting.tsx','src/components/RelayInventoryPanel.tsx','src/components/chat/ChatConnectionBar.tsx','src/components/RecoverySettings.tsx'].includes(file))failures.push(file+' routes communication outside messaging');
}
for(const file of ['src/modules/messaging/commands.ts','src/modules/messaging/delivery.ts','src/modules/calls/commands.ts'])for(const request of imports(file)){
 if(/^(react|expo-|@react-native)|axonic-nearby|composition\/|modules\/ui|localAccountNetwork|localRootChat/.test(request))failures.push(file+' imports a platform or composition dependency: '+request);
}
for(const file of ['src/modules/storage/chatStore.ts','src/modules/storage/profileStore.ts'])for(const request of imports(file))if(/network|messaging|screens|components/.test(request))failures.push(file+' depends on a higher layer: '+request);
// Shared ports are declarations, not a new service locator or platform layer.
const portablePorts={
 'ownHistoryStore':[],
 'attachmentConnections':['identityClient'],
 'attachmentTypes':['attachmentProtocol','deliveryEvidence'],
 'attachmentTransferPorts':['attachmentTypes','attachmentProtocol','directAttachmentStream','attachmentConnections'],
 'relayStorage':['attachmentProtocol','custodyProtocol','groupCustodyProtocol'],
};
for(const [name,allowed] of Object.entries(portablePorts)){
 const file='src/services/identity/'+name+'.ts';
 for(const request of imports(file))if(!allowed.some(n=>request==='./'+n+'.ts'))failures.push(file+' imports outside its portable contract: '+request);
 const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
 for(const node of source.statements)if(!(ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isImportDeclaration(node)&&node.importClause?.isTypeOnly))failures.push(file+' must contain only types and type imports');
}
// Selection cannot acquire storage/scheduling/platform dependencies; the clock
// scheduler consumes a readiness predicate rather than selecting a connection.
for(const [name,allowed] of Object.entries({
 attachmentRouteSelection:['identityProtocol','attachmentProtocol','attachmentTypes','attachmentConnections'],
 attachmentSchedule:['attachmentTypes'],
}))for(const request of imports('src/services/identity/'+name+'.ts')){
 if(!allowed.some(n=>request==='./'+n+'.ts'))failures.push(name+' crosses selection/scheduling boundary: '+request);
}
// Internal ownership: selection persistence must not start transport work.
for(const request of imports('src/services/identity/rootAttachmentSelections.ts'))
 if(/rootAttachmentRuntime|attachmentTransfer|composition|react-native-webrtc/.test(request))failures.push('Attachment selections own persistence, not transfer execution: '+request);
for(const request of imports('src/services/callQualityMonitor.ts'))
 if(/react|expo-|composition|localAccount/.test(request))failures.push('Call quality monitor must remain platform-independent: '+request);
const navigatorSource=ts.createSourceFile('navigator',fs.readFileSync(path.join(root,'src/navigation/RootAccountNavigator.tsx'),'utf8'),ts.ScriptTarget.Latest,true);
for(const node of navigatorSource.statements)if(ts.isFunctionDeclaration(node)&&node.name?.text!=='RootAccountNavigator')failures.push('Navigator contains screen implementation: '+node.name?.text);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('Module boundaries passed ('+screens.length+' UI files; public module APIs, messaging core and storage adapters).');
