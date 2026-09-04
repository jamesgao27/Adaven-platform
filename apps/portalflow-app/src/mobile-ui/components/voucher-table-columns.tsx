/**
 * 四张主表（Expenses/Incomes/Inbound/Outbound）的表格列配置。
 * 表头文案：支出 Payee / 收入 Payer / 入库 Sender / 出库 Receiver。
 */
import React, { createElement, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Text, View, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DataTableColumn } from './DataTable';
import type { Receipt, Invoice, Inbound, Outbound, ReceiptLineItemListRow, Category, Attribution } from '@/types';
import type { ReceiptStatus } from '@/types';
import type { VoucherStatus } from '@/types';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';
import { inputTypeMethodIonicon, normalizeInputTypeForUi } from '@/lib/input-type-ionicon';

const getCurrencySymbol = (currency?: string): string => {
  const symbols: Record<string, string> = {
    USD: '$', CAD: 'C$', CNY: '¥', RMB: '¥', JPY: 'J¥', EUR: '€', GBP: '£', AUD: 'A$',
    HKD: 'HK$', TWD: 'NT$', KRW: '₩', SGD: 'S$', MXN: 'MX$', INR: '₹',
    THB: '฿', VND: '₫', PHP: '₱', MYR: 'RM', IDR: 'Rp',
  };
  return symbols[currency || 'USD'] || (currency ? `${currency} ` : '$');
};

/** 支出金额色（紫）、收入金额色（橙红），与移动端列表一致 */
export const AMOUNT_COLOR_EXPENSE = '#6C5CE7';
export const AMOUNT_COLOR_INCOME = '#D35400';

/** 金额：币种符号弱化、数字突出；amountColor 与移动端一致：支出紫、收入橙红 */
function AmountCell({ amount, currency, amountColor = AMOUNT_COLOR_EXPENSE }: { amount?: number | string | null; currency?: string; amountColor?: string }) {
  const symbol = getCurrencySymbol(currency);
  const n = typeof amount === 'number' ? amount : Number(amount);
  const safeAmount = Number.isFinite(n) ? n : 0;
  return (
    <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">
      <Text style={{ color: '#A0A0A0', fontSize: 12 }}>{symbol}</Text>
      <Text style={{ fontWeight: '600', color: amountColor }}>{safeAmount.toFixed(2)}</Text>
    </Text>
  );
}

/** 状态：底色标签样式，宽度随文字自适应（不占满单元格） */
function StatusBadge({ label, color }: { label?: string | null; color?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: color || '#95A5A6' }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }} numberOfLines={1}>{label || '—'}</Text>
      </View>
    </View>
  );
}

export type LineItemSelectOption = { value: string; label: string; color?: string };

/** Line item pickers：与表内/详情页共用选项列表 */
export function buildLineItemCategoryOptions(
  r: { categoryId: string; category?: Category },
  categories: Category[]
): LineItemSelectOption[] {
  const sorted = sortScopeTagsForDisplay(categories);
  const catIds = new Set(sorted.map(c => c.id));
  const opts: LineItemSelectOption[] = sorted.map(c => ({
    value: c.id,
    label: c.name,
    color: c.color || '#BDC3C7',
  }));
  if (r.categoryId && !catIds.has(r.categoryId)) {
    opts.unshift({
      value: r.categoryId,
      label: r.category?.name ?? 'Unknown',
      color: '#95A5A6',
    });
  }
  return opts;
}

export function lineItemCategorySelectValue(categoryId: string, opts: LineItemSelectOption[]): string {
  return categoryId && opts.some(o => o.value === categoryId) ? categoryId : opts[0]?.value ?? '';
}

export function buildLineItemAttributionOptions(
  r: { attributionId: string | null; attribution?: Attribution | null },
  attributions: Attribution[]
): LineItemSelectOption[] {
  const sorted = sortScopeTagsForDisplay(attributions);
  const opts: LineItemSelectOption[] = sorted.map(a => ({
    value: a.id,
    label: a.name,
    color: a.color || '#BDC3C7',
  }));
  const attIds = new Set(sorted.map(a => a.id));
  if (r.attributionId && !attIds.has(r.attributionId)) {
    opts.unshift({
      value: r.attributionId,
      label: r.attribution?.name ?? 'Unknown',
      color: '#95A5A6',
    });
  }
  return opts;
}

