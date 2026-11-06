-- Client portal: one folder of files, checklist gaps, and urge/message thread per engagement.

CREATE TABLE IF NOT EXISTS public.engagement_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_files_order ON public.engagement_files(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('urge', 'message', 'reply')),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_order ON public.engagement_messages(order_id, created_at);

CREATE TABLE IF NOT EXISTS public.engagement_checklist_state (
  order_id UUID NOT NULL,
  todo_id UUID NOT NULL REFERENCES public.project_todos(id) ON DELETE CASCADE,
  satisfied BOOLEAN NOT NULL DEFAULT false,
  gap TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, todo_id)
);

ALTER TABLE public.engagement_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_checklist_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_engagement(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, provider
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM provider.orders o
    JOIN public.user_spaces us ON us.user_id = auth.uid()
      AND us.space_id IN (o.provider_space_id, o.consumer_space_id)
    WHERE o.id = p_order_id
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_engagement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_engagement(UUID) TO authenticated;

DROP POLICY IF EXISTS engagement_files_all ON public.engagement_files;
CREATE POLICY engagement_files_all ON public.engagement_files
  FOR ALL TO authenticated
  USING (public.can_access_engagement(order_id))
  WITH CHECK (public.can_access_engagement(order_id) AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS engagement_messages_select ON public.engagement_messages;
CREATE POLICY engagement_messages_select ON public.engagement_messages
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(order_id));

DROP POLICY IF EXISTS engagement_messages_insert ON public.engagement_messages;
CREATE POLICY engagement_messages_insert ON public.engagement_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(order_id) AND author_user_id = auth.uid());

DROP POLICY IF EXISTS engagement_checklist_all ON public.engagement_checklist_state;
CREATE POLICY engagement_checklist_all ON public.engagement_checklist_state
  FOR ALL TO authenticated
  USING (public.can_access_engagement(order_id))
  WITH CHECK (public.can_access_engagement(order_id));

GRANT SELECT, INSERT, DELETE ON public.engagement_files TO authenticated;
GRANT SELECT, INSERT ON public.engagement_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.engagement_checklist_state TO authenticated;
