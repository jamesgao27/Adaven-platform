-- 预设 SKU 全英文文案：与中文版四场景一一对应，locale = 'en'，供 firm 选用
-- 依赖：20250224240000（preset_skus.locale、apply 支持 p_locale）

DO $$
DECLARE
  ps1_id UUID;
  ps2_id UUID;
  ps3_id UUID;
  ps4_id UUID;
  p1_id UUID; p2_id UUID; p3_id UUID; p4_id UUID;
  sec_id_identity UUID; sec_standard UUID; sec_rental UUID;
  sec_expenses UUID; sec_personal UUID; sec_review UUID;
  cp1_id UUID; cp2_id UUID; cp3_id UUID; cp4_id UUID;
  csec_legal UUID; csec_accounting UUID; csec_recon UUID;
  csec_payroll UUID; csec_assets UUID; csec_final UUID;
  u1_id UUID; u2_id UUID; u3_id UUID; u4_id UUID;
  usec_personal UUID; usec_earnings UUID; usec_inv UUID;
  usec_taxes UUID; usec_adj UUID; usec_overseas UUID; usec_review UUID;
  s1_id UUID; s2_id UUID; s3_id UUID; s4_id UUID;
  ssec_reg UUID; ssec_ops UUID; ssec_travel UUID;
  ssec_k1 UUID; ssec_final UUID;
