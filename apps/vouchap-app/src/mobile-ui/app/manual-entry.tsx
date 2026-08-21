import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { saveReceipt } from '@/lib/database';
import { showToast } from '@/lib/toast';
import { getAccounts } from '@/lib/accounts';
import { Receipt, ReceiptStatus, Account } from '@/types';
import { format } from 'date-fns';

export default function ManualEntryScreen() {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [totalAmount, setTotalAmount] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (error) {
      console.error('Error loading payment accounts:', error);
    }
  };

  const handleSave = async () => {
    // 验证必填字段
    if (!supplierName.trim()) {
      showToast('Please enter payee name', 'error');
      return;
    }

    if (!totalAmount.trim()) {
      showToast('Please enter total amount', 'error');
      return;
    }

    const amount = parseFloat(totalAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    try {
      setIsSaving(true);

      const receipt: Receipt = {
        spaceId: '', // 会在 saveReceipt 中自动获取
        supplierName: supplierName.trim(),
        totalAmount: amount,
        date: date,
        status: 'confirmed' as ReceiptStatus,
        items: [],
        currency: 'USD',
        tax: 0,
        accountId: accountId,
      };

      const receiptId = await saveReceipt(receipt);

      // 不再显示成功弹框，直接重置表单并返回
      setSupplierName('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setTotalAmount('');
      setAccountId(undefined);
      router.back();
    } catch (error) {
      console.error('Error saving receipt:', error);
      showToast('Failed to save expense. Please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedAccount = accounts.find(acc => acc.id === accountId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#2D3436" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Expense</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Payee *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter payee name"
              placeholderTextColor="#95A5A6"
              value={supplierName}
              onChangeText={setSupplierName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date *</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#95A5A6"
              value={date}
              onChangeText={setDate}
              keyboardType="default"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Total Amount *</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor="#95A5A6"
              value={totalAmount}
              onChangeText={setTotalAmount}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Payment Account</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowAccountPicker(true)}
            >
              <Text style={[
                styles.pickerText,
                !selectedAccount && styles.pickerPlaceholder
              ]}>
                {selectedAccount ? selectedAccount.name : 'Select account'}
              </Text>
              <Ionicons name="chevron-down" size={20} color="#636E72" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="#fff" style={styles.saveButtonIcon} />
              <Text style={styles.saveButtonText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Payment Account Picker Modal */}
      {showAccountPicker && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Payment Account</Text>
              <TouchableOpacity
                onPress={() => setShowAccountPicker(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#2D3436" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              <TouchableOpacity
                style={styles.modalItem}
                onPress={() => {
                  setAccountId(undefined);
                  setShowAccountPicker(false);
                }}
              >
                <Text style={[
                  styles.modalItemText,
                  !accountId && styles.modalItemTextSelected
                ]}>
                  None
                </Text>
                {!accountId && (
                  <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                )}
              </TouchableOpacity>
              {accounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={styles.modalItem}
                  onPress={() => {
                    setAccountId(account.id);
                    setShowAccountPicker(false);
                  }}
                >
                  <Text style={[
                    styles.modalItemText,
                    accountId === account.id && styles.modalItemTextSelected
                  ]}>
                    {account.name}
                  </Text>
                  {accountId === account.id && (
                    <Ionicons name="checkmark" size={20} color="#6C5CE7" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  form: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  pickerButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  pickerText: {
    fontSize: 16,
    color: '#2D3436',
    flex: 1,
  },
  pickerPlaceholder: {
    color: '#95A5A6',
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  saveButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonIcon: {
    marginRight: 0,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalList: {
    maxHeight: 400,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F8F9FA',
  },
  modalItemText: {
    fontSize: 16,
    color: '#2D3436',
  },
  modalItemTextSelected: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
});

