import { getPlatformClient } from './client';
import { getCurrentUser, getCurrentSpace } from './auth';
import { getPlatformAuthConfig } from './oauth';


export interface SpaceInvitation {
  id: string;
  spaceId: string;
  inviterId: string;
  inviteeEmail: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'declined' | 'removed';
  createdAt: string;
  acceptedAt?: string;
  spaceName?: string; // 可选的空间名称字段
  inviterEmail?: string; // 邀请者的email
  /** When true, accept adds the user as space admin (e.g. firm-created client space) */
  inviteAsAdmin?: boolean;
}

// 创建邀请（极简版本：只使用缓存数据，不查询数据库）
// 业务逻辑：空间管理员创建邀请，包含自己的id和email（来自缓存）、当前空间id、被邀请者email、创建时间、状态
export async function createInvitation(inviteeEmail: string): Promise<{ invitation: SpaceInvitation | null; error: Error | null }> {
  try {
    // 1. 获取认证用户ID（不查询数据库）
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser?.id) {
      return { invitation: null, error: new Error('Not logged in') };
    }

    // 2. 从缓存获取用户信息（包含当前家庭ID和email）
    const user = await getCurrentUser();
    if (!user) {
      return { invitation: null, error: new Error('User not found in cache') };
    }

    // 3. 使用缓存的当前空间ID（前端已确保用户是管理员）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      return { invitation: null, error: new Error('No space selected') };
    }

    // 4. 使用缓存的用户email
    const inviterEmail = user.email || authUser.email || '';
    if (!inviterEmail) {
      return { invitation: null, error: new Error('Inviter email not found') };
    }

    // 5. 获取空间名称（从缓存，不查询数据库）
    const space = await getCurrentSpace();
    const spaceName = space?.name || 'a space';

    // 6. 准备插入数据（所有数据来自缓存，不查询数据库）
    const createdAt = new Date().toISOString();
    const insertData = {
      space_id: spaceId,
      inviter_id: authUser.id, // 来自认证系统
      inviter_email: inviterEmail, // 来自缓存
      invitee_email: inviteeEmail.toLowerCase().trim(), // 用户输入
      space_name: spaceName, // 空间名称（从缓存）
      status: 'pending', // 自动生成的状态
      created_at: createdAt, // 创建时间
    };

    // 7. 使用 RPC 函数插入邀请记录（绕过 RLS，避免权限问题）
    // 这样就不需要查询数据库，也不会触发 RLS 策略
    const { data: invitationId, error: rpcError } = await getPlatformClient().rpc('create_space_invitation', {
      p_space_id: spaceId,
      p_inviter_id: authUser.id,
      p_inviter_email: inviterEmail,
      p_invitee_email: inviteeEmail.toLowerCase().trim(),
      p_space_name: spaceName, // 传递空间名称
    });

    if (rpcError || !invitationId) {
      console.error('Error creating invitation via RPC:', rpcError);
      // 如果 RPC 函数不存在或失败，回退到UPSERT逻辑（先查找，存在则更新，不存在则插入）
      console.log('RPC function failed, falling back to UPSERT logic');
      
      const normalizedEmail = inviteeEmail.toLowerCase().trim();
      
      // 先查找是否已存在记录（基于space_id + email）
      const { data: existingInvitation, error: findError } = await getPlatformClient()
        .from('space_invitations')
        .select('id, status')
        .eq('space_id', spaceId)
        .ilike('invitee_email', normalizedEmail)  // 使用ilike进行不区分大小写的匹配
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let finalInvitationId: string | null = null;

      if (existingInvitation) {
        // 如果已存在，更新现有记录：重置为pending状态，更新邀请者信息和家庭名称
        const { data: updateResult, error: updateError } = await getPlatformClient()
          .from('space_invitations')
          .update({
            status: 'pending',
            inviter_id: authUser.id,
            inviter_email: inviterEmail,
            space_name: spaceName, // 更新空间名称
            created_at: createdAt,
            accepted_at: null,
          })
          .eq('id', existingInvitation.id)
          .select('id')
          .single();

        if (updateError || !updateResult?.id) {
          return {
            invitation: null,
            error: new Error(updateError?.message || 'Failed to update existing invitation'),
          };
        }

        finalInvitationId = updateResult.id;
        console.log('Updated existing invitation:', finalInvitationId, '(previous status:', existingInvitation.status, ')');
      } else {
        // 如果不存在，创建新记录
        const { data: insertResult, error: insertError } = await getPlatformClient()
          .from('space_invitations')
          .insert(insertData)
          .select('id')
          .single();

        if (insertError || !insertResult?.id) {
          // 如果是唯一约束错误，说明在并发情况下另一条记录已创建，再次查找
          if (insertError?.code === '23505' || insertError?.message?.includes('unique') || insertError?.message?.includes('duplicate')) {
            console.log('Unique constraint violation, retrying to find existing invitation');
            const { data: retryInvitation, error: retryError } = await getPlatformClient()
        .from('space_invitations')
        .select('id')
        .eq('space_id', spaceId)
              .ilike('invitee_email', normalizedEmail)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (retryError || !retryInvitation?.id) {
              return {
                invitation: null,
                error: new Error('Failed to create or find invitation'),
              };
            }

            // 更新刚找到的记录
            const { data: updateResult, error: updateError } = await getPlatformClient()
              .from('space_invitations')
              .update({
                status: 'pending',
                inviter_id: authUser.id,
                inviter_email: inviterEmail,
                space_name: spaceName, // 更新空间名称
                created_at: createdAt,
                accepted_at: null,
              })
              .eq('id', retryInvitation.id)
              .select('id')
              .single();

            if (updateError || !updateResult?.id) {
              return {
                invitation: null,
                error: new Error(updateError?.message || 'Failed to update invitation'),
              };
            }

            finalInvitationId = updateResult.id;
          } else {
            return {
              invitation: null,
              error: new Error(insertError?.message || rpcError?.message || 'Failed to create invitation'),
            };
          }
        } else {
          finalInvitationId = insertResult.id;
        }
      }
      
      if (!finalInvitationId) {
        return {
          invitation: null,
          error: new Error('Failed to create or find invitation'),
        };
      }
      
      // 返回邀请信息
      return {
        invitation: {
          id: finalInvitationId,
          spaceId: spaceId,
          inviterId: authUser.id,
          inviteeEmail: normalizedEmail,
          status: 'pending',
          createdAt: createdAt,
          acceptedAt: undefined,
          inviterEmail: inviterEmail,
          spaceName: spaceName,
        },
        error: null,
      };
    }

    // 8. 发送邀请邮件（异步，不阻塞返回，失败不影响邀请创建）
    sendInvitationEmail(
      inviteeEmail, 
      invitationId,
      false,
      spaceId,
      inviterEmail.split('@')[0] || 'Someone',
      spaceName
    ).catch(err => {
      console.warn('Failed to send invitation email:', err);
    });

    // 9. 返回邀请信息（使用已知数据，不查询数据库）
    return {
      invitation: {
        id: invitationId,
        spaceId: spaceId,
        inviterId: authUser.id,
        inviteeEmail: inviteeEmail.toLowerCase().trim(),
        status: 'pending',
        createdAt: createdAt,
        acceptedAt: undefined,
        inviterEmail: inviterEmail,
        spaceName: spaceName,
      },
      error: null,
    };
  } catch (error) {
    console.error('Error creating invitation:', error);
    return {
      invitation: null,
      error: error instanceof Error ? error : new Error('Failed to create invitation'),
    };
  }
}

