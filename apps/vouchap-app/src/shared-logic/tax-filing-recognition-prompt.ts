/**
 * 报税模块：文件识别用提示词（北美税表/附件）。
 * - 从 todo 提交时：注入 Project + Todo 信息（国别、报税场景、phase/section/task），并省略无关场景。
 * - 从项目内通用入口（如 chat）提交时：仅注入 Project 信息（国别、报税场景）。
 */

export type TaxFilingJurisdiction = 'CANADA' | 'USA';
export type TaxFilingScenario = 'T1' | 'T2' | '1040' | '1120-S' | string;

export interface TaxFilingProjectContext {
  /** 国别，用于限定识别场景 */
  country: TaxFilingJurisdiction;
  /** 报税场景，如 T1 / T2 / 1040 / 1120-S */
  taxScenario: TaxFilingScenario;
  /**
   * 项目分类标签（辖区、场景、税年、自定义 tags），与列表 pills 一致；
   * 与 task 标题一起看，缩小候选项；不得以标签覆盖图像上的表单类型。
   */
  classificationLabels?: string[];
}

export interface TaxFilingTodoContext {
  /** 归类层级：phase（如 P1: 基础准入） */
  phase?: string;
  /** section（如 资料收集） */
  section?: string;
  /** task（具体任务项） */
  task?: string;
}

const BASE_SYSTEM_PROMPT = `# Role
Expert North American tax document analyst (CRA, Revenu Québec, IRS, SSA).

# Task
From the provided image, PDF, or extracted text: (1) identify the **exact** document / form type using visible titles and form codes, (2) extract structured fields, (3) if a task list is given, ensure association aligns with that type.

# Identification first (critical)
- Read headers, form numbers, and issuer lines before extracting boxes. Examples: “T4 Statement of Remuneration Paid”, “T4A Statement of Pension …”, “RL-1 Relevé 1”, “W-2 Wage and Tax Statement”, “Form 1099-INT”, “SSA-1099”.
- Distinguish close forms: T4 vs T4A vs T4A(OAS) vs T4PS vs T4E vs T2202; 1099-INT vs 1099-DIV vs 1099-NEC vs 1099-R; employment slips vs bank statements vs generic receipts.
- If “current task” context conflicts with the visible form, **trust the document** and set suggested_task_id to the correct task from the list (when a list is provided).
- doc_type must be a specific code when possible (e.g. CANADA_T4, CANADA_T4A, US_W2, US_1099_INT), not vague labels like “tax paper”.
- Build doc_type using the most specific visible identifier hierarchy:
  1) jurisdiction + exact form/slip code (required when visible),
  2) variant/family when visible (e.g., OAS, NEC, DIV),
  3) optional qualifier (summary/page/schedule) only when explicit on document.
- If exact form code is visible, never fall back to a generic category.

# General rules
1. Dates: YYYY-MM-DD.
2. Amounts: numeric floats; strip symbols and thousands separators.
3. Infer currency (CAD/USD) and tax year when visible.
4. Output ONLY valid JSON (no markdown fence).
5. Favor completeness over brevity inside extracted_data: include all high-signal identity clues useful for downstream task matching.

# Summary field (required — tuned for product UI lists)
- **Language: English only** (even if the document text is French or another language).
- **Lead with substance**: start with the **document kind** or **key label** (form name, slip type, merchant, report title). **Never** start with meta phrases such as: "This document is …", "This is a …", "The following is …", "Here is …", "Below is …", "Image shows …".
- **Shape**: prefer **one compact sentence**, at most two short sentences. Use a **subject-first** pattern when helpful: \`[What it is] for [party / patient / payer / employer], [critical date or tax year]\` (e.g. *Diagnostic imaging report for GAO, ZHIJIAN, exam dated 2025-12-22*; *T4 from Acme Corp, tax year 2024*).
- **No padding**: do not restate the same idea twice. Put extra identifiers (account #, case #) only if they help disambiguate; routine fields already captured in \`extracted_data\` need not be repeated verbatim in \`summary\` unless they are the main disambiguator.
- **Non-tax/supporting docs** (medical letters, imaging, ID scans, misc): same rules — name the artifact directly, then party/date in the same sentence.

# Output schema
{
  "doc_type": "STRING_IDENTIFIER",
  "doc_type_keywords": ["ARRAY_OF_FORM_AND_VARIANT_KEYWORDS_FOR_MATCHING"],
  "confidence_score": 0.00,
  "summary": "English, subject-first, no “This document…” phrasing — e.g. T4 from Employer Inc., 2024",
  "extracted_data": {
    "document_identity": {
      "form_title": "Visible full title",
      "form_code": "Exact visible code when present (e.g. T4A, 1099-INT, RL-1)",
      "issuer_or_agency": "CRA / IRS / employer / payer / institution",
      "variant_or_schedule": "OAS / NEC / Schedule K-1 / etc when visible",
      "page_or_part": "Page/Part/Schedule markers when visible"
    },
    "parties": {
      "recipient_or_taxpayer": "Name if visible",
      "payer_or_employer_or_institution": "Entity if visible"
    },
    "period": {
      "tax_year": "YYYY when visible",
      "statement_period": "date range when visible"
    },
    "key_amounts": {},
    "raw_identification_tokens": ["Short list of exact strings seen on the document used to decide doc_type"]
  },
  "metadata": {
    "currency": "CAD|USD",
    "tax_year": "YYYY",
    "issuer": "Entity or agency name",
    "is_legible": true
  },
  "suggested_task_id": "OPTIONAL — only if task list is provided: set when this document’s true type clearly matches a **different** task than the provisional “current classification”; value must be an id from that list exactly."
}
`;

