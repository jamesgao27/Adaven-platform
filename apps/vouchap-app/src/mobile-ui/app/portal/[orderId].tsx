import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { getCurrentUser } from '@/lib/auth';
import { getOrderById } from '@/lib/firm';
import {
  deletePortalFile,
  loadPortalChecklist,
  loadPortalFiles,
  loadPortalMessages,
  sendPortalMessage,
  uploadPortalFile,
  type PortalChecklistItem,
  type PortalFile,
  type PortalMessage,
} from '@/lib/portal-data';

async function readPickedFile(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read the file.');
  return res.arrayBuffer();
}

export default function ClientPortalScreen() {
  const { orderId: raw } = useLocalSearchParams<{ orderId: string }>();
  const orderId = typeof raw === 'string' ? raw : '';
  const [title, setTitle] = useState('Engagement');
  const [clientSpaceId, setClientSpaceId] = useState('');
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<PortalChecklistItem[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [threadOpen, setThreadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!orderId) return;
    const user = await getCurrentUser();
    if (!user) throw new Error('Sign in required.');
    setUserId(user.id);
    const order = await getOrderById(orderId);
    if (!order?.clientSpaceId) throw new Error('This engagement is not ready yet.');
    setClientSpaceId(order.clientSpaceId);
    setTitle(order.skuName || 'Engagement');
    const [nextItems, nextFiles, nextMessages] = await Promise.all([
      loadPortalChecklist(orderId),
      loadPortalFiles(orderId, user.id),
      loadPortalMessages(orderId, user.id),
    ]);
    setItems(nextItems);
    setFiles(nextFiles);
    setMessages(nextMessages);
  }, [orderId]);

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not open this engagement.'))
      .finally(() => setLoading(false));
  }, [reload]);

  const onUpload = async () => {
    setError('');
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      const bytes = await readPickedFile(asset.uri);
      await uploadPortalFile({
        orderId,
        clientSpaceId,
        userId,
        fileName: asset.name || 'file',
        bytes,
        mimeType: asset.mimeType || 'application/octet-stream',
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (file: PortalFile) => {
    if (!file.owned) return;
    setBusy(true);
    try {
      await deletePortalFile(file.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the file.');
    } finally {
      setBusy(false);
    }
  };

  const onSend = async (kind: 'urge' | 'message') => {
    setBusy(true);
    setError('');
    try {
      await sendPortalMessage({ orderId, userId, kind, body: draft });
      setDraft('');
      setThreadOpen(true);
      setMessages(await loadPortalMessages(orderId, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.ghost} onPress={() => onSend('urge')} disabled={busy}>
            <Text style={styles.ghostText}>Urge</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={() => setThreadOpen((open) => !open)}>
            <Text style={styles.ghostText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {threadOpen ? (
        <View style={styles.thread}>
          <ScrollView style={styles.threadList}>
            {messages.map((message) => (
              <Text key={message.id} style={styles.threadLine}>
                {message.kind === 'urge' ? 'Urge' : message.kind === 'reply' ? 'Firm' : 'Note'}
                {message.mine ? '' : ''}: {message.body}
              </Text>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Leave a note for your firm"
            placeholderTextColor="#95A5A6"
          />
          <TouchableOpacity style={styles.send} onPress={() => onSend('message')} disabled={busy}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.columns}>
        <View style={styles.column}>
          <Text style={styles.heading}>What we need</Text>
          <ScrollView>
            {items.map((item) => (
              <View key={item.id} style={styles.item}>
                <Ionicons name={item.satisfied ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={item.satisfied ? '#00B894' : '#B2BEC3'} />
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemTitle, item.satisfied && styles.itemDone]}>{item.title}</Text>
                  {!item.satisfied && item.gap ? <Text style={styles.gap}>{item.gap}</Text> : null}
                </View>
              </View>
            ))}
            {!items.length ? <Text style={styles.empty}>No client documents are listed on this service.</Text> : null}
          </ScrollView>
        </View>
        <View style={styles.column}>
          <View style={styles.folderHead}>
            <Text style={styles.heading}>Files</Text>
            <TouchableOpacity style={styles.upload} onPress={onUpload} disabled={busy || !clientSpaceId}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadText}>Upload</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView>
            {files.map((file) => (
              <View key={file.id} style={styles.fileRow}>
                <TouchableOpacity style={styles.fileName} onPress={() => Linking.openURL(file.url)}>
                  <Ionicons name="document-outline" size={18} color="#6C5CE7" />
                  <Text style={styles.fileText} numberOfLines={1}>{file.name}</Text>
                </TouchableOpacity>
                {file.owned ? (
                  <TouchableOpacity onPress={() => onDelete(file)} disabled={busy}>
                    <Ionicons name="trash-outline" size={18} color="#D63031" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {!files.length ? <Text style={styles.empty}>Drop files here. They stay in this one folder.</Text> : null}
          </ScrollView>
        </View>
      </View>
      {Platform.OS !== 'web' ? null : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F8FC', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#2D3436', flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  ghost: { borderWidth: 1, borderColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  ghostText: { color: '#6C5CE7', fontWeight: '700' },
  error: { color: '#D63031', marginBottom: 8 },
  thread: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12 },
  threadList: { maxHeight: 120, marginBottom: 8 },
  threadLine: { color: '#2D3436', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 10, padding: 10, marginBottom: 8 },
  send: { alignSelf: 'flex-start', backgroundColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  sendText: { color: '#fff', fontWeight: '700' },
  columns: { flex: 1, flexDirection: 'row', gap: 16 },
  column: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  heading: { fontSize: 16, fontWeight: '700', color: '#2D3436', marginBottom: 12 },
  item: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  itemCopy: { flex: 1 },
  itemTitle: { color: '#2D3436', fontSize: 15 },
  itemDone: { color: '#00B894' },
  gap: { color: '#636E72', fontSize: 12, marginTop: 2 },
  folderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  upload: { backgroundColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  uploadText: { color: '#fff', fontWeight: '700' },
  fileRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  fileName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileText: { flex: 1, color: '#2D3436' },
  empty: { color: '#636E72' },
});
