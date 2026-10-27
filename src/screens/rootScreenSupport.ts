import {ThemedAlert as Alert} from '../components/ui/ThemedAlert';
import dayjs from 'dayjs';
import {shortIdentity} from '../modules/identity';
import {calling} from '../modules/calls';
import type {RootChatState} from '../modules/messaging';
import {ensureRootCallPermissions} from './calls/RootAccountCallScreen';
export const report=(error:unknown)=>Alert.alert('Axonic',error instanceof Error?error.message:typeof error==='string'?error:'Please try again');
export function nickname(state:RootChatState,peer:string){return state.contacts.find(c=>c.account===peer)?.alias||shortIdentity(peer);}
export const startCall=(peer:string,kind:'voice'|'video')=>calling.start(peer,kind,()=>ensureRootCallPermissions(kind));
export function formatHistoryTime(at:number){const date=dayjs(at),now=dayjs();return date.isSame(now,'day')?date.format('HH:mm'):date.isSame(now.subtract(1,'day'),'day')?'Yesterday':date.format('DD/MM/YY');}