const SCENARIO_CANADA_T1 = `
## SCENARIO: CANADA T1 (Personal Tax)
- **CANADA_T4**: Statement of Remuneration Paid — Boxes 14, 16, 18, 22, 24, 26; employer name; year.
- **CANADA_T4A**: Pension, lump-sums, other income — identify “T4A” in title; boxes vary (16, 18, 20, 22, 34, etc.).
- **CANADA_T4A_OAS**: Often titled T4A(OAS) — OAS/GIS style benefits.
- **CANADA_T4PS**: Profit-sharing; **CANADA_T4E**: Employment insurance / training benefits.
- **CANADA_T4FHSA**: First Home Savings Account slip.
- **CANADA_T5**: Investment income — boxes for interest, dividends, foreign income; issuer.
- **CANADA_T3**: Trust allocation slip; **CANADA_T5008**: Securities transactions statement.
- **CANADA_T2202**: Tuition — institution, program, amounts.
- **RRSP_CONTRIBUTION**: Contribution receipt — amount, first-60-days vs rest; issuer (bank/fund).
- **DONATION_RECEIPT**: Eligible amount, charity BN/registration, date.
- **CANADA_NOA**: Notice of Assessment — line items / balance if legible.
- **QUEBEC_RL1**: Relevé 1 — parallel to Québec provincial employment; do not call it T4.
`;

const SCENARIO_CANADA_T2 = `
## SCENARIO: CANADA T2 (Corporate Tax)
- **FINANCIAL_STATEMENT**: Balance sheet / income statement — revenue, net income, assets, liabilities, period-end.
- **T2_SCHEDULE_1**: Net income for tax purposes, addbacks, deductions.
- **GST_HST_SUMMARY**: Sales, GST/HST collected, ITCs, net tax.
- **CORP_MINUTES_OR_LEGAL**: Identify by title; extract entity name and date if showing.
- **T4_SUMMARY / payroll**: Payroll vs individual T4 slip — if employer summary, label clearly in doc_type or summary.
`;

const SCENARIO_USA_1040 = `
## SCENARIO: USA 1040 (Individual Tax)
- **US_W2**: Boxes 1–6 as legible; employer name, EIN.
- **US_1099_INT**: Payer, Box 1 interest, 4 withheld.
- **US_1099_DIV**: 1a ordinary, 1b qualified, payer.
- **US_1099_MISC / US_1099_NEC**: Box amounts per form revision; distinguish NEC (nonemployee comp) from MISC.
- **US_1099_R**: Retirement distributions — distinguish from W-2.
- **US_1099_G**: State/refund; **SSA_1099**: Social Security benefits.
- **US_1098**: Mortgage; **US_1098_T**: Tuition; **US_1098_E**: Student loan interest.
- **SCHEDULE_K1_1040**: K-1 from 1065/1120-S/1041 flowing to individual — note partnership vs S-corp in summary.
`;

const SCENARIO_USA_1120S = `
## SCENARIO: USA 1120-S (S-Corp)
- **SCHEDULE_K1_1120S**: Part III — ordinary business income, rental, credits, shareholder % if shown.
- **US_1120S_PAGE1**: Receipts, COGS, deductions, line 22 style totals where visible.
`;

const SCENARIO_EXPENSE = `
## COMMON: GENERAL EXPENSES
- **EXPENSE_RECEIPT**: Extract Vendor, Date, Total, Tax (GST/HST/Sales Tax), Subtotal. Suggest Category (e.g., Office, Travel).
`;

