import { supabase } from './supabase';
import { Invoice, InvoiceItem } from '@/types';
import { getCurrentUser } from './auth';
import { findOrCreateEntity, updateEntity, getEntityMergeMap, getEntityById, resolveEntityId } from './entities';
import { getAccountMergeMap, getAccountById, getAccountOptionsForDuplicateCheck, resolveAccountId, normalizeAccountName } from './accounts';
import { getEntityOptions, getEntityOptionsForDuplicateCheck } from './entity-list';
import { normalizeNameForCompare } from './name-utils';
import { isMissingNestedAttributionEmbedError } from './postgrest-embed-errors';
import { fetchAttributionRowsMapForSpace } from './database';

function mapEntityRow(e: any): Invoice['entity'] {
  if (!e) return undefined;
  return {
    id: e.id,
    spaceId: e.space_id ?? e.spaceId,
    name: e.name,
    taxNumber: e.tax_number ?? e.taxNumber,
    phone: e.phone,
    address: e.address,
    isAiRecognized: e.is_ai_recognized ?? e.isAiRecognized,
    mergedIntoId: e.merged_into_id ?? e.mergedIntoId,
    createdAt: e.created_at ?? e.createdAt,
    updatedAt: e.updated_at ?? e.updatedAt,
  };
}

function rowToInvoice(row: any, items: InvoiceItem[] = []): Invoice {
  const customerName = row.customer_name || row.entities?.name || '';
  return {
    id: row.id,
    spaceId: row.space_id,
    customerName,
    entityId: row.entity_id ?? undefined,
    entity: mapEntityRow(row.entities),
    totalAmount: Number(row.total_amount),
    currency: row.currency ?? undefined,
    tax: row.tax != null ? Number(row.tax) : undefined,
    date: row.date,
    accountId: row.account_id ?? undefined,
    account: row.accounts ? {
      id: row.accounts.id,
      spaceId: row.accounts.space_id,
      name: row.accounts.name,
      isAiRecognized: row.accounts.is_ai_recognized,
      createdAt: row.accounts.created_at,
      updatedAt: row.accounts.updated_at,
    } : undefined,
    status: row.status ?? 'pending',
    imageUrl: row.image_url ?? undefined,
    inputType: row.input_type ?? (row.image_url ? 'image' : 'text'),
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    processedBy: row.processed_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdByUser: row.created_by_user ? {
      id: row.created_by_user.id,
      email: row.created_by_user.email,
      name: row.created_by_user.name,
      spaceId: row.created_by_user.current_space_id ?? null,
    } : undefined,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recognitionFailCount:
      row.recognition_fail_count != null ? Number(row.recognition_fail_count) : 0,
  };
}

/** 首屏极速加载：仅 invoices 表、limit 15、无 join，用于立即渲染，合计后续更新 */
const FIRST_PAINT_LIMIT = 15;

