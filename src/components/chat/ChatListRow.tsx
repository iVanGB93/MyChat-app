import {useLanguage} from '../../localization/useLanguage';
import {t} from '../../localization/language';
import React,{useRef} from 'react';
import {deliveryStatusIcon,deliveryStatusLabel} from '../../modules/messaging';
import {Animated,View,Text,TouchableOpacity} from 'react-native';
import {Swipeable} from 'react-native-gesture-handler';
import {Ionicons} from '@expo/vector-icons';
import type {ThemeColors} from '../../theme';
import Avatar from '../ui/Avatar';
import {chatPreviewText} from '../../utils/chat-preview-text';
import {chatListStyles as styles} from './chat-list-styles';
interface ChatListRowProps {
  roomId: string;
  displayName: string;
  avatarUri: string | null;
  isDirect: boolean;
  isOnline: boolean;
  otherUserId?: number;
  lastMsgContent: string | null;
  lastMsgTime: string | null;
  lastMsgFromMe: boolean;
  lastMsgStatus?: 'pending' | 'stored' | 'delivered' | 'read' | 'cancelled' | 'unavailable';
  unread: number;
  typingLabel: string | null;
  isMuted: boolean;
  selectionMode: boolean;
  selected: boolean;
  Colors: ThemeColors;
  onOpen: (roomId: string, displayName: string, otherUserId?: number) => void;
  onLongPress: (roomId: string) => void;
  onToggleSelection: (roomId: string) => void;
  onAvatarPress: (roomId: string) => void;
  onMarkRead: (roomId: string) => void;
  onCall?: (roomId: string, kind: 'voice' | 'video') => void;
}

function ChatListRowBase({
  roomId,
  displayName,
  avatarUri,
  isDirect,
  isOnline,
  otherUserId,
  lastMsgContent,
  lastMsgTime,
  lastMsgFromMe,
  lastMsgStatus,
  unread,
  typingLabel,
  isMuted,
  selectionMode,
  selected,
  Colors,
  onOpen,
  onLongPress,
  onToggleSelection,
  onAvatarPress,
  onMarkRead,
  onCall,
}: ChatListRowProps) {
 useLanguage();
  const canCall = isDirect && !!onCall;
  const pendingCall=useRef<'voice'|'video'|null>(null);
  const renderAction=(progress:Animated.AnimatedInterpolation<number>,kind:'voice'|'video'|'read')=>(
    <View style={[styles.swipeAction,{width:canCall?144:80,backgroundColor:Colors.highlight,borderRadius:20,overflow:'hidden'}]}>
      <Animated.View style={{alignItems:'center',gap:6,opacity:progress.interpolate({inputRange:[0,0.25,1],outputRange:[0,0.35,1],extrapolate:'clamp'}),transform:[{scale:progress.interpolate({inputRange:[0,1],outputRange:[0.75,1],extrapolate:'clamp'})}]}}>
        <Ionicons name={kind==='voice'?'call-outline':kind==='video'?'videocam-outline':'checkmark-done'} size={26} color={Colors.primary}/>
        <Text style={[styles.swipeActionText,{color:Colors.primary}]}>{kind==='voice'?'Call':kind==='video'?t("Video call"):t("Mark read")}</Text>
      </Animated.View>
    </View>
  );
  const renderLeftActions=(progress:Animated.AnimatedInterpolation<number>)=>renderAction(progress,'voice');
  const renderRightActions=(progress:Animated.AnimatedInterpolation<number>)=>renderAction(progress,canCall?'video':'read');

  const row = (
    <TouchableOpacity
      testID={`chat-row-${roomId}`}
      accessibilityLabel={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${displayName}` : t("Open chat with {0}",{0:displayName})}
      accessibilityState={{ selected }}
      style={[
        styles.chatItem,
        {
          borderColor: selected ? Colors.primary : Colors.neonBorder,
          backgroundColor: selected ? Colors.highlight : Colors.background,
        },
      ]}
      activeOpacity={0.7}
      onLongPress={() => onLongPress(roomId)}
      delayLongPress={350}
      onPress={() => {
        if (selectionMode) onToggleSelection(roomId);
        else onOpen(roomId, displayName, otherUserId);
      }}
    >
      {/* Left accent bar */}
      <View style={[styles.accentBar, { backgroundColor: Colors.primary }]} />

      {selectionMode && (
        <View
          style={[
            styles.selectionCircle,
            {
              borderColor: selected ? Colors.primary : Colors.textTertiary,
              backgroundColor: selected ? Colors.primary : 'transparent',
            },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={Colors.background} />}
        </View>
      )}

      <TouchableOpacity
        testID={`chat-avatar-${roomId}`}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Preview ${displayName}`}
        style={styles.avatarWrapper}
        activeOpacity={0.72}
        disabled={selectionMode}
        onPress={(event) => {
          event.stopPropagation();
          onAvatarPress(roomId);
        }}
      >
        <Avatar
          name={displayName}
          uri={avatarUri}
          size={50}
          showOnline={isDirect}
          isOnline={isOnline}
        />
      </TouchableOpacity>

      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={[styles.chatName, { color: Colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {isMuted && (
              <Ionicons
                name="notifications-off"
                size={14}
                color={Colors.textTertiary}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          {lastMsgTime && (
            <Text style={[styles.chatTime, { color: Colors.primary }]}>
              {lastMsgTime}
            </Text>
          )}
        </View>
        <View style={styles.chatBottomRow}>
          <Text
            style={[
              styles.lastMessage,
              typingLabel
                ? { color: Colors.primary, fontStyle: 'italic' }
                : { color: unread > 0 ? Colors.text : Colors.textSecondary, fontWeight: unread > 0 ? '600' : '400' },
            ]}
            numberOfLines={1}
          >
            {typingLabel
              ? typingLabel
              : lastMsgContent != null
                ? (
                  <>
                    {lastMsgFromMe && (
                      <Text>
                        <Ionicons
                          accessibilityLabel={t(deliveryStatusLabel(lastMsgStatus ?? 'pending'))}
                          name={deliveryStatusIcon(lastMsgStatus ?? 'pending')}
                          size={14}
                          color={lastMsgStatus === 'read' ? Colors.checkBlue : Colors.textTertiary}
                        />{' '}
                      </Text>
                    )}
                    {chatPreviewText(lastMsgContent)}
                  </>
                )
                : '— no messages yet —'}
          </Text>
          {unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: isMuted ? Colors.textTertiary : Colors.primary }]}>
              <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if ((unread > 0 || canCall) && !selectionMode) {
    return (
      <Swipeable
        renderLeftActions={canCall ? renderLeftActions : undefined}
        renderRightActions={canCall || unread > 0 ? renderRightActions : undefined}
        friction={canCall?1.5:1}
        leftThreshold={canCall?120:40}
        rightThreshold={canCall?120:40}
        dragOffsetFromLeftEdge={18}
        dragOffsetFromRightEdge={18}
        animationOptions={{speed:16,bounciness:0,overshootClamping:true}}
        onSwipeableClose={()=>{const kind=pendingCall.current;pendingCall.current=null;if(kind)onCall?.(roomId,kind);}}
        overshootLeft={false}
        overshootRight={false}
        onSwipeableOpen={(direction, swipeable) => {
          if(canCall)pendingCall.current=direction==='left'?'voice':'video';
          else if(direction==='right')onMarkRead(roomId);
          swipeable.close();
        }}
      >
        {row}
      </Swipeable>
    );
  }
  return row;
}

export default React.memo(ChatListRowBase);


