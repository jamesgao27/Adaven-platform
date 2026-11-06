import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ensureConsumerSpace,
  listConsumerSpacesForPortal,
  openEngagementAfterVerify,
  sendPortalEmailCode,
  verifyPortalEmailCode,
  type ConsumerSpaceChoice,
} from '@/lib/portal-join';

export default function PortalJoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; firmClientId?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const firmClientId = typeof params.firmClientId === 'string' ? params.firmClientId : '';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<ConsumerSpaceChoice[] | null>(null);

  const finish = async (spaceId: string) => {
    const orderId = await openEngagementAfterVerify({
      email,
      token: token || undefined,
      firmClientId: firmClientId || undefined,
      spaceId,
    });
    router.replace(`/portal/${orderId}`);
  };

  const onSend = async () => {
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

  const onPick = async (spaceId: string) => {
    setBusy(true);
    setError('');
    try {
      const ensured = await ensureConsumerSpace(email, spaceId);
      if (!('spaceId' in ensured)) return;
      await finish(ensured.spaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the engagement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={styles.card}>
        <Text style={styles.title}>{choices ? 'Choose a space' : 'Confirm your email'}</Text>
        <Text style={styles.lead}>
          {choices
            ? 'This email already has client spaces. Pick one to attach this engagement. Nothing else needs to be set up.'
            : 'We will email you a code. The link in older emails is not used here.'}
        </Text>
        {choices ? (
          choices.map((choice) => (
            <TouchableOpacity key={choice.id} style={styles.choice} onPress={() => onPick(choice.id)} disabled={busy}>
              <Text style={styles.choiceText}>{choice.name}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor="#95A5A6"
            />
            {codeSent ? (
              <>
                <Text style={styles.label}>Code</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  placeholder="6-digit code"
                  placeholderTextColor="#95A5A6"
                />
              </>
            ) : null}
            <TouchableOpacity style={styles.button} onPress={codeSent ? onVerify : onSend} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{codeSent ? 'Verify and continue' : 'Send code'}</Text>}
            </TouchableOpacity>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F8FC', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 440, backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#2D3436', marginBottom: 8 },
  lead: { fontSize: 14, lineHeight: 20, color: '#636E72', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#2D3436', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, fontSize: 16 },
  button: { backgroundColor: '#6C5CE7', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  choice: { borderWidth: 1, borderColor: '#E6E8F0', borderRadius: 12, padding: 14, marginBottom: 10 },
  choiceText: { fontSize: 16, color: '#2D3436', fontWeight: '600' },
  error: { color: '#D63031', marginTop: 12 },
});