const PILL_SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";

/** Web：表内原生下拉；`appearance: 'pill'` 时闭合一律为彩色标签样式；非 Web 回退为纯文本 */
export function LineItemNativeSelect({
  ariaLabel,
  value,
  options,
  onValueChange,
  appearance = 'field',
}: {
  ariaLabel: string;
  value: string;
  options: LineItemSelectOption[];
  onValueChange: (v: string) => void;
  appearance?: 'field' | 'pill';
}) {
  if (Platform.OS !== 'web') {
    const label = options.find(o => o.value === value)?.label ?? '—';
    return (
      <Text style={{ fontSize: 13, color: '#2D3436' }} numberOfLines={1}>
        {label}
      </Text>
    );
  }
  const selected = options.find(o => o.value === value);
  const pillBg = selected?.color || '#BDC3C7';
  const isPill = appearance === 'pill';
  return createElement(
    'select',
    {
      'aria-label': ariaLabel,
      value,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value),
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      style: {
        ...(isPill
          ? {
              width: 'max-content',
              maxWidth: 200,
              minWidth: 0,
              fieldSizing: 'content',
              fontSize: 11,
              fontWeight: 600,
              lineHeight: '13px',
              padding: '3px 22px 3px 8px',
              borderRadius: 10,
              border: 'none',
              minHeight: 0,
              height: 'auto',
            }
          : {
              width: '100%',
              maxWidth: 220,
              fontSize: 13,
              fontWeight: 400,
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid #DEE2E6',
              minHeight: 32,
            }),
        backgroundColor: isPill ? pillBg : '#fff',
        color: isPill ? '#fff' : '#2D3436',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        cursor: 'pointer',
        boxSizing: 'border-box',
        outline: 'none',
        outlineWidth: 0,
        ...(isPill
          ? {
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              backgroundImage: `${PILL_SELECT_CHEVRON}`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center',
              backgroundSize: 12,
            }
          : {}),
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      } as React.CSSProperties,
    },
    options.map(o =>
      createElement('option', { key: o.value === '' ? '__empty__' : o.value, value: o.value }, o.label)
    )
  );
}

const LINE_ITEM_MENU_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export type LineItemPillDropdownKind = 'category' | 'attribution';

function lineItemPillDomIds(kind: LineItemPillDropdownKind, rowId: string) {
  const safe = String(rowId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    anchorId: `line-item-${kind}-anchor-${safe}`,
    menuDomId: `line-item-${kind}-menu-${safe}`,
  };
}

/**
 * Web：Category / Attribution 统一药丸触发 + 始终在锚点**下方**展开的列表（非原生 select 上下翻转）。
 * 菜单：半透明毛玻璃；选项悬停为**亮紫蓝**（#6C5CE7）浅色高光；选中行略深一档同色系。
 */
