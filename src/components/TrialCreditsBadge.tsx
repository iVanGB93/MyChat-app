import {t} from '../localization/language';
import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {prepareTrialTopUp,useAccountState,useTrialCredits} from '../modules/ui/liveState';
import {useTheme} from '../contexts/ThemeContext';
import {useConfirm} from '../contexts/ConfirmContext';
export default function TrialCreditsBadge(){
 const account=useAccountState(),credits=useTrialCredits(),{colors}=useTheme(),{alert,confirm}=useConfirm();
 const ready=credits?.status==='ready',balance=ready?credits.balance:undefined;
 const label=balance===undefined?'—':new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(balance);
 const open=()=>{
  if(!ready||account.state!=='unlocked'||!account.account){alert('Trial credits',credits?.status==='loading'?'Loading your local trial balance…':'Trial accounting is unavailable. Messaging and transfers remain unrestricted.');return;}
  const addCredits=prepareTrialTopUp(account.account);
  confirm({title:t("Trial credits"),icon:'flash-outline',message:'Balance: '+balance+'\nStarting allowance: 100\nEarned: '+credits.earned+' · Trial top-ups: '+(credits.topUps??0)+'\nSimulated spending: '+credits.spent+'\n\n+1 per unique verified relay recipient receipt. −1 per message/recipient confirmed stored by a relay; no charge for direct delivery. Media completion can earn a separate +1.\n\nTrial top-ups preserve your history and spending totals. No cash value or service restrictions. Negative balances are allowed. Not synchronized across devices.',buttons:[{text:t("Add 50 trial credits"),onPress:async()=>{
   const ok=await addCredits();
   if(!ok)alert('Could not add trial credits','Your existing history is preserved. Please try again. Service remains unrestricted.');
  }},{text:t("Close"),style:'cancel'}]});
 };
 return <Pressable accessibilityRole="button" accessibilityLabel={ready?t("Trial credits: ")+balance:t("Trial credits unavailable")} hitSlop={8} onPress={open} style={{flexDirection:'row',alignItems:'center',gap:6,marginRight:16,minHeight:44,maxWidth:130}}>
  <View style={{width:25,height:25,alignItems:'center',justifyContent:'center'}}><Ionicons name="flash-outline" size={17} color={colors.primary}/></View><Text numberOfLines={1} style={{color:colors.primary,fontSize:16,fontWeight:'700',flexShrink:1}}>{label}</Text>
 </Pressable>;
}

