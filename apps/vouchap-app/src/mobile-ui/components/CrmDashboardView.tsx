/**
 * Firm Insights dashboard (web-first).
 * Four analytic charts:
 * 1) Clients by status (pie)
 * 2) Clients by assignee (horizontal bar)
 * 3) Engagements by status (bar)
 * 4) Follow-ups over time by assignee (line)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Rect, G, Circle, Text as SvgText } from 'react-native-svg';

/** 堆叠横道图单段：仅左圆角 / 仅右圆角 / 无圆角。rx 圆角半径，x,y,w,h 矩形。 */
function stackedBarSegmentPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  roundLeft: boolean,
  roundRight: boolean
): string {
  if (w <= 0) return '';
  if (!roundLeft && !roundRight) return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  const r = Math.min(rx, w / 2, h / 2);
  if (roundLeft && roundRight) {
    return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
  }
  if (roundLeft) {
    return `M ${x + r} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
  }
  // roundRight
  return `M ${x} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x} ${y + h} L ${x} ${y} Z`;
}
import { getCurrentSpace } from '@/lib/auth';
import {
  getFirmClientsListBundle,
  getFirmClientFollowUps,
} from '@/lib/firm';
import { supabase } from '@/lib/supabase';
import type { ClientDisplayStatus, FirmOrderStatus } from '@/types';
import type { FirmClientWithDetails, FirmClientFollowUp } from '@/lib/firm';
import { isMobileWebWidth } from '../lib/web-viewport';

/** 非 status 图表用（assignee / follow-up 系列） */
const FIRM_CHART_COLORS = ['#6C5CE7', '#00B894', '#0298D1', '#FDCB6E', '#E17055'];

/** 与列表/详情标签一致的 client 状态色（按 CLIENT_STATUS_LABELS 的 label 取色） */
const CLIENT_STATUS_CHART_COLORS: Record<string, string> = {
  'New': '#6C5CE7',
  'To follow up': '#E67E22',
  'In service': '#0298D1',
  'Pre Season': '#00B894',
  'Churned': '#636E72',
};

/** 与列表/详情标签一致的 order 状态色（按 ORDER_STATUS_LABELS 的 label 取色） */
const ORDER_STATUS_CHART_COLORS: Record<string, string> = {
  'Onboarding': '#E67E22',
  'Processing': '#29B6F6',
  'Completed': '#00875A',
  'Cancelled': '#636E72',
};

const CLIENT_STATUS_LABELS: Record<ClientDisplayStatus, string> = {
  new: 'New',
  to_follow_up: 'To follow up',
  in_service: 'In service',
  to_revisit: 'Pre Season',
  churned: 'Churned',
};

const ORDER_STATUS_LABELS: Record<FirmOrderStatus, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** 图表内文字统一字体（与 WebDashboardView 一致） */
const INSIGHTS_CHART_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** 留空：四周与间距统一，卡片宽度=(视口宽-3*留空)/2，卡片高度=(视口高-3*留空)/2 */
const INSIGHTS_SPACING = 32;
const INSIGHTS_PADDING = INSIGHTS_SPACING;
const INSIGHTS_GAP = INSIGHTS_SPACING;
const CARD_PADDING = 16;
// 横向 padding：Web 保持 16，mobile 去掉卡片内横向 padding，让图表几乎铺满卡片
const CARD_PADDING_X_WEB = 16;
const CARD_PADDING_X_MOBILE = 0;
/** 视口为内容区：减去左侧栏（与 WebSidebar 一致）和顶标题行 */
const SIDEBAR_WIDTH = 240;
const INSIGHTS_HEADER_HEIGHT = 60;

type FollowUpSeries = {
  assignee: string;
  color: string;
  points: { x: number; y: number }[];
};

export default function CrmDashboardView() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<FirmClientWithDetails[]>([]);
  const [orderCountByStatus, setOrderCountByStatus] = useState<Record<string, number>>({});
  const [followUps, setFollowUps] = useState<FirmClientFollowUp[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const space = await getCurrentSpace(true);
        if (!space || space.kind !== 'firm' || cancelled) {
          setLoading(false);
          return;
        }
        const [bundle, followUpList] = await Promise.all([
          getFirmClientsListBundle(space.id),
          getFirmClientFollowUps(space.id),
        ]);
        if (cancelled) return;
        setClients(bundle.clients);
        setOrderCountByStatus(bundle.orderCountByStatus);
        setFollowUps(followUpList);

        const authorIds = Array.from(
          new Set(followUpList.map((f) => f.createdBy).filter(Boolean) as string[])
        );
        if (authorIds.length > 0) {
          const { data } = await supabase.from('users').select('id, name, email').in('id', authorIds);
          const map: Record<string, string> = {};
          (data || []).forEach((u: any) => {
            map[u.id] = u.name || u.email || 'Unknown';
          });
          if (!cancelled) setAuthorNames(map);
        }
      } catch (e) {
        console.error('CrmDashboardView load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientStatusEntries = useMemo(() => {
    const base: Record<ClientDisplayStatus, number> = {
      new: 0,
      to_follow_up: 0,
      in_service: 0,
      to_revisit: 0,
      churned: 0,
    };
    clients.forEach((c) => {
      base[c.displayStatus] = (base[c.displayStatus] ?? 0) + 1;
    });
    return (Object.keys(base) as ClientDisplayStatus[])
      .filter((k) => base[k] > 0)
      .map((k) => [CLIENT_STATUS_LABELS[k], base[k]] as [string, number]);
  }, [clients]);

  /** Clients by assignee: 每个 assignee 下按 status 分段的堆叠数据，用于堆叠横道图 */
  const clientAssigneeStackedEntries = useMemo(() => {
    const statusOrder: ClientDisplayStatus[] = ['new', 'to_follow_up', 'in_service', 'to_revisit', 'churned'];
    const byAssignee: Record<string, Record<ClientDisplayStatus, number>> = {};
    clients.forEach((c) => {
      const key = c.assigneeName || 'Unassigned';
      if (!byAssignee[key]) {
        byAssignee[key] = { new: 0, to_follow_up: 0, in_service: 0, to_revisit: 0, churned: 0 };
      }
      byAssignee[key][c.displayStatus] = (byAssignee[key][c.displayStatus] ?? 0) + 1;
    });
    return Object.entries(byAssignee)
      .map(([assignee, statusCounts]) => {
        const segments = statusOrder
          .filter((k) => (statusCounts[k] ?? 0) > 0)
          .map((k) => [CLIENT_STATUS_LABELS[k], statusCounts[k] ?? 0] as [string, number]);
        const total = statusOrder.reduce((s, k) => s + (statusCounts[k] ?? 0), 0);
        return { assignee, segments, total };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [clients]);

  const orderStatusEntries = useMemo(() => {
    const base: Record<FirmOrderStatus, number> = {
      onboarding: orderCountByStatus['onboarding'] ?? 0,
      processing: orderCountByStatus['processing'] ?? 0,
      completed: orderCountByStatus['completed'] ?? 0,
      cancelled: orderCountByStatus['cancelled'] ?? 0,
    };
    return (Object.keys(base) as FirmOrderStatus[])
      .filter((k) => base[k] > 0)
      .map((k) => [ORDER_STATUS_LABELS[k], base[k]] as [string, number]);
  }, [orderCountByStatus]);

  const followUpSeries = useMemo<FollowUpSeries[]>(() => {
    if (followUps.length === 0) return [];
    const byDateAuthor: Record<string, Record<string, number>> = {};
    const allDates = new Set<string>();
    followUps.forEach((f) => {
      const date = f.createdAt?.slice(0, 10) || '';
      if (!date) return;
      allDates.add(date);
      const authorId = f.createdBy || 'unknown';
      const name = authorNames[authorId] || 'Unassigned';
      if (!byDateAuthor[name]) byDateAuthor[name] = {};
      byDateAuthor[name][date] = (byDateAuthor[name][date] ?? 0) + 1;
    });
    const dates = Array.from(allDates).sort();
    if (dates.length === 0) return [];

    const totals: Record<string, number> = {};
    Object.entries(byDateAuthor).forEach(([name, map]) => {
      totals[name] = Object.values(map).reduce((s, v) => s + v, 0);
    });
    const topAuthors = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);

    const maxVal = Math.max(
      1,
      ...topAuthors.map((name) => {
        const m = byDateAuthor[name];
        return m ? Math.max(...Object.values(m)) : 0;
      })
    );

    return topAuthors.map((name, idx) => {
      const color = FIRM_CHART_COLORS[idx % FIRM_CHART_COLORS.length];
      const counts = byDateAuthor[name] || {};
      const points = dates.map((d, i) => ({
        x: i,
        y: counts[d] || 0,
      }));
      // Normalize y with maxVal when drawing; here keep raw values.
      return { assignee: name, color, points };
    });
  }, [followUps, authorNames]);

  // 视口：
  // - 桌面 Web（宽屏）：去除左侧栏与顶标题行，四卡片 2x2 网格
  // - 原生 与 移动 Web（窄窗）：全宽内容区，四卡片单列堆叠（不随高度压扁）
  const isDesktopInsightsGrid = Platform.OS === 'web' && !isMobileWebWidth(screenWidth);
  const viewportWidth = isDesktopInsightsGrid ? screenWidth - SIDEBAR_WIDTH : screenWidth;
  const viewportHeight = screenHeight - INSIGHTS_HEADER_HEIGHT;

  // 桌面 Web：2x2 网格卡片宽度；窄窗 / 原生：cardWidthMobile 估算内部图表宽度
  const cardWidthWeb = Math.floor((viewportWidth - 3 * INSIGHTS_SPACING) / 2);
  // 移动端：与 ScrollView paddingHorizontal=4 对齐，仅预留极小安全边距，最大化图表宽度
  const cardWidthMobile = Math.max(0, viewportWidth - 2 * 4 - 4);
  const cardHeight = isDesktopInsightsGrid
    ? Math.floor((viewportHeight - 3 * INSIGHTS_SPACING) / 2)
    : 260;
  const horizontalPadding = isDesktopInsightsGrid ? CARD_PADDING_X_WEB : CARD_PADDING_X_MOBILE;
  const cardInnerWidth = Math.max(0, (isDesktopInsightsGrid ? cardWidthWeb : cardWidthMobile) - 2 * horizontalPadding);
  const chartWidth = Math.max(180, cardInnerWidth);
  const pieSize = Math.min(chartWidth, cardHeight - 60);
  const barChartH = Math.max(120, cardHeight - 60);
  const lineChartH = Math.max(120, cardHeight - 60);

  if (loading && Platform.OS === 'web') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isDesktopInsightsGrid && (
        <View style={styles.header}>
          <Ionicons name="grid-outline" size={28} color="#6C5CE7" />
          <Text style={styles.title}>Insights</Text>
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isDesktopInsightsGrid
            ? { padding: INSIGHTS_PADDING }
            : { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.grid,
            isDesktopInsightsGrid
              ? { gap: INSIGHTS_GAP }
              : {
                  gap: 4,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'flex-start',
                },
          ]}
        >
          {/* Clients by status (pie) */}
          <View
            style={[
              styles.card,
              isDesktopInsightsGrid
                ? { width: cardWidthWeb, height: cardHeight }
                : { width: '100%', alignSelf: 'center', marginBottom: 12 },
            ]}
          >
            <Text style={[styles.cardTitle, !isDesktopInsightsGrid && { paddingLeft: 8 }]}>
              Clients by status
            </Text>
            <View style={styles.chartContainer}>
              <ClientStatusPie
                width={chartWidth}
                height={pieSize}
                entries={clientStatusEntries}
              />
            </View>
          </View>

          {/* Clients by assignee (horizontal bar) */}
          <View
            style={[
              styles.card,
              isDesktopInsightsGrid
                ? { width: cardWidthWeb, height: cardHeight }
                : { width: '100%', alignSelf: 'center', marginBottom: 12 },
            ]}
          >
            <Text style={[styles.cardTitle, !isDesktopInsightsGrid && { paddingLeft: 8 }]}>
              Clients by assignee
            </Text>
            <View
              style={[
                styles.chartContainer,
                !isDesktopInsightsGrid && { alignItems: 'stretch' },
              ]}
            >
              <ClientAssigneeBars
                width={chartWidth}
                height={barChartH}
                stackedEntries={clientAssigneeStackedEntries}
              />
            </View>
          </View>

          {/* Engagements by status (bar) */}
          <View
            style={[
              styles.card,
              isDesktopInsightsGrid
                ? { width: cardWidthWeb, height: cardHeight }
                : { width: '100%', alignSelf: 'center', marginBottom: 12 },
            ]}
          >
            <Text style={[styles.cardTitle, !isDesktopInsightsGrid && { paddingLeft: 8 }]}>
              Engagements by status
            </Text>
            <View style={styles.chartContainer}>
              <OrderStatusBars
                width={chartWidth}
                height={barChartH}
                entries={orderStatusEntries}
              />
            </View>
          </View>

          {/* Follow-ups over time by assignee (line) */}
          <View
            style={[
              styles.card,
              isDesktopInsightsGrid
                ? { width: cardWidthWeb, height: cardHeight }
                : { width: '100%', alignSelf: 'center', marginBottom: 12 },
            ]}
          >
            <Text style={[styles.cardTitle, !isDesktopInsightsGrid && { paddingLeft: 8 }]}>
              Follow-ups over time
            </Text>
            <View
              style={[
                styles.chartContainer,
                !isDesktopInsightsGrid && { alignItems: 'stretch' },
              ]}
            >
              <FollowUpLines
                width={chartWidth}
                height={lineChartH}
                series={followUpSeries}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

type PieProps = {
  width: number;
  height: number;
  entries: [string, number][];
};

function ClientStatusPie({ width, height, entries }: PieProps) {
  const { width: winW } = useWindowDimensions();
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const cx = width / 2;
  const cy = height / 2;
  const rOuter = Math.min(width, height) / 2 - 20;
  const rInner = rOuter * 0.55;
  const isMobile = Platform.OS !== 'web' || isMobileWebWidth(winW);

  if (entries.length === 0) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={width / 2} y={height / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={INSIGHTS_CHART_FONT}>
          No data
        </SvgText>
      </Svg>
    );
  }

  let acc = 0;
  return (
      <Svg width={width} height={height} style={{ overflow: 'visible' }}>
      <G>
        {entries.map(([name, val], i) => {
          const ratio = total ? val / total : 0;
          const color = CLIENT_STATUS_CHART_COLORS[name] ?? FIRM_CHART_COLORS[i % FIRM_CHART_COLORS.length];
          let slice: JSX.Element;
          if (ratio >= 1 - 1e-9) {
            slice = <Circle key={name} cx={cx} cy={cy} r={rOuter} fill={color} stroke="#fff" strokeWidth={2} />;
          } else {
            const start = acc * 2 * Math.PI - Math.PI / 2;
            const end = (acc + ratio) * 2 * Math.PI - Math.PI / 2;
            const x1 = cx + rOuter * Math.cos(start);
            const y1 = cy + rOuter * Math.sin(start);
            const x2 = cx + rOuter * Math.cos(end);
            const y2 = cy + rOuter * Math.sin(end);
            const large = ratio > 0.5 ? 1 : 0;
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} Z`;
            slice = <Path key={name} d={d} fill={color} stroke="#fff" strokeWidth={2} />;
          }
          acc += ratio;
          return slice;
        })}
        {/* inner cutout to create donut effect */}
        <Circle cx={cx} cy={cy} r={rInner} fill="#FFF" />
        {/* 中心文字：移动端拆成两行，避免自动换行/重叠 */}
        <SvgText
          x={cx}
          y={cy - (isMobile ? 2 : 4)}
          textAnchor="middle"
          fill="#2D3436"
          fontSize={isMobile ? 14 : 13}
          fontWeight="600"
          fontFamily={INSIGHTS_CHART_FONT}
        >
          {total}
        </SvgText>
        {!isMobile && (
          <SvgText
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fill="#636E72"
            fontSize={11}
            fontFamily={INSIGHTS_CHART_FONT}
          >
            clients
          </SvgText>
        )}
        {/* 图例：统一放在卡片左上角，避免与饼图和卡片边缘重叠 */}
        {entries.slice(0, 5).map(([name, val], i) => {
          const legendX = 8;
          const legendY = 18 + i * 16;
          const maxLabelLen = isMobile ? 14 : 18;
          const label =
            name.length > maxLabelLen
              ? `${name.slice(0, maxLabelLen - 1)}…`
              : name;
          return (
            <G key={name}>
              <Rect
                x={legendX}
                y={legendY - 7}
                width={8}
                height={8}
                rx={2}
                fill={
                  CLIENT_STATUS_CHART_COLORS[name] ??
                  FIRM_CHART_COLORS[i % FIRM_CHART_COLORS.length]
                }
              />
              <SvgText
                x={legendX + 14}
                y={legendY}
                textAnchor="start"
                fill="#4B5563"
                fontSize={isMobile ? 11 : 10}
                fontFamily={INSIGHTS_CHART_FONT}
              >
                {label}
                {total ? ` ${((val / total) * 100).toFixed(0)}%` : ''}
              </SvgText>
            </G>
          );
        })}
      </G>
    </Svg>
  );
}

