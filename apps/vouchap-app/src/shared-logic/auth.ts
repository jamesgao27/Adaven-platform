import { supabase } from './supabase';
import { Space, UserSpace } from '@/types';
import {
  getCurrentUser,
  getCurrentSpace as getPlatformCurrentSpace,
  getUserSpaces as getPlatformUserSpaces,
  setCurrentSpace,
  signUp,
  signIn,
  signOut,
  isAuthenticated,
  resetPassword,
  updatePassword,
  runOnSpaceCreated,
} from '@adaven/platform-core';
import type { PlatformSpace } from '@adaven/platform-core';
import './vouchap-space-bootstrap';

export {
  getCurrentUser,
  setCurrentSpace,
  signUp,
  signIn,
  signOut,
  isAuthenticated,
  resetPassword,
  updatePassword,
  signInWithOAuth,
  getEnabledAuthProviders,
  configurePlatformAuth,
} from '@adaven/platform-core';

async function enrichFirmStatus(space: PlatformSpace | null): Promise<Space | null> {
  if (!space) return null;
  let firmStatus: 'pending' | 'approved' | undefined;
  if (space.kind === 'firm') {
    const { data: firmRow } = await supabase
      .schema('firm')
      .from('firms')
      .select('status')
      .eq('space_id', space.id)
      .maybeSingle();
    firmStatus = (firmRow?.status as 'pending' | 'approved') ?? undefined;
  }
  return {
    ...(space as Space),
    kind: (space.kind as Space['kind']) || 'client',
    clientProfileType: (space.clientProfileType as Space['clientProfileType']) ?? 'household',
    firmStatus,
  };
}

export async function getCurrentSpace(forceRefresh: boolean = false): Promise<Space | null> {
  const space = await getPlatformCurrentSpace(forceRefresh);
  return enrichFirmStatus(space);
}

export async function getUserSpaces(): Promise<UserSpace[]> {
  const list = await getPlatformUserSpaces();
  const firmIds = list.filter((row) => row.space?.kind === 'firm').map((row) => row.spaceId);
  let firmStatusBySpaceId: Record<string, 'pending' | 'approved'> = {};
  if (firmIds.length > 0) {
    const { data: firmRows } = await supabase
      .schema('firm')
      .from('firms')
      .select('space_id, status')
      .in('space_id', firmIds);
    if (firmRows) {
      firmRows.forEach((r: { space_id: string; status: string }) => {
        firmStatusBySpaceId[r.space_id] = r.status as 'pending' | 'approved';
      });
    }
  }
  return list.map((row) => ({
    id: row.id,
    userId: row.userId,
    spaceId: row.spaceId,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
    space: row.space
      ? {
          ...(row.space as Space),
          kind: (row.space.kind as Space['kind']) || 'client',
          clientProfileType:
            (row.space.clientProfileType as Space['clientProfileType']) ?? 'household',
          firmStatus:
            row.space.kind === 'firm' ? firmStatusBySpaceId[row.spaceId] : undefined,
        }
      : undefined,
  }));
}

let createSpaceInFlight = false;

/** 创建空间选项：kind=firm 时需传 verificationAttachmentUrl（验证机构附件 URL） */
export type CreateSpaceOptions = {
  kind?: 'client' | 'firm';
  clientProfileType?: 'household' | 'business';
  verificationAttachmentUrl?: string;
};

/**
 * Platform core: spaces + membership + current space.
 * Product seeds (categories, Firm SKUs) run via registerOnSpaceCreated — see createSpace().
 */
