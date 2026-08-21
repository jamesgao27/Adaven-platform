-- =============================================================================
-- 新建空间预设：仅在新空间创建时调用，写入支出/收入分类与用途，并赋予颜色。
-- 颜色仅从「标签颜色库」选取（与前端 TAG_COLOR_LIBRARY / 分类·用途管理页颜色选择器一致）：
--   #F47C7C #5DC8B4 #37B9DC #F7A87A #A8E0C4 #FBF177 #B494DA #F0A093 #A3D8F5 #87E09A
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_default_categories_purposes_for_space(p_space_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  names_arr TEXT[];
  lib TEXT[] := ARRAY['#F47C7C','#5DC8B4','#37B9DC','#F7A87A','#A8E0C4','#FBF177','#B494DA','#F0A093','#A3D8F5','#87E09A'];
  i INT;
  idx INT;
BEGIN
  -- 支出分类（12 项），颜色按库下标循环
  names_arr := ARRAY['Groceries','Travel','Meal','Housing','Health','Clothing','Education','Entertainment','Software','Utilities','Tax','Refund'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO categories (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'expense');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  -- 收入分类（8 项，Other 排最后）
  names_arr := ARRAY['Salary','Sales','Fee','Bonus','Tax','Grant','Refund','Other'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO categories (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'income');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  -- 支出用途（3 项）
  names_arr := ARRAY['Personal','Business','Client'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO purposes (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'expense');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  -- 收入来源（4 项）
  names_arr := ARRAY['Employer','Client','Gov','Private'];
  FOR i IN 1..array_length(names_arr, 1) LOOP
    idx := ((i - 1) % 10) + 1;
    BEGIN
      INSERT INTO purposes (space_id, name, color, is_default, scope)
      VALUES (p_space_id, names_arr[i], lib[idx], false, 'income');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION seed_default_categories_purposes_for_space(UUID) IS
  '为新空间写入支出/收入预设分类与用途，颜色仅从标签颜色库选取（与前端一致）。';
