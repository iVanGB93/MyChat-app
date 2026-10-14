import { StyleSheet } from 'react-native';
import { Font, Radius, Spacing } from '../../theme';

export const userInfoStyles = StyleSheet.create({
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm },
  identityHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, width: '100%' },
  identityHeadingText: { flex: 1 },
  qrBox: { padding: 10, backgroundColor: '#fff', borderRadius: 12, alignSelf: 'center' },
  qrScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: 16 },
  hero: { alignItems: 'center', borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md },
  name: { fontSize: Font.size.lg, ...Font.semiBold },
  username: { marginTop: 3, fontSize: Font.size.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: Font.size.sm, ...Font.medium },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, marginVertical: Spacing.sm },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'space-evenly', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  actionIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Font.size.sm, ...Font.medium },
  section: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  sectionLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
  detailText: { flex: 1 },
  detailLabel: { fontSize: Font.size.xs },
  detailValue: { fontSize: Font.size.md, marginTop: 2, ...Font.medium },
  setting: { minHeight: 58, borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  settingText: { flex: 1, fontSize: Font.size.md, ...Font.medium },
});