function scenariosForContext(project: TaxFilingProjectContext, todo?: TaxFilingTodoContext): string {
  const { country, taxScenario } = project;
  const scenarios: string[] = [];

  if (country === 'CANADA') {
    if (taxScenario === 'T1' || !todo) scenarios.push(SCENARIO_CANADA_T1);
    if (taxScenario === 'T2' || !todo) scenarios.push(SCENARIO_CANADA_T2);
  }
  if (country === 'USA') {
    if (taxScenario === '1040' || !todo) scenarios.push(SCENARIO_USA_1040);
    if (taxScenario === '1120-S' || !todo) scenarios.push(SCENARIO_USA_1120S);
  }
  // 若未指定或双国，则都包含
  if (country !== 'CANADA' && country !== 'USA') {
    scenarios.push(SCENARIO_CANADA_T1, SCENARIO_CANADA_T2, SCENARIO_USA_1040, SCENARIO_USA_1120S);
  }
  scenarios.push(SCENARIO_EXPENSE);

  return '\n# Specific Extraction Logic (Scenario-Based)\n' + scenarios.join('\n');
}

/** 项目 task 清单项（id + title），拼入提示词供 AI 关联时对应到正确 task */
export interface TaxFilingTaskListItem {
  id: string;
  title: string;
}

/**
 * 构建带上下文的报税文件识别提示词（供 AI 调用方使用）。
 * - 若提供 todoContext：注入 Project + Todo（phase/section/task），并只保留与 project 国别/场景相关的部分。
 * - 若提供 taskList：拼合项目完整 task 清单，要求 AI 返回数据关联时务必对应到对应 task，错位时通过 suggested_task_id 纠正。
 * - 若仅 projectContext：注入 Project（国别、报税场景），省略与项目无关的 scenario 细节可在此做精简。
 */
export function buildTaxFilingRecognitionPrompt(opts: {
  projectContext: TaxFilingProjectContext;
  todoContext?: TaxFilingTodoContext;
  /** 项目下全部 task 清单（id + title），拼入提示词以便 AI 关联到正确 task，避免多文件时错位 */
  taskList?: TaxFilingTaskListItem[];
  /** 用户随文件一起提交的说明，纳入提示词以辅助识别 */
  userInstructions?: string;
}): string {
  const { projectContext, todoContext, taskList, userInstructions } = opts;
  const scenarios = scenariosForContext(projectContext, todoContext);

  const cls = (projectContext.classificationLabels ?? []).map((s) => s.trim()).filter(Boolean);
  const classificationBullet =
    cls.length > 0
      ? `\n- Engagement classification (project tags; use with task titles to narrow likely document types, never override the visible form): ${cls.join('; ')}`
      : '';

  let contextBlock = `
# Current context (use to focus extraction)
- Jurisdiction: ${projectContext.country}
- Tax scenario: ${projectContext.taxScenario}${classificationBullet}
`;
  if (todoContext) {
    contextBlock += `
- Provisional routing (from automation, may be wrong): Phase: ${todoContext.phase ?? '—'}, Section: ${todoContext.section ?? '—'}, Task: ${todoContext.task ?? '—'}
- Do **not** force the document to match this task if the visible form type disagrees. ${taskList && taskList.length > 0 ? 'Use suggested_task_id to correct.' : 'Still set doc_type from the actual form.'}
- Extract fields for the document’s true type per scenarios below; ignore the provisional task if it would bias field choice.
`;
  } else {
    contextBlock += `
- No specific task classification; extract according to the scenarios that match the jurisdiction and tax scenario above.
`;
  }
  if (taskList && taskList.length > 0) {
    const scopeHint =
      cls.length > 0
        ? ` This engagement is labeled: ${cls.join('; ')}. Prefer tasks whose titles fit **both** that scope and the identified form.`
        : '';
    contextBlock += `
# Project task list (routing correction)
Valid tasks only. After you determine doc_type from the file:${scopeHint}
- If the task whose **title** best matches that doc_type is **not** the provisional task above, set "suggested_task_id" to that task’s id.
- Prefer titles that name the exact slip/form (e.g. T4A task for a T4A slip).
- If the provisional task already matches, omit "suggested_task_id".
Task list (ids verbatim):
${taskList.map((t) => `- id: "${t.id}", title: "${t.title}"`).join('\n')}
`;
  }
  if (userInstructions?.trim()) {
    contextBlock += `
# User instructions (consider when extracting)
${userInstructions.trim()}
`;
  }

  return BASE_SYSTEM_PROMPT + scenarios + contextBlock;
}

/** 无上下文的完整提示词（通用/后备），包含全部场景 */
export function getFullTaxFilingRecognitionPrompt(): string {
  return (
    BASE_SYSTEM_PROMPT +
    '\n# Specific Extraction Logic (Scenario-Based)\n' +
    SCENARIO_CANADA_T1 +
    SCENARIO_CANADA_T2 +
    SCENARIO_USA_1040 +
    SCENARIO_USA_1120S +
    SCENARIO_EXPENSE
  );
}
