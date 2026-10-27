/** Phone call application API. Shared signaling policy stays in the portable core. */
import {localAccount} from '../identity';
import {localAccountCalls as activeCallSession,localAccountNetworkSnapshot,ensureLocalPeerIdentity} from '../../composition/neuronRuntime';
import {createCallCommands} from './commands';
const owner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
export const calling=createCallCommands({owner,calls:activeCallSession,
 connected:()=>!!localAccountNetworkSnapshot()?.pool?.connections.some(c=>c.state==='connected'),resolve:ensureLocalPeerIdentity});
export function localAccountCalls():Pick<NonNullable<ReturnType<typeof activeCallSession>>,'snapshot'|'accept'|'end'|'confirmRinging'>|null{return activeCallSession();}
export {subscribeLocalAccountCalls} from '../../composition/neuronRuntime';
export type {NeuronCallView} from '../../services/identity/neuronCallCoordinator';
export {startRootCallLease,stopRootCallLease,markRootCallConnected,rootCallMayRunBackground} from '../../services/identity/rootCallLifetime';
