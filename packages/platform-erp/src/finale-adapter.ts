import type {
  ErpAdapter,
  ErpConnectionConfig,
  ErpConnectionTestResult,
  ErpCreateSalesOrderInput,
  ErpCreateSalesOrderResult,
  ErpProduct,
} from './types';

/**
 * Finale Inventory placeholder.
 *
 * Auth (when implemented): HTTP Basic with API key:secret.
 * Docs: https://developer.finaleinventory.com/reference/authentication
 * GraphQL: POST https://app.finaleinventory.com/{accountPath}/api/graphql
 *
 * This stub intentionally refuses all operations until a sandbox / Partner ID is available.
 */
export class FinaleErpAdapter implements ErpAdapter {
  readonly provider = 'finale' as const;

  constructor(
    private readonly config: ErpConnectionConfig = {},
    private readonly credentials: { apiKey?: string; apiSecret?: string } = {},
  ) {}

  async testConnection(): Promise<ErpConnectionTestResult> {
    void this.config;
    void this.credentials;
    return {
      ok: false,
      message: 'Finale adapter not configured. Use Mock ERP until a Finale sandbox is available.',
    };
  }

  async listProducts(): Promise<ErpProduct[]> {
    throw new Error('Finale adapter not configured');
  }

  async createSalesOrder(_input: ErpCreateSalesOrderInput): Promise<ErpCreateSalesOrderResult> {
    throw new Error('Finale adapter not configured');
  }
}
