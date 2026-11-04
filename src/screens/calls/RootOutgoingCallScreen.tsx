import {useLanguage} from '../../localization/useLanguage';
import {t,languageSnapshot} from '../../localization/language';
import {useChatListSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import OutgoingCallAppearance from './OutgoingCallAppearance';
import {useCallback,useEffect,useRef,useState} from 'react';
import {localAccountCalls,subscribeLocalAccountCalls} from '../../modules/calls';
import type {RootAccountScreen as Screen} from '../../navigation/rootAccountRoutes';
import {nickname,startCall} from '../rootScreenSupport';
export default function OutgoingCall({route,navigation}:Screen<'OutgoingCall'>){
 useLanguage();

 const {state}=useOwnChat(),[busy,setBusy]=useState(false),[finding,setFinding]=useState(false),[error,setError]=useState(''),lock=useRef(false),proceed=useRef(false),mounted=useRef(true),callId=useRef<string|null>(null);
 const [kind,setKind]=useState<'voice'|'video'>(route.params.kind);
 const switchKind=()=>{if(lock.current||callId.current||finding)return;setKind(current=>current==='voice'?'video':'voice');setError('');};
 const cancel=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const id=callId.current;if(id)await localAccountCalls()?.end(id);if(mounted.current){proceed.current=true;navigation.goBack();}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:t("Unable to cancel call"));}
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
  if(call.status==='ended'){callId.current=null;setError(call.reason||t("Peer unavailable"));return;}
  proceed.current=true;navigation.goBack();
 },[navigation,languageSnapshot()]);
 useEffect(()=>subscribeLocalAccountCalls(update),[update]);
 async function start(){if(lock.current||callId.current)return;lock.current=true;setBusy(true);setError('');try{
  const contact=state.contacts.find(c=>c.account===route.params.peer);if(contact?.blocked)throw Error(t("Unblock this identity before calling"));
  const calls=localAccountCalls();if(calls?.snapshot()&&calls.snapshot()?.status!=='ended')throw Error(t("Finish your current call before starting another."));
  const id=await startCall(route.params.peer,kind);callId.current=id;
  if(mounted.current){setFinding(true);update(localAccountCalls()?.snapshot()??null);}
  else void localAccountCalls()?.end(id).catch(()=>{});
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:t("Unable to start call"));}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 return <OutgoingCallAppearance name={nickname(state,route.params.peer)} kind={kind} switchKind={switchKind} busy={busy} finding={finding} error={error} start={()=>void start()} cancel={()=>void cancel()}/>;

}