type BarProps = {
  width: number;
  height: number;
  entries: [string, number][];
};

type StackedBarRow = { assignee: string; segments: [string, number][]; total: number };

type StackedBarProps = {
  width: number;
  height: number;
  stackedEntries: StackedBarRow[];
};

function ClientAssigneeBars({ width, height, stackedEntries }: StackedBarProps) {
  const { width: winW } = useWindowDimensions();
  if (stackedEntries.length === 0) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={width / 2} y={height / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={INSIGHTS_CHART_FONT}>
          No data
        </SvgText>
      </Svg>
    );
  }
  // 桌面 Web 保持较大的左侧留白用于长姓名；移动 Web / 原生收紧左右 padding 放大可视条形区域
  const useWideChartPadding = Platform.OS === 'web' && !isMobileWebWidth(winW);
  const padding = {
    top: 20,
    right: useWideChartPadding ? 24 : 16,
    bottom: 20,
    left: useWideChartPadding ? 80 : 52,
  };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxTotal = Math.max(...stackedEntries.map((row) => row.total), 1);
  const rowH = chartH / stackedEntries.length;
  const statusesInChart = Array.from(
    new Set(stackedEntries.flatMap((row) => row.segments.map(([label]) => label)))
  ).sort(
    (a, b) =>
      Object.keys(CLIENT_STATUS_CHART_COLORS).indexOf(a) - Object.keys(CLIENT_STATUS_CHART_COLORS).indexOf(b)
  );

  return (
    <Svg width={width} height={height} style={{ overflow: 'visible' }}>
      {/* background stripes */}
      {stackedEntries.map((_, i) => {
        const y = padding.top + i * rowH + rowH * 0.2;
        const barH = rowH * 0.6;
        return (
          <Rect
            key={`bg-${i}`}
            x={padding.left}
            y={y}
            width={chartW}
            height={barH}
            rx={4}
            fill="#F3F4F6"
          />
        );
      })}
      {stackedEntries.map((row, i) => {
        const y = padding.top + i * rowH + rowH * 0.2;
        const barH = rowH * 0.6;
        const label = row.assignee.length > 16 ? `${row.assignee.slice(0, 15)}…` : row.assignee;
        let offsetX = padding.left;
        return (
          <G key={row.assignee}>
            <SvgText
              x={padding.left - 8}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fill="#636E72"
              fontSize={11}
              fontFamily={INSIGHTS_CHART_FONT}
            >
              {label}
            </SvgText>
            {row.segments.map(([statusLabel], segIdx) => {
              const val = row.segments[segIdx][1];
              const segmentW = maxTotal ? (val / maxTotal) * chartW : 0;
              const color = CLIENT_STATUS_CHART_COLORS[statusLabel] ?? '#95A5A6';
              const isFirst = segIdx === 0;
              const isLast = segIdx === row.segments.length - 1;
              const d = stackedBarSegmentPath(offsetX, y, segmentW, barH, 8, isFirst, isLast);
              const seg = d ? (
                <Path key={statusLabel} d={d} fill={color} />
              ) : null;
              offsetX += segmentW;
              return seg;
            })}
            <SvgText
              x={padding.left + (row.total / maxTotal) * chartW + 6}
              y={y + barH / 2 + 3}
              textAnchor="start"
              fill="#636E72"
              fontSize={10}
              fontFamily={INSIGHTS_CHART_FONT}
            >
              {row.total}
            </SvgText>
          </G>
        );
      })}
      {/* Status legend (only statuses present in data) */}
      {statusesInChart.length > 0 &&
        statusesInChart.slice(0, 5).map((statusLabel, idx) => (
          <G key={statusLabel}>
            <Rect
              x={padding.left + idx * 82}
              y={height - 16}
              width={10}
              height={10}
              rx={3}
              fill={CLIENT_STATUS_CHART_COLORS[statusLabel] ?? '#95A5A6'}
            />
            <SvgText
              x={padding.left + idx * 82 + 14}
              y={height - 6}
              textAnchor="start"
              fill="#636E72"
              fontSize={10.5}
              fontFamily={INSIGHTS_CHART_FONT}
            >
              {statusLabel}
            </SvgText>
          </G>
        ))}
    </Svg>
  );
}

