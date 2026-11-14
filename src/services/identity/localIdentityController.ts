import type {ReceivedRoute} from './deliveryEvidence';
import {sealGroupCustody,openGroupCustody,verifyGroupCustodyPayload,type GroupCustodyPayload} from './groupCustodyProtocol';
import {joinGroupCustodyMessage} from './groupCustodyMessages';
import {signProfile} from './rootProfileProtocol';
import { sealCustody, openCustody, verifyCustody, signCustodyReceipt, type CustodyEnvelope } from './custodyProtocol';
import {signAttachmentManifest,signAttachmentReceipt,type AttachmentManifest} from './attachmentProtocol';
import { signAxonSignal, type AxonSignal } from './axonSignaling';
import { signCallControl, type CallControl } from './callControlProtocol';
import { signCallControlReceipt } from './callControlDelivery';
import { signCallMediaSignal, type CallMediaSignal } from './callMediaProtocol';
import { advertiseGroupCustody, supportsSignedGroupCustody, publicDevice, recordDigest } from './identityProtocol';
import {signRootGroupBackup} from './rootGroups';
import type {RootGroupMembership} from './rootGroupTypes';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { verifyRecord, renewIdentityRecord, validRecordHistory, HISTORY_BYTES, HISTORY_RECORDS, type IdentityRecord } from './identityProtocol';
import { signIdentityRequest, type IdentityRequest, type IdentityRecordStore } from './identityAdmission';
import { createLocalIdentity, recoverReplacingDevices, destroyIdentity, sealIdentity, unlockIdentity, rootFromEntropy,
  type SecureRandom, type UnlockedIdentity, type PasswordDerivation } from './identityVault';

