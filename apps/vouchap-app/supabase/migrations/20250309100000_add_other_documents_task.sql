-- Add "Other documents" task to every sku and preset_sku: last task of the first section of the first phase.
-- Unmatched files are associated with this task (or the first task if no "Other" exists).
-- Idempotent: only inserts when the first section does not already have a task whose title contains "other".

-- 1. firm.sku_items: for each sku, first phase -> first section -> append "Other documents" task if not present
INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, initial_responsible_side, title, description, sort_order)
SELECT
  s.id,
  sec.id,
  'task',
  'client',
  'Other documents',
  'Documents that do not match other tasks; kept for reference and preview.',
  (SELECT COALESCE(MAX(si.sort_order), 0) + 1 FROM firm.sku_items si WHERE si.parent_id = sec.id)
FROM firm.skus s
CROSS JOIN LATERAL (
  SELECT id FROM firm.sku_items
  WHERE sku_id = s.id AND parent_id IS NULL AND item_kind = 'phase'
  ORDER BY sort_order, id LIMIT 1
) ph(phase_id)
CROSS JOIN LATERAL (
  SELECT id FROM firm.sku_items
  WHERE sku_id = s.id AND parent_id = ph.phase_id AND item_kind = 'section'
  ORDER BY sort_order, id LIMIT 1
) sec(id)
WHERE NOT EXISTS (
  SELECT 1 FROM firm.sku_items si
  WHERE si.parent_id = sec.id
    AND (si.title ILIKE '%other%' OR si.title LIKE '%其他%' OR si.title LIKE '%其它%' OR si.title LIKE '%其余%' OR si.title ILIKE '%autre%' OR si.title ILIKE '%otro%')
);

-- 2. firm.preset_sku_items: same for each preset_sku
INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, initial_responsible_side, title, description, sort_order)
SELECT
  p.id,
  sec.id,
  'task',
  'client',
  'Other documents',
  'Documents that do not match other tasks; kept for reference and preview.',
  (SELECT COALESCE(MAX(psi.sort_order), 0) + 1 FROM firm.preset_sku_items psi WHERE psi.parent_id = sec.id)
FROM firm.preset_skus p
CROSS JOIN LATERAL (
  SELECT id FROM firm.preset_sku_items
  WHERE preset_sku_id = p.id AND parent_id IS NULL AND item_kind = 'phase'
  ORDER BY sort_order, id LIMIT 1
) ph(phase_id)
CROSS JOIN LATERAL (
  SELECT id FROM firm.preset_sku_items
  WHERE preset_sku_id = p.id AND parent_id = ph.phase_id AND item_kind = 'section'
  ORDER BY sort_order, id LIMIT 1
) sec(id)
WHERE NOT EXISTS (
  SELECT 1 FROM firm.preset_sku_items psi
  WHERE psi.parent_id = sec.id
    AND (psi.title ILIKE '%other%' OR psi.title LIKE '%其他%' OR psi.title LIKE '%其它%' OR psi.title LIKE '%其余%' OR psi.title ILIKE '%autre%' OR psi.title ILIKE '%otro%')
);
