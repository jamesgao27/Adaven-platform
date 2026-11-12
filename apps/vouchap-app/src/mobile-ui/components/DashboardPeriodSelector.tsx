/**
 * Dashboard quick date-range control: This month / 3 months / This year / Past 12 months / Custom.
 * UI copy is English (product rule).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { getLocalDateString } from '@/lib/date-utils';

export type DashboardPeriodPreset =
  | 'this_month'
  | 'last_3_months'
  | 'this_year'
  | 'last_12_months'
  | 'custom';

export type DashboardDateRange = { start: string; end: string };

const PRESETS: { key: DashboardPeriodPreset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_3_months', label: '3 months' },
  { key: 'this_year', label: 'This year' },
  { key: 'last_12_months', label: 'Past 12 months' },
  { key: 'custom', label: 'Custom' },
];

export function resolveDashboardPeriodRange(
  preset: DashboardPeriodPreset,
  custom?: DashboardDateRange | null,
  now: Date = new Date()
): DashboardDateRange {
  const end = getLocalDateString(now);

  if (preset === 'custom' && custom?.start && custom?.end) {
    return custom.start <= custom.end
      ? { start: custom.start, end: custom.end }
      : { start: custom.end, end: custom.start };
  }

  if (preset === 'this_month') {
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { start, end };
  }

  if (preset === 'this_year') {
    return { start: `${now.getFullYear()}-01-01`, end };
  }

  if (preset === 'last_3_months') {
    const startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { start: getLocalDateString(startDate), end };
  }

  // Past 12 calendar months including the current month
  const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return { start: getLocalDateString(startDate), end };
}

/** Normalize a date-like field to YYYY-MM-DD and test inclusive range membership. */
export function isDateInRange(
  dateStr: string | undefined | null,
  range: DashboardDateRange
): boolean {
  if (!dateStr) return false;
  const raw = String(dateStr);
  const key = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return key >= range.start && key <= range.end;
}

type Props = {
  preset: DashboardPeriodPreset;
  customRange: DashboardDateRange | null;
  onPresetChange: (preset: DashboardPeriodPreset) => void;
  onCustomRangeChange: (range: DashboardDateRange) => void;
};

export default function DashboardPeriodSelector({
  preset,
  customRange,
  onPresetChange,
  onCustomRangeChange,
}: Props) {
  const fallbackCustom = useMemo(
    () => resolveDashboardPeriodRange('last_12_months'),
    []
  );
  const [draftStart, setDraftStart] = useState(customRange?.start || fallbackCustom.start);
  const [draftEnd, setDraftEnd] = useState(customRange?.end || fallbackCustom.end);

  useEffect(() => {
    if (customRange?.start && customRange?.end) {
      setDraftStart(customRange.start);
      setDraftEnd(customRange.end);
    }
  }, [customRange?.start, customRange?.end]);

  const selectPreset = (key: DashboardPeriodPreset) => {
    if (key === 'custom') {
      const next = customRange ?? resolveDashboardPeriodRange('last_12_months');
      setDraftStart(next.start);
      setDraftEnd(next.end);
      onCustomRangeChange(next);
    }
    onPresetChange(key);
  };

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    const range =
      draftStart <= draftEnd
        ? { start: draftStart, end: draftEnd }
        : { start: draftEnd, end: draftStart };
    onCustomRangeChange(range);
    onPresetChange('custom');
  };

  return (
    <View style={styles.root}>
      {PRESETS.map((p) => {
        const active = preset === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => selectPreset(p.key)}
            style={[styles.pill, active && styles.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{p.label}</Text>
          </Pressable>
        );
      })}
      {preset === 'custom' ? (
        <>
          <Text style={styles.customLabel}>From</Text>
          {Platform.OS === 'web' ? (
            React.createElement('input', {
              type: 'date',
              value: draftStart,
              onChange: (e: any) => setDraftStart((e.target as HTMLInputElement).value),
              style: webDateInputStyle,
            })
          ) : (
            <Text style={styles.nativeDateFallback}>{draftStart}</Text>
          )}
          <Text style={styles.customLabel}>To</Text>
          {Platform.OS === 'web' ? (
            React.createElement('input', {
              type: 'date',
              value: draftEnd,
              onChange: (e: any) => setDraftEnd((e.target as HTMLInputElement).value),
              style: webDateInputStyle,
            })
          ) : (
            <Text style={styles.nativeDateFallback}>{draftEnd}</Text>
          )}
          <Pressable onPress={applyCustom} style={styles.applyBtn}>
            <Text style={styles.applyText}>Apply</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const webDateInputStyle: Record<string, string | number> = {
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  color: '#2D3436',
  backgroundColor: '#FFF',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  height: 30,
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F3F5',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    flexShrink: 0,
  },
  pillActive: {
    backgroundColor: '#EDE9FE',
    borderColor: '#6C5CE7',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#636E72',
  },
  pillTextActive: {
    color: '#6C5CE7',
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#636E72',
    flexShrink: 0,
  },
  nativeDateFallback: {
    fontSize: 12,
    color: '#2D3436',
  },
  applyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#6C5CE7',
    flexShrink: 0,
  },
  applyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
});