export function LineItemPillAnchorDropdownWeb({
  kind,
  rowId,
  ariaLabel,
  value,
  options,
  onValueChange,
}: {
  kind: LineItemPillDropdownKind;
  rowId: string;
  ariaLabel: string;
  value: string;
  options: LineItemSelectOption[];
  onValueChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const anchorRef = useRef<View | null>(null);
  const { anchorId, menuDomId } = lineItemPillDomIds(kind, rowId);

  const applyRect = useCallback((left: number, top: number, width: number, height: number) => {
    setMenuPos({
      top: top + height + 4,
      left,
      width: Math.max(width, 200),
    });
  }, []);

  const measure = useCallback(() => {
    const node = anchorRef.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void; getBoundingClientRect?: () => DOMRect } | null;

    const fromDomEl = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0) return false;
      applyRect(r.left, r.top, r.width, r.height);
      return true;
    };

    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (w > 0 || h > 0) {
          applyRect(x, y, w, h);
        } else if (typeof document !== 'undefined') {
          const refEl = anchorRef.current as unknown as HTMLElement | null;
          if (refEl?.getBoundingClientRect && fromDomEl(refEl)) return;
          const byId = document.getElementById(anchorId);
          if (byId) fromDomEl(byId);
        }
      });
      return;
    }

    if (typeof document !== 'undefined') {
      const refEl = anchorRef.current as unknown as HTMLElement | null;
      if (refEl?.getBoundingClientRect && fromDomEl(refEl)) return;
      const byId = document.getElementById(anchorId);
      if (byId) fromDomEl(byId);
    }
  }, [anchorId, applyRect]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    measure();
    let rafOuter = 0;
    let rafInner = 0;
    rafOuter = requestAnimationFrame(() => {
      measure();
      rafInner = requestAnimationFrame(measure);
    });
    const t2 = typeof window !== 'undefined' ? window.setTimeout(measure, 50) : 0;
    /** 捕获阶段会收到选单自身 overflow 滚动，需忽略，否则一滚列表就选单消失 */
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node) {
        const menu = document.getElementById(menuDomId);
        if (menu?.contains(t)) return;
      }
      setOpen(false);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', measure);
    }
    return () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
      if (t2) window.clearTimeout(t2);
      if (typeof window !== 'undefined') {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', measure);
      }
    };
  }, [open, measure, menuDomId]);

  useEffect(() => {
    if (!open) setHoveredValue(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const menu = document.getElementById(menuDomId);
      const anchor = document.getElementById(anchorId);
      if (menu?.contains(target) || anchor?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, anchorId, menuDomId]);

  const selected = options.find(o => o.value === value);
  const pillLabel = selected?.label ?? '—';
  const pillColor = selected?.color ?? '#95A5A6';

  const menu =
    open && menuPos && typeof document !== 'undefined' && document.body
      ? createPortal(
          <div
            id={menuDomId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.width,
              maxHeight: 320,
              overflowY: 'auto',
              backgroundColor: 'rgba(255, 255, 255, 0.76)',
              backdropFilter: 'blur(18px) saturate(1.15)',
              WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
              borderRadius: 8,
              boxShadow: '0 10px 36px rgba(0,0,0,0.14)',
              border: '1px solid rgba(222, 226, 230, 0.72)',
              zIndex: 100050,
              padding: 4,
            }}
            onMouseDown={e => e.preventDefault()}
            onMouseLeave={() => setHoveredValue(null)}
          >
            {options.map(opt => {
              const isSel = value === opt.value;
              const isHovered = hoveredValue === opt.value;
              const dot = opt.color || '#BDC3C7';
              const bg = isHovered
                ? 'rgba(108, 92, 231, 0.28)'
                : isSel
                  ? 'rgba(108, 92, 231, 0.16)'
                  : 'transparent';
              const fg = '#2D3436';
              const checkColor = '#6C5CE7';
              return (
                <div
                  key={opt.value === '' ? '__empty__' : opt.value}
                  role="option"
                  aria-selected={isSel}
                  onClick={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setHoveredValue(opt.value)}
                  onMouseLeave={() => setHoveredValue(h => (h === opt.value ? null : h))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: LINE_ITEM_MENU_FONT,
                    color: fg,
                    backgroundColor: bg,
                    transition: 'background-color 0.12s ease, color 0.12s ease',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: dot,
                      flexShrink: 0,
                      boxShadow: isHovered ? '0 0 0 1px rgba(108, 92, 231, 0.45)' : undefined,
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {isSel ? (
                    <span style={{ color: checkColor, fontWeight: 600 }}>✓</span>
                  ) : null}
                </div>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <View
        ref={anchorRef}
        nativeID={anchorId}
        collapsable={false}
        {...(Platform.OS === 'web' ? ({ id: anchorId } as Record<string, string>) : {})}
        style={{ alignSelf: 'flex-start', maxWidth: 220 }}
      >
        <TouchableOpacity
          onPress={() => setOpen(o => !o)}
          activeOpacity={0.75}
          style={{ flexDirection: 'row', alignItems: 'center' }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={ariaLabel}
        >
          <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 10,
                backgroundColor: pillColor,
                gap: 2,
                maxWidth: 200,
              }}
            >
              <Text style={{ fontSize: 11, lineHeight: 13, fontWeight: '600', color: '#fff' }} numberOfLines={1}>
                {pillLabel}
              </Text>
              <Ionicons name="chevron-down" size={10} color="#fff" />
            </View>
          </View>
        </TouchableOpacity>
      </View>
      {menu}
    </>
  );
}

/** Web：Attribution 行内选单（与 Category 共用 {@link LineItemPillAnchorDropdownWeb}） */
export function LineItemAttributionAnchorDropdownWeb({
  rowId,
  value,
  options,
  onValueChange,
}: {
  rowId: string;
  value: string | null;
  options: LineItemSelectOption[];
  onValueChange: (v: string) => void;
}) {
  return (
    <LineItemPillAnchorDropdownWeb
      kind="attribution"
      rowId={rowId}
      ariaLabel="Attribution"
      value={value ?? ''}
      options={options}
      onValueChange={onValueChange}
    />
  );
}

/** 明细行 Category / Attribution 标签 */
function LineTagPill({ label, color }: { label: string; color?: string }) {
  const bg = color || '#BDC3C7';
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: bg }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** 提交方式：Web Method 列（与 App confirmed 角标共用 inputTypeMethodIonicon） */
function InputTypeCell({ type }: { type?: import('@/types').InputType }) {
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    flexWrap: 'nowrap' as const,
    maxHeight: 40,
    overflow: 'hidden' as const,
  };
  const textStyle = { fontSize: 13, color: '#636E72' };
  const t = normalizeInputTypeForUi(type);
  const icon = inputTypeMethodIonicon(type);
  if (t === 'audio') return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Voice</Text></View>;
  if (t === 'text') return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Text</Text></View>;
  if (t === 'camera') return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Camera</Text></View>;
  if (t === 'image') return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Image</Text></View>;
  if (t === 'document') return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Doc</Text></View>;
  return <View style={row}><Ionicons name={icon} size={16} color="#636E72" /><Text style={textStyle}>Camera</Text></View>;
}

export interface ReceiptColumnOptions {
  formatDate: (dateString: string) => string;
  formatTimeAgo: (dateString: string) => string;
  statusLabels: Record<ReceiptStatus, string>;
  statusColors: Record<ReceiptStatus, string>;
}

/** 不定长商户/客户列最小宽（字符） */
const MERCHANT_MIN_CHARS = 30;
/** 账户列最小宽（字符） */
const ACCOUNT_MIN_CHARS = 20;
/** 金额列内容样例（含较长币种符号） */
const AMOUNT_CONTENT_SAMPLES = ['C$99,999.99', 'HK$99,999.99'];
/** 日期列内容样例（与 formatDate MMM dd, yyyy 对齐） */
const DATE_CONTENT_SAMPLES = ['Sep 30, 2026'];
/** 状态标签内容样例（取较长英文标签） */
const STATUS_CONTENT_SAMPLES = ['Needs Retake', 'Processing', 'Confirmed'];
/** 记录时间列内容样例 */
const RECORD_DATE_CONTENT_SAMPLES = ['99 hours ago', 'Sep 30, 2026'];
/** Method 列（图标） */
const METHOD_CONTENT_SAMPLES = ['Method'];
/** Recorder 较短名 */
const RECORDER_CONTENT_SAMPLES = ['RecorderName'];

/** 支出单：关联方列表头为 Payee */
export function getReceiptColumns(opts: ReceiptColumnOptions): DataTableColumn<Receipt>[] {
  const { formatDate, formatTimeAgo, statusLabels, statusColors } = opts;
  return [
    { id: 'supplier', label: 'Payee', minChars: MERCHANT_MIN_CHARS, minWidth: 140, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.entity?.name || r.supplierName || '—'}</Text>, getSortValue: r => (r.entity?.name || r.supplierName || '').toLowerCase() },
    { id: 'amount', label: 'Amount', contentMinSamples: AMOUNT_CONTENT_SAMPLES, minWidth: 100, getValue: r => <AmountCell amount={r.totalAmount} currency={r.currency} amountColor={AMOUNT_COLOR_EXPENSE} />, getSortValue: r => r.totalAmount ?? -Infinity },
    { id: 'account', label: 'Account', minChars: ACCOUNT_MIN_CHARS, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.account?.name || '—'}</Text>, getSortValue: r => (r.account?.name || '').toLowerCase() },
    { id: 'date', label: 'Date', contentMinSamples: DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{formatDate(r.date)}</Text>, getSortValue: r => r.date || '' },
    { id: 'status', label: 'Status', contentMinSamples: STATUS_CONTENT_SAMPLES, minWidth: 100, getValue: r => <StatusBadge label={statusLabels[r.status]} color={statusColors[r.status]} />, getSortValue: r => statusLabels[r.status] || '' },
    { id: 'createdBy', label: 'Recorder', contentMinSamples: RECORDER_CONTENT_SAMPLES, minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.createdByUser?.name || r.createdByUser?.email?.split('@')[0] || '—'}</Text>, getSortValue: r => (r.createdByUser?.name || r.createdByUser?.email?.split('@')[0] || '').toLowerCase() },
    { id: 'inputType', label: 'Method', contentMinSamples: METHOD_CONTENT_SAMPLES, minWidth: 72, getValue: r => <InputTypeCell type={r.inputType} />, getSortValue: r => r.inputType || '' },
    { id: 'createdAt', label: 'Record date', contentMinSamples: RECORD_DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14, color: '#636E72' }} numberOfLines={1} ellipsizeMode="tail">{r.createdAt ? formatTimeAgo(r.createdAt) : formatDate(r.date)}</Text>, getSortValue: r => r.createdAt || r.date || '' },
  ];
}

