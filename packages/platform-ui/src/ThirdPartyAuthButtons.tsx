import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import {
  getEnabledAuthProviders,
  signInWithOAuth,
  type AuthProviderId,
} from '@adaven/platform-core';

const LABELS: Record<AuthProviderId, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  azure: 'Continue with Microsoft',
};

type Props = {
  disabled?: boolean;
  onError?: (message: string) => void;
};

export function ThirdPartyAuthButtons({ disabled, onError }: Props) {
  const providers = getEnabledAuthProviders();
  const [busy, setBusy] = useState<AuthProviderId | null>(null);

  if (providers.length === 0) return null;

  const onPress = async (provider: AuthProviderId) => {
    if (disabled || busy) return;
    setBusy(provider);
    try {
      const { error } = await signInWithOAuth(provider);
      if (error) onError?.(error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      {providers.map((provider) => (
        <TouchableOpacity
          key={provider}
          style={[styles.button, (disabled || busy) && styles.buttonDisabled]}
          onPress={() => onPress(provider)}
          disabled={disabled || !!busy}
          activeOpacity={0.8}
        >
          {busy === provider ? (
            <ActivityIndicator color="#2D3436" />
          ) : (
            <Text style={styles.buttonText}>{LABELS[provider]}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 10 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  line: { flex: 1, height: 1, backgroundColor: '#E9ECEF' },
  or: { fontSize: 13, color: '#95A5A6' },
  button: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#2D3436' },
});
