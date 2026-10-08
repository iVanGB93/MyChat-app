import React from 'react';
import {TouchableOpacity} from 'react-native';
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
}: {
  title: string;
  syncing: boolean;
  color: string;
  avatarUri: string | null;
  isGroup: boolean;
  isOnline: boolean;
  onPress: () => void;
}) {
  return (
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
  );
}
