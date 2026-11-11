import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const CODE_LENGTH = 6;

type Props = {
  email: string;
  title: string;
  message: string;
  submitLabel: string;
  autoSubmit?: boolean;
  children?: ReactNode;
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack?: () => void;
};

export function EmailCodeStep({
  email,
  title,
  message,
  submitLabel,
  autoSubmit = false,
  children,
  onSubmit,
  onResend,
  onBack,
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (next = code) => {
    if (busy || next.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code could not be verified.');
    } finally {
      setBusy(false);
    }
  };

  const onChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (autoSubmit && digits.length === CODE_LENGTH) {
      void submit(digits);
    }
  };

  const resend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      await onResend();
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.back}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.email}>{email}</Text>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          autoFocus
          style={styles.hiddenInput}
        />
        <TouchableOpacity activeOpacity={1} onPress={() => inputRef.current?.focus()} style={styles.cells}>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <View key={index} style={[styles.cell, code.length === index && styles.cellActive]}>
              <Text style={styles.digit}>{code[index] ?? ''}</Text>
            </View>
          ))}
        </TouchableOpacity>
        {children}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, (busy || code.length !== CODE_LENGTH) && styles.buttonDisabled]}
          onPress={() => submit()}
          disabled={busy || code.length !== CODE_LENGTH}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={resend} disabled={busy || cooldown > 0}>
          <Text style={styles.resend}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
  },
  back: { marginBottom: 16 },
  backText: { color: '#6C5CE7', fontSize: 15, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '700', color: '#2D3436' },
  message: { marginTop: 8, fontSize: 15, lineHeight: 22, color: '#636E72' },
  email: { marginTop: 4, fontSize: 15, fontWeight: '600', color: '#2D3436' },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
  cells: { flexDirection: 'row', gap: 8, marginTop: 24 },
  cell: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: '#6C5CE7' },
  digit: { fontSize: 24, fontWeight: '700', color: '#2D3436' },
  error: { marginTop: 12, color: '#E74C3C', fontSize: 14 },
  button: {
    marginTop: 20,
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resend: { marginTop: 16, textAlign: 'center', color: '#6C5CE7', fontSize: 14, fontWeight: '600' },
});
