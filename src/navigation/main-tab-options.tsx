import React from 'react';
import {View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import {Font} from '../theme';
import type {BottomTabNavigationOptions} from '@react-navigation/bottom-tabs';
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const { colors: Colors } = useTheme();
  // Outline when inactive, filled when focused — matches the rest of the UI
  // and feels closer to the cyberpunk "glowing line" aesthetic.
  const iconMap: Record<string, [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']]> = {
    Chats:   ['chatbubble-ellipses-outline', 'chatbubble-ellipses'],
    Calls:   ['call-outline',                'call'],
    Profile: ['person-outline',              'person'],
  };
  const [outline, filled] = iconMap[label] ?? ['ellipse-outline', 'ellipse'];
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons
        name={focused ? filled : outline}
        size={24}
        color={focused ? Colors.primary : Colors.textTertiary}
        style={{
          opacity: focused ? 1 : 0.7,
          transform: [{ scale: focused ? 1.05 : 1 }],
        }}
      />
    </View>
  );
}


export function useMainTabOptions(){const {colors:Colors}=useTheme();const insets=useSafeAreaInsets();return ({route}:{route:{name:string}}):BottomTabNavigationOptions => ({
        headerStyle: {
          backgroundColor: Colors.headerBg,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: Colors.neonBorder,
        },
        headerTitleStyle: { fontWeight: '800', letterSpacing: 3, color: Colors.primary, fontSize: Font.size.lg },
        headerTintColor: Colors.primary,
        tabBarStyle: {
          backgroundColor: Colors.tabBarBg,
          borderTopColor: Colors.neonBorder,
          borderTopWidth: 1,
          // Grow the bar to host the system nav inset (3-button bar on
          // Android, home indicator on iOS) so labels/icons aren't
          // covered by the OS bar on devices without gesture nav.
          height: 62 + insets.bottom,
          paddingBottom: 10 + insets.bottom,
          paddingTop: 6,
          elevation: 12,
          shadowColor: Colors.primary,
          shadowOpacity: 0.15,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1 },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      });}
