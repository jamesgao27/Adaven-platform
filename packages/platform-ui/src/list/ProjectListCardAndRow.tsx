/**
 * 项目/服务列表 — 卡片与列表行（client 项目列表与 firm Service Catalog 完全复用）
 * 样式与交互一致；仅数据与行动按钮文案不同（如 Accept and start / 发布）。
 */
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

export const GRID_GAP = 16;
export const LIST_ROW_MIN_HEIGHT = 92;
export const LIST_STATUS_WRAP_WIDTH = 92;
export const ACTION_ROW_HEIGHT = 40;
const CORNER_PIN_ORANGE = '#ff7711';
const CORNER_FAVORITE_AMBER = '#F9A825';
const CORNER_PIN_WHITE_TRANSPARENT = 'rgba(255,255,255,0.88)';
export const LIST_ACTION_GRAY = '#636E72';

export interface ProjectListCardItem {
  id: string;
  displayName: string;
  imageUrl: string | null;
  /** 可选左侧 tag（如税季年份） */
  tagPill?: { label: string; color: string } | null;
  statusLabel: string;
  /** 状态标签背景色 */
  statusColor: string;
  /** 可选：状态标签前景色（文字颜色），不传则使用组件默认值 */
  statusFgColor?: string;
  /** 已取消/拒绝等需视觉弱化置灰 */
  isMuted?: boolean;
  /** 可选左上角状态角标（如 Draft/Private/Published 的首字母） */
  statusCorner?: { label: string; bg: string } | null;
  /** 为 true 时不展示状态角标与状态 pill（如 client Service Marketplace） */
  hideStatusBadge?: boolean;
  footerText?: string | null;
  /** 可选分类标签（如 Jurisdiction / Scenario），用于 SKU Service Template 卡片与列表行 */
  classificationTags?: { label: string; bg: string; fg: string }[] | null;
  /** 有则显示进度条（非 action 时） */
  progress?: { completed: number; total: number } | null;
  /** 非 action 且无数值进度时，显示在进度区域的状态文案（如 Awaiting firm confirmation）。 */
  progressLabel?: string | null;
  /** 有则显示底部/右侧行动按钮；onReject 有则左侧显示方形 reject 图标按钮 */
  action?: {
    label: string;
    onPress: () => void;
    confirming: boolean;
    onReject?: () => void;
    rejecting?: boolean;
  } | null;
  /** When set, used for the trailing settings/edit icon instead of create / trash from `isMuted`. */
  settingsIconOverride?: ComponentProps<typeof Ionicons>['name'];
}

export function PinToTopIcon({ size = 24, color = '#ff7711' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 6h14M12 20V10M12 10l-4 4M12 10l4 4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IndeterminateProgressBar() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 260] });
  return (
    <View style={s.indeterminateTrack} pointerEvents="none">
      <Animated.View style={[s.indeterminateFill, { transform: [{ translateX }] }]} />
    </View>
  );
}

