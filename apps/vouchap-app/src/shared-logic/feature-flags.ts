import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig as { extra?: Record<string, unknown> } | null)?.extra ?? {};

/** 是否显示 AI 进销存入口与功能；仅当 extra.showAiInventory === true 时显示，缺省/undefined 视为不显示（production 安全） */
export const showAiInventory = extra.showAiInventory === true;

/**
 * 是否显示报税入口与功能。
 * - 默认开启（所有平台、所有环境），除非显式在 app.config.js / app.json 的 extra 中将 showTaxFiling 设为 false。
 * - 这样可以在生产环境正常从首页按钮进入 Tax Filing 模块，同时保留一键关闭开关。
 */
export const showTaxFiling = extra.showTaxFiling !== false;
