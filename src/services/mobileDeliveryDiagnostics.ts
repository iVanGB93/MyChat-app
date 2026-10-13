import {AppState} from 'react-native';
import {createDeliveryDiagnostics} from './deliveryDiagnostics';
import {rootChatView} from './identity/rootChatActions';
import {rootMessageStatus} from './identity/rootMessageStatus';
import type {RootChatState} from './identity/rootChatTypes';
export const mobileDeliveryDiagnostics=createDeliveryDiagnostics();
let captureOwner:string|null=null;
export function captureDeliveryState(owner:string,state:RootChatState){
 if(!mobileDeliveryDiagnostics.active())return;
 if(captureOwner&&captureOwner!==owner){mobileDeliveryDiagnostics.clear();captureOwner=null;return;}
 captureOwner=owner;
 for(const m of rootChatView(owner,state).messages.slice(-128))if(!m.deleted)mobileDeliveryDiagnostics.observe(m.direction+':'+m.peer+':'+m.id,rootMessageStatus(m),m.direction,AppState.currentState==='active');
}
export function startDeliveryCapture(owner:string,state:RootChatState){captureOwner=owner;mobileDeliveryDiagnostics.start();captureDeliveryState(owner,state);}
export function deliveryDiagnosticEvent(owner:string,peer:string,id:string,event:'wake_verified'|'notification_requested'|'recovery_started'|'recovery_finished'){
 if(owner===captureOwner)mobileDeliveryDiagnostics.event('incoming:'+peer+':'+id,event,'incoming',AppState.currentState==='active');
}
export function clearDeliveryCapture(){captureOwner=null;mobileDeliveryDiagnostics.clear();}
