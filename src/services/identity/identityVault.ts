/** Local experimental vault. Never send this object, its password, or recovery words to peers. */
import { ed25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { accountId, validRecordHistory, issueRecord, publicDevice, recordDigest, verifyRecord, type IdentityRecord } from './identityProtocol';

export type SecureRandom = (size: number) => Promise<Uint8Array>;
/** Platform adapter must implement exactly scrypt N=131072, r=8, p=1, dkLen=32. */
export type PasswordDerivation = (password: string, salt: Uint8Array) => Promise<Uint8Array>;
const portableDerivation: PasswordDerivation = (password, salt) =>
  scryptAsync(password, salt, { N: 131072, r: 8, p: 1, dkLen: 32, maxmem: 160 * 1024 * 1024 });
export interface IdentityVault {
  version: 1 | 2; kdf: 'scrypt-131072-8-1'; cipher: 'xchacha20poly1305';
  salt: string; nonce: string; ciphertext: string; record: IdentityRecord; history?: IdentityRecord[];
}
export interface UnlockedIdentity {
  entropy: Uint8Array; signingSeed: Uint8Array; encryptionSeed: Uint8Array; record: IdentityRecord; history?: IdentityRecord[];
}
/** 128 or 256 random bits encoded as BIP39 words; Axonic HKDF derivation, not a wallet derivation path. */
export function rootFromEntropy(entropy: Uint8Array): Uint8Array {
  if (entropy.length !== 16 && entropy.length !== 32) throw Error('Use a valid 12- or 24-word recovery phrase');
  return hkdf(sha256, entropy, utf8ToBytes('axonic-root-v1'), utf8ToBytes('ed25519-account-authority'), 32);
}
export function destroyIdentity(identity: UnlockedIdentity): void {
  identity.entropy.fill(0); identity.signingSeed.fill(0); identity.encryptionSeed.fill(0);
}
function checkPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw Error('Use a password between 12 and 256 characters');
}
async function randomBytes(random: SecureRandom, size: number): Promise<Uint8Array> {
  const bytes = await random(size);
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw Error('Secure randomness unavailable');
  return bytes;
}
async function wrappingKey(password: string, salt: Uint8Array, deviceSecret: Uint8Array, derive: PasswordDerivation): Promise<Uint8Array> {
  checkPassword(password);
  if (deviceSecret.length !== 32) throw Error('Device protection unavailable');
  const stretched = await derive(password, salt);
  try {
    if (!(stretched instanceof Uint8Array) || stretched.length !== 32) throw Error('Password derivation unavailable');
    return hkdf(sha256, stretched, deviceSecret, utf8ToBytes('axonic-vault-key-v1'), 32);
  }
  finally { stretched.fill(0); }
}
const aad = (v: IdentityVault) => utf8ToBytes(JSON.stringify(['axonic-local-vault-v1', v.version, v.kdf, v.cipher,
  v.salt, v.nonce, recordDigest(v.record)]));
