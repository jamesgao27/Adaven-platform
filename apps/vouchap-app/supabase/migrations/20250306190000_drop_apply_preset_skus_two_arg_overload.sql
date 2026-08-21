-- 修复 42725: function firm.apply_preset_skus_to_firm(uuid) is not unique
-- 原因：存在 firm.apply_preset_skus_to_firm(uuid) 与 firm.apply_preset_skus_to_firm(uuid, text)，单参数调用匹配两个重载
-- 处理：删除两参数重载，仅保留单参数版本（create_space_with_user 与客户端 RPC 均调用单参数）

DROP FUNCTION IF EXISTS firm.apply_preset_skus_to_firm(UUID, TEXT);
DROP FUNCTION IF EXISTS public.apply_preset_skus_to_firm(UUID, TEXT);