/** Returns { emailSent: true } when Supabase sent the invite email; { emailSent: false } when existing user (invite in-app only). */
async function sendInvitationEmail(
  email: string,
  invitationId: string,
  isExistingUser: boolean,
  spaceId?: string,
  inviterName?: string,
  spaceName?: string
): Promise<{ emailSent: boolean }> {
  try {
    const cfg = getPlatformAuthConfig();
    const baseUrl = cfg.inviteDeepLinkBase
      || ((typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'exp://localhost:8081');

    const inviteUrl = `${baseUrl}/invite/${invitationId}`;

    // 使用传入的参数，不查询数据库
    const finalSpaceName = spaceName || 'a space';
    const finalInviterName = inviterName || 'Someone';

    // Edge Function uses Supabase Auth SMTP + email templates only.
    const { data: edgeFunctionData, error: edgeFunctionError } = await getPlatformClient().functions.invoke('send-invitation-email', {
      body: {
        email,
        inviteUrl,
        invitationId,
        spaceName,
        inviterName: finalInviterName,
        isExistingUser,
      },
    });

    if (edgeFunctionError) {
      throw new Error(edgeFunctionError.message || 'Edge Function error');
    }
    if (edgeFunctionData && (edgeFunctionData as { success?: boolean }).success === false) {
      const err = (edgeFunctionData as { error?: string }).error || 'Email not sent';
      throw new Error(err);
    }
    const emailSent = (edgeFunctionData as { emailSent?: boolean })?.emailSent !== false;
    return { emailSent };
  } catch (error) {
    console.error('Error sending invitation email:', error);
    throw error;
  }
}

// 根据ID获取邀请信息
export async function getInvitationById(invitationId: string): Promise<SpaceInvitation | null> {
  try {
    const { data, error } = await getPlatformClient()
      .from('space_invitations')
      .select('*')
      .eq('id', invitationId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null; // no rows
      throw error;
    }

    if (!data) return null;

    return {
      id: data.id,
      spaceId: data.space_id,
      inviterId: data.inviter_id,
      inviteeEmail: data.invitee_email,
      status: data.status,
      createdAt: data.created_at,
      acceptedAt: data.accepted_at,
      spaceName: data.space_name || undefined,
      inviterEmail: data.inviter_email || undefined,
      inviteAsAdmin: data.invite_as_admin === true,
    };
  } catch (error) {
    console.error('Error getting invitation by id:', error);
    return null;
  }
}

/** Send invitation email for an existing invitation (e.g. after firm creates client on behalf). Returns { emailSent } from Supabase. */
export async function sendInvitationEmailForId(invitationId: string): Promise<{ emailSent: boolean }> {
  const inv = await getInvitationById(invitationId);
  if (!inv || inv.status !== 'pending') return { emailSent: false };
  const inviterName = (inv.inviterEmail || '').split('@')[0] || 'Someone';
  return sendInvitationEmail(
    inv.inviteeEmail,
    inv.id,
    false,
    inv.spaceId,
    inviterName,
    inv.spaceName || 'a space'
  );
}

// 获取用户待处理的邀请（包含家庭名称）
// 如果查询失败（如 RLS 权限问题），静默返回空数组，不阻塞登录流程
export async function getPendingInvitationsForUser(): Promise<SpaceInvitation[]> {
  try {
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser || !authUser.email) return [];

    // 直接使用 auth.users 的 email，避免查询 users 表触发 RLS 权限检查
    // RLS 策略会使用 auth.users 表的 email 来匹配 invitee_email
    const userEmail = authUser.email.toLowerCase();
    if (!userEmail) return [];

    // 直接查询邀请数据（不使用 join，因为 RLS 策略可能阻止 join）
    let data: any[] | null = null;
    let error: any = null;
    
    try {
      const result = await getPlatformClient()
        .from('space_invitations')
        .select('*')
        .eq('invitee_email', userEmail.toLowerCase())
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      data = result.data;
      error = result.error;
      
      // 如果查询失败（权限错误），静默返回空数组，不阻塞登录流程
      if (error) {
        // 如果是权限错误，静默处理，不记录错误日志（避免日志噪音）
        if (error.code === '42501' || error.message?.includes('permission denied')) {
          // 权限错误时，静默返回空数组，不阻塞登录流程
          return [];
        }
        // 其他错误也静默处理
        console.log('Invitations query failed (non-blocking):', error.code);
        return [];
      }
      
      // 如果没有数据，直接返回空数组
      if (!data || data.length === 0) {
        return [];
      }
      
      // 如果查询成功，直接使用 inviter_email 和 space_name 字段（已存储在邀请记录中）
      // 不再需要查询 users 或 households 表，避免 RLS 权限问题
    } catch (queryError: any) {
      // 查询异常时，静默返回空数组，不阻塞登录流程
      console.log('Invitations query exception (non-blocking):', queryError.message);
      return [];
    }

    // 如果没有数据，直接返回空数组
    if (!data || data.length === 0) {
      return [];
    }

    // 直接使用数据库中的字段，不再需要额外查询
    return data.map((row: any) => {
      const spaceName: string | undefined = row.space_name || undefined;
      const inviterEmail: string | undefined = row.inviter_email || undefined;
      return {
        id: row.id,
        spaceId: row.space_id,
        inviterId: row.inviter_id,
        inviteeEmail: row.invitee_email,
        status: row.status,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        spaceName: spaceName || undefined,
        inviterEmail: inviterEmail || undefined,
        inviteAsAdmin: row.invite_as_admin === true,
      };
    });
  } catch (error) {
    console.error('Error getting pending invitations for user:', error);
    return [];
  }
}

