import { getPlatformClient } from './client';
import type { PlatformUser as User, PlatformSpace as Space, PlatformUserSpace as UserSpace } from './types';
import { getCachedUser, updateCachedUser, getCachedSpace, updateCachedSpace } from './auth-cache';
import { runOnSpaceCreated } from './space-created-hooks';
import { getPlatformAuthConfig, resolveRedirectTo } from './oauth';

function supabase() {
  return getPlatformClient();
}

function validateConfig(): { valid: boolean; error?: string } {
  return getPlatformAuthConfig().validateConfig?.() ?? { valid: true };
}

export async function getCurrentUser(forceRefresh: boolean = false): Promise<User | null> {
  // 如果强制刷新或缓存未初始化，从数据库读取
  if (!forceRefresh) {
    const cached = getCachedUser();
    if (cached) {
      return cached;
    }
  }

  try {
    const { data: { user: authUser } } = await supabase().auth.getUser();
    if (!authUser) {
      updateCachedUser(null);
      return null;
    }

    // 优先使用 RPC 函数绕过 RLS 限制
    let data: any = null;
    let error: any = null;
    
    try {
      const { data: rpcData, error: rpcError } = await supabase()
        .rpc('get_user_by_id', { p_user_id: authUser.id });
      
      if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
        // RPC 函数返回数组，取第一个元素
        data = rpcData[0];

        // 有些 RPC 可能没有返回 logo_url 字段（从而导致前端永远拿不到头像）
        // 只有当字段缺失（undefined）时回退到直接查询；如果 RPC 明确返回 null，则保持 null。
        if ((data as any)?.logo_url === undefined) {
          const { data: queryData, error: queryError } = await supabase()
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .maybeSingle();

          if (!queryError && queryData) {
            data = queryData;
          }
        }
      } else if (rpcError) {
        // RPC 函数出错，回退到直接查询
        console.log('RPC function failed, falling back to direct query:', rpcError);
        const { data: queryData, error: queryError } = await supabase()
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();
        
        data = queryData;
        error = queryError;
      } else {
        // RPC 函数返回空结果，回退到直接查询
        const { data: queryData, error: queryError } = await supabase()
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();
        
        data = queryData;
        error = queryError;
      }
    } catch (rpcErr) {
      // RPC 函数可能不存在，回退到直接查询
      console.log('RPC function not available, using direct query:', rpcErr);
      const { data: queryData, error: queryError } = await supabase()
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();
      
      data = queryData;
      error = queryError;
    }

    // 如果是权限错误，记录错误信息
    if (error) {
      if (error.code === '42501' || error.message?.includes('permission denied')) {
        console.error('Permission error accessing users table');
        updateCachedUser(null);
        return null;
      }
    }

    // 如果用户记录不存在，尝试创建（可能是新注册的用户，users 表记录还未创建）
    if (error || !data) {
      // 尝试创建用户记录
      // 尝试从 user_metadata 中获取用户名（注册时通过 data 参数传递）
      const userNameFromMetadata = authUser.user_metadata?.name;
      const userName = userNameFromMetadata || authUser.email?.split('@')[0] || 'User';
      
      const { error: insertError } = await supabase()
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email || '',
          name: userName,
          current_space_id: null,
        });
      
      if (insertError) {
        // 如果是重复键错误（用户已存在），静默处理，直接查询
        const errorCode = String(insertError.code || '');
        const isDuplicateKey = errorCode === '23505' || 
                               insertError.message?.includes('duplicate key') ||
                               insertError.message?.includes('unique constraint');
        
        // 如果插入失败，可能是记录已存在（并发情况），再次查询
        const { data: retryData, error: retryError } = await supabase()
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();
        
        if (retryError || !retryData) {
          // 只有在不是重复键错误时才记录错误
          if (!isDuplicateKey) {
            console.error('Error getting/creating user:', insertError || retryError);
          }
          updateCachedUser(null);
          return null;
        }
        
        // 使用重试查询到的数据
        const user: User = {
          id: retryData.id,
          email: retryData.email,
          name: retryData.name,
          logoUrl: (retryData as any).logo_url ?? null,
          spaceId: retryData.current_space_id || null,
          currentSpaceId: retryData.current_space_id,
          createdAt: retryData.created_at,
        };
        updateCachedUser(user);
        return user;
      }
      
      // 插入成功，重新查询
      const { data: newData, error: newError } = await supabase()
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      
      if (newError || !newData) {
        console.error('Error getting newly created user:', newError);
        updateCachedUser(null);
        return null;
      }
      
      const user: User = {
        id: newData.id,
        email: newData.email,
        name: newData.name,
        logoUrl: (newData as any).logo_url ?? null,
        spaceId: newData.current_space_id || null,
        currentSpaceId: newData.current_space_id,
        createdAt: newData.created_at,
      };
      updateCachedUser(user);
      return user;
    }

    // 使用 current_space_id（space_id 字段已删除）
    const user: User = {
      id: data.id,
      email: data.email,
      name: data.name,
      logoUrl: (data as any).logo_url ?? null,
      spaceId: data.current_space_id || null, // 返回当前活动的空间ID
      currentSpaceId: data.current_space_id,
      createdAt: data.created_at,
    };

    // 更新缓存
    updateCachedUser(user);
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    updateCachedUser(null);
    return null;
  }
}

