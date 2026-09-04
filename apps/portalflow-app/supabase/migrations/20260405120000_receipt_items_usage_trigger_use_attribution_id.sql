-- receipt_items 上历史脚本 add-usage-count-to-categories-purposes.sql 创建的触发器函数仍引用
-- purpose_id / purposes。列已改名为 attribution_id 且语义指向 attributions 后，UPDATE 行项目会
-- 在触发器内报错（列不存在），表现为客户端 "Failed to update item"。
-- 本迁移将计数维护改为 attribution_id + public.attributions（与 FK 一致）。

CREATE OR REPLACE FUNCTION public.update_usage_counts_on_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
      IF OLD.category_id IS NOT NULL THEN
        UPDATE public.categories
        SET usage_count = GREATEST(0, usage_count - 1)
        WHERE id = OLD.category_id;
      END IF;
      IF NEW.category_id IS NOT NULL THEN
        UPDATE public.categories SET usage_count = usage_count + 1 WHERE id = NEW.category_id;
      END IF;
    END IF;

    IF OLD.attribution_id IS DISTINCT FROM NEW.attribution_id THEN
      IF OLD.attribution_id IS NOT NULL THEN
        UPDATE public.attributions
        SET usage_count = GREATEST(0, usage_count - 1)
        WHERE id = OLD.attribution_id;
      END IF;
      IF NEW.attribution_id IS NOT NULL THEN
        UPDATE public.attributions SET usage_count = usage_count + 1 WHERE id = NEW.attribution_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.category_id IS NOT NULL THEN
      UPDATE public.categories SET usage_count = usage_count + 1 WHERE id = NEW.category_id;
    END IF;
    IF NEW.attribution_id IS NOT NULL THEN
      UPDATE public.attributions SET usage_count = usage_count + 1 WHERE id = NEW.attribution_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.category_id IS NOT NULL THEN
      UPDATE public.categories
      SET usage_count = GREATEST(0, usage_count - 1)
      WHERE id = OLD.category_id;
    END IF;
    IF OLD.attribution_id IS NOT NULL THEN
      UPDATE public.attributions
      SET usage_count = GREATEST(0, usage_count - 1)
      WHERE id = OLD.attribution_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_usage_counts_on_item_change() IS
  'Maintains categories.usage_count and attributions.usage_count when receipt_items change; uses attribution_id (not legacy purpose_id).';
