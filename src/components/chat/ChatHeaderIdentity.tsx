import {useLanguage} from '../../localization/useLanguage';
import {t} from '../../localization/language';
import React from 'react';
import {Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Avatar from '../ui/Avatar';
import SyncingHeaderTitle from './SyncingHeaderTitle';
import {chatRoomStyles as styles} from './chat-room-styles';
export default function ChatHeaderIdentity({
  title,
  activity,
  syncing,
  color,
  avatarUri,
  isGroup,
  isOnline,
  onPress,
  onBack,
}: {
  title: string;
  activity?:string;
  syncing: boolean;
  color: string;
  avatarUri: string | null;
  isGroup: boolean;
  isOnline: boolean;
  onPress: () => void;
  onBack: () => void;
}) {
 useLanguage();
  return (
    <View style={styles.headerNavigation}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Go back")} onPress={onBack} style={styles.headerBack}>
      <Ionicons name="arrow-back" size={18} color={color}/>
    </TouchableOpacity>
    <TouchableOpacity
      testID="axonic-chat-header-details"
      accessibilityRole="button"
      accessibilityLabel={t("Open details for {0}",{0:title})}
      activeOpacity={0.72}
      style={styles.headerIdentity}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={onPress}
    >
      <Avatar
        name={title}
        uri={avatarUri}
        size={34}
        showOnline={!isGroup}
        isOnline={isOnline}
      />
      <View style={{flexShrink:1,minWidth:0}}><SyncingHeaderTitle title={title} syncing={syncing} color={color} />{activity&&<Text testID="chat-header-activity" numberOfLines={1} style={{color,fontSize:11,marginTop:1}}>{activity}</Text>}</View>
    </TouchableOpacity>
    </View>
  );
}
