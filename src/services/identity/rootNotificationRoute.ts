import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
const KEY='@axonic_root_notification_open_v1';
let visible:{peer?:string;group?:string}|null=null;
export function setRootVisibleConversation(value:typeof visible){visible=value;}
export function rootConversationVisible(sender:string,group?:string){return group?visible?.group===group:visible?.peer===sender;}
export type RootNotificationTarget={account:string;sender:string;group?:string};
export function rootNotificationTarget(data:unknown):RootNotificationTarget|null{
 const d=data as {type?:string;account?:string;sender?:string;group?:string};
 return d?.type==='root_neuron_message'&&validAccountId(d.account)&&validAccountId(d.sender)&&(d.group===undefined||/^[a-f0-9]{64}$/.test(d.group))?{account:d.account,sender:d.sender,...(d.group?{group:d.group}:{})}:null;
}
export async function queueRootNotificationOpen(data:unknown){const target=rootNotificationTarget(data);if(target)await AsyncStorage.setItem(KEY,JSON.stringify(target));}
export async function pendingRootNotificationOpen(account:string){const raw=await AsyncStorage.getItem(KEY);if(!raw)return null;const target=rootNotificationTarget({type:'root_neuron_message',...JSON.parse(raw)});return target?.account===account?target:null;}
export async function finishRootNotificationOpen(){await AsyncStorage.removeItem(KEY);}
