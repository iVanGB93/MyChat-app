import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {FlatList,Keyboard} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import type {RootChatMessage} from '../messaging';
import {useForeground} from './liveState';

const key=(m:RootChatMessage)=>JSON.stringify([m.group?.messageId??m.id,m.direction,m.direction==='incoming'?m.peer:'own']);
export function useReplyNavigation<T>({scope,rows,message,list,loading,error,reveal,report,beforeJump}:{beforeJump?():void;scope:string;rows:T[];message(row:T):RootChatMessage|undefined;list:RefObject<FlatList<T>|null>;loading:boolean;error:string;reveal(m:RootChatMessage):void;report(error:string):void}){
 const focused=useIsFocused(),foreground=useForeground();
 const [target,setTarget]=useState<string>(),[highlight,setHighlight]=useState<string>();
 const retry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),clear=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),attempts=useRef(0);
 const latest=useRef({rows,message,list,report,target});latest.current={rows,message,list,report,target};
 const positioned=useRef<string|undefined>(undefined);
 const stop=useCallback(()=>{clearTimeout(retry.current);clearTimeout(clear.current);setTarget(undefined);setHighlight(undefined);attempts.current=0;positioned.current=undefined;},[]);
 useEffect(()=>{stop();return()=>{clearTimeout(retry.current);clearTimeout(clear.current);};},[scope,focused,foreground,stop]);
 const scroll=useCallback(()=>{const s=latest.current;if(!s.target)return;const index=s.rows.findIndex(row=>{const m=s.message(row);return m&&key(m)===s.target;});if(index<0)return;
  positioned.current=s.target;setHighlight(s.target);s.list.current?.scrollToIndex({index,viewPosition:0.5,animated:true});
  clearTimeout(clear.current);clear.current=setTimeout(()=>{setHighlight(undefined);setTarget(undefined);},3000);
 },[]);
 useEffect(()=>{if(!target||loading||!focused||!foreground||positioned.current===target)return;
  if(!rows.some(row=>{const m=message(row);return m&&key(m)===target;})){report(error||'Original message unavailable on this device');stop();return;}
  scroll();
 },[target,rows,loading,error,focused,foreground,scroll]);
 const jump=useCallback((m?:RootChatMessage)=>{stop();if(!m){latest.current.report('Original message unavailable on this device');return;}if(!focused||!foreground)return;
  beforeJump?.();Keyboard.dismiss();const targetKey=key(m);setTarget(targetKey);
  if(!latest.current.rows.some(row=>{const item=latest.current.message(row);return item&&key(item)===targetKey;}))reveal(m);
 },[stop,reveal,focused,foreground,beforeJump]);
 const failed=useCallback((info:{index:number;averageItemLength:number})=>{if(!latest.current.target)return;clearTimeout(clear.current);
  if(++attempts.current>8){latest.current.report('Unable to scroll to the original message. Please try again.');stop();return;}
  latest.current.list.current?.scrollToOffset({offset:Math.max(0,info.averageItemLength*info.index),animated:false});
  clearTimeout(retry.current);retry.current=setTimeout(scroll,180);
 },[scroll,stop]);
 return {jump,failed,isHighlighted:(m:RootChatMessage)=>highlight===key(m),highlight};
}
