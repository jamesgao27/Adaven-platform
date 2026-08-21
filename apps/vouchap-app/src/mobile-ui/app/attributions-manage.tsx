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
import {
  getAttributions,
  createAttribution,
  updateAttribution,
  deleteAttribution,
  Attribution,
} from '@/lib/attributions';
import type { ExpenseIncomeScope } from '@/types';
import { GradientText } from '@/lib/GradientText';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import { TAG_COLOR_LIBRARY } from '@/lib/category-attribution-presets';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';

const COLOR_OPTIONS = [...TAG_COLOR_LIBRARY];

export default function AttributionsManageScreen() {
  const router = useRouter();
  const [expenseAttributions, setExpenseAttributions] = useState<Attribution[]>([]);
  const [incomeAttributions, setIncomeAttributions] = useState<Attribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#95A5A6');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addScope, setAddScope] = useState<ExpenseIncomeScope>('expense');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#95A5A6');

  useEffect(() => {
    loadAttributions();
  }, []);

  const loadAttributions = async () => {
    try {
      setLoading(true);
      const [expense, income] = await Promise.all([
        getAttributions('expense'),
        getAttributions('income'),
      ]);
      setExpenseAttributions(expense);
      setIncomeAttributions(income);
    } catch (error) {
      console.error('Error loading attributions:', error);
      showToast('Failed to load attributions', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddAttribution = async () => {
    if (!newName.trim()) {
      showToast('Please enter attribution name', 'error');
      return;
    }

    try {
      const created = await createAttribution(newName.trim(), newColor, addScope);
      if (addScope === 'expense') {
        setExpenseAttributions(prev => sortScopeTagsForDisplay([...prev, created]));
      } else {
        setIncomeAttributions(prev => sortScopeTagsForDisplay([...prev, created]));
      }
      setNewName('');
      setNewColor('#95A5A6');
      setShowAddForm(false);
      showToast('Attribution created', 'success');
    } catch (error: any) {
      console.error('Error creating attribution:', error);
      showToast(error.message || 'Failed to create attribution', 'error');
      loadAttributions();
    }
  };

  const handleUpdateAttribution = async (attributionId: string) => {
    if (!editName.trim()) {
      showToast('Please enter attribution name', 'error');
      return;
    }

    try {
      await updateAttribution(attributionId, {
        name: editName.trim(),
        color: editColor,
      });
      const upd = { name: editName.trim(), color: editColor };
      setExpenseAttributions(prev =>
        sortScopeTagsForDisplay(prev.map(p => (p.id === attributionId ? { ...p, ...upd } : p))),
      );
      setIncomeAttributions(prev =>
        sortScopeTagsForDisplay(prev.map(p => (p.id === attributionId ? { ...p, ...upd } : p))),
      );
      setEditingId(null);
      setEditName('');
      setEditColor('#95A5A6');
      // 移除成功提示对话框
    } catch (error: any) {
      console.error('Error updating attribution:', error);
      showToast(error.message || 'Failed to update attribution', 'error');
      // 如果失败，重新加载以确保数据一致
      loadAttributions();
    }
  };

  const handleDeleteAttribution = async (attribution: Attribution) => {
    confirmDestructive('Delete Attribution', `Are you sure you want to delete "${attribution.name}"?`, async () => {
      try {
        await deleteAttribution(attribution.id);
        setExpenseAttributions(prev => prev.filter(p => p.id !== attribution.id));
        setIncomeAttributions(prev => prev.filter(p => p.id !== attribution.id));
        showToast('Attribution deleted', 'success');
      } catch (error: any) {
        console.error('Error deleting attribution:', error);
        showToast(error.message || 'Failed to delete attribution', 'error');
        loadAttributions();
      }
    }, { confirmLabel: 'Delete' });
  };

  const startEdit = (attribution: Attribution) => {
    setEditingId(attribution.id);
    setEditName(attribution.name);
    setEditColor(attribution.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('#95A5A6');
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
        <View style={styles.headerTitleContainer}>
          <GradientText
            text="Tag expense attributions and income sources for every transaction."
            style={styles.headerTitle}
            containerStyle={styles.gradientTextContainer}
          />
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.attributionsList}>
          <Text style={styles.sectionLabel}>Expense attributions</Text>
          {expenseAttributions.map((attribution) => (
            <View key={attribution.id} style={styles.attributionCard}>
              {editingId === attribution.id ? (
                // Edit Mode - 三行显示
                <View style={styles.editRow}>
                  {/* 第一行：名称 */}
                  <TextInput
                    style={styles.editInputInline}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Attribution name"
                    placeholderTextColor="#95A5A6"
                  />
                  {/* 第二行：颜色 */}
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
                        {editColor === color && (
                          <Ionicons name="checkmark" size={10} color="#fff" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* 第三行：确认取消按钮 */}
                  <View style={styles.editButtonsInline}>
                    <TouchableOpacity
                      style={styles.cancelButtonInline}
                      onPress={cancelEdit}
                    >
                      <Text style={styles.cancelButtonTextInline}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmButtonInline}
                      onPress={() => handleUpdateAttribution(attribution.id)}
                    >
                      <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                // Display Mode - 一行显示
                <View style={styles.attributionRow}>
                  <View
                    style={[
                      styles.attributionIndicator,
                      { backgroundColor: attribution.color },
                    ]}
                  />
                  <Text style={styles.attributionNameText} numberOfLines={1}>
                    {attribution.name}
                  </Text>
                  <View style={styles.attributionActions}>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => startEdit(attribution)}
                    >
                      <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleDeleteAttribution(attribution)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#E74C3C" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}
          {showAddForm && addScope === 'expense' ? (
            <View style={styles.formCard}>
              <Text style={styles.sectionLabel}>Expense attribution</Text>
              <TextInput
                style={styles.editInputInline}
                value={newName}
                onChangeText={setNewName}
                placeholder="Attribution name"
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
                    {newColor === color && (
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.editButtonsInline}>
                <TouchableOpacity
                  style={styles.cancelButtonInline}
                  onPress={() => {
                    setShowAddForm(false);
                    setNewName('');
                    setNewColor('#95A5A6');
                  }}
                >
                  <Text style={styles.cancelButtonTextInline}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButtonInline}
                  onPress={handleAddAttribution}
                >
                  <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.attributionCard}
              onPress={() => { setShowAddForm(true); setAddScope('expense'); }}
            >
              <View style={styles.addAttributionRow}>
                <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                <Text style={styles.addAttributionText}>Add Expense Attribution</Text>
              </View>
            </TouchableOpacity>
          )}

          <Text style={[styles.sectionLabel, styles.sectionLabelAfterGroup]}>Income sources</Text>
          {incomeAttributions.map((attribution) => (
            <View key={attribution.id} style={styles.attributionCard}>
              {editingId === attribution.id ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInputInline}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Attribution name"
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
                        {editColor === color && (
                          <Ionicons name="checkmark" size={10} color="#fff" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.editButtonsInline}>
                    <TouchableOpacity
                      style={styles.cancelButtonInline}
                      onPress={cancelEdit}
                    >
                      <Text style={styles.cancelButtonTextInline}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmButtonInline}
                      onPress={() => handleUpdateAttribution(attribution.id)}
                    >
                      <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.attributionRow}>
                  <View
                    style={[
                      styles.attributionIndicator,
                      { backgroundColor: attribution.color },
                    ]}
                  />
                  <Text style={styles.attributionNameText} numberOfLines={1}>
                    {attribution.name}
                  </Text>
                  <View style={styles.attributionActions}>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => startEdit(attribution)}
                    >
                      <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleDeleteAttribution(attribution)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#E74C3C" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}
          {showAddForm && addScope === 'income' ? (
            <View style={styles.formCard}>
              <Text style={styles.sectionLabel}>Income source</Text>
              <TextInput
                style={styles.editInputInline}
                value={newName}
                onChangeText={setNewName}
                placeholder="Attribution name"
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
                    {newColor === color && (
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.editButtonsInline}>
                <TouchableOpacity
                  style={styles.cancelButtonInline}
                  onPress={() => {
                    setShowAddForm(false);
                    setNewName('');
                    setNewColor('#95A5A6');
                  }}
                >
                  <Text style={styles.cancelButtonTextInline}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButtonInline}
                  onPress={handleAddAttribution}
                >
                  <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.attributionCard}
              onPress={() => { setShowAddForm(true); setAddScope('income'); }}
            >
              <View style={styles.addAttributionRow}>
                <Ionicons name="add-circle" size={20} color="#00B894" />
                <Text style={[styles.addAttributionText, { color: '#00B894' }]}>Add Income Source</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
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
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  gradientTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 4,
    marginTop: 2,
  },
  sectionLabelAfterGroup: {
    marginTop: 12,
  },
  attributionsList: {
    gap: 6,
  },
  attributionCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    marginBottom: 0,
  },
  addAttributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addAttributionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attributionIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attributionNameText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#2D3436',
  },
  attributionActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  iconButton: {
    padding: 4,
  },
  editRow: {
    flexDirection: 'column',
    gap: 6,
  },
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
  editColorPickerInline: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'nowrap',
  },
  editButtonsInline: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
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
  cancelButtonTextInline: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  confirmButtonTextInline: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  smallColorOption: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorOptionSelected: {
    borderColor: '#2D3436',
  },
});

