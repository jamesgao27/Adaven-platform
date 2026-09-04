# Supabase Storage 路径规范

后台四个 bucket：**receipts**、**chat-audio**、**marketplace**、**tax-filing**。

## 原则

- 每个 bucket 只做一类用途；路径**至多两层**（一层为 space_id 或类型前缀，第二层为 temp 或文件名）。
- 需要按 space 隔离的，用 `**{spaceId}/`** 作为第一层目录（无 spaceId 时用 `unknown`）。
- 图片扩展名与 MIME 用 `getImageExtAndMime(uri)`（jpg/png/gif/webp）；报税附件等支持文档时用 `getFileExtAndMime(uri, opts?)`，支持 jpg/png/gif/webp 与 pdf/doc/docx。

---

## 1. receipts

**用途**：支出/收入/入库/出库相关图片（小票、发票、入库单、出库单）。

- **临时文件**（四类：小票/发票临时、入库临时、出库临时）：统一放在 `**{spaceId}/temp/`** 下，文件名由调用方指定（可带前缀区分，如 `receipt_xxx`、`inbound_xxx`、`outbound_xxx`）。
- **正式文件**：放在 `**{spaceId}/`** 下，用**文件名前缀**区分类型。


| 类型       | 路径格式                                           | 说明    |
| -------- | ---------------------------------------------- | ----- |
| 小票/发票/入库/出库 临时 | `{spaceId}/temp/{fileName}.{ext}`              | 识别前上传；ext 可为 jpg/png/gif/webp 或 pdf/doc/docx（文档仅上传不识别） |
| 入库 临时    | `{spaceId}/temp/inbound_{tempFileName}.{ext}`  | 同上    |
| 出库 临时    | `{spaceId}/temp/outbound_{tempFileName}.{ext}` | 同上    |
| 小票 正式    | `{spaceId}/receipt_{receiptId}.{ext}`          | 确认后保存 |
| 发票 正式    | `{spaceId}/invoice_{invoiceId}.{ext}`          | 同上    |
| 入库 正式    | `{spaceId}/inbound_{inboundId}.{ext}`          | 同上    |
| 出库 正式    | `{spaceId}/outbound_{outboundId}.{ext}`        | 同上    |


---

## 2. chat-audio

**用途**：Chat to Log 语音消息。


| 类型  | 路径格式                              | 说明                                                       |
| --- | --------------------------------- | -------------------------------------------------------- |
| 语音  | `{spaceId}/audio_{timestamp}.m4a` | 按 space 隔离；暂无 spaceId 时用 `unknown/audio_{timestamp}.m4a` |

---

## 3. marketplace

**用途**：Firm SKU 封面等市场资源（全局，不按 space 分）。


| 类型     | 路径格式                | 说明   |
| ------ | ------------------- | ---- |
| SKU 封面 | `sku/{skuId}.{ext}` | 保持不变 |


---

## 4. tax-filing

**用途**：报税相关（项目封面 + 报税附件）。


| 类型   | 路径格式                                | 说明                                           |
| ---- | ----------------------------------- | -------------------------------------------- |
| 项目封面 | `{spaceId}/cover_{projectId}.{ext}` | 从 receipts 迁入，与报税项目一致；spaceId 为 client space |
| 报税附件 | `{spaceId}/{fileName}.{ext}`        | 如 `attach_xxx`；ext 可为 jpg/png/gif/webp 或 pdf/doc/docx |


---

## 实施摘要

- **receipts**：临时统一为 `{spaceId}/temp/...`；正式统一为 `{spaceId}/receipt_|invoice_|inbound_|outbound_` 前缀。
- **chat-audio**：可选后续改为 `{spaceId}/audio_{ts}.m4a`。
- **marketplace**：不变。
- **tax-filing**：项目封面上传改为 bucket **tax-filing**，路径 `{spaceId}/cover_{projectId}.{ext}`，接口增加 `spaceId` 参数；附件保持 `{spaceId}/{fileName}.{ext}`。