/** Realtime 订阅：当前用户待处理邀请数量变化时触发 onCountChange（仅用于 Web 端角标等） */
export function subscribePendingInvitationsRealtime(
  userEmail: string,
  onCountChange: () => void
): () => void {
  const normalizedEmail = (userEmail || '').toLowerCase();
  if (!normalizedEmail) return () => {};

  const channel = getPlatformClient()
    .channel(`space-invitations-for-${normalizedEmail.replace(/[^a-z0-9]/g, '-')}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'space_invitations' },
      (payload) => {
        const record = (payload.new ?? payload.old) as { invitee_email?: string } | undefined;
        const email = (record?.invitee_email ?? '').toLowerCase();
        if (email === normalizedEmail) {
          onCountChange();
        }
      }
    )
    .subscribe();

  return () => {
    getPlatformClient().removeChannel(channel);
  };
}

// 接受邀请（加入家庭）
export async function acceptInvitation(invitationId: string): Promise<{ error: Error | null }> {
  try {
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser) {
      return { error: new Error('Not logged in') };
    }

    // 获取邀请信息
    const invitation = await getInvitationById(invitationId);
    if (!invitation) {
      return { error: new Error('Invitation not found or expired') };
    }

    if (invitation.status !== 'pending') {
      return { error: new Error('Invitation has already been used or cancelled') };
    }

    // 验证邮箱是否匹配（使用 auth.users，避免查询 users 表触发 RLS 权限问题）
    const userEmail = authUser.email?.toLowerCase();
    if (!userEmail || userEmail !== invitation.inviteeEmail.toLowerCase()) {
      return { error: new Error('Email does not match invitation') };
    }

    // 确保基于household_id + email更新记录（而不是仅基于invitationId）
    // 这样可以确保即使有历史遗留的重复记录，也只会更新正确的那条
    const normalizedEmail = userEmail.toLowerCase().trim();

    // 检查用户是否已经是该家庭的成员
    const { data: existingMember } = await getPlatformClient()
      .from('user_spaces')
      .select('id')
      .eq('user_id', authUser.id)
      .eq('space_id', invitation.spaceId)
      .single();

    if (existingMember) {
      // 用户已经是成员，只更新邀请状态（基于space_id + email）
      const { error: updateError } = await getPlatformClient()
        .from('space_invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        })
        .eq('space_id', invitation.spaceId)
        .ilike('invitee_email', normalizedEmail);  // 使用ilike进行不区分大小写的匹配

      if (updateError) {
        console.error('Error updating invitation status:', updateError);
        throw updateError;
      }

      // 切换到该空间（使用 RPC 函数，避免 RLS 权限问题）
      try {
        const { error: rpcError } = await getPlatformClient().rpc('update_user_current_space', {
          p_user_id: authUser.id,
          p_space_id: invitation.spaceId,
        });
        if (rpcError) {
          // 如果 RPC 函数不存在或失败，回退到直接更新（可能失败）
          console.log('RPC function failed, falling back to direct update:', rpcError);
          await getPlatformClient()
            .from('users')
            .update({ current_space_id: invitation.spaceId })
            .eq('id', authUser.id);
        }
      } catch (updateErr) {
        console.log('Error updating current space:', updateErr);
      }

      return { error: null };
    }

    // 添加用户到空间（代建邀请时客户为 admin，否则为 member）
    const isAdmin = invitation.inviteAsAdmin === true;
    const { error: insertError } = await getPlatformClient()
      .from('user_spaces')
      .insert({
        user_id: authUser.id,
        space_id: invitation.spaceId,
        is_admin: isAdmin,
      });

    if (insertError) throw insertError;

    // 更新邀请状态（基于space_id + email，确保只更新正确的那条记录）
    const { error: updateError } = await getPlatformClient()
      .from('space_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('space_id', invitation.spaceId)
      .ilike('invitee_email', normalizedEmail);  // 使用ilike进行不区分大小写的匹配

    if (updateError) {
      console.error('Error updating invitation status:', updateError);
      throw updateError;
    }

    // 切换到该家庭（使用 RPC 函数，避免 RLS 权限问题）
    try {
        const { error: rpcError } = await getPlatformClient().rpc('update_user_current_space', {
          p_user_id: authUser.id,
          p_space_id: invitation.spaceId,
        });
      if (rpcError) {
        // 如果 RPC 函数不存在或失败，回退到直接更新（可能失败）
        console.log('RPC function failed, falling back to direct update:', rpcError);
        await getPlatformClient()
          .from('users')
          .update({ current_space_id: invitation.spaceId })
          .eq('id', authUser.id);
      }
    } catch (updateErr) {
      console.log('Error updating current space:', updateErr);
    }

    return { error: null };
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return {
      error: error instanceof Error ? error : new Error('Failed to accept invitation'),
    };
  }
}

// 拒绝邀请
export async function declineInvitation(invitationId: string): Promise<{ error: Error | null }> {
  try {
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser) {
      return { error: new Error('Not logged in') };
    }

    // 获取邀请信息
    const invitation = await getInvitationById(invitationId);
    if (!invitation) {
      return { error: new Error('Invitation not found or expired') };
    }

    if (invitation.status !== 'pending') {
      return { error: new Error('Invitation has already been used or cancelled') };
    }

    // 验证邮箱是否匹配（使用 auth.users，避免查询 users 表触发 RLS 权限问题）
    const userEmail = authUser.email?.toLowerCase();
    if (!userEmail || userEmail !== invitation.inviteeEmail.toLowerCase()) {
      return { error: new Error('Email does not match invitation') };
    }

    // 更新邀请状态为已拒绝（declined）
    // 基于space_id + email更新记录，确保只更新正确的那条（即使有历史遗留的重复记录）
    const normalizedEmail = userEmail.toLowerCase().trim();
    const { error: updateError } = await getPlatformClient()
      .from('space_invitations')
      .update({ status: 'declined' })
      .eq('space_id', invitation.spaceId)
      .ilike('invitee_email', normalizedEmail);  // 使用ilike进行不区分大小写的匹配

    if (updateError) {
      console.error('Error updating invitation status to declined:', updateError);
      throw updateError;
    }

    return { error: null };
  } catch (error) {
    console.error('Error declining invitation:', error);
    return {
      error: error instanceof Error ? error : new Error('Failed to decline invitation'),
    };
  }
}

// 获取家庭的所有邀请（管理员使用）
export async function getSpaceInvitations(spaceId: string): Promise<SpaceInvitation[]> {
  try {
    // 直接从 auth.users 获取用户信息，避免查询 users 表
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser || !authUser.id) {
      return [];
    }

    // 检查用户是否是管理员
    const { data: userHousehold, error: checkError } = await getPlatformClient()
      .from('user_spaces')
      .select('is_admin')
      .eq('user_id', authUser.id)
      .eq('space_id', spaceId)
      .single();

    if (checkError || !userHousehold?.is_admin) {
      return [];
    }

    // 获取所有邀请（包括pending, declined, cancelled, accepted状态）
    const { data, error } = await getPlatformClient()
      .from('space_invitations')
      .select('*')
      .eq('space_id', spaceId)
      .in('status', ['pending', 'declined', 'cancelled', 'accepted', 'removed'])
      .order('created_at', { ascending: false });

    if (error) {
      // 如果是权限错误，静默处理，不记录错误日志（避免日志噪音）
      if (error.code === '42501' || error.message?.includes('permission denied')) {
        // 权限错误时，静默返回空数组
        return [];
      }
      // 其他错误才记录
      console.error('Error getting household invitations:', error);
      return [];
    }

    if (!data) return [];

    // 获取已经加入家庭的用户邮箱列表
    const { data: existingMembers } = await getPlatformClient()
      .from('user_spaces')
      .select('user_id')
      .eq('space_id', spaceId);

    const existingUserIds = new Set(existingMembers?.map(m => m.user_id) || []);

    // 获取用户邮箱
    // 注意：不查询 users 表，因为 RLS 策略可能阻止查询
    // 直接使用 invitee_email 来过滤，不依赖 users 表
    let existingEmails = new Set<string>();
    // 如果确实需要用户邮箱，可以通过 auth.users 表或其他方式获取
    // 但为了简化，这里暂时跳过，直接使用 invitee_email

    // 不过滤任何邀请，返回所有邀请（包括已加入和已移除的）
    // 在UI中根据状态和是否在user_households中来分类显示
    const filteredData = data;

    return filteredData.map((row: any) => ({
      id: row.id,
      spaceId: row.space_id,
      inviterId: row.inviter_id,
      inviteeEmail: row.invitee_email,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
    }));
  } catch (error) {
    console.error('Error getting household invitations:', error);
    return [];
  }
}

// 撤销邀请（管理员使用）
export async function cancelInvitation(invitationId: string): Promise<{ error: Error | null }> {
  try {
    // 直接从 auth.users 获取用户信息，避免查询 users 表
    const { data: { user: authUser } } = await getPlatformClient().auth.getUser();
    if (!authUser || !authUser.id) {
      return { error: new Error('Not logged in') };
    }

    // 获取邀请信息（一次查询获取所有需要的信息）
    const { data: invitation, error: fetchError } = await getPlatformClient()
      .from('space_invitations')
      .select('space_id, status, invitee_email')
      .eq('id', invitationId)
      .single();

    if (fetchError || !invitation) {
      return { error: new Error('Invitation not found') };
    }

    if (invitation.status !== 'pending') {
      return { error: new Error('Can only cancel pending invitations') };
    }

    // 检查用户是否是管理员
    const { data: userHousehold, error: checkError } = await getPlatformClient()
      .from('user_spaces')
      .select('is_admin')
      .eq('user_id', authUser.id)
      .eq('space_id', invitation.space_id)
      .single();

    if (checkError || !userHousehold?.is_admin) {
      return { error: new Error('Only admins can cancel invitations') };
    }

    // 更新邀请状态为已取消
    // 基于invitationId和household_id更新（双重验证，确保更新正确的记录）
    // 虽然理论上应该只有一条记录（由于唯一约束），但双重验证可以防止意外更新错误的记录
    const { error: updateError } = await getPlatformClient()
      .from('space_invitations')
      .update({ status: 'cancelled' })
      .eq('id', invitationId)
      .eq('space_id', invitation.space_id);  // 额外验证household_id

    if (updateError) {
      console.error('Error updating invitation status to cancelled:', updateError);
      throw updateError;
    }

    return { error: null };
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    return {
      error: error instanceof Error ? error : new Error('Failed to cancel invitation'),
    };
  }
}
