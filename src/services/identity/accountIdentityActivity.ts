/** Background keys stay available only for this owner's connected, OS-protected call.
 * Ringing, notification wakes, logout and account switches never grant this lease. */
export function accountIdentityMayRun(state: {
 user?:{id:number}|null;appLifecycle:string;foregroundServiceRunning?:boolean;
 activeCall?:{ownerId?:number;transport?:string;state:string}|null;
}) {
 return state.appLifecycle==='active'||!!(state.user&&state.foregroundServiceRunning
   &&state.activeCall?.transport==='neuron'&&state.activeCall.ownerId===state.user.id
   &&state.activeCall.state==='connected');
}
