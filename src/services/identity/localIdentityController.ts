import { sealCustody, openCustody, verifyCustody, signCustodyReceipt, type CustodyEnvelope } from './custodyProtocol';
import {signAttachmentManifest,signAttachmentReceipt,type AttachmentManifest} from './attachmentProtocol';
import { signAxonSignal, type AxonSignal } from './axonSignaling';
import { signCallControl, type CallControl } from './callControlProtocol';
import { signCallControlReceipt } from './callControlDelivery';
import { signCallMediaSignal, type CallMediaSignal } from './callMediaProtocol';
import { publicDevice } from './identityProtocol';
import { signChatBinding, type ChatBindingChallenge } from './chatIdentityBinding';
import type { IntroductionHooks } from './identityIntroductions';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { verifyRecord, renewIdentityRecord, validRecordHistory, HISTORY_BYTES, HISTORY_RECORDS, type IdentityRecord } from './identityProtocol';
import { signIdentityRequest, type IdentityRequest, type IdentityRecordStore } from './identityAdmission';
import { createPersistentAxon, type AxonWire } from './persistentAxon';
import type { TestMessageHandler } from './axonTestMessages';
import { createLocalIdentity, recoverReplacingDevices, destroyIdentity, sealIdentity, unlockIdentity, rootFromEntropy,
  type SecureRandom, type UnlockedIdentity, type PasswordDerivation } from './identityVault';

