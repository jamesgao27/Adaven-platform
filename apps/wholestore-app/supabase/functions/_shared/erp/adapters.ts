/**
 * Deno copy of @adaven/platform-erp adapters for Edge Functions.
 * Keep behavior aligned with packages/platform-erp.
 */

import fixture from './pouchpies-products.json' with { type: 'json' };

export type ErpProviderKind = 'mock' | 'finale';

export type ErpProduct = {
  code: string;
  externalProductId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  qtyOnHand: number | null;
  listPriceHint: number | null;
};

type FixtureRow = {
  code: string;
  externalProductId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  qtyOnHand: number;
  listPriceHint: number;
};

const PRODUCTS: ErpProduct[] = (fixture as FixtureRow[]).map((row) => ({
  code: row.code,
  externalProductId: row.externalProductId,
  name: row.name,
  description: row.description,
  imageUrl: row.imageUrl,
  qtyOnHand: row.qtyOnHand,
  listPriceHint: row.listPriceHint,
}));

export interface ErpAdapter {
  readonly provider: ErpProviderKind;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  listProducts(): Promise<ErpProduct[]>;
  createSalesOrder(input: {
    idempotencyKey: string;
    lines: { skuCode: string; quantity: number; unitPrice: number }[];
  }): Promise<{ externalOrderId: string }>;
}

class MockErpAdapter implements ErpAdapter {
  readonly provider = 'mock' as const;
  private issued = new Map<string, string>();

  async testConnection() {
    return { ok: true, message: `Mock ERP ready (${PRODUCTS.length} products)` };
  }

  async listProducts() {
    return PRODUCTS.map((p) => ({ ...p }));
  }

  async createSalesOrder(input: {
    idempotencyKey: string;
    lines: { skuCode: string; quantity: number; unitPrice: number }[];
  }) {
    if (!input.idempotencyKey?.trim()) throw new Error('idempotencyKey is required');
    if (!input.lines?.length) throw new Error('At least one line is required');
    const existing = this.issued.get(input.idempotencyKey);
    if (existing) return { externalOrderId: existing };
    const short = input.idempotencyKey.replace(/-/g, '').slice(0, 12).toUpperCase();
    const externalOrderId = `MOCK-SO-${short}`;
    this.issued.set(input.idempotencyKey, externalOrderId);
    return { externalOrderId };
  }
}

class FinaleErpAdapter implements ErpAdapter {
  readonly provider = 'finale' as const;

  async testConnection() {
    return {
      ok: false,
      message: 'Finale adapter not configured. Use Mock ERP until a Finale sandbox is available.',
    };
  }

  async listProducts(): Promise<ErpProduct[]> {
    throw new Error('Finale adapter not configured');
  }

  async createSalesOrder(): Promise<{ externalOrderId: string }> {
    throw new Error('Finale adapter not configured');
  }
}

export function createErpAdapter(provider: ErpProviderKind): ErpAdapter {
  if (provider === 'mock') return new MockErpAdapter();
  if (provider === 'finale') return new FinaleErpAdapter();
  throw new Error(`Unsupported ERP provider: ${provider}`);
}
