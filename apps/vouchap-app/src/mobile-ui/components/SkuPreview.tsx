import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FirmSku } from '@/types';
import { fetchSkuItemsForClientPreview } from '@/lib/firm';

type Props = {
  sku?: FirmSku | null;
  /** 展示风格：默认 card；移动端全屏时用 mobile-full */
  variant?: 'card' | 'mobile-full';
  /** 可选：约束容器最大高度（如右浮窗内嵌时由父级传入），覆盖默认 560 */
  maxHeight?: number;
  /** Client invite / link flow: load sku_items via RPC (RLS blocks direct reads for non–firm members). */
  clientPreviewAuth?: { firmClientId?: string; inviteToken?: string; orderId?: string };
};

type SkuItemRow = {
  id: string;
  sku_id: string;
  parent_id?: string | null;
  item_kind: 'phase' | 'section' | 'task';
  initial_responsible_side: 'client' | 'firm';
  title: string;
  description?: string | null;
  sort_order?: number | null;
};

const TAG_PALETTE: [string, string][] = [
  ['#EDE9FD', '#6C5CE7'],
  ['#E3F2FD', '#1E88E5'],
  ['#E8F5E9', '#27AE60'],
  ['#FFF3E0', '#E67E22'],
  ['#FCE4EC', '#E91E63'],
  ['#E8EAF6', '#3F51B5'],
  ['#E0F7FA', '#00838F'],
  ['#FFF8E1', '#F9A825'],
];

function getTagColor(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xfffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length]!;
}