function OrderStatusBars({ width, height, entries }: BarProps) {
  if (entries.length === 0) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={width / 2} y={height / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={INSIGHTS_CHART_FONT}>
          No data
        </SvgText>
      </Svg>
    );
  }
  const padding = { top: 20, right: 16, bottom: 28, left: 16 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(...entries.map(([, v]) => v));
  const n = entries.length;
  const colW = chartW / n;
  const barW = Math.max(18, Math.min(colW * 0.65, 44));

  return (
    <Svg width={width} height={height} style={{ overflow: 'visible' }}>
      {/* horizontal grid lines */}
      {Array.from({ length: 4 }).map((_, idx) => {
        const y = padding.top + (chartH * (idx + 1)) / 4;
        return (
          <Path
            key={`grid-${idx}`}
            d={`M ${padding.left} ${y} H ${padding.left + chartW}`}
            stroke="#E5E7EB"
            strokeWidth={1}
          />
        );
      })}
      {entries.map(([name, val], i) => {
        const colCenterX = padding.left + (i + 0.5) * colW;
        const barX = colCenterX - barW / 2;
        const barHeight = maxVal ? (val / maxVal) * chartH : 0;
        const barY = padding.top + chartH - barHeight;
        const safeName = name ?? '';
        const label = safeName; // 订单状态标签不再缩略，保持完整可读
        const color =
          ORDER_STATUS_CHART_COLORS[safeName] ??
          FIRM_CHART_COLORS[i % FIRM_CHART_COLORS.length];
        return (
          <G key={safeName || `bar-${i}`}>
            <Rect x={barX} y={barY} width={barW} height={barHeight} rx={6} fill={color} />
            <SvgText
              x={colCenterX}
              y={height - 8}
              textAnchor="middle"
              fill="#636E72"
              fontSize={10}
              fontFamily={INSIGHTS_CHART_FONT}
            >
              {label}
            </SvgText>
            <SvgText
              x={colCenterX}
              y={barY - 4}
              textAnchor="middle"
              fill="#2D3436"
              fontSize={10}
              fontFamily={INSIGHTS_CHART_FONT}
            >
              {val}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

type LineProps = {
  width: number;
  height: number;
  series: FollowUpSeries[];
};

function FollowUpLines({ width, height, series }: LineProps) {
  const { width: winW } = useWindowDimensions();
  if (series.length === 0) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={width / 2} y={height / 2} textAnchor="middle" fill="#95A5A6" fontSize={14} fontFamily={INSIGHTS_CHART_FONT}>
          No data
        </SvgText>
      </Svg>
    );
  }

  // 桌面 Web 折线图右侧可适当留白用于曲线终点；移动 Web / 原生收紧左右 padding 放大曲线区域
  const useWideChartPadding = Platform.OS === 'web' && !isMobileWebWidth(winW);
  const padding = {
    top: 16,
    right: useWideChartPadding ? 48 : 24,
    bottom: 28,
    left: useWideChartPadding ? 32 : 20,
  };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxY = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.y))
  );
  const maxX = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.x))
  );

  return (
    <Svg width={width} height={height} style={{ overflow: 'visible' }}>
      {/* X-axis */}
      <Path
        d={`M ${padding.left} ${padding.top + chartH} H ${padding.left + chartW}`}
        stroke="#E5E7EB"
        strokeWidth={1}
      />
      {/* Y-axis */}
      <Path
        d={`M ${padding.left} ${padding.top} V ${padding.top + chartH}`}
        stroke="#E5E7EB"
        strokeWidth={1}
      />
      {/* horizontal grid lines */}
      {Array.from({ length: 4 }).map((_, idx) => {
        const y = padding.top + (chartH * (idx + 1)) / 4;
        return (
          <Path
            key={`grid-${idx}`}
            d={`M ${padding.left} ${y} H ${padding.left + chartW}`}
            stroke="#F3F4F6"
            strokeWidth={1}
          />
        );
      })}
      {series.map((s, idx) => {
        const pathD = s.points
          .map((p, i) => {
            const x = padding.left + (p.x / maxX) * chartW;
            const y = padding.top + chartH - (p.y / maxY) * chartH;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
          })
          .join(' ');
        return (
          <G key={s.assignee}>
            {/* glow */}
            <Path d={pathD} stroke={s.color} strokeWidth={4} strokeOpacity={0.18} fill="none" />
            <Path d={pathD} stroke={s.color} strokeWidth={2} fill="none" />
            {s.points.map((p, i) => {
              const x = padding.left + (p.x / maxX) * chartW;
              const y = padding.top + chartH - (p.y / maxY) * chartH;
              return <Circle key={`${s.assignee}-pt-${i}`} cx={x} cy={y} r={3} fill="#FFF" stroke={s.color} strokeWidth={1.2} />;
            })}
          </G>
        );
      })}
      {/* Legend: 放在左上角，避免在 Web 上溢出卡片；字号适中便于阅读 */}
      {series.slice(0, 4).map((s, i) => (
        <G key={s.assignee}>
          <Rect
            x={padding.left + 4}
            y={padding.top + i * 16 - 8}
            width={8}
            height={8}
            rx={2}
            fill={s.color}
          />
          <SvgText
            x={padding.left + 18}
            y={padding.top + i * 16}
            textAnchor="start"
            fill="#636E72"
            fontSize={Platform.OS === 'web' ? 11 : 10}
            fontFamily={INSIGHTS_CHART_FONT}
          >
            {s.assignee.length > 14 ? `${s.assignee.slice(0, 13)}…` : s.assignee}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 24 : 16,
    paddingBottom: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#2D3436', marginLeft: 10 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 让卡片在可用空间内居中排列（无论是 2x2 网格还是单列）
    justifyContent: 'center',
    alignContent: 'flex-start',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingVertical: CARD_PADDING,
    // Web 保持左右 16，移动端取消卡片内横向 padding，让图表离卡片边更近
    paddingHorizontal: Platform.OS === 'web' ? CARD_PADDING_X_WEB : CARD_PADDING_X_MOBILE,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    // 统一较轻的卡片阴影（移动端和 Web 都不过重）
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  chartContainer: {
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
});
