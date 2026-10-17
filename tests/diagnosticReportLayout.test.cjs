const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
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
