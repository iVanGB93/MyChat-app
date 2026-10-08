import {useEffect} from 'react';
import {Alert as NativeAlert,type AlertButton} from 'react-native';
import {useConfirm} from '../../contexts/ConfirmContext';
import type {ConfirmOptions} from './ConfirmModal';
let show:((options:ConfirmOptions)=>void)|undefined;
/** Lets the existing local-account controllers use the original app's dialog sheet. */
export const ThemedAlert={alert(title:string,message?:string,buttons?:AlertButton[]){
 if(show)show({title,message,buttons:buttons?.map(b=>({text:b.text??'OK',style:b.style,onPress:b.onPress}))});
 else NativeAlert.alert(title,message,buttons);
}};
export function ThemedAlertBridge(){const {confirm}=useConfirm();useEffect(()=>{show=confirm;return()=>{if(show===confirm)show=undefined;};},[confirm]);return null;}
