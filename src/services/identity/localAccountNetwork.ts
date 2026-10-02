import { unavailableDirectoryLookup, type DirectoryLookupResult } from './identityDirectoryLookup';
import { createMobileDirectory } from './mobileDirectory';
import Native from '../../../modules/axonic-nearby';
import { allowedAxons, loadAllowedAxons, subscribeAllowedAxons } from '../allowedAxons';
import { localAccount } from './localAccount';
import { createLanIdentityRuntime, type NativeAxonLan } from './lanIdentityRuntime';
import { createMobileIdentityRecordStore } from './identityRecordStore';
import { createInternetAxonConnector, FIRST_NEURON } from './internetAxonTransport';
import { createCustodyService } from './custodyService';
import { createMobileCustodyStore } from './mobileCustodyStore';
let activeSnapshot: (() => ReturnType<ReturnType<typeof createLanIdentityRuntime>['snapshot']>) | null = null;
let activeLookup: ((account: string) => Promise<DirectoryLookupResult>) | null = null;
export const localAccountLookupIdentity = (account: string) => activeLookup?.(account) ?? Promise.resolve(unavailableDirectoryLookup());
let inspectDirectory: (() => ReturnType<ReturnType<typeof createMobileDirectory>['snapshot']>) | null = null;
export const localAccountDirectorySnapshot = () => inspectDirectory?.() ?? null;
export const localAccountNetworkSnapshot = () => activeSnapshot?.() ?? null;
/** Independent root-identity participation; no legacy user ID, JWT, or Axion session. */
export function startLocalAccountNetwork() {
  if (!Native?.axonLanStart || !Native?.axonWssConnect) throw Error('Network transport unavailable in this build');
  const records = createMobileIdentityRecordStore(Date.now);
  let stopped = false;
  let custody: { owner: string; service: ReturnType<typeof createCustodyService> } | null = null;
  const owner = () => !stopped && !localAccount.status().busy && localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
  function service() {
    const account = owner(); if (!account) return null;
    if (custody?.owner !== account) {
      const next: NonNullable<typeof custody> = { owner: account, service: createCustodyService({ owner: account, records,
        store: createMobileCustodyStore(account), now: Date.now, current: () => custody === next && owner() === account }) };
      custody = next;
    }
    return custody.service;
  }
  const native = Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> };
  const directory = createMobileDirectory(localAccount, records, () => !stopped, () => runtime);
  const runtime = createLanIdentityRuntime({ identity: localAccount, native, store: records, now: Date.now, limit: allowedAxons(),
    onDirectory: (raw, peer) => directory.receive(peer.account, raw),
    onCustody: (raw, peer) => service()?.receive(peer.account, raw) ?? Promise.resolve(JSON.stringify({ status: 'rejected' })),
    internet: { peers: [FIRST_NEURON], connect: createInternetAxonConnector(native, owner) } });
  const unsub = localAccount.subscribe(() => { if (!owner()) custody = null; });
  const unlimit = subscribeAllowedAxons(() => runtime.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  const tick = setInterval(() => { runtime.tick(); void directory.tick().catch(() => {}); }, 1000);
  let sweeping = false;
  const sweep = setInterval(() => { if (sweeping) return; const current = service(); if (!current) return;
    sweeping = true; void current.sweep().catch(() => {}).finally(() => { sweeping = false; }); }, 60_000);
  runtime.tick(); inspectDirectory = directory.snapshot; activeLookup = directory.lookup; activeSnapshot = runtime.snapshot;
  return { snapshot: runtime.snapshot, stop() { directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory === directory.snapshot) inspectDirectory = null; if (activeSnapshot === runtime.snapshot) activeSnapshot = null; stopped = true; custody = null; clearInterval(tick); clearInterval(sweep); unsub(); unlimit(); runtime.stop(); } };
}
