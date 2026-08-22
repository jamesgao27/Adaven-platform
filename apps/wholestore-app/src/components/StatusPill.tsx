import { View, Text } from 'react-native';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/list-page-styles';

export function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status ?? '—';
  const color = STATUS_COLOR[status] ?? '#636E72';
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