export async function createSpaceCore(
  name: string,
  address?: string,
  options?: CreateSpaceOptions
): Promise<{ space: Space | null; error: Error | null }> {
  try {
    const kind = options?.kind ?? 'client';
    const clientProfileType = options?.clientProfileType ?? 'household';
    if (kind === 'firm') {
      const url = options?.verificationAttachmentUrl?.trim();
      if (!url) {
        return { space: null, error: new Error('Firm registration requires a verification document.') };
      }
    }

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return { space: null, error: new Error('Not authenticated') };
    }

    // 确保用户记录存在（如果不存在则创建）
    const user = await getCurrentUser();
    if (!user) {
      // 用户记录不存在，尝试创建
      const userNameFromMetadata = authUser.user_metadata?.name;
      const userName = userNameFromMetadata || authUser.email?.split('@')[0] || 'User';
      
      const { error: userInsertError } = await supabase
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email || '',
          name: userName,
          current_space_id: null,
        });
      
      if (userInsertError) {
        // 区分不同类型的错误
        const errorCode = String(userInsertError.code || '');
        const isRLSError = errorCode === '42501' || 
                          userInsertError.message?.includes('row-level security') ||
                          userInsertError.message?.includes('permission denied');
        
        if (isRLSError) {
          // RLS 策略错误，返回更准确的错误信息
          console.error('RLS error creating user record:', userInsertError);
          return { 
            space: null, 
            error: new Error(
              '无法创建用户记录：数据库权限错误。\n\n' +
              '这可能是 RLS 策略配置问题。请检查：\n' +
              '1. users 表的 INSERT RLS 策略是否正确\n' +
              '2. 用户是否已通过邮箱确认（如果启用了邮箱确认）\n\n' +
              `错误代码: ${errorCode}\n` +
              `错误信息: ${userInsertError.message}`
            ) 
          };
        } else {
          // 其他错误（如重复键等），尝试再次查询用户记录
          console.warn('User insert error (non-RLS):', userInsertError);
          // 可能是并发创建，尝试再次查询
          const retryUser = await getCurrentUser(true);
          if (!retryUser) {
            return { 
              space: null, 
              error: new Error(
                `无法创建用户记录：${userInsertError.message}\n\n` +
                `错误代码: ${errorCode}`
              ) 
            };
          }
          // 如果重试成功，继续执行
        }
      }
    }

    // 验证认证状态
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error('No active session when trying to create space');
      return { 
        space: null, 
        error: new Error('Not authenticated: Please sign in again') 
      };
    }
    
    // 解析 JWT token 检查 role（用于调试）
    let tokenRole = 'unknown';
    try {
      if (session.access_token) {
        const tokenParts = session.access_token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          tokenRole = payload.role || 'unknown';
        }
      }
    } catch (e) {
      console.warn('Failed to parse JWT token:', e);
    }
    
    console.log('Session info:', {
      userId: session.user.id,
      userEmail: session.user.email,
      accessToken: session.access_token ? 'Present' : 'Missing',
      tokenRole: tokenRole,
      expiresAt: session.expires_at,
      expiresIn: session.expires_at ? Math.floor((session.expires_at * 1000 - Date.now()) / 1000) : null,
    });

    // 创建家庭/空间（firm 状态与证明由 RPC 写入 firm.firms，spaces 仅存 kind）
    const insertData: {
      name: string;
      address?: string;
      kind?: 'client' | 'firm';
      client_profile_type?: 'household' | 'business';
    } = { name, kind };
    if (kind === 'client') {
      insertData.client_profile_type = clientProfileType;
    }
    if (address && address.trim()) {
      insertData.address = address.trim();
    }
    const verificationUrl = kind === 'firm' ? options!.verificationAttachmentUrl!.trim() : null;
    
    // 添加详细的调试信息
    console.log('Attempting to create space:', {
      name: insertData.name,
      address: insertData.address,
      kind: insertData.kind,
      userId: authUser.id,
      userEmail: authUser.email,
      hasSession: !!session,
    });
    
    // 确保 Supabase 客户端使用当前的 session
    // 如果 session 存在但客户端没有使用，尝试刷新
    if (session) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (setSessionError) {
        console.warn('Failed to set session:', setSessionError);
      }
    }
    
    // 再次验证 session（确保 token 有效）
    const { data: { session: verifySession }, error: verifyError } = await supabase.auth.getSession();
    if (!verifySession) {
      console.error('Session verification failed:', verifyError);
      return { 
        space: null, 
        error: new Error('Session expired or invalid. Please sign in again.') 
      };
    }
    
    
    // 使用 getUser() 确保获取最新的用户信息和 token（这会自动刷新 token）
    const { data: { user: currentUser }, error: getUserError } = await supabase.auth.getUser();
    if (getUserError || !currentUser) {
      console.error('Failed to get current user (token may be expired):', getUserError);
      return { 
        space: null, 
        error: new Error('Authentication token expired. Please sign in again.') 
      };
    }
    
    console.log('Current user verified:', {
      userId: currentUser.id,
      email: currentUser.email,
      matchesAuthUser: currentUser.id === authUser.id,
    });
    
    // 在插入前再次确认 session 和 token
    const { data: { session: finalSession } } = await supabase.auth.getSession();
    if (!finalSession) {
      console.error('Final session check failed - no session');
      return { 
        space: null, 
        error: new Error('Session lost. Please sign in again.') 
      };
    }
    
    console.log('Final session check before insert:', {
      hasAccessToken: !!finalSession.access_token,
      tokenLength: finalSession.access_token?.length || 0,
      expiresAt: finalSession.expires_at,
      expiresIn: finalSession.expires_at ? Math.floor((finalSession.expires_at * 1000 - Date.now()) / 1000) : null,
    });
    
    // 优先使用 RPC：服务端以 postgres 插入 spaces/user_spaces，并在 firm 时执行 apply_preset_skus_to_firm，与之前可成功创建 firm 的路径一致
    let spaceData = null;
    let spaceError = null;

    const { data: rpcSpaceId, error: rpcError } = await supabase.rpc('create_space_with_user', {
      p_space_name: insertData.name,
      p_space_address: insertData.address || null,
      p_user_id: currentUser.id,
      p_kind: insertData.kind ?? 'client',
      p_client_profile_type: kind === 'client' ? clientProfileType : 'household',
      p_firm_verification_url: verificationUrl ?? null,
    });

    if (!rpcError && rpcSpaceId) {
      // RPC 成功，查询创建的 space（firm 状态在 firm.firms，需单独取）
      const { data: fetchedSpace, error: fetchError } = await supabase
        .from('spaces')
        .select('*')
        .eq('id', rpcSpaceId)
        .single();
      
      if (!fetchError && fetchedSpace) {
        spaceData = fetchedSpace;
      } else {
        spaceError = fetchError;
      }
    } else {
      // RPC 失败或未返回 id，尝试直接插入兜底
      // 仅当 PostgreSQL 42883（函数不存在）时视为“函数未部署”，避免把 RPC 内 42501 等错误误判为函数不存在
      const isFunctionNotFound = rpcError?.code === '42883';
      if (rpcError) {
        console.warn('RPC create_space_with_user result:', { code: rpcError.code, message: rpcError.message, details: rpcError.details });
        if (rpcError.code === '42501') {
          // RPC 内已因 RLS 失败，直接插入多半也会失败；优先把 RPC 错误抛给用户并提示修 definer 策略
          spaceError = rpcError;
          spaceData = null;
          // 下面统一走 42501 的报错分支，不再尝试直接插入
        }
      }
      if (!spaceError && (isFunctionNotFound || !rpcError)) {
        if (isFunctionNotFound) console.log('RPC function not available (42883), trying direct insert...');
        else if (!rpcError) console.log('RPC returned no data, trying direct insert...');
      }

      if (!spaceError) {
      // 直接插入 spaces 表
      const insertResult = await supabase
        .from('spaces')
        .insert(insertData)
        .select()
        .single();
      
      spaceData = insertResult.data;
      spaceError = insertResult.error;
      
      // 如果直接插入成功，需要手动创建 user_spaces 关联和更新 current_space_id
      if (!spaceError && spaceData) {
        
        // 创建 user_spaces 关联
        const { error: associationError } = await supabase
          .from('user_spaces')
          .insert({
            user_id: currentUser.id,
            space_id: spaceData.id,
            is_admin: true,
          });
        
        if (associationError) {
          console.error('Failed to create user_spaces association:', associationError);
          // 如果关联失败，尝试删除刚创建的空间
          try {
            await supabase.from('spaces').delete().eq('id', spaceData.id);
            console.warn('Cleaned up space after association error');
          } catch (deleteError) {
            console.warn('Failed to cleanup space after association error:', deleteError);
          }
          spaceError = associationError;
          spaceData = null;
        } else {
          // 更新用户的 current_space_id
          const { error: updateError } = await supabase
            .from('users')
            .update({ current_space_id: spaceData.id })
            .eq('id', currentUser.id);
          
          if (updateError) {
            console.warn('Failed to update current_space_id:', updateError);
            // 不阻止流程，用户可以稍后手动选择
          }
        }
      }
      } // end if (!spaceError) direct-insert 兜底
    }
    
    // 如果直接插入失败，记录详细的请求信息
    if (spaceError) {
    }

    if (spaceError) {
      // 完整错误对象（含 code/message/details/hint 等）打到控制台，便于排查
      const fullErrorPayload = {
        code: spaceError.code,
        message: spaceError.message,
        details: spaceError.details,
        hint: spaceError.hint,
        userId: authUser.id,
        userEmail: authUser.email,
      };
      console.error('Space creation error details:', fullErrorPayload);
      try {
        console.error('Space creation full error (JSON):', JSON.stringify(spaceError, null, 2));
      } catch (_) {
        console.error('Space creation full error (fallback):', String(spaceError));
      }

      // 如果是 RLS 错误，提供详细的错误信息和修复建议
      if (spaceError.code === '42501' || spaceError.message?.includes('row-level security') || spaceError.message?.includes('permission denied')) {
        // 解析 JWT token 检查 role
        let tokenRole = 'unknown';
        try {
          if (session?.access_token) {
            const tokenParts = session.access_token.split('.');
            if (tokenParts.length === 3) {
              const payload = JSON.parse(atob(tokenParts[1]));
              tokenRole = payload.role || 'unknown';
            }
          }
        } catch (e) {
          console.error('Failed to parse JWT token:', e);
        }
        const extraLines: string[] = [];
        extraLines.push(`当前 JWT role: ${tokenRole}`);
        if (spaceError.details) extraLines.push(`details: ${spaceError.details}`);
        if (spaceError.hint) extraLines.push(`hint: ${spaceError.hint}`);
        const isFirm = insertData.kind === 'firm';
        return {
          space: null,
          error: new Error(
            `无法创建空间：数据库安全策略错误 (错误代码: ${spaceError.code})。` +
            `\n\n请在 Supabase SQL Editor 中执行 fix-spaces-insert.sql（含 spaces、user_spaces、firm.skus/firm.sku_items）。` +
            (isFirm ? `\n若先出现 RPC 400 再报此错误，说明 create_space_with_user 内被 RLS 拦截，请确认该函数拥有者为 postgres 且已执行上述脚本。` : '') +
            `\n\n错误详情: ${spaceError.message}` +
            (extraLines.length ? '\n' + extraLines.join('\n') : '') +
            `\n\n完整错误见控制台 "RPC create_space_with_user result" 或 "Space creation error details"。`
          ),
        };
      }
      
      // 其他错误也记录详细信息
      console.error('Other error when creating space:', spaceError);
      throw spaceError;
    }
    
    if (!spaceData) {
      return { space: null, error: new Error('Failed to create space') };
    }

    // 检查 user_spaces 关联是否已存在（RPC 函数可能已创建）
    // 注意：如果使用直接插入，关联已经在上面创建了
    const { data: existingAssociation } = await supabase
      .from('user_spaces')
      .select('id')
      .eq('user_id', authUser.id)
      .eq('space_id', spaceData.id)
      .maybeSingle();

    // 如果关联不存在（RPC 函数可能没有创建），创建关联
    if (!existingAssociation) {
      const { error: associationError } = await supabase
        .from('user_spaces')
        .insert({
          user_id: authUser.id,
          space_id: spaceData.id,
          is_admin: true,
        });

      if (associationError) {
        // 如果关联失败，尝试删除刚创建的空间
        // 注意：删除可能也会失败（RLS 错误），但不影响主要错误信息
        try {
          await supabase.from('spaces').delete().eq('id', spaceData.id);
          console.warn('Cleaned up space after association error');
        } catch (deleteError) {
          console.warn('Failed to cleanup space after association error:', deleteError);
        }
        
        // 返回更友好的错误信息
        return {
          space: null,
          error: new Error(
            `创建空间成功，但关联用户失败。错误代码: ${associationError.code || 'unknown'}\n` +
            `错误信息: ${associationError.message}\n\n` +
            `请检查 user_spaces 表的 INSERT RLS 策略是否正确。`
          ),
        };
      }
    }

    // 设置为当前家庭（RPC 函数可能已设置，但确保设置正确）
    // 如果直接插入时已经更新了，这里会再次更新（不会出错）
    const { error: setCurrentError } = await setCurrentSpace(spaceData.id);
    if (setCurrentError) {
      console.warn('Failed to set as current space:', setCurrentError);
      // 不阻止流程，用户可以稍后手动选择
    }

    const space: Space = {
      id: spaceData.id,
      name: spaceData.name,
      address: spaceData.address,
      kind: (spaceData.kind as 'client' | 'firm') || 'client',
      clientProfileType: (spaceData as any).client_profile_type ?? 'household',
      createdAt: spaceData.created_at,
      updatedAt: spaceData.updated_at,
    };

    return { space, error: null };
  } catch (error) {
    console.error('Error creating space:', error);
    return {
      space: null,
      error: error instanceof Error ? error : new Error('Failed to create space'),
    };
  }
}

export async function createSpace(
  name: string,
  address?: string,
  options?: CreateSpaceOptions
): Promise<{ space: Space | null; error: Error | null }> {
  if (createSpaceInFlight) {
    return {
      space: null,
      error: new Error('A space is already being created. Please wait a moment and try again.'),
    };
  }
  createSpaceInFlight = true;
  try {
    const result = await createSpaceCore(name, address, options);
    if (result.error || !result.space) {
      return result;
    }

    try {
      await runOnSpaceCreated({
        spaceId: result.space.id,
        name: result.space.name,
        kind: result.space.kind,
        clientProfileType: result.space.clientProfileType,
      });
    } catch (hookError) {
      console.warn('onSpaceCreated handler failed (space already created):', hookError);
    }

    let firmStatus: 'pending' | 'approved' | undefined;
    if (result.space.kind === 'firm') {
      const { data: firmRow } = await supabase
        .schema('firm')
        .from('firms')
        .select('status')
        .eq('space_id', result.space.id)
        .maybeSingle();
      firmStatus = (firmRow?.status as 'pending' | 'approved') ?? undefined;
    }

    return {
      space: { ...result.space, firmStatus },
      error: null,
    };
  } finally {
    createSpaceInFlight = false;
  }
}