export async function getInvoicesForListFirstPaint(): Promise<Invoice[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, space_id, entity_id, customer_name, total_amount, currency, tax, date, account_id, status, image_url, input_type, confidence, processed_by, created_at, updated_at, created_by,
      entities (id, name),
      created_by_user:users!created_by (id, email, name, current_space_id)
    `)
    .eq('space_id', spaceId)
    .order('date', { ascending: false })
    .limit(FIRST_PAINT_LIMIT);

  if (error) throw error;
  const rows = data || [];
  const entityMergeMap = await getEntityMergeMap(spaceId);
  const resolveEntity = (eid: string) => {
    let current = eid;
    const seen = new Set<string>();
    while (entityMergeMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = entityMergeMap.get(current)!;
    }
    return current;
  };
  const needResolved = new Set<string>();
  for (const r of rows) {
    if (r.entity_id) {
      const resolvedId = resolveEntity(r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) needResolved.add(resolvedId);
    }
  }
  const resolvedEntityCache = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
  if (needResolved.size > 0) {
    await Promise.all(Array.from(needResolved).map(async (id) => {
      const e = await getEntityById(id);
      if (e) resolvedEntityCache.set(id, e);
    }));
  }
  return rows.map((r: any) => {
    const resolvedEntityId = r.entity_id ? resolveEntity(r.entity_id) : null;
    const entityRow = (resolvedEntityId ? resolvedEntityCache.get(resolvedEntityId) : null) ?? r.entities;
    const customerName = r.customer_name || entityRow?.name || '';
    return {
    id: r.id,
    spaceId: r.space_id,
    customerName,
    entityId: r.entity_id ?? undefined,
    entity: entityRow ? mapEntityRow(entityRow) : undefined,
    totalAmount: Number(r.total_amount),
    currency: r.currency ?? undefined,
    tax: r.tax != null ? Number(r.tax) : undefined,
    date: r.date,
    accountId: r.account_id ?? undefined,
    account: r.account_id ? { id: r.account_id, spaceId, name: '', isAiRecognized: false, createdAt: '', updatedAt: '' } : undefined,
    status: r.status ?? 'pending',
    imageUrl: r.image_url ?? undefined,
    inputType: r.input_type ?? (r.image_url ? 'image' : 'text'),
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
    processedBy: r.processed_by ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdByUser: r.created_by_user ? {
      id: r.created_by_user.id,
      email: r.created_by_user.email,
      name: r.created_by_user.name,
      spaceId: r.created_by_user.current_space_id ?? null,
    } : undefined,
    items: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  });
}

/** 获取当前空间下所有发票（列表用，含 merge 解析，不含 items） */
export async function getAllInvoicesForList(): Promise<Invoice[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      entities (*),
      accounts (*),
      created_by_user:users!created_by (id, email, name, current_space_id)
    `)
    .eq('space_id', spaceId)
    .order('date', { ascending: false });

  if (error) throw error;
  const rows = data || [];
  const [entityMergeMap, accountMergeMap] = await Promise.all([
    getEntityMergeMap(spaceId),
    getAccountMergeMap(spaceId),
  ]);
  const resolve = (map: Map<string, string>, id: string) => {
    let current = id;
    const seen = new Set<string>();
    while (map.has(current) && !seen.has(current)) {
      seen.add(current);
      current = map.get(current)!;
    }
    return current;
  };

  const needEntity = new Set<string>();
  const needAccount = new Set<string>();
  for (const r of rows) {
    if (r.entity_id) {
      const resolvedId = resolve(entityMergeMap, r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) needEntity.add(resolvedId);
    }
    if (r.account_id) {
      const resolvedId = resolve(accountMergeMap, r.account_id);
      if (!r.accounts || r.accounts.id !== resolvedId) needAccount.add(resolvedId);
    }
  }

  const [entityCache, accountCache] = await Promise.all([
    needEntity.size > 0 ? (async () => {
      const m = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
      await Promise.all(Array.from(needEntity).map(async (id) => { const e = await getEntityById(id); if (e) m.set(id, e); }));
      return m;
    })() : Promise.resolve(new Map()),
    needAccount.size > 0 ? (async () => {
      const m = new Map<string, Awaited<ReturnType<typeof getAccountById>>>();
      await Promise.all(Array.from(needAccount).map(async (id) => { const a = await getAccountById(id); if (a) m.set(id, a); }));
      return m;
    })() : Promise.resolve(new Map()),
  ]);

  return rows.map((r: any) => {
    const rc = { ...r };
    if (r.entity_id) {
      const resolvedId = resolve(entityMergeMap, r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) {
        const e = entityCache.get(resolvedId);
        rc.entities = e ? { id: e.id, space_id: e.spaceId, name: e.name, tax_number: e.taxNumber, phone: e.phone, address: e.address, is_ai_recognized: e.isAiRecognized, merged_into_id: e.mergedIntoId, created_at: e.createdAt, updated_at: e.updatedAt } : undefined;
      }
    }
    if (r.account_id) {
      const resolvedId = resolve(accountMergeMap, r.account_id);
      if (!r.accounts || r.accounts.id !== resolvedId) rc.accounts = accountCache.get(resolvedId);
    }
    return rowToInvoice(rc, []);
  });
}