export interface ReceiptLineItemColumnOptions {
  formatDate: (dateString: string) => string;
  /** Web 行内下拉：与 onCategoryChange / onAttributionChange 一起传入 */
  categories?: Category[];
  attributions?: Attribution[];
  onCategoryChange?: (row: ReceiptLineItemListRow, categoryId: string) => void;
  onAttributionChange?: (row: ReceiptLineItemListRow, attributionId: string | null) => void;
  onIsAssetCellPress?: (row: ReceiptLineItemListRow) => void;
}

/** 支出按行：receipt_items + 小票 Payee / 交易时间 */
export function getReceiptLineItemColumns(opts: ReceiptLineItemColumnOptions): DataTableColumn<ReceiptLineItemListRow>[] {
  const {
    formatDate,
    categories = [],
    attributions = [],
    onCategoryChange,
    onAttributionChange,
    onIsAssetCellPress,
  } = opts;
  return [
    {
      id: 'name',
      label: 'Item',
      minWidth: 120,
      maxWidth: '40ch',
      getValue: r => {
        const label = r.name || '—';
        const full = r.name || '';
        return (
          <View
            style={{ maxWidth: '100%', overflow: 'hidden' }}
            {...(Platform.OS === 'web' && full
              ? ({ title: full } as Record<string, string>)
              : {})}
          >
            <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">
              {label}
            </Text>
          </View>
        );
      },
      getSortValue: r => (r.name || '').toLowerCase(),
    },
    {
      id: 'amount',
      label: 'Amount',
      contentMinSamples: AMOUNT_CONTENT_SAMPLES,
      minWidth: 100,
      getValue: r => <AmountCell amount={r.price} currency={r.currency} amountColor={AMOUNT_COLOR_EXPENSE} />,
      getSortValue: r => r.price ?? -Infinity,
    },
    {
      id: 'category',
      label: 'Category',
      minWidth: onCategoryChange && categories.length > 0 ? 140 : 110,
      stopRowPress: !!(onCategoryChange && categories.length > 0 && Platform.OS === 'web'),
      getValue: r => {
        if (!onCategoryChange || categories.length === 0) {
          return r.category?.name ? (
            <LineTagPill label={r.category.name} color={r.category.color} />
          ) : (
            <Text style={{ fontSize: 13, color: '#95A5A6' }} numberOfLines={1}>—</Text>
          );
        }
        const opts = buildLineItemCategoryOptions(r, categories);
        const selectValue = lineItemCategorySelectValue(r.categoryId, opts);
        return (
          <View style={{ alignSelf: 'flex-start', maxWidth: 200 }}>
            <LineItemPillAnchorDropdownWeb
              kind="category"
              rowId={r.id}
              ariaLabel="Category"
              value={selectValue}
              options={opts}
              onValueChange={v => onCategoryChange(r, v)}
            />
          </View>
        );
      },
      getSortValue: r => (r.category?.name || '').toLowerCase(),
    },
    {
      id: 'attribution',
      label: 'Attribution',
      minWidth: onAttributionChange && Platform.OS === 'web' ? 140 : 110,
      stopRowPress: !!onAttributionChange && Platform.OS === 'web',
      getValue: r => {
        if (!onAttributionChange || Platform.OS !== 'web') {
          return r.attribution?.name ? (
            <LineTagPill label={r.attribution.name} color={r.attribution.color} />
          ) : (
            <Text style={{ fontSize: 13, color: '#95A5A6' }} numberOfLines={1}>—</Text>
          );
        }
        const opts = buildLineItemAttributionOptions(r, attributions);
        return (
          <View style={{ minWidth: 120, maxWidth: 220, justifyContent: 'center' }}>
            <LineItemAttributionAnchorDropdownWeb
              rowId={r.id}
              value={r.attributionId}
              options={opts}
              onValueChange={v => onAttributionChange(r, v)}
            />
          </View>
        );
      },
      getSortValue: r => (r.attribution?.name || '').toLowerCase(),
    },
    {
      id: 'isAsset',
      label: 'Is asset',
      minWidth: 72,
      stopRowPress: !!onIsAssetCellPress,
      getValue: r =>
        onIsAssetCellPress ? (
          <TouchableOpacity
            onPress={() => onIsAssetCellPress(r)}
            style={{ alignItems: 'center', justifyContent: 'center', minHeight: 28 }}
            activeOpacity={0.65}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: r.isAsset }}
          >
            {r.isAsset ? (
              <Ionicons name="checkbox" size={22} color="#6C5CE7" />
            ) : (
              <Ionicons name="square-outline" size={22} color="#CED4DA" />
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 28 }}>
            {r.isAsset ? (
              <Ionicons name="checkbox" size={22} color="#6C5CE7" />
            ) : (
              <Ionicons name="square-outline" size={22} color="#CED4DA" />
            )}
          </View>
        ),
      getSortValue: r => (r.isAsset ? 1 : 0),
    },
    {
      id: 'payee',
      label: 'Payee',
      minChars: MERCHANT_MIN_CHARS,
      minWidth: 130,
      getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.payeeName || '—'}</Text>,
      getSortValue: r => (r.payeeName || '').toLowerCase(),
    },
    {
      id: 'receiptDate',
      label: 'Transaction date',
      contentMinSamples: DATE_CONTENT_SAMPLES,
      minWidth: 120,
      getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{formatDate(r.receiptDate)}</Text>,
      getSortValue: r => r.receiptDate || '',
    },
  ];
}

