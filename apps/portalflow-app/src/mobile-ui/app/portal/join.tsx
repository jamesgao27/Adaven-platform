import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentUser } from '@/lib/auth';
import { getOrderById, resolveSkuForPreview } from '@/lib/firm';
import { getFirmClientInviteInfo } from '@/lib/firm-clients';
import SkuPreview from '@/components/SkuPreview';
import type { FirmSku } from '@/types';
import {
  ensureConsumerSpace,
  listConsumerSpacesForPortal,
  openEngagementAfterVerify,
  sendPortalEmailCode,
  verifyPortalEmailCode,
  type ConsumerSpaceChoice,
} from '@/lib/portal-join';
import {
  loadPortalChecklist,
  loadPortalFiles,
  sendPortalMessage,
  uploadPortalFile,
  type PortalChecklistItem,
  type PortalFile,
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
  const fileRef = useRef<{ click?: () => void } | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
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
  const [sku, setSku] = useState<FirmSku | null>(null);
  const [firmName, setFirmName] = useState('Your firm');
  const [matchedTitles, setMatchedTitles] = useState<string[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [pending, setPending] = useState<{ uri: string; name: string; mimeType?: string }[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    getFirmClientInviteInfo(token).then(async ({ info }) => {
      if (!info?.skuId) return;
      if (info.firmName) setFirmName(info.firmName);
      const header = await resolveSkuForPreview(info.skuId, { inviteToken: token });
      if (!header) return;
      setSku({
        id: info.skuId,
        firmSpaceId: info.firmSpaceId,
        name: header.name,
        description: header.description ?? undefined,
        imageUrl: header.imageUrl,
        taxCountry: header.taxCountry,
        taxScenario: header.taxScenario,
        isPublished: header.isPublished,
        templateStatus: header.templateStatus,
      });
    });
  }, [token]);

  const refreshOrder = useCallback(async (nextOrderId: string, nextUserId: string) => {
    const order = await getOrderById(nextOrderId);
    if (!order?.clientSpaceId) throw new Error('This engagement is not ready yet.');
    setClientSpaceId(order.clientSpaceId);
    const [checklist, nextFiles] = await Promise.all([
      loadPortalChecklist(nextOrderId),
      loadPortalFiles(nextOrderId, nextUserId),
    ]);
    setMatchedTitles(checklist.filter((item: PortalChecklistItem) => item.satisfied).map((item) => item.title));
    setFiles(nextFiles);
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
    const order = await getOrderById(nextOrderId);
    if (order?.clientSpaceId && pending.length) {
      await flushPending(nextOrderId, order.clientSpaceId, user.id, pending);
    }
    await refreshOrder(nextOrderId, user.id);
  };

  const onSend = async () => {
    if (!agreed) return;
    if (mode === 'new' && !name.trim()) {
      setError('Enter your name.');
      return;
    }
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
      const ensured = await ensureConsumerSpace(email, null, mode === 'new' ? name : null);
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

  const addFile = async (file: { uri: string; name: string; mimeType?: string }) => {
    if (!orderId || !clientSpaceId || !userId) {
      setPending((list) => [...list, file]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await uploadPortalFile({
        orderId,
        clientSpaceId,
        userId,
        fileName: file.name || 'file',
        bytes: await readPickedFile(file.uri),
        mimeType: file.mimeType || 'application/octet-stream',
      });
      await refreshOrder(orderId, userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the file.');
    } finally {
      setBusy(false);
    }
  };

  const flushPending = async (nextOrderId: string, nextSpaceId: string, nextUserId: string, queued: { uri: string; name: string; mimeType?: string }[]) => {
    for (const file of queued) {
      await uploadPortalFile({
        orderId: nextOrderId,
        clientSpaceId: nextSpaceId,
        userId: nextUserId,
        fileName: file.name || 'file',
        bytes: await readPickedFile(file.uri),
        mimeType: file.mimeType || 'application/octet-stream',
      });
    }
    setPending([]);
  };

  const onPick = () => fileRef.current?.click?.();

  const onSubmitToFirm = async () => {
    if (!orderId || !userId || !files.length) return;
    setBusy(true);
    setError('');
    try {
      await sendPortalMessage({
        orderId,
        userId,
        kind: 'message',
        body: `Submitted ${files.length} file${files.length === 1 ? '' : 's'} for review.`,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{firmName} sent you this request</Text>
        <Text style={styles.subtitle}>{sku?.name || 'Documents'}</Text>
        <View style={styles.split}>
          <View style={styles.left}>
            {sku ? (
              <SkuPreview
                sku={sku}
                clientPreviewAuth={{ inviteToken: token || undefined, firmClientId: firmClientId || undefined, orderId: orderId || undefined }}
                satisfiedTitles={matchedTitles}
                maxHeight={420}
              />
            ) : (
              <View style={styles.previewWait}>
                <ActivityIndicator color="#6C5CE7" />
                <Text style={styles.muted}>Loading the service template…</Text>
              </View>
            )}
          </View>
          <View style={styles.right}>
            {files.map((file) => (
              <View key={file.id} style={styles.fileRow}>
                <Ionicons name="document-outline" size={18} color="#636E72" />
                <Text style={styles.fileName} numberOfLines={1} onPress={() => Linking.openURL(file.url)}>{file.name}</Text>
              </View>
            ))}
            {pending.map((file, index) => (
              <View key={`pending-${index}`} style={styles.fileRow}>
                <Ionicons name="document-outline" size={18} color="#636E72" />
                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.addRow} onPress={onPick} disabled={busy}>
              <Ionicons name="add-circle-outline" size={18} color="#2D3436" />
              <Text style={styles.addText}>{files.length + pending.length ? 'Add more files' : 'Add files'}</Text>
            </TouchableOpacity>
            {Platform.OS === 'web'
              ? createElement('input', {
                  type: 'file',
                  multiple: true,
                  ref: (node: { click?: () => void } | null) => {
                    fileRef.current = node;
                  },
                  style: { display: 'none' },
                  onChange: (event: { target?: { files?: FileList | null } }) => {
                    const list = event.target?.files;
                    if (!list) return;
                    Array.from(list).forEach((file) => {
                      void addFile({ uri: URL.createObjectURL(file), name: file.name, mimeType: file.type });
                    });
                  },
                })
              : null}
          </View>
        </View>
        {choices ? (
          <View style={styles.choices}>
            {choices.map((choice) => (
              <TouchableOpacity key={choice.id} style={styles.choice} onPress={() => finish(choice.id)} disabled={busy}>
                <Text>{choice.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.form}>
          {mode === 'new' && !orderId ? (
            <View style={styles.field}>
              <Text style={styles.label}>Your name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Add your name" placeholderTextColor="#95A5A6" />
            </View>
          ) : null}
          <View style={styles.field}>
            <Text style={styles.label}>Your email address</Text>
            <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#95A5A6" editable={!orderId} />
          </View>
          {codeSent && !orderId ? (
            <View style={styles.field}>
              <Text style={styles.label}>Code</Text>
              <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="6-digit code" placeholderTextColor="#95A5A6" />
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {!orderId ? (
            <TouchableOpacity onPress={() => { setMode(mode === 'new' ? 'existing' : 'new'); setCodeSent(false); setCode(''); }}>
              <Text style={styles.link}>{mode === 'new' ? 'Already have an account? Sign in' : 'New here? Enter your name'}</Text>
            </TouchableOpacity>
          ) : <View />}
          <View style={styles.actionRight}>
            {!orderId ? (
              <>
                <TouchableOpacity style={styles.check} onPress={() => setAgreed((value) => !value)}>
                  <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={18} color="#6C5CE7" />
                  <Text style={styles.agree}> I agree to the <Text style={styles.link} onPress={() => setTermsOpen(true)}>service terms</Text></Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.uploadBtn, (!agreed || busy) && styles.off]} onPress={codeSent ? onVerify : onSend} disabled={busy || !agreed}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadText}>{codeSent ? (mode === 'existing' ? 'Sign in' : 'Verify') : 'Send code'}</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.uploadBtn, (!(files.length + pending.length) || busy) && styles.off]} onPress={onSubmitToFirm} disabled={!(files.length + pending.length) || busy}>
                <Text style={styles.uploadText}>{submitted ? 'Uploaded' : 'Upload'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.note}>
          Your files will be sent securely to {firmName}. More about the{' '}
          <Text style={styles.link} onPress={() => setTermsOpen(true)}>service terms</Text>.
        </Text>
      </View>
      <Modal visible={termsOpen} transparent animationType="fade" onRequestClose={() => setTermsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setTermsOpen(false)}>
          <Pressable style={styles.modal} onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Service terms</Text>
              <TouchableOpacity onPress={() => setTermsOpen(false)}><Text style={styles.link}>Close</Text></TouchableOpacity>
            </View>
            {Platform.OS === 'web'
              ? createElement('iframe', { src: TERMS_URL, style: { width: '100%', height: 480, border: 'none' } })
              : <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}><Text style={styles.link}>Open the terms page</Text></TouchableOpacity>}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F4F4F4', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 860, backgroundColor: '#fff', borderRadius: 4, padding: 28, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  title: { textAlign: 'center', fontSize: 22, fontWeight: '700', color: '#1B1B1B' },
  subtitle: { textAlign: 'center', color: '#637381', marginTop: 6, marginBottom: 20 },
  split: { flexDirection: 'row', gap: 16, minHeight: 280, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#ECEFF1', paddingVertical: 16 },
  left: { flex: 1.15 },
  right: { flex: 0.85, borderLeftWidth: 1, borderLeftColor: '#ECEFF1', paddingLeft: 16 },
  previewWait: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: '#637381' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F2F4' },
  fileName: { flex: 1, color: '#1B1B1B' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addText: { color: '#1B1B1B', fontWeight: '600' },
  form: { flexDirection: 'row', gap: 16, marginTop: 20 },
  field: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: '#1B1B1B', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D5DADF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  actionRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { flexDirection: 'row', alignItems: 'center' },
  agree: { color: '#1B1B1B' },
  link: { color: '#1B1B1B', textDecorationLine: 'underline' },
  uploadBtn: { backgroundColor: '#1B1B1B', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
  uploadText: { color: '#fff', fontWeight: '700' },
  off: { opacity: 0.4 },
  error: { color: '#D63031', marginTop: 8 },
  choices: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  choice: { borderWidth: 1, borderColor: '#D5DADF', borderRadius: 8, padding: 8 },
  note: { marginTop: 18, textAlign: 'center', color: '#637381', fontSize: 12, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '85%' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700' },
});
