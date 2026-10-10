const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const exceptions = require('./consolidation-exceptions.json');
const seen = new Set(), failures = [];
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function resolve(from, request) {
  const base = request.startsWith('@/') ? path.join(root, 'src', request.slice(2))
    : request.startsWith('.') ? path.resolve(path.dirname(from), request) : null;
  if (!base) return null;
  return [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    .find(file => /\.tsx?$/.test(file) && fs.existsSync(file) && fs.statSync(file).isFile());
}
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function dependency(request) { const target = resolve(file, request); if (target) walk(target); }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) dependency(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
walk(path.join(root, 'index.ts'));
const runtime = new Set([...seen].map(relative));
for (const file of runtime)
  if (file.startsWith('tests/') || file.startsWith('builds/')) failures.push('App imports test/build support: ' + file);
for (const file of ['App.tsx', 'legacyEntry.ts', 'src/contexts/AuthContext.tsx', 'src/services/api.ts'])
  if (fs.existsSync(path.join(root, file))) failures.push('Retired app path reintroduced: ' + file);
for (const file of Object.keys(exceptions)) {
  if (!fs.existsSync(path.join(root, file))) failures.push('Stale consolidation exception: ' + file);
  else if (runtime.has(file)) failures.push('Review exception now used by app: ' + file);
  else walk(path.join(root, file));
}
function scan(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.tsx?$/.test(file) && !seen.has(file)) failures.push('Unreachable source needs removal or documented consumer: ' + relative(file));
  }
}
scan(path.join(root, 'src'));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Consolidation passed: one entry, ${runtime.size} reachable source modules, ${Object.keys(exceptions).length} documented support roots.`);