// 获取当前用户的家庭信息（优先使用缓存）
export async function getCurrentSpace(forceRefresh: boolean = false): Promise<Space | null> {
  // 如果强制刷新或缓存未初始化，从数据库读取
  if (!forceRefresh) {
    const cached = getCachedSpace();
    if (cached) {
      return cached;
    }
  }

  try {
    // 尝试获取用户信息（强制刷新时一并刷新用户，以拿到最新的 current_space_id）
    let user: User | null = null;
    try {
      user = await getCurrentUser(forceRefresh);
    } catch (userError: any) {
      // 如果是权限错误，记录警告但继续
      if (userError?.code === '42501' || userError?.message?.includes('permission denied')) {
        console.warn('Permission error getting user, RLS policy may need to be fixed:', userError.message);
        updateCachedSpace(null);
        return null;
      }
      // 其他错误继续抛出
      throw userError;
    }
    
    if (!user) {
      updateCachedSpace(null);
      return null;
    }

    // 优先使用 currentSpaceId，如果没有则使用 spaceId（向后兼容）
    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      updateCachedSpace(null);
      return null;
    }

    const { data, error } = await supabase()
      .from('spaces')
      .select('*')
      .eq('id', spaceId)
      .maybeSingle();

    // 0 行（空间已删除或用户被移出 RLS 不可见）、权限错误等：视为当前空间失效，清除 DB 并返回 null
    if (error || !data) {
      const isZeroRows = error?.code === 'PGRST116' || (error?.message?.includes('0 rows') ?? false);
      const isPermission = error?.code === '42501' || error?.message?.includes('permission denied');
      if (isZeroRows || isPermission || !data) {
        updateCachedSpace(null);
        try {
          await supabase().from('users').update({ current_space_id: null }).eq('id', user.id);
          updateCachedUser(user ? { ...user, currentSpaceId: undefined, spaceId: null } : null);
        } catch (clearErr) {
          // 清除失败不阻塞，缓存已置空，调用方会走「无当前空间」流程
        }
        return null;
      }
      throw error;
    }

    const space: Space = {
      id: data.id,
      name: data.name,
      address: data.address,
      logoUrl: (data as any).logo_url ?? null,
      kind: data.kind,
      clientProfileType: (data as any).client_profile_type,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    // 更新缓存
    updateCachedSpace(space);
    return space;
  } catch (error) {
    console.error('Error getting current space:', error);
    updateCachedSpace(null);
    return null;
  }
}