export interface InvoiceColumnOptions {
  formatDate: (dateString: string) => string;
  formatTimeAgo: (dateString: string) => string;
  statusLabels: Record<VoucherStatus, string>;
  statusColors: Record<VoucherStatus, string>;
}

/** 收入单：关联方列表头为 Payer */
export function getInvoiceColumns(opts: InvoiceColumnOptions): DataTableColumn<Invoice>[] {
  const { formatDate, formatTimeAgo, statusLabels, statusColors } = opts;
  return [
    { id: 'customer', label: 'Payer', minChars: MERCHANT_MIN_CHARS, minWidth: 140, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.entity?.name || r.customerName || '—'}</Text>, getSortValue: r => (r.entity?.name || r.customerName || '').toLowerCase() },
    { id: 'amount', label: 'Amount', contentMinSamples: AMOUNT_CONTENT_SAMPLES, minWidth: 100, getValue: r => <AmountCell amount={r.totalAmount} currency={r.currency} amountColor={AMOUNT_COLOR_INCOME} />, getSortValue: r => r.totalAmount ?? -Infinity },
    { id: 'account', label: 'Account', minChars: ACCOUNT_MIN_CHARS, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.account?.name || '—'}</Text>, getSortValue: r => (r.account?.name || '').toLowerCase() },
    { id: 'date', label: 'Date', contentMinSamples: DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{formatDate(r.date)}</Text>, getSortValue: r => r.date || '' },
    { id: 'status', label: 'Status', contentMinSamples: STATUS_CONTENT_SAMPLES, minWidth: 100, getValue: r => <StatusBadge label={statusLabels[r.status]} color={statusColors[r.status]} />, getSortValue: r => statusLabels[r.status] || '' },
    { id: 'createdBy', label: 'Recorder', contentMinSamples: RECORDER_CONTENT_SAMPLES, minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.createdByUser?.name || r.createdByUser?.email?.split('@')[0] || '—'}</Text>, getSortValue: r => (r.createdByUser?.name || r.createdByUser?.email?.split('@')[0] || '').toLowerCase() },
    { id: 'inputType', label: 'Method', contentMinSamples: METHOD_CONTENT_SAMPLES, minWidth: 72, getValue: r => <InputTypeCell type={r.inputType} />, getSortValue: r => r.inputType || '' },
    { id: 'createdAt', label: 'Record date', contentMinSamples: RECORD_DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14, color: '#636E72' }} numberOfLines={1} ellipsizeMode="tail">{r.createdAt ? formatTimeAgo(r.createdAt) : formatDate(r.date)}</Text>, getSortValue: r => r.createdAt || r.date || '' },
  ];
}

