/**
 * 兼容层：原 customer/supplier 选单与列表已统一为 entities。
 * 所有接口均从 entities/entity-list 获取数据，返回兼容的 { id, name, source? } 形状。
 */
import { getEntities } from './entities';
import { getEntityOptions, getEntityOptionsForDuplicateCheck } from './entity-list';
import type { Entity } from '@/types';

/** @deprecated 已由 Entity 替代；兼容类型 */
export type CustomerListItem = Entity & { source: 'customer' };
/** @deprecated 已由 Entity 替代；兼容类型 */
export type SupplierListItem = Entity & { source: 'supplier' };

/** 管理页用：统一返回 entities，带 source 兼容旧 UI */
export async function getCustomerListForManage(): Promise<CustomerListItem[]> {
  const list = await getEntities();
  return list.map((e) => ({ ...e, source: 'customer' as const }));
}

export async function getSupplierListForManage(): Promise<SupplierListItem[]> {
  const list = await getEntities();
  return list.map((e) => ({ ...e, source: 'supplier' as const }));
}

/** 选客户用（发票等）：统一为 entities */
export async function getCustomerOptions(): Promise<{ id: string; name: string; source: 'customer' | 'supplier' }[]> {
  const list = await getEntityOptions();
  return list.map((it) => ({ id: it.id, name: it.name, source: 'customer' as const }));
}

/** 选供应商用（小票等）：统一为 entities */
export async function getSupplierOptions(): Promise<{ id: string; name: string; source: 'supplier' | 'customer' }[]> {
  const list = await getEntityOptions();
  return list.map((it) => ({ id: it.id, name: it.name, source: 'supplier' as const }));
}

export async function getSupplierOptionsForDuplicateCheck(): Promise<{ id: string; name: string; source: 'supplier' | 'customer' }[]> {
  const list = await getEntityOptionsForDuplicateCheck();
  return list.map((it) => ({ id: it.id, name: it.name, source: 'supplier' as const }));
}

export async function getCustomerOptionsForDuplicateCheck(): Promise<{ id: string; name: string; source: 'customer' | 'supplier' }[]> {
  const list = await getEntityOptionsForDuplicateCheck();
  return list.map((it) => ({ id: it.id, name: it.name, source: 'customer' as const }));
}
