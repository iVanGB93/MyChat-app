import ScreenHeader from '../../components/ui/ScreenHeader';
import React,{useEffect,useRef,useState} from 'react';
import {AppState,Modal,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {localAccount,localAccountBiometrics as biometrics} from '../../modules/identity';
import {useTheme} from '../../contexts/ThemeContext';
import {KeyboardFormScrollView} from '../../components/ui/KeyboardForm';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

export default function RecoveryWordsReveal({account,visible}:{account:string;visible:boolean}){
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 const [open,setOpen]=useState(false),[password,setPassword]=useState(''),[phrase,setPhrase]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),running=useRef(false),mounted=useRef(true);
 const close=()=>{generation.current++;setOpen(false);setPassword('');setPhrase('');setError('');};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{close();},[account,visible]);
 useEffect(()=>{
  const app=AppState.addEventListener('change',state=>{if(state==='background')close();});
  const stop=localAccount.subscribe(()=>{const s=localAccount.status();if(s.state!=='unlocked'||s.account!==account)close();});
  return()=>{app.remove();stop();};
 },[account]);
 async function reveal(useBiometrics:boolean){
  if(running.current)return;
  running.current=true;const own=generation.current;setBusy(true);setError('');
  try{
   const words=useBiometrics?await biometrics.authenticate(secret=>{
    if(!mounted.current||generation.current!==own||AppState.currentState!=='active')throw Error('Authentication interrupted');
    return localAccount.revealRecoveryWords(secret,account);
   }):await localAccount.revealRecoveryWords(password,account);
   const status=localAccount.status();
   if(mounted.current&&generation.current===own&&status.state==='unlocked'&&status.account===account&&AppState.currentState==='active'){setPassword('');setPhrase(words);}
  }catch{if(mounted.current&&generation.current===own)setError('Authentication failed. Check your password or try biometrics again.');}
  finally{running.current=false;if(mounted.current){setBusy(false);setPassword('');}}
 }
 return <>
  <Button title="SHOW RECOVERY WORDS" onPress={()=>{close();setOpen(true);}}/>
  <Modal visible={visible&&open} animationType="slide" onRequestClose={close}>
   <View style={{flex:1,backgroundColor:colors.background}}>
    <ScreenHeader title="Recovery words" backLabel="Close recovery words" onBack={close}/>
    <KeyboardFormScrollView contentContainerStyle={{padding:20,paddingBottom:insets.bottom+24,gap:16}}>
     {phrase?<>
      <Text style={{color:colors.text,fontSize:18,fontWeight:'600'}}>Your {phrase.split(' ').length} recovery words</Text>
      <Text style={{color:colors.textSecondary,lineHeight:22}}>Write these words down in order and keep them somewhere safe. Anyone with these words can control your identity.</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{phrase.split(' ').map((word,index)=><View key={index} style={{width:'47%',flexDirection:'row',alignItems:'center',gap:10,padding:12,borderRadius:12,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface}}><Text style={{color:colors.textTertiary,fontSize:12}}>{index+1}</Text><Text style={{color:colors.text,fontSize:16}}>{word}</Text></View>)}</View>
      <Button title="HIDE WORDS" onPress={close}/>
     </>:<>
      <Text style={{color:colors.textSecondary,lineHeight:22}}>Use your account password or biometric unlock to view your recovery words.</Text>
      <Input label="CURRENT PASSWORD" accessibilityLabel="Password to reveal recovery words" value={password} onChangeText={setPassword} isPassword autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={256} editable={!busy}/>
      <Button title="SHOW WITH PASSWORD" loading={busy} disabled={!password} onPress={()=>void reveal(false)}/>
      {biometrics.available()&&<Button title="USE BIOMETRICS" variant="outline" disabled={busy} onPress={()=>void reveal(true)}/>}
      {!!error&&<Text accessibilityRole="alert" style={{color:colors.error}}>{error}</Text>}
     </>}
    </KeyboardFormScrollView>
   </View>
  </Modal>
 </>;
}