export interface InboundColumnOptions {
  formatDate: (dateString: string) => string;
  formatTimeAgo: (dateString: string) => string;
  statusLabels: Record<VoucherStatus, string>;
  statusColors: Record<VoucherStatus, string>;
}

/** 入库单：关联方列表头为 Sender */
export function getInboundColumns(opts: InboundColumnOptions): DataTableColumn<Inbound>[] {
  const { formatDate, formatTimeAgo, statusLabels, statusColors } = opts;
  return [
    { id: 'supplier', label: 'Sender', minChars: MERCHANT_MIN_CHARS, minWidth: 120, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.entity?.name || r.supplierName || '—'}</Text>, getSortValue: r => (r.entity?.name || r.supplierName || '').toLowerCase() },
    { id: 'amount', label: 'Amount', contentMinSamples: AMOUNT_CONTENT_SAMPLES, minWidth: 100, getValue: r => (
      r.totalAmount != null
        ? <AmountCell amount={Number(r.totalAmount)} currency={r.currency} />
        : <Text style={{ fontSize: 14, color: '#95A5A6' }} numberOfLines={1}>—</Text>
    ), getSortValue: r => r.totalAmount != null ? Number(r.totalAmount) : -Infinity },
    { id: 'date', label: 'Date', contentMinSamples: DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{formatDate(r.date)}</Text>, getSortValue: r => r.date || '' },
    { id: 'status', label: 'Status', contentMinSamples: STATUS_CONTENT_SAMPLES, minWidth: 100, getValue: r => <StatusBadge label={statusLabels[r.status]} color={statusColors[r.status]} />, getSortValue: r => statusLabels[r.status] || '' },
    { id: 'createdBy', label: 'Recorder', contentMinSamples: RECORDER_CONTENT_SAMPLES, minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{(r as any).createdByUser?.name ?? (r as any).createdByUser?.email?.split('@')[0] ?? (r.createdBy ? '…' : '—')}</Text>, getSortValue: r => ((r as any).createdByUser?.name ?? (r as any).createdByUser?.email?.split('@')[0] ?? '').toLowerCase() },
    { id: 'createdAt', label: 'Record date', contentMinSamples: RECORD_DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14, color: '#636E72' }} numberOfLines={1} ellipsizeMode="tail">{r.createdAt ? formatTimeAgo(r.createdAt) : formatDate(r.date)}</Text>, getSortValue: r => r.createdAt || r.date || '' },
    { id: 'documentNo', label: 'Doc No', contentMinSamples: ['DOC-12345'], minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.documentNo || '—'}</Text>, getSortValue: r => (r.documentNo || '').toLowerCase() },
    { id: 'handler', label: 'Handler', contentMinSamples: ['Handler'], minWidth: 80, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.handlerName || '—'}</Text>, getSortValue: r => (r.handlerName || '').toLowerCase() },
    { id: 'warehouseKeeper', label: 'Keeper', contentMinSamples: ['Keeper'], minWidth: 80, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.warehouseKeeperName || '—'}</Text>, getSortValue: r => (r.warehouseKeeperName || '').toLowerCase() },
  ];
}