BEGIN
  UPDATE firm.preset_skus SET locale = 'zh' WHERE locale IS NULL;

  INSERT INTO firm.preset_skus (name, description, is_published, sort_order, locale) VALUES
    ('2025 Canada T1 - Rental & Investor Pro', 'Canada personal tax – rental and investment (T1).', true, 1, 'en')
  RETURNING id INTO ps1_id;
  INSERT INTO firm.preset_skus (name, description, is_published, sort_order, locale) VALUES
    ('2025 Canada T2 - SME Operational Package', 'Canada corporate tax – standard operations (T2).', true, 2, 'en')
  RETURNING id INTO ps2_id;
  INSERT INTO firm.preset_skus (name, description, is_published, sort_order, locale) VALUES
    ('2025 USA 1040 - Premier Individual', 'US individual tax – itemized deductions (Form 1040).', true, 3, 'en')
  RETURNING id INTO ps3_id;
  INSERT INTO firm.preset_skus (name, description, is_published, sort_order, locale) VALUES
    ('2025 USA 1120-S - S-Corp Compliance', 'US S-Corp tax (Form 1120-S).', true, 4, 'en')
  RETURNING id INTO ps4_id;

  -- ===================== Preset SKU1: Canada T1 (EN) =====================
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, NULL, 'phase', 'client', 'P1: Onboarding', 'Verify identity and CRA authorization so we can file and access tax information on your behalf.', 1)
  RETURNING id INTO p1_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p1_id, 'section', 'client', 'Identity & Authorization', 'Provide ID and CRA representative authorization for filing and e-file.', 1)
  RETURNING id INTO sec_id_identity;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_id_identity, 'task', 'client', 'SIN / ID upload', 'Upload your Canadian Social Insurance Number (SIN) and photo ID (e.g. driver’s licence, PR card, or passport). SIN is used for CRA matching; ID verifies the filer.', 1),
    (ps1_id, sec_id_identity, 'task', 'client', 'CRA Authorize Rep (T1013) – sign', 'Complete and sign Form T1013 so we can communicate with CRA, obtain tax information, and file your T1. We will submit it to CRA to activate.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, NULL, 'phase', 'client', 'P2: Income sources', 'Gather employment, investment, and rental income slips for T1 and T776.', 2)
  RETURNING id INTO p2_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p2_id, 'section', 'client', 'Standard slips', 'T4, T4A, T3, T5, T5008 from employers or payers for employment, pension, investment, and capital gains.', 1)
  RETURNING id INTO sec_standard;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_standard, 'task', 'client', 'T4 / T4A – employment & pension', 'Upload all T4 (employment) and T4A (pension, annuities, other income) slips with payer name, amounts, and tax withheld for T1 employment and pension lines.', 1),
    (ps1_id, sec_standard, 'task', 'client', 'T3 / T5 / T5008 – investment & trading', 'Upload T3 (trust), T5 (investment income), T5008 (securities summary) and broker year-end statements for interest, dividends, capital gains/losses and portfolio reporting on T1.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p2_id, 'section', 'client', 'Rental income (T776)', 'Rental income and related income/expenses for T776 and net rental income on T1.', 2)
  RETURNING id INTO sec_rental;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_rental, 'task', 'client', 'Rental statement (T776)', 'Provide a rental income summary by property (or a T776 draft): rent, vacancy, lease terms. Note any sublets or mixed use. Used to complete T776 and net rental income.', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, NULL, 'phase', 'client', 'P3: Deductions', 'Property costs (tax, insurance, interest, repairs) and personal credits (RRSP, medical, donations) for T776 and T1.', 3)
  RETURNING id INTO p3_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p3_id, 'section', 'client', 'Rental expenses', 'Deductible costs for the rental property: property tax, insurance, condo/management fees, mortgage interest, repairs and maintenance for T776.', 1)
  RETURNING id INTO sec_expenses;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_expenses, 'task', 'client', 'Vouchap: property tax, insurance, condo fees', 'Link or upload property tax, insurance, and condo/management fee receipts. Vouchap can aggregate amounts for the year for T776; confirm data is complete if already linked.', 1),
    (ps1_id, sec_expenses, 'task', 'client', 'Mortgage interest statement', 'Upload the lender’s annual interest statement (or interest summary from statements). Only interest is deductible; if mixed personal/rental, allocate by area or reasonable method for T776.', 2),
    (ps1_id, sec_expenses, 'task', 'client', 'Repairs & maintenance receipts', 'Receipts for repairs and maintenance (e.g. plumbing, cleaning, locks, paint). Must be for the year and directly for the rental; capital improvements are not included here for T776.', 3);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p3_id, 'section', 'client', 'Personal tax credits', 'RRSP contributions, eligible medical expenses, and charitable donations for T1 credits.', 2)
  RETURNING id INTO sec_personal;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_personal, 'task', 'client', 'RRSP contribution receipts', 'Upload RRSP contribution receipts or confirmation from the financial institution (date, amount, plan). For the deduction and room; note tax year if within the 60-day period.', 1),
    (ps1_id, sec_personal, 'task', 'client', 'Medical & donation receipts', 'Eligible medical expense receipts (you and claimable dependants) and official charity receipts for the year. Medical has a threshold; donations have income limits. For T1 medical and charitable credits.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, NULL, 'phase', 'client', 'P4: Review & file', 'We review your file, complete the T1, and after your confirmation file with CRA and deliver the return.', 4)
  RETURNING id INTO p4_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, p4_id, 'section', 'firm', 'Review & file', 'Reconcile income and deductions, complete T1 and T776, then file via EFILE after your confirmation and deliver the return and summary.', 1)
  RETURNING id INTO sec_review;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps1_id, sec_review, 'task', 'firm', 'Final review & T1 filing', 'Complete final review of all income and deductions and T1 (with T776 and other schedules); confirm refund/balance and key figures with you, then file via EFILE and deliver the signed return and summary.', 1);

  -- ===================== Preset SKU2: Canada T2 (EN) =====================
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, NULL, 'phase', 'client', 'P1: Governance', 'Shareholder register and board minutes for structure and annual matters, T2 and compliance.', 1)
  RETURNING id INTO cp1_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp1_id, 'section', 'client', 'Legal', 'Shareholder and board records for entity and governance.', 1)
  RETURNING id INTO csec_legal;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_legal, 'task', 'client', 'Shareholder register (annual update)', 'Shareholder register as at year-end: names, share class and number, ownership %, and any changes. For T2 related-party disclosure and capital structure.', 1),
    (ps2_id, csec_legal, 'task', 'client', 'Annual minutes / board resolution', 'Board meeting minutes or annual resolutions for the year (dividends, compensation, material contracts or authorizations). Supports T2 reporting of dividends, compensation, and related-party items.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, NULL, 'phase', 'client', 'P2: Financials', 'Annual financial statements and bank reconciliation for T2 income, expenses, and balance sheet.', 2)
  RETURNING id INTO cp2_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp2_id, 'section', 'client', 'Accounting records', 'Year-end balance sheet and P&L consistent with the books.', 1)
  RETURNING id INTO csec_accounting;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_accounting, 'task', 'client', 'Balance sheet', 'Upload year-end balance sheet (assets, liabilities, equity) consistent with the books and P&L. For T2 balance sheet schedules and tax adjustments.', 1),
    (ps2_id, csec_accounting, 'task', 'client', 'P&L statement', 'Upload P&L for the year (revenue, cost, expenses, pre-tax income), consistent with the books and by income type. For T2 taxable income and expenses.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp2_id, 'section', 'client', 'Reconciliation', 'Bank statements for cash/bank reconciliation and interest/fees.', 2)
  RETURNING id INTO csec_recon;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_recon, 'task', 'client', '12 months bank statements', 'Upload 12 months of bank statements (or full-year summary) for the main operating account. For reconciliation with books, interest income/expense, and large items for T2.', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, NULL, 'phase', 'client', 'P3: Tax compliance', 'Payroll T4 summary, GST/HST returns, and fixed-asset info for T2 and CCA.', 3)
  RETURNING id INTO cp3_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp3_id, 'section', 'client', 'Payroll & GST', 'T4 summary and GST/HST filing for T2 payroll deduction and GST reconciliation.', 1)
  RETURNING id INTO csec_payroll;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_payroll, 'task', 'client', 'T4 Summary (payroll)', 'Upload T4 Summary and T4 slips (or equivalent) with wages, CPP/EI, and tax withheld. For T2 salary deduction and CRA records.', 1),
    (ps2_id, csec_payroll, 'task', 'client', 'GST/HST returns & receipts', 'Upload all GST/HST returns (GST34 or GST RETURN) and CRA confirmations or payment proof for the year. For T2 sales tax and input tax credits and CRA consistency.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp3_id, 'section', 'client', 'Fixed assets', 'Additions and CCA-related info for the year.', 2)
  RETURNING id INTO csec_assets;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_assets, 'task', 'client', 'Additions to CCA (invoices)', 'Upload invoices for assets acquired in the year (equipment, vehicles, furniture, improvements) with date, amount, and use. For CCA and asset pool updates.', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, NULL, 'phase', 'client', 'P4: Approval', 'We complete T2 review and filing and deliver the return after your confirmation.', 4)
  RETURNING id INTO cp4_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, cp4_id, 'section', 'firm', 'Final approval', 'Reconcile financials and tax, complete T2, then file and deliver after confirmation.', 1)
  RETURNING id INTO csec_final;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps2_id, csec_final, 'task', 'firm', 'Final review & T2 filing', 'Complete final review of T2 and schedules (financials, CCA, related parties); confirm taxable income and tax with you, then file and deliver the signed T2 and summary.', 1);

  -- ===================== Preset SKU3: USA 1040 (EN) =====================
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, NULL, 'phase', 'client', 'P1: Filing status', 'Verify SSN/ITIN and direct deposit for 1040 filing and refund.', 1)
  RETURNING id INTO u1_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u1_id, 'section', 'client', 'Personal', 'Taxpayer ID and refund banking for 1040 and direct deposit.', 1)
  RETURNING id INTO usec_personal;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_personal, 'task', 'client', 'SSN / ITIN verification', 'Provide SSN or ITIN and name, DOB for 1040 and IRS matching. ITIN required if no SSN for refund.', 1),
    (ps3_id, usec_personal, 'task', 'client', 'Direct deposit (refund)', 'Bank account for federal refund: account holder name, routing number, account number, and type (checking/savings). For 1040 direct deposit.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, NULL, 'phase', 'client', 'P2: Worldwide income', 'Wages, gig, and investment income for 1040 and schedules.', 2)
  RETURNING id INTO u2_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u2_id, 'section', 'client', 'Earnings', 'W-2 and 1099-NEC/1099-K for wages and self-employment/gig.', 1)
  RETURNING id INTO usec_earnings;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_earnings, 'task', 'client', 'W-2 (wages)', 'Upload all W-2s (employer EIN, wages, federal/state tax, FICA). For 1040 wages and withholding; provide all if multiple.', 1),
    (ps3_id, usec_earnings, 'task', 'client', '1099-K / 1099-NEC (gig)', 'Upload 1099-NEC and 1099-K as applicable. For self-employment, gig, and side income and Schedule C/SE; provide expense support if any.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u2_id, 'section', 'client', 'Investments', 'Interest, dividends, and capital gains 1099s and broker statements for 1040 and Schedules B/D.', 2)
  RETURNING id INTO usec_inv;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_inv, 'task', 'client', '1099-INT / DIV / B (interest, dividends, sales)', 'Upload 1099-INT, 1099-DIV, 1099-B and broker year-end summary. For interest, dividends, capital gains/losses and Schedules B/D; note foreign accounts or foreign tax credit if applicable.', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, NULL, 'phase', 'client', 'P3: Schedule A (itemized)', 'SALT, mortgage interest, education, and charity for Schedule A and 1040.', 3)
  RETURNING id INTO u3_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u3_id, 'section', 'client', 'Taxes & interest', 'SALT and mortgage interest for Schedule A (subject to limits).', 1)
  RETURNING id INTO usec_taxes;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_taxes, 'task', 'client', 'Form 1098 (mortgage interest)', 'Upload 1098 from the lender for qualified home mortgage interest paid in the year. For Schedule A; note if multiple properties or mixed use.', 1),
    (ps3_id, usec_taxes, 'task', 'client', 'SALT (state & local tax) proof', 'Proof of state and local tax paid (e.g. property tax, sales tax) or state withholding from W-2. For Schedule A SALT deduction (federal $10k cap).', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u3_id, 'section', 'client', 'Adjustments', 'Education and charitable receipts for education credits and itemized charity.', 2)
  RETURNING id INTO usec_adj;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_adj, 'task', 'client', 'Education (1098-T)', 'Upload 1098-T and payment records for tuition and student loan interest. For education credits (e.g. AOTC, Lifetime Learning) or student loan interest deduction.', 1),
    (ps3_id, usec_adj, 'task', 'client', 'Charity receipts', 'Receipts from qualified 501(c)(3) charities with name, amount, date. Cash needs written acknowledgment; non-cash needs description and value. For Schedule A charity (AGI limits apply).', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, NULL, 'phase', 'client', 'P4: FBAR / foreign', 'Foreign accounts and 1040 final review and filing; FBAR (FinCEN 114) if applicable.', 4)
  RETURNING id INTO u4_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u4_id, 'section', 'client', 'Overseas assets', 'Foreign financial account information for FBAR and 1040 schedules if applicable.', 1)
  RETURNING id INTO usec_overseas;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_overseas, 'task', 'client', 'FBAR (FinCEN 114) – foreign accounts', 'If you are a US person and aggregate value of foreign financial accounts (signature authority or beneficial interest) exceeded $10k at any time in the year, FBAR (FinCEN 114) is required. Provide: country, institution, account number, type, and maximum value (USD) during the year for preparation; deadline typically April (extensions available).', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, u4_id, 'section', 'firm', 'Review & file', 'Final review of 1040 and schedules, then file with IRS and deliver after confirmation.', 2)
  RETURNING id INTO usec_review;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps3_id, usec_review, 'task', 'firm', 'Final review & 1040 filing', 'Complete final review of 1040 and Schedule A and all schedules; confirm refund/balance and key figures with you, then e-file and deliver the signed return and summary.', 1);

  -- ===================== Preset SKU4: USA 1120-S (EN) =====================
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, NULL, 'phase', 'client', 'P1: Entity setup', 'EIN and S-election confirmation for 1120-S.', 1)
  RETURNING id INTO s1_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, s1_id, 'section', 'client', 'Registration', 'EIN and S-corp election for entity and pass-through status.', 1)
  RETURNING id INTO ssec_reg;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, ssec_reg, 'task', 'client', 'EIN confirmation', 'Upload IRS EIN confirmation (e.g. CP 575). For 1120-S header and IRS consistency; note any EIN change.', 1),
    (ps4_id, ssec_reg, 'task', 'client', 'S-Corp election (Form 2553)', 'Upload IRS acceptance of Form 2553. Confirms S-corp status, effective date, and shareholder consent for 1120-S.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, NULL, 'phase', 'client', 'P2: Bookkeeping', 'Revenue, COGS, travel and meals support for 1120-S.', 2)
  RETURNING id INTO s2_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, s2_id, 'section', 'client', 'Operations', 'Sales and COGS for 1120-S gross receipts and COGS.', 1)
  RETURNING id INTO ssec_ops;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, ssec_ops, 'task', 'client', 'Gross receipts support', 'Sales summary and support (invoices, payments, 1099s) for the year. For 1120-S gross receipts and reconciliation; note if multiple revenue types.', 1),
    (ps4_id, ssec_ops, 'task', 'client', 'COGS records', 'COGS detail and support (purchases, inventory, labor/overhead if applicable). For 1120-S COGS and gross profit; must match P&L.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, s2_id, 'section', 'client', 'Travel & meals', 'Travel and business meal receipts for 1120-S (meals 50% deductible).', 2)
  RETURNING id INTO ssec_travel;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, ssec_travel, 'task', 'client', 'Vouchap: travel & meals', 'Link or upload travel (flights, hotel, car) and business meal receipts with date, place, business purpose, and attendees. Meals applied at 50% for 1120-S.', 1);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, NULL, 'phase', 'client', 'P3: Shareholder activity', 'Distributions and shareholder loans for K-1 and 1120-S.', 3)
  RETURNING id INTO s3_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, s3_id, 'section', 'client', 'K-1 / distribution', 'Per-shareholder distribution and loan info for Schedule K-1 and 1120-S.', 1)
  RETURNING id INTO ssec_k1;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, ssec_k1, 'task', 'client', 'Distributions (draws / dividends)', 'Per-shareholder distributions for the year: date, amount, form (cash/property), and account. For 1120-S distributions and K-1 Box 16 and basis.', 1),
    (ps4_id, ssec_k1, 'task', 'client', 'Shareholder loans', 'Loans between shareholders and the company: amounts, repayments, interest (if any). For K-1 debt basis, distributions, and 1120-S balance sheet to avoid reclassification issues.', 2);
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, NULL, 'phase', 'client', 'P4: Final review', 'We complete 1120-S and K-1 review, then file and deliver after confirmation.', 4)
  RETURNING id INTO s4_id;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, s4_id, 'section', 'firm', 'Final review', 'Reconcile 1120-S and K-1s, then file and deliver after confirmation.', 1)
  RETURNING id INTO ssec_final;
  INSERT INTO firm.preset_sku_items (preset_sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (ps4_id, ssec_final, 'task', 'firm', 'Final review & 1120-S filing', 'Complete final review of 1120-S and all Schedule K-1s; confirm taxable income, tax, and K-1 figures with you, then file and deliver signed 1120-S and K-1s for shareholder use.', 1);

END $$;