// 获取用户的所有空间列表
export async function getUserSpaces(): Promise<UserSpace[]> {
  try {
    const { data: { user: authUser } } = await supabase().auth.getUser();
    if (!authUser) {
      if (__DEV__) console.log('getUserSpaces: No authenticated user');
      return [];
    }

    if (__DEV__) console.log('getUserSpaces: Querying for user_id:', authUser.id);

    const { data, error } = await supabase()
      .from('user_spaces')
      .select(`
        *,
        spaces (*)
      `)
      .eq('user_id', authUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getUserSpaces: Query error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }

    if (!data) {
      if (__DEV__) console.log('getUserSpaces: No data returned (null)');
      return [];
    }

    if (__DEV__) console.log('getUserSpaces: Found', data.length, 'spaces for user', authUser.id);

    const result = data.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      spaceId: row.space_id,
      isAdmin: row.is_admin === true,
      role: row.role,
      space: row.spaces ? {
        id: row.spaces.id,
        name: row.spaces.name,
        address: row.spaces.address,
        logoUrl: (row.spaces as any).logo_url ?? null,
        kind: row.spaces.kind,
        clientProfileType: (row.spaces as any).client_profile_type,
        createdAt: row.spaces.created_at,
        updatedAt: row.spaces.updated_at,
      } : undefined,
      createdAt: row.created_at,
    }));

    if (__DEV__) {
      result.forEach((userSpace, index) => {
        console.log(`getUserSpaces: Space ${index + 1}:`, {
          spaceId: userSpace.spaceId,
          spaceName: userSpace.space?.name || 'Unknown',
          hasSpaceData: !!userSpace.space,
        });
      });
    }

    return result;
  } catch (error) {
    console.error('Error getting user spaces:', error);
    // 如果是权限错误，记录详细信息
    if (error && typeof error === 'object' && 'code' in error) {
      const err = error as any;
      if (err.code === '42501' || err.message?.includes('permission denied')) {
        console.error('getUserSpaces: RLS permission error - user may not have access to user_spaces table');
      }
    }
    return [];
  }
}

// 设置当前活动的空间
export async function setCurrentSpace(spaceId: string): Promise<{ error: Error | null }> {
  try {
    const { data: { user: authUser } } = await supabase().auth.getUser();
    if (!authUser) {
      return { error: new Error('Not authenticated') };
    }

    // 验证用户是否属于该空间
    const { data: association, error: checkError } = await supabase()
      .from('user_spaces')
      .select('id')
      .eq('user_id', authUser.id)
      .eq('space_id', spaceId)
      .single();

    if (checkError || !association) {
      return { error: new Error('User does not belong to this space') };
    }

    // 更新用户的当前空间
    // 优先使用 RPC 函数绕过 RLS 限制
    let updateError: any = null;
    try {
      const { error: rpcError } = await supabase()
        .rpc('update_user_current_space', {
          p_user_id: authUser.id,
          p_space_id: spaceId
        });
      
      if (rpcError) {
        // 检查是否是函数不存在错误
        const isFunctionNotFound = rpcError.code === '42883' || rpcError.message?.includes('function') || rpcError.message?.includes('does not exist');
        if (isFunctionNotFound) {
          console.warn('⚠️  RPC function update_user_current_space not found. Please execute create-users-rpc-functions.sql');
        } else {
          console.error('❌ RPC function update_user_current_space failed:', rpcError);
        }
        // 回退到直接更新（会失败，因为 RLS 策略问题）
        console.log('⚠️  Falling back to direct update (may fail due to RLS)...');
        const { error: directError } = await supabase()
          .from('users')
          .update({ current_space_id: spaceId })
          .eq('id', authUser.id);
        updateError = directError;
        if (directError) {
          console.error('❌ Direct update also failed:', directError);
        }
      }
    } catch (rpcErr) {
      // RPC 函数可能不存在，回退到直接更新
      console.log('RPC function not available, using direct update:', rpcErr);
      const { error: directError } = await supabase()
        .from('users')
        .update({ current_space_id: spaceId })
        .eq('id', authUser.id);
      updateError = directError;
    }

    if (updateError) throw updateError;

    return { error: null };
  } catch (error) {
    console.error('Error setting current space:', error);
    return {
      error: error instanceof Error ? error : new Error('Failed to set current space'),
    };
  }
}


