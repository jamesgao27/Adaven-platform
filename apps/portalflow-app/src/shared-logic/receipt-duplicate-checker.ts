// 重复小票检测模块
import { Receipt } from '@/types';
import { getAllReceipts } from './database';

// 计算字符串相似度（使用简单的编辑距离算法）
function stringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  
  // 使用 Levenshtein 距离计算相似度
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0 || len2 === 0) return 0;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替换
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 删除
        );
      }
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

// 比较两个日期是否相同或相近（同一天）
function isSameOrNearDate(date1: string, date2: string): boolean {
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    // 同一天
    if (d1.toDateString() === d2.toDateString()) return true;
    
    // 相差不超过1天
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 1;
  } catch {
    return false;
  }
}

// 比较金额是否相同或非常接近
function isAmountSimilar(amount1: number, amount2: number, tolerance: number = 0.01): boolean {
  return Math.abs(amount1 - amount2) <= tolerance;
}

// 比较商品项是否相似
function areItemsSimilar(items1: Receipt['items'], items2: Receipt['items']): boolean {
  // 如果商品数量差异很大，认为不相似
  if (Math.abs(items1.length - items2.length) > 2) return false;
  
  // 计算商品总价
  const total1 = items1.reduce((sum, item) => sum + item.price, 0);
  const total2 = items2.reduce((sum, item) => sum + item.price, 0);
  
  // 总价必须非常接近
  if (!isAmountSimilar(total1, total2, 0.01)) return false;
  
  // 如果商品数量相同，检查商品名称相似度
  if (items1.length === items2.length) {
    let matchCount = 0;
    for (const item1 of items1) {
      for (const item2 of items2) {
        const similarity = stringSimilarity(item1.name, item2.name);
        if (similarity > 0.7) {
          matchCount++;
          break;
        }
      }
    }
    // 至少 80% 的商品名称相似
    return matchCount >= items1.length * 0.8;
  }
  
  return true;
}

// 检测小票是否与已有小票重复
export async function checkDuplicateReceipt(newReceipt: Receipt): Promise<Receipt | null> {
  try {
    // 获取所有已有小票（排除当前小票本身）
    const existingReceipts = await getAllReceipts();
    const otherReceipts = existingReceipts.filter(r => r.id !== newReceipt.id);
    
    if (otherReceipts.length === 0) return null;
    
    // 遍历已有小票，查找高度一致的小票
    for (const existingReceipt of otherReceipts) {
      let matchScore = 0;
      let totalChecks = 0;
      
      // 1. 检查供应商名称相似度
      const supplierNameSimilarity = stringSimilarity(
        newReceipt.supplierName || '',
        existingReceipt.supplierName || ''
      );
      if (supplierNameSimilarity > 0.8) {
        matchScore += supplierNameSimilarity;
        totalChecks++;
      } else {
        continue; // 供应商名称差异太大，跳过
      }
      
      // 2. 检查日期是否相同或相近
      if (isSameOrNearDate(newReceipt.date, existingReceipt.date)) {
        matchScore += 1;
        totalChecks++;
      } else {
        continue; // 日期差异太大，跳过
      }
      
      // 3. 检查总金额是否相同或非常接近
      if (isAmountSimilar(newReceipt.totalAmount, existingReceipt.totalAmount, 0.01)) {
        matchScore += 1;
        totalChecks++;
      } else {
        continue; // 金额差异太大，跳过
      }
      
      // 4. 检查支付账户是否相同（如果都有支付账户）
      if (newReceipt.accountId && existingReceipt.accountId) {
        if (newReceipt.accountId === existingReceipt.accountId) {
          matchScore += 1;
          totalChecks++;
        }
      }
      
      // 5. 检查商品项是否相似
      if (areItemsSimilar(newReceipt.items, existingReceipt.items)) {
        matchScore += 1;
        totalChecks++;
      }
      
      // 如果匹配度足够高（至少 4 个条件满足，且商店名称相似度 > 0.8）
      if (totalChecks >= 4 && matchScore / totalChecks >= 0.85) {
        console.log('发现重复小票:', {
          newReceiptId: newReceipt.id,
          duplicateReceiptId: existingReceipt.id,
          matchScore: matchScore / totalChecks,
          supplierNameSimilarity,
        });
        return existingReceipt;
      }
    }
    
    return null;
  } catch (error) {
    console.error('检测重复小票时出错:', error);
    return null;
  }
}

