/** Phone call application API. Shared signaling policy stays in the portable core. */
import {localAccount} from '../identity';
import {localAccountCalls as activeCallSession,localAccountNetworkSnapshot,ensureLocalPeerIdentity,subscribeLocalNetworkChanges,subscribeLocalAccountCalls as subscribeCalls} from '../../composition/neuronRuntime';
import {createCallCommands} from './commands';
const owner=()=>localAccount.status().state==='unlocked'?localAccount.status().account:null;
export const calling=createCallCommands({owner,calls:activeCallSession,
 subscribeReady:listener=>{const off=subscribeLocalNetworkChanges(listener),calls=subscribeCalls(()=>listener()),account=localAccount.subscribe(listener);return()=>{off();calls();account();};},
 connected:()=>!!localAccountNetworkSnapshot()?.pool?.connections.some(c=>c.state==='connected'),resolve:ensureLocalPeerIdentity});
export function localAccountCalls():Pick<NonNullable<ReturnType<typeof activeCallSession>>,'snapshot'|'accept'|'end'|'confirmRinging'|'endParticipant'|'joinGroup'|'prepareExpansion'|'adoptExpansion'>|null{return activeCallSession();}
export {subscribeLocalAccountCalls} from '../../composition/neuronRuntime';
export type {NeuronCallView} from '../../services/identity/neuronCallCoordinator';
export {startRootCallLease,stopRootCallLease,markRootCallConnected,rootCallMayRunBackground} from '../../services/identity/rootCallLifetime';

export {MAX_GROUP_CALL_PARTICIPANTS} from '../../services/identity/groupCallRoom';
export {GROUP_CALLS_ENABLED} from './features';

export type {GroupCallRoom} from '../../services/identity/groupCallRoom';
