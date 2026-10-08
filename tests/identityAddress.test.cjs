const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/identityPresentation.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>n==='./identityProtocol.ts'?{validAccountId:v=>typeof v==='string'&&/^axonic:1:[a-f0-9]{64}$/.test(v)}:require(n));
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',hash=b=>crypto.createHash('sha256').update(b).digest();
// Independent byte-array division encoder, with Node/OpenSSL SHA-256.
function reference(bytes){let digits=Array.from(bytes),text='',zeros=0;while(bytes[zeros]===0)zeros++;while(digits.length){let remainder=0,next=[];for(const byte of digits){const n=remainder*256+byte,value=Math.floor(n/58);remainder=n%58;if(next.length||value)next.push(value);}text=alphabet[remainder]+text;digits=next;}return 'axon:'+'1'.repeat(zeros)+text;}
test('wallet-style address preserves every identity bit and matches independent Base58Check encoding',()=>{
 for(const bytes of [Buffer.alloc(32),Buffer.alloc(32,255),Buffer.from('00'.repeat(12)+'ab'.repeat(20),'hex'),...Array.from({length:40},()=>crypto.randomBytes(32))]){
 const account='axonic:1:'+bytes.toString('hex'),code=out.displayIdentity(account),checked=Buffer.concat([bytes,hash(hash(bytes)).subarray(0,4)]);
 assert.equal(code,reference(checked));assert.equal(out.parseIdentityCode(code),account);assert(code.length<68);
 assert.equal(out.parseIdentityCode('axon'+bytes.toString('hex')),account);assert.equal(out.parseIdentityCode(account),account);
 }
});
test('short labels cannot be used as identity addresses; checksum rejects changes and noncanonical forms',()=>{
 const account='axonic:1:'+'ab'.repeat(32),code=out.displayIdentity(account);
 assert.equal(out.parseIdentityCode(out.shortIdentity(account)),null);
 for(let i=5;i<code.length;i++){const changed=code.slice(0,i)+(code[i]==='1'?'2':'1')+code.slice(i+1);assert.equal(out.parseIdentityCode(changed),null);}
 for(const invalid of [code.slice(0,-1),'axon:1'+code.slice(5),code+'1','axon:0'+code.slice(6),'axon:'+('z'.repeat(5000)),code.toUpperCase()])assert.equal(out.parseIdentityCode(invalid),null);
 assert.equal(out.parseIdentityCode('  '+code+'\n'),account);
});
