import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import OutgoingCallAppearance from './OutgoingCallAppearance';
import {useCallback,useEffect,useRef,useState} from 'react';
import {localAccountCalls,subscribeLocalAccountCalls} from '../../modules/calls';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {nickname,startCall} from '../rootScreenSupport';
export default function OutgoingCall({route,navigation}:Screen<'OutgoingCall'>){

 const {state}=useOwnChat(),[busy,setBusy]=useState(false),[finding,setFinding]=useState(false),[error,setError]=useState(''),lock=useRef(false),proceed=useRef(false),mounted=useRef(true),callId=useRef<string|null>(null);
 const cancel=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const id=callId.current;if(id)await localAccountCalls()?.end(id);if(mounted.current){proceed.current=true;navigation.goBack();}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to cancel call');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>navigation.addListener('beforeRemove',event=>{
  if(proceed.current)return;if(lock.current){event.preventDefault();return;}
  if(callId.current){event.preventDefault();void cancel();}
 }),[navigation]);
 const update=useCallback((call:ReturnType<NonNullable<ReturnType<typeof localAccountCalls>>['snapshot']>)=>{
  if(!mounted.current||proceed.current||!callId.current||call?.id!==callId.current)return;
  if(call.status==='finding'){setFinding(true);return;}
  setFinding(false);
  if(call.status==='ended'){callId.current=null;setError(call.reason||'Peer unavailable');return;}
  proceed.current=true;navigation.goBack();
 },[navigation]);
 useEffect(()=>subscribeLocalAccountCalls(update),[update]);
 async function start(){if(lock.current||callId.current)return;lock.current=true;setBusy(true);setError('');try{
  const contact=state.contacts.find(c=>c.account===route.params.peer);if(contact?.blocked)throw Error('Unblock this identity before calling');
  const calls=localAccountCalls();if(calls?.snapshot()&&calls.snapshot()?.status!=='ended')throw Error('Finish your current call before starting another.');
  const id=await startCall(route.params.peer,route.params.kind);callId.current=id;
  if(mounted.current){setFinding(true);update(localAccountCalls()?.snapshot()??null);}
  else void localAccountCalls()?.end(id).catch(()=>{});
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to start call');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 return <OutgoingCallAppearance name={nickname(state,route.params.peer)} kind={route.params.kind} busy={busy} finding={finding} error={error} start={()=>void start()} cancel={()=>void cancel()}/>;

}
