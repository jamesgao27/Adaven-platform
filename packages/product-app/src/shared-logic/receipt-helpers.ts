import { GeminiReceiptResult, GeminiVoucherResult, GeminiInboundOutboundResult, Receipt, ReceiptStatus, Invoice, InvoiceItem, Inbound, InboundItem, Outbound, OutboundItem, VoucherStatus } from '@/types';
import { getCurrentUser } from './auth';
import { findCategoryByName, getCategories } from './categories';
import { findAttributionByName, getAttributions } from './attributions';
import {
  extractCardSuffix,
  findOrCreateAccount,
  normalizeCardLastFourDigits,
  resolveAccountByCardLastFourDigits,
} from './accounts';
import { findOrCreateEntity } from './entities';
import { findOrCreateWarehouseByName, findOrCreateLocationByName } from './warehouse';
import { findOrCreateSkuByNameAndUnit } from './skus';
import { aliasDistinctFromLineName, pickReceiptLineItemAlias } from './receipt-item-alias';
import { coerceReceiptTaxBreakdownEntries } from './receipt-tax-breakdown';

/** Same idea as gemini.ts paymentAccountLabelIsCardTypeOnly — avoid creating accounts named "VISA CREDIT" with no digits. */
function isPaymentAccountLabelCardTypeOnly(name: string): boolean {
  const t = name.trim();
  if (!t) return false;
  if (extractCardSuffix(t)) return false;
  if (/^visa(\s+credit|\s+debit|\s+purchase|\s+chk)?$/i.test(t)) return true;
  if (/^mastercard(\s+credit|\s+debit)?$/i.test(t)) return true;
  if (/^mc(\s+credit|\s+debit)?$/i.test(t)) return true;
  if (/^amex$|^american\s+express$/i.test(t)) return true;
  if (/^debit(\s+card)?$|^credit(\s+card)?$/i.test(t)) return true;
  if (/^chip\s+card$/i.test(t)) return true;
  if (/^visa\s+tend$/i.test(t)) return true;
  if (/^interac\b/i.test(t)) return true;
  if (/^(visa|mastercard|master\s+card|mc|discover|eftpos)$/i.test(t)) return true;
  return false;
}

/**
 * Prefer matching by card last-4 to existing space accounts (e.g. receipt "Visa ****1102" → account "credit card ****1102"),
 * then fall back to findOrCreate by name. Avoids creating "VISA" when digits are present on another line.
 */
export async function resolveAccountIdFromGeminiPaymentFields(input: {
  paymentAccountName?: string;
  paymentCardLastFour?: string;
}): Promise<string | undefined> {
  const name = input.paymentAccountName?.trim() || undefined;
  const lastFour =
    normalizeCardLastFourDigits(input.paymentCardLastFour) ??
    (name ? extractCardSuffix(name) : null) ??
    undefined;

  try {
    if (lastFour) {
      const bySuffix = await resolveAccountByCardLastFourDigits(lastFour);
      if (bySuffix) return bySuffix.id;
    }
    if (name && !isPaymentAccountLabelCardTypeOnly(name)) {
      const account = await findOrCreateAccount(name, true);
      return account.id;
    }
    if (lastFour) {
      const account = await findOrCreateAccount(`Card ****${lastFour}`, true);
      return account.id;
    }
  } catch (error) {
    console.warn('Failed to resolve payment account from Gemini fields:', error);
  }
  return undefined;
}

function fallbackExpenseItemPrice(totalAmount?: number, tax?: number): number {
  const total = Number(totalAmount ?? 0);
  const taxNum = Number(tax ?? 0);
  const base = total - taxNum;
  if (Number.isFinite(base) && base > 0) return base;
  if (Number.isFinite(total) && total > 0) return total;
  return 0;
}

