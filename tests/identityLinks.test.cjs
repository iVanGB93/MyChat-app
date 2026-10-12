const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('./helpers/attachment.cjs'),links=load('identityLinks');
const account='axonic:1:'+'ab'.repeat(32);
test('New Chat accepts the exact previously rejected shared custom-scheme link',()=>{
 const url='axonic://identity/axon%3A28HZJmrpaxV5hr84nazhP91K8woZXdvrfeE1xqCkxPTFfxi22S';
 const expected=load('identityPresentation').parseIdentityCode('axon:28HZJmrpaxV5hr84nazhP91K8woZXdvrfeE1xqCkxPTFfxi22S');
 assert(expected);assert.equal(load('identityPresentation').parseIdentityCode(url),null);
 assert.equal(links.parseIdentityInput(url),expected);
});
test('share links use HTTPS and pasting accepts links, full codes and clipboard formatting',()=>{
 const code='axon:L8HfT2dk1oNSjCZsYK3MbUD8ZSskMKY73ZmdRNYhLmCRYS37c',parsed=links.parseIdentityInput(code);
 assert(parsed);assert.equal(links.identityLink(parsed),'https://chat.qbared.com/identity/'+encodeURIComponent(code)+'/');
 for(const value of [links.identityLink(parsed),'axonic://identity/'+encodeURIComponent(code),code.slice(0,25)+'\n'+code.slice(25),'\u200e'+code+'\u200f'])assert.equal(links.parseIdentityInput(value),parsed);
 for(const value of ['axon:L8HfT2…RYS37c',code.slice(0,-1),'https://evil.example/identity/'+code,'https://chat.qbared.com.evil.example/identity/'+code,'https://chat.qbared.com/identity/'+code+'/?x=y'])assert.equal(links.parseIdentityInput(value),null);
});
test('identity links roundtrip full checked addresses and reject foreign or malformed routes',()=>{const url=links.identityLink(account);assert.equal(links.parseIdentityLink(url),account);for(const invalid of ['https://evil/identity/'+account,'axonic://identity/%ZZ','axonic://identity/123','axonic://identity/'+account+'?secret=x',url+'#x','axonic://room/22','x'.repeat(257)])assert.equal(links.parseIdentityLink(invalid),null);});
test('pending identity links retain only the latest valid address until explicitly consumed',()=>{const other='axonic:1:'+'cd'.repeat(32);links.queueIdentityLink(links.identityLink(account));links.queueIdentityLink('invalid');assert.equal(links.takeIdentityLink(),account);assert.equal(links.takeIdentityLink(),null);links.queueIdentityLink(links.identityLink(account));links.queueIdentityLink(links.identityLink(other));assert.equal(links.takeIdentityLink(),other);});
