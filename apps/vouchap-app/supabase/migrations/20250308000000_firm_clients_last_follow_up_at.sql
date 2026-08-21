-- 最后跟进时间由 getFirmClientsWithDetails 从 client_follow_ups 的 max(created_at) 计算，无需 clients 表单独列。
-- 插入跟进记录时仅更新 firm.clients.updated_at，表示该客户行“被触及”。
CREATE OR REPLACE FUNCTION firm.set_client_last_follow_up_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE firm.clients
  SET updated_at = NEW.created_at
  WHERE firm_space_id = NEW.firm_space_id AND client_space_id = NEW.client_space_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 若之前迁移曾添加过 last_follow_up_at，此处统一移除，避免依赖不存在的列报错
ALTER TABLE firm.clients
  DROP COLUMN IF EXISTS last_follow_up_at;
