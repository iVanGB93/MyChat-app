import {FloatingTabHeader} from './FloatingHeader';
import React, {useCallback} from 'react';
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
    Game:    ['game-controller-outline',     'game-controller'],
    Profile: ['person-outline',              'person'],
  };
  const [outline] = iconMap[label] ?? ['ellipse-outline', 'ellipse'];
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center',width:48,height:30 }}>
      <Ionicons
        name={outline}
        size={24}
        color={focused ? Colors.primary : Colors.textTertiary}
      />
    </View>
  );
}


export function useMainTabOptions(){const {colors:Colors}=useTheme();const insets=useSafeAreaInsets();return useCallback(({route}:{route:{name:string}}):BottomTabNavigationOptions => ({
        // Screen hooks pause their own polling; freezing adds a Suspense thaw on each tab switch.
        freezeOnBlur: false,
        headerTransparent: route.name==='Chats'||route.name==='Profile',
        header: props => <FloatingTabHeader {...props}/>,
        headerStyle: {
          backgroundColor: Colors.headerBg,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: Colors.neonBorder,
        },
        headerTitleStyle: { fontWeight: '800', letterSpacing: 3, color: Colors.headerText, fontSize: Font.size.lg },
        headerTintColor: Colors.headerText,
        tabBarStyle: {
          backgroundColor: Colors.tabBarBg,
          borderColor: Colors.neonBorder,
          borderWidth: 1,
          borderTopWidth: 1,
          borderRadius: 32,
          position: 'absolute',
          start: 16,
          end: 16,
          bottom: Math.max(insets.bottom,8)+8,
          // Screens provide scroll clearance; content can continue behind the pill.
          height: 66,
          paddingBottom: 8,
          paddingTop: 6,
          elevation: 12,
          shadowColor: Colors.primary,
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1 },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      }),[Colors,insets.bottom]);}
