import React, { useState, useEffect } from 'react';
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
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/lib/categories';
import type { Category, ExpenseIncomeScope } from '@/types';
import { GradientText } from '@/lib/GradientText';
import { showToast } from '@/lib/toast';
import { confirmDestructive } from '@/lib/alertWeb';
import { TAG_COLOR_LIBRARY } from '@/lib/category-attribution-presets';
import { sortScopeTagsForDisplay } from '@/lib/sort-scope-tags-for-display';

const COLOR_OPTIONS = [...TAG_COLOR_LIBRARY];

export default function CategoriesManageScreen() {
  const router = useRouter();
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#95A5A6');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addScope, setAddScope] = useState<ExpenseIncomeScope>('expense');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#95A5A6');

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const [expense, income] = await Promise.all([
        getCategories('expense'),
        getCategories('income'),
      ]);
      setExpenseCategories(expense);
      setIncomeCategories(income);
    } catch (error) {
      console.error('Error loading categories:', error);
      showToast('Failed to load categories', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = async () => {
    if (!newName.trim()) {
      showToast('Please enter category name', 'error');
      return;
    }

    try {
      const newCategory = await createCategory(newName.trim(), newColor, addScope);
      if (addScope === 'expense') {
        setExpenseCategories(prev => sortScopeTagsForDisplay([...prev, newCategory]));
      } else {
        setIncomeCategories(prev => sortScopeTagsForDisplay([...prev, newCategory]));
      }
      setNewName('');
      setNewColor('#95A5A6');
      setShowAddForm(false);
      showToast('Category created', 'success');
    } catch (error: any) {
      console.error('Error creating category:', error);
      showToast(error.message || 'Failed to create category', 'error');
      loadCategories();
    }
  };

  const handleUpdateCategory = async (categoryId: string) => {
    if (!editName.trim()) {
      showToast('Please enter category name', 'error');
      return;
    }

    try {
      await updateCategory(categoryId, {
        name: editName.trim(),
        color: editColor,
      });
      // 乐观更新：直接更新列表中的分类，不需要重新加载所有分类
      const upd = { name: editName.trim(), color: editColor };
      setExpenseCategories(prev =>
        sortScopeTagsForDisplay(prev.map(cat => (cat.id === categoryId ? { ...cat, ...upd } : cat))),
      );
      setIncomeCategories(prev =>
        sortScopeTagsForDisplay(prev.map(cat => (cat.id === categoryId ? { ...cat, ...upd } : cat))),
      );
      setEditingId(null);
      setEditName('');
      setEditColor('#95A5A6');
      // 移除成功提示对话框
    } catch (error: any) {
      console.error('Error updating category:', error);
      showToast(error.message || 'Failed to update category', 'error');
      // 如果失败，重新加载以确保数据一致
      loadCategories();
    }
  };

  const handleDeleteCategory = async (category: Category) => {
    confirmDestructive('Delete Category', `Are you sure you want to delete "${category.name}"?`, async () => {
      try {
        await deleteCategory(category.id);
        setExpenseCategories(prev => prev.filter(cat => cat.id !== category.id));
        setIncomeCategories(prev => prev.filter(cat => cat.id !== category.id));
        showToast('Category deleted', 'success');
      } catch (error: any) {
        console.error('Error deleting category:', error);
        showToast(error.message || 'Failed to delete category', 'error');
        loadCategories();
      }
    }, { confirmLabel: 'Delete' });
  };

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('#95A5A6');
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <GradientText
            text="Item-level categories, AI-identified automatically."
            style={styles.headerTitle}
            containerStyle={styles.gradientTextContainer}
          />
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Categories List */}
        <View style={styles.categoriesList}>
          <Text style={styles.sectionLabel}>Expense categories</Text>
          {expenseCategories.map((category) => (
            <View key={category.id} style={styles.categoryCard}>
              {editingId === category.id ? (
                // Edit Mode - 三行显示
                <View style={styles.editRow}>
                  {/* 第一行：名称 */}
                  <TextInput
                    style={styles.editInputInline}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Category name"
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
                      onPress={() => handleUpdateCategory(category.id)}
                    >
                      <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                // Display Mode - 一行显示
                <View style={styles.categoryRow}>
                  <View
                    style={[
                      styles.categoryIndicator,
                      { backgroundColor: category.color },
                    ]}
                  />
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {category.name}
                  </Text>
                  <View style={styles.categoryActions}>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => startEdit(category)}
                    >
                      <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleDeleteCategory(category)}
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
              <Text style={styles.sectionLabel}>Expense category</Text>
              <TextInput
                style={styles.editInputInline}
                value={newName}
                onChangeText={setNewName}
                placeholder="Category name"
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
                  onPress={handleAddCategory}
                >
                  <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.categoryCard}
              onPress={() => { setShowAddForm(true); setAddScope('expense'); }}
            >
              <View style={styles.addCategoryRow}>
                <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                <Text style={styles.addCategoryText}>Add Expense Category</Text>
              </View>
            </TouchableOpacity>
          )}

          <Text style={[styles.sectionLabel, styles.sectionLabelAfterGroup]}>Income categories</Text>
          {incomeCategories.map((category) => (
            <View key={category.id} style={styles.categoryCard}>
              {editingId === category.id ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInputInline}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Category name"
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
                      onPress={() => handleUpdateCategory(category.id)}
                    >
                      <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.categoryRow}>
                  <View
                    style={[
                      styles.categoryIndicator,
                      { backgroundColor: category.color },
                    ]}
                  />
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {category.name}
                  </Text>
                  <View style={styles.categoryActions}>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => startEdit(category)}
                    >
                      <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleDeleteCategory(category)}
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
              <Text style={styles.sectionLabel}>Income category</Text>
              <TextInput
                style={styles.editInputInline}
                value={newName}
                onChangeText={setNewName}
                placeholder="Category name"
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
                  onPress={handleAddCategory}
                >
                  <Text style={styles.confirmButtonTextInline}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.categoryCard}
              onPress={() => { setShowAddForm(true); setAddScope('income'); }}
            >
              <View style={styles.addCategoryRow}>
                <Ionicons name="add-circle" size={20} color="#00B894" />
                <Text style={[styles.addCategoryText, { color: '#00B894' }]}>Add Income Category</Text>
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
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    marginBottom: 0,
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
  categoriesList: {
    gap: 6,
  },
  categoryCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#2D3436',
  },
  categoryActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addCategoryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C5CE7',
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
});

