/**
 * 汇率服务 - 获取和缓存汇率，用于跨币种金额折算
 * 使用免费的汇率 API，每天更新一次
 */

// 缓存的汇率数据
let cachedRates: { [key: string]: number } | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时缓存

// 备用静态汇率（当 API 不可用时使用）
const FALLBACK_RATES: { [key: string]: number } = {
  USD: 1,
  CNY: 7.24,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  HKD: 7.82,
  TWD: 31.5,
  KRW: 1320,
  SGD: 1.34,
  MXN: 17.2,
  INR: 83.1,
  THB: 35.5,
  VND: 24500,
  PHP: 56.2,
  MYR: 4.72,
  IDR: 15800,
  AUD: 1.53,
  CAD: 1.36,
  CHF: 0.88,
  NZD: 1.64,
};

/**
 * 获取汇率（相对于 USD）
 * 优先使用缓存，超过24小时则后台刷新
 */
export const getExchangeRates = async (): Promise<{ [key: string]: number }> => {
  const now = Date.now();
  
  // 如果有缓存且未过期，直接返回
  if (cachedRates && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedRates;
  }
  
  // 尝试获取最新汇率
  try {
    // 使用免费的汇率 API（exchangerate-api.com 免费版）
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.rates) {
        cachedRates = data.rates;
        lastFetchTime = now;
        console.log('[ExchangeRates] 汇率已更新');
        return cachedRates;
      }
    }
  } catch (error) {
    console.log('[ExchangeRates] 获取汇率失败，使用备用汇率:', error);
  }
  
  // 如果有旧缓存，继续使用
  if (cachedRates) {
    return cachedRates;
  }
  
  // 使用备用静态汇率
  cachedRates = FALLBACK_RATES;
  return cachedRates;
};

/**
 * 规范化币种代码（内部使用），处理别名/大小写等。
 * 例如：RMB -> CNY，cny -> CNY。
 */
const normalizeCurrencyCode = (code: string): string => {
  const upper = (code || '').toUpperCase();
  if (upper === 'RMB') return 'CNY';
  return upper;
};

/**
 * 将金额从一种货币转换为另一种货币
 * @param amount 金额
 * @param fromCurrency 源货币代码
 * @param toCurrency 目标货币代码
 * @param rates 汇率表（相对于 USD）
 */
export const convertCurrency = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: { [key: string]: number }
): number => {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);

  if (from === to) {
    return amount;
  }
  
  const fromRate = rates[from] || 1;
  const toRate = rates[to] || 1;
  
  // 先转换为 USD，再转换为目标货币
  const usdAmount = amount / fromRate;
  return usdAmount * toRate;
};

/**
 * 计算多个不同币种金额的总和，折算为指定货币
 * @param amounts 金额数组，每项包含 amount 和 currency
 * @param targetCurrency 目标货币
 * @param rates 汇率表
 */
export const sumAmountsInCurrency = (
  amounts: Array<{ amount: number; currency: string }>,
  targetCurrency: string,
  rates: { [key: string]: number }
): number => {
  return amounts.reduce((sum, item) => {
    return sum + convertCurrency(item.amount, item.currency, targetCurrency, rates);
  }, 0);
};

/**
 * 预加载汇率（在应用启动时调用）
 */
export const preloadExchangeRates = async (): Promise<void> => {
  try {
    await getExchangeRates();
  } catch (error) {
    console.log('[ExchangeRates] 预加载失败:', error);
  }
};
