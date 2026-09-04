/**
 * Firm 待审核遮罩：用于首页及所有 firm 子模块（Web 左侧栏切换时主内容区统一显示）。
 */
import React from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 40,
    paddingVertical: 44,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardWeb: {
    maxWidth: 720,
    padding: 48,
    paddingVertical: 52,
  },
  cardMobile: {
    alignSelf: 'stretch',
    maxWidth: undefined,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  icon: {
    marginBottom: 28,
    alignSelf: 'center',
  },
  bulletList: {
    gap: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  bullet: {
    fontSize: 18,
    color: '#6C5CE7',
    lineHeight: 26,
  },
  text: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    color: '#2D3436',
    textAlign: 'left',
    lineHeight: 26,
  },
  link: {
    color: '#6C5CE7',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});

export function FirmPendingOverlay() {
  return (
    <View style={styles.overlay}>
      <View style={[styles.card, Platform.OS === 'web' && styles.cardWeb, Platform.OS !== 'web' && styles.cardMobile]}>
        <Ionicons name="time-outline" size={48} color="#6C5CE7" style={styles.icon} />
        <View style={styles.bulletList}>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>Your registered firm is under review.</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>Portalflow will notify you once it&apos;s approved.</Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>
              If you need expedited review, please contact us:{' '}
              <Text style={styles.link} onPress={() => Linking.openURL('mailto:support@portalflow.app')}>
                support@portalflow.app
              </Text>
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