export interface IdentityStorage {
  readVault(): Promise<string | null>;
  writeVault(value: string): Promise<void>;
  readDeviceSecret(): Promise<string | null>;
  writeDeviceSecret(value: string): Promise<void>;
}
export interface LocalIdentityStatus { state: 'empty' | 'locked' | 'unlocked' | 'backup'; account: string | null; busy: boolean }
/** One experimental local account, separate from existing Django storage and sessions. */
export function createLocalIdentityController(storage: IdentityStorage, random: SecureRandom, now: () => number,
  derive?: PasswordDerivation) {
  let identity: UnlockedIdentity | null = null, draft: UnlockedIdentity | null = null;
  let account: string | null = null, state: LocalIdentityStatus['state'] = 'empty', busy = false, epoch = 0;
  const axons = new Set<() => void>();
  const closeAxons = () => { for (const close of [...axons]) close(); };
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const assertCurrent = (e: number) => { if (epoch !== e) throw Error('Account operation interrupted'); };
  async function exclusive<T>(work: (e: number) => Promise<T>): Promise<T> {
    if (busy) throw Error('An account operation is already running');
    busy = true; const e = epoch; emit();
    try { return await work(e); } finally { busy = false; emit(); }
  }
  return {
    status(): LocalIdentityStatus { return { state, account, busy }; },
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
        identity = source; draft = null; state = 'unlocked';
      } finally { secret?.fill(0); destroyIdentity(copy); }
    }); },
    /** Public metadata only. Recovery still requires the separately saved words. */
    recoveryRecord() {
      if (!identity || busy) throw Error('Unlock the local account first');
      return JSON.stringify({ version: 1, record: identity.record, history: identity.history ?? [] });
    },
    restore(phrase: string, recoveryRecord: string, password: string, verify?: () => Promise<void>) { return exclusive(async e => {
      if (identity || draft || await storage.readVault()) throw Error('A local identity already exists');
      assertCurrent(e);
      if (recoveryRecord.length > 12_000) throw Error('Invalid recovery record');
      const packet = JSON.parse(recoveryRecord);
      if (packet.version !== 1 || !validRecordHistory(packet.history, packet.record, now())) throw Error('Invalid recovery record');
      const restored = await recoverReplacingDevices(phrase, packet.record, random, now());
      let secret: Uint8Array | undefined;
      try {
        assertCurrent(e);
        if (verify) { await verify(); assertCurrent(e); }
        restored.history = [...packet.history, packet.record];
        while (restored.history.length > HISTORY_RECORDS || new TextEncoder().encode(JSON.stringify(restored.history)).length > HISTORY_BYTES) restored.history.shift();
        secret = await random(32); assertCurrent(e);
        const sealed = await sealIdentity(restored, password, secret, random, now(), derive); assertCurrent(e);
        if (verify) { await verify(); assertCurrent(e); }
        await storage.writeDeviceSecret(bytesToHex(secret)); assertCurrent(e);
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
        try { renewed = renewIdentityRecord(root, opened.record, opened.history ?? [], now()); }
        finally { root.fill(0); }
        if (renewed) {
          opened.record = renewed.record; opened.history = renewed.history;
          const sealed = await sealIdentity(opened, password, secret, random, now(), derive); assertCurrent(e);
          await storage.writeVault(JSON.stringify(sealed)); assertCurrent(e);
        }
        closeAxons(); if (identity) destroyIdentity(identity);
        identity = opened; opened = undefined; account = identity.record.account; state = 'unlocked';
      } finally { secret.fill(0); if (opened) destroyIdentity(opened); }
    }); },

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
    async sealCustody(recipient: IdentityRecord, recipientDevice: string, id: string, text: string) {
      const e = epoch, source = identity; if (!source || busy) throw Error('Unlock the local account first');
      const result = await sealCustody({ ...source, recipient, recipientDevice, id, text, now: now(), random });
      // Silent history updates synchronize at unlock; they must not create message notifications.
      try { if (JSON.parse(text)?.[0] === 'axonic-root-action-v1') delete result.wakeSignature; } catch { /* Ordinary text retains its wake. */ }
      assertCurrent(e); if (source !== identity) throw Error('Account operation interrupted'); return result;
    },
    async receiveCustody(envelope: CustodyEnvelope, records: IdentityRecordStore, persist: (message: { from: string; id: string; text: string }) => Promise<boolean>) {
      const e = epoch, source = identity; if (!source || busy) return null;
      if (!await verifyCustody(envelope, records, now())) return null;
      assertCurrent(e); if (source !== identity) return null;
      const text = openCustody(envelope, source.record.account, source.signingSeed, source.encryptionSeed);
      if (!await persist({ from: envelope.sender, id: envelope.id, text })) return null;
      assertCurrent(e); if (source !== identity || envelope.expires <= now()) return null;
      return signCustodyReceipt(envelope, source.signingSeed, source.encryptionSeed);
    },
    publicRecord(): IdentityRecord | null { return identity ? JSON.parse(JSON.stringify(identity.record)) : null; },
    callDevice(): string | null { return identity && !busy ? publicDevice(identity.signingSeed,identity.encryptionSeed).id : null; },
    signAttachment(input:Omit<AttachmentManifest,'signature'>){
      if(!identity||busy)throw Error('Unlock the local account first');
      return signAttachmentManifest(input,identity.signingSeed,identity.record,now());
    },
    signAttachmentReceipt(manifest:AttachmentManifest){
      if(!identity||busy)throw Error('Unlock the local account first');
      return signAttachmentReceipt(manifest,identity.signingSeed,identity.record,now());
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
    /** Caller supplies its authenticated legacy owner; private keys remain controller-owned. */
    signChatBinding(owner: number, challenge: ChatBindingChallenge) {
      if (!identity || busy) throw Error('Unlock the local account first');
      return signChatBinding(identity.record, identity.signingSeed, owner, challenge, now());
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
    /** Keys stay inside the controller. Pending sockets are owned before the first await. */
    async createAxon(wire: AxonWire, store: IdentityRecordStore, expectedAccount?: string, onClosed = () => {}, introductions?: IntroductionHooks, onSignal?: Parameters<typeof createPersistentAxon>[0]['onSignal'], onTestMessage?: TestMessageHandler, onCustody?: Parameters<typeof createPersistentAxon>[0]['onCustody'], onChatMessage?: TestMessageHandler, onDirectory?: Parameters<typeof createPersistentAxon>[0]['onDirectory'], onPush?: Parameters<typeof createPersistentAxon>[0]['onPush'], onCallControl?: Parameters<typeof createPersistentAxon>[0]['onCallControl'], onCallMedia?: Parameters<typeof createPersistentAxon>[0]['onCallMedia'], onCallRelay?: Parameters<typeof createPersistentAxon>[0]['onCallRelay'], onCallMediaRelay?: Parameters<typeof createPersistentAxon>[0]['onCallMediaRelay'], onRelayedCallMedia?: Parameters<typeof createPersistentAxon>[0]['onRelayedCallMedia'], onAttachment?:Parameters<typeof createPersistentAxon>[0]['onAttachment']) {
      const e = epoch, source = identity;
      let session: ReturnType<typeof createPersistentAxon> | undefined, closed = false;
      const close = () => {
        if (closed) return;
        closed = true; axons.delete(close);
        session?.stop();
        try { wire.close(); } catch { /* Continue releasing ownership. */ }
        try { onClosed(); } catch { /* Observer failures cannot preserve a session. */ }
      };
      if (!source || busy || axons.size >= 10) { close(); throw Error('Local identity unavailable or axon capacity reached'); }
      axons.add(close);
      try {
        const instance = await random(32); assertCurrent(e);
        if (closed || source !== identity || busy) throw Error('Account operation interrupted');
        session = createPersistentAxon({ record: source.record, history: source.history, signingSeed: source.signingSeed, instance, store,
          expectedAccount, introductions, onSignal, onCustody, onDirectory, onPush, onCallControl, onCallMedia, onCallRelay, onCallMediaRelay, onRelayedCallMedia, onAttachment,
          testMessages: onTestMessage ? { encryptionSeed: source.encryptionSeed, received: onTestMessage } : undefined,
          chatMessages: onChatMessage ? { encryptionSeed: source.encryptionSeed, received: onChatMessage } : undefined,
          wire, now, random, current: () => !closed && epoch === e && source === identity, onClosed: close });
        if (closed) session.stop();
        return session;
      } catch (error) { close(); throw error; }
    },
    lock() {
      epoch++; closeAxons(); if (identity) destroyIdentity(identity); if (draft) destroyIdentity(draft);
      identity = null; draft = null; state = account ? 'locked' : 'empty'; emit();
    },
  };
}
