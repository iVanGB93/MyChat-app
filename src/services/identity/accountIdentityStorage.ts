import { createLocalIdentityController, type IdentityStorage } from './localIdentityController';
import type { PasswordDerivation, SecureRandom } from './identityVault';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface AccountIdentityStorage extends IdentityStorage {
  readUnlockSecret(): Promise<string | null>;
  writeUnlockSecret(value: string): Promise<void>;
}
// Also serialize across root remounts so an interrupted provisioning write cannot
// race a replacement controller opening the same account's vault.
let provisioning: Promise<unknown> = Promise.resolve();
/** Device-bound migration identity, separate from Django credentials and the experiment vault.
 * Reuse the encrypted vault; never silently regenerate an identity if protection is missing.
 */
export function createAccountIdentityAccess(d: { storage(owner: number): AccountIdentityStorage;
  random: SecureRandom; now(): number; derive: PasswordDerivation }) {
  const owners = new WeakMap<ReturnType<typeof createLocalIdentityController>, number>();
  return {
    create(owner: number) {
      if (!Number.isSafeInteger(owner) || owner < 1) throw Error('Invalid account owner');
      const identity = createLocalIdentityController(d.storage(owner), d.random, d.now, d.derive);
      owners.set(identity, owner); return identity;
    },
    unlock(owner: number, identity: ReturnType<typeof createLocalIdentityController>, current: () => boolean) {
      const run = provisioning.then(async () => {
      if (owners.get(identity) !== owner) throw Error('Identity owner mismatch');
      const storage = d.storage(owner);
      const assertCurrent = () => { if (!current()) throw Error('Account changed'); };
      let password: string | null = null;
      try {
        assertCurrent();
        await identity.inspect(); assertCurrent();
        password = await storage.readUnlockSecret(); assertCurrent();
        if (identity.status().state !== 'empty') {
          if (!password || !/^[0-9a-f]{64}$/.test(password)) throw Error('Device protection unavailable');
          await identity.unlock(password); assertCurrent(); return;
        }
        if (password !== null && !/^[0-9a-f]{64}$/.test(password)) throw Error('Invalid device protection');
        if (!password) {
          const random = await d.random(32);
          try { if (random.length !== 32) throw Error('Secure randomness unavailable'); password = bytesToHex(random); }
          finally { random.fill(0); }
          assertCurrent(); await storage.writeUnlockSecret(password); assertCurrent();
        }
        // Migration accounts are device-bound; this does not claim the user backed up recovery words.
        // The controller's creation path validates and seals the same vault format.
        const words = await identity.beginCreate(); assertCurrent();
        await identity.confirmBackup(words, password); assertCurrent();
      } catch (error) { identity.lock(); throw error; }
      finally { password = null; }
      });
      provisioning = run.catch(() => {}); return run;
    },
  };
}
