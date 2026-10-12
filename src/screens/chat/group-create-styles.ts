import {StyleSheet} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const groupCreateStyles = StyleSheet.create({
  container: { flex: 1 },
  form: { flexShrink: 0, paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  helper: { fontSize: Font.size.sm, marginBottom: Spacing.sm },
  identityRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm, paddingBottom: Spacing.md },
  identityInput: { marginBottom: 0 },
  addIdentity: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  listViewport: { flex: 1, minHeight: 0 },
  list: { paddingBottom: Spacing.md },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: Font.size.md, textAlign: 'center' },
  contact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  contactInfo: { flex: 1, marginLeft: Spacing.md },
  contactName: { fontSize: Font.size.md, ...Font.semiBold },
  contactSub: { fontSize: Font.size.sm, marginTop: 2 },
  footer: { flexShrink: 0, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  createButton: { minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm },
  createText: { color: '#fff', fontSize: Font.size.md, ...Font.semiBold },
});
