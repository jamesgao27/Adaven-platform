// 小票状态
export type ReceiptStatus = 'pending' | 'processing' | 'confirmed' | 'needs_retake' | 'duplicate';

// 收支范围：支出 / 收入，分类与用途可分别维护
export type ExpenseIncomeScope = 'expense' | 'income';

// 商品属性（主数据表 attributions）
export interface Attribution {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  isDefault: boolean;
  /** 当前 space 下作为行项目 attribution 被引用的次数（DB usage_count） */
  usageCount?: number;
  /** 用于支出 expense 或收入 income，分别维护、分别提交模型 */
  scope?: ExpenseIncomeScope;
  createdAt?: string;
  updatedAt?: string;
}

// 消费分类
export interface Category {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  isDefault: boolean;
  /** 当前 space 下作为行项目 category 被引用的次数（DB usage_count） */
  usageCount?: number;
  /** 用于支出 expense 或收入 income，分别维护、分别提交模型 */
  scope?: ExpenseIncomeScope;
  createdAt?: string;
  updatedAt?: string;
}

// 账户（收付款共用，原 PaymentAccount）
export interface Account {
  id: string;
  spaceId: string;
  name: string;
  isAiRecognized: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// 统一关联方（原供应商+客户）：支出 Payee / 收入 Payer / 入库 Sender / 出库 Receiver
export interface Entity {
  id: string;
  spaceId: string;
  name: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  isAiRecognized: boolean;
  mergedIntoId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** @deprecated 已由 Entity 替代，仅保留兼容 */
export interface Supplier {
  id: string;
  spaceId: string;
  name: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  isAiRecognized: boolean;
  isCustomer?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** @deprecated 已由 Entity 替代，仅保留兼容 */
export interface Customer {
  id: string;
  spaceId: string;
  name: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  isAiRecognized: boolean;
  isSupplier?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// 小票商品项
export interface ReceiptItem {
  id?: string;
  name: string;
  /** Human-friendly alias inferred from OCR/AI when original line text is cryptic SKU/abbreviation. */
  itemAlias?: string;
  categoryId: string;
  category?: Category; // 关联的分类对象
  /** 对应 DB receipt_items.attribution_id → attributions.id */
  attributionId: string | null;
  attribution?: Attribution | null;
  price: number;
  isAsset: boolean;
  confidence?: number; // AI识别置信度
}

/** Web 端支出「按明细行」扁平列表（receipt_items + 小票 Payee / 交易时间等） */
export interface ReceiptLineItemListRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  categoryId: string;
  attributionId: string | null;
  category?: Category;
  attribution?: Attribution | null;
  isAsset: boolean;
  receiptId: string;
  payeeName: string;
  receiptDate: string;
}

// 提交方式类型：camera=实时拍摄 image=上传图片 document=上传文档
export type InputType = 'camera' | 'image' | 'text' | 'audio' | 'document';

/** One printed sales-tax component at receipt level (receipts.tax_breakdown jsonb). */
export interface ReceiptTaxBreakdownEntry {
  /**
   * crm.tax_kind_registry.id — distinguishes same printed code across jurisdictions
   * (e.g. BC PST vs SK PST). Filled on save via resolveTaxBreakdownTaxKindIds; DB json key `tax_kind_id`.
   */
  taxKindId?: string | null;
  /** Optional: crm.tax_rate_standard.id for the dated rate row used when resolving. */
  crmTaxRateStandardId?: string | null;
  /** Stable key for display / legacy aggregation (e.g. GST, HST, PST, OTHER). */
  code: string;
  /** Human-readable label from the receipt or model. */
  label: string;
  /** Parsed rate text from OCR; omitted when persisting (rates come from CRM). */
  rateLabel?: string | null;
  amount: number;
  source?: string | null;
}

// 小票数据（支出单：对方为 Payee 收款方）
export interface Receipt {
  id?: string;
  spaceId: string;
  supplierName: string; // 展示用，与 entity?.name 同步
  storeName?: string;
  entityId?: string | null; // 关联方 entities 表（支出单：Payee）
  entity?: Entity | null;
  totalAmount: number;
  date: string;
  accountId?: string;
  account?: Account; // 关联的账户对象（付款）
  status: ReceiptStatus;
  imageUrl?: string;
  inputType?: InputType; // 提交方式：camera/image/text/audio/document
  items: ReceiptItem[];
  createdAt?: string;
  updatedAt?: string;
  processedBy?: string;
  confidence?: number; // 整体识别置信度
  currency?: string; // 币种，如：CNY、USD
  /** From recognition: currency visibly printed on ticket — when false, do not use currency for tax jurisdiction. */
  currencyPrintedOnReceipt?: boolean;
  tax?: number; // 税费
  /** Itemized sales tax lines when present (flexible codes per receipt). */
  taxBreakdown?: ReceiptTaxBreakdownEntry[] | null;
  createdBy?: string; // 提交者用户ID
  createdByUser?: User; // 提交者用户信息
  /** 识别失败并进入 needs_retake 的累计次数；成功识别后归零 */
  recognitionFailCount?: number;
  /**
   * English notice when recognition did not run or failed (workspace limits vs model API).
   * Persisted as receipts.recognition_notice.
   */
  recognitionNotice?: string | null;
}

// 用户数据
export interface User {
  id: string;
  email: string;
  name?: string; // 用户自定义名字
  spaceId: string | null; // 保留向后兼容，但优先使用 currentSpaceId（可能为 null）
  currentSpaceId?: string; // 当前活动的空间ID（可能为 undefined）
  /** 用户自定义 Logo（Supabase Storage 的 public URL） */
  logoUrl?: string | null;
  createdAt?: string;
}

// 用户-空间关联
export interface UserSpace {
  id: string;
  userId: string;
  spaceId: string;
  /** 是否为该空间 admin（仅 space admin 可更换客户负责人等） */
  isAdmin?: boolean;
  space?: Space; // 关联的空间信息
  createdAt?: string;
}

// Kernel kinds: consumer = Client UI, provider = Firm UI
export type SpaceKind = 'consumer' | 'provider';

/** Firm 审核状态：pending 待审核，approved 已开通 */
export type FirmStatus = 'pending' | 'approved';

// 空间账户
export interface Space {
  id: string;
  name: string;
  address?: string;
  /** 用户自定义空间 Logo（Supabase Storage 的 public URL） */
  logoUrl?: string | null;
  /** Kernel kind; default consumer (Client) */
  kind?: SpaceKind;
  /** Only when kind=consumer: household vs business */
  clientProfileType?: 'household' | 'business';
  /** Only when kind=provider: pending until approved */
  firmStatus?: FirmStatus | null;
  createdAt?: string;
  updatedAt?: string;
}

// 图片质量评价
export interface ImageQuality {
  clarity?: number; // 清晰度评分 0-1
  completeness?: number; // 完整度评分 0-1
  clarityComment?: string; // 清晰度评价文字
  completenessComment?: string; // 完整度评价文字
}

// 数据一致性检查
export interface DataConsistency {
  itemsSum?: number; // 明细金额总和
  itemsSumMatchesTotal?: boolean; // 明细总和是否与总金额一致
  missingItems?: boolean; // 是否可能有遗漏的商品项
  consistencyComment?: string; // 一致性评价文字
}

// ---------- AI 进销存 ----------

// 仓库
export interface Warehouse {
  id: string;
  spaceId: string;
  name: string;
  code?: string;
  address?: string;
  /** 合并指向：已并入的目标仓库 ID，NULL 表示未被合并 */
  mergedIntoId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 仓位（归属仓库）
export interface Location {
  id: string;
  warehouseId: string;
  name: string;
  code?: string;
  /** 合并指向：已并入的目标仓位 ID（同仓库内），NULL 表示未被合并 */
  mergedIntoId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 标准 SKU（商品主数据）
export interface Sku {
  id: string;
  spaceId: string;
  code?: string;
  name: string;
  unit: string;
  description?: string;
  isAiRecognized?: boolean;
  /** 合并指向：已并入的目标 SKU ID，NULL 表示未被合并 */
  mergedIntoId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 发票/入库/出库通用状态
export type VoucherStatus = 'pending' | 'processing' | 'confirmed' | 'needs_retake' | 'duplicate';

// 发票明细
export interface InvoiceItem {
  id?: string;
  name: string;
  /** Human-friendly alias inferred from OCR/AI when original line text is cryptic SKU/abbreviation. */
  itemAlias?: string;
  categoryId?: string | null;
  category?: Category;
  /** 对应 DB invoice_items.attribution_id → attributions.id */
  attributionId?: string | null;
  attribution?: Attribution | null;
  price: number;
  isAsset?: boolean;
  confidence?: number;
}

// 销售发票（资金流入，对方为 Payer 付款方）
export interface Invoice {
  id?: string;
  spaceId: string;
  customerName: string; // 展示用，与 entity?.name 同步
  entityId?: string | null; // 关联方 entities 表（收入单：Payer）
  entity?: Entity | null;
  totalAmount: number;
  currency?: string;
  tax?: number;
  date: string;
  accountId?: string | null;
  account?: Account;
  status: VoucherStatus;
  imageUrl?: string;
  inputType?: InputType;
  confidence?: number;
  processedBy?: string;
  createdBy?: string | null;
  createdByUser?: User;
  items: InvoiceItem[];
  createdAt?: string;
  updatedAt?: string;
  /** 识别失败并进入 needs_retake 的累计次数；成功识别后归零 */
  recognitionFailCount?: number;
}

// 入库/出库明细（含数量，可关联 SKU；名称/单位/规格通过 sku_id 关联 skus 获取，不冗余存储）
export interface InboundItem {
  id?: string;
  inboundId: string;
  skuId?: string | null;
  lineNo?: number;
  /** 展示用，来自 SKU.code */
  productCode?: string;
  /** 展示用，来自 SKU.name */
  productName?: string;
  /** 展示用，来自 SKU.description */
  specification?: string;
  quantity: number;
  qualifiedQuantity?: number;
  defectiveQuantity?: number;
  /** 展示用，来自 SKU.unit */
  unit?: string;
  unitPrice?: number;
  amount?: number;
  locationId?: string | null;
  confidence?: number;
  remarks?: string;
}

export interface OutboundItem {
  id?: string;
  outboundId: string;
  skuId?: string | null;
  lineNo?: number;
  /** 展示用，来自 SKU.name */
  productName?: string;
  /** 展示用，来自 SKU.description */
  specification?: string;
  quantity: number;
  /** 展示用，来自 SKU.unit */
  unit?: string;
  unitPrice?: number;
  amount?: number;
  supplyPrice?: number;
  tax?: number;
  confidence?: number;
  remarks?: string;
}

// 入库单（采购端，对方为 Sender 发货方）
export interface Inbound {
  id?: string;
  spaceId: string;
  documentNo?: string;
  entityId?: string | null; // 关联方 entities 表（入库：Sender）
  entity?: Entity | null;
  supplierName?: string; // 展示用，与 entity?.name 同步
  warehouseId?: string | null;
  locationId?: string | null;
  inboundType?: string;
  totalAmount?: number;
  totalAmountChinese?: string;
  currency?: string;
  date: string;
  status: VoucherStatus;
  handlerId?: string | null;
  handlerName?: string;
  warehouseKeeperId?: string | null;
  warehouseKeeperName?: string;
  accountantId?: string | null;
  accountantName?: string;
  remarks?: string;
  imageUrl?: string;
  inputType?: InputType;
  confidence?: number;
  createdBy?: string | null;
  items: InboundItem[];
  createdAt?: string;
  updatedAt?: string;
}

// 出库单（销售端，对方为 Receiver 收货方）
export interface Outbound {
  id?: string;
  spaceId: string;
  documentNo?: string;
  entityId?: string | null; // 关联方 entities 表（出库：Receiver）
  entity?: Entity | null;
  customerName?: string; // 展示用，与 entity?.name 同步
  warehouseId?: string | null;
  locationId?: string | null;
  totalAmount?: number;
  totalTax?: number;
  currency?: string;
  date: string;
  status: VoucherStatus;
  handlerId?: string | null;
  handlerName?: string;
  preparerId?: string | null;
  preparerName?: string;
  accountantId?: string | null;
  accountantName?: string;
  remarks?: string;
  imageUrl?: string;
  inputType?: InputType;
  confidence?: number;
  createdBy?: string | null;
  items: OutboundItem[];
  createdAt?: string;
  updatedAt?: string;
}

// 凭证记录类别：由列表页入口决定，不由大模型判断
export type VoucherLogType = 'receipt' | 'invoice' | 'inbound' | 'outbound' | 'tax-filing' | 'client';

// Gemini识别结果（使用分类名称，后续会匹配到分类ID）
export interface GeminiReceiptResult {
  supplierName: string;
  supplierInfo?: {
    taxNumber?: string; // 税号
    phone?: string; // 电话
    address?: string; // 地址
  };
  date: string;
  totalAmount: number;
  currency?: string; // 币种，如：CNY、USD
  /**
   * True only when currency was visibly printed on the receipt (code/symbol).
   * When false, currency may be model default only — do not use it for tax-jurisdiction matching.
   */
  currencyPrintedOnReceipt?: boolean;
  paymentAccountName?: string; // 支付账户，包含卡号尾号信息
  /** Last 4 digits of the payment card when printed (e.g. "1102"); improves matching to existing accounts. */
  paymentCardLastFour?: string;
  tax?: number; // 税费
  /** Optional itemized tax; same schema as Receipt.taxBreakdown after normalization. */
  taxBreakdown?: ReceiptTaxBreakdownEntry[] | null;
  items: Array<{
    name: string;
    /** Readable alias for cryptic merchant SKU/abbreviation line names. */
    itemAlias?: string;
    categoryName: string; // 分类名称，从[食品,外餐, 居家, 交通, 购物, 医疗, 教育]中选择
    price: number;
    attributionName?: string; // 映射到 attributions.name（模型若仍返回 purposeName，解析层会兼容）
    isAsset?: boolean; // 可选
    confidence?: number; // 可选
  }>;
  confidence?: number; // 可选，整体识别置信度 0-1
  imageQuality?: ImageQuality; // 图片质量评价
  dataConsistency?: DataConsistency; // 数据一致性检查
}

/** 出入库识别结果：表头 + 明细，与样例表格最完整字段对齐 */
export interface GeminiInboundOutboundResult {
  documentNo?: string;
  supplierName?: string;
  customerName?: string;
  warehouseName?: string;
  locationName?: string;
  date: string;
  inboundType?: string;
  totalAmount?: number;
  totalAmountChinese?: string;
  totalTax?: number;
  currency?: string;
  handlerName?: string;
  warehouseKeeperName?: string;
  preparerName?: string;
  accountantName?: string;
  remarks?: string;
  items: Array<{
    lineNo?: number;
    productCode?: string;
    productName: string;
    specification?: string;
    quantity: number;
    qualifiedQuantity?: number;
    defectiveQuantity?: number;
    unit: string;
    unitPrice?: number;
    amount?: number;
    supplyPrice?: number;
    tax?: number;
    skuCode?: string;
    remarks?: string;
  }>;
  confidence?: number;
}

// ---------- Firm 服务端 ----------

// 客户表状态（仅 active/inactive，展示状态由 displayStatus 自动计算）
export type FirmClientStatus = 'active' | 'inactive';

// CRM client display status (tax-year service, computed by logic; see docs/CRM-CLIENT-STATUS.md).
// Code and UI labels use English.
export type ClientDisplayStatus = 'new' | 'to_follow_up' | 'in_service' | 'to_revisit' | 'churned';

/** English labels for ClientDisplayStatus */
export const CLIENT_DISPLAY_STATUS_LABELS: Record<ClientDisplayStatus, string> = {
  new: 'New',
  to_follow_up: 'To Follow Up',
  in_service: 'In Service',
  to_revisit: 'Pre Season',
  churned: 'Churned',
};

// Firm 在服客户：已认领名称来自 space；pending 时 client_space_id 为空，名称/邮箱在 invitee_* 列
export interface FirmClient {
  id: string;
  firmSpaceId: string;
  /** Empty when pending (no client space yet). */
  clientSpaceId: string;
  /** Pending-only snapshot fields on firm.clients */
  inviteeEmail?: string | null;
  inviteeClientName?: string | null;
  inviteeContactName?: string | null;
  /** 自定义标签（文本数组）；仅在客户详情页编辑 */
  labels?: string[];
  /** Derived: primary order manager user id from visible engagements (not a DB column on firm.clients). */
  assignedUserId?: string | null;
  /** 最近跟进时间 */
  lastFollowUpAt?: string | null;
  /** Who created this firm.clients row (RPC actor; open-invite rows use token inviter). */
  creatorUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 客户跟进记录（含手动备注与订单等系统事件）
export type FirmClientFollowUpKind =
  | 'note'
  | 'order_created'
  | 'order_started'
  | 'order_completed'
  | 'order_cancelled';

export interface FirmClientFollowUp {
  id: string;
  firmSpaceId: string;
  clientSpaceId: string;
  /** Pending firm.clients id when follow-up is not tied to a client space yet */
  firmClientId?: string | null;
  content: string;
  kind: FirmClientFollowUpKind;
  referenceId?: string | null;
  createdAt: string;
  createdBy?: string | null;
}

// Firm 成员可管理的客户
export interface FirmMemberClient {
  id: string;
  firmSpaceId: string;
  userId: string;
  clientSpaceId: string;
  createdAt?: string;
}

// ---------- 订单 / SKU / 项目（见 docs/CRM-ORDERS-SKU-PROJECTS.md）----------
// SKU 关联 sku_items；选 SKU 创建订单时由 sku_items 复制创建 projects；projects 进展状态 = order.status

/** L2=phase, L3=section, L4=task；仅 task 会复制到 project_todos */
export type FirmSkuItemKind = 'phase' | 'section' | 'task';

// SKU 关联的项（模板），支持层级：phase(L2) -> section(L3) -> task(L4)；创建订单时仅复制 task 到 project_todos
export interface FirmSkuItem {
  id: string;
  skuId: string;
  /** 父节点 id；null 表示 Phase(L2) */
  parentId?: string | null;
  /** phase=阶段, section=分类, task=可执行任务；仅 task 复制到 project_todos */
  itemKind: FirmSkuItemKind;
  type: 'client' | 'firm';
  title: string;
  description?: string | null;
  sortOrder: number;
  /**
   * 可选前置节点 id（同 SKU 内的另一个 sku_item，通常是 section 或 phase 级别）。
   * 与 dependsOnIds[0] 一致；创建订单时映射到 project_todo.depends_on_id / depends_on_ids。
   */
  dependsOnId?: string | null;
  /** 多前置依赖（同 SKU 内）；空数组表示无前置 */
  dependsOnIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// 服务 SKU（商品），关联一组 sku_items；支持封面图与介绍（海报样式）
export interface FirmSku {
  id: string;
  firmSpaceId: string;
  name: string;
  description?: string;
  /** 封面图 URL（Storage 公共链接） */
  imageUrl?: string | null;
  /** 是否发布（客户可见） */
  isPublished?: boolean;
  /** 模板状态：与分类独立，draft=不可选用, private=内部可用, published=已发布 */
  templateStatus?: 'draft' | 'private' | 'published' | null;
  /** 关联的 sku_items 数量（统计字段） */
  itemsCount?: number;
  /** 报税辖区：CANADA | USA，用于识别提示词与 Project 对齐 */
  taxCountry?: string | null;
  /** 报税场景：如 T1, T2, 1040, 1120-S */
  taxScenario?: string | null;
  /** SKU 自定义标签（用于创建订单时复制到订单） */
  tags?: string[] | null;
  /** Firm display name when listing cross-firm published catalog */
  firmName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// 订单阶段（4 态）：onboarding / processing / completed / cancelled
export type FirmOrderStatus =
  | 'onboarding'   // 启动
  | 'processing'   // 进行中
  | 'completed'    // 已完成
  | 'cancelled';   // 取消

// 订单，一单对应一 SKU
export interface FirmOrder {
  id: string;
  firmSpaceId: string;
  /** 对于 pending orders，clientSpaceId 为空，仅由 firm 可见；迁移完成后绑定实际 client space。 */
  clientSpaceId: string | null;
  /** firm.clients id for this engagement (pending or claimed). */
  clientId?: string | null;
  skuId: string;
  status: FirmOrderStatus;
  /** 订单来源：firm_manual / client_marketplace（默认 firm_manual） */
  requestOrigin?: 'firm_manual' | 'client_marketplace' | string;
  /** Client 在 marketplace 同意协议后的时间（需 firm 侧再确认进入 processing） */
  clientConfirmedAt?: string | null;
  /** Firm 侧确认进入 processing 的时间 */
  firmConfirmedAt?: string | null;
  /** 报税辖区（与 project 双向同步） */
  taxCountry?: string | null;
  /** 报税场景（与 project 双向同步） */
  taxScenario?: string | null;
  /** Firm 侧自定义标签（创建时从 SKU 复制；不与 project.tags 同步） */
  tags?: string[] | null;
  /** 关联标签库 id（firm.order_labels） */
  taxCountryLabelId?: string | null;
  taxScenarioLabelId?: string | null;
  taxSeasonLabelId?: string | null;
  taxSeasonLabelName?: string | null;
  customLabelIds?: string[] | null;
  /** 税季年份（与 project 双向同步） */
  taxSeasonYear?: number | null;
  dueAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | null;
  /** Unique manager for the order (firm.order_managers.manager_user_id) */
  managerUserId?: string | null;
}

// 项目（订单下的清单项，由 sku_items 复制；进展状态以 order.status 为准）
export type FirmProjectType = 'client' | 'firm';

/** 待办/任务状态：To Submit, Reviewing, In Progress, Missing Info, Completed, Canceled */
export type ProjectTodoStatus =
  | 'to_submit'       // 待提交（初始责任 / 撤回后）
  | 'missing_info'    // 资料不完整 / 被退回
  | 'reviewing'       // 已提交，待 firm 审核
  | 'in_progress'     // 由 firm 接管处理中
  | 'completed'       // firm 已确认完成
  | 'canceled';        // 已终止，不参与父级状态传导

export interface FirmProject {
  id: string;
  orderId: string;
  type: FirmProjectType;
  /** 初始责任方（用于判断是否允许 RETURN 等流转；通常与创建时 responsible_side 一致） */
  initialResponsibleSide?: FirmProjectType;
  title: string;
  description?: string | null;
  status: ProjectTodoStatus;
  sortOrder: number;
  /** 父任务 id，WBS 树形结构（仅 project_todos 有） */
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 客户端「待办」展示：来自 project (type=client) + 订单 due_at，兼容原 FirmClientTodo 形态 */
export interface FirmClientTodo {
  id: string;
  orderId: string;
  firmSpaceId: string;
  clientSpaceId: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  status: ProjectTodoStatus;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

// 兼容：原模板现为 SKU，items 来自 sku_items
export type FirmTemplate = FirmSku & { items?: Array<{ title: string; description?: string }> };

/** 统一凭证识别结果：receipt 用 supplierName，invoice 用 customerName，其余字段共用 */
export interface GeminiVoucherResult {
  supplierName?: string;
  customerName?: string;
  supplierInfo?: {
    taxNumber?: string;
    phone?: string;
    address?: string;
  };
  date: string;
  totalAmount: number;
  currency?: string;
  paymentAccountName?: string;
  /** Last 4 digits when visible on deposit/card line (income). */
  paymentCardLastFour?: string;
  tax?: number;
  items: Array<{
    name: string;
    /** Readable alias for cryptic merchant SKU/abbreviation line names. */
    itemAlias?: string;
    categoryName: string;
    price: number;
    attributionName?: string;
    isAsset?: boolean;
    confidence?: number;
  }>;
  confidence?: number;
  imageQuality?: ImageQuality;
  dataConsistency?: DataConsistency;
}

/** Single extracted client from business card / list / text (Client Assistant). Email required. */
export interface ExtractedClient {
  email: string;
  contactName?: string;
  orgName?: string;
  address?: string;
}

/** Client recognition result: list of clients + summary for user confirmation. */
export interface ClientRecognitionResult {
  clients: ExtractedClient[];
  summary: {
    totalCount: number;
    completeCount: number;
    incompleteCount: number;
  };
}
