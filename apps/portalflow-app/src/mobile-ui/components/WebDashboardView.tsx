/**
 * Web 端 Dashboard：四个图表卡片（收入支出曲线、按账户支出饼图、按分类支出柱状图、按提交人/日期条数曲线）。
 */
import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, ScrollView, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, G, Text as SvgText, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { getAllReceiptsForList, getAllReceipts } from '@/lib/database';
import { getAllInvoices } from '@/lib/invoices';
import { isMobileWebWidth } from '../lib/web-viewport';
import DashboardPeriodSelector, {
  type DashboardDateRange,
  type DashboardPeriodPreset,
  isDateInRange,
  resolveDashboardPeriodRange,
} from './DashboardPeriodSelector';

const CHART_COLORS = ['#6C5CE7', '#D35400', '#00B894', '#0984E3', '#FDCB6E', '#E17055', '#636E72'];
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** 与 CrmDashboardView 完全一致：留空、视口、顶栏高度、页面结构 */
const DASHBOARD_SPACING = 32;
const CARD_PADDING = 16;
const SIDEBAR_WIDTH = 240;
const DASHBOARD_HEADER_HEIGHT = 60;
/** Cap submission-series X points so dense custom ranges stay readable */
const MAX_SUBMISSION_DATES = 90;

function getMonthKey(dateStr: string): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  return dateStr.slice(0, 7);
}

function getDateKey(dateStr: string): string {
  if (!dateStr) return '';
  if (typeof dateStr === 'string') return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  return String(dateStr);
}