/** 获取当前空间下所有发票（含 items 明细，用于列表页搜索等需要明细的场景） */
export async function getAllInvoicesWithItems(): Promise<Invoice[]> {
  const invoices = await getAllInvoices();
  const ids = invoices.map(inv => inv.id).filter((id): id is string => !!id);
  if (ids.length === 0) return invoices;
  const { data: itemRows } = await supabase
    .from('invoice_items')
    .select('id, name, item_alias, price, invoice_id, category_id')
    .in('invoice_id', ids)
    .order('id', { ascending: true });
  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  (itemRows || []).forEach((r: any) => {
    const list = itemsByInvoice.get(r.invoice_id) ?? [];
    list.push({ id: r.id, name: r.name, itemAlias: r.item_alias ?? undefined, price: r.price });
    itemsByInvoice.set(r.invoice_id, list);
  });
  return invoices.map(inv =>
    inv.id && itemsByInvoice.has(inv.id)
      ? { ...inv, items: itemsByInvoice.get(inv.id)! }
      : inv
  );
}

/** 获取当前空间下所有发票（完整数据，不含 items；含 items 请用 getAllInvoicesWithItems） */
export async function getAllInvoices(): Promise<Invoice[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      entities (*),
      accounts (*),
      created_by_user:users!created_by (
        id,
        email,
        name,
        current_space_id
      )
    `)
    .eq('space_id', spaceId)
    .order('date', { ascending: false });

  if (error) throw error;
  const rows = data || [];
  const [entityMergeMap, accountMergeMap] = await Promise.all([
    getEntityMergeMap(spaceId),
    getAccountMergeMap(spaceId),
  ]);
  const resolve = (map: Map<string, string>, id: string) => {
    let current = id;
    const seen = new Set<string>();
    while (map.has(current) && !seen.has(current)) {
      seen.add(current);
      current = map.get(current)!;
    }
    return current;
  };
  const needEntity = new Set<string>();
  const needAccount = new Set<string>();
  for (const r of rows) {
    if (r.entity_id) {
      const resolvedId = resolve(entityMergeMap, r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) needEntity.add(resolvedId);
    }
    if (r.account_id) {
      const resolvedId = resolve(accountMergeMap, r.account_id);
      if (!r.accounts || r.accounts.id !== resolvedId) needAccount.add(resolvedId);
    }
  }
  const [entityCache, accountCache] = await Promise.all([
    needEntity.size > 0 ? (async () => {
      const m = new Map<string, Awaited<ReturnType<typeof getEntityById>>>();
      await Promise.all(Array.from(needEntity).map(async (id) => { const e = await getEntityById(id); if (e) m.set(id, e); }));
      return m;
    })() : Promise.resolve(new Map()),
    needAccount.size > 0 ? (async () => {
      const m = new Map<string, Awaited<ReturnType<typeof getAccountById>>>();
      await Promise.all(Array.from(needAccount).map(async (id) => { const a = await getAccountById(id); if (a) m.set(id, a); }));
      return m;
    })() : Promise.resolve(new Map()),
  ]);
  return rows.map((r: any) => {
    const rc = { ...r };
    if (r.entity_id) {
      const resolvedId = resolve(entityMergeMap, r.entity_id);
      if (!r.entities || r.entities.id !== resolvedId) {
        const e = entityCache.get(resolvedId);
        rc.entities = e ? { id: e.id, space_id: e.spaceId, name: e.name, tax_number: e.taxNumber, phone: e.phone, address: e.address, is_ai_recognized: e.isAiRecognized, merged_into_id: e.mergedIntoId, created_at: e.createdAt, updated_at: e.updatedAt } : undefined;
      }
    }
    if (r.account_id) {
      const resolvedId = resolve(accountMergeMap, r.account_id);
      if (!r.accounts || r.accounts.id !== resolvedId) rc.accounts = accountCache.get(resolvedId);
    }
    return rowToInvoice(rc, []);
  });
}

/** 根据 ID 获取发票（含明细、account、createdByUser、customer、items 的 category/attribution）；合并指向的客户/供应商会解析为最终目标展示 */
export async function getInvoiceById(invoiceId: string): Promise<Invoice | null> {
  const { data: inv, error: invError } = await supabase
    .from('invoices')
    .select(`
      *,
      entities (*),
      accounts (*),
      created_by_user:users!created_by (
        id,
        email,
        name,
        current_space_id
      )
    `)
    .eq('id', invoiceId)
    .single();
  if (invError || !inv) return null;

  const user = await getCurrentUser();
  const spaceId = user?.currentSpaceId || user?.spaceId;
  if (spaceId) {
    let entityRow = inv.entities;
    if (inv.entity_id) {
      const resolvedId = await resolveEntityId(spaceId, inv.entity_id);
      if (!entityRow || (entityRow as any).id !== resolvedId) {
        entityRow = (await getEntityById(resolvedId)) ?? entityRow;
      }
    }
    if (entityRow && typeof (entityRow as any).space_id === 'undefined' && (entityRow as any).spaceId) {
      (entityRow as any).space_id = (entityRow as any).spaceId;
    }
    let accountRow = inv.accounts;
    if (inv.account_id && !accountRow) {
      const accountMergeMap = await getAccountMergeMap(spaceId);
      let current = inv.account_id;
      const seen = new Set<string>();
      while (accountMergeMap.has(current) && !seen.has(current)) {
        seen.add(current);
        current = accountMergeMap.get(current)!;
      }
      accountRow = (await getAccountById(current)) ?? undefined;
    }
    inv.entities = entityRow;
    inv.accounts = accountRow;
  }

  const queryItemsWithAttribution = () =>
    supabase
      .from('invoice_items')
      .select(`
      *,
      categories (*),
      attributions (*)
    `)
      .eq('invoice_id', invoiceId)
      .order('id', { ascending: true });

  const queryItemsPlain = () =>
    supabase
      .from('invoice_items')
      .select(`
      *,
      categories (*)
    `)
      .eq('invoice_id', invoiceId)
      .order('id', { ascending: true });

  let { data: itemRows, error: itemsError } = await queryItemsWithAttribution();
  const invoiceSpaceId = spaceId ?? inv.space_id;
  let attributionLookup: Map<string, any> | null = null;
  if (itemsError && isMissingNestedAttributionEmbedError(itemsError, 'invoice_items')) {
    const plain = await queryItemsPlain();
    itemRows = plain.data;
    itemsError = plain.error;
    if (!itemsError && itemRows?.length && invoiceSpaceId) {
      const pids = [...new Set((itemRows as any[]).map((r) => r.attribution_id).filter(Boolean).map(String))];
      attributionLookup = await fetchAttributionRowsMapForSpace(invoiceSpaceId, pids);
    }
  }
  if (itemsError) return rowToInvoice(inv, []);

  const items: InvoiceItem[] = (itemRows || []).map((r: any) => {
    const attributionRow =
      r.attributions ?? (r.attribution_id && attributionLookup?.get(String(r.attribution_id)));
    return {
    id: r.id,
    name: r.name,
    itemAlias: r.item_alias ?? undefined,
    categoryId: r.category_id ?? undefined,
    category: r.categories ? {
      id: r.categories.id,
      spaceId: r.categories.space_id,
      name: r.categories.name,
      color: r.categories.color,
      isDefault: r.categories.is_default,
      createdAt: r.categories.created_at,
      updatedAt: r.categories.updated_at,
    } : undefined,
    attributionId: r.attribution_id ?? undefined,
    attribution: attributionRow ? {
      id: attributionRow.id,
      spaceId: attributionRow.space_id,
      name: attributionRow.name,
      color: attributionRow.color,
      isDefault: attributionRow.is_default,
      createdAt: attributionRow.created_at,
      updatedAt: attributionRow.updated_at,
    } : undefined,
    price: Number(r.price),
    isAsset: r.is_asset ?? false,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
  };
  });
  return rowToInvoice(inv, items);
}

/** 保存发票（新建或更新，含明细）— 占位实现，后续对接 AI 与完整 CRUD */
// autoResolveDuplicate: 如果为 true，遇到重复名称时自动使用已存在的ID，不抛出异常（用于后台处理场景）
export async function saveInvoice(invoice: Invoice, autoResolveDuplicate: boolean = false): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not logged in');
  const spaceId = user.currentSpaceId || user.spaceId;
  if (!spaceId) throw new Error('No space selected');

  // 关联方 Payer（付款方）
  // 收入详情页选单来自 getEntityOptions，选项 id 写入 customerId / customerSupplierId（兼容字段），须与 entity_id 一致；
  // 若只更新兼容字段而不更新 entityId，保存仍会沿用旧的 entity_id，与已选的名称冲突，误抛「关联方名称已存在」。
  const invAny = invoice as Invoice & { customerId?: string; customerSupplierId?: string };
  const uiPickedEntityId =
    (typeof invAny.customerId === 'string' && invAny.customerId.trim() ? invAny.customerId.trim() : null) ||
    (typeof invAny.customerSupplierId === 'string' && invAny.customerSupplierId.trim()
      ? invAny.customerSupplierId.trim()
      : null) ||
    null;
  let entityId = uiPickedEntityId ?? invoice.entityId ?? invoice.entity?.id ?? null;
  const customerName = invoice.customerName ?? '';
  const trimmedCustomerName = customerName.trim();
  const invalidNames = ['processing', 'processing...', 'pending', 'pending...', 'loading', 'loading...', '识别中', '处理中', '待处理'];
  const isValidName = trimmedCustomerName.length > 0 && !invalidNames.includes(trimmedCustomerName.toLowerCase());

  const isUpdate = !!invoice.id;
  if (!entityId && invoice.entity) entityId = invoice.entity.id;
  if (!isUpdate && !entityId && isValidName) {
    try {
      const entity = await findOrCreateEntity(trimmedCustomerName, true);
      entityId = entity.id;
    } catch (error) {
      console.warn('Failed to create or find entity (Payer):', error);
    }
  }
  // 修改详情页时：原纪录未关联 entities 且录入名称未匹配现有 entities，则创建新 entity 并关联
  if (isUpdate && !entityId && isValidName) {
    try {
      const entity = await findOrCreateEntity(trimmedCustomerName, false);
      entityId = entity.id;
    } catch (error) {
      console.warn('saveInvoice (update): findOrCreateEntity failed', error);
    }
  }

  if (invoice.id && spaceId) {
    if (isValidName) {
      const options = await getEntityOptionsForDuplicateCheck();
      const foundByName = options.find((o) => normalizeNameForCompare(o.name) === normalizeNameForCompare(trimmedCustomerName));
      const currentResolvedId = entityId ? await resolveEntityId(spaceId, entityId) : null;
      if (foundByName) {
        const targetId = await resolveEntityId(spaceId, foundByName.id);
        if (targetId !== currentResolvedId) {
          if (autoResolveDuplicate) {
            entityId = targetId;
            console.log('关联方名称已存在，自动使用已存在的 entityId:', targetId);
          } else {
            throw Object.assign(new Error('关联方名称已存在'), {
              code: 'ENTITY_NAME_EXISTS' as const,
              duplicateName: trimmedCustomerName,
              targetId,
            });
          }
        }
      }
      if (entityId) {
        try {
          const targetId = await resolveEntityId(spaceId, entityId);
          await updateEntity(targetId, { name: trimmedCustomerName });
        } catch (e) {
          if (e instanceof Error && e.message === '关联方名称已存在') {
            if (!autoResolveDuplicate) throw Object.assign(new Error(e.message), { code: 'ENTITY_NAME_EXISTS' as const, duplicateName: trimmedCustomerName });
          } else {
            console.warn('Failed to update entity name for invoice:', e);
          }
        }
      }
    }
    // 账户重复名校验（在客户校验之后，先处理客户再处理账户）
    if (invoice.accountId) {
      const accountName =
        ((invoice.account?.name ?? '').trim() || (await getAccountById(invoice.accountId))?.name) ?? '';
      if (accountName) {
        const accountOptions = await getAccountOptionsForDuplicateCheck();
        const currentResolvedId = await resolveAccountId(spaceId, invoice.accountId);
        const normalizedAccountName = normalizeAccountName(accountName);
        const found = accountOptions.find(
          (o) => o.id !== currentResolvedId && normalizeAccountName(o.name) === normalizedAccountName
        );
        if (found) {
          // 如果 autoResolveDuplicate = true（后台处理场景），自动使用已存在的账户ID
          // 如果 autoResolveDuplicate = false（UI 交互场景），抛出异常触发三选项弹窗
          if (autoResolveDuplicate) {
            // 后台处理场景：自动使用已存在的账户ID
            invoice.accountId = found.id;
            console.log(`账户名称已存在，自动使用已存在的ID: ${found.id}`);
          } else {
            // UI 交互场景：需要用户选择如何处理，抛出异常触发三选项弹窗
            throw Object.assign(new Error('账户名称已存在'), {
              code: 'ACCOUNT_NAME_EXISTS' as const,
              duplicateName: accountName,
              targetId: found.id,
            });
          }
        }
      }
    }
    await supabase
      .from('invoices')
      .update({
        customer_name: invoice.customerName,
        entity_id: entityId ?? null,
        total_amount: invoice.totalAmount,
        currency: invoice.currency ?? null,
        tax: invoice.tax ?? null,
        date: invoice.date,
        account_id: invoice.accountId ?? null,
        status: invoice.status,
        image_url: invoice.imageUrl ?? null,
        input_type: invoice.inputType ?? 'image',
        confidence: invoice.confidence ?? null,
        ...(invoice.recognitionFailCount !== undefined
          ? { recognition_fail_count: invoice.recognitionFailCount }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoice.id);
    if (invoice.items?.length) {
      await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id);
      await supabase.from('invoice_items').insert(
        invoice.items.map((it) => ({
          invoice_id: invoice.id,
          name: it.name,
          item_alias: it.itemAlias?.trim() || null,
          category_id: it.categoryId ?? null,
          attribution_id: it.attributionId ?? null,
          price: it.price,
          is_asset: it.isAsset ?? false,
          confidence: it.confidence ?? null,
        }))
      );
    }
    return invoice.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('invoices')
    .insert({
      space_id: spaceId,
      customer_name: invoice.customerName,
      entity_id: entityId ?? null,
      total_amount: invoice.totalAmount,
      currency: invoice.currency ?? null,
      tax: invoice.tax ?? null,
      date: invoice.date,
      account_id: invoice.accountId ?? null,
      status: invoice.status,
      image_url: invoice.imageUrl ?? null,
      input_type: invoice.inputType ?? 'image',
      confidence: invoice.confidence ?? null,
      recognition_fail_count:
        invoice.recognitionFailCount !== undefined ? invoice.recognitionFailCount : 0,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;
  const id = inserted.id;
  if (invoice.items?.length) {
    await supabase.from('invoice_items').insert(
      invoice.items.map((it) => ({
        invoice_id: id,
        name: it.name,
        item_alias: it.itemAlias?.trim() || null,
        category_id: it.categoryId ?? null,
        attribution_id: it.attributionId ?? null,
        price: it.price,
        is_asset: it.isAsset ?? false,
        confidence: it.confidence ?? null,
      }))
    );
  }
  return id;
}

/** 删除发票 */
export async function deleteInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
  if (error) throw error;
}

/** 更新发票单条明细的某个字段（用于详情页直接点选分类/用途/资产） */
export async function updateInvoiceItem(
  invoiceId: string,
  itemId: string,
  field: 'categoryId' | 'attributionId' | 'isAsset',
  value: any
): Promise<void> {
  const col = field === 'categoryId' ? 'category_id' : field === 'attributionId' ? 'attribution_id' : 'is_asset';
  const { error } = await supabase
    .from('invoice_items')
    .update({ [col]: value })
    .eq('id', itemId)
    .eq('invoice_id', invoiceId);
  if (error) throw error;
}
