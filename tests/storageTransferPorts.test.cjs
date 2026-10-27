const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
test('portable ports reject storage-role substitution and keep network/storage capabilities separate',()=>{
 const file=path.resolve('tests/__storage_transfer_contract__.ts');
 const source=`
import type {OwnHistoryStore} from '../src/services/identity/ownHistoryStore';
import type {AttachmentJobStore,AttachmentFileStore,AttachmentTransferConnections} from '../src/services/identity/attachmentTransferPorts';
import type {AttachmentStore,CustodyStore} from '../src/services/identity/relayStorage';
import type {AttachmentStreams,WssStreamNetwork} from '../src/services/identity/attachmentConnections';
import {createAttachmentTransfer} from '../src/services/identity/attachmentTransfer';
declare const jobs:AttachmentJobStore,files:AttachmentFileStore,relay:AttachmentStore,history:OwnHistoryStore,network:AttachmentTransferConnections;
declare const lane:AttachmentStreams,wss:WssStreamNetwork;
// @ts-expect-error relay ciphertext transactions cannot replace own job CAS
const wrongJobs:AttachmentJobStore=relay;
// @ts-expect-error own private history cannot be used as a relay store
const wrongRelay:CustodyStore=history;
// @ts-expect-error own jobs are not a plaintext file adapter
const wrongFiles:AttachmentFileStore=jobs;
// @ts-expect-error network does not expose a job database
network.jobs.save();
// @ts-expect-error persistence cannot choose or call peers
files.request('peer','payload');
// @ts-expect-error stream lane provider cannot publish a message receipt
lane.completed();
// @ts-expect-error existing WSS session interface cannot discover peers
wss.discover();
declare const policy:Omit<Parameters<typeof createAttachmentTransfer>[0],'storage'|'connections'>;
createAttachmentTransfer({...policy,storage:{jobs,files},connections:network});
// @ts-expect-error flat job/network options are no longer a production boundary
createAttachmentTransfer({...policy,store:jobs,peers:()=>[],request:async()=>null});
`;
 const options={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,types:[]};
 const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
 host.getSourceFile=(name,...args)=>path.resolve(name)===file?ts.createSourceFile(file,source,options.target,true):original(name,...args);
 const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options,host));
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
});