// 将 Gemini 识别结果转换为 Receipt 格式
export async function convertGeminiResultToReceipt(result: GeminiReceiptResult): Promise<Receipt> {
  const user = await getCurrentUser(true);
  if (!user) throw new Error('Not logged in');

  // 支出：获取支出分类与用途
  const categories = await getCategories('expense');
  const attributions = await getAttributions('expense');

  // 处理关联方 Payee（排除无效名称）
  let entityId: string | undefined;
  const payeeName = result.supplierName;
  if (payeeName && payeeName.trim()) {
    const trimmed = payeeName.trim();
    const invalidNames = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];
    const isValidName = !invalidNames.includes(trimmed.toLowerCase());
    if (isValidName) {
      try {
        const entity = await findOrCreateEntity(
          trimmed,
          true,
          result.supplierInfo?.taxNumber,
          result.supplierInfo?.phone,
          result.supplierInfo?.address
        );
        entityId = entity.id;
      } catch (error) {
        console.warn('Failed to create or find entity (Payee):', error);
      }
    } else {
      console.warn(`Skipping invalid supplier name: "${trimmed}"`);
    }
  }

  // 处理支付账户（优先卡尾号对齐已有账户，再按名称 findOrCreate）
  const accountId = await resolveAccountIdFromGeminiPaymentFields({
    paymentAccountName: result.paymentAccountName,
    paymentCardLastFour: result.paymentCardLastFour,
  });

  // 处理商品项，匹配分类。若模型缺失明细，兜底为一条合并行，避免“识别成功但无 item”。
  if (!result.items || !Array.isArray(result.items) || result.items.length === 0) {
    console.warn('No valid items found in Gemini result, creating merged fallback item');
    result.items = [
      {
        name: 'Receipt total (merged)',
        categoryName: 'Other',
        attributionName: 'Personal',
        price: fallbackExpenseItemPrice(result.totalAmount, result.tax),
      } as any,
    ];
  }
  
  console.log('Processing items:', result.items.length, 'items found');
  
  const items = await Promise.all(
    result.items.map(async (item) => {
      // 尝试匹配分类名称
      const normalizedCategoryName = (
        item.categoryName ??
        item.name ??
        (item as { description?: string }).description ??
        'Other'
      ).toString();
      let category = categories.find((cat) =>
        cat.name.toLowerCase() === normalizedCategoryName.toLowerCase()
      );

      // 如果找不到，尝试使用 findCategoryByName（模糊匹配）
      if (!category) {
        const foundCategory = await findCategoryByName(normalizedCategoryName, 'expense');
        category = foundCategory || undefined;
      }

      if (!category) {
        console.warn(`分类 "${item.categoryName}" 未找到，尝试使用默认分类`);
        const defaultCategoryNames = ['Meal', 'Shopping', 'Food', '购物', '食品', 'Other', 'Grocery'];
        for (const defaultName of defaultCategoryNames) {
          category = categories.find((cat) => 
            cat.name === defaultName || cat.name.toLowerCase() === defaultName.toLowerCase()
          );
          if (category) break;
        }
        
        // 如果还是找不到，尝试找任何一个默认分类
        if (!category) {
          category = categories.find((cat) => cat.isDefault);
        }
        
        // 如果仍然找不到，尝试找第一个分类（至少有一个分类）
        if (!category && categories.length > 0) {
          category = categories[0];
          console.warn(`使用第一个可用分类: ${category.name}`);
        }
        
        if (!category) {
          throw new Error(
            'Default category not found.\n\n' +
            'Please do one of the following:\n' +
            '1. Execute add-default-categories-for-existing-users.sql in Supabase SQL Editor\n' +
            '2. Or manually create at least one category in the app\n\n' +
            'Current user space ID: ' + (user.spaceId || 'Unknown')
          );
        }
      }

      // Match attribution (accept attributionName; legacy purpose / purposeName)
      let attributionId: string | null = null;
      let matchedAttribution: (typeof attributions)[0] | undefined;
      const nameFromModel =
        item.attributionName
        ?? item.purposeName
        ?? (item as { purpose?: string }).purpose;
      if (nameFromModel) {
        matchedAttribution =
          attributions.find(p => p.name.toLowerCase() === nameFromModel.toLowerCase())
          || await findAttributionByName(nameFromModel, 'expense');
        if (matchedAttribution) attributionId = matchedAttribution.id;
      }

      if (!attributionId && attributions.length > 0) {
        const fallback = attributions.find(p => p.isDefault) || attributions[0];
        if (fallback) {
          attributionId = fallback.id;
          matchedAttribution = fallback;
          if (nameFromModel) {
            console.warn(`Attribution "${nameFromModel}" not found; using default: ${fallback.name}`);
          }
        }
      }

      // 兼容 API 返回 description 而非 name（如语音识别返回 "description": "租车"）
      const itemName = item.name ?? (item as { description?: string }).description ?? 'Unknown Item';
      const itemAlias = aliasDistinctFromLineName(
        String(itemName),
        pickReceiptLineItemAlias(item as Record<string, unknown>),
      );
      // 兼容 API 返回 amount 而非 price（如语音识别返回 "amount": 1200）
      const itemPrice = Number((item as { price?: number; amount?: number }).price ?? (item as { amount?: number }).amount ?? 0);
      return {
        name: itemName,
        itemAlias,
        categoryId: category.id,
        category: category,
        attributionId,
        attribution: attributionId
          ? (matchedAttribution ?? attributions.find((p) => p.id === attributionId) ?? null)
          : null,
        price: itemPrice,
        isAsset: item.isAsset || false,
        confidence: item.confidence,
      };
    })
  );

  if (items.length === 0) {
    const defaultCategory =
      categories.find((c) => c.isDefault) ??
      categories.find((c) => ['Other', 'Shopping', 'Meal', 'Food', 'Grocery'].includes(c.name)) ??
      categories[0];
    if (!defaultCategory) {
      throw new Error('No category available to create fallback receipt item');
    }
    const fallbackAttribution = attributions.find((p) => p.isDefault) ?? attributions[0] ?? null;
    items.push({
      name: 'Receipt total (merged)',
      categoryId: defaultCategory.id,
      category: defaultCategory,
      attributionId: fallbackAttribution?.id ?? null,
      attribution: fallbackAttribution,
      price: fallbackExpenseItemPrice(result.totalAmount, result.tax),
      isAsset: false,
      confidence: result.confidence,
    });
  }

  // 计算调整后的置信度（基于多个因素）
  let adjustedConfidence = result.confidence || 0.5;
  
  // 1. 检查明细金额总和与总金额是否一致
  const itemsSum = items.reduce((sum, item) => sum + item.price, 0);
  const expectedTotal = itemsSum + (result.tax || 0);
  const totalAmount = result.totalAmount || 0;
  const amountDifference = Math.abs(expectedTotal - totalAmount);
  const amountMatches = amountDifference <= 0.01; // 允许 0.01 的误差
  
  // 2. 检查数据一致性
  const dataConsistency = result.dataConsistency;
  const itemsSumMatches = dataConsistency?.itemsSumMatchesTotal ?? amountMatches;
  const hasMissingItems = dataConsistency?.missingItems ?? (!amountMatches && itemsSum < totalAmount);
  
  // 3. 检查图片质量
  const imageQuality = result.imageQuality;
  const clarity = imageQuality?.clarity ?? 0.8;
  const completeness = imageQuality?.completeness ?? 0.8;
  
  // 4. 调整置信度
  // 如果明细金额不匹配，降低置信度
  if (!itemsSumMatches) {
    const differenceRatio = amountDifference / Math.max(totalAmount, 1);
    if (differenceRatio > 0.1) {
      // 差异超过 10%，大幅降低置信度
      adjustedConfidence = Math.max(0.2, adjustedConfidence - 0.3);
    } else if (differenceRatio > 0.05) {
      // 差异在 5-10%，中等降低
      adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.2);
    } else {
      // 差异在 5% 以内，轻微降低
      adjustedConfidence = Math.max(0.4, adjustedConfidence - 0.1);
    }
  }
  
  // 如果有遗漏的商品项，降低置信度
  if (hasMissingItems) {
    adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.15);
  }
  
  // 图片清晰度影响置信度
  if (clarity < 0.7) {
    adjustedConfidence = Math.max(0.2, adjustedConfidence - 0.1);
  }
  
  // 图片完整度影响置信度
  if (completeness < 0.8) {
    adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.1);
  }
  
  // 如果明细金额匹配且图片质量好，可以提高置信度（完整度 >= 0.8 即给予加分，便于图片识别达到 0.85）
  if (itemsSumMatches && !hasMissingItems && clarity >= 0.8 && completeness >= 0.8) {
    adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
  }
  
  // 根据调整后的置信度自动设置状态
  // 置信度 >= 0.85: confirmed (已确认)
  // 置信度 < 0.4: needs_retake (需重拍)
  // 其他: pending (待确认)
  // 图片识别：若模型返回的原始置信度 >= 0.85 且图片质量可接受，也直接设为已确认，确保 0.85 生效
  const rawConfidence = result.confidence ?? 0;
  const imageQualityOk = (imageQuality?.clarity ?? 1) >= 0.7 && (imageQuality?.completeness ?? 1) >= 0.8;
  const highConfidenceImage = imageQuality != null && rawConfidence >= 0.85 && imageQualityOk;

  let status: ReceiptStatus = 'pending';
  if (adjustedConfidence >= 0.85 || highConfidenceImage) {
    status = 'confirmed';
  } else if (adjustedConfidence < 0.4) {
    status = 'needs_retake';
  } else {
    status = 'pending';
  }
  
  console.log('Confidence calculation:', {
    originalConfidence: result.confidence,
    adjustedConfidence,
    highConfidenceImage,
    itemsSum,
    totalAmount,
    tax: result.tax || 0,
    expectedTotal,
    amountDifference,
    itemsSumMatches,
    hasMissingItems,
    clarity,
    completeness,
    finalStatus: status,
  });

  const spaceId = user.spaceId || user.currentSpaceId;
  if (!spaceId) {
    throw new Error('User must have a space selected');
  }

  const taxBreakdown =
    coerceReceiptTaxBreakdownEntries(result.taxBreakdown, null) ?? undefined;

  return {
    spaceId: spaceId,
    supplierName: result.supplierName,
    entityId: entityId,
    totalAmount: result.totalAmount,
    currency: result.currency,
    currencyPrintedOnReceipt: result.currencyPrintedOnReceipt === true,
    tax: result.tax,
    taxBreakdown,
    date: result.date,
    accountId: accountId,
    status: status,
    items: items,
    confidence: adjustedConfidence, // 使用调整后的置信度
  };
}

