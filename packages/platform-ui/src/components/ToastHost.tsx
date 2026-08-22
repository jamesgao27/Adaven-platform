import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { subscribeToast, type ToastPayload } from '../lib/toast';

export function ToastHost() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsubscribe = subscribeToast((payload) => {
      setToast(payload);
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(payload.duration),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToast(null);
      });
    });
    return unsubscribe;
  }, [opacity]);

  if (!toast) return null;

  const isCenterSuccess = toast.type === 'success' && toast.variant === 'center-success';

  // 默认：success/info 用中性灰，error 用红色；center-success 使用亮绿色
  const backgroundColor =
    toast.type === 'error' ? '#e74c3c' : isCenterSuccess ? '#16a34a' : '#2d3436';

  return (
    <View
      pointerEvents="none"
      style={[styles.container, isCenterSuccess && styles.containerCenter]}
    >
      <Animated.View
        style={[
          styles.toast,
          isCenterSuccess && styles.toastCenterSuccess,
          { opacity, backgroundColor },
        ]}
      >
        <Text style={[styles.text, isCenterSuccess && styles.textCenterSuccess]}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 80 : 60,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  containerCenter: {
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  toast: {
    maxWidth: '90%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  toastCenterSuccess: {
    maxWidth: '80%',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
  },
  text: {
    color: '#fff',
    fontSize: 14,
  },
  textCenterSuccess: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

