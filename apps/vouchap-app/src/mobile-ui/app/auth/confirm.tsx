import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams, useGlobalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';

function authConfirmDevLog(message: string, extra?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (extra) console.log('[auth/confirm]', message, extra);
    else console.log('[auth/confirm]', message);
  }
}

// 根据认证类型返回对应的成功消息和跳转路径
function getSuccessConfig(type: string | undefined): { message: string; redirect: string } {
  switch (type) {
    case 'recovery':
      return {
        message: 'Password reset verified! Redirecting to set new password...',
        redirect: '/set-password',
      };
    case 'invite':
      return {
        message: 'Email verified! Complete your profile to continue.',
        redirect: '/register?fromInvite=1',
      };
    case 'email_change':
      return {
        message: 'Email changed successfully! Redirecting...',
        redirect: '/login',
      };
    case 'signup':
    default:
      return {
        message: 'Email confirmed successfully! Redirecting to sign in...',
        redirect: '/login',
      };
  }
}

// 根据认证类型返回对应的验证中消息
function getVerifyingMessage(type: string | undefined): string {
  switch (type) {
    case 'recovery':
      return 'Verifying password reset link...';
    case 'invite':
      return 'Processing invitation...';
    case 'email_change':
      return 'Confirming email change...';
    case 'signup':
    default:
      return 'Verifying your email...';
  }
}

