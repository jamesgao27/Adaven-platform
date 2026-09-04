-- =============================================================================
-- 已有空间：按预设方案刷新分类与用途（名称替换 + 颜色配置 + 删除预设外项）
-- 执行：在 Supabase SQL Editor 中整份执行。
-- 依赖：各空间需已有预设项（否则重定向时可能为 NULL）。可先对全库执行一次
--       seed_default_categories_purposes_for_space(space_id) 补全缺失预设再跑本脚本。
-- 若存在 receipt_items / invoice_items，会先将“非预设”引用重定向到同空间预设再删除。
-- 依赖：invoice_items.attribution_id（见迁移 20260403180000_rename_line_item_purpose_id_to_attribution_id）。
-- 颜色库：与 seed_new_space_presets 一致
--   #F47C7C #5DC8B4 #37B9DC #F7A87A #A8E0C4 #FBF177 #B494DA #F0A093 #A3D8F5 #87E09A
-- =============================================================================

-- 确保 scope 列存在并统一为小写
ALTER TABLE categories ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';
ALTER TABLE purposes ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'expense';
UPDATE categories SET scope = LOWER(COALESCE(scope, 'expense'));
UPDATE purposes SET scope = LOWER(COALESCE(scope, 'expense'));

-- =============================================================================
-- 1. 名称替换（与预设方案一致；若目标名已存在则先重定向引用再删旧行，避免 23505）
-- =============================================================================
-- 1a. 分类：当「旧名→新名」会导致 (space_id, name, scope) 重复时，先重定向再删除
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'receipt_items') THEN
    -- Subscription/Subscriptions → Software（同空间已存在 Software 时，把引用指过去）
    UPDATE receipt_items ri SET category_id = c2.id
    FROM categories c_old
    JOIN categories c2 ON c2.space_id = c_old.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Software' AND c2.id != c_old.id
    WHERE ri.category_id = c_old.id
      AND (c_old.scope = 'expense' OR c_old.scope IS NULL) AND c_old.name IN ('Subscription', 'Subscriptions');
    -- Transportation/Transport → Travel
    UPDATE receipt_items ri SET category_id = c2.id
    FROM categories c_old
    JOIN categories c2 ON c2.space_id = c_old.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Travel' AND c2.id != c_old.id
    WHERE ri.category_id = c_old.id
      AND (c_old.scope = 'expense' OR c_old.scope IS NULL) AND c_old.name IN ('Transportation', 'Transport');
    -- Dining out → Meal
    UPDATE receipt_items ri SET category_id = c2.id
    FROM categories c_old
    JOIN categories c2 ON c2.space_id = c_old.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Meal' AND c2.id != c_old.id
    WHERE ri.category_id = c_old.id
      AND (c_old.scope = 'expense' OR c_old.scope IS NULL) AND LOWER(TRIM(c_old.name)) = 'dining out';
  END IF;
END $$;

