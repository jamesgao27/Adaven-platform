import type {
  ErpAdapter,
  ErpConnectionTestResult,
  ErpCreateSalesOrderInput,
  ErpCreateSalesOrderResult,
  ErpProduct,
} from './types';
import fixture from './fixtures/pouchpies-products.json';

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

/** In-memory idempotency map for process lifetime (Edge cold starts still re-check DB). */
const issuedOrders = new Map<string, string>();

/**
 * Mock ERP seeded with curated Pouchpies food SKUs (static fixture; no live crawl).
 * Wholesale hints are DTC × 0.55 from the public catalog snapshot.
 */
export class MockErpAdapter implements ErpAdapter {
  readonly provider = 'mock' as const;

  async testConnection(): Promise<ErpConnectionTestResult> {
    return { ok: true, message: `Mock ERP ready (${PRODUCTS.length} products)` };
  }

  async listProducts(): Promise<ErpProduct[]> {
    return PRODUCTS.map((p) => ({ ...p }));
  }

  async createSalesOrder(input: ErpCreateSalesOrderInput): Promise<ErpCreateSalesOrderResult> {
    if (!input.idempotencyKey?.trim()) {
      throw new Error('idempotencyKey is required');
    }
    if (!input.lines?.length) {
      throw new Error('At least one line is required');
    }
    const existing = issuedOrders.get(input.idempotencyKey);
    if (existing) {
      return { externalOrderId: existing };
    }
    const short = input.idempotencyKey.replace(/-/g, '').slice(0, 12).toUpperCase();
    const externalOrderId = `MOCK-SO-${short}`;
    issuedOrders.set(input.idempotencyKey, externalOrderId);
    return { externalOrderId };
  }
}
