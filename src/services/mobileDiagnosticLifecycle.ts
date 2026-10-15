import {AppState} from 'react-native';
import {localAccount} from './identity/localAccount';
import {diagnosticJournal} from './diagnosticJournal';
import {clearDeliveryCapture} from './mobileDeliveryDiagnostics';
/** Called once by the mounted app. Headless processes may have a shorter journal. */
export function startDiagnosticLifecycle(){
 let owner=localAccount.status().account;
 const off=localAccount.subscribe(()=>{const s=localAccount.status();if(s.account!==owner||s.state!=='unlocked'){diagnosticJournal.clear();clearDeliveryCapture();}owner=s.account;});
 const state=(s:string)=>{if(localAccount.status().state==='unlocked')diagnosticJournal.record(s==='active'?'app_active':s==='background'?'app_background':'app_inactive');};
 state(AppState.currentState);const sub=AppState.addEventListener('change',state);
 return()=>{off();sub.remove();};
}
