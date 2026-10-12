import React from 'react';
import {TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Avatar from '../ui/Avatar';
import SyncingHeaderTitle from './SyncingHeaderTitle';
import {chatRoomStyles as styles} from './chat-room-styles';
export default function ChatHeaderIdentity({
  title,
  syncing,
  color,
  avatarUri,
  isGroup,
  isOnline,
  onPress,
  onBack,
}: {
  title: string;
  syncing: boolean;
  color: string;
  avatarUri: string | null;
  isGroup: boolean;
  isOnline: boolean;
  onPress: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.headerNavigation}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.headerBack}>
      <Ionicons name="arrow-back" size={24} color={color}/>
    </TouchableOpacity>
    <TouchableOpacity
      testID="axonic-chat-header-details"
      accessibilityRole="button"
      accessibilityLabel={`Open details for ${title}`}
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
      <SyncingHeaderTitle title={title} syncing={syncing} color={color} />
    </TouchableOpacity>
    </View>
  );
}
