import React,{useEffect,useRef} from 'react';
import {ActivityIndicator,Animated,Easing,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {RTCView} from 'react-native-webrtc';
import {Font,Spacing} from '../../theme';
import Avatar from '../../components/ui/Avatar';
import {useTheme} from '../../contexts/ThemeContext';
/** Original incoming-call presentation; transport and permissions belong to the caller. */
export default function IncomingCallAppearance({callerName,avatarUri,isVideo,localPreviewUrl=null,busy=false,error,handleAccept,handleReject}:{callerName:string;avatarUri?:string|null;isVideo:boolean;localPreviewUrl?:string|null;busy?:boolean;error?:string;handleAccept:()=>void;handleReject:()=>void}){
 const {colors:Colors}=useTheme(),styles=makeStyles(Colors),insets=useSafeAreaInsets();
 const pulse=useRef(new Animated.Value(0)).current,sweep=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  const rings=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:1,duration:1100,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),Animated.timing(pulse,{toValue:0,duration:1100,easing:Easing.inOut(Easing.ease),useNativeDriver:true})]));
  const scan=Animated.loop(Animated.timing(sweep,{toValue:1,duration:2200,easing:Easing.linear,useNativeDriver:true}));rings.start();scan.start();return()=>{rings.stop();scan.stop();};
 },[pulse,sweep]);
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const ring2Scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });
  const ring2Opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });
  const sweepRotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.container,{paddingTop:insets.top+24,paddingBottom:Math.max(insets.bottom,16)+24,paddingLeft:insets.left,paddingRight:insets.right}]}>
      {isVideo && localPreviewUrl && (
        <RTCView
          streamURL={localPreviewUrl}
          style={styles.incomingPreview}
          objectFit="cover"
          mirror
          zOrder={0}
        />
      )}
      {/* Background grid glow */}
      <View pointerEvents="none" style={styles.bgGlowTop} />
      <View pointerEvents="none" style={styles.bgGlowBottom} />

      <ScrollView style={{flexGrow:0,flexShrink:1}} contentContainerStyle={styles.content}>
        <View style={[styles.typePill, { borderColor: Colors.neonBorder }]}>
          <Ionicons
            name={isVideo ? 'videocam-outline' : 'call-outline'}
            size={14}
            color={Colors.primary}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.typePillText, { color: Colors.primary }]}>
            INCOMING {isVideo ? 'VIDEO' : 'VOICE'} CALL
          </Text>
        </View>

        {!localPreviewUrl && (
          <>
            {/* Pulsing rings around avatar */}
            <View style={styles.avatarStack}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { borderColor: Colors.primary, opacity: ring2Opacity, transform: [{ scale: ring2Scale }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.pulseRing,
                  { borderColor: Colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.sweep,
                  { borderColor: Colors.primary, transform: [{ rotate: sweepRotate }] },
                ]}
              />
              <View style={styles.avatarWrap}>
                <Avatar uri={avatarUri} name={callerName} size={140} />
              </View>
            </View>
          </>
        )}

        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.callerName}>{callerName}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>{busy?'Answering…':'is calling you…'}</Text>
        {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.actions}>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity style={styles.rejectBtn} accessibilityRole="button" accessibilityLabel="Decline call" onPress={handleReject} activeOpacity={0.85}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.btnLabel}>Decline</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity style={[styles.acceptBtn,busy&&{opacity:0.65}]} accessibilityRole="button" accessibilityLabel="Accept call" accessibilityState={{disabled:busy,busy}} disabled={busy} onPress={handleAccept} activeOpacity={0.85}>
            {busy?<ActivityIndicator color="#021015"/>:<Ionicons name={isVideo ? 'videocam' : 'call'} size={28} color="#021015" />}
          </TouchableOpacity>
          <Text style={styles.btnLabel}>{busy?'Answering':'Accept'}</Text>
        </View>
      </View>
    </View>
  );
}
function makeStyles(Colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#020413',
      justifyContent: 'space-between',
    },
    bgGlowTop: {
      position: 'absolute',
      top: -160,
      left: -80,
      width: 360,
      height: 360,
      borderRadius: 180,
      backgroundColor: Colors.primary,
      opacity: 0.08,
    },
    bgGlowBottom: {
      position: 'absolute',
      bottom: -180,
      right: -100,
      width: 380,
      height: 380,
      borderRadius: 190,
      backgroundColor: Colors.accent,
      opacity: 0.07,
    },

    content: { alignItems: 'center',paddingHorizontal:Spacing.lg,paddingBottom:Spacing.lg },
    incomingPreview: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    typePill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.35)',
      marginBottom: Spacing.xl,
    },
    typePillText: {
      fontSize: 11,
      ...Font.bold,
      letterSpacing: 1.5,
    },

    avatarStack: {
      width: 200,
      height: 200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarWrap: {
      padding: 4,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: Colors.primary,
      shadowColor: Colors.primary,
      shadowOpacity: 0.8,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
    pulseRing: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
      borderWidth: 2,
    },
    sweep: {
      position: 'absolute',
      width: 196,
      height: 196,
      borderRadius: 98,
      borderWidth: 1,
      borderColor: 'transparent',
      borderTopColor: Colors.primary,
      opacity: 0.6,
    },

    callerName: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      fontSize: Font.size.xxl,
      color: '#fff',
      marginTop: Spacing.xl,
      ...Font.bold,
      letterSpacing: 0.5,
      textAlign:'center',
      maxWidth:'100%',
    },
    status: {
      color:'rgba(255,255,255,0.85)',
      backgroundColor:'rgba(2,4,19,0.65)',
      paddingHorizontal:8,
      borderRadius:8,
      fontSize: Font.size.md,
      marginTop: Spacing.xs,
      letterSpacing: 0.5,
    },
    error: {color:'#FF8FA8',textAlign:'center',marginTop:Spacing.md,fontSize:Font.size.sm,backgroundColor:'rgba(2,4,19,0.85)',padding:Spacing.sm,borderRadius:8},

    actions: {
      flexShrink:0,
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      paddingHorizontal: Spacing.xl,
    },
    rejectBtn: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: Colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.error,
      shadowOpacity: 0.7,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
    acceptBtn: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: Colors.success,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.success,
      shadowOpacity: 0.8,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 9,
    },
    btnLabel: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 6,
      borderRadius: 6,
      color: '#fff',
      fontSize: Font.size.xs,
      marginTop: 8,
      opacity: 0.85,
      ...Font.medium,
      letterSpacing: 1,
    },
  });
}
