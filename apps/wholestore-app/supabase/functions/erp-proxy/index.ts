// Wholestore ERP proxy: save/test/sync/push_order.
// Requires Authorization: Bearer <user JWT>. Client never holds ERP secrets.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErpAdapter, type ErpProviderKind } from '../_shared/erp/adapters.ts';

type Action = 'save_connection' | 'test_connection' | 'sync_products' | 'push_order';

type Body = {
  action?: Action;
  providerSpaceId?: string;
  erpProvider?: ErpProviderKind;
  config?: Record<string, unknown>;
  orderId?: string;
};

function corsHeadersForRequest(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function jsonResponse(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function providerDb(client: SupabaseClient) {
  return client.schema('provider');
}

async function requireAuthedClients(req: Request): Promise<
  | { userId: string; userClient: SupabaseClient; admin: SupabaseClient }
  | Response
> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse(req, { success: false, error: 'Server misconfigured.' }, 503);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user?.id) {
    return jsonResponse(req, { success: false, error: 'Unauthorized' }, 401);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { userId: user.id, userClient, admin };
}

async function assertSpaceMember(
  admin: SupabaseClient,
  userId: string,
  providerSpaceId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('user_spaces')
    .select('space_id')
    .eq('user_id', userId)
    .eq('space_id', providerSpaceId)
    .maybeSingle();
  if (error) return error.message;
  if (!data) return 'Not a member of this vendor space';
  const { data: space } = await admin.from('spaces').select('kind').eq('id', providerSpaceId).maybeSingle();
  if (!space || space.kind !== 'provider') return 'Space is not a vendor space';
  return null;
}

/** Vendor members, or dealer members of the order's consumer space, may push. */
async function assertCanPushOrder(
  admin: SupabaseClient,
  userId: string,
  providerSpaceId: string,
  orderId: string,
): Promise<string | null> {
  const vendorErr = await assertSpaceMember(admin, userId, providerSpaceId);
  if (!vendorErr) return null;

  const pdb = providerDb(admin);
  const { data: order, error } = await pdb
    .from('orders')
    .select('id, provider_space_id, consumer_space_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return error.message;
  if (!order || order.provider_space_id !== providerSpaceId) return 'Order not found';
  if (!order.consumer_space_id) return 'Not allowed to push this order';
  const { data: membership } = await admin
    .from('user_spaces')
    .select('space_id')
    .eq('user_id', userId)
    .eq('space_id', order.consumer_space_id)
    .maybeSingle();
  if (!membership) return 'Not allowed to push this order';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { success: false, error: 'Method not allowed' }, 405);
  }

  const auth = await requireAuthedClients(req);
  if (auth instanceof Response) return auth;
  const { userId, admin } = auth;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonResponse(req, { success: false, error: 'Invalid JSON' }, 400);
  }

  const action = body.action;
  const providerSpaceId = body.providerSpaceId?.trim();
  if (!action || !providerSpaceId) {
    return jsonResponse(req, { success: false, error: 'action and providerSpaceId are required' }, 400);
  }

  const pdb = providerDb(admin);

  try {
    if (action === 'push_order') {
      const orderId = body.orderId?.trim();
      if (!orderId) {
        return jsonResponse(req, { success: false, error: 'orderId is required' }, 400);
      }
      const pushAuthErr = await assertCanPushOrder(admin, userId, providerSpaceId, orderId);
      if (pushAuthErr) return jsonResponse(req, { success: false, error: pushAuthErr }, 403);
    } else {
      const memberErr = await assertSpaceMember(admin, userId, providerSpaceId);
      if (memberErr) return jsonResponse(req, { success: false, error: memberErr }, 403);
    }

    if (action === 'save_connection') {
      const erpProvider = (body.erpProvider || 'mock') as ErpProviderKind;
      if (erpProvider === 'finale') {
        return jsonResponse(
          req,
          {
            success: false,
            error: 'Finale is not available yet. Connect Mock ERP for development.',
          },
          400,
        );
      }
      if (erpProvider !== 'mock') {
        return jsonResponse(req, { success: false, error: 'Unsupported erpProvider' }, 400);
      }
      const adapter = createErpAdapter('mock');
      const test = await adapter.testConnection();
      const { error } = await pdb.from('erp_connections').upsert(
        {
          provider_space_id: providerSpaceId,
          erp_provider: 'mock',
          status: test.ok ? 'connected' : 'error',
          config: body.config ?? {},
          credentials_enc: null,
          last_error: test.ok ? null : test.message ?? 'Connection failed',
        },
        { onConflict: 'provider_space_id' },
      );
      if (error) throw error;
      return jsonResponse(req, { success: true, status: test.ok ? 'connected' : 'error', message: test.message });
    }

    if (action === 'test_connection') {
      const { data: conn } = await pdb
        .from('erp_connections')
        .select('*')
        .eq('provider_space_id', providerSpaceId)
        .maybeSingle();
      const erpProvider = (conn?.erp_provider || body.erpProvider || 'mock') as ErpProviderKind;
      const adapter = createErpAdapter(erpProvider);
      const test = await adapter.testConnection();
      await pdb.from('erp_connections').upsert(
        {
          provider_space_id: providerSpaceId,
          erp_provider: erpProvider,
          status: test.ok ? 'connected' : 'error',
          config: conn?.config ?? body.config ?? {},
          last_error: test.ok ? null : test.message ?? 'Connection failed',
        },
        { onConflict: 'provider_space_id' },
      );
      return jsonResponse(req, { success: test.ok, message: test.message, status: test.ok ? 'connected' : 'error' });
    }

    if (action === 'sync_products') {
      const { data: conn } = await pdb
        .from('erp_connections')
        .select('*')
        .eq('provider_space_id', providerSpaceId)
        .maybeSingle();
      if (!conn || conn.status !== 'connected') {
        return jsonResponse(req, { success: false, error: 'Connect an ERP before syncing' }, 400);
      }
      const adapter = createErpAdapter(conn.erp_provider as ErpProviderKind);
      const products = await adapter.listProducts();
      const now = new Date().toISOString();
      let upserted = 0;

      for (const p of products) {
        const { data: existing } = await pdb
          .from('skus')
          .select('id, name, description, image_url')
          .eq('provider_space_id', providerSpaceId)
          .eq('sku_code', p.code)
          .maybeSingle();

        if (existing) {
          const { error } = await pdb
            .from('skus')
            .update({
              external_product_id: p.externalProductId,
              external_source: conn.erp_provider,
              qty_on_hand: p.qtyOnHand,
              synced_at: now,
              // Keep vendor-edited name/description/image unless empty
              name: existing.name?.trim() ? existing.name : p.name,
              description: existing.description ?? p.description,
              image_url: existing.image_url ?? p.imageUrl,
            })
            .eq('id', existing.id);
          if (error) throw error;
          upserted += 1;
        } else {
          const { error } = await pdb.from('skus').insert({
            provider_space_id: providerSpaceId,
            name: p.name,
            description: p.description,
            image_url: p.imageUrl,
            is_published: false,
            sku_code: p.code,
            external_product_id: p.externalProductId,
            external_source: conn.erp_provider,
            qty_on_hand: p.qtyOnHand,
            synced_at: now,
          });
          if (error) throw error;
          upserted += 1;
        }
      }

      // Ensure default price list exists
      let { data: defaultList } = await pdb
        .from('price_lists')
        .select('id')
        .eq('provider_space_id', providerSpaceId)
        .eq('is_default', true)
        .maybeSingle();
      if (!defaultList) {
        const { data: created, error: plErr } = await pdb
          .from('price_lists')
          .insert({
            provider_space_id: providerSpaceId,
            name: 'Default',
            currency: 'USD',
            is_default: true,
          })
          .select('id')
          .single();
        if (plErr) throw plErr;
        defaultList = created;
      }

      const listId = defaultList!.id as string;
      const { data: skus } = await pdb
        .from('skus')
        .select('id, sku_code')
        .eq('provider_space_id', providerSpaceId)
        .not('sku_code', 'is', null);

      const hintByCode = new Map(products.map((p) => [p.code, p.listPriceHint]));
      for (const sku of skus ?? []) {
        const code = sku.sku_code as string;
        const hint = hintByCode.get(code);
        if (hint == null) continue;
        const { data: item } = await pdb
          .from('price_list_items')
          .select('id')
          .eq('price_list_id', listId)
          .eq('sku_id', sku.id)
          .maybeSingle();
        if (item) continue; // do not overwrite manual prices
        const { error: itemErr } = await pdb.from('price_list_items').insert({
          price_list_id: listId,
          sku_id: sku.id,
          unit_price: hint,
          moq: 1,
        });
        if (itemErr) throw itemErr;
      }

      await pdb
        .from('erp_connections')
        .update({ last_sync_at: now, last_error: null, status: 'connected' })
        .eq('provider_space_id', providerSpaceId);

      return jsonResponse(req, { success: true, upserted, productCount: products.length });
    }

    if (action === 'push_order') {
      const orderId = body.orderId!.trim();
      const { data: order, error: orderErr } = await pdb
        .from('orders')
        .select('id, provider_space_id, external_order_id, erp_push_status')
        .eq('id', orderId)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!order || order.provider_space_id !== providerSpaceId) {
        return jsonResponse(req, { success: false, error: 'Order not found' }, 404);
      }
      if (order.external_order_id) {
        return jsonResponse(req, {
          success: true,
          externalOrderId: order.external_order_id,
          erpPushStatus: 'pushed',
          alreadyPushed: true,
        });
      }

      const { data: conn } = await pdb
        .from('erp_connections')
        .select('*')
        .eq('provider_space_id', providerSpaceId)
        .maybeSingle();
      if (!conn || conn.status !== 'connected') {
        await pdb.from('orders').update({ erp_push_status: 'failed' }).eq('id', orderId);
        return jsonResponse(req, { success: false, error: 'ERP is not connected' }, 400);
      }

      const { data: lines, error: linesErr } = await pdb
        .from('order_lines')
        .select('quantity, unit_price, sku_id')
        .eq('order_id', orderId);
      if (linesErr) throw linesErr;

      const skuIds = (lines ?? []).map((l) => l.sku_id as string);
      const { data: skuRows, error: skuErr } = await pdb
        .from('skus')
        .select('id, sku_code')
        .in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000']);
      if (skuErr) throw skuErr;
      const codeById = new Map((skuRows ?? []).map((s) => [s.id as string, s.sku_code as string | null]));

      const adapterLines: { skuCode: string; quantity: number; unitPrice: number }[] = [];
      for (const line of lines ?? []) {
        const code = codeById.get(line.sku_id as string);
        if (!code) {
          return jsonResponse(
            req,
            { success: false, error: 'Order line missing sku_code; sync ERP catalog first' },
            400,
          );
        }
        adapterLines.push({
          skuCode: code,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unit_price ?? 0),
        });
      }

      try {
        const adapter = createErpAdapter(conn.erp_provider as ErpProviderKind);
        const result = await adapter.createSalesOrder({
          idempotencyKey: orderId,
          lines: adapterLines,
        });
        const pushedAt = new Date().toISOString();
        const { error: updErr } = await pdb
          .from('orders')
          .update({
            external_order_id: result.externalOrderId,
            erp_push_status: 'pushed',
            erp_pushed_at: pushedAt,
          })
          .eq('id', orderId);
        if (updErr) throw updErr;
        return jsonResponse(req, {
          success: true,
          externalOrderId: result.externalOrderId,
          erpPushStatus: 'pushed',
          alreadyPushed: false,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'ERP push failed';
        await pdb.from('orders').update({ erp_push_status: 'failed' }).eq('id', orderId);
        return jsonResponse(req, { success: false, error: message }, 502);
      }
    }

    return jsonResponse(req, { success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error';
    return jsonResponse(req, { success: false, error: message }, 500);
  }
});
