import {StyleSheet,Platform} from 'react-native';
import {Font,Spacing,Radius} from '../../theme';
export const chatRoomStyles = StyleSheet.create({
  container: { flex: 1 },

  headerNavigation: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  headerBack: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 172, flexShrink: 1 },
  syncHeaderTitle: { flexDirection: 'row', alignItems: 'center', maxWidth: 130, flexShrink: 1 },
  syncLetters: { flexDirection: 'row', flexShrink: 1 },
  syncHeaderLetter: { fontSize: Font.size.md, fontWeight: '800', letterSpacing: 0.7 },

  /* ---- Contact / message-request banner ---- */
  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },

  messageList: { flex: 1 },
  messagesList: { paddingHorizontal: 10, paddingVertical: 4, flexGrow: 1 },

  inputBar: {
    flexShrink: 0,
    flexDirection: 'column',
    paddingHorizontal: Spacing.sm,
    paddingTop: 4,
    // paddingBottom is set dynamically via insets.bottom
    borderTopWidth: 1,
  },
  inputRowWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputRow: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingLeft: 0,
    paddingRight: Spacing.sm,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  stickerBtn: { padding: 4 },
  composerShell: { marginTop: -42, paddingTop: 42, zIndex: 2 },
  stickerToolbar: { position: 'absolute', top: 0, left: 44 + Spacing.sm * 2, zIndex: 2 },
  stickerToolbarButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  textInput: {
    flex: 1,
    fontSize: Font.size.md,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
    letterSpacing: 0.2,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  attachSheet: {
    marginTop: 'auto',
    marginBottom: Spacing.xl,
    marginHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.sm,
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  attachLabel: {
    fontSize: Font.size.md,
    letterSpacing: 0.3,
  },
  attachDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  sendIcon: { fontSize: 16, fontWeight: '700' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  contextPanel: {
    position: 'absolute',
    left: '4%',
    width: '92%',
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    elevation: 24,
    shadowColor: '#00E5FF',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
  },
  reactionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  reactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 26 },
  contextDivider: { height: 1, marginVertical: Spacing.sm },
  contextOption: { paddingVertical: Spacing.sm, alignItems: 'center' },
  contextOptionText: { fontSize: Font.size.md, fontWeight: '600', letterSpacing: 0.5 },

  forwardPanel: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    top: '20%',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  forwardTitle: {
    fontSize: Font.size.md,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  forwardRow: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  forwardRowText: {
    fontSize: Font.size.md,
    fontWeight: '500',
  },

  /* ---- Reply composer preview ---- */
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  replyPreviewName: {
    fontSize: Font.size.xs,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  replyPreviewText: {
    fontSize: Font.size.xs,
    marginTop: 1,
  },
  replyPreviewClose: {
    paddingLeft: Spacing.sm,
  },

  /* ---- Voice recording overlay (replaces inputRow while recording) ---- */
  recordingTray: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    borderWidth: 1,
  },
});