/**
 * When convertGeminiResultToReceipt throws (e.g. category edge case), still persist line items
 * from the model JSON using default category/attribution so receipt_items are not left empty.
 */
export async function buildExpenseReceiptFallbackFromGemini(
  result: GeminiReceiptResult,
): Promise<Receipt> {
  const user = await getCurrentUser(true);
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const categories = await getCategories('expense');
  const category =
    categories.find((c) => c.isDefault) ??
    categories.find((c) => ['Other', 'Shopping', 'Meal', 'Food', 'Grocery'].includes(c.name)) ??
    categories[0];
  if (!category) throw new Error('No category available for fallback receipt item');

  const attributions = await getAttributions('expense');
  const attribution = attributions.find((a) => a.isDefault) ?? attributions[0] ?? null;

  const rawItems = Array.isArray(result.items) ? result.items : [];
  const tax = Number(result.tax ?? 0) || 0;
  const total = Number(result.totalAmount ?? 0) || 0;

  const items: Receipt['items'] =
    rawItems.length > 0
      ? rawItems.map((item) => {
          const name =
            String(
              item.name ?? (item as { description?: string }).description ?? '',
            ).trim() || 'Receipt item';
          const price =
            Number((item as { price?: number; amount?: number }).price ?? (item as { amount?: number }).amount ?? 0) ||
            0;
          return {
            name,
            categoryId: category.id,
            category,
            attributionId: attribution?.id ?? null,
            attribution,
            price,
            isAsset: Boolean(item.isAsset),
            confidence: item.confidence ?? result.confidence,
          };
        })
      : [
          {
            name: 'Receipt total (merged)',
            categoryId: category.id,
            category,
            attributionId: attribution?.id ?? null,
            attribution,
            price: fallbackExpenseItemPrice(total, tax),
            isAsset: false,
            confidence: result.confidence,
          },
        ];

  const taxBreakdown =
    coerceReceiptTaxBreakdownEntries(result.taxBreakdown, null) ?? undefined;

  return {
    spaceId,
    supplierName: result.supplierName,
    totalAmount: total,
    currency: result.currency,
    currencyPrintedOnReceipt: result.currencyPrintedOnReceipt === true,
    tax,
    taxBreakdown,
    date: result.date,
    status: 'pending',
    items,
    confidence: result.confidence ?? 0.5,
  };
}

