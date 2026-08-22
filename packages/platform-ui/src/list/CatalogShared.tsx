/**
 * Catalog grid/list chrome shared with Vouchap Service Catalog (no SKU items / WBS).
 */
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  GRID_GAP,
  LIST_ROW_MIN_HEIGHT,
  projectListStyles,
  type ProjectListCardItem,
} from './ProjectListCardAndRow';

export const SERVICE_CATALOG_CARD_MAX_WIDTH = 320;
export { GRID_GAP };

export type CatalogSkuLike = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  isPublished?: boolean;
};

export function skuToCatalogListItem(sku: CatalogSkuLike): ProjectListCardItem {
  const published = sku.isPublished === true;
  const statusLabel = published ? 'Published' : 'Draft';
  const statusColor = published ? '#00B894' : '#636E72';
  return {
    id: sku.id,
    displayName: sku.name ?? '—',
    imageUrl: sku.imageUrl ?? null,
    tagPill: null,
    statusLabel,
    statusColor,
    statusCorner: { label: statusLabel, bg: statusColor },
    classificationTags: null,
    footerText: null,
    progress: null,
    action: null,
  };
}

export const serviceCatalogListStyles = projectListStyles.list;

const addEntryDashChrome = { borderWidth: 1, borderColor: '#CED4DA' };

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
  addListRowWeb: { backgroundColor: '#FFF' },
  addListRowNative: {
    backgroundColor: '#FBFCFF',
    borderRadius: 12,
    borderStyle: 'dashed',
    ...addEntryDashChrome,
  },
  addListRowSpacer: { width: 28, minWidth: 28, marginLeft: -12, marginRight: 0 },
  addListRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 4 + 64 + 12,
  },
  addListRowText: { fontSize: 14, fontWeight: '600', color: '#6C5CE7' },
});
