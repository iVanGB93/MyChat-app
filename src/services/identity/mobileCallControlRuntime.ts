import { neuronCallsEnabled } from './neuronCallFeature';
import { createCallControlRuntime } from './callControlRuntime';
import { createMobileCallJournalStore } from './mobileCallJournalStore';

/** Development-only composition; the app root must supply its identity/session and block policy.
 * This factory does not start discovery or enable the production call buttons. */
export function createMobileCallControlRuntime(d: Omit<Parameters<typeof createCallControlRuntime>[0], 'store'>) {
  if (!neuronCallsEnabled()) return null;
  return createCallControlRuntime({ ...d, store: createMobileCallJournalStore() });
}
