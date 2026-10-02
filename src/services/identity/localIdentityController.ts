import { sealCustody, openCustody, verifyCustody, signCustodyReceipt, type CustodyEnvelope } from './custodyProtocol';
import { signAxonSignal, type AxonSignal } from './axonSignaling';
import { signChatBinding, type ChatBindingChallenge } from './chatIdentityBinding';
import type { IntroductionHooks } from './identityIntroductions';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { verifyRecord, renewIdentityRecord, type IdentityRecord } from './identityProtocol';
import { signIdentityRequest, type IdentityRequest, type IdentityRecordStore } from './identityAdmission';
import { createPersistentAxon, type AxonWire } from './persistentAxon';
import type { TestMessageHandler } from './axonTestMessages';
import { createLocalIdentity, destroyIdentity, sealIdentity, unlockIdentity, rootFromEntropy,
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
    confirmBackup(phrase: string, password: string) { return exclusive(async e => {
      const source = draft;
      if (!source || phrase.trim().toLowerCase().replace(/\s+/g, ' ') !== entropyToMnemonic(source.entropy, wordlist)) {
        throw Error('Recovery words do not match');
      }
      if (await storage.readVault()) throw Error('A local identity already exists');
      assertCurrent(e);
      // Copy secrets so locking during an async KDF cannot mutate the operation's input.
      const copy: UnlockedIdentity = { entropy: source.entropy.slice(), signingSeed: source.signingSeed.slice(),
        encryptionSeed: source.encryptionSeed.slice(), record: source.record };
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
    async sealCustody(recipient: IdentityRecord, recipientDevice: string, id: string, text: string) {
      const e = epoch, source = identity; if (!source || busy) throw Error('Unlock the local account first');
      const result = await sealCustody({ ...source, recipient, recipientDevice, id, text, now: now(), random });
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
    async createAxon(wire: AxonWire, store: IdentityRecordStore, expectedAccount?: string, onClosed = () => {}, introductions?: IntroductionHooks, onSignal?: Parameters<typeof createPersistentAxon>[0]['onSignal'], onTestMessage?: TestMessageHandler, onCustody?: Parameters<typeof createPersistentAxon>[0]['onCustody'], onChatMessage?: TestMessageHandler) {
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
          expectedAccount, introductions, onSignal, onCustody,
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
