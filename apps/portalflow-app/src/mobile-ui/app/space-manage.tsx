import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentSpace, getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Space, SpaceKind } from '@/types';
import { showToast } from '@/lib/toast';

export default function SpaceManageScreen() {
  const router = useRouter();
  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [spaceAddress, setSpaceAddress] = useState('');
  const [spaceKind, setSpaceKind] = useState<SpaceKind>('consumer');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSpace();
  }, []);

  const loadSpace = async () => {
    try {
      setLoading(true);
      const data = await getCurrentSpace();
      if (data) {
        setSpace(data);
        setSpaceName(data.name);
        setSpaceAddress(data.address || '');
        setSpaceKind((data.kind as SpaceKind) || 'consumer');
      }
    } catch (error) {
      console.error('Error loading space:', error);
      showToast('Failed to load space information', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!space || !spaceName.trim()) {
      showToast('Space name cannot be empty', 'error');
      return;
    }

    try {
      setSaving(true);
      const user = await getCurrentUser();
      if (!user) throw new Error('Not logged in');

      // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
      const spaceId = user.currentSpaceId || user.spaceId;
      if (!spaceId) throw new Error('No space selected');

      const { error } = await supabase
        .from('spaces')
        .update({ 
          name: spaceName.trim(),
          address: spaceAddress.trim() || null,
          kind: spaceKind,
        })
        .eq('id', spaceId);

      if (error) throw error;

      showToast('Space information updated', 'success');
      setEditing(false);
      await loadSpace();
    } catch (error) {
      console.error('Error updating space:', error);
      showToast('Failed to update space information', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (space) {
      setSpaceName(space.name);
      setSpaceAddress(space.address || '');
      setSpaceKind((space.kind as SpaceKind) || 'consumer');
    }
    setEditing(false);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Space Information</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons
              name="storefront-outline"
              size={18}
              color="#6C5CE7"
            />
            <Text style={styles.cardTitle}>Space Name</Text>
          </View>
          
          {editing ? (
            <View style={styles.editContainer}>
              <TextInput
                style={styles.input}
                value={spaceName}
                onChangeText={setSpaceName}
                placeholder="Enter space name"
                autoFocus
              />
            </View>
          ) : (
            <View style={styles.viewContainer}>
              <Text style={styles.spaceName} numberOfLines={3}>{space?.name || 'N/A'}</Text>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setEditing(true)}
              >
                <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="document-text-outline" size={18} color="#6C5CE7" />
            <Text style={styles.cardTitle}>Address</Text>
          </View>
          
          {editing ? (
            <View style={styles.editContainer}>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={spaceAddress}
                onChangeText={setSpaceAddress}
                placeholder="Enter space address (optional)"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          ) : (
            <View style={styles.viewContainer}>
              <Text style={styles.spaceName} numberOfLines={5}>{space?.address || 'Not set'}</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="business-outline" size={18} color="#6C5CE7" />
            <Text style={styles.cardTitle}>空间类型</Text>
          </View>
          {editing ? (
            <View style={styles.kindRow}>
              <TouchableOpacity
                style={[styles.kindOption, spaceKind === 'client' && styles.kindOptionSelected]}
                onPress={() => setSpaceKind('consumer')}
                activeOpacity={0.7}
              >
                <Text style={[styles.kindOptionText, spaceKind === 'client' && styles.kindOptionTextSelected]}>Client</Text>
                <Text style={styles.kindHint}>普通客户空间</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.kindOption, spaceKind === 'firm' && styles.kindOptionSelected]}
                onPress={() => setSpaceKind('provider')}
                activeOpacity={0.7}
              >
                <Text style={[styles.kindOptionText, spaceKind === 'firm' && styles.kindOptionTextSelected]}>Firm</Text>
                <Text style={styles.kindHint}>服务端/事务所空间</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.viewContainer}>
              <Text style={styles.spaceName}>{spaceKind === 'firm' ? 'Firm（服务端）' : 'Client（普通客户）'}</Text>
            </View>
          )}
        </View>

        {editing && (
          <View style={styles.card}>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleCancel}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.saveButton]}
                onPress={handleSave}
                disabled={saving || !spaceName.trim()}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.linkCard}
          onPress={() => router.push('/space-orders' as any)}
          activeOpacity={0.7}
        >
          <Ionicons name="receipt-outline" size={22} color="#6C5CE7" />
          <View style={styles.linkCardTextWrap}>
            <Text style={styles.linkCardTitle}>Subscription and billing</Text>
            <Text style={styles.linkCardHint}>Plans, invoices, and payment history</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#95A5A6" />
        </TouchableOpacity>

        {space && (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Created:</Text>
              <Text style={styles.infoValue}>
                {space.createdAt ? new Date(space.createdAt).toLocaleDateString() : 'N/A'}
              </Text>
            </View>
            {space.updatedAt && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Last Updated:</Text>
                <Text style={styles.infoValue}>
                  {new Date(space.updatedAt).toLocaleDateString()}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3436',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    gap: 12,
  },
  linkCardTextWrap: {
    flex: 1,
  },
  linkCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
  },
  linkCardHint: {
    fontSize: 13,
    color: '#636E72',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginLeft: 6,
  },
  viewContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  viewContent: {
    flex: 1,
    marginRight: 8,
  },
  spaceName: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    fontWeight: '400',
    lineHeight: 20,
  },
  spaceAddress: {
    fontSize: 14,
    color: '#636E72',
    lineHeight: 20,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F0F4FF',
  },
  editButtonText: {
    fontSize: 13,
    color: '#6C5CE7',
    fontWeight: '600',
    marginLeft: 4,
  },
  editContainer: {
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#2D3436',
    backgroundColor: '#F8F9FA',
    marginBottom: 12,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  kindRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  kindOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E9ECEF',
    backgroundColor: '#F8F9FA',
  },
  kindOptionSelected: {
    borderColor: '#6C5CE7',
    backgroundColor: '#F0F4FF',
  },
  kindOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  kindOptionTextSelected: {
    color: '#6C5CE7',
  },
  kindHint: {
    fontSize: 12,
    color: '#95A5A6',
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#E9ECEF',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  saveButton: {
    backgroundColor: '#6C5CE7',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#636E72',
  },
  infoValue: {
    fontSize: 14,
    color: '#2D3436',
    fontWeight: '500',
  },
});