/** Primary convert with fallback line items when category/entity matching throws. */
export async function convertGeminiResultToReceiptResilient(
  result: GeminiReceiptResult,
): Promise<Receipt> {
  try {
    return await convertGeminiResultToReceipt(result);
  } catch (error) {
    console.warn('[receipt-helpers] convertGeminiResultToReceipt failed; using fallback:', error);
    return buildExpenseReceiptFallbackFromGemini(result);
  }
}

/** 将 Gemini 统一凭证结果（发票）转换为 Invoice */
export async function convertGeminiResultToInvoice(result: GeminiVoucherResult): Promise<Invoice> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');

  const categories = await getCategories('income');
  const attributions = await getAttributions('income');

  const accountId = await resolveAccountIdFromGeminiPaymentFields({
    paymentAccountName: result.paymentAccountName,
    paymentCardLastFour: result.paymentCardLastFour,
  });

  if (!result.items || !Array.isArray(result.items)) {
    result.items = [];
  }

  const items: InvoiceItem[] = await Promise.all(
    result.items.map(async (item) => {
      let category = categories.find((c) => c.name.toLowerCase() === (item.categoryName || '').toLowerCase());
      if (!category) {
        category = await findCategoryByName(item.categoryName, 'income') || undefined;
      }
      if (!category) {
        category = categories.find((c) => c.name === 'Sales') || categories[0];
      }
      if (!category) {
        throw new Error('No category available. Please create at least one category.');
      }

      let attributionId: string | null = null;
      const nameFromModel =
        item.attributionName
        ?? item.purposeName
        ?? (item as any).purpose;
      if (nameFromModel) {
        const found = attributions.find((p) => p.name.toLowerCase() === nameFromModel.toLowerCase()) || await findAttributionByName(nameFromModel, 'income');
        if (found) attributionId = found.id;
      }
      if (!attributionId && attributions.length > 0) {
        attributionId = (attributions.find((p) => p.isDefault) || attributions[0]).id;
      }

      const itemName = item.name ?? (item as { description?: string }).description ?? 'Unknown Item';
      const itemPrice = Number((item as { price?: number; amount?: number }).price ?? (item as { amount?: number }).amount ?? 0);
      const itemAlias = aliasDistinctFromLineName(
        String(itemName),
        pickReceiptLineItemAlias(item as Record<string, unknown>),
      );
      return {
        name: itemName,
        itemAlias,
        categoryId: category.id,
        category,
        attributionId,
        attribution: attributions.find((p) => p.id === attributionId) || undefined,
        price: itemPrice,
        isAsset: item.isAsset ?? false,
        confidence: item.confidence,
      };
    })
  );

  const spaceId = user.spaceId || user.currentSpaceId;
  if (!spaceId) throw new Error('User must have a space selected');

  const customerName = result.customerName || result.supplierName || 'Customer';
  let entityId: string | undefined;
  const trimmed = customerName.trim();
  if (trimmed) {
    const invalidNames = ['processing', 'pending', 'loading', '识别中', '处理中', '待处理', 'customer'];
    if (!invalidNames.includes(trimmed.toLowerCase())) {
      try {
        const entity = await findOrCreateEntity(
          trimmed,
          true,
          result.supplierInfo?.taxNumber,
          result.supplierInfo?.phone,
          result.supplierInfo?.address
        );
        entityId = entity.id;
      } catch (_) {}
    }
  }
  const itemsSum = items.reduce((sum, i) => sum + i.price, 0);
  const tax = result.tax ?? 0;
  const totalAmount = result.totalAmount ?? itemsSum + tax;
  const confidence = result.confidence ?? 0.5;
  const status: VoucherStatus = confidence >= 0.85 ? 'confirmed' : 'pending';

  return {
    spaceId,
    customerName,
    entityId,
    totalAmount,
    currency: result.currency,
    tax,
    date: result.date,
    accountId: accountId ?? null,
    status,
    items,
    confidence,
  };
}

