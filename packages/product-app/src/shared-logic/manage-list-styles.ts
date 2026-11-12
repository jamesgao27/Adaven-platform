/**
 * 管理列表（账户 / 客户 / 供应商）统一规范样式常量
 * 表行行高、卡片间距、滚动区 padding 等与 accounts-manage 保持一致
 */
export const MANAGE_LIST_SPEC = {
  /** 列表项之间的垂直间距 */
  listGap: 6,
  /** 卡片内边距 */
  cardPadding: 10,
  /** 卡片最小高度 */
  cardMinHeight: 40,
  /** 表行最小高度（主行、merge 根行） */
  rowMinHeight: 40,
  /** 表行内元素水平间距 */
  rowGap: 10,
  /** 子行（merge 子项）左缩进 */
  childRowPaddingLeft: 8,
  /** 子行上下内边距 */
  childRowPaddingVertical: 6,
  /** 滚动内容区左右内边距 */
  scrollContentPadding: 16,
  /** 滚动内容区顶部内边距 */
  scrollContentTopPadding: 6,
  /** 有底部栏时的滚动区底内边距 */
  scrollContentWithBottomBarPaddingBottom: 88,
  /** 表单卡片下边距 */
  formCardMarginBottom: 12,
  /** 数字列最小宽度（Records） */
  countsCellMinWidth: 64,
  /** 展开占位宽度 */
  expandPlaceholderWidth: 18,
  /** 勾选区域宽度 */
  checkboxSize: 32,
  /** 行选中态内边距 */
  rowSelectedPadding: 4,
} as const;
