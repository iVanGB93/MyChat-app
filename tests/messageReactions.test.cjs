const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/message-reactions.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('reaction badges group matching emoji, count participants and mark the local choice',()=>{
 assert.deepEqual(mod.messageReactionBadges([{author:'a',text:'👍'},{author:'b',text:'👍'},{author:'c',text:'❤️'},{author:'d',text:''},{author:'a',text:'👍'}],'b'),[{emoji:'👍',count:2,mine:true},{emoji:'❤️',count:1,mine:false}]);
 assert.deepEqual(mod.messageReactionBadges([]),[]);
});
