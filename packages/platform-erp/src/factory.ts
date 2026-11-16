import { FinaleErpAdapter } from './finale-adapter';
import { MockErpAdapter } from './mock-adapter';
import type { ErpAdapter, ErpConnectionConfig, ErpProviderKind } from './types';

export type CreateErpAdapterOptions = {
  provider: ErpProviderKind;
  config?: ErpConnectionConfig;
  credentials?: { apiKey?: string; apiSecret?: string };
};

export function createErpAdapter(options: CreateErpAdapterOptions): ErpAdapter {
  switch (options.provider) {
    case 'mock':
      return new MockErpAdapter();
    case 'finale':
      return new FinaleErpAdapter(options.config ?? {}, options.credentials ?? {});
    default: {
      const _exhaustive: never = options.provider;
      throw new Error(`Unsupported ERP provider: ${_exhaustive}`);
    }
  }
}
