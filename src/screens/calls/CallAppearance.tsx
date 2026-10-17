import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Font, Radius, Spacing } from '../../theme';

/* -------------------- helpers -------------------- */

export function ActionButton({
  size = 64,
  testID,
  icon,
  label,
  active,
  onPress,
  Colors,
}: {
  size?: number;
  testID?: string;
  icon: any;
  label: string;
  active?: boolean;
  onPress: () => void;
  Colors: any;
}) {
  return (
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} activeOpacity={0.7} style={{ alignItems: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: active ? Colors.primary : Colors.neonBorder,
          backgroundColor: active ? 'rgba(0,70,85,0.85)' : 'rgba(2,4,19,0.65)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOpacity: active ? 0.5 : 0.2,
          shadowRadius: active ? 10 : 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: active ? 5 : 2,
        }}
      >
        <Ionicons name={icon} size={22} color={active ? Colors.primary : '#fff'} />
      </View>
      <Text style={makeStyles(Colors).actionLabel}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* -------------------- styles -------------------- */

export function makeStyles(Colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#020413',
    },
    fullVideo: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    selfView: {position:'absolute',width:110,zIndex:5,gap:6},
    pipWrap: {
      width: 110,
      height: 150,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.9)',
      backgroundColor: '#020413',
      // Keep Android's rectangular native surface inside every rounded frame corner.
      padding: Math.ceil(Radius.lg * (1 - Math.SQRT1_2)),
      shadowColor: Colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      overflow: 'hidden',
      zIndex: 5,
    },
    pip: {
      flex: 1,
      backgroundColor: '#000',
      borderRadius: Radius.lg - Math.ceil(Radius.lg * (1 - Math.SQRT1_2)) - 1,
      overflow: 'hidden',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      paddingTop: Platform.OS === 'ios' ? 70 : 50,
      paddingBottom: Platform.OS === 'ios' ? 50 : 32,
    },
    top: { alignItems: 'center',paddingHorizontal:Spacing.md,paddingBottom:Spacing.lg },
    actionLabel: {color:'#fff',backgroundColor:'rgba(2,4,19,0.65)',paddingHorizontal:6,borderRadius:6,fontSize:Font.size.xs,marginTop:6,...Font.medium,textAlign:'center'},
    typePill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    typePillText: {
      fontSize: 11,
      ...Font.bold,
      letterSpacing: 1.5,
    },
    avatarWrap: {
      marginTop: Spacing.xl,
      padding: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: Colors.neonBorder,
      shadowColor: Colors.primary,
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    name: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      color: '#fff',
      fontSize: Font.size.xxl,
      marginTop: Spacing.lg,
      ...Font.bold,
      letterSpacing: 0.5,
      textAlign:'center',
      maxWidth:'100%',
    },
    status: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      color: 'rgba(255,255,255,0.75)',
      fontSize: Font.size.md,
      marginTop: Spacing.xs,
      ...Font.medium,
      letterSpacing: 1,
    },
    quality: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 4,
      paddingVertical: 5,
      borderRadius: 8,
      gap: 2,
    },
    optionsBackdrop: {flex:1,justifyContent:'flex-end',alignItems:'flex-end',backgroundColor:'rgba(0,0,0,0.35)'},
    optionsPanel: {width:'100%',maxWidth:380,maxHeight:'70%',flexShrink:1,borderRadius:20,borderWidth:1,borderColor:Colors.neonBorder,backgroundColor:Colors.headerBg,overflow:'hidden'},
    optionsHeader: {flexDirection:'row',alignItems:'center',gap:8,paddingLeft:16,borderBottomWidth:1,borderBottomColor:Colors.neonBorder},
    optionsTitle: {flex:1,color:Colors.primary,fontSize:16,...Font.medium},
    optionsClose: {width:44,height:48,alignItems:'center',justifyContent:'center'},
    optionsContent: {padding:12,gap:4},
    optionsSection: {color:'rgba(255,255,255,0.6)',fontSize:11,...Font.medium,letterSpacing:1,marginBottom:6},
    qualityChoices: {flexDirection:'row',gap:4},
    qualityChoice: {flex:1,minHeight:44,paddingVertical:10,justifyContent:'center',alignItems:'center',borderRadius:10,borderWidth:1,borderColor:'transparent',backgroundColor:'rgba(255,255,255,0.05)'},
    qualityChoiceSelected: {borderColor:Colors.primary,backgroundColor:'rgba(0,229,255,0.1)'},
    optionText: {color:'#fff',fontSize:14},
    optionDetail: {color:'rgba(255,255,255,0.6)',fontSize:11,marginTop:2},
    optionError: {color:Colors.error,fontSize:12,marginVertical:4},
    audioChoice: {flexDirection:'row',alignItems:'center',gap:10,minHeight:44,paddingHorizontal:10,paddingVertical:8,borderRadius:10},
    audioChoiceSelected: {backgroundColor:'rgba(0,229,255,0.08)'},
    routeInUse: {color:Colors.primary,fontSize:11},
    actions: {
      flexDirection: 'row',
      flexWrap:'wrap',
      alignItems:'flex-start',
      rowGap:Spacing.md,
      justifyContent: 'space-evenly',
      paddingHorizontal: Spacing.lg,
    },
    endBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: Colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.error,
      shadowOpacity: 0.7,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
  });
}