export async function signUp(email: string, password: string, householdName?: string, userName?: string): Promise<{ user: User | null; error: Error | null }> {
  try {
    // 验证 Supabase 配置
    const config = validateConfig();
    if (!config.valid) {
      return {
        user: null,
        error: new Error(
          '网络配置错误：Supabase 未正确配置。\n\n' +
          '请在 EAS Secrets 中设置：\n' +
          '- EXPO_PUBLIC_SUPABASE_URL\n' +
          '- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n' +
          '然后重新构建应用。'
        ),
      };
    }

    // 创建认证用户
    // 注意：如果 Supabase 启用了邮箱确认，注册后需要确认邮箱才能登录
    // 邮箱确认后，用户会被重定向到应用的登录页面
    // 详细配置请参考 EMAIL_CONFIRMATION_SETUP.md
    // 使用 HTTPS Universal Links / App Links 以支持从邮件客户端打开
    const redirectUrl = getPlatformAuthConfig().emailRedirectTo || resolveRedirectTo() || 'exp://localhost:8081/--/auth/confirm';
    
    // 准备用户信息，用于在 data 中传递（即使需要邮箱确认也能使用）
    const userNameFinal = userName || email.split('@')[0];
    
    const { data: authData, error: authError } = await supabase().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          // 在 metadata 中存储用户信息，即使需要邮箱确认也能访问
          name: userNameFinal,
          email: email,
        },
      },
    });

    // 处理邮箱已存在的错误
    if (authError) {
      const errorMsg = authError.message?.toLowerCase() || '';
      // 如果邮箱已存在，提供明确的错误信息
      if (errorMsg.includes('already registered') || 
          errorMsg.includes('email already') ||
          errorMsg.includes('user already registered')) {
        throw new Error(
          'This email is already registered.\n\n' +
          'If this is your account, please sign in directly.\n\n' +
          'If you need to re-register, please delete the user in Supabase Dashboard > Authentication > Users first, then register again.\n\n' +
          'For detailed steps, please refer to cleanup-auth-users.md'
        );
      }
      throw authError;
    }
    
    // 两步注册：只创建用户，不创建空间
    // 用户将在首次登录时设置家庭或接受邀请
    if (householdName === undefined) {
      
      // 如果启用了邮箱确认，authData.user 可能为 null，但 auth.users 记录已经创建
      // 我们需要尝试创建 users 表记录
      if (!authData.user) {
        // 注册成功，但需要邮箱确认，auth.users 记录已创建但无法获取 user.id
        // 在这种情况下，用户记录将在邮箱确认时或首次登录时创建
        // 返回需要邮箱确认的标记
        return { 
          user: null, 
          error: new Error('EMAIL_CONFIRMATION_REQUIRED') 
        };
      }
      
      
      // 检查 users 表中是否已存在该用户（以防万一）
      const { data: existingUser } = await supabase()
        .from('users')
        .select('id, current_space_id, name')
        .eq('id', authData.user!.id)  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
        .maybeSingle();
      
      if (existingUser) {
        // 用户记录已存在，如果提供了用户名，更新用户的name字段
        if (userName && userName.trim()) {
          await supabase()
            .from('users')
            .update({ name: userName.trim() })
            .eq('id', authData.user!.id);  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
        }
        const user: User = {
          id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
          email: email,
          name: userName && userName.trim() ? userName.trim() : undefined,
          spaceId: existingUser.current_space_id || null, // 返回当前活动的空间ID，如果没有则为 null
          currentSpaceId: existingUser.current_space_id || undefined,
        };
        return { user, error: null };
      }
      
      // 创建用户记录（不设置 current_space_id，等待首次登录时设置）
      const { error: userError } = await supabase()
        .from('users')
        .insert({
          id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
          email: email,
          name: userNameFinal,
          current_space_id: null,
        });

      if (userError) {
        console.log('User record creation failed (this is expected if email confirmation is required):', userError.code);
        console.log('Error details:', {
          code: userError.code,
          message: userError.message,
        });
        
        // 如果遇到 RLS 策略问题或其他权限问题，说明可能需要邮箱确认后才能创建 users 表记录
        // 这是正常情况，不抛出错误，返回需要邮箱确认的状态
        // 用户记录将在首次登录时自动创建
        if (userError.code === '42501' || 
            userError.message?.includes('row-level security') || 
            userError.message?.includes('permission denied') ||
            userError.code === '23503' ||
            userError.message?.includes('foreign key constraint')) {
          // 返回需要邮箱确认的状态（即使 authData.user 存在，users 表记录也会在登录时创建）
          return { 
            user: null, 
            error: new Error('EMAIL_CONFIRMATION_REQUIRED') 
          };
        }
        
        // 其他未知错误，也视为需要邮箱确认（保守处理）
        // 用户记录将在首次登录时自动创建
        return { 
          user: null, 
          error: new Error('EMAIL_CONFIRMATION_REQUIRED') 
        };
      }

      const user: User = {
        id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
        email: email,
        name: userNameFinal,
        spaceId: null,  // 类型为 string | null
        currentSpaceId: undefined,  // 类型为 string | undefined
      };
      return { user, error: null };
    }

    // 创建空间和用户记录
    // 确保 authData.user 存在
    if (!authData.user) {
      return { 
        user: null, 
        error: new Error('User authentication failed') 
      };
    }
    
    const spaceNameFinal = householdName || `${email.split('@')[0]}'s Space`;
    // userNameFinal 已在函数开始处声明（第 338 行），直接使用
    
    const { data: spaceId, error: rpcError } = await supabase().rpc('create_user_with_space', {
      p_user_id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
      p_email: email,
      p_space_name: spaceNameFinal,
      p_user_name: userNameFinal,
    });

    if (rpcError) {
      console.error('RPC error creating user/space:', rpcError);
      
      // 如果 RPC 函数不存在，回退到直接插入（尝试）
      if (rpcError.message?.includes('function') || rpcError.code === '42883') {
        
        // 尝试直接插入（如果 RLS 策略允许）
        const { data: spaceData, error: spaceError } = await supabase()
          .from('spaces')
          .insert({ name: spaceNameFinal })
          .select()
          .single();

        if (spaceError) {
          console.error('Space creation error:', spaceError);
          if (spaceError.message?.includes('row-level security') || spaceError.code === '42501') {
            throw new Error('Database permission error: Unable to create space account. Please execute create-user-function.sql script in Supabase first');
          }
          throw new Error(`Failed to create space account: ${spaceError.message}`);
        }
        
        if (!spaceData) {
          throw new Error('Registration failed: Space account not created');
        }

        // 创建用户记录
        // userNameFinal 已在函数开始处声明（第 338 行），直接使用
        const { error: userError } = await supabase()
          .from('users')
          .insert({
            id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
            email: email,
            name: userNameFinal,
            current_space_id: spaceData.id,
          });

        if (userError) {
          console.error('User creation error:', userError);
          throw new Error(`Failed to create user record: ${userError.message}`);
        }
        
        
        // 创建 user_spaces 关联记录
        const { error: associationError } = await supabase()
          .from('user_spaces')
          .insert({
            user_id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
            space_id: spaceData.id,
          });

        if (associationError) {
          console.warn('Failed to create user_space association:', associationError);
        }
        
        await runOnSpaceCreated({
          spaceId: spaceData.id,
          name: spaceNameFinal,
          kind: 'client',
          clientProfileType: 'household',
        });

        const user: User = {
          id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
          email: email,
          name: userName && userName.trim() ? userName.trim() : undefined,
          spaceId: spaceData.id,
          currentSpaceId: spaceData.id,
        };

        return { user, error: null };
      }
      
      throw new Error(`Failed to create user and space: ${rpcError.message}`);
    }

    if (!spaceId) {
      throw new Error('Registration failed: Space account not created');
    }


    await runOnSpaceCreated({
      spaceId,
      name: spaceNameFinal,
      kind: 'client',
      clientProfileType: 'household',
    });

    // 创建 user_spaces 关联记录（如果不存在）
    // 注意：RPC 函数应该已经创建了这个记录，但为了保险起见，我们在这里也创建
    const { error: associationError } = await supabase()
      .from('user_spaces')
      .insert({
        user_id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
        space_id: spaceId,
        is_admin: true, // Creator is admin
      })
      .select();
      
    if (associationError) {
      // 如果记录已存在（由 RPC 创建），这是正常的，不需要报错
      if (!associationError.message?.includes('duplicate') && !associationError.code?.includes('23505')) {
        console.warn('Failed to create user_space association:', associationError);
      }
    }

    // 设置当前空间和用户名
    const updateData: { current_space_id: string; name?: string } = {
      current_space_id: spaceId,
    };
    if (userName && userName.trim()) {
      updateData.name = userName.trim();
    }
    const { error: setCurrentError } = await supabase()
      .from('users')
      .update(updateData)
      .eq('id', authData.user!.id);  // 使用 ! 断言，因为已经检查过 authData.user 不为 null

    if (setCurrentError) {
      console.warn('Failed to set current_space_id/name:', setCurrentError);
    }

    const user: User = {
      id: authData.user!.id,  // 使用 ! 断言，因为已经检查过 authData.user 不为 null
      email: email,
      name: userName && userName.trim() ? userName.trim() : undefined,
      spaceId: spaceId,
      currentSpaceId: spaceId,
    };

    return { user, error: null };
  } catch (error) {
    console.error('Error signing up:', error);
    return {
      user: null,
      error: error instanceof Error ? error : new Error('注册失败'),
    };
  }
}

