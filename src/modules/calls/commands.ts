import type {PeerIdentityResult} from '../../services/identity/peerIdentityResolver';
import {peerIdentityUnavailableMessage} from '../../services/identity/peerIdentityResolver';

type Calls = {start(peer: string, kind: 'voice' | 'video'): Promise<string>};
/** Permission prompts belong to UI; readiness and account checks belong here. */
export function createCallCommands(d: {
  owner(): string | null;
  calls(): Calls | null;
  connected(): boolean;
  resolve(peer: string): Promise<PeerIdentityResult>;
  wait?(ms:number):Promise<void>;
  readinessTimeoutMs?:number;
}) {
  return {
    async start(peer: string, kind: 'voice' | 'video', permission: () => Promise<void>) {
      const owner = d.owner(); if (!owner) throw Error('Unlock your account and try again');
      await permission();
      if (d.owner() !== owner) throw Error('Account changed');
      // Android permission activities can briefly close foreground sockets.
      // Let the existing runtime reconnect before evaluating call readiness.
      const until=Date.now()+(d.readinessTimeoutMs??10000);
      while ((!d.calls()||!d.connected())&&Date.now()<until) {
        await (d.wait??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(100);
        if(d.owner()!==owner)throw Error('Account changed');
      }
      const calls = d.calls(); if (!calls) throw Error('Wait for the network to connect');
      if (!d.connected()) throw Error('Connecting to Axonic. Calls need an active axon; try again once the network connects.');
      const identity = await d.resolve(peer);
      if (d.owner() !== owner || calls !== d.calls()) throw Error('Unlock your account and try again');
      if (identity.status !== 'found') throw Error(peerIdentityUnavailableMessage(identity.status));
      return calls.start(peer, kind);
    },
  };
}