export function ProjectListCard({
  item,
  onPress,
  onSettings,
  isPinned,
  onTogglePin,
  cardWidth,
  pinAppearance = 'pin',
}: {
  item: ProjectListCardItem;
  onPress: () => void;
  onSettings?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  cardWidth?: number;
  /** `favorite`：星标收藏（Service Marketplace）；默认图钉置顶（Tax Filing engagements） */
  pinAppearance?: 'pin' | 'favorite';
}) {
  const [hover, setHover] = useState(false);
  const showEdit = Platform.OS === 'web' ? hover : true;
  const progress = item.progress && item.progress.total > 0
    ? Math.round((item.progress.completed / item.progress.total) * 100)
    : 0;
  const showProgress = !item.action && item.progress && item.progress.total > 0;
  const showProgressLabel = !item.action && !showProgress && !!item.progressLabel;
  const canLongPressPin = Platform.OS !== 'web' && onTogglePin != null && !item.isMuted;

  return (
    <View
      style={[s.cardWrap, cardWidth != null && { width: cardWidth }]}
      {...(Platform.OS === 'web'
        ? ({
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
          } as any)
        : {})}
    >
      <TouchableOpacity
        style={[s.card, hover && s.cardHover, item.isMuted && s.cardMuted]}
        onPress={onPress}
        onLongPress={canLongPressPin ? () => { onTogglePin(); } : undefined}
        delayLongPress={380}
        activeOpacity={0.85}
        accessibilityHint={
          canLongPressPin
            ? pinAppearance === 'favorite'
              ? 'Long press to add or remove from favorites'
              : 'Long press to pin or unpin this item'
            : undefined
        }
      >
        <View style={s.cardCoverWrap}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={s.cardCoverImg} resizeMode="cover" />
          ) : (
            <View style={s.cardCoverPlaceholder}>
              <Ionicons name="document-text-outline" size={32} color="#B2BEC3" />
            </View>
          )}
          {item.statusCorner && !item.hideStatusBadge && (
            <View style={s.statusCornerWrap} pointerEvents="none">
              <View style={[s.statusCornerTriangle, { backgroundColor: item.statusCorner.bg }]} />
              <View style={s.statusCornerLabelWrap}>
                <Text style={s.statusCornerLabel}>{item.statusCorner.label}</Text>
              </View>
            </View>
          )}
          {onTogglePin != null && !item.isMuted && (isPinned || hover) && (
            <View style={s.cornerPinWrap} pointerEvents="box-none">
              <View
                style={[
                  s.cornerPinTriangle,
                  {
                    backgroundColor: isPinned
                      ? pinAppearance === 'favorite'
                        ? CORNER_FAVORITE_AMBER
                        : CORNER_PIN_ORANGE
                      : CORNER_PIN_WHITE_TRANSPARENT,
                  },
                ]}
                pointerEvents="none"
              />
              <TouchableOpacity
                style={s.cornerPinTouchable}
                onPress={(e) => { e.stopPropagation(); onTogglePin(); }}
                hitSlop={0}
                activeOpacity={0.85}
                accessibilityLabel={pinAppearance === 'favorite' ? (isPinned ? 'Remove from favorites' : 'Add to favorites') : undefined}
              >
                {pinAppearance === 'favorite' ? (
                  <Ionicons
                    name={isPinned ? 'star' : 'star-outline'}
                    size={28}
                    color={isPinned ? '#FFF' : CORNER_FAVORITE_AMBER}
                  />
                ) : (
                  <PinToTopIcon size={28} color={isPinned ? '#FFF' : CORNER_PIN_ORANGE} />
                )}
              </TouchableOpacity>
            </View>
          )}
          {onSettings != null && showEdit && (
            <View style={s.cardEditCornerWrap} pointerEvents="box-none">
              <View style={[s.cardEditCornerTriangle, { backgroundColor: CORNER_PIN_WHITE_TRANSPARENT }]} pointerEvents="none" />
              <TouchableOpacity
                style={s.cardEditCornerTouchable}
                onPress={(e) => {
                  e.stopPropagation();
                  onSettings();
                }}
                hitSlop={0}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={
                    item.settingsIconOverride
                      ? item.settingsIconOverride
                      : item.isMuted
                        ? 'trash-outline'
                        : 'create-outline'
                  }
                  size={22}
                  color={item.settingsIconOverride ? LIST_ACTION_GRAY : CORNER_PIN_ORANGE}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={s.cardInfo}>
          <View style={s.cardRowTitle}>
            <Text style={s.cardTitle} numberOfLines={2} ellipsizeMode="tail">
              {item.displayName}
            </Text>
          </View>
          <View style={s.cardRowTagRow}>
            {item.tagPill ? (
              <View style={s.taxSeasonPill}>
                <Text
                  style={[
                    s.taxSeasonPillText,
                    { color: item.tagPill.color },
                  ]}
                >
                  {item.tagPill.label}
                </Text>
              </View>
            ) : (
              <View />
            )}
            {!item.statusCorner && !item.hideStatusBadge && (
              <View style={[
                s.statusPill,
                { backgroundColor: item.statusColor },
              ]}>
                <Text
                  style={[
                    s.statusPillText,
                    item.statusFgColor ? { color: item.statusFgColor } : null,
                  ]}
                >
                  {item.statusLabel}
                </Text>
              </View>
            )}
          </View>
          {item.classificationTags && item.classificationTags.length > 0 ? (
            <View style={s.classificationRow}>
              {item.classificationTags.map((tag) => (
                <View key={tag.label} style={[s.classificationPill, { backgroundColor: tag.bg }]}>
                  <Text style={[s.classificationPillText, { color: tag.fg }]}>{tag.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.classificationRowPlaceholder} />
          )}
          {item.footerText ? (
            <View
              style={[
                s.cardRowFooter,
                item.hideStatusBadge ? s.cardRowFooterMarketplaceFirm : null,
              ]}
            >
              <Text style={s.cardFirmName} numberOfLines={1} ellipsizeMode="tail">{item.footerText}</Text>
            </View>
          ) : null}
          {showProgress && item.progress && (
            <View style={s.cardRowProgress}>
              <View style={s.progressBarTrack}>
                <View style={[s.progressBarFill, { width: `${progress}%` }]} />
              </View>
              <Text style={s.progressTextRight}>
                {item.progress.completed}/{item.progress.total} · {progress}%
              </Text>
            </View>
          )}
          {showProgressLabel ? (
            <View style={s.cardRowProgressCentered}>
              <View style={s.progressLabelPill}>
                <Text style={s.progressLabelPillText}>{item.progressLabel}</Text>
              </View>
            </View>
          ) : null}
        </View>
        {(item.action || item.isMuted) && (
          <View style={s.acceptBtnWrap}>
            {item.action ? (
              (item.action.confirming || item.action.rejecting) && !item.action.onReject ? (
                <View style={s.acceptBtnProgress}>
                  <IndeterminateProgressBar />
                </View>
              ) : item.action.confirming || item.action.rejecting ? (
                <View style={s.acceptBtnRow}>
                  <TouchableOpacity
                    style={s.rejectIconBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      item.action!.onReject!();
                    }}
                    disabled
                    activeOpacity={0.8}
                  >
                    {item.action.rejecting ? (
                      <Ionicons name="hourglass-outline" size={20} color="#C0392B" />
                    ) : (
                      <Ionicons name="close-circle-outline" size={22} color="#C0392B" />
                    )}
                  </TouchableOpacity>
                  <View style={s.acceptBtnProgress}>
                    <IndeterminateProgressBar />
                  </View>
                </View>
              ) : item.action.onReject ? (
                <View style={s.acceptBtnRow}>
                  <TouchableOpacity
                    style={s.rejectIconBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      item.action!.onReject!();
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close-circle-outline" size={22} color="#C0392B" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.acceptBtn, s.acceptBtnWithReject]}
                    onPress={(e) => {
                      e.stopPropagation();
                      item.action!.onPress();
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={s.acceptBtnText}>{item.action.label}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.acceptBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    item.action!.onPress();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={s.acceptBtnText}>{item.action.label}</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

export function ProjectListRow({
  item,
  onPress,
  onSettings,
  isPinned,
  onTogglePin,
  pinAppearance = 'pin',
  /** Native: place edit at row end (e.g. firm Service Templates). Web always uses trailing edit. */
  listEditTrailing = false,
}: {
  item: ProjectListCardItem;
  onPress: () => void;
  onSettings?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  pinAppearance?: 'pin' | 'favorite';
  listEditTrailing?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const showEdit = Platform.OS === 'web' ? hover : true;
  const progress = item.progress && item.progress.total > 0
    ? Math.round((item.progress.completed / item.progress.total) * 100)
    : 0;
  const hasRightContent = !!item.action || (!!item.progress && item.progress.total > 0) || !!item.progressLabel;
  /** Status pill slot is empty when corner badge or client Marketplace hides badge — don't reserve 92px. */
  const showListStatusPill = !item.statusCorner && !item.hideStatusBadge;

  const listEditControl =
    onSettings != null ? (
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          onSettings();
        }}
        hitSlop={6}
        activeOpacity={0.8}
        style={s.listActionBtn}
        {...(Platform.OS === 'web'
          ? {
              accessibilityElementsHidden: !showEdit,
              importantForAccessibility: showEdit ? 'yes' : 'no-hide-descendants',
            }
          : {})}
      >
        <Ionicons
          name={
            item.settingsIconOverride
              ? item.settingsIconOverride
              : item.isMuted
                ? 'trash-outline'
                : 'create-outline'
          }
          size={18}
          color={item.settingsIconOverride ? LIST_ACTION_GRAY : CORNER_PIN_ORANGE}
        />
      </TouchableOpacity>
    ) : null;

  const showTrailingListEdit =
    listEditControl != null && (Platform.OS === 'web' || listEditTrailing);
  const showLeadingMobileEdit =
    listEditControl != null && Platform.OS !== 'web' && !listEditTrailing;

  const canLongPressPin = Platform.OS !== 'web' && onTogglePin != null && !item.isMuted;

  return (
    <View
      style={s.listRowWrap}
      {...(Platform.OS === 'web'
        ? ({
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
          } as any)
        : {})}
    >
      <TouchableOpacity
        style={[s.listRow, item.isMuted && s.listRowMuted]}
        onPress={onPress}
        onLongPress={canLongPressPin ? () => { onTogglePin!(); } : undefined}
        delayLongPress={380}
        activeOpacity={0.7}
        accessibilityHint={
          canLongPressPin
            ? pinAppearance === 'favorite'
              ? 'Long press to add or remove from favorites'
              : 'Long press to pin or unpin this item'
            : undefined
        }
      >
        {onTogglePin != null && !item.isMuted && (isPinned || hover) && (
          <View style={s.listRowCornerPinWrap} pointerEvents="box-none">
            <View
              style={[
                s.listRowCornerPinTriangle,
                {
                  backgroundColor: isPinned
                    ? pinAppearance === 'favorite'
                      ? CORNER_FAVORITE_AMBER
                      : CORNER_PIN_ORANGE
                    : CORNER_PIN_WHITE_TRANSPARENT,
                },
              ]}
              pointerEvents="none"
            />
            <TouchableOpacity
              style={s.listRowCornerPinTouchable}
              onPress={(e) => { e.stopPropagation(); onTogglePin(); }}
              hitSlop={0}
              activeOpacity={0.85}
              accessibilityLabel={pinAppearance === 'favorite' ? (isPinned ? 'Remove from favorites' : 'Add to favorites') : undefined}
            >
              {pinAppearance === 'favorite' ? (
                <Ionicons
                  name={isPinned ? 'star' : 'star-outline'}
                  size={18}
                  color={isPinned ? '#FFF' : CORNER_FAVORITE_AMBER}
                />
              ) : (
                <PinToTopIcon size={18} color={isPinned ? '#FFF' : CORNER_PIN_ORANGE} />
              )}
            </TouchableOpacity>
          </View>
        )}
        {showLeadingMobileEdit ? (
          <View style={s.listEditWrapLeft}>{listEditControl}</View>
        ) : null}
        {item.statusCorner && !item.hideStatusBadge ? (
          <View style={s.listRowCornerPinWrap} pointerEvents="none">
            <View style={[s.listRowCornerPinTriangle, { backgroundColor: item.statusCorner.bg }]} />
            <View style={s.listRowCornerStatusLabelWrap}>
              <Text style={s.listStatusCornerLabel}>{item.statusCorner.label}</Text>
            </View>
          </View>
        ) : null}
        <View style={s.listCoverWrap}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={s.listCoverImg} resizeMode="cover" />
          ) : (
            <View style={s.listCoverPlaceholder}>
              <Ionicons name="document-text-outline" size={24} color="#B2BEC3" />
            </View>
          )}
        </View>
        <View style={s.listBody}>
          <View style={s.listRow1}>
            {item.tagPill ? (
              <View style={[s.listTaxPill, { backgroundColor: item.tagPill.color }]}>
                <Text style={s.listTaxPillText}>{item.tagPill.label}</Text>
              </View>
            ) : null}
            <View style={s.listTitleWrap}>
              <Text style={s.listTitle} numberOfLines={1} ellipsizeMode="tail">
                {item.displayName}
              </Text>
            </View>
          </View>
          {item.classificationTags && item.classificationTags.length > 0 ? (
            <View style={s.listClassificationRow}>
              {item.classificationTags.map((tag) => (
                <View key={tag.label} style={[s.listClassificationPill, { backgroundColor: tag.bg }]}>
                  <Text style={[s.listClassificationPillText, { color: tag.fg }]}>{tag.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.listClassificationRowPlaceholder} />
          )}
          <View style={s.listRow2}>
            {showListStatusPill ? (
              <View style={s.listStatusWrap}>
                <View style={[s.listStatusPill, { backgroundColor: item.statusColor }]}>
                  <Text
                    style={[
                      s.listStatusPillText,
                      item.statusFgColor ? { color: item.statusFgColor } : null,
                    ]}
                  >
                    {item.statusLabel}
                  </Text>
                </View>
              </View>
            ) : null}
            {item.footerText ? (
              <Text style={s.listFirmName} numberOfLines={1} ellipsizeMode="tail">
                {item.footerText}
              </Text>
            ) : null}
          </View>
        </View>
        {hasRightContent ? (
          <View style={s.listRightSlot}>
            {item.action ? (
              (item.action.confirming || item.action.rejecting) && !item.action.onReject ? (
                <View style={s.listAcceptProgress}>
                  <IndeterminateProgressBar />
                </View>
              ) : item.action.confirming || item.action.rejecting ? (
                <View style={s.listActionRow}>
                  <TouchableOpacity
                    style={s.listRejectBtn}
                    onPress={(e) => { e.stopPropagation(); item.action!.onReject!(); }}
                    disabled
                    activeOpacity={0.8}
                  >
                    {item.action.rejecting ? (
                      <Ionicons name="hourglass-outline" size={18} color="#C0392B" />
                    ) : (
                      <Text style={s.listRejectBtnText}>Reject</Text>
                    )}
                  </TouchableOpacity>
                  <View style={s.listAcceptProgress}>
                    <IndeterminateProgressBar />
                  </View>
                </View>
              ) : item.action.onReject ? (
                <View style={s.listActionRow}>
                  <TouchableOpacity
                    style={s.listRejectBtn}
                    onPress={(e) => { e.stopPropagation(); item.action!.onReject!(); }}
                    activeOpacity={0.8}
                  >
                    <Text style={s.listRejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.listAcceptBtn}
                    onPress={(e) => { e.stopPropagation(); item.action!.onPress(); }}
                    activeOpacity={0.8}
                  >
                    <Text style={s.acceptBtnText}>{item.action.label}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.listAcceptBtn}
                  onPress={(e) => { e.stopPropagation(); item.action!.onPress(); }}
                  activeOpacity={0.8}
                >
                  <Text style={s.acceptBtnText}>{item.action.label}</Text>
                </TouchableOpacity>
              )
            ) : item.progress && item.progress.total > 0 ? (
              <View style={s.listProgressBlock}>
                <View style={s.listProgressTrack}>
                  <View style={[s.progressBarFill, { width: `${progress}%` }]} />
                </View>
                <Text style={s.listProgressText}>
                  {item.progress.completed}/{item.progress.total} · {progress}%
                </Text>
              </View>
            ) : item.progressLabel ? (
              <View style={[s.listProgressBlock, s.listProgressBlockCentered]}>
                <View style={s.progressLabelPill}>
                  <Text style={s.progressLabelPillText}>{item.progressLabel}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {showTrailingListEdit ? (
          <View style={s.listEditWrapRight}>
            {Platform.OS === 'web' ? (
              <View
                style={!showEdit ? s.listEditBtnHiddenWeb : undefined}
                pointerEvents={showEdit ? 'auto' : 'none'}
              >
                {listEditControl}
              </View>
            ) : (
              listEditControl
            )}
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  cardWrap: { width: '100%', maxWidth: 320 },
  card: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardHover: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    ...(Platform.OS === 'android' ? { elevation: 8 } : {}),
  },
  cardMuted: { opacity: 0.6 },
  cardCoverWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#E9ECEF', overflow: 'hidden', position: 'relative' },
  cardCoverImg: { width: '100%', height: '100%' },
  cardCoverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  statusCornerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 132,
    height: 132,
    overflow: 'hidden',
  },
  statusCornerTriangle: {
    position: 'absolute',
    top: -66,
    left: -66,
    width: 132,
    height: 132,
    transform: [{ rotate: '-45deg' }],
  },
  statusCornerLabelWrap: {
    position: 'absolute',
    top: 24,
    left: -6,
    width: 80,
    minHeight: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transform: [{ rotate: '-45deg' }],
  },
  statusCornerLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  cornerPinWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 132,
    height: 132,
    overflow: 'hidden',
  },
  cornerPinTriangle: {
    position: 'absolute',
    top: -66,
    left: -66,
    width: 132,
    height: 132,
    transform: [{ rotate: '-45deg' }],
  },
  cornerPinIconWrap: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerPinTouchable: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEditCornerWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 132,
    height: 132,
    overflow: 'hidden',
  },
  cardEditCornerTriangle: {
    position: 'absolute',
    top: -66,
    left: 66,
    width: 132,
    height: 132,
    transform: [{ rotate: '45deg' }],
  },
  cardEditCornerIconWrap: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEditCornerTouchable: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { padding: 12 },
  cardRowTitle: { marginBottom: 6, minHeight: 40, overflow: 'hidden' },
  cardRowTagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#2D3436', lineHeight: 20 },
  // 税季标签：浅底色 + 深字色（color 由调用方传入）
  taxSeasonPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F3F4FF',
  },
  taxSeasonPillText: { fontSize: 12, color: '#2D3436', fontWeight: '600' },
  cardRowProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 0,
    minHeight: ACTION_ROW_HEIGHT,
  },
  cardRowProgressCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 0,
    minHeight: ACTION_ROW_HEIGHT,
  },
  progressBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E9ECEF', overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#00B894', borderRadius: 3 },
  progressTextRight: { fontSize: 12, color: '#636E72', marginLeft: 4 },
  progressLabelPill: {
    backgroundColor: '#E9ECEF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  progressLabelPillText: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '600',
    textAlign: 'center',
  },
  classificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 20,
    marginTop: 2,
  },
  classificationRowPlaceholder: { minHeight: 0, marginTop: 2 },
  classificationPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  classificationPillText: { fontSize: 11, fontWeight: '500' },
  cardRowFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 0 },
  /** Client Service Marketplace card: extra space above “By …” firm line. */
  cardRowFooterMarketplaceFirm: { marginTop: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  // 默认白字；若需要浅底深字，由调用方通过 item.statusFgColor 覆盖
  statusPillText: { fontSize: 12, color: '#FFF', fontWeight: '600' },
  cardFirmName: { fontSize: 11, color: '#95A5A6', textAlign: 'right' },
  acceptBtnWrap: {
    height: ACTION_ROW_HEIGHT,
    marginTop: 0,
    marginHorizontal: 12,
    marginBottom: 12,
    justifyContent: 'center',
  },
  acceptBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: ACTION_ROW_HEIGHT,
  },
  /** 卡片模式 Reject 图标按钮：规范次按钮 + 阴影 */
  rejectIconBtn: {
    width: ACTION_ROW_HEIGHT,
    height: ACTION_ROW_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  acceptBtn: {
    height: ACTION_ROW_HEIGHT,
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? { shadowColor: '#6C5CE7', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  acceptBtnWithReject: { flex: 1, minWidth: 0 },
  acceptBtnProgress: { flex: 1, height: ACTION_ROW_HEIGHT, justifyContent: 'center', paddingHorizontal: 12, minWidth: 0 },
  acceptBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  indeterminateTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E9ECEF',
    overflow: 'hidden',
    width: '100%',
  },
  indeterminateFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#00B894',
    borderRadius: 2,
  },
  /**
   * Wrap `list` for a single outer edge (e.g. Service Catalog). Do not stack with another bordered wrapper.
   * Web: hairline border; native: 1px. Color matches client Engagements list chrome.
   */
  listChromeWrap: {
    borderRadius: 12,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: Platform.OS === 'web' ? StyleSheet.hairlineWidth : 1,
  },
  /** Grouped row gutters only — border belongs on `listChromeWrap` or screen `listWrapper`, not here. */
  list: {
    gap: 1,
    backgroundColor: '#E9ECEF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  listRowWrap: { width: '100%' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: LIST_ROW_MIN_HEIGHT,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFF',
    position: 'relative',
  },
  listRowMuted: { opacity: 0.6 },
  /** Mobile: edit to the left of the thumbnail; spacing matches row padding (see listCoverWrap). */
  listEditWrapLeft: {
    width: 28,
    minWidth: 28,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingRight: 6,
  },
  /** Web: edit at row end; pin/favorite overlay stays top-left. */
  listEditWrapRight: {
    width: 28,
    minWidth: 28,
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginLeft: 8,
  },
  listActionBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  /** Web: invisible hit target placeholder while row not hovered — slot width stays fixed. */
  listEditBtnHiddenWeb: { opacity: 0 },
  listCoverWrap: {
    width: 64,
    height: 64,
    marginLeft: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E9ECEF',
    position: 'relative',
  },
  listCoverImg: { width: '100%', height: '100%' },
  listCoverPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  listStatusCornerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 80,
    height: 80,
    overflow: 'hidden',
  },
  listStatusCornerTriangle: {
    position: 'absolute',
    top: -40,
    left: -40,
    width: 80,
    height: 80,
    transform: [{ rotate: '-45deg' }],
  },
  listStatusCornerLabelWrap: {
    position: 'absolute',
    top: 7,
    left: -14,
    width: 56,
    minHeight: 14,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-45deg' }],
  },
  /** List row corner ribbon only (Draft/Private/Published); Android needs tighter metrics than iOS/Web. */
  listStatusCornerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFF',
    textAlign: 'center',
    lineHeight: 12,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  listRowCornerPinWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 72,
    height: 72,
    overflow: 'hidden',
    zIndex: 1,
  },
  listRowCornerPinTriangle: {
    position: 'absolute',
    top: -36,
    left: -36,
    width: 72,
    height: 72,
    transform: [{ rotate: '-45deg' }],
  },
  listRowCornerPinIconWrap: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRowCornerPinTouchable: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRowCornerStatusLabelWrap: {
    position: 'absolute',
    top: 12,
    left: -12,
    width: 68,
    minHeight: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-45deg' }],
  },
  listBody: { flex: 1, marginLeft: 12, minWidth: 0, justifyContent: 'center', paddingVertical: 0 },
  listRow1: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listClassificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 12,
    marginBottom: 8,
  },
  listClassificationRowPlaceholder: { minHeight: 0, marginBottom: 8 },
  listClassificationPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  listClassificationPillText: { fontSize: 10, fontWeight: '500' },
  listRow2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listTaxPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  listTaxPillText: { fontSize: 12, color: '#FFF', fontWeight: '600' },
  listTitleWrap: { flex: 1, minWidth: 0, overflow: 'hidden' },
  listTitle: { fontSize: 15, fontWeight: '600', color: '#2D3436', lineHeight: 18 },
  listStatusWrap: { width: LIST_STATUS_WRAP_WIDTH, minWidth: LIST_STATUS_WRAP_WIDTH },
  listStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  listStatusPillText: { fontSize: 12, color: '#FFF', fontWeight: '600' },
  listFirmName: { fontSize: 12, color: '#95A5A6', flex: 1, minWidth: 0 },
  listRightSlot: {
    width: '40%',
    minWidth: 120,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listProgressBlock: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listProgressBlockCentered: {
    justifyContent: 'center',
  },
  listProgressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E9ECEF', overflow: 'hidden' },
  listProgressText: { fontSize: 12, color: '#636E72' },
  listActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  listRejectIconBtn: {
    width: ACTION_ROW_HEIGHT,
    height: ACTION_ROW_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 列表模式：完整 Reject 次按钮（与详情页顶栏一致）+ 阴影 */
  listRejectBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: ACTION_ROW_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' || Platform.OS === 'ios'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 2 } : {}),
  },
  listRejectBtnText: { color: '#C0392B', fontWeight: '600', fontSize: 15 },
  listAcceptBtn: {
    flex: 1,
    minWidth: 0,
    maxWidth: 200,
    height: ACTION_ROW_HEIGHT,
    paddingHorizontal: 12,
    backgroundColor: '#6C5CE7',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? { shadowColor: '#6C5CE7', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 }
      : {}),
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  listAcceptProgress: {
    flex: 1,
    minWidth: 0,
    height: ACTION_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});

export const projectListStyles = s;
