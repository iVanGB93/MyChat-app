const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {createHash}=require('node:crypto');
test('diagnostic review actions remain outside the scrollable report with safe-area padding',()=>{
 const source=ts.createSourceFile('panel.tsx',fs.readFileSync('src/components/DiagnosticReportPanel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const elements=[];function walk(n){if(ts.isJsxElement(n))elements.push(n);ts.forEachChild(n,walk);}walk(source);
 const attr=(node,name)=>node.openingElement.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text===name)?.initializer;
 const byId=id=>elements.find(e=>attr(e,'testID')?.text===id);
 const report=byId('diagnostic-report-text'),actions=byId('diagnostic-report-actions');
 assert(report&&actions);assert.equal(report.openingElement.tagName.getText(source),'ScrollView');assert.equal(actions.openingElement.tagName.getText(source),'View');assert.equal(report.parent,actions.parent);
 assert.match(attr(report,'style').getText(source),/flex:1/);assert.match(attr(actions,'style').getText(source),/flexShrink:0/);assert.match(attr(actions,'style').getText(source),/insets.bottom/);
 for(const title of ['CONFIRM & SEND TO THIS AON','SHARE WITH ANOTHER APP',"CANCEL — DON'T SEND"]){assert(actions.getText(source).includes(title));assert(!report.getText(source).includes(title));}
 assert(report.getText(source).includes('draft?.json'));assert(report.getText(source).includes('draft?.summary'));assert(actions.getText(source).includes('accessibilityRole="alert"'));
});

test('external diagnostic sharing sends the complete reviewed JSON as a file',async()=>{
 const json=JSON.stringify({summary:'Conexión 📶',entries:'x'.repeat(48000),last:'Report complete'},null,2);
 const id=createHash('sha256').update(json).digest('hex'),writes=new Map(),shares=[];
 class Directory {
  constructor(base,name){this.uri=base+'/'+name;}
  create(){}
  list(){return [];}
 }
 class File {
  constructor(directory,name){this.uri=directory.uri+'/'+name;}
  write(text){writes.set(this.uri,text);}
 }
 const mocks={
  'expo-file-system':{Directory,File,Paths:{cache:'file:///cache'}},
  'expo-sharing':{isAvailableAsync:async()=>true,shareAsync:async(uri,options)=>shares.push({uri,options})},
  '@noble/hashes/sha2.js':{sha256:bytes=>createHash('sha256').update(bytes).digest()},
  '@noble/hashes/utils.js':{bytesToHex:bytes=>Buffer.from(bytes).toString('hex')},
  '../services/identity/localAccount':{localAccount:{status:()=>({state:'unlocked',account:'owner'})}},
  '../services/identity/rootAttachmentSelections':{diagnosticAttachmentName:id=>`axonic-diagnostic-v2-${id}.json`},
  '../services/diagnosticReport':{REPORT_MAX_BYTES:65536},
 };
 const source=ts.transpileModule(fs.readFileSync('src/composition/diagnosticReports.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const api={};new Function('exports','require',source)(api,name=>mocks[name]??{});
 const draft={json,id,owner:'owner',expiresAt:Date.now()+60000};
 await api.shareDiagnosticReport(draft,'Axonic diagnostic report');
 assert.equal(shares.length,1);
 const [{uri,options}]=shares;
 assert.match(uri,/\.json$/);
 assert.equal(options.mimeType,'application/json');
 assert.equal(writes.get(uri),json);
 assert.equal(createHash('sha256').update(writes.get(uri)).digest('hex'),id);
 await assert.rejects(api.shareDiagnosticReport({...draft,json:json.slice(0,-1)},'Report'),/Report changed/);
 await assert.rejects(api.shareDiagnosticReport({...draft,owner:'other'},'Report'),/Unlock the same account/);
 assert.equal(shares.length,1);
});