-- 删除「改名会重复」的旧行（目标名已存在的那些）
DELETE FROM categories c
WHERE (c.scope = 'expense' OR c.scope IS NULL) AND c.name IN ('Subscription', 'Subscriptions')
  AND EXISTS (SELECT 1 FROM categories c2 WHERE c2.space_id = c.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Software' AND c2.id != c.id);
DELETE FROM categories c
WHERE (c.scope = 'expense' OR c.scope IS NULL) AND c.name IN ('Transportation', 'Transport')
  AND EXISTS (SELECT 1 FROM categories c2 WHERE c2.space_id = c.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Travel' AND c2.id != c.id);
DELETE FROM categories c
WHERE (c.scope = 'expense' OR c.scope IS NULL) AND LOWER(TRIM(c.name)) = 'dining out'
  AND EXISTS (SELECT 1 FROM categories c2 WHERE c2.space_id = c.space_id AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Meal' AND c2.id != c.id);

-- 1b. 仅对「改名后不重复」的行做 UPDATE
UPDATE categories SET name = 'Travel'   WHERE (scope = 'expense' OR scope IS NULL) AND name IN ('Transportation', 'Transport');
UPDATE categories SET name = 'Meal'     WHERE (scope = 'expense' OR scope IS NULL) AND LOWER(TRIM(name)) = 'dining out';
UPDATE categories SET name = 'Software' WHERE (scope = 'expense' OR scope IS NULL) AND name IN ('Subscription', 'Subscriptions');
-- 支出用途（先删重复目标再改）
DELETE FROM purposes p
WHERE (p.scope = 'expense' OR p.scope IS NULL) AND p.name = 'Home'
  AND EXISTS (SELECT 1 FROM purposes p2 WHERE p2.space_id = p.space_id AND (p2.scope = 'expense' OR p2.scope IS NULL) AND p2.name = 'Personal' AND p2.id != p.id);
DELETE FROM purposes p
WHERE (p.scope = 'expense' OR p.scope IS NULL) AND LOWER(p.name) = 'gifts'
  AND EXISTS (SELECT 1 FROM purposes p2 WHERE p2.space_id = p.space_id AND (p2.scope = 'expense' OR p2.scope IS NULL) AND p2.name = 'Client' AND p2.id != p.id);
-- 重定向 invoice_items 中指向 Home/Gifts 的 attribution_id 到已有 Personal/Client（若存在）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoice_items') THEN
    UPDATE invoice_items ii SET attribution_id = a2.id
    FROM attributions a_old
    JOIN attributions a2 ON a2.space_id = a_old.space_id AND (a2.scope = 'expense' OR a2.scope IS NULL) AND a2.name = 'Personal' AND a2.id != a_old.id
    WHERE ii.attribution_id = a_old.id AND (a_old.scope = 'expense' OR a_old.scope IS NULL) AND a_old.name = 'Home';
    UPDATE invoice_items ii SET attribution_id = a2.id
    FROM attributions a_old
    JOIN attributions a2 ON a2.space_id = a_old.space_id AND (a2.scope = 'expense' OR a2.scope IS NULL) AND a2.name = 'Client' AND a2.id != a_old.id
    WHERE ii.attribution_id = a_old.id AND (a_old.scope = 'expense' OR a_old.scope IS NULL) AND LOWER(a_old.name) = 'gifts';
  END IF;
END $$;
UPDATE purposes SET name = 'Personal'  WHERE (scope = 'expense' OR scope IS NULL) AND name = 'Home';
UPDATE purposes SET name = 'Client'    WHERE (scope = 'expense' OR scope IS NULL) AND LOWER(name) = 'gifts';

-- =============================================================================
-- 2. 刷新颜色（仅对预设内的项，按标签颜色库顺序）
-- =============================================================================
-- 支出分类 12 项 → 颜色 1..10 循环
UPDATE categories SET color = CASE name
  WHEN 'Groceries'    THEN '#F47C7C' WHEN 'Travel'   THEN '#5DC8B4' WHEN 'Meal'    THEN '#37B9DC' WHEN 'Housing' THEN '#F7A87A'
  WHEN 'Health'       THEN '#A8E0C4' WHEN 'Clothing' THEN '#FBF177' WHEN 'Education' THEN '#B494DA' WHEN 'Entertainment' THEN '#F0A093'
  WHEN 'Software'     THEN '#A3D8F5' WHEN 'Utilities' THEN '#87E09A' WHEN 'Tax'    THEN '#F47C7C' WHEN 'Refund'  THEN '#5DC8B4'
  ELSE color END
WHERE (scope = 'expense' OR scope IS NULL) AND name IN ('Groceries','Travel','Meal','Housing','Health','Clothing','Education','Entertainment','Software','Utilities','Tax','Refund');

-- 收入分类 8 项
UPDATE categories SET color = CASE name
  WHEN 'Salary' THEN '#F47C7C' WHEN 'Sales' THEN '#5DC8B4' WHEN 'Fee' THEN '#37B9DC' WHEN 'Bonus' THEN '#F7A87A'
  WHEN 'Tax'    THEN '#A8E0C4' WHEN 'Grant' THEN '#FBF177' WHEN 'Refund' THEN '#B494DA' WHEN 'Other'  THEN '#F0A093'
  ELSE color END
WHERE scope = 'income' AND name IN ('Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other');

-- 支出用途 3 项
UPDATE purposes SET color = CASE name
  WHEN 'Personal' THEN '#F47C7C' WHEN 'Business' THEN '#5DC8B4' WHEN 'Client' THEN '#37B9DC'
  ELSE color END
WHERE (scope = 'expense' OR scope IS NULL) AND name IN ('Personal','Business','Client');

-- 收入来源 4 项
UPDATE purposes SET color = CASE name
  WHEN 'Employer' THEN '#F47C7C' WHEN 'Client' THEN '#5DC8B4' WHEN 'Gov' THEN '#37B9DC' WHEN 'Private' THEN '#F7A87A'
  ELSE color END
WHERE scope = 'income' AND name IN ('Employer','Client','Gov','Private');

-- =============================================================================
-- 3. 将引用“即将被删”的分类/用途的明细，重定向到同空间同 scope 的预设项
-- =============================================================================
-- receipt_items：若存在且含 category_id，将“非预设分类”的引用改为同空间 Refund(支出) / Other(收入)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'receipt_items') THEN
    UPDATE receipt_items ri
    SET category_id = (
      SELECT c2.id FROM categories c2
      WHERE c2.space_id = (SELECT space_id FROM receipts WHERE id = ri.receipt_id LIMIT 1)
        AND (c2.scope = 'expense' OR c2.scope IS NULL) AND c2.name = 'Refund'
      LIMIT 1
    )
    WHERE ri.category_id IN (
      SELECT id FROM categories
      WHERE (scope IS NULL OR scope = 'expense') AND name NOT IN ('Groceries','Travel','Meal','Housing','Health','Clothing','Education','Entertainment','Software','Utilities','Tax','Refund')
    );
    UPDATE receipt_items ri
    SET category_id = (
      SELECT c2.id FROM categories c2
      WHERE c2.space_id = (SELECT space_id FROM receipts WHERE id = ri.receipt_id LIMIT 1)
        AND c2.scope = 'income' AND c2.name = 'Other'
      LIMIT 1
    )
    WHERE ri.category_id IN (
      SELECT id FROM categories WHERE scope = 'income' AND name NOT IN ('Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other')
    );
  END IF;
END $$;

-- invoice_items：若存在且含 category_id / attribution_id，重定向到同空间预设
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoice_items') THEN
    UPDATE invoice_items ii
    SET category_id = (
      SELECT c.id FROM categories c
      WHERE c.space_id = (SELECT space_id FROM invoices WHERE id = ii.invoice_id LIMIT 1)
        AND c.scope = 'income' AND c.name = 'Other'
      LIMIT 1
    )
    WHERE ii.category_id IS NOT NULL AND ii.category_id IN (
      SELECT id FROM categories WHERE scope = 'income' AND name NOT IN ('Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other')
    );
    UPDATE invoice_items ii
    SET attribution_id = (
      SELECT a.id FROM attributions a
      WHERE a.space_id = (SELECT space_id FROM invoices WHERE id = ii.invoice_id LIMIT 1)
        AND a.scope = 'income' AND a.name = 'Employer'
      LIMIT 1
    )
    WHERE ii.attribution_id IS NOT NULL AND ii.attribution_id IN (
      SELECT id FROM attributions WHERE scope = 'income' AND name NOT IN ('Employer','Client','Gov','Private')
    );
    UPDATE invoice_items ii
    SET attribution_id = (
      SELECT a.id FROM attributions a
      WHERE a.space_id = (SELECT space_id FROM invoices WHERE id = ii.invoice_id LIMIT 1)
        AND (a.scope = 'expense' OR a.scope IS NULL) AND a.name = 'Personal'
      LIMIT 1
    )
    WHERE ii.attribution_id IS NOT NULL AND ii.attribution_id IN (
      SELECT id FROM attributions WHERE (scope IS NULL OR scope = 'expense') AND name NOT IN ('Personal','Business','Client')
    );
  END IF;
END $$;

-- =============================================================================
-- 4. 删除不在预设范围内的分类与用途
-- =============================================================================
DELETE FROM categories
WHERE (scope IS NULL OR scope = 'expense') AND name NOT IN ('Groceries','Travel','Meal','Housing','Health','Clothing','Education','Entertainment','Software','Utilities','Tax','Refund')
   OR scope = 'income' AND name NOT IN ('Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other');

DELETE FROM purposes
WHERE (scope IS NULL OR scope = 'expense') AND name NOT IN ('Personal','Business','Client')
   OR scope = 'income' AND name NOT IN ('Employer','Client','Gov','Private');
