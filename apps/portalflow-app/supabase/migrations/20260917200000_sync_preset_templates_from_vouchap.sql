-- Copy live Vouchap crm.preset_templates display + tax fields onto Portalflow.
-- Covers were uploaded to Portalflow marketplace (same filenames). Do not touch
-- provider.skus / sku_items (existing firms). Items already matched the seed.

INSERT INTO crm.preset_template_labels (dimension, label_name)
VALUES
  ('country', 'CANADA'),
  ('country', 'USA'),
  ('scenario', 'T1'),
  ('scenario', 'T2'),
  ('scenario', '1040'),
  ('scenario', '1120-S')
ON CONFLICT (dimension, label_name_norm) DO NOTHING;

UPDATE crm.preset_templates pt
SET
  name = v.name,
  description = v.description,
  image_url = v.image_url,
  tax_country = v.tax_country,
  tax_scenario = v.tax_scenario,
  tax_country_label_id = (
    SELECT ptl.id
    FROM crm.preset_template_labels ptl
    WHERE ptl.dimension = 'country'
      AND ptl.label_name_norm = lower(v.tax_country)
    LIMIT 1
  ),
  tax_scenario_label_id = (
    SELECT ptl.id
    FROM crm.preset_template_labels ptl
    WHERE ptl.dimension = 'scenario'
      AND ptl.label_name_norm = lower(v.tax_scenario)
    LIMIT 1
  ),
  updated_at = now()
FROM (
  VALUES
    (
      'en', 1,
      'Canada T1 - Rental & Investor Pro',
      'Canada personal tax – rental and investment (T1).',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_093854.png',
      'CANADA', 'T1'
    ),
    (
      'en', 2,
      'Canada T2 - SME Operational Package',
      'Canada corporate tax – standard operations (T2).',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_093737.png',
      'CANADA', 'T2'
    ),
    (
      'en', 3,
      'USA 1040 - Premier Individual',
      'US individual tax – itemized deductions (Form 1040).',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_094325.png',
      'USA', '1040'
    ),
    (
      'en', 4,
      'USA 1120-S - S-Corp Compliance',
      'US S-Corp tax (Form 1120-S).',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_094009.png',
      'USA', '1120-S'
    ),
    (
      'zh', 1,
      'Canada T1 - 加拿大个人报税',
      '加拿大个人报税 - 投资与租赁增强版 (Canada T1 - Rental & Investment)',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_094309.png',
      'CANADA', 'T1'
    ),
    (
      'zh', 2,
      'Canada T2 - 加拿大公司报税',
      '加拿大公司报税 - 标准运营版 (Canada T2 - Corporate Standard)',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_093829.png',
      'CANADA', 'T2'
    ),
    (
      'zh', 3,
      'USA 1040 - 美国个人报税',
      '美国个人报税 - 分项抵扣版 (USA 1040 - Itemized Deductions)',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_094050.png',
      'USA', '1040'
    ),
    (
      'zh', 4,
      'USA 1120-S - 美国公司报税',
      '美国 S-Corp 公司报税 (USA 1120-S - Small Biz)',
      'https://xvqlqvtfogxkfeillvig.supabase.co/storage/v1/object/public/marketplace/IMG_20260228_093929.png',
      'USA', '1120-S'
    )
) AS v(locale, sort_order, name, description, image_url, tax_country, tax_scenario)
WHERE pt.locale = v.locale
  AND pt.sort_order = v.sort_order;
