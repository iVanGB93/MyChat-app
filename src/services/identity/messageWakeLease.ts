import Native from '../../../modules/axonic-nearby';
// Identity lookup, inbox recovery and upload handoff share the native transport window.
let leases=0;
export function acquireMessageWakeLease(){
 Native?.axonMessageWake?.(30000);leases++;let released=false;
 return ()=>{if(released)return;released=true;if(--leases===0)Native?.axonMessageWake?.(0);};
}
