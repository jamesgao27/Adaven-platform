import React from 'react';
import { Text, View, Platform } from 'react-native';
import type { DataTableColumn } from '@/components/DataTable';
import type { FirmOrderWithDetails } from '@/lib/firm';
import { format } from 'date-fns';

export const STATUS_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  processing: 'Processing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_COLOR: Record<string, string> = {
  onboarding: '#E67E22',
  processing: '#29B6F6',
  completed: '#00B894',
  cancelled: '#B2BEC3',
};

const cellText = { fontSize: 14, color: '#2D3436' as const };

// Firm engagements 表一致：claimed=green, pending invitee=amber
const CLIENT_TYPE_DOT = { client: '#27AE60', pendingInvitee: '#F39C12' };
function isOrderPendingClaim(o: { clientSpaceId?: string | null; clientId?: string | null }): boolean {
  return !o.clientSpaceId && !!o.clientId;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return format(d, 'MMM dd, yyyy');
  } catch {
    return '—';
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return format(d, 'MMM dd, yyyy HH:mm');
  } catch {
    return '—';
  }
}

export function serviceItemLabel(row: Pick<FirmOrderWithDetails, 'skuName'>): string {
  return row.skuName || '—';
}

export function getCategoryTags(
  row: Pick<FirmOrderWithDetails, 'dueAt' | 'createdAt' | 'taxSeasonYear' | 'taxCountry' | 'taxScenario' | 'tags'>
): string[] {
  const tags: string[] = [];
  const dateForYear = row.dueAt || row.createdAt || null;
  const explicitYear = row.taxSeasonYear != null ? row.taxSeasonYear : null;
  if (explicitYear != null) {
    tags.push(String(explicitYear));
  } else if (dateForYear) {
    try {
      const y = new Date(dateForYear).getFullYear();
      if (!Number.isNaN(y)) tags.push(String(y));
    } catch {
      // ignore
    }
  }
  if (row.taxCountry) tags.push(row.taxCountry);
  if (row.taxScenario) tags.push(row.taxScenario);
  if (Array.isArray(row.tags)) {
    for (const t of row.tags) {
      if (t && typeof t === 'string') tags.push(t);
    }
  }
  return tags;
}

export function formatCategory(
  row: Pick<FirmOrderWithDetails, 'dueAt' | 'createdAt' | 'taxSeasonYear' | 'taxCountry' | 'taxScenario' | 'tags'>
): string {
  const parts = getCategoryTags(row);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function renderStatusBadge(status: string | null | undefined) {
  const raw = status ?? '';
  const label = STATUS_LABEL[raw] ?? raw ?? '—';
  const color = STATUS_COLOR[raw] ?? '#636E72';
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: color }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export type BuildEngagementColumnsOptions = {
  includeClientColumn?: boolean;
  includeClientDot?: boolean;
  includeClassificationColumn?: boolean;
  includeStatusColumn?: boolean;
  includeUpdatedAtColumn?: boolean;
  includeManagerColumn?: boolean;
  includeCreatorColumn?: boolean;
  includeCreatedDateColumn?: boolean;
  includeSourceColumn?: boolean;
  serviceColumnLabel?: string;
};

export function buildEngagementTableColumns(
  opts: BuildEngagementColumnsOptions = {}
): DataTableColumn<FirmOrderWithDetails>[] {
  const {
    includeClientColumn = true,
    includeClientDot = true,
    includeClassificationColumn = true,
    includeStatusColumn = true,
    includeUpdatedAtColumn = true,
    includeManagerColumn = true,
    includeCreatorColumn = false,
    includeCreatedDateColumn = true,
    includeSourceColumn = false,
    serviceColumnLabel = 'Engagement',
  } = opts;

  const cols: DataTableColumn<FirmOrderWithDetails>[] = [];

  if (includeClientColumn) {
    cols.push({
      id: 'clientName',
      label: 'Client',
      minWidth: 140,
      getValue: (r) => {
        if (!includeClientDot) {
          return (
            <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
              {r.clientName || '—'}
            </Text>
          );
        }
        const dotColor = isOrderPendingClaim(r) ? CLIENT_TYPE_DOT.pendingInvitee : CLIENT_TYPE_DOT.client;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, flexShrink: 0 }} />
            <Text style={[cellText, { flex: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="tail">
              {r.clientName || '—'}
            </Text>
          </View>
        );
      },
      getSortValue: (r) => (r.clientName || '').toLowerCase(),
    });
  }

  cols.push({
    id: 'serviceItem',
    label: serviceColumnLabel,
    minWidth: 160,
    getValue: (r) => (
      <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
        {serviceItemLabel(r)}
      </Text>
    ),
    getSortValue: (r) => serviceItemLabel(r).toLowerCase(),
  });

  if (includeClassificationColumn) {
    cols.push({
      id: 'category',
      label: 'Classification',
      minWidth: 200,
      getValue: (r) => {
        const txt = formatCategory(r);
        return (
          <Text
            style={[cellText, txt === '—' ? { color: '#95A5A6' } : undefined]}
            numberOfLines={1}
            ellipsizeMode="tail"
            {...(Platform.OS === 'web' && txt !== '—' ? ({ title: txt } as Record<string, string>) : {})}
          >
            {txt}
          </Text>
        );
      },
      getSortValue: (r) => formatCategory(r).toLowerCase(),
    });
  }

  if (includeStatusColumn) {
    cols.push({
      id: 'status',
      label: 'Status',
      minWidth: 100,
      getValue: (r) => renderStatusBadge(r.status),
      getSortValue: (r) => r.status ?? '',
    });
  }

  if (includeUpdatedAtColumn) {
    cols.push({
      id: 'updatedAt',
      label: 'Updated',
      minWidth: 120,
      getValue: (r) => {
        const txt = formatDateTime(r.updatedAt);
        return (
          <Text
            style={cellText}
            numberOfLines={1}
            ellipsizeMode="tail"
            {...(Platform.OS === 'web' && txt !== '—' ? ({ title: txt } as Record<string, string>) : {})}
          >
            {txt}
          </Text>
        );
      },
      getSortValue: (r) => r.updatedAt ?? '',
    });
  }

  if (includeManagerColumn) {
    cols.push({
      id: 'assigneeName',
      label: 'Manager',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {r.assigneeName ?? '—'}
        </Text>
      ),
      getSortValue: (r) => (r.assigneeName ?? '').toLowerCase(),
    });
  }

  if (includeCreatorColumn) {
    cols.push({
      id: 'creatorName',
      label: 'Creator',
      minWidth: 120,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {r.creatorName ?? '—'}
        </Text>
      ),
      getSortValue: (r) => (r.creatorName ?? '').toLowerCase(),
    });
  }

  if (includeCreatedDateColumn) {
    cols.push({
      id: 'createdAt',
      label: 'Created date',
      minWidth: 110,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {formatDate(r.createdAt)}
        </Text>
      ),
      getSortValue: (r) => r.createdAt ?? '',
    });
  }

  if (includeSourceColumn) {
    cols.push({
      id: 'source',
      label: 'Source',
      minWidth: 90,
      visible: false,
      getValue: (r) => (
        <Text style={cellText} numberOfLines={1} ellipsizeMode="tail">
          {r.source || '—'}
        </Text>
      ),
      getSortValue: (r) => (r.source || '').toLowerCase(),
    });
  }

  return cols;
}