/** 将 Gemini 入库/出库识别结果转换为 Inbound */
export async function convertGeminiResultToInbound(result: GeminiInboundOutboundResult): Promise<Inbound> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  let entityId: string | undefined;
  const senderName = result.supplierName?.trim();
  if (senderName) {
    const invalidNames = ['processing', 'pending', 'loading', '识别中', '处理中', '待处理'];
    if (!invalidNames.includes(senderName.toLowerCase())) {
      try {
        const entity = await findOrCreateEntity(senderName, true);
        entityId = entity.id;
      } catch (_) {}
    }
  }

  // 仓库 / 仓位：若有识别结果，则尝试匹配或创建
  let warehouseId: string | undefined;
  let locationId: string | undefined;
  const warehouseName = result.warehouseName?.trim();
  if (warehouseName) {
    try {
      const warehouse = await findOrCreateWarehouseByName(warehouseName);
      warehouseId = warehouse.id;
      const locationName = result.locationName?.trim();
      if (locationName) {
        try {
          const location = await findOrCreateLocationByName(warehouse.id, locationName);
          locationId = location.id;
        } catch (e) {
          console.warn('Failed to find/create location from AI result:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to find/create warehouse from AI result:', e);
    }
  }

  // SKU：对每一行根据名称/单位/编码匹配或创建 SKU，回写 skuId；名称/单位/规格从 SKU 取（不冗余存储）
  const items: InboundItem[] = await Promise.all(
    (result.items || []).map(async (it) => {
      const quantity = Number(it.quantity) || 1;
      const unit = it.unit || '件';
      const productName = it.productName || 'Item';
      let skuId: string | undefined;
      let sku: Awaited<ReturnType<typeof findOrCreateSkuByNameAndUnit>> | null = null;
      try {
        sku = await findOrCreateSkuByNameAndUnit({
          name: productName,
          unit,
          code: it.skuCode,
        });
        skuId = sku.id;
      } catch (e) {
        console.warn('Failed to find/create SKU from AI result:', e);
      }
      return {
        inboundId: '',
        skuId,
        lineNo: it.lineNo,
        productCode: sku?.code,
        productName: sku?.name ?? productName,
        specification: sku?.description ?? it.specification,
        quantity,
        qualifiedQuantity: it.qualifiedQuantity,
        defectiveQuantity: it.defectiveQuantity,
        unit: sku?.unit ?? unit,
        unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
        amount: it.amount != null ? Number(it.amount) : undefined,
        remarks: it.remarks,
      } as InboundItem;
    })
  );

  const totalAmount = result.totalAmount ?? items.reduce((sum, i) => sum + (i.amount ?? (i.quantity || 0) * (i.unitPrice ?? 0)), 0);

  return {
    spaceId,
    documentNo: result.documentNo,
    entityId,
    supplierName: result.supplierName || undefined,
    warehouseId,
    locationId,
    inboundType: result.inboundType,
    totalAmount: totalAmount > 0 ? totalAmount : undefined,
    totalAmountChinese: result.totalAmountChinese,
    currency: result.currency,
    date: result.date,
    status: 'pending' as VoucherStatus,
    handlerName: result.handlerName,
    warehouseKeeperName: result.warehouseKeeperName,
    accountantName: result.accountantName,
    remarks: result.remarks,
    items: items.length ? items : [{ inboundId: '', productName: 'Goods', quantity: 1, unit: '件' }],
    confidence: result.confidence,
  };
}

/** 将 Gemini 入库/出库识别结果转换为 Outbound */
export async function convertGeminiResultToOutbound(result: GeminiInboundOutboundResult): Promise<Outbound> {
  console.log('[出库单转换] 开始转换识别结果，输入:', JSON.stringify(result, null, 2));
  
  const user = await getCurrentUser();
  if (!user) {
    console.error('[出库单转换] ❌ 用户未登录');
    throw new Error('Not logged in');
  }
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) {
    console.error('[出库单转换] ❌ 未选择空间');
    throw new Error('No space selected');
  }
  console.log('[出库单转换] 空间ID:', spaceId);

  // 关联方 Receiver：从识别结果中的客户名称匹配或创建 entity
  let entityId: string | undefined;
  const receiverName = result.customerName?.trim();
  if (receiverName) {
    const invalidNames = ['processing', 'pending', 'loading', '识别中', '处理中', '待处理'];
    if (!invalidNames.includes(receiverName.toLowerCase())) {
      try {
        const entity = await findOrCreateEntity(receiverName, true);
        entityId = entity.id;
      } catch (_) {}
    }
  }

  // 仓库：从识别结果中提取仓库名称，匹配或创建仓库记录
  let warehouseId: string | undefined;
  if (result.warehouseName && result.warehouseName.trim()) {
    try {
      console.log('[出库单转换] 处理仓库:', result.warehouseName.trim());
      const warehouse = await findOrCreateWarehouseByName(result.warehouseName.trim());
      warehouseId = warehouse.id;
      console.log('[出库单转换] 仓库ID:', warehouseId);
    } catch (e) {
      console.error('[出库单转换] ❌ 创建/查找仓库失败:', e);
      console.error('[出库单转换] 仓库错误详情:', e instanceof Error ? e.message : String(e));
    }
  } else {
    console.log('[出库单转换] 未识别到仓库名称');
  }

  // 仓位：从识别结果中提取仓位名称，匹配或创建仓位记录（需要 warehouseId）
  let locationId: string | undefined;
  if (warehouseId && result.locationName && result.locationName.trim()) {
    try {
      console.log('[出库单转换] 处理仓位:', result.locationName.trim(), '仓库ID:', warehouseId);
      const location = await findOrCreateLocationByName(warehouseId, result.locationName.trim());
      locationId = location.id;
      console.log('[出库单转换] 仓位ID:', locationId);
    } catch (e) {
      console.error('[出库单转换] ❌ 创建/查找仓位失败:', e);
      console.error('[出库单转换] 仓位错误详情:', e instanceof Error ? e.message : String(e));
    }
  } else {
    if (!warehouseId) {
      console.log('[出库单转换] 未识别到仓位（需要先有仓库ID）');
    } else {
      console.log('[出库单转换] 未识别到仓位名称');
    }
  }

  // SKU：对每一行根据名称/单位/编码匹配或创建 SKU，回写 skuId；名称/单位/规格从 SKU 取（不冗余存储）
  const items: OutboundItem[] = await Promise.all(
    (result.items || []).map(async (it) => {
      const quantity = Number(it.quantity) || 1;
      const unit = it.unit || '件';
      const productName = it.productName || 'Item';
      let skuId: string | undefined;
      let sku: Awaited<ReturnType<typeof findOrCreateSkuByNameAndUnit>> | null = null;
      try {
        sku = await findOrCreateSkuByNameAndUnit({
          name: productName,
          unit,
          code: it.skuCode,
        });
        skuId = sku.id;
      } catch (e) {
        console.warn('Failed to find/create SKU from AI result:', e);
      }
      return {
        outboundId: '',
        skuId,
        lineNo: it.lineNo,
        productName: sku?.name ?? productName,
        specification: sku?.description ?? it.specification,
        quantity,
        unit: sku?.unit ?? unit,
        unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
        amount: it.amount != null ? Number(it.amount) : undefined,
        supplyPrice: it.supplyPrice != null ? Number(it.supplyPrice) : undefined,
        tax: it.tax != null ? Number(it.tax) : undefined,
        remarks: it.remarks,
      } as OutboundItem;
    })
  );

  const totalAmount = result.totalAmount ?? items.reduce((sum, i) => sum + (i.amount ?? (i.quantity || 0) * (i.unitPrice ?? 0)), 0);

  return {
    spaceId,
    documentNo: result.documentNo,
    entityId,
    customerName: result.customerName || undefined,
    warehouseId,
    locationId,
    totalAmount: totalAmount > 0 ? totalAmount : undefined,
    totalTax: result.totalTax,
    currency: result.currency,
    date: result.date,
    status: 'pending' as VoucherStatus,
    handlerName: result.handlerName,
    preparerName: result.preparerName,
    accountantName: result.accountantName,
    remarks: result.remarks,
    items: items.length ? items : [{ outboundId: '', productName: 'Goods', quantity: 1, unit: '件' }],
    confidence: result.confidence,
  };
}

