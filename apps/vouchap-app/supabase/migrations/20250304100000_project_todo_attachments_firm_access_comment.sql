-- 明确：订单关联下的项目附件，client 与 firm 侧均具备查看/增删权限（RLS 已通过 user_spaces 的 client_space_id / firm_space_id 实现）
-- Firm 侧打开附件时，前端使用 getTaxFilingViewUrl 获取 signed URL 以支持私有 bucket 下的查看。

COMMENT ON TABLE public.project_todo_attachments IS
  '任务关联的附件；核心元数据 + extracted_data JSONB。授权：与 project_todos 一致，在该项目 client_space 或 firm_space 下的用户均可 SELECT/INSERT/UPDATE/DELETE，即 client 与 firm 侧均可查看、新增、删除附件。';
