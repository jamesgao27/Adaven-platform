import { describe, expect, it } from 'vitest';
import { createErpAdapter } from './factory';
import { MockErpAdapter } from './mock-adapter';

describe('MockErpAdapter', () => {
  it('lists curated Pouchpies products with required fields', async () => {
    const adapter = new MockErpAdapter();
    const products = await adapter.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(30);
    for (const p of products) {
      expect(p.code).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.externalProductId).toBeTruthy();
      expect(typeof p.listPriceHint).toBe('number');
    }
    const codes = new Set(products.map((p) => p.code));
    expect(codes.size).toBe(products.length);
  });

  it('testConnection succeeds', async () => {
    const adapter = createErpAdapter({ provider: 'mock' });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(true);
  });

  it('createSalesOrder is idempotent by portal order id', async () => {
    const adapter = new MockErpAdapter();
    const key = '11111111-2222-3333-4444-555555555555';
    const a = await adapter.createSalesOrder({
      idempotencyKey: key,
      lines: [{ skuCode: 'PP-PIE-CHMR-1', quantity: 2, unitPrice: 5.49 }],
    });
    const b = await adapter.createSalesOrder({
      idempotencyKey: key,
      lines: [{ skuCode: 'PP-PIE-CHMR-1', quantity: 9, unitPrice: 5.49 }],
    });
    expect(a.externalOrderId).toMatch(/^MOCK-SO-/);
    expect(b.externalOrderId).toBe(a.externalOrderId);
  });
});

describe('Finale stub', () => {
  it('refuses connection', async () => {
    const adapter = createErpAdapter({ provider: 'finale' });
    const result = await adapter.testConnection();
    expect(result.ok).toBe(false);
    await expect(adapter.listProducts()).rejects.toThrow(/not configured/i);
  });
});
