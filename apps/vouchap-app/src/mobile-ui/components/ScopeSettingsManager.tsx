import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { GradientText } from '@/lib/GradientText';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/lib/categories';
import { getAttributions, createAttribution, updateAttribution, deleteAttribution, Attribution } from '@/lib/attributions';
import type { Category, ExpenseIncomeScope } from '@/types';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import { TAG_COLOR_LIBRARY } from '@/lib/category-attribution-presets';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';

const COLOR_OPTIONS = [...TAG_COLOR_LIBRARY];

const SCOPE_HEADER_INTRO: Record<
  ExpenseIncomeScope,
  { line1: string; line2: string }
> = {
  expense: {
    line1: 'Two dimensions for expenses',
    line2: 'Fine-grained tax matching',
  },
  income: {
    line1: 'Two dimensions for income',
    line2: 'Fine-grained tax matching',
  },
};

type EditingKind = 'category' | 'attribution' | null;
type AddKind = 'category' | 'attribution' | null;

export default function ScopeSettingsManager({ scope }: { scope: ExpenseIncomeScope }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingKind, setEditingKind] = useState<EditingKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#95A5A6');

  const [addKind, setAddKind] = useState<AddKind>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#95A5A6');

  useEffect(() => {
    void loadData();
  }, [scope]);

  const categoriesSorted = useMemo(() => sortScopeTagsForDisplay(categories), [categories]);
  const attributionsSorted = useMemo(() => sortScopeTagsForDisplay(attributions), [attributions]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [cs, ps] = await Promise.all([getCategories(scope), getAttributions(scope)]);
      setCategories(cs);
      setAttributions(ps);
    } catch (error) {
      console.error('Error loading scope settings:', error);
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (kind: Exclude<EditingKind, null>, item: { id: string; name: string; color: string }) => {
    setEditingKind(kind);
    setEditingId(item.id);
    setEditName(item.name);
    setEditColor(item.color);
  };

  const cancelEdit = () => {
    setEditingKind(null);
    setEditingId(null);
    setEditName('');
    setEditColor('#95A5A6');
  };

  const cancelAdd = () => {
    setAddKind(null);
    setNewName('');
    setNewColor('#95A5A6');
  };

  const handleUpdate = async () => {
    if (!editingKind || !editingId) return;
    if (!editName.trim()) {
      showToast('Please enter a name', 'error');
      return;
    }
    try {
      if (editingKind === 'category') {
        await updateCategory(editingId, { name: editName.trim(), color: editColor });
        setCategories((prev) =>
          sortScopeTagsForDisplay(
            prev.map((c) => (c.id === editingId ? { ...c, name: editName.trim(), color: editColor } : c)),
          ),
        );
      } else {
        await updateAttribution(editingId, { name: editName.trim(), color: editColor });
        setAttributions((prev) =>
          sortScopeTagsForDisplay(
            prev.map((p) => (p.id === editingId ? { ...p, name: editName.trim(), color: editColor } : p)),
          ),
        );
      }
      cancelEdit();
    } catch (error: any) {
      console.error('Update failed:', error);
      showToast(error?.message || 'Failed to update', 'error');
      await loadData();
    }
  };

  const handleDelete = async (kind: Exclude<EditingKind, null>, item: { id: string; name: string }) => {
    confirmDestructive(
      `Delete ${kind === 'category' ? 'Category' : 'Attribution'}`,
      `Are you sure you want to delete "${item.name}"?`,
      async () => {
        try {
          if (kind === 'category') {
            await deleteCategory(item.id);
            setCategories((prev) => prev.filter((c) => c.id !== item.id));
          } else {
            await deleteAttribution(item.id);
            setAttributions((prev) => prev.filter((p) => p.id !== item.id));
          }
          showToast('Deleted', 'success');
        } catch (error: any) {
          console.error('Delete failed:', error);
          showToast(error?.message || 'Failed to delete', 'error');
          await loadData();
        }
      },
      { confirmLabel: 'Delete' },
    );
  };

  const handleAdd = async () => {
    if (!addKind) return;
    if (!newName.trim()) {
      showToast('Please enter a name', 'error');
      return;
    }
    try {
      if (addKind === 'category') {
        const created = await createCategory(newName.trim(), newColor, scope);
        setCategories((prev) => sortScopeTagsForDisplay([...prev, created]));
      } else {
        const created = await createAttribution(newName.trim(), newColor, scope);
        setAttributions((prev) => sortScopeTagsForDisplay([...prev, created]));
      }
      cancelAdd();
      showToast('Created', 'success');
    } catch (error: any) {
      console.error('Create failed:', error);
      showToast(error?.message || 'Failed to create', 'error');
      await loadData();
    }
  };

  const renderEdit = () => (
    <View style={styles.editRow}>
      <TextInput
        style={styles.editInputInline}
        value={editName}
        onChangeText={setEditName}
        placeholder="Name"
        placeholderTextColor="#95A5A6"
      />
      <View style={styles.editColorPickerInline}>
        {COLOR_OPTIONS.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorOption,
              styles.smallColorOption,
              { backgroundColor: color },
              editColor === color && styles.colorOptionSelected,
            ]}
            onPress={() => setEditColor(color)}
          >
            {editColor === color ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.editButtonsInline}>
        <TouchableOpacity style={styles.cancelButtonInline} onPress={cancelEdit}>
          <Text style={styles.cancelButtonTextInline}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmButtonInline} onPress={handleUpdate}>
          <Text style={styles.confirmButtonTextInline}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAdd = () => (
    <View style={styles.formCard}>
      <TextInput
        style={styles.editInputInline}
        value={newName}
        onChangeText={setNewName}
        placeholder="Name"
        placeholderTextColor="#95A5A6"
      />
      <View style={styles.editColorPickerInline}>
        {COLOR_OPTIONS.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorOption,
              styles.smallColorOption,
              { backgroundColor: color },
              newColor === color && styles.colorOptionSelected,
            ]}
            onPress={() => setNewColor(color)}
          >
            {newColor === color ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.editButtonsInline}>
        <TouchableOpacity style={styles.cancelButtonInline} onPress={cancelAdd}>
          <Text style={styles.cancelButtonTextInline}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmButtonInline} onPress={handleAdd}>
          <Text style={styles.confirmButtonTextInline}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <GradientText
            text={`${SCOPE_HEADER_INTRO[scope].line1}\n${SCOPE_HEADER_INTRO[scope].line2}`}
            style={styles.headerTitle}
            containerStyle={styles.gradientTextContainer}
          />
        </View>
      </View>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C5CE7" />
        </View>
      ) : (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.categoriesList}>
            <Text style={styles.sectionLabel}>Categories</Text>
            {categoriesSorted.map((category) => (
              <View key={category.id} style={styles.categoryCard}>
                {editingKind === 'category' && editingId === category.id ? (
                  renderEdit()
                ) : (
                  <View style={styles.categoryRow}>
                    <View style={[styles.categoryIndicator, { backgroundColor: category.color }]} />
                    <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
                    <View style={styles.categoryActions}>
                      <TouchableOpacity style={styles.iconButton} onPress={() => startEdit('category', category)}>
                        <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.iconButton} onPress={() => handleDelete('category', category)}>
                        <Ionicons name="trash-outline" size={18} color="#E74C3C" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
            {addKind === 'category' ? (
              renderAdd()
            ) : (
              <TouchableOpacity style={styles.categoryCard} onPress={() => setAddKind('category')}>
                <View style={styles.addCategoryRow}>
                  <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                  <Text style={styles.addCategoryText}>Add Category</Text>
                </View>
              </TouchableOpacity>
            )}

            <Text style={[styles.sectionLabel, styles.sectionLabelAfterGroup]}>Attributions</Text>
            {attributionsSorted.map((attr) => (
              <View key={attr.id} style={styles.categoryCard}>
                {editingKind === 'attribution' && editingId === attr.id ? (
                  renderEdit()
                ) : (
                  <View style={styles.categoryRow}>
                    <View style={[styles.categoryIndicator, { backgroundColor: attr.color }]} />
                    <Text style={styles.categoryName} numberOfLines={1}>{attr.name}</Text>
                    <View style={styles.categoryActions}>
                      <TouchableOpacity style={styles.iconButton} onPress={() => startEdit('attribution', attr)}>
                        <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.iconButton} onPress={() => handleDelete('attribution', attr)}>
                        <Ionicons name="trash-outline" size={18} color="#E74C3C" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
            {addKind === 'attribution' ? (
              renderAdd()
            ) : (
              <TouchableOpacity style={styles.categoryCard} onPress={() => setAddKind('attribution')}>
                <View style={styles.addCategoryRow}>
                  <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                  <Text style={styles.addCategoryText}>Add Attribution</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  headerTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  gradientTextContainer: { alignItems: 'center', justifyContent: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  categoriesList: { gap: 6 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#636E72', marginBottom: 2 },
  sectionLabelAfterGroup: { marginTop: 10 },
  categoryCard: { backgroundColor: '#fff', borderRadius: 8, padding: 8 },
  formCard: { backgroundColor: '#fff', borderRadius: 8, padding: 8, marginBottom: 0 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#2D3436' },
  categoryActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconButton: { padding: 4 },
  addCategoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addCategoryText: { fontSize: 15, fontWeight: '600', color: '#6C5CE7' },
  editRow: { flexDirection: 'column', gap: 6 },
  editInputInline: {
    width: '100%',
    backgroundColor: '#F8F9FA',
    borderRadius: 6,
    padding: 6,
    fontSize: 15,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    marginBottom: 6,
  },
  editColorPickerInline: { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'nowrap' },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  smallColorOption: { width: 28, height: 28, borderRadius: 14 },
  colorOptionSelected: { borderColor: '#2D3436' },
  editButtonsInline: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' },
  cancelButtonInline: {
    backgroundColor: '#E9ECEF',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  confirmButtonInline: {
    backgroundColor: '#6C5CE7',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  cancelButtonTextInline: { fontSize: 15, color: '#636E72', fontWeight: '600' },
  confirmButtonTextInline: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
