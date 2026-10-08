import React from 'react';
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {Font,Radius,Spacing} from '../../theme';

/** The original confirmation sheet, shared by both account transports. */
export default function OutgoingCallAppearance({name,kind,busy,error,start,cancel}:{name:string;kind:'voice'|'video';busy:boolean;error:string;start():void;cancel():void}){
 const {colors:c}=useTheme(),insets=useSafeAreaInsets();
 return <View style={{flex:1,justifyContent:'flex-end',paddingTop:insets.top}}>
  <Pressable accessibilityRole="button" accessibilityLabel="Cancel call confirmation" disabled={busy} onPress={cancel} style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.55)'}]}/>
  <ScrollView style={{flexGrow:0,backgroundColor:c.surface,borderColor:c.neonBorder,borderWidth:1,borderBottomWidth:0,borderTopLeftRadius:Radius.lg,borderTopRightRadius:Radius.lg}} contentContainerStyle={{paddingHorizontal:Spacing.lg,paddingTop:Spacing.md,paddingBottom:Spacing.xl+insets.bottom,gap:Spacing.sm}}>
   <View style={{alignSelf:'center',width:44,height:4,borderRadius:2,backgroundColor:c.neonBorder,marginBottom:Spacing.md,opacity:0.6}}/>
   <View style={{alignSelf:'center',width:52,height:52,borderRadius:14,borderWidth:1.5,borderColor:c.primary,alignItems:'center',justifyContent:'center',marginBottom:Spacing.sm}}><Ionicons name={kind==='video'?'videocam-outline':'call-outline'} size={24} color={c.primary}/></View>
   <Text accessibilityRole="header" style={{color:c.primary,fontSize:Font.size.md,fontWeight:'800',letterSpacing:1.5,textAlign:'center'}}>{busy?'STARTING CALL…':`START ${kind.toUpperCase()} CALL?`}</Text>
   <Text style={{color:c.textSecondary,fontSize:Font.size.sm,textAlign:'center',lineHeight:20,marginBottom:Spacing.md}}>{busy?`Connecting to ${name}. You only need to press Start once.`:`Would you like to start a ${kind} call with ${name}?`}</Text>
   {busy&&<ActivityIndicator accessibilityLabel="Starting call" size="large" color={c.primary} style={{marginVertical:Spacing.md}}/>}
   {!!error&&<Text selectable accessibilityRole="alert" style={{color:c.error,textAlign:'center'}}>{error}</Text>}
   {!busy&&<><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Start ${kind} call`} onPress={start} style={[styles.button,{borderColor:c.primary,backgroundColor:c.highlight}]}><Text style={[styles.buttonText,{color:c.primary}]}>START {kind.toUpperCase()} CALL</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={cancel} style={[styles.button,{borderColor:c.neonBorder,borderStyle:'dashed'}]}><Text style={[styles.buttonText,{color:c.textSecondary}]}>CANCEL</Text></TouchableOpacity></>}
  </ScrollView>
 </View>;
}
const styles=StyleSheet.create({button:{paddingVertical:Spacing.md,minHeight:52,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,borderWidth:1.5},buttonText:{fontSize:Font.size.sm,fontWeight:'800',letterSpacing:1.5}});