export interface IdentityStorage {
  beginRemoval?(account:string):Promise<void>;
  readVault(): Promise<string | null>;
  writeVault(value: string): Promise<void>;
  readDeviceSecret(): Promise<string | null>;
  writeDeviceSecret(value: string): Promise<void>;
}
export interface LocalIdentityStatus { state: 'empty' | 'locked' | 'unlocked' | 'backup'; account: string | null; busy: boolean; removalPending?:boolean }
/** One local cryptographic account with controller-owned keys. */
export function createLocalIdentityController(storage: IdentityStorage, random: SecureRandom, now: () => number,
  derive?: PasswordDerivation) {
  let identity: UnlockedIdentity | null = null, draft: UnlockedIdentity | null = null;
  // Public, deterministic metadata only; never retain a seed or unlocked identity here.
  // Re-derive once per unlock, rather than doing two curve operations for every chunk.
  let cachedDeviceId: string | null = null, removing=false;
  let account: string | null = null, state: LocalIdentityStatus['state'] = 'empty', busy = false, epoch = 0;
  const connections = new Set<() => void>();
  const closeConnections = () => {
    const pending=[...connections];
    connections.clear();
    for(const revoke of pending)revoke();
  };
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const assertCurrent = (e: number) => { if (epoch !== e) throw Error('Account operation interrupted'); };
  async function exclusive<T>(work: (e: number) => Promise<T>): Promise<T> {
    if(removing)throw Error('Close and reopen Axonic to finish removing this account');
    if (busy) throw Error('An account operation is already running');
    busy = true; const e = epoch; emit();
    try { return await work(e); } finally { busy = false; emit(); }
  }
  return {
    prepareLockedDeviceRemoval(expectedAccount:string,confirmed:true){return exclusive(async e=>{
      if(confirmed!==true||state!=='locked'||identity||draft||account!==expectedAccount||!storage.beginRemoval)throw Error('Account changed');
      const raw=await storage.readVault();assertCurrent(e);
      const record=raw&&JSON.parse(raw).record;
      if(!record||record.account!==expectedAccount||!verifyRecord(record,now(),true))throw Error('Account changed');
      try{await storage.beginRemoval(expectedAccount);}finally{
        removing=true;epoch++;closeConnections();emit();
      }
    });},
    status(): LocalIdentityStatus { return { state, account, busy,...(removing?{removalPending:true}:{}) }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    inspect() { return exclusive(async e => {
      const raw = await storage.readVault(); assertCurrent(e);
      if (!raw) { if (!identity && !draft) { state = 'empty'; account = null; } return; }
      if (raw.length > 12_000) throw Error('Invalid account storage');
      const parsed = JSON.parse(raw);
      if (!verifyRecord(parsed.record, now(), true)) throw Error('Invalid account storage');
      account = parsed.record.account; if (!identity && !draft) state = 'locked';
    }); },
    beginCreate() { return exclusive(async e => {
      if (identity || draft || await storage.readVault()) throw Error('A local identity already exists');
      assertCurrent(e);
      const created = await createLocalIdentity(random, now());
      try { assertCurrent(e); draft = created.identity; state = 'backup'; return created.recoveryPhrase; }
      catch (error) { destroyIdentity(created.identity); throw error; }
    }); },
    /** Stage this installation's existing identity for a new local password and verified backup.
     * Source storage is read-only; no replacement root/device or recovery revision is minted. */
    beginImport(raw: string, password: string, secretHex: string) { return exclusive(async e => {
      if(identity||draft||await storage.readVault())throw Error('A local identity already exists');
      assertCurrent(e);
      if(raw.length>12000||!/^[0-9a-f]{64}$/.test(secretHex))throw Error('Existing identity protection is unavailable');
      const secret=hexToBytes(secretHex);let opened:UnlockedIdentity|undefined;
      try{
        opened=await unlockIdentity(raw,password,secret,now(),derive);assertCurrent(e);
        const words=entropyToMnemonic(opened.entropy,wordlist);
        draft=opened;opened=undefined;state='backup';return words;
      }finally{secret.fill(0);if(opened)destroyIdentity(opened);}
    }); },
    confirmBackup(phrase: string, password: string) { return exclusive(async e => {
      const source = draft;
      if (!source || phrase.trim().toLowerCase().replace(/\s+/g, ' ') !== entropyToMnemonic(source.entropy, wordlist)) {
        throw Error('Recovery words do not match');
      }
      if (await storage.readVault()) throw Error('A local identity already exists');
      assertCurrent(e);
      // Copy secrets so locking during an async KDF cannot mutate the operation's input.
      const copy: UnlockedIdentity = { entropy: source.entropy.slice(), signingSeed: source.signingSeed.slice(),
        encryptionSeed: source.encryptionSeed.slice(), record: source.record, history:source.history };
      let secret: Uint8Array | undefined;
      try {
        secret = await random(32);
        assertCurrent(e);
        const sealed = await sealIdentity(copy, password, secret, random, now(), derive); assertCurrent(e);
        await storage.writeDeviceSecret(bytesToHex(secret)); assertCurrent(e);
        await storage.writeVault(JSON.stringify(sealed));
        // A completed disk write remains recoverable if background locking raced with it.
        account = sealed.record.account;
        if (epoch !== e) { state = 'locked'; return; }
        identity = source; cachedDeviceId = null; draft = null; state = 'unlocked';
      } finally { secret?.fill(0); destroyIdentity(copy); }
    }); },
    /** Fresh vault authentication; never disturb the live identity, axons or call session. */
    revealRecoveryWords(password:string,expectedAccount:string){return exclusive(async e=>{
      if(!identity||account!==expectedAccount)throw Error('Unlock this account first');
      const raw=await storage.readVault(),secretHex=await storage.readDeviceSecret();assertCurrent(e);
      if(!raw||!secretHex||!/^[0-9a-f]{64}$/.test(secretHex))throw Error('Account protection unavailable');
      const secret=hexToBytes(secretHex);let verified:UnlockedIdentity|undefined;
      try{
        verified=await unlockIdentity(raw,password,secret,now(),derive);assertCurrent(e);
        if(verified.record.account!==expectedAccount||account!==expectedAccount)throw Error('Account changed');
        return entropyToMnemonic(verified.entropy,wordlist);
      }finally{secret.fill(0);if(verified)destroyIdentity(verified);}
    });},
    /** Public metadata only. Recovery still requires the separately saved words. */
    recoveryRecord() {
      if (!identity || busy) throw Error('Unlock the local account first');
      return JSON.stringify({ version: 1, record: identity.record, history: identity.history ?? [] });
    },
    restore(phrase: string, recoveryRecord: string, password: string, verify?: () => Promise<void>, expectedAccount?:string) { return exclusive(async e => {
      const raw=await storage.readVault();
      if(identity||draft)throw Error('A local identity already exists');
      const local=expectedAccount&&raw?JSON.parse(raw).record:undefined;
      if(expectedAccount){
        if(state!=='locked'||account!==expectedAccount||!local||local.account!==expectedAccount||!verifyRecord(local,now(),true)||!verify)throw Error('Account changed');
      }else if(raw)throw Error('A local identity already exists');
      assertCurrent(e);
      if (recoveryRecord.length > 12_000) throw Error('Invalid recovery record');
      const packet = JSON.parse(recoveryRecord);
      if (packet.version !== 1 || !validRecordHistory(packet.history, packet.record, now())) throw Error('Invalid recovery record');
      if(local&&(packet.record.account!==expectedAccount||![...packet.history,packet.record].some(record=>recordDigest(record)===recordDigest(local))))throw Error('Recovery record does not match the locked account');
      const restored = await recoverReplacingDevices(phrase, packet.record, random, now());
      let secret: Uint8Array | undefined;
      try {
        assertCurrent(e);
        if (verify) { await verify(); assertCurrent(e); }
        restored.history = [...packet.history, packet.record];
        while (restored.history.length > HISTORY_RECORDS || new TextEncoder().encode(JSON.stringify(restored.history)).length > HISTORY_BYTES) restored.history.shift();
        if(local){
          const savedSecret=await storage.readDeviceSecret();
          if(!savedSecret||!/^[0-9a-f]{64}$/.test(savedSecret))throw Error('Local account storage is unavailable');
          secret=hexToBytes(savedSecret);
        }else secret=await random(32);
        assertCurrent(e);
        const sealed = await sealIdentity(restored, password, secret, random, now(), derive); assertCurrent(e);
        if (verify) { await verify(); assertCurrent(e); }
        if(!local){await storage.writeDeviceSecret(bytesToHex(secret));assertCurrent(e);}
        await storage.writeVault(JSON.stringify(sealed));
        account = sealed.record.account; state = 'locked';
        // Restored accounts require an explicit unlock; a background race never exposes keys.
      } finally { secret?.fill(0); destroyIdentity(restored); }
    }); },
    unlock(password: string) { return exclusive(async e => {
      if (draft) throw Error('Finish or cancel account creation first');
      const raw = await storage.readVault(), secretHex = await storage.readDeviceSecret(); assertCurrent(e);
      if (!raw || !secretHex || !/^[0-9a-f]{64}$/.test(secretHex)) throw Error('Local account storage is unavailable');
      const secret = hexToBytes(secretHex);
      let opened: UnlockedIdentity | undefined;
      try {
        opened = await unlockIdentity(raw, password, secret, now(), derive); assertCurrent(e);
        const root = rootFromEntropy(opened.entropy);
        let renewed: ReturnType<typeof renewIdentityRecord>;
        try {
          const device=publicDevice(opened.signingSeed,opened.encryptionSeed);
          const devices=!supportsSignedGroupCustody(opened.record,now())&&opened.record.devices[0]?.id===device.id
            ?opened.record.devices.map(d=>d.id===device.id?advertiseGroupCustody(opened!.record.account,d,opened!.signingSeed):d)
            :opened.record.devices;
          renewed = renewIdentityRecord(root, opened.record, opened.history ?? [], now(),devices);
        }
        finally { root.fill(0); }
        if (renewed) {
          opened.record = renewed.record; opened.history = renewed.history;
          const sealed = await sealIdentity(opened, password, secret, random, now(), derive); assertCurrent(e);
          await storage.writeVault(JSON.stringify(sealed)); assertCurrent(e);
        }
        closeConnections(); if (identity) destroyIdentity(identity);
        identity = opened; cachedDeviceId = null; opened = undefined; account = identity.record.account; state = 'unlocked';
      } finally { secret.fill(0); if (opened) destroyIdentity(opened); }
    }); },

    prepareDeviceRemoval(password:string,expectedAccount:string){return exclusive(async e=>{
      if(!identity||account!==expectedAccount||!storage.beginRemoval)throw Error('Unlock this account before removing it');
      const raw=await storage.readVault(),secretHex=await storage.readDeviceSecret();assertCurrent(e);
      if(!raw||!secretHex||!/^[0-9a-f]{64}$/.test(secretHex))throw Error('Account protection unavailable');
      const secret=hexToBytes(secretHex);let verified:UnlockedIdentity|undefined;
      try{
        verified=await unlockIdentity(raw,password,secret,now(),derive);assertCurrent(e);
        if(verified.record.account!==expectedAccount)throw Error('Account changed');
        try{await storage.beginRemoval(expectedAccount);}finally{
          removing=true;epoch++;closeConnections();if(identity)destroyIdentity(identity);if(draft)destroyIdentity(draft);
          identity=null;draft=null;cachedDeviceId=null;state='locked';emit();
        }
      }finally{secret.fill(0);if(verified)destroyIdentity(verified);}
    });},
    changePassword(currentPassword:string,newPassword:string){return exclusive(async e=>{
      if(!identity)throw Error('Unlock the local account first');
      const raw=await storage.readVault(),secretHex=await storage.readDeviceSecret();assertCurrent(e);
      if(!raw||!secretHex||!/^[0-9a-f]{64}$/.test(secretHex))throw Error('Account protection unavailable');
      const secret=hexToBytes(secretHex);let verified:UnlockedIdentity|undefined;
      try{
        verified=await unlockIdentity(raw,currentPassword,secret,now(),derive);assertCurrent(e);
        if(verified.record.account!==account)throw Error('Account changed');
        const sealed=await sealIdentity(verified,newPassword,secret,random,now(),derive);assertCurrent(e);
        await storage.writeVault(JSON.stringify(sealed));
        // A lock racing the completed write leaves a cold-unlockable vault under the new password.
      }finally{secret.fill(0);if(verified)destroyIdentity(verified);}
    });},
    async sealGroupCustody(id:string,text:string,recipients:Parameters<typeof sealGroupCustody>[0]['recipients']){
      const e=epoch,source=identity;if(!source||busy)throw Error('Unlock the local account first');
      const result=await sealGroupCustody({...source,id,text,recipients,now:now(),random});assertCurrent(e);if(source!==identity)throw Error('Account operation interrupted');return result;
    },
    async sealCustody(recipient: IdentityRecord, recipientDevice: string, id: string, text: string) {
      const e = epoch, source = identity; if (!source || busy) throw Error('Unlock the local account first');
      const result = await sealCustody({ ...source, recipient, recipientDevice, id, text, now: now(), random });
      assertCurrent(e); if (source !== identity) throw Error('Account operation interrupted'); return result;
    },
    async receiveCustody(envelope: CustodyEnvelope, records: IdentityRecordStore, persist: (message: { from: string; id: string; text: string }) => Promise<boolean>, group?:GroupCustodyPayload,relay?:string) {
      const e = epoch, source = identity; if (!source || busy) return null;
      if (!await verifyCustody(envelope, records, now())) return null;
      assertCurrent(e); if (source !== identity) return null;
      let text = openCustody(envelope, source.record.account, source.signingSeed, source.encryptionSeed);
      if(group){if(!await verifyGroupCustodyPayload(group,records,now()))return null;assertCurrent(e);if(source!==identity)return null;const opened=openGroupCustody(group,envelope,text);text=joinGroupCustodyMessage(opened.text,opened.metadata,envelope.recipient,envelope.id);}
      if (!await persist({ from: envelope.sender, id: envelope.id, text })) return null;
      assertCurrent(e); if (source !== identity || envelope.expires <= now()) return null;
      return signCustodyReceipt(envelope, source.signingSeed, source.encryptionSeed,relay?{sources:[relay],partial:false}:undefined);
    },
    signProfile(data:Uint8Array,revision:number){
      if(!identity||busy)throw Error('Unlock your account first');const root=rootFromEntropy(identity.entropy);
      try{return signProfile(data,revision,root);}finally{root.fill(0);}
    },
    signGroup(group:RootGroupMembership){
      if(!identity||busy)throw Error('Unlock your account first');
      const root=rootFromEntropy(identity.entropy);
      try{return signRootGroupBackup(group,root);}finally{root.fill(0);}
    },
    publicRecord(): IdentityRecord | null { return identity ? JSON.parse(JSON.stringify(identity.record)) : null; },
    callDevice(): string | null { return identity && !busy ? cachedDeviceId ??= publicDevice(identity.signingSeed,identity.encryptionSeed).id : null; },
    signAttachment(input:Omit<AttachmentManifest,'signature'>){
      if(!identity||busy)throw Error('Unlock the local account first');
      return signAttachmentManifest(input,identity.signingSeed,identity.record,now());
    },
    signAttachmentReceipt(manifest:AttachmentManifest,route?:ReceivedRoute){
      if(!identity||busy)throw Error('Unlock the local account first');
      return signAttachmentReceipt(manifest,identity.signingSeed,identity.record,now(),route);
    },
    signCall(input: Omit<CallControl,'version'|'record'|'device'|'signature'>) {
      if (!identity || busy) throw Error('Unlock the local account first');
      return signCallControl({...input,record:identity.record},identity.signingSeed,now());
    },
    signCallReceipt(event: CallControl) {
      if (!identity || busy) throw Error('Unlock the local account first');
      return signCallControlReceipt(event,identity.record,identity.signingSeed,now());
    },
    signCallMedia(input: Omit<CallMediaSignal,'version'|'record'|'device'|'signature'>) {
      if (!identity || busy) throw Error('Unlock the local account first');
      return signCallMediaSignal({...input,record:identity.record},identity.signingSeed,now());
    },
    async signRequest(audience: { account: string; instance: string }, operation: IdentityRequest['operation'], payload: string) {
      const e = epoch, source = identity;
      if (!source || busy) throw Error('Unlock the local account first');
      const nonce = await random(32);
      assertCurrent(e);
      if (source !== identity) throw Error('Account operation interrupted');
      return signIdentityRequest(source.record, source.signingSeed, audience, operation, payload, nonce, now(), source.history);
    },
    signSignal(target: string, session: string, kind: AxonSignal['kind'], sdp: string) {
      if (!identity || busy) throw Error('Unlock the local account first');
      return signAxonSignal(identity.record, identity.signingSeed, identity.history ?? [], target, session, kind, sdp, now());
    },
    /** Lease unlocked credentials to a connection and revoke them on lock. */
    async withConnectionCredentials<T>(
      revoke:()=>void,
      start:(credentials:Pick<UnlockedIdentity,'record'|'history'|'signingSeed'|'encryptionSeed'> & {
        instance:Uint8Array;now:()=>number;random:SecureRandom;current:()=>boolean;
      },release:()=>void)=>T,
    ){
      const e=epoch,source=identity;
      const release=()=>{connections.delete(revoke);};
      if(!source||busy||connections.size>=10)throw Error('Local identity unavailable or axon capacity reached');
      connections.add(revoke);
      try{
        const instance=await random(32);assertCurrent(e);
        if(!connections.has(revoke)||source!==identity||busy)throw Error('Account operation interrupted');
        return start({record:source.record,history:source.history,signingSeed:source.signingSeed,encryptionSeed:source.encryptionSeed,
          instance,now,random,current:()=>connections.has(revoke)&&epoch===e&&source===identity},release);
      }catch(error){release();throw error;}
    },
    lock() {
      epoch++; closeConnections(); if (identity) destroyIdentity(identity); if (draft) destroyIdentity(draft);
      identity = null; cachedDeviceId = null; draft = null; state = account ? 'locked' : 'empty'; emit();
    },
  };
}

