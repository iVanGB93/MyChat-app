/* ------------------------------------------------------------------ */
/*  Design tokens — Futuristic Neon / Cyberpunk palettes              */
/* ------------------------------------------------------------------ */

const shared = {
  // Neon cyan primary
  primary: '#00E5FF',
  primaryDark: '#00B2CC',
  primaryLight: '#66F0FF',
  accent: '#A855F7',           // electric violet

  // Gradients
  gradientStart: '#00E5FF',
  gradientEnd: '#A855F7',

  // Header
  headerBg: '#020D1F',
  headerText: '#00E5FF',

  // Semantic
  success: '#00FF9F',
  error: '#FF3B6B',
  warning: '#FFB800',
  info: '#00E5FF',

  // Status
  online: '#00FF9F',
  offline: '#3D5A6E',

  // Others
  overlay: 'rgba(0, 0, 0, 0.72)',
  badge: '#FF3B6B',
  textInverse: '#020D1F',
};

export const LightColors = {
  ...shared,

  // Surfaces
  background: '#EAF6FF',
  chatBg: '#DFF1FA',
  surface: '#FFFFFF',
  surfaceVariant: '#D6EEF9',
  card: '#FFFFFF',

  // Text
  text: '#02101E',
  textSecondary: '#2A5370',
  textTertiary: '#6B9AB8',

  // Chat bubbles
  bubbleSent: '#C8EEFF',
  bubbleSentText: '#02101E',
  bubbleReceived: '#FFFFFF',
  bubbleReceivedText: '#02101E',

  // Others
  border: 'rgba(0, 180, 220, 0.3)',
  inputBg: '#EAF6FF',
  shadow: 'rgba(0, 229, 255, 0.12)',
  tabBarBg: '#FFFFFF',
  unread: '#00B2CC',
  checkBlue: '#00B2CC',

  // Extras
  fab: '#00B2CC',
  fabShadow: 'rgba(0, 229, 255, 0.35)',
  shimmer: '#C8EEFF',
  activeTab: '#00B2CC',
  inactiveTab: '#6B9AB8',
  divider: 'rgba(0, 180, 220, 0.15)',
  searchBg: '#EAF6FF',
  highlight: '#C8EEFF',

  // Neon glow border (used for cards / inputs)
  neonBorder: 'rgba(0, 180, 220, 0.4)',
  neonGlow: 'rgba(0, 229, 255, 0.2)',

  // Aliases
  teal: '#00B2CC',
  tealDark: '#007A8C',
};

export const DarkColors = {
  ...shared,

  // Surfaces — deep space panels
  background: '#010812',
  chatBg: '#020D1F',
  surface: '#071428',
  surfaceVariant: '#0C1F3F',
  card: '#071428',

  // Text
  text: '#D9F0FA',
  textSecondary: '#7BAEC7',
  textTertiary: '#3D6A85',

  // Chat bubbles
  bubbleSent: '#0C2854',
  bubbleSentText: '#D9F0FA',
  bubbleReceived: '#071428',
  bubbleReceivedText: '#D9F0FA',

  // Others
  border: 'rgba(0, 229, 255, 0.15)',
  inputBg: '#020D1F',
  shadow: 'rgba(0, 229, 255, 0.08)',
  tabBarBg: '#010812',
  unread: '#00E5FF',
  checkBlue: '#00E5FF',

  // Extras
  fab: '#00E5FF',
  fabShadow: 'rgba(0, 229, 255, 0.4)',
  shimmer: '#0C1F3F',
  activeTab: '#00E5FF',
  inactiveTab: '#3D6A85',
  divider: 'rgba(0, 229, 255, 0.1)',
  searchBg: '#020D1F',
  highlight: '#0C2854',

  // Neon glow borders
  neonBorder: 'rgba(0, 229, 255, 0.25)',
  neonGlow: 'rgba(0, 229, 255, 0.12)',

  // Aliases
  teal: '#00E5FF',
  tealDark: '#00B2CC',
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
  xxxl: 48,
};

export const Radius = {
  xs: 4,
  sm: 6,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 28,
  full: 9999,
};

export const Font = {
  regular: { fontWeight: '400' as const, letterSpacing: 0.2 },
  medium: { fontWeight: '500' as const, letterSpacing: 0.3 },
  semiBold: { fontWeight: '600' as const, letterSpacing: 0.4 },
  bold: { fontWeight: '700' as const, letterSpacing: 0.5 },
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