export default function SkuPreview({ sku, variant = 'card', maxHeight, clientPreviewAuth }: Props) {
  const [items, setItems] = useState<SkuItemRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLayoutHeight, setListLayoutHeight] = useState(0);
  const [listContentHeight, setListContentHeight] = useState(0);
  const [atScrollBottom, setAtScrollBottom] = useState(false);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const layoutHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  layoutHeightRef.current = listLayoutHeight;
  contentHeightRef.current = listContentHeight;
  const isMobileFull = variant === 'mobile-full' && Platform.OS !== 'web';
  const containerHeightStyle =
    maxHeight != null ? { minHeight: 0 as number, maxHeight } : undefined;
  const canScroll = listLayoutHeight > 0 && listContentHeight > listLayoutHeight + 2;
  const showScrollHint = canScroll && !atScrollBottom;

  useEffect(() => {
    let cancelled = false;
    if (!sku?.id) {
      setItems(null);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const rows = await fetchSkuItemsForClientPreview(sku.id, {
          firmClientId: clientPreviewAuth?.firmClientId,
          inviteToken: clientPreviewAuth?.inviteToken,
          orderId: clientPreviewAuth?.orderId,
        });
        if (!cancelled) setItems(rows as SkuItemRow[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sku?.id, clientPreviewAuth?.firmClientId, clientPreviewAuth?.inviteToken, clientPreviewAuth?.orderId]);

  useEffect(() => {
    if (loading || !items || items.length === 0) {
      setListLayoutHeight(0);
      setListContentHeight(0);
      setAtScrollBottom(false);
    }
  }, [loading, items]);

  useEffect(() => {
    if (!showScrollHint) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: 5,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showScrollHint, bounceAnim]);

  const hasImage = !!sku?.imageUrl;
  const description = sku?.description || '';
  const name = sku?.name ?? '—';
  const taxCountry = sku?.taxCountry || '';
  const taxScenario = sku?.taxScenario || '';
  const hasTags = !!taxCountry || !!taxScenario;
  const isWeb = Platform.OS === 'web';

  if (!sku) {
    return (
      <View
        style={[
          isMobileFull ? [styles.container, styles.containerMobileFull] : styles.container,
          containerHeightStyle,
        ]}
      >
        <Text style={styles.emptyTitle}>No service template selected</Text>
        <Text style={styles.emptyDesc}>
          Choose a template on the left to preview its cover, description, and key tasks.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        isMobileFull ? [styles.container, styles.containerMobileFull] : styles.container,
        containerHeightStyle,
        isWeb && !isMobileFull && styles.containerWeb,
      ]}
    >
      <View style={styles.headerRow}>
        {hasImage && (
          <Image source={{ uri: sku.imageUrl as string }} style={styles.cover} resizeMode="cover" />
        )}
        <View style={styles.headerText}>
          <Text numberOfLines={2} style={styles.title}>
            {name}
          </Text>
          {hasTags && (
            <View style={styles.tagRow}>
              {taxCountry
                ? (() => {
                    const [bg, fg] = getTagColor(taxCountry);
                    return (
                      <View style={[styles.valueTagPill, { backgroundColor: bg }]}>
                        <Text style={[styles.valueTagText, { color: fg }]}>{taxCountry}</Text>
                      </View>
                    );
                  })()
                : null}
              {taxScenario
                ? (() => {
                    const [bg, fg] = getTagColor(taxScenario);
                    return (
                      <View style={[styles.valueTagPill, { backgroundColor: bg }]}>
                        <Text style={[styles.valueTagText, { color: fg }]}>{taxScenario}</Text>
                      </View>
                    );
                  })()
                : null}
            </View>
          )}
          {description ? (
            <Text numberOfLines={3} style={styles.description}>
              {description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.todoStub, isWeb && styles.todoStubWeb]}>
        <Text style={styles.todoStubTitle}>Documents list</Text>
        {loading && (
          <View style={styles.todoLoadingRow}>
            <ActivityIndicator size="small" color="#6C5CE7" />
            <Text style={styles.todoLoadingText}>Loading tasks…</Text>
          </View>
        )}
        {!loading && (!items || items.length === 0) && (
          <Text style={styles.todoStubText}>No template tasks configured yet.</Text>
        )}
        {!loading && items && items.length > 0 && (
          <View style={styles.todoListWrapper}>
            <ScrollView
              style={[styles.todoList, isWeb && styles.todoListWeb]}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
              onLayout={(e) => setListLayoutHeight(e.nativeEvent.layout.height)}
              onContentSizeChange={(_, h) => setListContentHeight(h)}
              onScroll={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                const layoutH = layoutHeightRef.current;
                const contentH = contentHeightRef.current;
                const atBottom = layoutH > 0 && contentH > 0 && y + layoutH >= contentH - 10;
                setAtScrollBottom(atBottom);
              }}
              scrollEventThrottle={32}
            >
              {buildCompactWbs(items).map((row) => {
              const isPhase = row.level === 2;
              const isSection = row.level === 3;
              const isTask = row.level === 4;
              const indent = isPhase ? 0 : isSection ? 8 : 16;

              return (
                <View key={row.id} style={[styles.todoRow, { paddingLeft: indent }]}>
                  <Text
                    style={[
                      styles.todoCode,
                      isPhase && styles.todoCodePhase,
                      isSection && styles.todoCodeSection,
                    ]}
                  >
                    {row.code}
                  </Text>

                  {isTask ? (
                    <>
                      <Text
                        style={[
                          styles.todoSide,
                          row.responsibleSide === 'client' ? styles.todoSideClient : styles.todoSideFirm,
                        ]}
                      >
                        {row.responsibleSide === 'client' ? 'Client' : 'Firm'}
                      </Text>
                      <Text style={styles.todoTitle} numberOfLines={1}>
                        {row.title}
                      </Text>
                    </>
                  ) : (
                    // phase / section：不显示责任方，让名称紧跟在编号后面
                    <Text
                      style={[
                        styles.todoTitle,
                        isPhase && styles.todoTitlePhase,
                        isSection && styles.todoTitleSection,
                      ]}
                      numberOfLines={1}
                    >
                      {row.title}
                    </Text>
                  )}
                </View>
              );
            })}
            </ScrollView>
            {showScrollHint && (
              <View style={styles.scrollHintOverlay} pointerEvents="none">
                <Animated.View
                  style={[
                    styles.scrollHintIcon,
                    { transform: [{ translateY: bounceAnim }] },
                  ]}
                >
                  <Ionicons name="chevron-down" size={24} color="#6C5CE7" />
                </Animated.View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E4F0',
    backgroundColor: '#FDFBFF',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 6,
    justifyContent: 'flex-start',
    minHeight: 560,
    maxHeight: 560,
  },
  /** Web: 固定高度，保证内部 flex 列表区能正确计算高度并滚动 */
  containerWeb: {
    height: 560,
    minHeight: 0,
  },
  containerMobileFull: {
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 24,
    minHeight: undefined,
    maxHeight: undefined,
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  cover: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginRight: 8,
    marginTop: 0,
    marginBottom: 4,
    backgroundColor: '#E5E7EB',
  },
  headerText: {
    flex: 1,
    justifyContent: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    marginBottom: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 1,
  },
  description: {
    fontSize: 12,
    color: '#636E72',
    lineHeight: 17,
    marginBottom: 4,
  },
  descriptionMuted: {
    fontSize: 13,
    color: '#B2BEC3',
    fontStyle: 'italic',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#B2BEC3',
    lineHeight: 18,
  },
  todoStub: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EAECEF',
    flex: 1,
  },
  todoStubWeb: {
    minHeight: 0,
  },
  todoStubTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 2,
  },
  todoStubText: {
    fontSize: 12,
    color: '#A0A4A8',
    lineHeight: 16,
  },
  todoLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  todoLoadingText: {
    fontSize: 12,
    color: '#A0A4A8',
    marginLeft: 6,
  },
  todoListWrapper: {
    flex: 1,
    position: 'relative',
    marginTop: 4,
  },
  todoList: {
    flex: 1,
  },
  /** Web: 列表区参与 flex 并保证可滚动 */
  todoListWeb: {
    minHeight: 0,
  },
  scrollHintOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollHintIcon: {},
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    borderTopWidth: 0.5,
    borderTopColor: '#ECEFF4',
    paddingTop: 2,
  },
  todoCode: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#636E72',
    minWidth: 28,
  },
  todoCodePhase: {
    fontWeight: '600',
  },
  todoCodeSection: {
    fontWeight: '500',
  },
  todoSide: {
    fontSize: 10,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    overflow: 'hidden',
  },
  todoSideClient: {
    backgroundColor: '#E3F2FD',
    color: '#1565C0',
  },
  todoSideFirm: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
  },
  todoSidePlaceholder: {
    width: 40,
    marginRight: 6,
  },
  todoTitle: {
    flex: 1,
    fontSize: 11,
    color: '#2D3436',
  },
  todoTitlePhase: {
    fontWeight: '600',
  },
  todoTitleSection: {
    fontWeight: '500',
  },
  valueTagPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  valueTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

// 将 sku_items 构造成紧凑 WBS 展示：phase / section / task，带编号 + 责任方 + 名称
type CompactRow = {
  id: string;
  code: string;
  level: 2 | 3 | 4;
  responsibleSide: 'client' | 'firm';
  title: string;
};

function buildCompactWbs(items: SkuItemRow[]): CompactRow[] {
  const phases = items.filter((i) => i.item_kind === 'phase').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const sections = items.filter((i) => i.item_kind === 'section').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const tasks = items.filter((i) => i.item_kind === 'task').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const byParent: Record<string, SkuItemRow[]> = {};
  [...sections, ...tasks].forEach((i) => {
    const pid = i.parent_id ?? '';
    if (!byParent[pid]) byParent[pid] = [];
    byParent[pid].push(i);
  });

  const rows: CompactRow[] = [];

  phases.forEach((phase, pi) => {
    const phaseCode = `${pi + 1}`;
    rows.push({
      id: phase.id,
      code: phaseCode,
      level: 2,
      responsibleSide: phase.initial_responsible_side,
      title: phase.title,
    });

    const children = (byParent[phase.id] || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    let sectionIndex = 0;
    children.forEach((child) => {
      if (child.item_kind === 'section') {
        sectionIndex += 1;
        const sectionCode = `${phaseCode}.${sectionIndex}`;
        rows.push({
          id: child.id,
          code: sectionCode,
          level: 3,
          responsibleSide: child.initial_responsible_side,
          title: child.title,
        });

        const sectionChildren = (byParent[child.id] || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        let taskIndex = 0;
        sectionChildren.forEach((t) => {
          if (t.item_kind !== 'task') return;
          taskIndex += 1;
          rows.push({
            id: t.id,
            code: `${sectionCode}.${taskIndex}`,
            level: 4,
            responsibleSide: t.initial_responsible_side,
            title: t.title,
          });
        });
      } else if (child.item_kind === 'task') {
        const existing = rows.filter((r) => r.level === 4 && r.code.startsWith(`${phaseCode}.`)).length;
        const taskIndex = existing + 1;
        rows.push({
          id: child.id,
          code: `${phaseCode}.${taskIndex}`,
          level: 4,
          responsibleSide: child.initial_responsible_side,
          title: child.title,
        });
      }
    });
  });

  return rows;
}

