-- 四个典型 SKU 的层级任务清单（L2 Phase → L3 Section → L4 Task）
-- sort_order 为「同 parent 兄弟排序」：phase 层 1,2,3,4；同 phase 下 section 1,2,...；同 section 下 task 1,2,...
-- 依赖：20250224140000（4 个 SKU 已存在）、20250224200000（parent_id, item_kind）

DO $$
DECLARE
  p_firm_space_id UUID;
  sku1_id UUID;
  sku2_id UUID;
  sku3_id UUID;
  sku4_id UUID;
  -- Canada T1
  p1_id UUID; p2_id UUID; p3_id UUID; p4_id UUID;
  sec_id_identity UUID; sec_standard UUID; sec_rental UUID;
  sec_expenses UUID; sec_personal UUID; sec_review UUID;
  -- Canada T2
  cp1_id UUID; cp2_id UUID; cp3_id UUID; cp4_id UUID;
  csec_legal UUID; csec_accounting UUID; csec_recon UUID;
  csec_payroll UUID; csec_assets UUID; csec_final UUID;
  -- USA 1040
  u1_id UUID; u2_id UUID; u3_id UUID; u4_id UUID;
  usec_personal UUID; usec_earnings UUID; usec_inv UUID;
  usec_taxes UUID; usec_adj UUID; usec_overseas UUID; usec_review UUID;
  -- USA 1120-S
  s1_id UUID; s2_id UUID; s3_id UUID; s4_id UUID;
  ssec_reg UUID; ssec_ops UUID; ssec_travel UUID;
  ssec_k1 UUID; ssec_final UUID;
