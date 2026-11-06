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
  deletePortalFile,
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
  const [matchedTitles, setMatchedTitles] = useState<string[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    getFirmClientInviteInfo(token).then(async ({ info }) => {
      if (!info?.skuId) return;
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
      setError('Confirm your email before adding files.');
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
      <View style={styles.row}>
        {mode === 'new' && !orderId ? (
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#95A5A6" />
        ) : null}
        <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#95A5A6" editable={!orderId} />
        {codeSent && !orderId ? (
          <TextInput style={styles.code} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Code" placeholderTextColor="#95A5A6" />
        ) : null}
        {!orderId ? (
          <>
            <TouchableOpacity style={styles.check} onPress={() => setAgreed((value) => !value)}>
              <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={20} color="#6C5CE7" />
            </TouchableOpacity>
            <Text style={styles.agree}>
              I agree to the <Text style={styles.link} onPress={() => setTermsOpen(true)}>service terms</Text>
            </Text>
            <TouchableOpacity style={[styles.button, (!agreed || busy) && styles.off]} onPress={codeSent ? onVerify : onSend} disabled={busy || !agreed}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{codeSent ? (mode === 'existing' ? 'Sign in' : 'Verify') : 'Send code'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setMode(mode === 'new' ? 'existing' : 'new');
                setCodeSent(false);
                setCode('');
              }}
            >
              <Text style={styles.link}>{mode === 'new' ? 'Already have an account? Sign in' : 'New here? Enter your name'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.ready}>Signed in</Text>
        )}
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
      <View style={styles.columns}>
        <View style={styles.left}>
          <SkuPreview
            sku={sku}
            clientPreviewAuth={{ inviteToken: token || undefined, firmClientId: firmClientId || undefined, orderId: orderId || undefined }}
            satisfiedTitles={matchedTitles}
            maxHeight={640}
          />
        </View>
        <View style={styles.right}>
          <View
            style={styles.drop}
            {...(Platform.OS === 'web'
              ? ({
                  onDragOver: (event: { preventDefault: () => void }) => event.preventDefault(),
                  onDrop: (event: { preventDefault: () => void; dataTransfer?: { files?: FileList } }) => {
                    event.preventDefault();
                    const list = event.dataTransfer?.files;
                    if (!list?.length) return;
                    const file = list[0];
                    void addFile({ uri: URL.createObjectURL(file), name: file.name, mimeType: file.type });
                  },
                } as object)
              : {})}
          >
            <Ionicons name="cloud-upload-outline" size={28} color="#6C5CE7" />
            <Text style={styles.dropText}>Drop files here, or click to add</Text>
            <TouchableOpacity onPress={onPick}><Text style={styles.link}>Add files</Text></TouchableOpacity>
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
          <View style={styles.fileGrid}>
            {files.map((file) => (
              <TouchableOpacity key={file.id} style={styles.fileCard} onPress={() => Linking.openURL(file.url)}>
                <Ionicons name="document-outline" size={28} color="#6C5CE7" />
                <Text style={styles.fileName} numberOfLines={2}>{file.name}</Text>
                {file.owned ? (
                  <TouchableOpacity onPress={() => { void deletePortalFile(file.id).then(() => orderId && userId && refreshOrder(orderId, userId)); }}>
                    <Ionicons name="close-circle" size={16} color="#D63031" />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[styles.submit, (!orderId || !files.length || busy) && styles.off]} onPress={onSubmitToFirm} disabled={!orderId || !files.length || busy}>
            <Text style={styles.buttonText}>{submitted ? 'Submitted to firm' : 'Submit to firm'}</Text>
          </TouchableOpacity>
        </View>
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
  page: { flex: 1, backgroundColor: '#F7F8FC', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12 },
  input: { flexGrow: 1, minWidth: 160, borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  code: { width: 96, borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  check: { padding: 2 },
  agree: { color: '#2D3436' },
  link: { color: '#6C5CE7', fontWeight: '600' },
  button: { backgroundColor: '#6C5CE7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: '#fff', fontWeight: '700' },
  off: { opacity: 0.45 },
  ready: { color: '#00B894', fontWeight: '600' },
  error: { color: '#D63031', marginBottom: 8 },
  choices: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  choice: { backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E6E8F0' },
  columns: { flex: 1, flexDirection: 'row', gap: 12 },
  left: { flex: 1.1 },
  right: { flex: 0.9, backgroundColor: '#fff', borderRadius: 16, padding: 12 },
  drop: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#C5B8F5', borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 12, backgroundColor: '#F8F6FF' },
  dropText: { color: '#636E72', marginTop: 6, marginBottom: 4 },
  fileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fileCard: { width: 108, minHeight: 96, borderRadius: 12, borderWidth: 1, borderColor: '#E6E8F0', alignItems: 'center', justifyContent: 'center', padding: 8 },
  fileName: { fontSize: 12, color: '#2D3436', textAlign: 'center', marginTop: 4 },
  submit: { marginTop: 12, backgroundColor: '#0F172A', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '85%' },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#2D3436' },
});
