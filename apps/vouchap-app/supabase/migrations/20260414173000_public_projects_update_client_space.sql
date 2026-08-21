-- Client-side project Info (tax season, classification, hero) calls updateProject on public.projects.
-- public_projects_insert already allows client_space members for confirmation; UPDATE was still
-- can_access_order(..., true) only, so pure clients got 0-row updates (toast still showed Saved).
-- Mirror the INSERT client path for UPDATE (USING + WITH CHECK).

SET search_path = public, firm;

DROP POLICY IF EXISTS public_projects_update ON public.projects;

CREATE POLICY public_projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (
    public.projects.order_id IS NOT NULL
    AND (
      firm.can_access_order(auth.uid(), public.projects.order_id, true)
      OR (
        public.projects.client_space_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.user_spaces us
          WHERE us.space_id = public.projects.client_space_id
            AND us.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1
          FROM firm.orders o
          WHERE o.id = public.projects.order_id
            AND o.client_space_id = public.projects.client_space_id
        )
      )
    )
  )
  WITH CHECK (
    public.projects.order_id IS NOT NULL
    AND (
      firm.can_access_order(auth.uid(), public.projects.order_id, true)
      OR (
        public.projects.client_space_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.user_spaces us
          WHERE us.space_id = public.projects.client_space_id
            AND us.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1
          FROM firm.orders o
          WHERE o.id = public.projects.order_id
            AND o.client_space_id = public.projects.client_space_id
        )
      )
    )
  );

COMMENT ON POLICY public_projects_update ON public.projects IS
  'UPDATE by firm writers (can_access_order write) OR by client_space members when the order belongs to that client space (same scope as public_projects_insert client path).';
