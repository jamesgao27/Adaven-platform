/** Supported ERP providers. `finale` is a stub until a live account is available. */
export type ErpProviderKind = 'mock' | 'finale';

export type ErpProduct = {
  /** Stable product code used as portal `sku_code`. */
  code: string;
  /** ERP-native id when available. */
  externalProductId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  qtyOnHand: number | null;
  /** Suggested wholesale unit price for seeding the default price list. */
  listPriceHint: number | null;
};

export type ErpSalesOrderLine = {
  skuCode: string;
  quantity: number;
  unitPrice: number;
};

export type ErpCreateSalesOrderInput = {
  /** Portal order UUID — used as idempotency key. */
  idempotencyKey: string;
  lines: ErpSalesOrderLine[];
};

export type ErpCreateSalesOrderResult = {
  externalOrderId: string;
};

export type ErpConnectionTestResult = {
  ok: boolean;
  message?: string;
};

/** Non-secret connection config stored in `provider.erp_connections.config`. */
export type ErpConnectionConfig = {
  /** Finale account path component; unused for mock. */
  accountPath?: string;
  [key: string]: unknown;
};

export interface ErpAdapter {
  readonly provider: ErpProviderKind;
  testConnection(): Promise<ErpConnectionTestResult>;
  listProducts(): Promise<ErpProduct[]>;
  createSalesOrder(input: ErpCreateSalesOrderInput): Promise<ErpCreateSalesOrderResult>;
}
