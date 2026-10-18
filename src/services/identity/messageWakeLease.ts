import Native from '../../../modules/axonic-nearby';
// Public-record lookup and verified inbox recovery must not revoke each other's window.
let leases=0;
export function acquireMessageWakeLease(){
 Native?.axonMessageWake?.(30000);leases++;let released=false;
 return ()=>{if(released)return;released=true;if(--leases===0)Native?.axonMessageWake?.(0);};
}
