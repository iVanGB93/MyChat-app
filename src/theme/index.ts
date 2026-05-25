/* ------------------------------------------------------------------ */
/*  Design tokens — Light & Dark palettes                              */
/* ------------------------------------------------------------------ */

const shared = {
  // Purple palette (same in both themes)
  primary: '#5B21B6',
  primaryDark: '#4C1D95',
  primaryLight: '#7C3AED',
  accent: '#6D28D9',

  // Gradients
  gradientStart: '#5B21B6',
  gradientEnd: '#7C3AED',

  // Header
  headerBg: '#5B21B6',
  headerText: '#FFFFFF',

  // Semantic
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',

  // Status
  online: '#10B981',
  offline: '#9CA3AF',

  // Others
  overlay: 'rgba(0, 0, 0, 0.5)',
  badge: '#EF4444',
  textInverse: '#FFFFFF',
};

export const LightColors = {
  ...shared,

  // Surfaces
  background: '#F8F7FC',
  chatBg: '#F3F0FF',
  surface: '#FFFFFF',
  surfaceVariant: '#F0EEFF',
  card: '#FFFFFF',

  // Text
  text: '#1A1A2E',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',

  // Chat bubbles
  bubbleSent: '#EDE9FE',
  bubbleSentText: '#1A1A2E',
  bubbleReceived: '#FFFFFF',
  bubbleReceivedText: '#1A1A2E',

  // Others
  border: '#E5E7EB',
  inputBg: '#F3F4F6',
  shadow: 'rgba(91, 33, 182, 0.08)',
  tabBarBg: '#FFFFFF',
  unread: '#5B21B6',
  checkBlue: '#6D28D9',

  // Extras
  fab: '#5B21B6',
  fabShadow: 'rgba(91, 33, 182, 0.35)',
  shimmer: '#E5E7EB',
  activeTab: '#5B21B6',
  inactiveTab: '#9CA3AF',
  divider: '#F3F4F6',
  searchBg: '#F3F4F6',
  highlight: '#EDE9FE',

  // Aliases
  teal: '#5B21B6',
  tealDark: '#4C1D95',
};

export const DarkColors = {
  ...shared,

  // Surfaces
  background: '#0F0D19',
  chatBg: '#161225',
  surface: '#1E1A2E',
  surfaceVariant: '#28223D',
  card: '#1E1A2E',

  // Text
  text: '#E8E6F0',
  textSecondary: '#A09BB5',
  textTertiary: '#706B85',

  // Chat bubbles
  bubbleSent: '#3B2D6B',
  bubbleSentText: '#E8E6F0',
  bubbleReceived: '#1E1A2E',
  bubbleReceivedText: '#E8E6F0',

  // Others
  border: '#2D2845',
  inputBg: '#1E1A2E',
  shadow: 'rgba(0, 0, 0, 0.3)',
  tabBarBg: '#13101F',
  unread: '#7C3AED',
  checkBlue: '#7C3AED',

  // Extras
  fab: '#6D28D9',
  fabShadow: 'rgba(109, 40, 217, 0.45)',
  shimmer: '#2D2845',
  activeTab: '#7C3AED',
  inactiveTab: '#706B85',
  divider: '#28223D',
  searchBg: '#1E1A2E',
  highlight: '#28223D',

  // Aliases
  teal: '#6D28D9',
  tealDark: '#5B21B6',
};

/** Type for theme colors object */
export type ThemeColors = typeof LightColors;

/** Default export kept for backward compat (light) */
export const Colors = LightColors;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const Radius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 28,
  full: 9999,
};

export const Font = {
  regular: { fontWeight: '400' as const },
  medium: { fontWeight: '500' as const },
  semiBold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    title: 30,
  },
};
