import { createElement, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { getCurrentUser } from '@/lib/auth';
import { getOrderById, fetchSkuItemsForClientPreview } from '@/lib/firm';
import { getFirmClientInviteInfo } from '@/lib/firm-clients';
import {
  ensureConsumerSpace,
  listConsumerSpacesForPortal,
  openEngagementAfterVerify,
  sendPortalEmailCode,
  verifyPortalEmailCode,
  type ConsumerSpaceChoice,
} from '@/lib/portal-join';
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

const TERMS_URL = 'https://www.vouchap.com/terms';

async function readPickedFile(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read the file.');
  return res.arrayBuffer();
}

export default function PortalJoinScreen() {
  const params = useLocalSearchParams<{ token?: string; firmClientId?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const firmClientId = typeof params.firmClientId === 'string' ? params.firmClientId : '';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<ConsumerSpaceChoice[] | null>(null);
  const [orderId, setOrderId] = useState('');
  const [clientSpaceId, setClientSpaceId] = useState('');
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<PortalChecklistItem[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [threadOpen, setThreadOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    getFirmClientInviteInfo(token).then(async ({ info }) => {
      if (!info?.skuId) return;
      const rows = await fetchSkuItemsForClientPreview(info.skuId, { inviteToken: token });
      setItems(
        rows
          .filter((row) => row.item_kind === 'task' && row.initial_responsible_side === 'client')
          .map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            satisfied: false,
            gap: null,
          }))
      );
    });
  }, [token]);

  const refreshOrder = useCallback(async (nextOrderId: string, nextUserId: string) => {
    const order = await getOrderById(nextOrderId);
    if (!order?.clientSpaceId) throw new Error('This engagement is not ready yet.');
    setClientSpaceId(order.clientSpaceId);
    const [nextItems, nextFiles, nextMessages] = await Promise.all([
      loadPortalChecklist(nextOrderId),
      loadPortalFiles(nextOrderId, nextUserId),
      loadPortalMessages(nextOrderId, nextUserId),
    ]);
    setItems(nextItems);
    setFiles(nextFiles);
    setMessages(nextMessages);
  }, []);

  const finish = async (spaceId: string) => {
    const nextOrderId = await openEngagementAfterVerify({
      email,
      token: token || undefined,
      firmClientId: firmClientId || undefined,
      spaceId,
    });
    const user = await getCurrentUser(true);
    if (!user) throw new Error('Sign in required.');
    setUserId(user.id);
    setOrderId(nextOrderId);
    setChoices(null);
    await refreshOrder(nextOrderId, user.id);
  };

  const onSend = async () => {
    if (!agreed) return;
    setBusy(true);
    setError('');
    try {
      await sendPortalEmailCode(email);
      setCodeSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    setBusy(true);
    setError('');
    try {
      await verifyPortalEmailCode(email, code);
      const ensured = await ensureConsumerSpace(email);
      if ('choices' in ensured) {
        setChoices(ensured.choices.length ? ensured.choices : await listConsumerSpacesForPortal());
        return;
      }
      await finish(ensured.spaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    if (!orderId || !clientSpaceId || !userId) return;
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    setError('');
    try {
      await uploadPortalFile({
        orderId,
        clientSpaceId,
        userId,
        fileName: asset.name || 'file',
        bytes: await readPickedFile(asset.uri),
        mimeType: asset.mimeType || 'application/octet-stream',
      });
      await refreshOrder(orderId, userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onSendNote = async (kind: 'urge' | 'message') => {
    if (!orderId || !userId) return;
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

  return (
    <View style={styles.page}>
      <View style={styles.verify}>
        <Text style={styles.title}>Confirm your email</Text>
        {choices ? (
          choices.map((choice) => (
            <TouchableOpacity key={choice.id} style={styles.choice} onPress={() => finish(choice.id)} disabled={busy}>
              <Text style={styles.choiceText}>{choice.name}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <>
            <View style={styles.agreeRow}>
              <TouchableOpacity onPress={() => setAgreed((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
                <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color="#6C5CE7" />
              </TouchableOpacity>
              <Text style={styles.agreeText}>
                I agree to the{' '}
                <Text style={styles.termsLink} onPress={() => setTermsOpen(true)}>service terms</Text>
              </Text>
            </View>
            <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor="#95A5A6" editable={!orderId} />
            {codeSent && !orderId ? (
              <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="6-digit code" placeholderTextColor="#95A5A6" />
            ) : null}
            {!orderId ? (
              <TouchableOpacity style={[styles.button, !agreed && !codeSent && styles.buttonOff]} onPress={codeSent ? onVerify : onSend} disabled={busy || (!codeSent && !agreed)}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{codeSent ? 'Verify' : 'Send code'}</Text>}
              </TouchableOpacity>
            ) : (
              <Text style={styles.ready}>Email confirmed. You can upload files in the folder.</Text>
            )}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {orderId ? (
          <View style={styles.noteRow}>
            <TouchableOpacity style={styles.ghost} onPress={() => onSendNote('urge')} disabled={busy}><Text style={styles.ghostText}>Urge</Text></TouchableOpacity>
            <TouchableOpacity style={styles.ghost} onPress={() => setThreadOpen((open) => !open)}><Text style={styles.ghostText}>Message</Text></TouchableOpacity>
          </View>
        ) : null}
        {threadOpen ? (
          <View>
            {messages.map((message) => (
              <Text key={message.id} style={styles.threadLine}>{message.kind === 'urge' ? 'Urge' : message.kind === 'reply' ? 'Reply' : 'Note'}: {message.body}</Text>
            ))}
            <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Leave a note for your firm" placeholderTextColor="#95A5A6" />
            <TouchableOpacity onPress={() => onSendNote('message')} disabled={busy}><Text style={styles.ghostText}>Send</Text></TouchableOpacity>
          </View>
        ) : null}
      </View>
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
            {!items.length ? <Text style={styles.empty}>The document list appears here from the service you were invited to.</Text> : null}
          </ScrollView>
        </View>
        <View style={styles.column}>
          <View style={styles.folderHead}>
            <Text style={styles.heading}>Files</Text>
            <TouchableOpacity style={[styles.upload, !orderId && styles.buttonOff]} onPress={onUpload} disabled={busy || !orderId}>
              <Text style={styles.buttonText}>Upload</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {files.map((file) => (
              <View key={file.id} style={styles.fileRow}>
                <TouchableOpacity style={styles.fileName} onPress={() => Linking.openURL(file.url)}>
                  <Text style={styles.fileText} numberOfLines={1}>{file.name}</Text>
                </TouchableOpacity>
                {file.owned ? (
                  <TouchableOpacity onPress={async () => { await deletePortalFile(file.id); if (orderId && userId) await refreshOrder(orderId, userId); }}>
                    <Ionicons name="trash-outline" size={18} color="#D63031" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {!orderId ? <Text style={styles.empty}>Confirm your email to add files to this folder.</Text> : null}
          </ScrollView>
        </View>
      </View>
      <Modal visible={termsOpen} transparent animationType="fade" onRequestClose={() => setTermsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTermsOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHead}>
              <Text style={styles.heading}>Service terms</Text>
              <TouchableOpacity onPress={() => setTermsOpen(false)}><Text style={styles.ghostText}>Close</Text></TouchableOpacity>
            </View>
            {Platform.OS === 'web'
              ? createElement('iframe', { src: TERMS_URL, style: { width: '100%', height: 480, border: 'none' } })
              : <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}><Text style={styles.termsLink}>Open the terms page</Text></TouchableOpacity>}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F8FC', padding: 16 },
  verify: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#2D3436', marginBottom: 10 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  agreeText: { color: '#2D3436', flex: 1 },
  termsLink: { color: '#6C5CE7', textDecorationLine: 'underline' },
  input: { borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  button: { backgroundColor: '#6C5CE7', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonOff: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '700' },
  ready: { color: '#00B894' },
  error: { color: '#D63031', marginTop: 8 },
  choice: { borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 12, padding: 12, marginBottom: 8 },
  choiceText: { fontWeight: '600', color: '#2D3436' },
  noteRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  ghost: { borderWidth: 1, borderColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  ghostText: { color: '#6C5CE7', fontWeight: '700' },
  threadLine: { color: '#2D3436', marginTop: 4 },
  columns: { flex: 1, flexDirection: 'row', gap: 12 },
  column: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: '#2D3436', marginBottom: 10 },
  item: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  itemCopy: { flex: 1 },
  itemTitle: { color: '#2D3436' },
  itemDone: { color: '#00B894' },
  gap: { color: '#636E72', fontSize: 12 },
  folderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  upload: { backgroundColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  fileRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  fileName: { flex: 1 },
  fileText: { color: '#2D3436' },
  empty: { color: '#636E72' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '85%' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
