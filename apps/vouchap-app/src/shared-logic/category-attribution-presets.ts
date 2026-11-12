/**
 * Category and attribution name presets for expense/income scopes.
 * DB column on line items is `attribution_id` (FK to attributions); app types use attributionId.
 */

export type ExpenseIncomeScope = 'expense' | 'income';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Groceries',
  'Travel',
  'Meal',
  'Housing',
  'Health',
  'Clothing',
  'Education',
  'Entertainment',
  'Software',
  'Utilities',
  'Tax',
  'Refund',
] as const;

export const DEFAULT_EXPENSE_ATTRIBUTIONS = ['Personal', 'Business', 'Client'] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  'Salary',
  'Sales',
  'Fee',
  'Bonus',
  'Tax',
  'Grant',
  'Refund',
  'Other',
] as const;

export const DEFAULT_INCOME_ATTRIBUTIONS = ['Employer', 'Client', 'Gov', 'Private'] as const;

export const TAG_COLOR_LIBRARY = [
  '#F47C7C', '#5DC8B4', '#37B9DC', '#F7A87A', '#A8E0C4',
  '#FBF177', '#B494DA', '#F0A093', '#A3D8F5', '#87E09A',
] as const;

export const DEFAULT_CATEGORY_COLOR = TAG_COLOR_LIBRARY[0];
export const DEFAULT_ATTRIBUTION_COLOR = TAG_COLOR_LIBRARY[0];
