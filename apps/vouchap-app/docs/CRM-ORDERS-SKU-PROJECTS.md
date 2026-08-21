# CRM 订单 / 服务 SKU / 项目 表结构设计

## 业务逻辑

- **SKU 关联一组 items**：服务 SKU 下挂 **sku_items**（客户待办 + Firm 待办 模板）。
- **选 SKU 创建订单时**：由 **sku_items** 复制创建 **projects**（该订单下的清单项）。
- **projects 的进展状态 = order 的状态**：整单进展用 `order.status` 表示（pending / submitted / confirmed / cancelled）。

## 表结构

### 1. firm.skus（服务 SKU）

- **id**, **firm_space_id**, name, description
- created_at, updated_at  
- SKU 下挂一组 **sku_items**，无 project_id。

### 2. firm.sku_items（SKU 关联的一组项）

- **id**, **sku_id** (FK → skus.id), **type**：'client' | 'firm'
- title, description, sort_order
- created_at, updated_at  
- 创建订单时从此表复制到 **projects**。

### 3. firm.orders（订单）

- **id**, **firm_space_id**, **client_space_id**, **sku_id** (FK → skus.id)
- **status**：'pending' | 'submitted' | 'confirmed' | 'cancelled'（整单/项目进展状态）
- due_at, created_at, updated_at, created_by

### 4. firm.projects（订单下的清单项，由 sku_items 复制）

- **id**, **order_id** (FK → orders.id), **type**：'client' | 'firm'
- title, description, **status**：'pending' | 'submitted' | 'confirmed'
- sort_order, created_at, updated_at  
- 选 SKU 创建订单时，由 sku_items 复制生成；projects 的进展状态以 **order.status** 为准。

## 关系小结

- **sku_items** 属于 **skus**（SKU 关联一组 items）
- **orders** 引用 **skus**，一单对应一个 SKU
- **projects** 属于 **orders**，由 **sku_items** 复制创建；order.status = 项目进展状态

## 客户状态 (displayStatus)

- 以 **orders** 为准：订单所属年度取 `due_at` 年份；「进行中」= 本年度存在 status 为 pending 或 submitted 的订单。

## 迁移

- 新建 skus、sku_items、orders、projects 表及 RLS。
- 删除 firm.client_todos、firm.templates 及其 RLS。