export default function WebDashboardView({ homeCompact = false }: { homeCompact?: boolean } = {}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [receiptsWithItems, setReceiptsWithItems] = useState<any[]>([]);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>('last_12_months');
  const [customRange, setCustomRange] = useState<DashboardDateRange | null>(null);

  const activeRange = useMemo(
    () => resolveDashboardPeriodRange(periodPreset, customRange),
    [periodPreset, customRange]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listReceipts, listInvoices, fullReceipts] = await Promise.all([
          getAllReceiptsForList(),
          getAllInvoices(),
          getAllReceipts(),
        ]);
        if (!cancelled) {
          setReceipts(listReceipts);
          setInvoices(listInvoices);
          setReceiptsWithItems(fullReceipts);
        }
      } catch (e) {
        console.error('Dashboard load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { byMonth, byAccount, byCategory, bySubmitterDate } = useMemo(() => {
    const filteredReceipts = receipts.filter((r) => isDateInRange(r.date, activeRange));
    const filteredInvoices = invoices.filter((inv) => isDateInRange(inv.date, activeRange));
    const filteredReceiptsWithItems = receiptsWithItems.filter((r) => isDateInRange(r.date, activeRange));

    const monthExp: Record<string, number> = {};
    const monthInc: Record<string, number> = {};
    filteredReceipts.forEach((r) => {
      const k = getMonthKey(r.date);
      if (k) monthExp[k] = (monthExp[k] || 0) + Number(r.totalAmount ?? 0);
    });
    filteredInvoices.forEach((inv) => {
      const k = getMonthKey(inv.date);
      if (k) monthInc[k] = (monthInc[k] || 0) + Number(inv.totalAmount ?? 0);
    });

    const accountMap: Record<string, number> = {};
    filteredReceipts.forEach((r) => {
      const name = r.account?.name || 'Unset';
      accountMap[name] = (accountMap[name] || 0) + Number(r.totalAmount ?? 0);
    });

    const categoryMap: Record<string, number> = {};
    filteredReceiptsWithItems.forEach((r) => {
      (r.items || []).forEach((item: any) => {
        const name = item.category?.name || 'Uncategorized';
        const amount = Number(item.price ?? 0);
        categoryMap[name] = (categoryMap[name] || 0) + amount;
      });
    });

    const submitterDateMap: Record<string, Record<string, number>> = {};
    const allDates = new Set<string>();
    [...filteredReceipts, ...filteredInvoices].forEach((r) => {
      const dateKey = getDateKey(r.createdAt || r.date);
      if (!dateKey || !isDateInRange(dateKey, activeRange)) return;
      allDates.add(dateKey);
      const name = r.createdByUser?.name || r.createdByUser?.email?.split('@')[0] || 'Unknown';
      if (!submitterDateMap[name]) submitterDateMap[name] = {};
      submitterDateMap[name][dateKey] = (submitterDateMap[name][dateKey] || 0) + 1;
    });

    return {
      byMonth: { expense: monthExp, income: monthInc },
      byAccount: accountMap,
      byCategory: categoryMap,
      bySubmitterDate: { data: submitterDateMap, dates: Array.from(allDates).sort() },
    };
  }, [receipts, invoices, receiptsWithItems, activeRange]);

  const monthKeys = useMemo(() => {
    const set = new Set<string>([
      ...Object.keys(byMonth.expense),
      ...Object.keys(byMonth.income),
    ]);
    return Array.from(set).sort();
  }, [byMonth.expense, byMonth.income]);

  const maxMonthVal = useMemo(() => {
    let m = 0;
    monthKeys.forEach((k) => {
      m = Math.max(m, byMonth.expense[k] || 0, byMonth.income[k] || 0);
    });
    return m || 1;
  }, [monthKeys, byMonth]);

  if (loading && Platform.OS === 'web') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#6C5CE7" />
      </View>
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="stats-chart-outline" size={28} color="#6C5CE7" />
          <Text style={styles.title}>Dashboard</Text>
        </View>
        <Text style={styles.subtitle}>Charts are available on web only.</Text>
      </View>
    );
  }

  const accountEntries = Object.entries(byAccount).filter(([, v]) => v > 0);
  const totalAccount = accountEntries.reduce((s, [, v]) => s + v, 0);
  const categoryEntries = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCategoryVal = Math.max(1, ...categoryEntries.map(([, v]) => v));
  const submitterNames = Object.keys(bySubmitterDate.data);
  const dateRange =
    bySubmitterDate.dates.length > MAX_SUBMISSION_DATES
      ? bySubmitterDate.dates.slice(-MAX_SUBMISSION_DATES)
      : bySubmitterDate.dates;
  const maxCount = Math.max(
    1,
    ...submitterNames.flatMap((name) => dateRange.map((d) => bySubmitterDate.data[name][d] || 0))
  );

  // 桌面 Web 宽屏：2x2；窄窗（移动浏览器）：单列，按宽度定图表高度，避免 2x2 压扁纵横比
  const isDesktopGrid = !isMobileWebWidth(screenWidth);
  const showDashboardPageHeader = true;
  const headerHeight = DASHBOARD_HEADER_HEIGHT;

  const periodSelector = (
    <DashboardPeriodSelector
      preset={periodPreset}
      customRange={customRange}
      onPresetChange={setPeriodPreset}
      onCustomRangeChange={setCustomRange}
    />
  );

  let cardWidth: number;
  let cardHeight: number;
  let chartWidth: number;
  let chartHeight: number;

  if (isDesktopGrid) {
    const viewportWidth = screenWidth - SIDEBAR_WIDTH;
    const viewportHeight = screenHeight - headerHeight;
    cardWidth = Math.floor((viewportWidth - 3 * DASHBOARD_SPACING) / 2);
    cardHeight = Math.floor((viewportHeight - 3 * DASHBOARD_SPACING) / 2);
    chartWidth = Math.max(200, cardWidth - 2 * CARD_PADDING);
    chartHeight = Math.max(180, cardHeight - 60);
  } else {
    const horizontalGutter = homeCompact ? 40 : DASHBOARD_SPACING * 2;
    cardWidth = Math.floor(screenWidth - horizontalGutter);
    chartWidth = Math.max(200, cardWidth - 2 * CARD_PADDING);
    chartHeight = Math.round(Math.max(220, Math.min(320, chartWidth * 0.58)));
    cardHeight = chartHeight + 52;
  }

  const padding = { top: 24, right: 24, bottom: 44, left: 56 };
  const chartW = chartWidth - padding.left - padding.right;
  const chartH = chartHeight - padding.top - padding.bottom;

  const cardShellStyle = isDesktopGrid
    ? { width: cardWidth, height: cardHeight }
    : { width: '100%' as const, height: cardHeight };

  const gridLayoutStyle = isDesktopGrid
    ? [styles.grid, { gap: DASHBOARD_SPACING }]
    : [
        styles.grid,
        {
          gap: DASHBOARD_SPACING,
          flexDirection: 'column' as const,
          flexWrap: 'nowrap' as const,
          alignItems: 'stretch' as const,
        },
      ];

  const chartGrid = (
        <View style={gridLayoutStyle}>
        {/* 1. Income & expense by month – bar chart, same-period bars closer */}
        <View style={[styles.card, cardShellStyle]}>
          <Text style={styles.cardTitle}>Income & Expense by Month</Text>
          <View style={styles.chartWrap}>
            <Svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
              {monthKeys.length === 0 ? (
                <SvgText x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={FONT_FAMILY}>No data</SvgText>
              ) : (
                (() => {
                  const n = monthKeys.length;
                  const barGroupW = chartW / n;
                  const barW = Math.min(barGroupW * 0.38, 22);
                  const pairGap = 6;
                  const xExp = (i: number) => padding.left + (i + 0.5) * barGroupW - barW - pairGap / 2;
                  const xInc = (i: number) => padding.left + (i + 0.5) * barGroupW + pairGap / 2;
                  return (
                    <>
                      {monthKeys.map((k, i) => {
                        const gx = padding.left + (i + 0.5) * barGroupW;
                        const label = k.slice(2, 4) + '/' + k.slice(5, 7);
                        return (
                          <SvgText key={k} x={gx} y={chartHeight - 12} textAnchor="middle" fill="#636E72" fontSize={11} fontFamily={FONT_FAMILY}>{label}</SvgText>
                        );
                      })}
                      {monthKeys.map((k, i) => {
                        const expVal = byMonth.expense[k] || 0;
                        const incVal = byMonth.income[k] || 0;
                        const barHExp = maxMonthVal ? (expVal / maxMonthVal) * chartH : 0;
                        const barHInc = maxMonthVal ? (incVal / maxMonthVal) * chartH : 0;
                        const yExp = padding.top + chartH - barHExp;
                        const yInc = padding.top + chartH - barHInc;
                        return (
                          <G key={k}>
                            <Rect x={xExp(i)} y={yExp} width={barW} height={barHExp} rx={4} fill="#6C5CE7" />
                            <Rect x={xInc(i)} y={yInc} width={barW} height={barHInc} rx={4} fill="#D35400" />
                          </G>
                        );
                      })}
                      <SvgText x={padding.left - 10} y={padding.top + 14} fill="#6C5CE7" fontSize={11} fontFamily={FONT_FAMILY}>Expense</SvgText>
                      <SvgText x={padding.left - 10} y={padding.top + 30} fill="#D35400" fontSize={11} fontFamily={FONT_FAMILY}>Income</SvgText>
                    </>
                  );
                })()
              )}
            </Svg>
          </View>
        </View>

        {/* 2. Expense by account – larger pie */}
        <View style={[styles.card, cardShellStyle]}>
          <Text style={styles.cardTitle}>Expense by Account</Text>
          <View style={styles.chartWrap}>
            <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ overflow: 'visible' }}>
              {accountEntries.length === 0 ? (
                <SvgText x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={FONT_FAMILY}>No data</SvgText>
              ) : (
                (() => {
                  const cx = chartWidth / 2;
                  const cy = chartHeight / 2 - 8;
                  const r = Math.min(128, chartHeight / 2 - 28, chartWidth / 2 - 32);
                  let acc = 0;
                  return (
                    <G>
                      {accountEntries.map(([name, val], i) => {
                        const ratio = totalAccount ? val / totalAccount : 0;
                        const start = acc * 2 * Math.PI - Math.PI / 2;
                        acc += ratio;
                        const end = acc * 2 * Math.PI - Math.PI / 2;
                        const x1 = cx + r * Math.cos(start);
                        const y1 = cy + r * Math.sin(start);
                        const x2 = cx + r * Math.cos(end);
                        const y2 = cy + r * Math.sin(end);
                        const large = ratio > 0.5 ? 1 : 0;
                        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
                        return <Path key={name} d={d} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="#fff" strokeWidth={2} />;
                      })}
                      <SvgText x={cx} y={cy + 6} textAnchor="middle" fill="#2D3436" fontSize={13} fontFamily={FONT_FAMILY}>Expense</SvgText>
                      {accountEntries.slice(0, 6).map(([name, val], i) => (
                        <SvgText key={name} x={chartWidth - 16} y={padding.top + 20 + i * 18} textAnchor="end" fill={CHART_COLORS[i % CHART_COLORS.length]} fontSize={12} fontFamily={FONT_FAMILY}>
                          {name.length > 12 ? name.slice(0, 12) + '…' : name} {totalAccount ? ((val / totalAccount) * 100).toFixed(0) + '%' : ''}
                        </SvgText>
                      ))}
                    </G>
                  );
                })()
              )}
            </Svg>
          </View>
        </View>

        {/* 3. Expense by category – horizontal bars, Y-axis label area, fill card vertically */}
        <View style={[styles.card, cardShellStyle]}>
          <Text style={styles.cardTitle}>Expense by Category</Text>
          <View style={styles.chartWrap}>
            <Svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
              {categoryEntries.length === 0 ? (
                <SvgText x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={FONT_FAMILY}>No data</SvgText>
              ) : (
                (() => {
                  const labelLeft = 130;
                  const barStartX = labelLeft + 12;
                  const barMaxW = chartWidth - barStartX - padding.right;
                  const rowH = chartH / categoryEntries.length;
                  const barH = Math.max(14, rowH - 6);
                  const barYOffset = (rowH - barH) / 2;
                  return (
                    <>
                      {categoryEntries.map(([name, val], i) => {
                        const barW = maxCategoryVal ? (val / maxCategoryVal) * barMaxW : 0;
                        const y = padding.top + (i + 0.5) * rowH;
                        const barY = padding.top + i * rowH + barYOffset;
                        const label = name.length > 16 ? name.slice(0, 16) + '…' : name;
                        return (
                          <G key={name}>
                            <SvgText x={labelLeft} y={y + 4} textAnchor="end" fill="#636E72" fontSize={11} fontFamily={FONT_FAMILY}>{label}</SvgText>
                            <Rect x={barStartX} y={barY} width={barW} height={barH} rx={4} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          </G>
                        );
                      })}
                    </>
                  );
                })()
              )}
            </Svg>
          </View>
        </View>

        {/* 4. Submissions by submitter & date – natural date X-axis, dots on data points */}
        <View style={[styles.card, cardShellStyle]}>
          <Text style={styles.cardTitle}>Submissions by Submitter & Date</Text>
          <View style={styles.chartWrap}>
            <Svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
              {dateRange.length === 0 || submitterNames.length === 0 ? (
                <SvgText x={chartWidth / 2} y={chartHeight / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={FONT_FAMILY}>No data</SvgText>
              ) : (
                (() => {
                  const formatDate = (d: string) => {
                    const [y, m, day] = d.split('-');
                    return `${Number(m)}/${Number(day)}`;
                  };
                  const step = Math.max(1, Math.floor(dateRange.length / 10));
                  return (
                    <>
                      {dateRange.filter((_, i) => i % step === 0 || i === dateRange.length - 1).map((d, idx) => {
                        const i = dateRange.indexOf(d);
                        const x = padding.left + (i / Math.max(1, dateRange.length - 1)) * chartW;
                        return <SvgText key={d} x={x} y={chartHeight - 14} textAnchor="middle" fill="#636E72" fontSize={10} fontFamily={FONT_FAMILY}>{formatDate(d)}</SvgText>;
                      })}
                      {submitterNames.map((name, si) => {
                        const pts = dateRange.map((d, i) => {
                          const x = padding.left + (i / Math.max(1, dateRange.length - 1)) * chartW;
                          const v = bySubmitterDate.data[name][d] || 0;
                          const y = padding.top + chartH - (v / maxCount) * chartH;
                          return { x, y, v };
                        });
                        const d = `M ${pts.map((p) => `${p.x},${p.y}`).join(' L ')}`;
                        return (
                          <G key={name}>
                            <Path d={d} fill="none" stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                            {pts.filter((p) => p.v > 0).map((p, i) => (
                              <Circle key={i} cx={p.x} cy={p.y} r={4} fill={CHART_COLORS[si % CHART_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
                            ))}
                          </G>
                        );
                      })}
                      {submitterNames.slice(0, 5).map((name, i) => (
                        <SvgText key={name} x={chartWidth - 16} y={padding.top + 18 + i * 16} textAnchor="end" fill={CHART_COLORS[i % CHART_COLORS.length]} fontSize={11} fontFamily={FONT_FAMILY}>
                          {name.length > 12 ? name.slice(0, 12) + '…' : name}
                        </SvgText>
                      ))}
                    </>
                  );
                })()
              )}
            </Svg>
          </View>
        </View>
        </View>
  );

  if (homeCompact && !isDesktopGrid) {
    return (
      <View style={styles.homeCompactRoot}>
        <View style={styles.homeCompactPeriod}>{periodSelector}</View>
        {chartGrid}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {showDashboardPageHeader ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="stats-chart-outline" size={28} color="#6C5CE7" />
            <Text style={styles.title}>Dashboard</Text>
          </View>
          {periodSelector}
        </View>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { padding: DASHBOARD_SPACING }]}
        showsVerticalScrollIndicator={false}
      >
        {chartGrid}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 16,
    paddingBottom: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
    flexWrap: 'wrap',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#2D3436', marginLeft: 10 },
  subtitle: {
    fontSize: 15,
    color: '#636E72',
    marginTop: 8,
    marginHorizontal: 20,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignContent: 'flex-start',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: CARD_PADDING,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  chartWrap: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FA',
  },
  homeCompactRoot: {
    width: '100%',
    gap: DASHBOARD_SPACING,
    paddingBottom: 8,
  },
  homeCompactPeriod: {
    width: '100%',
    alignItems: 'stretch',
  },
});