BEGIN
  SELECT id INTO p_firm_space_id FROM public.spaces WHERE kind = 'firm' LIMIT 1;
  IF p_firm_space_id IS NULL THEN
    RAISE EXCEPTION 'No firm space found.';
  END IF;

  -- --------------- 更新 SKU 名称/描述（L1）---------------
  UPDATE firm.skus SET name = '2025 Canada T1 - Rental & Investor Pro',
    description = '加拿大个人报税 - 投资与租赁增强版 (Canada T1 - Rental & Investment)'
  WHERE firm_space_id = p_firm_space_id AND name = 'Canada Individual (T1)' RETURNING id INTO sku1_id;
  UPDATE firm.skus SET name = '2025 Canada T2 - SME Operational Package',
    description = '加拿大公司报税 - 标准运营版 (Canada T2 - Corporate Standard)'
  WHERE firm_space_id = p_firm_space_id AND name = 'Canada Corporate (T2)' RETURNING id INTO sku2_id;
  UPDATE firm.skus SET name = '2025 USA 1040 - Premier Individual',
    description = '美国个人报税 - 分项抵扣版 (USA 1040 - Itemized Deductions)'
  WHERE firm_space_id = p_firm_space_id AND name = 'USA Individual (1040)' RETURNING id INTO sku3_id;
  UPDATE firm.skus SET name = '2025 USA 1120-S - S-Corp Compliance',
    description = '美国 S-Corp 公司报税 (USA 1120-S - Small Biz)'
  WHERE firm_space_id = p_firm_space_id AND name = 'USA Corporate (1120/1120-S)' RETURNING id INTO sku4_id;

  IF sku1_id IS NULL THEN SELECT id INTO sku1_id FROM firm.skus WHERE firm_space_id = p_firm_space_id AND name LIKE '%Canada T1%' LIMIT 1; END IF;
  IF sku2_id IS NULL THEN SELECT id INTO sku2_id FROM firm.skus WHERE firm_space_id = p_firm_space_id AND name LIKE '%Canada T2%' LIMIT 1; END IF;
  IF sku3_id IS NULL THEN SELECT id INTO sku3_id FROM firm.skus WHERE firm_space_id = p_firm_space_id AND name LIKE '%USA 1040%' LIMIT 1; END IF;
  IF sku4_id IS NULL THEN SELECT id INTO sku4_id FROM firm.skus WHERE firm_space_id = p_firm_space_id AND name LIKE '%1120%' LIMIT 1; END IF;

  DELETE FROM firm.sku_items WHERE sku_id IN (sku1_id, sku2_id, sku3_id, sku4_id);

  -- ===================== SKU1: Canada T1 - Rental & Investor Pro =====================
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, NULL, 'phase', 'client', 'P1: 基础准入 (Onboarding)', '客户身份核验与 CRA 代理授权，确保会计师有权代表您申报并获取税务信息。', 1)
  RETURNING id INTO p1_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p1_id, 'section', 'client', '身份与授权 (Identity)', '提供身份证明与 CRA 授权书，用于报税身份核验及电子申报授权。', 1)
  RETURNING id INTO sec_id_identity;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_id_identity, 'task', 'client', 'SIN/ID 证件上传', '请上传加拿大社会保险号（SIN）及带照片的身份证明（如驾照、枫叶卡或护照）。SIN 用于 CRA 报税身份匹配；身份证明用于核实申报人身份。', 1),
    (sku1_id, sec_id_identity, 'task', 'client', 'CRA 代理授权书 (T1013) 在线签署', '填写并签署 CRA 授权代表表 T1013，授权本事务所代表您与 CRA 沟通、获取税务信息并提交 T1 申报。签署后由事务所提交 CRA 生效。', 2);
  -- P2
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, NULL, 'phase', 'client', 'P2: 收入归集 (Income Sources)', '归集工资、投资、租金等各类收入单据，用于填报 T1 收入部分及 T776 租金表。', 2)
  RETURNING id INTO p2_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p2_id, 'section', 'client', '标准收益 (Standard Slips)', '雇主或支付方发出的 T4、T4A、T3、T5、T5008 等官方收入单，用于申报就业、养老金、投资及资本利得。', 1)
  RETURNING id INTO sec_standard;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_standard, 'task', 'client', 'T4/T4A 工资与佣金单据', '上传所有 T4（就业收入）和 T4A（养老金、年金、其他收入等）单据。每份需包含雇主/支付方名称、金额及扣税信息，用于填报 T1 的 employment 与 pension 等栏位。', 1),
    (sku1_id, sec_standard, 'task', 'client', 'T3/T5/T5008 投资收益与交易记录', '上传 T3（信托分配）、T5（投资收入）、T5008（证券交易汇总）及券商年度对账单。用于申报利息、股息、资本利得/亏损及投资组合盈亏，支撑 T1 投资与资本利得部分。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p2_id, 'section', 'client', '租金收入 (Rental Income - T776)', '出租房产的租金收入及与出租相关的收支，用于填报 T776 报表并计入 T1 净租金收入。', 2)
  RETURNING id INTO sec_rental;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_rental, 'task', 'client', '租金收入汇总表 (Rental Statement)', '提供按物业列示的租金收入汇总（或已填好的 T776 草稿）：每处房产的租金收入、空置情况、租赁期限。若有分租或商业混合用途，请分别说明。用于准确填报 T776 并计算净租金收入。', 1);
  -- P3
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, NULL, 'phase', 'client', 'P3: 支出与抵扣 (Deductions)', '归集房产持有成本（地税、保险、利息、维修等）及个人抵扣项（RRSP、医疗、捐赠），用于 T776 费用与 T1 抵税额计算。', 3)
  RETURNING id INTO p3_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p3_id, 'section', 'client', '房产持有成本 (Rental Expenses)', '与出租房产直接相关的可抵扣支出：地税、保险、物业费、贷款利息、维修保养等，用于 T776 费用栏。', 1)
  RETURNING id INTO sec_expenses;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_expenses, 'task', 'client', 'Vouchap 自动归集：地税、保险、物业费', '通过 Vouchap 关联或上传：地税单（property tax）、房屋/租赁保险单、物业管理费或 condo 月费收据。系统可自动归集对应年度金额，用于 T776 填报；若已归集请确认数据完整。', 1),
    (sku1_id, sec_expenses, 'task', 'client', '房屋抵押贷款利息单 (Mortgage Interest)', '上传出租房产的贷款机构出具的年度利息单（或月结单中利息汇总），仅利息部分可抵扣。若自住与出租混合，需按面积或合理比例分摊。用于 T776 利息费用栏。', 2),
    (sku1_id, sec_expenses, 'task', 'client', '维修与保养收据 (Repairs & Maintenance)', '上传与出租物业相关的维修、保养、小型更换的收据或发票（如水电维修、清洁、换锁、油漆等）。需为当年度发生且与出租直接相关；资本性改善不计入此项。用于 T776 维修与保养栏。', 3);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p3_id, 'section', 'client', '个人抵扣 (Personal Tax Credits)', 'RRSP 供款、符合规定的医疗费用及慈善捐赠，用于申请 T1 相应抵税与抵扣。', 2)
  RETURNING id INTO sec_personal;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_personal, 'task', 'client', 'RRSP 购买凭证', '上传 RRSP 供款收据或金融机构出具的供款确认（含供款日期、金额、RRSP 账户信息）。用于申报 RRSP 抵税及更新供款额度；若在 60 天宽限期内供款需注明所属税务年度。', 1),
    (sku1_id, sec_personal, 'task', 'client', '医疗及捐赠收据', '上传税务年度内符合条件的医疗费用收据（本人及可申报家属）及注册慈善机构出具的捐赠收据。医疗费用有起征额；捐赠有收入比例限制。用于 T1 医疗费用抵税与慈善捐赠抵扣。', 2);
  -- P4
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, NULL, 'phase', 'client', 'P4: 审阅交付 (Review & File)', '事务所完成资料审阅与 T1 编制，与您确认后提交 CRA 并交付税表与摘要。', 4)
  RETURNING id INTO p4_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, p4_id, 'section', 'firm', '审阅与提交', '核对收入与抵扣数据、完成 T1 与 T776 编制，经您确认后通过 EFILE 提交 CRA，并交付最终税表与报税摘要。', 1)
  RETURNING id INTO sec_review;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku1_id, sec_review, 'task', 'firm', '最终审阅与 T1 报税提交', '完成全部收入与抵扣的核对与 T1（含 T776 等附表）的最终审阅；与您确认退税/补税金额与关键数字后，通过 EFILE 提交 CRA，并交付签字版税表与报税摘要供您留存。', 1);

  -- ===================== SKU2: Canada T2 - SME Operational Package =====================
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, NULL, 'phase', 'client', 'P1: 公司治理 (Governance)', '提供股东名册与董事会决议等法律文件，用于确认公司结构及年度重大事项，满足 T2 与合规要求。', 1)
  RETURNING id INTO cp1_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp1_id, 'section', 'client', '法律文件 (Legal)', '股东与董事会相关记录，用于支撑公司身份与治理合规。', 1)
  RETURNING id INTO csec_legal;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_legal, 'task', 'client', '年度股东名册更新 (Shareholder Register)', '提供截至财务年度末的股东名册：股东姓名/名称、持股数量与类别、持股比例、变更说明（如有）。用于 T2 关联方披露及公司资本结构核对。', 1),
    (sku2_id, csec_legal, 'task', 'client', '董事会年度决议 (Annual Minutes)', '提供本财务年度董事会会议纪要或年度决议，包括股息分配、高管薪酬、重大合同或授权等与税务相关的决议。用于支撑 T2 中股息、薪酬及关联交易的申报依据。', 2);
  -- P2
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, NULL, 'phase', 'client', 'P2: 财务结转 (Financials)', '提供年度财务报表与银行对账资料，用于 T2 收入、费用与资产负债的填报与核对。', 2)
  RETURNING id INTO cp2_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp2_id, 'section', 'client', '报表提交 (Accounting Records)', '年度资产负债表与损益表，与账套一致，作为 T2 填报的基础数据。', 1)
  RETURNING id INTO csec_accounting;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_accounting, 'task', 'client', '资产负债表 (Balance Sheet)', '上传财务年度末的资产负债表（资产、负债、权益），需与账套及损益表勾稽一致。用于 T2 资产负债表附表及税务调整的起点。', 1),
    (sku2_id, csec_accounting, 'task', 'client', '损益表 (P&L Statement)', '上传本财务年度的损益表（收入、成本、费用、税前利润）。需与账套一致并区分收入类型（主动收入、被动收入、资本利得等），用于 T2 应税收入与费用填报。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp2_id, 'section', 'client', '银行对账 (Reconciliation)', '银行账户月结单，用于与账载现金/银行存款对账及利息、手续费等税务处理核对。', 2)
  RETURNING id INTO csec_recon;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_recon, 'task', 'client', '12 个月的银行月结单 (Bank Statements)', '上传公司主要运营账户本财务年度 12 个月的银行月结单（或完整年度对账单）。用于与账载银行存款对账、核实利息收入/支出及大额往来，支撑 T2 收入与费用准确性。', 1);
  -- P3
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, NULL, 'phase', 'client', 'P3: 税务合规 (Tax Compliance)', '薪酬 T4 汇总、GST/HST 申报及资本资产信息，用于 T2 薪酬扣除、消费税核对与 CCA 计算。', 3)
  RETURNING id INTO cp3_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp3_id, 'section', 'client', '薪酬与消费税 (Payroll & GST)', '员工工资 T4 汇总与 GST/HST 申报记录，用于 T2 薪酬扣除与销项/进项核对。', 1)
  RETURNING id INTO csec_payroll;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_payroll, 'task', 'client', 'T4 Summary (员工工资汇总)', '上传 CRA 要求的 T4 Summary 及所有 T4 附表（或等效的薪酬汇总），包含工资、CPP/EI 扣款、预扣税等。用于 T2 中薪酬费用扣除及与 CRA 记录一致。', 1),
    (sku2_id, csec_payroll, 'task', 'client', 'GST/HST 申报记录与回执', '上传本财务年度内所有 GST/HST 申报表（GST34 或 GST RETURN）及 CRA 确认回执或付款凭证。用于核对 T2 中销售收入与消费税处理、进项抵扣及与 CRA 记录一致。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp3_id, 'section', 'client', '资本资产 (Fixed Assets)', '年度新增固定资产与折旧/CCA 相关信息，用于 T2 资本成本津贴计算。', 2)
  RETURNING id INTO csec_assets;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_assets, 'task', 'client', '年度新增设备/车辆发票 (Additions to CCA)', '上传本财务年度购置的适用 CCA 的资产发票（设备、车辆、家具、装修等），含购置日期、金额、用途说明。用于计算本年度 CCA 扣除及更新资产池/折旧表。', 1);
  -- P4
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, NULL, 'phase', 'client', 'P4: 最终确认 (Approval)', '事务所完成 T2 审阅与编制，经您确认后提交 CRA 并交付税表与摘要。', 4)
  RETURNING id INTO cp4_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, cp4_id, 'section', 'firm', '最终确认', '核对财务与税务数据、完成 T2 编制，经确认后提交 CRA 并交付税表与报税摘要。', 1)
  RETURNING id INTO csec_final;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku2_id, csec_final, 'task', 'firm', '最终审阅与 T2 报税提交', '完成 T2 及附表（含财务报表附表、CCA、关联方等）的最终审阅；与您确认应税收入、应缴/应退税额后，提交 CRA 并交付签字版 T2 与报税摘要供您留存。', 1);

  -- ===================== SKU3: USA 1040 - Premier Individual =====================
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, NULL, 'phase', 'client', 'P1: 税务身份 (Filing Status)', '确认申报身份与退税方式：SSN/ITIN 核验及 Direct Deposit 信息，用于 1040 提交与退税发放。', 1)
  RETURNING id INTO u1_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u1_id, 'section', 'client', '基础资料 (Personal)', '纳税人识别号与退税收款信息，用于身份匹配与退税直接到账。', 1)
  RETURNING id INTO usec_personal;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_personal, 'task', 'client', 'SSN/ITIN 核验', '请提供社会安全号（SSN）或个人纳税人识别号（ITIN）及姓名、出生日期，用于 1040 申报身份核验及与 IRS 记录匹配。无 SSN 者需已取得 ITIN 方可正常申报退税。', 1),
    (sku3_id, usec_personal, 'task', 'client', '银行转账信息 (Direct Deposit 退税)', '提供用于接收联邦退税的银行账户信息：户名、Routing Number、Account Number 及账户类型（支票/储蓄）。用于 1040 上填写退税 Direct Deposit，确保退税款直接到账。', 2);
  -- P2
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, NULL, 'phase', 'client', 'P2: 收入明细 (Worldwide Income)', '归集全球范围内工资、零工、投资等收入单据，用于 1040 及附表收入填报。', 2)
  RETURNING id INTO u2_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u2_id, 'section', 'client', '薪资与零工 (Earnings)', 'W-2 与 1099-NEC/1099-K 等，用于申报工资薪金与自雇/零工收入。', 1)
  RETURNING id INTO usec_earnings;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_earnings, 'task', 'client', 'W-2 (工资单)', '上传所有 W-2 表（每份需包含雇主 EIN、工资、预扣联邦/州税、FICA 等）。用于 1040 工资收入及预缴税填报；多份 W-2 需全部提供以便汇总。', 1),
    (sku3_id, usec_earnings, 'task', 'client', '1099-K / 1099-NEC (零工经济收入)', '上传 1099-NEC（非雇员报酬）及 1099-K（支付卡/第三方网络交易）等。用于申报自雇、零工、副业收入及 Schedule C/SE；若有费用需一并提供支持文件。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u2_id, 'section', 'client', '投资记录 (Investments)', '利息、股息与资本利得相关 1099 及交易记录，用于 1040 投资收入与 Schedule D/B。', 2)
  RETURNING id INTO usec_inv;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_inv, 'task', 'client', '1099-INT / DIV / B (利息、股息、交易)', '上传 1099-INT（利息）、1099-DIV（股息）、1099-B（经纪商交易）及券商年度汇总。用于申报利息与股息收入、资本利得/亏损及 Schedule B/D；若有海外账户或外国税抵免需单独说明。', 1);
  -- P3
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, NULL, 'phase', 'client', 'P3: 分项抵扣 (Schedule A - Itemized)', '归集州地税、住房贷款利息、教育、慈善等分项抵扣支持文件，用于 Schedule A 与 1040 抵税。', 3)
  RETURNING id INTO u3_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u3_id, 'section', 'client', '税费与利息 (Taxes & Interest)', 'SALT 与住房贷款利息凭证，用于 Schedule A 中州地税及住房贷款利息抵扣（受限额约束）。', 1)
  RETURNING id INTO usec_taxes;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_taxes, 'task', 'client', 'Form 1098 (住房贷款利息)', '上传贷款机构出具的 1098 表，列示本年度支付的合格住房贷款利息。用于 Schedule A 住房贷款利息抵扣；若有多套房产或贷款用途混合需注明。', 1),
    (sku3_id, usec_taxes, 'task', 'client', 'SALT (州与地方税) 缴纳凭证', '上传本年度已缴纳的州税、地方税（如房产税、销售税等）的缴款凭证或 W-2 上州税预扣额。用于 Schedule A 的 SALT 抵扣（联邦有 1 万美元上限）。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u3_id, 'section', 'client', '专项支出 (Adjustments)', '教育费用与慈善捐赠收据，用于教育抵税/扣除及慈善捐赠分项抵扣。', 2)
  RETURNING id INTO usec_adj;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_adj, 'task', 'client', '教育支出 (1098-T)', '上传符合条件教育机构出具的 1098-T 及学费、杂费、学生贷款利息等支付记录。用于教育抵税（如 American Opportunity Credit、Lifetime Learning）或学生贷款利息扣除。', 1),
    (sku3_id, usec_adj, 'task', 'client', '慈善捐赠清单 (Charity Receipts)', '上传 501(c)(3) 等合格慈善机构出具的捐赠收据，含机构名称、金额、日期。现金捐赠需书面确认；非现金捐赠需列明物品与估值。用于 Schedule A 慈善捐赠抵扣（受 AGI 比例限制）。', 2);
  -- P4
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, NULL, 'phase', 'client', 'P4: 跨境申报 (FBAR/Foreign)', '海外金融账户申报与 1040 最终审阅提交；若适用需完成 FBAR（FinCEN 114）等申报。', 4)
  RETURNING id INTO u4_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u4_id, 'section', 'client', '海外资产 (Overseas Assets)', '海外银行与金融账户信息，用于 FBAR 及 1040 附表（如适用）的合规申报。', 1)
  RETURNING id INTO usec_overseas;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_overseas, 'task', 'client', 'FBAR (FinCEN 114) 海外银行账户信息汇集', '若美国人在海外金融账户（含签名权或经济利益）在日历年内任一时刻总价值超过 1 万美元，需申报 FBAR（FinCEN 114）。请提供：各账户所在国家、机构名称、账号、账户类型及当年最高余额（美元等值），用于填报或协助填报 FBAR；申报截止通常为 4 月（可延期）。', 1);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, u4_id, 'section', 'firm', '审阅与提交', '完成 1040 及附表审阅，经确认后提交 IRS 并交付税表与摘要。', 2)
  RETURNING id INTO usec_review;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku3_id, usec_review, 'task', 'firm', '最终审阅与 1040 报税提交', '完成 1040、Schedule A 及所有附表的最终审阅；与您确认退税/补税金额及关键数字后，通过 e-file 提交 IRS，并交付签字版税表与报税摘要供您留存。', 1);

  -- ===================== SKU4: USA 1120-S - S-Corp Compliance =====================
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, NULL, 'phase', 'client', 'P1: 企业信息 (Entity Setup)', '提供公司 EIN 与 S 选举确认，用于 1120-S 身份与税务身份核对。', 1)
  RETURNING id INTO s1_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, s1_id, 'section', 'client', '注册资料 (Registration)', '联邦税号与 S 公司选举文件，用于确认实体身份与穿透征税资格。', 1)
  RETURNING id INTO ssec_reg;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, ssec_reg, 'task', 'client', 'EIN 确认函', '上传 IRS 签发的雇主识别号（EIN）确认函或 CP 575 等官方文件。用于 1120-S 表头及与 IRS 记录一致；若 EIN 曾变更需注明。', 1),
    (sku4_id, ssec_reg, 'task', 'client', 'S-Corp 选举确认书 (Form 2553)', '上传已获 IRS 接受的 S 公司选举表 Form 2553 的确认信或批复。用于确认公司当前为 S 公司身份、选举生效日及股东同意情况，支撑 1120-S 申报资格。', 2);
  -- P2
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, NULL, 'phase', 'client', 'P2: 账目审计 (Bookkeeping)', '提供收入、成本、差旅与餐费支持文件，用于 1120-S 收入与费用填报及审计依据。', 2)
  RETURNING id INTO s2_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, s2_id, 'section', 'client', '收入与成本 (Operations)', '销售收入与销货成本记录，用于 1120-S 毛收入与 COGS 填报。', 1)
  RETURNING id INTO ssec_ops;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, ssec_ops, 'task', 'client', '销售收入总额凭证', '提供本税务年度销售收入汇总及支持文件：发票、收款记录、1099 等。用于 1120-S 第 1 页 gross receipts 及与账载收入核对；若有多种收入类型请分类说明。', 1),
    (sku4_id, ssec_ops, 'task', 'client', '销货成本 (COGS) 记录', '提供销货成本明细与支持文件：采购发票、存货变动、直接人工与间接费用分配（如适用）。用于 1120-S 中 COGS 填报及毛利的计算；需与损益表一致。', 2);
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, s2_id, 'section', 'client', '差旅与交际 (Travel & Meals)', '差旅与商业餐费凭证，用于 1120-S 费用扣除（餐费按 50% 可抵扣规则）。', 2)
  RETURNING id INTO ssec_travel;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, ssec_travel, 'task', 'client', 'Vouchap 自动归集：差旅发票与商业餐费说明', '通过 Vouchap 关联或上传：差旅机票、酒店、租车及商业餐费收据，并注明时间、地点、商业目的与参与人。系统可自动归集；餐费将按 50% 可抵扣处理。用于 1120-S 差旅与餐费扣除及审计支持。', 1);
  -- P3
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, NULL, 'phase', 'client', 'P3: 股东分配 (Shareholder Activity)', '股东提款、分红与股东贷款记录，用于 K-1 分配与 1120-S 资本与负债核对。', 3)
  RETURNING id INTO s3_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, s3_id, 'section', 'client', 'K-1 准备 (Distribution)', '股东层面的分配与贷款信息，用于编制每位股东的 Schedule K-1 及 1120-S 附表。', 1)
  RETURNING id INTO ssec_k1;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, ssec_k1, 'task', 'client', '股东提款/分红记录 (Distributions)', '提供本税务年度内每位股东的提款与分红记录：日期、金额、形式（现金/财产）及对应账户。用于 1120-S 中 distributions 与 Schedule K-1 的 Box 16（分配）填报，以及 basis 计算。', 1),
    (sku4_id, ssec_k1, 'task', 'client', '股东贷款明细 (Shareholder Loans)', '提供股东与公司之间贷款明细：股东贷款给公司的金额、还款、利息（如有）；公司贷款给股东的金额与还款。用于 K-1 上 debt basis、distributions 及 1120-S 资产负债的准确填报，避免 reclassification 问题。', 2);
  -- P4
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, NULL, 'phase', 'client', 'P4: 审阅与签发 (Final Review)', '事务所完成 1120-S 与 K-1 审阅，经确认后提交 IRS 并交付税表与 K-1。', 4)
  RETURNING id INTO s4_id;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, s4_id, 'section', 'firm', '最终审阅', '核对 1120-S 与各股东 K-1 数据，经确认后提交 IRS 并交付 1120-S 与 K-1。', 1)
  RETURNING id INTO ssec_final;
  INSERT INTO firm.sku_items (sku_id, parent_id, item_kind, type, title, description, sort_order) VALUES
    (sku4_id, ssec_final, 'task', 'firm', '最终审阅与 1120-S 报税提交', '完成 1120-S 及所有股东 Schedule K-1 的最终审阅；与您确认应税收入、应缴税及每位股东 K-1 关键数字后，提交 IRS 并交付签字版 1120-S 与 K-1 供股东申报个人税使用。', 1);

END $$;
