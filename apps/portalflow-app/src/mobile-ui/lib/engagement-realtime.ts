/**
 * Supabase Realtime helpers for tax filing / engagement screens.
 * List DataTable views on Web also subscribe via screen-level postgres_changes (debounced refresh).
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentSpace } from '@/lib/auth';

const DEFAULT_DEBOUNCE_MS = 300;

function debounced(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

/**
 * When orderId is known: subscribe to firm.orders + public.projects for that engagement.
 * When only projectId (order not resolved yet): subscribe to projects by primary key.
 */
export function subscribeFirmOrderAndLinkedProject(
  params: { orderId?: string | null; projectId?: string | null },
  onEvent: () => void,
  debounceMs = DEFAULT_DEBOUNCE_MS): () => void {
  const { orderId, projectId } = params;
  const fire = debounced(onEvent, debounceMs);
  const channels: ReturnType<typeof supabase.channel>[] = [];

  if (orderId) {
    const c1 = supabase
      .channel(`eng-rt-firm-order-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'provider', table: 'orders', filter: `id=eq.${orderId}` },
        fire
      )
      .subscribe();
    channels.push(c1);
    const c2 = supabase
      .channel(`eng-rt-proj-by-order-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `order_id=eq.${orderId}` },
        fire
      )
      .subscribe();
    channels.push(c2);
  } else if (projectId) {
    const c3 = supabase
      .channel(`eng-rt-proj-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        fire
      )
      .subscribe();
    channels.push(c3);
  }

  return () => {
    channels.forEach((c) => {
      void supabase.removeChannel(c);
    });
  };
}

export function useEngagementOrderProjectRealtime(
  orderId: string | null | undefined,
  projectId: string | null | undefined,
  onRefresh: () => void,
  enabled = true
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  useEffect(() => {
    if (!enabled || (!orderId && !projectId)) return;
    return subscribeFirmOrderAndLinkedProject(
      { orderId: orderId ? orderId : null, projectId: projectId ? projectId : null },
      () => onRefreshRef.current()
    );
  }, [orderId, projectId, enabled]);
}

/** Client tax filing home: orders + projects for the current client space. */
export function subscribeClientSpaceTaxFilingOrders(
  clientSpaceId: string,
  onEvent: () => void,
  debounceMs = DEFAULT_DEBOUNCE_MS
): () => void {
  const fire = debounced(onEvent, debounceMs);
  const c1 = supabase
    .channel(`tf-rt-orders-${clientSpaceId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'provider',
        table: 'orders',
        filter: `consumer_space_id=eq.${clientSpaceId}`,
      },
      fire
    )
    .subscribe();
  const c2 = supabase
    .channel(`tf-rt-projects-${clientSpaceId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projects',
        filter: `consumer_space_id=eq.${clientSpaceId}`,
      },
      fire
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(c1);
    void supabase.removeChannel(c2);
  };
}

export function useClientSpaceTaxFilingListRealtime(enabled: boolean, onRefresh: () => void): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      const space = await getCurrentSpace(true);
      if (cancelled || !space?.id) return;
      unsubscribe = subscribeClientSpaceTaxFilingOrders(space.id, () => onRefreshRef.current());
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled]);
}
