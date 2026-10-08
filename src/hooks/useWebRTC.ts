import {useNotificationContext} from '../contexts/NotificationContext';
import {getIceConfig} from '../services/callService';
import useWebRTCCore,{type UseWebRTCOptions} from './useWebRTCCore';
export * from './useWebRTCCore';
/** Legacy adapter; new accounts import the transport-only core directly. */
export default function useWebRTC(options:UseWebRTCOptions){
 const {sendSignal,subscribe}=useNotificationContext();
 return useWebRTCCore(options,{sendSignal,subscribe,loadIceConfig:getIceConfig});
}
