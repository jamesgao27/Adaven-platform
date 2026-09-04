-- Portalflow empty-project baseline (pre-Firm overlay).
-- Reconstructs public tables that historical migrations assume already exist.
-- No Vouchap user data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================
-- 完整数据库创建脚本（已清理：household->space, store->supplier）
-- 适用于新 Supabase 项目
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================

-- 注意：此脚本不包含 DROP 语句，适用于全新项目
-- 如果项目已有数据，请先备份

-- ============================================
-- 第一步：创建所有表结构
-- ============================================

-- 创建 spaces 表（空间账户，原 households）
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 users 表（用户表，使用 Supabase Auth）
-- 注意：space_id 和 current_space_id 可以为 NULL（支持两步注册）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  space_id UUID REFERENCES spaces(id) ON DELETE SET NULL, -- 可空，向后兼容
  current_space_id UUID REFERENCES spaces(id) ON DELETE SET NULL, -- 当前活动的空间
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 user_spaces 表（用户-空间多对多关系，原 user_households）
CREATE TABLE IF NOT EXISTS user_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, space_id)
);

-- 创建 categories 表（消费分类，每个空间独立）
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#95A5A6',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

-- 创建 payment_accounts 表（支付账户，每个空间独立）
CREATE TABLE IF NOT EXISTS payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_ai_recognized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

-- 创建 purposes 表（商品用途，每个空间独立）
CREATE TABLE IF NOT EXISTS purposes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#95A5A6',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

-- 创建 suppliers 表（供应商，原 stores）
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_number TEXT,
  phone TEXT,
  address TEXT,
  is_ai_recognized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

-- 创建 receipts 表
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL, -- 原 store_name
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL, -- 原 store_id
  total_amount DECIMAL(10, 2) NOT NULL,
  currency TEXT,
  tax DECIMAL(10, 2),
  date DATE NOT NULL,
  payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'confirmed', 'duplicate'
  image_url TEXT,
  confidence DECIMAL(3, 2), -- 0.00 to 1.00
  processed_by TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 receipt_items 表
CREATE TABLE IF NOT EXISTS receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  purpose_id UUID REFERENCES purposes(id) ON DELETE SET NULL,
  price DECIMAL(10, 2) NOT NULL,
  is_asset BOOLEAN DEFAULT FALSE,
  confidence DECIMAL(3, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 space_invitations 表（空间邀请，原 household_invitations）
CREATE TABLE IF NOT EXISTS space_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  inviter_email TEXT,
  space_name TEXT, -- 原 household_name
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled', 'declined', 'removed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled', 'declined', 'removed'))
);

-- 创建 supplier_merge_history 表（供应商合并历史，原 store_merge_history）
CREATE TABLE IF NOT EXISTS supplier_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_supplier_name TEXT NOT NULL, -- 原 source_store_name
  target_supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE, -- 原 target_store_id
  merged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 payment_account_merge_history 表（支付账户合并历史）
CREATE TABLE IF NOT EXISTS payment_account_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_account_name TEXT NOT NULL,
  target_account_id UUID NOT NULL REFERENCES payment_accounts(id) ON DELETE CASCADE,
  merged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建 ai_chat_logs 表（AI 对话日志）
CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  model_name TEXT,
  prompt TEXT,
  response TEXT,
  request_data JSONB,
  response_data JSONB,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  confidence NUMERIC(3,2),
  processing_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 第二步：创建索引以提高查询性能
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_space_id ON users(space_id);
CREATE INDEX IF NOT EXISTS idx_users_current_space_id ON users(current_space_id);
CREATE INDEX IF NOT EXISTS idx_user_spaces_user_id ON user_spaces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_spaces_space_id ON user_spaces(space_id);
CREATE INDEX IF NOT EXISTS idx_categories_space_id ON categories(space_id);
CREATE INDEX IF NOT EXISTS idx_payment_accounts_space_id ON payment_accounts(space_id);
CREATE INDEX IF NOT EXISTS idx_purposes_space_id ON purposes(space_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_space_id ON suppliers(space_id);
CREATE INDEX IF NOT EXISTS idx_receipts_space_id ON receipts(space_id);
CREATE INDEX IF NOT EXISTS idx_receipts_supplier_id ON receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category_id ON receipt_items(category_id);
CREATE INDEX IF NOT EXISTS idx_space_invitations_space_id ON space_invitations(space_id);
CREATE INDEX IF NOT EXISTS idx_space_invitations_email ON space_invitations(invitee_email);
CREATE INDEX IF NOT EXISTS idx_space_invitations_status ON space_invitations(status);
CREATE INDEX IF NOT EXISTS idx_supplier_merge_history_space_id ON supplier_merge_history(space_id);
CREATE INDEX IF NOT EXISTS idx_supplier_merge_history_source_name ON supplier_merge_history(space_id, source_supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_merge_history_target_id ON supplier_merge_history(target_supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_account_merge_history_space_id ON payment_account_merge_history(space_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_space_id ON ai_chat_logs(space_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user_id ON ai_chat_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_receipt_id ON ai_chat_logs(receipt_id);

-- 创建唯一索引确保每个空间-邮箱组合只有一个待处理邀请
CREATE UNIQUE INDEX IF NOT EXISTS idx_space_invitations_unique_email 
ON space_invitations(space_id, LOWER(TRIM(invitee_email)))
WHERE status = 'pending';

-- ============================================
-- 第三步：创建辅助函数
-- ============================================

-- 创建 updated_at 自动更新触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为相关表创建 updated_at 触发器
CREATE TRIGGER update_spaces_updated_at BEFORE UPDATE ON spaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_accounts_updated_at BEFORE UPDATE ON payment_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purposes_updated_at BEFORE UPDATE ON purposes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_receipts_updated_at BEFORE UPDATE ON receipts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 检查空间是否有至少一个管理员的触发器函数
CREATE OR REPLACE FUNCTION check_space_has_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- 处理 DELETE 操作
  IF (TG_OP = 'DELETE') THEN
    -- 如果正在删除管理员，且还有其他成员，确保至少还有一个管理员
    IF (OLD.is_admin = TRUE) THEN
      IF (SELECT COUNT(*) FROM user_spaces WHERE space_id = OLD.space_id AND user_id != OLD.user_id) > 0 THEN
        IF (SELECT COUNT(*) FROM user_spaces WHERE space_id = OLD.space_id AND is_admin = TRUE AND user_id != OLD.user_id) = 0 THEN
          RAISE EXCEPTION 'Cannot remove the last admin of a space';
        END IF;
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  
  -- 处理 UPDATE 操作
  IF (TG_OP = 'UPDATE') THEN
    -- 如果正在移除管理员权限，确保至少还有一个管理员
    IF (NEW.is_admin = FALSE AND OLD.is_admin = TRUE) THEN
      IF (SELECT COUNT(*) FROM user_spaces WHERE space_id = NEW.space_id AND is_admin = TRUE AND user_id != NEW.user_id) = 0 THEN
        RAISE EXCEPTION 'Cannot remove admin status: space must have at least one admin';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为 user_spaces 表创建触发器
CREATE TRIGGER check_space_has_admin_trigger
    BEFORE DELETE OR UPDATE ON user_spaces
    FOR EACH ROW EXECUTE FUNCTION check_space_has_admin();

-- ============================================
-- 注意：以下函数需要从完整的 SQL 导出文件中获取
-- 由于文件很大，建议使用 clean-schema.py 脚本处理原始导出文件
-- ============================================

-- 需要创建的函数包括：
-- - create_default_categories(p_space_id)
-- - create_default_payment_accounts(p_space_id)
-- - create_default_purposes(p_space_id)
-- - create_space_with_user(...)
-- - create_user_with_space(...)
-- - get_user_space_id()
-- - get_user_space_ids()
-- - get_space_member_users(p_space_id)
-- - create_space_invitation(...)
-- - 等等

-- 完整的函数定义请参考 create-new-project-schema-complete.sql 文件
-- 或使用 clean-schema.py 脚本处理原始 SQL 导出文件


-- ===== functions from complete schema =====

-- 创建函数：获取用户当前家庭ID（用于 RLS）
CREATE OR REPLACE FUNCTION get_user_space_id()
RETURNS UUID AS $$
  SELECT current_space_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 创建函数：检查两个用户是否在同一家庭
CREATE OR REPLACE FUNCTION users_in_same_space(p_current_user_id UUID, p_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM user_spaces uh1
    INNER JOIN user_spaces uh2 ON uh1.space_id = uh2.space_id
    WHERE uh1.user_id = p_current_user_id
      AND uh2.user_id = p_target_user_id
  );
$$;

-- 创建函数：为新用户创建家庭和用户记录（绕过 RLS）
CREATE OR REPLACE FUNCTION create_user_with_space(
  p_user_id UUID,
  p_email TEXT,
  p_space_name TEXT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_space_id UUID;
  v_final_space_name TEXT;
BEGIN
  -- 生成家庭名称
  IF p_space_name IS NULL OR p_space_name = '' THEN
    v_final_space_name := split_part(p_email, '@', 1) || '的空间';
  ELSE
    v_final_space_name := p_space_name;
  END IF;

  -- 创建家庭
  INSERT INTO spaces (name)
  VALUES (v_final_space_name)
  RETURNING id INTO v_space_id;

  -- 创建用户记录（如果不存在）
  INSERT INTO users (id, email, name, space_id, current_space_id)
  VALUES (p_user_id, p_email, p_user_name, v_space_id, v_space_id)
  ON CONFLICT (id) 
  DO UPDATE SET 
    email = p_email,
    name = COALESCE(p_user_name, users.name),
    space_id = v_space_id,
    current_space_id = COALESCE(users.current_space_id, v_space_id);

  -- 创建 user_spaces 关联记录
  INSERT INTO user_spaces (user_id, space_id, is_admin)
  VALUES (p_user_id, v_space_id, TRUE)
  ON CONFLICT (user_id, space_id) DO NOTHING;

  -- 返回家庭 ID
  RETURN v_space_id;
END;
$$;

-- 创建默认分类的函数
CREATE OR REPLACE FUNCTION create_default_categories(p_space_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO categories (space_id, name, color, is_default) VALUES
    (p_space_id, 'Groceries', '#FF6B6B', true),
    (p_space_id, 'Dining Out', '#4ECDC4', true),
    (p_space_id, 'Transportation', '#FFA07A', true),
    (p_space_id, 'Personal Care', '#FFD93D', true),
    (p_space_id, 'Health', '#F7DC6F', true),
    (p_space_id, 'Entertainment', '#E17055', true),
    (p_space_id, 'Education', '#BB8FCE', true),
    (p_space_id, 'Housing', '#45B7D1', true),
    (p_space_id, 'Utilities', '#74B9FF', true),
    (p_space_id, 'Clothing', '#FD79A8', true),
    (p_space_id, 'Subscriptions', '#55A3FF', true)
  ON CONFLICT (space_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 创建默认支付账户的函数（只创建 Cash）
CREATE OR REPLACE FUNCTION create_default_payment_accounts(p_space_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO payment_accounts (space_id, name, is_ai_recognized) VALUES
    (p_space_id, 'Cash', true)
  ON CONFLICT (space_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 创建默认用途的函数
CREATE OR REPLACE FUNCTION create_default_purposes(p_space_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO purposes (space_id, name, color, is_default) VALUES
    (p_space_id, 'Home', '#00B894', true),
    (p_space_id, 'Gifts', '#E84393', true),
    (p_space_id, 'Business', '#FF9500', true)
  ON CONFLICT (space_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 创建函数：自动过期邀请
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS void AS $$
BEGIN
  UPDATE space_invitations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 第六步：授予函数执行权限
-- ============================================
GRANT EXECUTE ON FUNCTION create_user_with_space(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_default_categories(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_default_payment_accounts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_default_purposes(UUID) TO authenticated;



-- ===== RLS from complete schema =====

-- ============================================
-- 第七步：启用 Row Level Security (RLS)
-- ============================================
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purposes ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_account_merge_history ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 第八步：创建 RLS 策略
-- ============================================

-- ============================================
-- Households 策略
-- ============================================
-- 查看：用户只能查看自己所属的家庭
CREATE POLICY "spaces_select_policy" ON spaces
  FOR SELECT 
  USING (
    id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- 插入：允许任何已认证用户创建家庭（注册时需要）
-- 重要：新用户还没有 space_id，所以必须允许所有已认证用户创建
CREATE POLICY "spaces_insert_policy" ON spaces
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 更新：用户只能更新自己所属的家庭
CREATE POLICY "spaces_update_policy" ON spaces
  FOR UPDATE 
  USING (
    id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Users 策略（关键：必须允许新用户插入自己的记录）
-- ============================================
-- 查看：用户可以查看同一家庭中所有成员的信息，或者自己的信息
CREATE POLICY "users_select_policy" ON users
  FOR SELECT 
  USING (
    -- 用户可以查看自己的记录
    id = auth.uid()
    OR
    -- 或者用户可以查看同一家庭中其他成员的记录
    users_in_same_space(auth.uid(), users.id)
  );

-- 插入：允许用户创建自己的记录（注册时需要）
-- 关键：必须确保 id = auth.uid()，防止用户创建其他用户的记录
-- 允许 space_id 和 current_space_id 为 NULL（两步注册）
CREATE POLICY "users_insert_policy" ON users
  FOR INSERT 
  WITH CHECK (id = auth.uid());

-- 更新：用户只能更新自己的记录
CREATE POLICY "users_update_policy" ON users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================
-- User Households 策略
-- ============================================
-- 查看：用户可以查看自己的家庭关联
CREATE POLICY "user_spaces_select_policy" ON user_spaces
  FOR SELECT 
  USING (user_id = auth.uid());

-- 插入：用户可以插入自己的家庭关联（加入家庭）
CREATE POLICY "user_spaces_insert_policy" ON user_spaces
  FOR INSERT 
  WITH CHECK (user_id = auth.uid());

-- 更新：用户可以更新自己的家庭关联（例如成为管理员）
CREATE POLICY "user_spaces_update_policy" ON user_spaces
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 删除：用户可以删除自己的家庭关联（离开家庭）
CREATE POLICY "user_spaces_delete_policy" ON user_spaces
  FOR DELETE 
  USING (user_id = auth.uid());

-- ============================================
-- Categories 策略
-- ============================================
CREATE POLICY "categories_manage_policy" ON categories
  FOR ALL 
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Payment Accounts 策略
-- ============================================
CREATE POLICY "payment_accounts_manage_policy" ON payment_accounts
  FOR ALL 
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Purposes 策略
-- ============================================
CREATE POLICY "purposes_manage_policy" ON purposes
  FOR ALL 
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Receipts 策略
-- ============================================
CREATE POLICY "receipts_manage_policy" ON receipts
  FOR ALL 
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Receipt Items 策略
-- ============================================
CREATE POLICY "receipt_items_manage_policy" ON receipt_items
  FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM receipts 
      WHERE receipts.id = receipt_items.receipt_id 
      AND receipts.space_id IN (
        SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM receipts 
      WHERE receipts.id = receipt_items.receipt_id 
      AND receipts.space_id IN (
        SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- Household Invitations 策略
-- ============================================
-- 查看：用户可以查看自己家庭的邀请或自己收到的邀请
CREATE POLICY "space_invitations_select_policy" ON space_invitations
  FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
    OR invitee_email = (SELECT email FROM users WHERE id = auth.uid())
  );

-- 插入：用户可以为自己家庭创建邀请（必须是管理员）
CREATE POLICY "space_invitations_insert_policy" ON space_invitations
  FOR INSERT
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces 
      WHERE user_id = auth.uid() AND is_admin = TRUE
    )
  );

-- 更新：用户可以更新自己收到的邀请（接受邀请）
CREATE POLICY "space_invitations_update_policy" ON space_invitations
  FOR UPDATE
  USING (
    invitee_email = (SELECT email FROM users WHERE id = auth.uid())
  )
  WITH CHECK (
    invitee_email = (SELECT email FROM users WHERE id = auth.uid())
  );

-- ============================================
-- Payment Account Merge History 策略
-- ============================================
-- 用户只能访问自己家庭的合并历史
CREATE POLICY "payment_account_merge_history_manage_policy" ON payment_account_merge_history
  FOR ALL
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces WHERE user_id = auth.uid()
    )
  );



-- ===== voucher types (invoices/inbound/outbound/skus) =====

-- ============================================================
-- 凭证种类扩展：采购端 receipt/入库单，销售端 invoice/出库单
-- 标准 SKU 表 + invoices + 入库单/出库单（含商品明细与数量）
-- 在 Supabase SQL Editor 中执行此脚本
--
-- 前置：需已存在 spaces, users, user_spaces, suppliers, accounts,
--       categories, purposes 及 update_updated_at_column() 函数。
--
-- 后续：库存与资金流水实时统计可在应用层或通过视图/物化视图基于本脚本
--       所建表进行汇总（receipts/invoices 资金流，inbound_items/outbound_items 按 sku 汇总库存）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 标准 SKU 表（商品主数据，入库/出库明细关联）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  code TEXT,                    -- 商品编码/条码，可选
  name TEXT NOT NULL,           -- 商品名称
  unit TEXT NOT NULL DEFAULT '件',  -- 计量单位：件、个、箱、kg 等
  description TEXT,
  is_ai_recognized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, code)
);

CREATE INDEX IF NOT EXISTS idx_skus_space_id ON skus(space_id);
CREATE INDEX IF NOT EXISTS idx_skus_code ON skus(space_id, code) WHERE code IS NOT NULL;

-- ------------------------------------------------------------
-- 2. 销售发票 invoices（与 receipt 结构镜像，资金流入）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,   -- 客户/买方名称（对应 receipt 的 supplier_name）
  total_amount DECIMAL(10, 2) NOT NULL,
  currency TEXT,
  tax DECIMAL(10, 2),
  date DATE NOT NULL,
  account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,  -- 收款账户
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  input_type TEXT DEFAULT 'image',
  confidence DECIMAL(3, 2),
  processed_by TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  purpose_id UUID REFERENCES purposes(id) ON DELETE SET NULL,
  price DECIMAL(10, 2) NOT NULL,
  is_asset BOOLEAN DEFAULT FALSE,
  confidence DECIMAL(3, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_space_id ON invoices(space_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_category_id ON invoice_items(category_id);

-- ------------------------------------------------------------
-- 3. 入库单 inbound（采购端，含商品明细+数量，关联 SKU）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  document_no TEXT,             -- 入库单号
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,           -- 冗余或无供应商时填写
  total_amount DECIMAL(10, 2),  -- 可选总金额
  currency TEXT,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  input_type TEXT DEFAULT 'image',
  confidence DECIMAL(3, 2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbound_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_id UUID NOT NULL REFERENCES inbound(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,  -- 关联标准 SKU，可为空（待匹配）
  product_name TEXT NOT NULL,   -- 商品显示名称（原始或与 SKU 对应）
  quantity DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT '件',
  unit_price DECIMAL(10, 2),
  confidence DECIMAL(3, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_space_id ON inbound(space_id);
CREATE INDEX IF NOT EXISTS idx_inbound_date ON inbound(date DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_supplier_id ON inbound(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_items_inbound_id ON inbound_items(inbound_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_sku_id ON inbound_items(sku_id) WHERE sku_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. 出库单 outbound（销售端，含商品明细+数量，关联 SKU）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  document_no TEXT,
  customer_name TEXT,           -- 客户/买方
  total_amount DECIMAL(10, 2),
  currency TEXT,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  input_type TEXT DEFAULT 'image',
  confidence DECIMAL(3, 2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_id UUID NOT NULL REFERENCES outbound(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT '件',
  unit_price DECIMAL(10, 2),
  confidence DECIMAL(3, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_space_id ON outbound(space_id);
CREATE INDEX IF NOT EXISTS idx_outbound_date ON outbound(date DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_items_outbound_id ON outbound_items(outbound_id);
CREATE INDEX IF NOT EXISTS idx_outbound_items_sku_id ON outbound_items(sku_id) WHERE sku_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. updated_at 触发器（复用已有函数 update_updated_at_column）
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_skus_updated_at ON skus;
CREATE TRIGGER update_skus_updated_at BEFORE UPDATE ON skus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inbound_updated_at ON inbound;
CREATE TRIGGER update_inbound_updated_at BEFORE UPDATE ON inbound
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_outbound_updated_at ON outbound;
CREATE TRIGGER update_outbound_updated_at BEFORE UPDATE ON outbound
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 6. 启用 RLS
-- ------------------------------------------------------------
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_items ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 7. RLS 策略（与 receipts 一致：按 space_id + user_spaces）
-- ------------------------------------------------------------

-- skus
DROP POLICY IF EXISTS "skus_select_policy" ON skus;
DROP POLICY IF EXISTS "skus_insert_policy" ON skus;
DROP POLICY IF EXISTS "skus_update_policy" ON skus;
DROP POLICY IF EXISTS "skus_delete_policy" ON skus;
CREATE POLICY "skus_select_policy" ON skus FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "skus_insert_policy" ON skus FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "skus_update_policy" ON skus FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "skus_delete_policy" ON skus FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

-- invoices
DROP POLICY IF EXISTS "invoices_select_policy" ON invoices;
DROP POLICY IF EXISTS "invoices_insert_policy" ON invoices;
DROP POLICY IF EXISTS "invoices_update_policy" ON invoices;
DROP POLICY IF EXISTS "invoices_delete_policy" ON invoices;
CREATE POLICY "invoices_select_policy" ON invoices FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "invoices_insert_policy" ON invoices FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "invoices_update_policy" ON invoices FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "invoices_delete_policy" ON invoices FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

-- invoice_items（通过 invoice 归属 space）
DROP POLICY IF EXISTS "invoice_items_select_policy" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert_policy" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_update_policy" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_delete_policy" ON invoice_items;
CREATE POLICY "invoice_items_select_policy" ON invoice_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_items.invoice_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "invoice_items_insert_policy" ON invoice_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_items.invoice_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "invoice_items_update_policy" ON invoice_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_items.invoice_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "invoice_items_delete_policy" ON invoice_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_items.invoice_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));

-- inbound
DROP POLICY IF EXISTS "inbound_select_policy" ON inbound;
DROP POLICY IF EXISTS "inbound_insert_policy" ON inbound;
DROP POLICY IF EXISTS "inbound_update_policy" ON inbound;
DROP POLICY IF EXISTS "inbound_delete_policy" ON inbound;
CREATE POLICY "inbound_select_policy" ON inbound FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "inbound_insert_policy" ON inbound FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "inbound_update_policy" ON inbound FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "inbound_delete_policy" ON inbound FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

-- inbound_items
DROP POLICY IF EXISTS "inbound_items_select_policy" ON inbound_items;
DROP POLICY IF EXISTS "inbound_items_insert_policy" ON inbound_items;
DROP POLICY IF EXISTS "inbound_items_update_policy" ON inbound_items;
DROP POLICY IF EXISTS "inbound_items_delete_policy" ON inbound_items;
CREATE POLICY "inbound_items_select_policy" ON inbound_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM inbound i WHERE i.id = inbound_items.inbound_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "inbound_items_insert_policy" ON inbound_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM inbound i WHERE i.id = inbound_items.inbound_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "inbound_items_update_policy" ON inbound_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM inbound i WHERE i.id = inbound_items.inbound_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "inbound_items_delete_policy" ON inbound_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM inbound i WHERE i.id = inbound_items.inbound_id AND i.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));

-- outbound
DROP POLICY IF EXISTS "outbound_select_policy" ON outbound;
DROP POLICY IF EXISTS "outbound_insert_policy" ON outbound;
DROP POLICY IF EXISTS "outbound_update_policy" ON outbound;
DROP POLICY IF EXISTS "outbound_delete_policy" ON outbound;
CREATE POLICY "outbound_select_policy" ON outbound FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "outbound_insert_policy" ON outbound FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "outbound_update_policy" ON outbound FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "outbound_delete_policy" ON outbound FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

-- outbound_items
DROP POLICY IF EXISTS "outbound_items_select_policy" ON outbound_items;
DROP POLICY IF EXISTS "outbound_items_insert_policy" ON outbound_items;
DROP POLICY IF EXISTS "outbound_items_update_policy" ON outbound_items;
DROP POLICY IF EXISTS "outbound_items_delete_policy" ON outbound_items;
CREATE POLICY "outbound_items_select_policy" ON outbound_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM outbound o WHERE o.id = outbound_items.outbound_id AND o.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "outbound_items_insert_policy" ON outbound_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM outbound o WHERE o.id = outbound_items.outbound_id AND o.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "outbound_items_update_policy" ON outbound_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM outbound o WHERE o.id = outbound_items.outbound_id AND o.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "outbound_items_delete_policy" ON outbound_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM outbound o WHERE o.id = outbound_items.outbound_id AND o.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));

-- ------------------------------------------------------------
-- 8. 注释（便于后续维护）
-- ------------------------------------------------------------
COMMENT ON TABLE skus IS '标准商品 SKU，入库/出库明细可关联此表做库存与统计';
COMMENT ON TABLE invoices IS '销售发票，资金流入，结构对应 receipts';
COMMENT ON TABLE invoice_items IS '发票明细，对应 receipt_items';
COMMENT ON TABLE inbound IS '入库单（采购端），含商品明细与数量';
COMMENT ON TABLE inbound_items IS '入库单明细，关联 sku_id，数量必填';
COMMENT ON TABLE outbound IS '出库单（销售端），含商品明细与数量';
COMMENT ON TABLE outbound_items IS '出库单明细，关联 sku_id，数量必填';

COMMENT ON COLUMN inbound_items.sku_id IS '关联标准 SKU；为空表示待匹配或未建 SKU';
COMMENT ON COLUMN outbound_items.sku_id IS '关联标准 SKU；为空表示待匹配或未建 SKU';


-- ===== customers =====

-- 创建 customers 表（类似 suppliers 表）
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_number TEXT,
  phone TEXT,
  address TEXT,
  is_ai_recognized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

-- 在 invoices 表添加 customer_id 字段
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_customers_space_id ON customers(space_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id) WHERE customer_id IS NOT NULL;

-- 启用 RLS（Row Level Security）
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 创建 RLS 策略：用户可以查看和操作自己空间内的客户
CREATE POLICY "Users can view customers in their spaces"
  ON customers FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert customers in their spaces"
  ON customers FOR INSERT
  WITH CHECK (
    space_id IN (
      SELECT space_id FROM user_spaces 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update customers in their spaces"
  ON customers FOR UPDATE
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete customers in their spaces"
  ON customers FOR DELETE
  USING (
    space_id IN (
      SELECT space_id FROM user_spaces 
      WHERE user_id = auth.uid()
    )
  );

-- 添加注释
COMMENT ON TABLE customers IS '客户表，用于存储发票关联的客户信息';
COMMENT ON COLUMN customers.space_id IS '所属空间ID';
COMMENT ON COLUMN customers.name IS '客户名称';
COMMENT ON COLUMN customers.tax_number IS '税号';
COMMENT ON COLUMN customers.phone IS '电话';
COMMENT ON COLUMN customers.address IS '地址';
COMMENT ON COLUMN customers.is_ai_recognized IS '是否由AI识别创建';
COMMENT ON COLUMN invoices.customer_id IS '关联的客户ID，类似receipts表的supplier_id';


-- ===== warehouse / location =====

-- ============================================================
-- 仓库与仓位：warehouse（仓库）、location（仓位）
-- 一个仓库可有多个仓位
-- 在 Supabase SQL Editor 中执行此脚本
--
-- 前置：需已存在 spaces, user_spaces 及 update_updated_at_column() 函数。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 仓库表 warehouse
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,                    -- 仓库编码，可选
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_space_id ON warehouse(space_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_code ON warehouse(space_id, code) WHERE code IS NOT NULL;

-- ------------------------------------------------------------
-- 2. 仓位表 location（归属仓库，一个仓库多个仓位）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,                    -- 仓位编码，可选
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS idx_location_warehouse_id ON location(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_location_code ON location(warehouse_id, code) WHERE code IS NOT NULL;

-- ------------------------------------------------------------
-- 3. updated_at 触发器
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_warehouse_updated_at ON warehouse;
CREATE TRIGGER update_warehouse_updated_at BEFORE UPDATE ON warehouse
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_location_updated_at ON location;
CREATE TRIGGER update_location_updated_at BEFORE UPDATE ON location
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 4. 启用 RLS
-- ------------------------------------------------------------
ALTER TABLE warehouse ENABLE ROW LEVEL SECURITY;
ALTER TABLE location ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 5. RLS 策略（按 space_id + user_spaces）
-- ------------------------------------------------------------

-- warehouse
DROP POLICY IF EXISTS "warehouse_select_policy" ON warehouse;
DROP POLICY IF EXISTS "warehouse_insert_policy" ON warehouse;
DROP POLICY IF EXISTS "warehouse_update_policy" ON warehouse;
DROP POLICY IF EXISTS "warehouse_delete_policy" ON warehouse;
CREATE POLICY "warehouse_select_policy" ON warehouse FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "warehouse_insert_policy" ON warehouse FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "warehouse_update_policy" ON warehouse FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));
CREATE POLICY "warehouse_delete_policy" ON warehouse FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

-- location（通过 warehouse 归属 space）
DROP POLICY IF EXISTS "location_select_policy" ON location;
DROP POLICY IF EXISTS "location_insert_policy" ON location;
DROP POLICY IF EXISTS "location_update_policy" ON location;
DROP POLICY IF EXISTS "location_delete_policy" ON location;
CREATE POLICY "location_select_policy" ON location FOR SELECT
  USING (EXISTS (SELECT 1 FROM warehouse w WHERE w.id = location.warehouse_id AND w.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "location_insert_policy" ON location FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM warehouse w WHERE w.id = location.warehouse_id AND w.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "location_update_policy" ON location FOR UPDATE
  USING (EXISTS (SELECT 1 FROM warehouse w WHERE w.id = location.warehouse_id AND w.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));
CREATE POLICY "location_delete_policy" ON location FOR DELETE
  USING (EXISTS (SELECT 1 FROM warehouse w WHERE w.id = location.warehouse_id AND w.space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid())));

-- ------------------------------------------------------------
-- 6. 注释
-- ------------------------------------------------------------
COMMENT ON TABLE warehouse IS '仓库；一个空间下可有多个仓库';
COMMENT ON TABLE location IS '仓位；一个仓库下可有多个仓位';
COMMENT ON COLUMN location.warehouse_id IS '所属仓库';


-- ===== entities (later migrations sync suppliers/customers into this) =====

-- ============================================================
-- 迁移：suppliers + customers 合并为 entities
-- 支出/收入/入库/出库统一用 entity_id（Payee/Payer/Sender/Receiver）
-- 执行前请备份。在 Supabase SQL Editor 中执行。
-- ============================================================

-- 1. 创建 entities 表（与 suppliers 同结构，去掉 is_customer）
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_number TEXT,
  phone TEXT,
  address TEXT,
  is_ai_recognized BOOLEAN DEFAULT FALSE,
  merged_into_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(space_id, name)
);

CREATE INDEX IF NOT EXISTS idx_entities_space_id ON entities(space_id);
CREATE INDEX IF NOT EXISTS idx_entities_merged_into_id ON entities(merged_into_id) WHERE merged_into_id IS NOT NULL;

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view entities in their spaces"
  ON entities FOR SELECT
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert entities in their spaces"
  ON entities FOR INSERT
  WITH CHECK (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

CREATE POLICY "Users can update entities in their spaces"
  ON entities FOR UPDATE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete entities in their spaces"
  ON entities FOR DELETE
  USING (space_id IN (SELECT space_id FROM user_spaces WHERE user_id = auth.uid()));

COMMENT ON TABLE entities IS '统一关联方（原供应商+客户），用于支出Payee/收入Payer/入库Sender/出库Receiver';



-- Kernel: new auth user → public.users (two-step register)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, 'user'), '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