// 登录
export async function signIn(email: string, password: string): Promise<{ error: Error | null }> {
  try {
    // 验证 Supabase 配置
    const config = validateConfig();
    if (!config.valid) {
      return {
        error: new Error(
          '网络配置错误：Supabase 未正确配置。\n\n' +
          '请在 EAS Secrets 中设置：\n' +
          '- EXPO_PUBLIC_SUPABASE_URL\n' +
          '- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n' +
          '然后重新构建应用。'
        ),
      };
    }

    const { error } = await supabase().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // 提供更友好的错误消息
      if (error.message?.includes('Email not confirmed') || error.message?.includes('email_not_confirmed')) {
        throw new Error('Email not confirmed: Please check your email and click the confirmation link.\n\nIf in development environment, you can disable email confirmation in Supabase Dashboard.');
      }
      throw error;
    }

    // 登录成功后，确保 users 表中有用户记录
    // 这对于邮箱确认后首次登录的用户很重要
    try {
      const { data: { user: authUser } } = await supabase().auth.getUser();
      if (authUser) {
        const { data: existingUser } = await supabase()
          .from('users')
          .select('id')
          .eq('id', authUser.id)
          .maybeSingle();
        
        // 如果不存在，创建用户记录
        if (!existingUser) {
          // 尝试从 user_metadata 中获取用户名（注册时通过 data 参数传递）
          const userNameFromMetadata = authUser.user_metadata?.name;
          const userName = userNameFromMetadata || authUser.email?.split('@')[0] || 'User';
          
          const { error: insertError } = await supabase()
            .from('users')
            .insert({
              id: authUser.id,
              email: authUser.email || '',
              name: userName,
              current_space_id: null,
            });
          
          if (insertError) {
            // 如果是重复键错误（用户已存在），静默忽略
            // 检查错误代码（可能是字符串）和错误消息
            const errorCode = String(insertError.code || '');
            const isDuplicateKey = errorCode === '23505' || 
                                   insertError.message?.includes('duplicate key') ||
                                   insertError.message?.includes('unique constraint');
            
            if (isDuplicateKey) {
              // 用户记录已存在，这是正常的（可能是并发创建），完全静默，不记录任何日志
              // 什么都不做，直接继续
            } else {
              // 其他错误才记录
              console.error('Error creating user record after login:', insertError);
              console.error('Error details:', {
                code: insertError.code,
                message: insertError.message,
                details: insertError.details,
                hint: insertError.hint,
              });
            }
            // 即使创建失败，也继续登录流程（getCurrentUser 会再次尝试创建）
          }
        }
      }
    } catch (error) {
      console.error('Error ensuring user record exists after login:', error);
      // 即使出错，也继续登录流程（getCurrentUser 会再次尝试创建）
    }

    return { error: null };
  } catch (error) {
    console.error('Error signing in:', error);
    return {
      error: error instanceof Error ? error : new Error('登录失败'),
    };
  }
}

