const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
// Use production tokens so visual changes do not invalidate behavior fixtures.
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/theme/index.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
