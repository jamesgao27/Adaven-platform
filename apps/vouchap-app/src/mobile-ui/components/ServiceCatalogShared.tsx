/**
 * Shared Service Catalog mapping + "New template" entry tile (firm) / same chrome for client catalog add entry.
 */
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  GRID_GAP,
  LIST_ROW_MIN_HEIGHT,
  projectListStyles,
  type ProjectListCardItem,
} from '@/components/ProjectListCardAndRow';
import type { FirmSku } from '@/types';

export const SERVICE_CATALOG_CARD_MAX_WIDTH = 320;

/** Dashed add-tile border — web and native aligned. */
const addEntryDashChrome = { borderWidth: 1, borderColor: '#CED4DA' };

/** Same palette as firm/sku Info tags */
export const SERVICE_CATALOG_TAG_PALETTE: [string, string][] = [
  ['#EDE9FD', '#6C5CE7'],
  ['#E3F2FD', '#1E88E5'],
  ['#E8F5E9', '#27AE60'],
  ['#FFF3E0', '#E67E22'],
  ['#FCE4EC', '#E91E63'],
  ['#E8EAF6', '#3F51B5'],
  ['#E0F7FA', '#00838F'],
  ['#FFF8E1', '#F9A825'],
];

export function getServiceCatalogTagColor(s: string): [string, string] {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xfffff;
  return SERVICE_CATALOG_TAG_PALETTE[Math.abs(h) % SERVICE_CATALOG_TAG_PALETTE.length]!;
}

/** Map FirmSku → ProjectListCardItem (firm catalog + client published catalog). */
export function firmSkuToProjectListItem(
  sku: FirmSku,
  opts?: { firmFooter?: boolean; forClientMarketplace?: boolean },
): ProjectListCardItem {
  const isPublished = sku.isPublished === true;
  const hasSetup = !!sku.taxCountry || !!sku.taxScenario;

  let statusLabel: 'Draft' | 'Private' | 'Published';
  let statusColor: string;
  if (sku.templateStatus === 'draft' || sku.templateStatus === 'private' || sku.templateStatus === 'published') {
    statusLabel = sku.templateStatus === 'published' ? 'Published' : sku.templateStatus === 'private' ? 'Private' : 'Draft';
    statusColor = statusLabel === 'Published' ? '#00B894' : statusLabel === 'Private' ? '#0984E3' : '#636E72';
  } else if (isPublished) {
    statusLabel = 'Published';
    statusColor = '#00B894';
  } else if (hasSetup) {
    statusLabel = 'Private';
    statusColor = '#0984E3';
  } else {
    statusLabel = 'Draft';
    statusColor = '#636E72';
  }

  const classificationTags: { label: string; bg: string; fg: string }[] = [];
  if (sku.taxCountry) {
    const [bg, fg] = getServiceCatalogTagColor(sku.taxCountry);
    classificationTags.push({ label: sku.taxCountry, bg, fg });
  }
  if (sku.taxScenario) {
    const [bg, fg] = getServiceCatalogTagColor(sku.taxScenario);
    classificationTags.push({ label: sku.taxScenario, bg, fg });
  }

  const forMarketplace = opts?.forClientMarketplace === true;
  let statusCorner: { label: string; bg: string } | null = null;
  if (!forMarketplace) {
    if (statusLabel === 'Draft') {
      statusCorner = { label: 'Draft', bg: statusColor };
    } else if (statusLabel === 'Private') {
      statusCorner = { label: 'Private', bg: statusColor };
    } else if (statusLabel === 'Published') {
      statusCorner = { label: 'Published', bg: statusColor };
    }
  }

  const firmNm = opts?.firmFooter && sku.firmName?.trim() ? sku.firmName.trim() : null;

  return {
    id: sku.id,
    displayName: sku.name ?? '—',
    imageUrl: sku.imageUrl ?? null,
    tagPill: null,
    statusLabel,
    statusColor,
    statusCorner,
    hideStatusBadge: forMarketplace,
    classificationTags: classificationTags.length > 0 ? classificationTags : null,
    footerText: firmNm ? `By ${firmNm}` : null,
    progress: null,
    action: null,
  };
}

export const serviceCatalogListStyles = projectListStyles.list;

type AddTileProps = {
  label: string;
  onPress: () => void;
  variant: 'grid' | 'list';
  cardWidth?: number;
};

export function ServiceCatalogAddEntryTile({ label, onPress, variant, cardWidth }: AddTileProps) {
  if (variant === 'list') {
    return (
      <TouchableOpacity
        style={[
          addStyles.addListRowBase,
          Platform.OS === 'web' ? addStyles.addListRowWeb : addStyles.addListRowNative,
        ]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <View style={addStyles.addListRowSpacer} />
        <View style={addStyles.addListRowContent}>
          <Ionicons name="add-circle-outline" size={26} color="#6C5CE7" />
          <Text style={addStyles.addListRowText}>{label}</Text>
        </View>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      style={[addStyles.addCardWrap, cardWidth != null ? { width: cardWidth } : undefined]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={addStyles.addCardInner}>
        <Ionicons name="add-circle-outline" size={26} color="#6C5CE7" />
        <Text style={addStyles.addCardText}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const addStyles = StyleSheet.create({
  addCardWrap: {
    maxWidth: SERVICE_CATALOG_CARD_MAX_WIDTH,
    borderRadius: 12,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FBFCFF',
    ...addEntryDashChrome,
  },
  addCardInner: {
    width: '100%',
    height: '100%',
    minHeight: 180,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  addCardText: { fontSize: 14, fontWeight: '600', color: '#6C5CE7' },
  addListRowBase: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: LIST_ROW_MIN_HEIGHT,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  /** Web list: same as standard row — white tile inside grouped list (no dashed promo card). */
  addListRowWeb: {
    backgroundColor: '#FFF',
  },
  /** Native list: dashed tile aligned with grid add card. */
  addListRowNative: {
    backgroundColor: '#FBFCFF',
    borderRadius: 12,
    borderStyle: 'dashed',
    ...addEntryDashChrome,
  },
  addListRowSpacer: {
    width: 28,
    minWidth: 28,
    marginLeft: -12,
    marginRight: 0,
  },
  addListRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 4 + 64 + 12,
  },
  addListRowText: { fontSize: 14, fontWeight: '600', color: '#6C5CE7' },
});

export { GRID_GAP };
