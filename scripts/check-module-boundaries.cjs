const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const screens=[
 'src/screens/LocalAccountApp.tsx','src/navigation/RootAccountNavigator.tsx',
 'src/screens/chat/RootGroupScreens.tsx','src/screens/calls/RootAccountCallScreen.tsx',
 'src/screens/profile/RootProfileScreen.tsx','src/screens/profile/RootNetworkPanel.tsx','src/screens/profile/RootChatStorageScreen.tsx',
 'src/components/RootAttachmentBubble.tsx','src/components/RootIdentityScanner.tsx','src/components/IdentityLookup.tsx','src/components/AxonLimitSetting.tsx',
 ...fs.readdirSync(path.join(root,'src/components/chat')).filter(n=>/^Root.*\.tsx$/.test(n)).map(n=>'src/components/chat/'+n),
];
const failures=[];
function imports(file){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);const entries=[];
 function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))entries.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require'))entries.push(n.arguments[0].text);ts.forEachChild(n,visit);}visit(source);return entries;}
for(const file of screens)for(const request of imports(file)){
 if(/services\/identity\//.test(request)||/modules\/axonic-nearby/.test(request)||/composition\/neuronRuntime/.test(request)||request==='@react-native-async-storage/async-storage')failures.push(file+' bypasses module API: '+request);
 if(/\/modules\//.test(request)&&! /\/modules\/(identity|network|messaging|storage|messaging\/notifications|ui\/mediaPicker|ui\/documentPicker)$/.test(request))failures.push(file+' imports a module implementation instead of its public API: '+request);
 if(/modules\/network$/.test(request)&&!['src/screens/LocalAccountApp.tsx','src/screens/profile/RootNetworkPanel.tsx','src/components/AxonLimitSetting.tsx'].includes(file))failures.push(file+' routes communication outside messaging');
}
for(const file of ['commands','delivery','callCommands'].map(n=>'src/modules/messaging/'+n+'.ts'))for(const request of imports(file)){
 if(/^(react|expo-|@react-native)|axonic-nearby|composition\/|modules\/ui|localAccountNetwork|localRootChat/.test(request))failures.push(file+' imports a platform or composition dependency: '+request);
}
for(const file of ['src/modules/storage/chatStore.ts','src/modules/storage/profileStore.ts'])for(const request of imports(file))if(/network|messaging|screens|components/.test(request))failures.push(file+' depends on a higher layer: '+request);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('Module boundaries passed ('+screens.length+' active UI files; messaging core and storage adapters).');
