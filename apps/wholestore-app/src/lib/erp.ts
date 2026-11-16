import { getPlatformClient } from '@adaven/platform-core';

export type ErpProviderKind = 'mock' | 'finale';
export type ErpConnectionStatus = 'disconnected' | 'connected' | 'error';

export type ErpConnection = {
  providerSpaceId: string;
  erpProvider: ErpProviderKind;
  status: ErpConnectionStatus;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

function db() {
  return getPlatformClient().schema('provider');
}

function mapConn(row: Record<string, any>): ErpConnection {
  return {
    providerSpaceId: row.provider_space_id,
    erpProvider: (row.erp_provider as ErpProviderKind) || 'mock',
    status: (row.status as ErpConnectionStatus) || 'disconnected',
    config: (row.config as Record<string, unknown>) || {},
    lastSyncAt: row.last_sync_at ?? null,
    lastError: row.last_error ?? null,
    updatedAt: row.updated_at,
  };
}

export async function getErpConnection(providerSpaceId: string): Promise<ErpConnection | null> {
  const { data, error } = await db()
    .from('erp_connections')
    .select('*')
    .eq('provider_space_id', providerSpaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapConn(data) : null;
}

async function invokeErpProxy(body: Record<string, unknown>) {
  const { data, error } = await getPlatformClient().functions.invoke('erp-proxy', { body });
  if (error) throw error;
  const payload = data as { success?: boolean; error?: string; [key: string]: unknown };
  if (!payload?.success) {
    throw new Error(payload?.error || 'ERP request failed');
  }
  return payload;
}

export async function saveMockErpConnection(providerSpaceId: string) {
  return invokeErpProxy({
    action: 'save_connection',
    providerSpaceId,
    erpProvider: 'mock',
  });
}

export async function testErpConnection(providerSpaceId: string) {
  return invokeErpProxy({
    action: 'test_connection',
    providerSpaceId,
  });
}

export async function syncErpProducts(providerSpaceId: string) {
  return invokeErpProxy({
    action: 'sync_products',
    providerSpaceId,
  });
}

export async function pushOrderToErp(providerSpaceId: string, orderId: string) {
  return invokeErpProxy({
    action: 'push_order',
    providerSpaceId,
    orderId,
  }) as Promise<{
    success: boolean;
    externalOrderId?: string;
    erpPushStatus?: string;
    alreadyPushed?: boolean;
  }>;
}
