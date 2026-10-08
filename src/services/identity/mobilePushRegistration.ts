import { getMessaging, getToken, onTokenRefresh, deleteToken } from '@react-native-firebase/messaging';
import { createPushRegistration } from './pushRegistration';
import { FIRST_NEURON } from './internetAxonTransport';
import api from '../api';
import { getInstallationId } from '../installationIdentity';
let revoke: (() => Promise<boolean>) | null = null;
export const rejectPushRegistration = async () => JSON.stringify({ status: 'unsupported' });
export function startMobilePushRegistration(current: () => boolean, request: (peer: string, raw: string) => Promise<string | null>, account: string) {
  let lastDiagnostic='';
  const worker = createPushRegistration({ current, now: Date.now, token: () => getToken(getMessaging()), request: raw => request(FIRST_NEURON.account, raw),
    diagnostic:stage=>{if(stage!==lastDiagnostic){lastDiagnostic=stage;console.info('[NeuronPush]',stage);}},
    rotateToken:()=>deleteToken(getMessaging()),
    binding: async () => {
      const installation_id = await getInstallationId();
      if (!current()) return null;
      return (await api.post('/api/users/neuron-binding/', { account, installation_id }, { timeout: 8000 })).data;
    } });
  const ownedRevoke = () => worker.revoke(); revoke = ownedRevoke;
  let unsubscribe = () => {};
  try { unsubscribe = onTokenRefresh(getMessaging(), () => worker.invalidate()); } catch { /* No Firebase capability. */ }
  return { tick: worker.tick, stop() { worker.stop(); unsubscribe(); if (revoke === ownedRevoke) revoke = null; } };
}
/** Called before account teardown. Token deletion also invalidates an unreachable old registration.
 * Network failures can delay revocation; server leases bound its lifetime. Existing Django cleanup remains.
 */
async function bounded(work: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, 8000); })]); } finally { clearTimeout(timer); }
}
export async function unregisterFirstNeuronPush() {
  try { await bounded(revoke?.() ?? Promise.resolve()); } finally { try { await bounded(deleteToken(getMessaging())); } catch { /* Offline: expiry and next registration reconcile. */ } }
}