export interface OutboundColumnOptions {
  formatDate: (dateString: string) => string;
  formatTimeAgo: (dateString: string) => string;
  statusLabels: Record<VoucherStatus, string>;
  statusColors: Record<VoucherStatus, string>;
}

/** 出库单：关联方列表头为 Receiver */
export function getOutboundColumns(opts: OutboundColumnOptions): DataTableColumn<Outbound>[] {
  const { formatDate, formatTimeAgo, statusLabels, statusColors } = opts;
  return [
    { id: 'customer', label: 'Receiver', minChars: MERCHANT_MIN_CHARS, minWidth: 120, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.entity?.name || r.customerName || '—'}</Text>, getSortValue: r => (r.entity?.name || r.customerName || '').toLowerCase() },
    { id: 'amount', label: 'Amount', contentMinSamples: AMOUNT_CONTENT_SAMPLES, minWidth: 100, getValue: r => (
      r.totalAmount != null
        ? <AmountCell amount={Number(r.totalAmount)} currency={r.currency} amountColor={AMOUNT_COLOR_INCOME} />
        : <Text style={{ fontSize: 14, color: '#95A5A6' }} numberOfLines={1}>—</Text>
    ), getSortValue: r => r.totalAmount != null ? Number(r.totalAmount) : -Infinity },
    { id: 'date', label: 'Date', contentMinSamples: DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{formatDate(r.date)}</Text>, getSortValue: r => r.date || '' },
    { id: 'status', label: 'Status', contentMinSamples: STATUS_CONTENT_SAMPLES, minWidth: 100, getValue: r => <StatusBadge label={statusLabels[r.status]} color={statusColors[r.status]} />, getSortValue: r => statusLabels[r.status] || '' },
    { id: 'createdBy', label: 'Recorder', contentMinSamples: RECORDER_CONTENT_SAMPLES, minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{(r as any).createdByUser?.name ?? (r as any).createdByUser?.email?.split('@')[0] ?? (r.createdBy ? '…' : '—')}</Text>, getSortValue: r => ((r as any).createdByUser?.name ?? (r as any).createdByUser?.email?.split('@')[0] ?? '').toLowerCase() },
    { id: 'createdAt', label: 'Record date', contentMinSamples: RECORD_DATE_CONTENT_SAMPLES, minWidth: 100, getValue: r => <Text style={{ fontSize: 14, color: '#636E72' }} numberOfLines={1} ellipsizeMode="tail">{r.createdAt ? formatTimeAgo(r.createdAt) : formatDate(r.date)}</Text>, getSortValue: r => r.createdAt || r.date || '' },
    { id: 'documentNo', label: 'Doc No', contentMinSamples: ['DOC-12345'], minWidth: 90, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.documentNo || '—'}</Text>, getSortValue: r => (r.documentNo || '').toLowerCase() },
    { id: 'handler', label: 'Handler', contentMinSamples: ['Handler'], minWidth: 80, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.handlerName || '—'}</Text>, getSortValue: r => (r.handlerName || '').toLowerCase() },
    { id: 'preparer', label: 'Preparer', contentMinSamples: ['Preparer'], minWidth: 80, getValue: r => <Text style={{ fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">{r.preparerName || '—'}</Text>, getSortValue: r => (r.preparerName || '').toLowerCase() },
  ];
}