export default function EmailConfirmScreen() {
  const router = useRouter();
  const localParams = useLocalSearchParams<{ token_hash?: string; type?: string; access_token?: string }>();
  const globalParams = useGlobalSearchParams<{ token_hash?: string; type?: string; access_token?: string }>();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying...');
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  useEffect(() => {
    handleEmailConfirmation();
  }, []);

  const handleEmailConfirmation = async () => {
    try {
      // Supabase 的邮箱确认和密码重置链接会在 URL 中包含参数
      // 可能通过查询参数 (token_hash, type) 或 hash fragment (access_token, type) 传递
      
      // 尝试从查询参数中获取
      let token_hash = localParams.token_hash || globalParams.token_hash;
      let type = (localParams.type || globalParams.type) as any;
      let access_token = localParams.access_token || globalParams.access_token;
      
      // 根据类型更新验证中消息
      if (type) {
        setMessage(getVerifyingMessage(type));
      }

      // 如果没有从查询参数获取到，尝试从 URL hash 中解析
      if (!token_hash && !access_token) {
        try {
          // 先尝试获取当前 URL（如果应用已经打开）
          const url = await Linking.getInitialURL();
          if (url) {
            authConfirmDevLog('Parsing deep link', {
              hasQuery: url.includes('?'),
              hasHash: url.includes('#'),
            });
            const parsed = Linking.parse(url);
            // 检查 hash fragment（Supabase 通常在这里传递 access_token）
            if (parsed.fragment) {
              const fragmentParams = new URLSearchParams(parsed.fragment);
              access_token = fragmentParams.get('access_token') || undefined;
              type = (fragmentParams.get('type') || type) as any;
              authConfirmDevLog('Found in fragment', { access_token: access_token ? 'present' : 'missing', type });
            }
            // 也检查查询参数
            if (parsed.queryParams) {
              token_hash = (parsed.queryParams.token_hash as string) || token_hash;
              type = ((parsed.queryParams.type as string) || type) as any;
              access_token = (parsed.queryParams.access_token as string) || access_token;
              authConfirmDevLog('Found in queryParams', { token_hash: token_hash ? 'present' : 'missing', type });
            }
          }
          
          // 如果还是没有，尝试监听 URL 变化（适用于应用已打开的情况）
          if (!token_hash && !access_token) {
            const subscription = Linking.addEventListener('url', (event) => {
              authConfirmDevLog('URL event received', {
                hasHash: event.url.includes('#'),
                hasTokenParam: event.url.includes('token_hash') || event.url.includes('access_token'),
              });
              const parsed = Linking.parse(event.url);
              if (parsed.fragment) {
                const fragmentParams = new URLSearchParams(parsed.fragment);
                access_token = fragmentParams.get('access_token') || undefined;
                type = (fragmentParams.get('type') || type) as any;
              }
              if (parsed.queryParams) {
                token_hash = (parsed.queryParams.token_hash as string) || token_hash;
                type = ((parsed.queryParams.type as string) || type) as any;
                access_token = (parsed.queryParams.access_token as string) || access_token;
              }
              subscription.remove();
              if (access_token || token_hash) {
                handleEmailConfirmation();
              }
            });
            
            // 等待一小段时间让 URL 事件触发
            setTimeout(() => {
              subscription.remove();
            }, 2000);
          }
        } catch (linkError) {
          authConfirmDevLog('Error parsing URL', { error: String(linkError) });
        }
      }

      // 如果有 access_token，说明 Supabase 已经处理了认证，直接设置 session
      if (access_token) {
        try {
          // 尝试从当前 URL 获取完整的 hash fragment
          let url = await Linking.getInitialURL();
          if (!url) {
            // 如果 getInitialURL 返回 null，尝试等待一下再获取
            await new Promise(resolve => setTimeout(resolve, 500));
            url = await Linking.getInitialURL();
          }
          
          if (url) {
            authConfirmDevLog('Processing session from deep link');
            const parsed = Linking.parse(url);
            const hashFragment = parsed.fragment;
            
            // 解析 hash fragment 获取 refresh_token
            let refresh_token: string | undefined;
            if (hashFragment) {
              const fragmentParams = new URLSearchParams(hashFragment);
              refresh_token = fragmentParams.get('refresh_token') || undefined;
              type = (fragmentParams.get('type') || type) as any;
              authConfirmDevLog('Extracted from fragment', {
                hasRefreshToken: !!refresh_token,
                type,
              });
            }

            // 使用 access_token 和 refresh_token 设置 session
            if (refresh_token) {
              const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });

              if (sessionError) {
                console.error('Session error:', sessionError);
                throw sessionError;
              }

              if (sessionData?.user) {
                authConfirmDevLog('Session set successfully');
                // Session 设置成功，确保 users 表中有用户记录
                await ensureUserRecord(sessionData.user);
                
                setStatus('success');
                const { message: successMessage, redirect } = getSuccessConfig(type);
                setMessage(successMessage);
                setRedirectTo(redirect);
                return;
              } else {
                console.error('Session data missing user');
              }
            } else {
              console.error('Refresh token missing from URL fragment');
            }
          } else {
            console.error('Could not get URL for session setup');
          }
        } catch (sessionError) {
          console.error('Error setting session:', sessionError);
          // 即使 session 设置失败，也尝试继续处理
        }
      }

      // 如果有 token_hash，使用 verifyOtp 方法（旧的方式）
      if (token_hash) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type || 'email',
        });

        if (error) {
          authConfirmDevLog('Auth link expired or already used');
          setStatus('error');
          setMessage('This link has expired or has already been used. Please request a new link.');
          setRedirectTo('/login');
          return;
        }

        if (data?.user) {
          await ensureUserRecord(data.user);
          setStatus('success');
          const { message: successMessage, redirect } = getSuccessConfig(type);
          setMessage(successMessage);
          setRedirectTo(redirect);
          return;
        }
      }

      // 如果以上方法都失败，尝试等待 URL 参数加载
      // 这可能是首次打开应用，URL 参数还没有加载完成
      if (!token_hash && !access_token) {
        // 等待一小段时间后再试
        setTimeout(async () => {
          const url = await Linking.getInitialURL();
          authConfirmDevLog('Retry URL check', {
            hasTokens: !!(url && (url.includes('access_token') || url.includes('token_hash'))),
          });
          if (url && (url.includes('access_token') || url.includes('token_hash'))) {
            // 重新解析 URL
            const parsed = Linking.parse(url);
            let retryTokenHash: string | undefined;
            let retryType: any;
            let retryAccessToken: string | undefined;
            
            if (parsed.fragment) {
              const fragmentParams = new URLSearchParams(parsed.fragment);
              retryAccessToken = fragmentParams.get('access_token') || undefined;
              retryType = fragmentParams.get('type') || type;
            }
            if (parsed.queryParams) {
              retryTokenHash = (parsed.queryParams.token_hash as string) || undefined;
              retryType = (parsed.queryParams.type as string) || retryType || type;
              retryAccessToken = (parsed.queryParams.access_token as string) || retryAccessToken;
            }
            
            // 如果找到了参数，更新变量并重新处理
            if (retryAccessToken || retryTokenHash) {
              token_hash = retryTokenHash;
              access_token = retryAccessToken;
              type = retryType;
              // 重新执行处理逻辑
              handleEmailConfirmation();
              return;
            }
          }
          
          setStatus('error');
          setMessage('This link has expired or has already been used. Please request a new link.');
          setRedirectTo('/login');
        }, 1500);
        return;
      }

      setStatus('error');
      setMessage('This link has expired or has already been used. Please request a new link.');
      setRedirectTo('/login');
    } catch (error) {
      authConfirmDevLog('Auth confirm error', { error: String(error) });
      setStatus('error');
      setMessage('This link has expired or has already been used. Please request a new link.');
      setRedirectTo('/login');
    }
  };

  // 确保 users 表中有用户记录
  const ensureUserRecord = async (user: any) => {
    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      
      if (!existingUser) {
        const userNameFromMetadata = user.user_metadata?.name;
        const userName = userNameFromMetadata || user.email?.split('@')[0] || 'User';
        
        const { error: insertError } = await supabase
          .from('users')
          .insert({
            id: user.id,
            email: user.email || '',
            name: userName,
            current_space_id: null,
          });
        
        if (insertError) {
          console.error('Error creating user record:', insertError);
        } else {
          authConfirmDevLog('User record created successfully');
        }
      }
    } catch (error) {
      console.error('Error ensuring user record exists:', error);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        {status === 'verifying' && (
          <>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.message}>{message}</Text>
          </>
        )}
        {status === 'success' && redirectTo && (
          <>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => router.replace(redirectTo as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.continueButtonText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}
        {status === 'error' && redirectTo && (
          <>
            <Text style={styles.errorIcon}>✗</Text>
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => router.replace(redirectTo as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.continueButtonText}>Go to Login</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  message: {
    fontSize: 16,
    color: '#2D3436',
    textAlign: 'center',
    marginTop: 20,
  },
  successIcon: {
    fontSize: 64,
    color: '#00B894',
    marginBottom: 20,
  },
  errorIcon: {
    fontSize: 64,
    color: '#E74C3C',
    marginBottom: 20,
  },
  continueButton: {
    marginTop: 24,
    backgroundColor: '#6C5CE7',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});

