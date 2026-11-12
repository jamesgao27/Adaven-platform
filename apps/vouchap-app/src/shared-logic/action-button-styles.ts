/**
 * 底部栏 / 编辑栏按钮统一规范
 * 用于：详情页编辑（Cancel / Confirm）、列表页（Add / Merge & Clean）、Merge 页（Cancel / Quick Clean / Delete / Merge）
 * 同一组内通过底色/字色/边框区分；Cancel 全场景统一；尺寸、阴影、icon 统一。
 */
import { StyleSheet, Platform } from 'react-native';

const BAR_BTN_HEIGHT = 48;
const BAR_BTN_PADDING_V = 12;
const BAR_BTN_PADDING_H = 16;
const BAR_BORDER_RADIUS = 12;
const BAR_GAP = 12;
const BAR_ICON_GAP = 6;
const BAR_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 6,
  ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
};

export const actionButtonStyles = StyleSheet.create({
  // ---------- 底部栏容器 ----------
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    flexDirection: 'row',
    gap: BAR_GAP,
  },
  barMergeMode: {
    flexDirection: 'row',
    gap: BAR_GAP,
    alignItems: 'stretch',
  },
  barSlotLeft: { flex: 1, alignItems: 'flex-start' },
  barSlotCenter: { flex: 1, alignItems: 'center' },
  barSlotRight: { flex: 1, alignItems: 'flex-end' },

  // ---------- Cancel（全场景统一：灰边框+灰字） ----------
  barButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minWidth: 100,
    ...BAR_SHADOW,
  },
  barButtonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  /** Merge 未选时两键并排：Cancel，与 bar 等宽 */
  barButtonSecondaryFlex: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    ...BAR_SHADOW,
  },

  // ---------- Primary 主操作（Confirm / Merge：紫底白字） ----------
  barButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#6C5CE7',
    minWidth: 100,
    ...BAR_SHADOW,
  },
  barButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  /** Merge 选 2 项及以上时三键并排：Merge，与 bar 等宽 */
  barButtonPrimaryFlex: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#6C5CE7',
    ...BAR_SHADOW,
  },

  // ---------- Add（浅紫底紫字，与 Switch Space 一致） ----------
  barButtonPrimaryTint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#F0F4FF',
  },
  barButtonPrimaryTintText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
  },

  // ---------- Merge & Clean（浅红底红字，与 Sign Out 一致） ----------
  barButtonSecondaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#FFF5F5',
  },
  barButtonSecondaryActionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },

  // ---------- Warning（Quick Clean：白底橙边框+橙字） ----------
  barButtonWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: BAR_BTN_PADDING_H,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E67E22',
    minWidth: 120,
    ...BAR_SHADOW,
  },
  barButtonWarningText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E67E22',
  },
  /** Merge 未选时两键并排：Quick Clean，与 bar 等宽 */
  barButtonWarningFlex: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: BAR_BTN_PADDING_H,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E67E22',
    ...BAR_SHADOW,
  },

  // ---------- Danger（Delete：白底红边框+红字） ----------
  barButtonDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: BAR_BTN_PADDING_H,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E74C3C',
    minWidth: 100,
    ...BAR_SHADOW,
  },
  barButtonDangerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E74C3C',
  },
  /** Merge 选 1 项时两键并排：Delete，与 bar 等宽 */
  barButtonDangerFlex: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: BAR_ICON_GAP,
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: BAR_BTN_PADDING_H,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E74C3C',
    ...BAR_SHADOW,
  },

  barIconFix: { flexShrink: 0 },

  // ---------- 详情页 / 列表内联编辑（Cancel + Confirm，与 bar 按钮同规范） ----------
  editRowButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: BAR_GAP,
    alignItems: 'center',
  },
  editCancelButton: {
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    ...BAR_SHADOW,
  },
  editCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  editConfirmButton: {
    minHeight: BAR_BTN_HEIGHT,
    paddingVertical: BAR_BTN_PADDING_V,
    paddingHorizontal: 20,
    borderRadius: BAR_BORDER_RADIUS,
    backgroundColor: '#6C5CE7',
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    ...BAR_SHADOW,
  },
  editConfirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
