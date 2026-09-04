# PRD：Vouchap Project & Todos 模块（结构化云盘 + chat-to-log 归集）

## 一、目标与定位

### 1.1 项目（Project）的定位

- **Project = 业务包（Engagement Package）**
  - 每个 Project 对应一笔订单/一次服务周期（如某年度报税、某次专项服务）。
  - Project 本身不追求复杂项目管理能力，作为**带结构和状态的容器**：
    - 绑定一个客户空间（client space）和一个 SKU 模板；
    - 承载一棵 WBS 树（todos）；
    - 汇总该 Engagement 的文档、进度与状态。

- **SKU = Project 模板**
  - `firm.skus` / `firm.sku_items` 定义「这个服务包默认需要哪些材料、步骤」。
  - 订单确认后，按 SKU 模板一次性拷贝为 Project 的任务树（`project_todos`）。

### 1.2 Todos 的统一认知：结构化云盘

- 系统中 todos（Firm / Client 侧）**本质都是「需要提交或生成的文件/资料槽位」**：
  - 每个 todo = 一个**结构化文件夹/文件位**：
    - 有语义（如「2024 纳税申报表 PDF」「银行流水明细 Excel」）；
    - 有状态（待提交 / 已提交待审 / 已确认）；
    - 有实际的文件或结构化记录挂载其下。
- **Project = 包**，**Todos = 包内的有序、分层「文件槽位树」**；**chat-to-log / 票据识别 / 文件解析 = 自动把散文件归集到对应槽位并生成结构化记录**。

### 1.3 后续关键方向：chat-to-log 驱动的自动归集

- 用户通过 **chat-to-log** 自由上传文件或描述：
  - AI：解析文件内容（票据、对账单、合同等）→ 识别属于哪个 Project → 识别属于哪个 Todo 槽位 → 生成结构化记录并挂到对应 todo 下。
- 本轮设计需**为 AI 归集预留钩子**：
  - todo 具备可匹配的元信息（类型、文案、标签、预期文件类型等）；
  - Project / Client / 空间等上下文可检索；
  - chat-to-log pipeline 可据此做匹配与打分。

---

## 二、数据模型设计

### 2.1 核心表（public schema，主权归属 client）

- `firm.orders`：业务订单，与 Client Space、SKU 绑定（仍属 firm schema）。
- **`public.projects`**：与 orders 一一对应，执行包；**主权归属 client**。字段含：
  - `id`, `firm_space_id`, `client_space_id`, `order_id`（用于授权与直接按 firm/client 查询）
  - `name`, `description`, `image_url`, `status`, `start_at`, `end_at`, `created_at`, `updated_at`
- `firm.skus` / `firm.sku_items`：SKU 及模板 WBS 树（phase/section/task）。
- **`public.project_todos`**：项目下任务/资料槽位（**主权归属 client**）。字段含：
  - `id`, `project_id`（关联 public.projects）, `parent_id`（树形）, `type`, `title`, `description`, `status`, `sort_order`, `created_at`, `updated_at`

### 2.2 设计说明

| 表 | 说明 |
|----|------|
| **public.projects** | `firm_space_id`、`client_space_id` 用于 RLS 及按空间直接查询；`order_id` 保持与 firm.orders 一一对应。 |
| **public.project_todos** | 以 `project_id` 关联 projects，树形靠 `parent_id` 自引用。 |

### 2.3 文件与 todo 关联（后续）

- 文件/凭证/账目记录统一增加 `project_id` / `order_id`、`todo_id`，便于 chat-to-log 挂载与展示。

---

## 三、后端接口与分层

### 3.1 Project 相关 API（`shared-logic/firm.ts`）

| 接口 | 说明 |
|------|------|
| `getFirmProjects(firmSpaceId, filters?)` | Firm 空间项目列表（客户、状态、时间等筛选） |
| `getProjectDetail(projectId \| orderId)` | 项目基础信息 + 简要统计（任务总数/完成数） |
| `updateProject(projectId, payload)` | 更新 name/description/status/start_at/end_at |

### 3.2 Project Todos（WBS 树）API

| 接口 | 说明 |
|------|------|
| `getProjectTodosTree(orderId \| projectId)` | 返回树形结构（id, parentId, type, title, description, status, sortOrder, children） |
| `createProjectTodo(params)` | 新增任务/槽位（orderId, parentId, type, title, description, sortOrder） |
| `updateProjectTodo(todoId, payload)` | 更新 title, description, status, sortOrder, parentId |
| `deleteProjectTodo(todoId)` | 删除（Phase 1 可仅允许叶子节点） |

### 3.3 从 SKU 实例化 Project

- **confirmOrderAndCreateProjectTodos(orderId)**：
  - 复制 `sku_items` 时一并写入 **parent_id**、**sort_order**，保留 WBS 树；
  - 仅复制 `item_kind = 'task'` 的项时，parent_id 指向「父任务」的新 id（按深度优先插入并维护 oldId→newId 映射）。

---

## 四、前端架构与页面

### 4.1 Firm 项目列表 / 工作台

- 路由：`/firm/projects` 或沿用 engagements 提升为 Projects 视角。
- 列表：项目名、客户、SKU、状态、任务完成度、起止时间；筛选（状态、客户、时间）；行点击进入 Project 详情。

### 4.2 Project 详情页（`/firm/engagement/[id]`）

- **顶部**：封面、名称、说明、客户、状态、起止时间、关联 SKU；轻量编辑入口。
- **Tabs**  
  - **Checklist · WBS**：树形列表，来自 `getProjectTodosTree`；展开/折叠、勾选完成、新增/编辑/删除（叶子）。  
  - **Board**（可选 Phase 1.5）：按状态分列，拖拽更新 status。
- **统计**：X / Y tasks done、进度条；可区分 client/firm 完成度。

### 4.3 SKU 详情页（模板视图）

- `/firm/sku/[skuId]`：SKU 信息 + 模板 WBS 树（只读）。后续可加「编辑模板 WBS」入口。

---

## 五、为 chat-to-log / AI 归集预留

- **Todo 元信息**：title/description 语义化；可选 `expected_file_kind`、`tags[]` 便于匹配。
- **上下文**：通过 API 可获取 Project 下 todo 树及元信息，供 chat-to-log 做「文件 → todo」匹配并写入 `todo_id`。
- **归集展示**：每个 todo 节点下展示已关联文件数/代表性文件名（后续）。

---

## 六、开发阶段

| 阶段 | 内容 |
|------|------|
| **Phase 1** | DB：project_todos.parent_id、projects.status/start_at/end_at；实例化时复制 parent_id；后端 getFirmProjects、getProjectDetail、getProjectTodosTree + CRUD；前端 engagement 详情：信息区 + WBS 树 Tab。 |
| **Phase 1.5** | 简单看板视图；项目列表筛选/排序增强。 |
| **Phase 2+** | chat-to-log 接入 project/todo 匹配；文件/凭证模型增加 project_id、todo_id；甘特、脑图、字段中心等按需引入。 |

---

*文档审定后，按 Phase 1 → 1.5 → 2 依次开发实现。*
