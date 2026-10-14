import AsyncStorage from '@react-native-async-storage/async-storage';
import {DEFAULT_RECOVERY_POLICY,recoveryPolicy,setRecoveryPolicy,type RecoveryPolicy} from './identity/recoveryPolicy';
const key='@axonic_recovery_policy_v1';
let loading:Promise<void>|undefined;
let writes:Promise<unknown>=Promise.resolve();
const listeners=new Set<()=>void>();
export const recoverySettings=recoveryPolicy;
export const defaultRecoverySettings=DEFAULT_RECOVERY_POLICY;
export const subscribeRecoverySettings=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const loadRecoverySettings=()=>loading??=AsyncStorage.getItem(key).then(raw=>{
  if(raw){try{setRecoveryPolicy(JSON.parse(raw));}catch{setRecoveryPolicy({...DEFAULT_RECOVERY_POLICY});}}
  listeners.forEach(fn=>fn());
}).catch(error=>{loading=undefined;throw error;});
export function saveRecoverySettings(next:RecoveryPolicy){
  const task=writes.then(async()=>{await loadRecoverySettings();
    // Validate without changing the active setting until storage succeeds.
    if(!Number.isInteger(next.pollsPerMinute)||next.pollsPerMinute<30||next.pollsPerMinute>90||!Number.isInteger(next.custodyFramesPerMinute)||next.custodyFramesPerMinute<512||next.custodyFramesPerMinute>2048)throw Error('Invalid recovery settings');
    await AsyncStorage.setItem(key,JSON.stringify(next));setRecoveryPolicy(next);listeners.forEach(fn=>fn());
  });writes=task.catch(()=>{});return task;
}
