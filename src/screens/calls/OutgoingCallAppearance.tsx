import {t} from '../../localization/language';
import {Chrome} from '../../theme';
import React from 'react';
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {Font,Spacing} from '../../theme';

/** The original confirmation sheet, shared by both account transports. */
export default function OutgoingCallAppearance({name,kind,busy,finding=false,error,start,cancel,switchKind,members,selectedCount,adding=false}:{name:string;kind:'voice'|'video';busy:boolean;finding?:boolean;error:string;start():void;cancel():void;switchKind():void;members?:React.ReactNode;selectedCount?:number;adding?:boolean}){
 const {colors:c}=useTheme(),insets=useSafeAreaInsets();
 const Sheet=members?View:ScrollView;
 const contentStyle={paddingHorizontal:Spacing.lg,paddingTop:Spacing.md,paddingBottom:Spacing.xl,gap:Spacing.sm};
 return <View style={{flex:1,justifyContent:'flex-end',paddingTop:insets.top}}>
  <Pressable accessibilityRole="button" accessibilityLabel={t("Cancel call confirmation")} disabled={busy||finding} onPress={cancel} style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.55)'}]}/>
  <Sheet style={[{flexGrow:0,flexShrink:1,maxHeight:'100%',backgroundColor:c.surface,borderColor:c.neonBorder,borderWidth:1,borderRadius:Chrome.panelRadius,marginHorizontal:Chrome.gutter,marginBottom:Math.max(insets.bottom,8)+4},members?contentStyle:undefined]} {...(members?{}:{contentContainerStyle:contentStyle})}>
   <View style={{alignSelf:'center',width:44,height:4,borderRadius:2,backgroundColor:c.neonBorder,marginBottom:Spacing.md,opacity:0.6}}/>
   <View style={{alignSelf:'center',width:52,height:52,borderRadius:26,borderWidth:1,borderColor:c.primary,alignItems:'center',justifyContent:'center',marginBottom:Spacing.sm}}><Ionicons name={kind==='video'?'videocam-outline':'call-outline'} size={24} color={c.primary}/></View>
   <Text accessibilityRole="header" style={{color:c.primary,fontSize:Font.size.md,fontWeight:'800',letterSpacing:1.5,textAlign:'center'}}>{finding?t("FINDING…"):busy?t("STARTING CALL…"):t("START {0} CALL?",{0:t(kind.toUpperCase())})}</Text>
   <Text style={{color:c.textSecondary,fontSize:Font.size.sm,textAlign:'center',lineHeight:20,marginBottom:Spacing.md}}>{finding?t("Finding {0}. Waiting for their device to respond.",{0:name}):busy?t("Connecting to {0}. You only need to press Start once.",{0:name}):members?name:t("Would you like to start a {0} call with {1}?",{0:t(kind),1:name})}</Text>
   {members}
   {(busy||finding)&&<ActivityIndicator accessibilityLabel={finding?t("Finding peer"):t("Starting call")} size="large" color={c.primary} style={{marginVertical:Spacing.md}}/>}
   {!!error&&<Text selectable accessibilityRole="alert" style={{color:c.error,textAlign:'center'}}>{error}</Text>}
   {!adding&&!busy&&!finding&&<TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Switch to {0} call",{0:kind==='voice'?t('video'):t('voice')})} onPress={switchKind} style={[styles.button,{borderColor:c.neonBorder,flexDirection:'row',gap:Spacing.sm}]}><Ionicons name={kind==='voice'?'videocam-outline':'call-outline'} size={22} color={c.primary}/><Text style={[styles.buttonText,{color:c.primary}]}>{t("Switch to {0} call",{0:kind==='voice'?t('video'):t('voice')})}</Text></TouchableOpacity>}
   {!busy&&<><TouchableOpacity accessibilityRole="button" accessibilityLabel={adding?t("Invite to call"):t("Start {0} call",{0:t(kind)})} disabled={finding||selectedCount===0} accessibilityState={{disabled:finding||selectedCount===0}} onPress={start} style={[styles.button,{borderColor:c.primary,backgroundColor:c.highlight,opacity:finding||selectedCount===0?0.45:1}]}><Text style={[styles.buttonText,{color:c.primary}]}>{adding?t("INVITE"):t("START {0} CALL",{0:t(kind.toUpperCase())})}{selectedCount!==undefined?' · '+selectedCount:''}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={cancel} style={[styles.button,{borderColor:c.neonBorder,borderStyle:'solid'}]}><Text style={[styles.buttonText,{color:c.textSecondary}]}>{t("CANCEL")}</Text></TouchableOpacity></>}
  </Sheet>
 </View>;
}
const styles=StyleSheet.create({button:{paddingVertical:Spacing.md,minHeight:52,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,borderWidth:1},buttonText:{fontSize:Font.size.sm,fontWeight:'800',letterSpacing:1.5}});
