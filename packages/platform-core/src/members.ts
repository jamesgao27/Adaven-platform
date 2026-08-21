import { getPlatformClient } from './client';
import { getCurrentUser } from './auth';


export interface SpaceMember {
  userId: string;
  email: string;
  name?: string;
  lastSignInAt: string | null;
  createdAt: string;
  isAdmin?: boolean;
}

// 获取当前空间的所有成员
export async function getSpaceMembers(): Promise<SpaceMember[]> {
  try {
    const user = await getCurrentUser(true); // 强制刷新，确保获取最新的spaceId
    if (!user) {
      console.error('getSpaceMembers: Not logged in');
      throw new Error('Not logged in');
    }

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      console.error('getSpaceMembers: No space selected', {
        currentSpaceId: user.currentSpaceId,
        spaceId: user.spaceId,
      });
      throw new Error('No space selected');
    }

    console.log('getSpaceMembers: Fetching members for space:', spaceId);

    // 获取空间中的所有用户关联
    // 注意：user_spaces表的RLS策略应该允许用户查看同一空间的所有成员
    const { data: userSpaces, error: userSpacesError } = await getPlatformClient()
      .from('user_spaces')
      .select('user_id, created_at, is_admin')
      .eq('space_id', spaceId);

    if (userSpacesError) {
      console.error('getSpaceMembers: Error fetching user_spaces:', {
        code: userSpacesError.code,
        message: userSpacesError.message,
        details: userSpacesError.details,
      });
      throw userSpacesError;
    }
    
    if (!userSpaces || userSpaces.length === 0) {
      console.log('getSpaceMembers: No members found for space:', spaceId);
      return [];
    }
    
    console.log('getSpaceMembers: Found', userSpaces.length, 'members in user_spaces');

    // 获取所有用户的邮箱和名字
    // 优先使用 RPC 函数绕过 RLS 限制
    let users: any[] = [];
    let usersError: any = null;
    
    try {
      const { data: rpcData, error: rpcError } = await getPlatformClient()
        .rpc('get_space_member_users', {
          p_space_id: spaceId
        });
      
      if (!rpcError && rpcData) {
        users = rpcData;
        console.log('✅ Successfully fetched space members via RPC:', users.length);
      } else if (rpcError) {
        // 如果 RPC 函数不存在或失败，检查是否是函数不存在错误
        const isFunctionNotFound = rpcError.code === '42883' || rpcError.message?.includes('function') || rpcError.message?.includes('does not exist');
        if (isFunctionNotFound) {
          console.warn('⚠️  RPC function get_space_member_users not found. Please execute create-users-rpc-functions.sql');
        } else {
          console.error('❌ RPC function get_space_member_users failed:', rpcError);
        }
        // 回退到直接查询（会失败，因为 RLS 策略问题）
        console.log('⚠️  Falling back to direct query (may fail due to RLS)...');
        const userIds = userSpaces.map(us => us.user_id);
        const { data: queryData, error: queryError } = await getPlatformClient()
          .from('users')
          .select('id, email, name')
          .in('id', userIds);
        users = queryData || [];
        usersError = queryError;
        if (queryError) {
          console.error('❌ Direct query also failed:', queryError);
        }
      }
    } catch (rpcErr: any) {
      // RPC 函数可能不存在，回退到直接查询
      console.error('❌ RPC function exception:', rpcErr);
      const userIds = userSpaces.map(us => us.user_id);
      const { data: queryData, error: queryError } = await getPlatformClient()
        .from('users')
        .select('id, email, name')
        .in('id', userIds);
      users = queryData || [];
      usersError = queryError;
    }

    if (usersError) throw usersError;

    // 尝试通过 RPC 函数获取最后登录时间
    let membersWithLastSignIn: Array<{ user_id: string; email: string; last_sign_in_at: string | null }> = [];
    try {
      const { data: rpcData, error: rpcError } = await getPlatformClient().rpc('get_space_members_with_last_signin', {
        p_space_id: spaceId,
      });

      if (!rpcError && rpcData) {
        membersWithLastSignIn = rpcData;
      }
    } catch (e) {
      console.log('RPC function not available, using basic query:', e);
    }

    // 构建成员列表
    const members: SpaceMember[] = userSpaces.map(us => {
      const userInfo = users?.find(u => u.id === us.user_id);
      const rpcInfo = membersWithLastSignIn.find(r => r.user_id === us.user_id);
      
      return {
        userId: us.user_id,
        email: userInfo?.email || 'Unknown',
        name: userInfo?.name || undefined,
        lastSignInAt: rpcInfo?.last_sign_in_at || null,
        createdAt: us.created_at,
        isAdmin: us.is_admin || false,
      };
    });

    return members;
  } catch (error) {
    console.error('Error getting space members:', error);
    throw error;
  }
}