function validateIdentity(identity: UnlockedIdentity, now: number): void {
  const root = rootFromEntropy(identity.entropy);
  try {
    const publicRoot = bytesToHex(ed25519.getPublicKey(root));
    const device = publicDevice(identity.signingSeed, identity.encryptionSeed);
    if (!validRecordHistory(identity.history ?? [], identity.record, now) || !verifyRecord(identity.record, now, true) || identity.record.root !== publicRoot
      || identity.record.account !== accountId(publicRoot) || !identity.record.devices.some(d => d.id === device.id)) {
      throw Error('Account material does not match its identity');
    }
  } finally { root.fill(0); }
}
export async function sealIdentity(identity: UnlockedIdentity, password: string, deviceSecret: Uint8Array,
  random: SecureRandom, now: number, derive: PasswordDerivation = portableDerivation): Promise<IdentityVault> {
  validateIdentity(identity, now); checkPassword(password);
  const salt = await randomBytes(random, 32), nonce = await randomBytes(random, 24);
  const v: IdentityVault = { version: identity.entropy.length === 16 ? 2 : 1, kdf: 'scrypt-131072-8-1', cipher: 'xchacha20poly1305',
    salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: '', ...(identity.history?.length ? { history: JSON.parse(JSON.stringify(identity.history)) } : {}), record: JSON.parse(JSON.stringify(identity.record)) };
  const plaintext = new Uint8Array(identity.entropy.length + 64);
  plaintext.set(identity.entropy); plaintext.set(identity.signingSeed, identity.entropy.length); plaintext.set(identity.encryptionSeed, identity.entropy.length + 32);
  let key: Uint8Array | undefined;
  try {
    key = await wrappingKey(password, salt, deviceSecret, derive);
    v.ciphertext = bytesToHex(xchacha20poly1305(key, nonce, aad(v)).encrypt(plaintext));
    return v;
  } finally { plaintext.fill(0); key?.fill(0); }
}
export async function unlockIdentity(raw: string, password: string, deviceSecret: Uint8Array, now: number,
  derive: PasswordDerivation = portableDerivation): Promise<UnlockedIdentity> {
  let key: Uint8Array | undefined, plaintext: Uint8Array | undefined;
  let identity: UnlockedIdentity | undefined;
  try {
    if (raw.length > 12_000) throw Error('Invalid vault');
    const v = JSON.parse(raw) as IdentityVault;
    if ((v.version !== 1 && v.version !== 2) || v.kdf !== 'scrypt-131072-8-1' || v.cipher !== 'xchacha20poly1305'
      || typeof v.salt !== 'string' || !/^[0-9a-f]{64}$/.test(v.salt)
      || typeof v.nonce !== 'string' || !/^[0-9a-f]{48}$/.test(v.nonce)
      || typeof v.ciphertext !== 'string' || !(v.version === 1 ? /^[0-9a-f]{224}$/ : /^[0-9a-f]{192}$/).test(v.ciphertext)
      || !verifyRecord(v.record, now, true)) throw Error('Invalid vault');
    key = await wrappingKey(password, hexToBytes(v.salt), deviceSecret, derive);
    plaintext = xchacha20poly1305(key, hexToBytes(v.nonce), aad(v)).decrypt(hexToBytes(v.ciphertext));
    const size = v.version === 1 ? 32 : 16;
    identity = { entropy: plaintext.slice(0, size), signingSeed: plaintext.slice(size, size + 32), encryptionSeed: plaintext.slice(size + 32, size + 64), record: v.record, history: v.history ?? [] };
    validateIdentity(identity, now);
    return identity;
  } catch {
    if (identity) destroyIdentity(identity);
    throw Error('Unable to unlock account. Check the password and device storage.');
  } finally { key?.fill(0); plaintext?.fill(0); }
}
export async function createLocalIdentity(random: SecureRandom, now: number): Promise<{ identity: UnlockedIdentity; recoveryPhrase: string }> {
  const entropy = await randomBytes(random, 16);
  try {
    const identity = await identityFromEntropy(entropy, random, now);
    return { identity, recoveryPhrase: entropyToMnemonic(entropy, wordlist) };
  } finally { entropy.fill(0); }
}
async function identityFromEntropy(entropy: Uint8Array, random: SecureRandom, now: number, previous?: IdentityRecord): Promise<UnlockedIdentity> {
  const root = rootFromEntropy(entropy);
  let signingSeed: Uint8Array | undefined, encryptionSeed: Uint8Array | undefined;
  try {
    signingSeed = await randomBytes(random, 32); encryptionSeed = await randomBytes(random, 32);
    return { entropy: entropy.slice(), signingSeed, encryptionSeed,
      record: issueRecord(root, [publicDevice(signingSeed, encryptionSeed)], now, previous) };
  } catch { signingSeed?.fill(0); encryptionSeed?.fill(0); throw Error('Unable to create local identity'); }
  finally { root.fill(0); }
}
/** Recovery replaces all authorized devices in the supplied latest record. Never invent a new genesis. */
export async function recoverReplacingDevices(phrase: string, previous: IdentityRecord, random: SecureRandom, now: number): Promise<UnlockedIdentity> {
  if (typeof phrase !== 'string' || phrase.length > 512 || !verifyRecord(previous, now, true)) throw Error('Valid recovery words and an identity record are required');
  const entropy = mnemonicToEntropy(phrase.trim().toLowerCase().replace(/\s+/g, ' '), wordlist);
  try { return await identityFromEntropy(entropy, random, now, previous); }
  finally { entropy.fill(0); }
}

/** Only the public identifier leaves this device during recovery. */
export function accountFromRecoveryPhrase(phrase: string): string {
  if (typeof phrase !== 'string' || phrase.length > 512) throw Error('Invalid recovery words');
  const entropy = mnemonicToEntropy(phrase.trim().toLowerCase().replace(/\s+/g, ' '), wordlist);
  let root: Uint8Array | undefined;
  try { root = rootFromEntropy(entropy); return accountId(bytesToHex(ed25519.getPublicKey(root))); }
  finally { entropy.fill(0); root?.fill(0); }
}
