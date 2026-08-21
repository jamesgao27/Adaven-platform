-- Seed: 4 SKUs and their sku_items (Canada T1/T2, USA 1040/1120)
-- Run after 20250224120000 or 20250224130000. Uses first firm space; set p_firm_space_id to target a specific space.

DO $$
DECLARE
  p_firm_space_id UUID;
  sku1_id UUID;
  sku2_id UUID;
  sku3_id UUID;
  sku4_id UUID;
BEGIN
  SELECT id INTO p_firm_space_id FROM public.spaces WHERE kind = 'firm' LIMIT 1;
  IF p_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'No firm space found. Create a space with kind = ''firm'' first.';
  END IF;

  -- -------------------------------------------------------------------------
  -- A. Canada Individual (T1)
  -- -------------------------------------------------------------------------
  INSERT INTO firm.skus (firm_space_id, name, description)
  VALUES (p_firm_space_id, 'Canada Individual (T1)', 'Personal tax return - Canada (T1)')
  RETURNING id INTO sku1_id;

  INSERT INTO firm.sku_items (sku_id, type, title, description, sort_order) VALUES
    (sku1_id, 'client', 'T4 (Employment)', 'Employment income slip', 1),
    (sku1_id, 'client', 'T5 (Investment)', 'Investment income slip', 2),
    (sku1_id, 'client', 'T4A (Pension)', 'Pension income slip', 3),
    (sku1_id, 'client', 'RRSP contribution slip', 'RRSP contribution room slip', 4),
    (sku1_id, 'client', 'RRSP receipt', 'RRSP contribution receipt', 5),
    (sku1_id, 'client', 'Medical expense receipts', 'Medical expense receipts', 6),
    (sku1_id, 'client', 'Donation receipt', 'Charitable donation receipt', 7),
    (sku1_id, 'client', 'Tuition slip (T2202)', 'Tuition and enrolment certificate', 8),
    (sku1_id, 'client', 'T2125 (Self-employment)', 'Statement of business activities', 9),
    (sku1_id, 'client', 'Rent / property tax receipts', 'Rent and property tax receipts', 10),
    (sku1_id, 'firm', 'Review slips and deductions', 'Review income slips and deduction documents', 11),
    (sku1_id, 'firm', 'File T1 return', 'Prepare and file T1 personal return', 12);

  -- -------------------------------------------------------------------------
  -- B. Canada Corporate (T2)
  -- -------------------------------------------------------------------------
  INSERT INTO firm.skus (firm_space_id, name, description)
  VALUES (p_firm_space_id, 'Canada Corporate (T2)', 'Corporate tax return - Canada (T2)')
  RETURNING id INTO sku2_id;

  INSERT INTO firm.sku_items (sku_id, type, title, description, sort_order) VALUES
    (sku2_id, 'client', 'Certificate of incorporation', 'Corporate registration certificate', 1),
    (sku2_id, 'client', 'Shareholder register', 'Shareholder list / register', 2),
    (sku2_id, 'client', 'Balance sheet', 'Financial statement - balance sheet', 3),
    (sku2_id, 'client', 'Profit & loss statement', 'Income statement (P&L)', 4),
    (sku2_id, 'client', 'Travel expenses', 'Travel expense invoices/receipts', 5),
    (sku2_id, 'client', 'Meals and entertainment', 'Meals and entertainment receipts', 6),
    (sku2_id, 'client', 'Office equipment purchases', 'Office equipment and supplies invoices', 7),
    (sku2_id, 'client', 'Payroll summary', 'Employee payroll summary', 8),
    (sku2_id, 'client', 'Instalment vouchers', 'Tax instalment payment vouchers', 9),
    (sku2_id, 'firm', 'Review financials', 'Review financial statements and supporting docs', 10),
    (sku2_id, 'firm', 'File T2 return', 'Prepare and file T2 corporate return', 11);

  -- -------------------------------------------------------------------------
  -- C. USA Individual (1040)
  -- -------------------------------------------------------------------------
  INSERT INTO firm.skus (firm_space_id, name, description)
  VALUES (p_firm_space_id, 'USA Individual (1040)', 'Personal tax return - USA (Form 1040)')
  RETURNING id INTO sku3_id;

  INSERT INTO firm.sku_items (sku_id, type, title, description, sort_order) VALUES
    (sku3_id, 'client', 'W-2', 'Wage and tax statement', 1),
    (sku3_id, 'client', '1099 series (INT/DIV/B/K)', '1099-INT, 1099-DIV, 1099-B, 1099-K', 2),
    (sku3_id, 'client', 'Form 1098 (Mortgage interest)', 'Mortgage interest statement', 3),
    (sku3_id, 'client', 'SALT documentation', 'State and local tax (SALT) records', 4),
    (sku3_id, 'client', 'FBAR', 'Foreign bank account reporting information', 5),
    (sku3_id, 'client', 'Form 2555', 'Foreign earned income documentation', 6),
    (sku3_id, 'client', 'IRA contribution records', 'IRA contribution records', 7),
    (sku3_id, 'firm', 'Review income and deductions', 'Review income and Schedule A items', 8),
    (sku3_id, 'firm', 'File 1040 return', 'Prepare and file Form 1040', 9);

  -- -------------------------------------------------------------------------
  -- D. USA Corporate (1120/1120-S)
  -- -------------------------------------------------------------------------
  INSERT INTO firm.skus (firm_space_id, name, description)
  VALUES (p_firm_space_id, 'USA Corporate (1120/1120-S)', 'Corporate tax return - USA (Form 1120 / 1120-S)')
  RETURNING id INTO sku4_id;

  INSERT INTO firm.sku_items (sku_id, type, title, description, sort_order) VALUES
    (sku4_id, 'client', 'EIN confirmation', 'EIN confirmation letter', 1),
    (sku4_id, 'client', 'Fixed asset / depreciation schedules', 'Depreciation schedules and asset list', 2),
    (sku4_id, 'client', 'Advertising expense vouchers', 'Advertising expense invoices/receipts', 3),
    (sku4_id, 'client', 'Insurance expense vouchers', 'Insurance payment records', 4),
    (sku4_id, 'client', 'Legal and professional fees', 'Legal and consulting fee invoices', 5),
    (sku4_id, 'client', 'State franchise tax records', 'State franchise tax payment records', 6),
    (sku4_id, 'firm', 'Review financials and expenses', 'Review financials and operating expenses', 7),
    (sku4_id, 'firm', 'File 1120/1120-S return', 'Prepare and file corporate return', 8);

END $$;