// 登出
export async function signOut(): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase().auth.signOut();
    if (error) throw error;
    
    // 清除缓存
    const { clearAuthCache } = await import('./auth-cache');
    clearAuthCache();
    
    return { error: null };
  } catch (error) {
    console.error('Error signing out:', error);
    return {
      error: error instanceof Error ? error : new Error('登出失败'),
    };
  }
}

// 检查是否已登录
export async function isAuthenticated(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase().auth.getSession();
    return !!session;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
}

// 发送密码重置邮件
export async function resetPassword(email: string): Promise<{ error: Error | null }> {
  try {
    // 验证 Supabase 配置
    const config = validateConfig();
    if (!config.valid) {
      return {
        error: new Error(
          '网络配置错误：Supabase 未正确配置。\n\n' +
          '请在 EAS Secrets 中设置：\n' +
          '- EXPO_PUBLIC_SUPABASE_URL\n' +
          '- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n' +
          '然后重新构建应用。'
        ),
      };
    }

    // 构建重置密码的重定向 URL
    // Web：使用当前页面 origin，否则 Supabase 会拒绝未在白名单的 redirectTo
    const redirectUrl = getPlatformAuthConfig().emailRedirectTo || resolveRedirectTo() || 'exp://localhost:8081/--/auth/confirm';

    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    if (error) {
      throw error;
    }

    return { error: null };
  } catch (error) {
    console.error('Error resetting password:', error);
    const message = error instanceof Error ? error.message : String((error as any)?.message ?? '');
    return {
      error: error instanceof Error ? error : new Error(message || '发送密码重置邮件失败'),
    };
  }
}

// 更新密码（用于密码重置后设置新密码）
export async function updatePassword(newPassword: string): Promise<{ error: Error | null }> {
  try {
    // 验证 Supabase 配置
    const config = validateConfig();
    if (!config.valid) {
      return {
        error: new Error(
          '网络配置错误：Supabase 未正确配置。\n\n' +
          '请在 EAS Secrets 中设置：\n' +
          '- EXPO_PUBLIC_SUPABASE_URL\n' +
          '- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n' +
          '然后重新构建应用。'
        ),
      };
    }

    const { error } = await supabase().auth.updateUser({
      password: newPassword,
    });

    if (error) {
      throw error;
    }

    return { error: null };
  } catch (error) {
    console.error('Error updating password:', error);
    return {
      error: error instanceof Error ? error : new Error('更新密码失败'),
    };
  }
}
