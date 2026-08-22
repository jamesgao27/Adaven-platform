import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  getSpaceMembers,
  SpaceMember,
  getCurrentUser,
  getPlatformClient,
  createInvitation,
  getSpaceInvitations,
  cancelInvitation,
  SpaceInvitation,
} from '@adaven/platform-core';
import { GradientText } from '../lib/GradientText';
import { showToast } from '../lib/toast';
import { confirmDestructive } from '../lib/alertWeb';

export default function SpaceMembersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<SpaceInvitation[]>([]);
  const [declinedInvitations, setDeclinedInvitations] = useState<SpaceInvitation[]>([]);
  const [cancelledInvitations, setCancelledInvitations] = useState<SpaceInvitation[]>([]);
  const [removedInvitations, setRemovedInvitations] = useState<SpaceInvitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCurrentUserAdmin, setIsCurrentUserAdmin] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    loadMembers();
  }, []);

  // 加载并分类邀请列表的通用函数
  const loadAndClassifyInvitations = async (user: any, spaceId: string) => {
    console.log('Loading invitations for space:', spaceId);
    const invitations = await getSpaceInvitations(spaceId);
    console.log('Loaded invitations:', invitations.length, invitations);
    
    // 获取当前空间的所有成员邮箱
    const { data: existingMembers } = await getPlatformClient()
      .from('user_spaces')
      .select('user_id')
      .eq('space_id', spaceId);
    
    const existingUserIds = new Set(existingMembers?.map(m => m.user_id) || []);
    console.log('Existing member IDs:', Array.from(existingUserIds));
    
    // 获取用户邮箱映射
    // 注意：不直接查询 users 表，因为 RLS 策略可能阻止查询
    // 改为使用 RPC 函数或从 auth.users 获取
    let userEmailMap = new Map<string, string>();
    if (existingUserIds.size > 0) {
      try {
        // 尝试使用 RPC 函数获取用户信息
        const { data: usersData, error: rpcError } = await getPlatformClient().rpc('get_space_member_users', {
          p_space_id: spaceId
        });
        
        if (!rpcError && usersData && Array.isArray(usersData)) {
          usersData.forEach((u: any) => {
            if (u.email && u.id) {
              userEmailMap.set(u.email.toLowerCase(), u.id);
            }
          });
        } else {
          // RPC 函数失败，尝试从邀请记录中获取邮箱（如果可用）
          // 或者静默处理，不阻塞功能
          console.log('RPC function failed, skipping user email map:', rpcError);
        }
      } catch (err) {
        // 静默处理错误，不阻塞功能
        console.log('Error getting user emails:', err);
      }
    }
    
    // 先按email去重，每个email只保留最新的邀请记录
    const emailToLatestInvitation = new Map<string, SpaceInvitation>();
    invitations.forEach(inv => {
      const email = inv.inviteeEmail.toLowerCase();
      const existing = emailToLatestInvitation.get(email);
      if (!existing || new Date(inv.createdAt) > new Date(existing.createdAt)) {
        emailToLatestInvitation.set(email, inv);
      }
    });
    
    // 分类邀请
    const pending: SpaceInvitation[] = [];
    const declined: SpaceInvitation[] = [];
    const cancelled: SpaceInvitation[] = [];
    const removed: SpaceInvitation[] = [];
    
    emailToLatestInvitation.forEach(inv => {
      const inviteeEmail = inv.inviteeEmail.toLowerCase();
      const userId = userEmailMap.get(inviteeEmail);
      const isMember = userId && existingUserIds.has(userId);
      
      // 根据邀请状态分类，不要根据 isMember 推断状态
      if (inv.status === 'pending') {
        // 如果用户已经是成员，不显示pending邀请
        if (!isMember) {
          pending.push(inv);
        }
      } else if (inv.status === 'declined') {
        // 被邀请者拒绝的
        declined.push(inv);
      } else if (inv.status === 'cancelled') {
        // 管理员取消的
        cancelled.push(inv);
      } else if (inv.status === 'removed') {
        // 成员被移除的（只有明确标记为 removed 才显示）
        removed.push(inv);
      } else if (inv.status === 'accepted') {
        // 已接受的邀请：如果用户还在成员列表中，不显示；如果不在，可能是数据不一致，也不显示为 removed
        // 注意：不要将 accepted 状态误判为 removed，只有明确标记为 removed 才显示
        // 如果用户不在成员列表中但状态是 accepted，可能是：
        // 1. 用户被移除了但邀请状态未更新（数据不一致）
        // 2. RLS 策略问题导致查询不到用户
        // 为了安全，不显示这些邀请，避免误判
        // 如果确实需要显示，应该先更新邀请状态为 'removed'
      }
    });
    
    console.log('Classified invitations:', {
      pending: pending.length,
      declined: declined.length,
      cancelled: cancelled.length,
      removed: removed.length,
    });
    
    setPendingInvitations(pending);
    setDeclinedInvitations(declined);
    setCancelledInvitations(cancelled);
    setRemovedInvitations(removed);
  };

  // 只加载成员列表
  const loadMembersOnly = async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        setCurrentUserId(user.id);
      }
      const data = await getSpaceMembers();
      setMembers(data);
      
      // 检查当前用户是否是管理员
      const currentUserMember = data.find(m => m.userId === user?.id);
      const isAdmin = currentUserMember?.isAdmin || false;
      setIsCurrentUserAdmin(isAdmin);
      
      return { user, isAdmin };
    } catch (error) {
      console.error('Error loading space members:', error);
      throw error;
    }
  };

  // 只加载邀请列表
  const loadInvitationsOnly = async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      
      const spaceId = user.currentSpaceId || user.spaceId;
      if (!spaceId) return;
      
      await loadAndClassifyInvitations(user, spaceId);
    } catch (error) {
      console.error('Error loading invitations:', error);
      // 不显示错误提示，因为这是增量更新
    }
  };

  // 加载所有数据（初始加载使用）
  const loadMembers = async () => {
    try {
      setLoading(true);
      const { user, isAdmin } = await loadMembersOnly();
      
      // 如果是管理员，加载邀请列表
      if (isAdmin && user) {
        const spaceId = user.currentSpaceId || user.spaceId;
        if (spaceId) {
          await loadAndClassifyInvitations(user, spaceId);
        }
      }
    } catch (error) {
      console.error('Error loading space members:', error);
      showToast('Failed to load space members', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatDateShort = (dateString: string | null) => {
    if (!dateString) return 'Never';
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
          const diffMins = Math.floor(diffMs / (1000 * 60));
          if (diffMins < 1) return 'Just now';
          return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
        }
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
      } else {
        return date.toLocaleDateString();
      }
    } catch {
      return 'Unknown';
    }
  };

  const getDisplayName = (member: SpaceMember) => {
    // 优先使用自定义名字，如果没有则使用邮箱前缀
    if (member.name && member.name.trim()) {
      return member.name.trim();
    }
    const emailPrefix = member.email.split('@')[0];
    return emailPrefix || 'Unknown';
  };

  const handleCancelInvitation = (invitationId: string) => {
    confirmDestructive(
      'Cancel Invitation',
      'Are you sure you want to cancel this invitation?',
      async () => {
        try {
          const { error } = await cancelInvitation(invitationId);
          if (error) {
            showToast(error.message || 'Failed to cancel invitation', 'error');
          } else {
            loadInvitationsOnly();
          }
        } catch (error) {
          console.error('Error cancelling invitation:', error);
          showToast('Failed to cancel invitation', 'error');
        }
      },
      { confirmLabel: 'Yes, Cancel' }
    );
  };

  const handleReinvite = async (email: string) => {
    setInviteEmail(email);
    setShowInviteModal(true);
  };

  const handleInvite = () => {
    setInviteEmail('');
    setShowInviteModal(true);
  };

  const handleSendInvitation = async () => {
    if (!inviteEmail.trim()) {
      showToast('Please enter an email address', 'error');
      return;
    }

    // 简单的邮箱验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail.trim())) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    const emailToInvite = inviteEmail.trim();
    
    // 立即添加到pending列表，显示loading状态
    const tempInvitation: SpaceInvitation = {
      id: `temp-${Date.now()}`,
      spaceId: '', // 将在加载时填充
      inviterId: '',
      inviteeEmail: emailToInvite,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    
    setPendingInvitations(prev => [...prev, tempInvitation]);
    setShowInviteModal(false);
    setInviteEmail('');
    setInviting(true);

    // 创建邀请
    const { invitation, error } = await createInvitation(emailToInvite);
    setInviting(false);

    if (error) {
      // 如果失败，从列表中移除临时项
      setPendingInvitations(prev => prev.filter(inv => inv.id !== tempInvitation.id));
      showToast(error.message || 'Failed to send invitation', 'error');
    } else {
      // 成功：移除临时项，然后加载最新邀请列表（这会用真实的邀请数据替换）
      setPendingInvitations(prev => prev.filter(inv => inv.id !== tempInvitation.id));
      loadInvitationsOnly(); // 加载真实的邀请数据
    }
  };

  const handleRemoveMember = async (member: SpaceMember) => {
    confirmDestructive(
      'Remove Member',
      `Are you sure you want to remove ${getDisplayName(member)} from this space?`,
      async () => {
            try {
              const user = await getCurrentUser();
              if (!user) return;
              
              const spaceId = user.currentSpaceId || user.spaceId;
              const memberUserId = member.userId;
              
              // 步骤1：从user_spaces表中移除关联数据
              // 优先使用 RPC 函数删除（绕过 RLS）
              let deleteSuccess = false;
              
              try {
                const { data: rpcResult, error: rpcError } = await getPlatformClient().rpc('remove_space_member', {
                  p_target_user_id: memberUserId,
                  p_space_id: spaceId
                });
                
                if (rpcError) {
                  // RPC 函数不存在或失败，回退到直接删除
                  console.log('RPC function failed, falling back to direct delete:', rpcError);
                  const { error: deleteError } = await getPlatformClient()
                    .from('user_spaces')
                    .delete()
                    .eq('user_id', memberUserId)
                    .eq('space_id', spaceId);
                  
                  if (deleteError) {
                    console.error('Error deleting user_spaces (direct delete):', deleteError);
                    throw new Error(`Failed to remove member: ${deleteError.message || 'RLS policy may not allow DELETE operation. Please execute fix-user-spaces-delete-policy.sql in Supabase SQL Editor.'}`);
                  } else {
                    deleteSuccess = true;
                  }
                } else {
                  deleteSuccess = true;
                  console.log('Successfully removed member via RPC');
                }
              } catch (deleteErr: any) {
                console.error('Error in member removal step:', deleteErr);
                throw deleteErr;
              }
              
              if (!deleteSuccess) {
                throw new Error('Failed to remove member from space');
              }
              
              // 步骤2：更新对应的邀请记录的状态为'removed'
              // 查找所有与该成员相关的邀请记录（通过邮箱匹配）
              try {
                const { data: invitations, error: queryError } = await getPlatformClient()
                  .from('space_invitations')
                  .select('id, invitee_email, status')
                  .eq('space_id', spaceId)
                  .eq('invitee_email', member.email.toLowerCase().trim());
                
                if (queryError) {
                  console.warn('Error querying invitations for update:', queryError);
                } else if (invitations && invitations.length > 0) {
                  // 更新所有相关的邀请记录状态为'removed'
                  const invitationIds = invitations
                    .filter(inv => inv.status === 'accepted' || inv.status === 'pending')
                    .map(inv => inv.id);
                  
                  if (invitationIds.length > 0) {
                    // 优先使用 RPC 函数批量更新邀请状态（绕过 RLS 和 CHECK 约束）
                    const { data: rpcResult, error: rpcError } = await getPlatformClient().rpc('update_invitations_status_batch', {
                      p_invitation_ids: invitationIds,
                      p_new_status: 'removed'
                    });
                    
                    if (rpcError) {
                      // RPC 函数不存在或失败，回退到直接更新
                      console.log('RPC function failed, falling back to direct update:', rpcError);
                      const { error: updateInvitationError, data: updatedInvitations } = await getPlatformClient()
                        .from('space_invitations')
                        .update({ status: 'removed' })
                        .in('id', invitationIds)
                        .select();
                      
                      if (updateInvitationError) {
                        console.error('Error updating invitation status to removed (direct update):', updateInvitationError);
                        // 如果直接更新也失败，可能是数据库约束问题，尝试使用 'cancelled' 作为备选
                        const { error: fallbackError, data: fallbackData } = await getPlatformClient()
                          .from('space_invitations')
                          .update({ status: 'cancelled' })
                          .in('id', invitationIds)
                          .select();
                        
                        if (fallbackError) {
                          console.error('Error updating invitation status to cancelled (fallback):', fallbackError);
                          // 即使备选方案也失败，继续执行其他步骤，不阻塞整个流程
                          showToast('Failed to update invitation status. Please execute update-invitation-status-rpc.sql in Supabase SQL Editor.', 'info');
                        } else {
                          console.log('Updated invitation status to cancelled (fallback):', fallbackData?.length || 0, 'invitations');
                          showToast('Updated invitation status to "cancelled" instead of "removed". Please execute update-invitation-status-rpc.sql to support "removed" status.', 'info');
                        }
                      } else {
                        console.log('Successfully updated invitation status to removed (direct update):', updatedInvitations?.length || 0, 'invitations');
                      }
                    } else {
                      console.log('Successfully updated invitation status to removed via RPC:', rpcResult || 0, 'invitations');
                    }
                  }
                }
              } catch (invitationError: any) {
                console.error('Error in invitation update step:', invitationError);
                // 捕获所有错误，继续执行其他步骤，不阻塞整个流程
                showToast(`Failed to update invitation status: ${invitationError?.message || 'Unknown error'}. Member removed, but invitation status may not be updated.`, 'info');
              }
              
              // 步骤3：如果被删成员的current_space_id与当前space相同，则清空该字段
              // 尝试使用RPC函数更新（即使无法获取用户信息，也尝试直接更新）
              const { error: rpcUpdateError } = await getPlatformClient().rpc('update_user_current_space', {
                p_user_id: memberUserId,
                p_space_id: null,
              });
              
              if (rpcUpdateError) {
                // RPC函数不存在或失败，回退到直接更新（使用条件更新，只有current_space_id匹配时才更新）
                console.log('RPC function failed, falling back to direct update:', rpcUpdateError);
                const { error: updateError } = await getPlatformClient()
                  .from('users')
                  .update({ current_space_id: null })
                  .eq('id', memberUserId)
                  .eq('current_space_id', spaceId);
                
                if (updateError) {
                  console.error('Error clearing current_space_id:', updateError);
                  // 不抛出错误，继续执行（因为可能由于RLS限制无法更新）
                }
              }
              
              // 删除成功后，立即从状态中移除该成员（乐观更新）
              setMembers(prev => prev.filter(m => m.userId !== memberUserId));
              
              // 重新加载成员列表和邀请列表以确保数据一致性
              await Promise.all([
                loadMembersOnly(),
                loadInvitationsOnly()
              ]);
            } catch (error: any) {
              console.error('Error removing member:', error);
              showToast(error?.message || 'Failed to remove member', 'error');
              try {
                await loadMembersOnly();
                await loadInvitationsOnly();
              } catch (reloadError) {
                console.error('Error reloading members after removal failure:', reloadError);
              }
            }
      },
      { confirmLabel: 'Remove' }
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <GradientText
            text="Track by member, analyze as a team."
            style={styles.headerTitle}
            containerStyle={styles.gradientTextContainer}
          />
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* 成员组：自己和已加入成员 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          {loading ? (
            <View style={styles.compactList}>
              <View style={[styles.compactItem, styles.compactItemLast]}>
                <View style={styles.compactItemContent}>
                  <View style={styles.compactNameEmail}>
                    <View style={styles.loadingPlaceholder}>
                      <ActivityIndicator size="small" color="#6C5CE7" />
                      <Text style={styles.compactName}>Loading...</Text>
                    </View>
                    <View style={[styles.loadingPlaceholder, { width: 150 }]}>
                      <Text style={styles.compactEmail}>Loading...</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ) : members.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={40} color="#95A5A6" />
              <Text style={styles.emptyStateText}>No Members</Text>
            </View>
          ) : (
            <View style={styles.compactList}>
              {members.map((member, index) => {
                const isCurrentUser = member.userId === currentUserId;
                const isLast = index === members.length - 1;
                return (
                  <View key={member.userId} style={[styles.compactItem, isLast && styles.compactItemLast]}>
                    <View style={styles.compactItemContent}>
                      <View style={styles.compactNameEmail}>
                        <Text style={styles.compactName}>{getDisplayName(member)}</Text>
                        <Text style={styles.compactEmail}>{member.email}</Text>
                      </View>
                      <View style={styles.compactBadges}>
                        {isCurrentUser && (
                          <View style={styles.compactBadge}>
                            <Text style={styles.compactBadgeText}>You</Text>
                          </View>
                        )}
                        {member.isAdmin && (
                          <View style={[styles.compactBadge, styles.adminBadgeCompact]}>
                            <Text style={[styles.compactBadgeText, styles.adminBadgeTextCompact]}>Admin</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {isCurrentUserAdmin && !isCurrentUser && (
                      <TouchableOpacity
                        style={styles.compactRemoveButton}
                        onPress={() => handleRemoveMember(member)}
                      >
                        <Ionicons name="trash-outline" size={20} color="#E74C3C" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* 管理员看到的邀请组：待同意、已拒绝、已撤回、已移除 */}
        {isCurrentUserAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Invitations</Text>
            <View style={styles.compactList}>
              {/* 邀请成员按钮 - 放在列表首位 */}
              <TouchableOpacity
                style={[styles.compactItem, (pendingInvitations.length === 0 && declinedInvitations.length === 0 && cancelledInvitations.length === 0 && removedInvitations.length === 0) && styles.compactItemLast]}
                onPress={handleInvite}
              >
                <View style={styles.compactItemContent}>
                  <View style={[styles.compactNameEmail, { flexDirection: 'row', alignItems: 'center' }]}>
                    <Ionicons name="person-add-outline" size={20} color="#6C5CE7" style={{ marginRight: 8 }} />
                    <Text style={[styles.compactName, { color: '#6C5CE7', marginBottom: 0 }]}>Invite Member</Text>
                  </View>
                </View>
              </TouchableOpacity>
              {/* 待同意邀请 */}
              {pendingInvitations.map((invitation, index) => {
                const totalPending = pendingInvitations.length;
                const totalDeclined = declinedInvitations.length;
                const totalCancelled = cancelledInvitations.length;
                const totalRemoved = removedInvitations.length;
                const isLast = index === totalPending - 1 && totalDeclined === 0 && totalCancelled === 0 && totalRemoved === 0;
                const isTemp = invitation.id.startsWith('temp-');
                return (
                <View key={invitation.id} style={[styles.compactItem, isLast && styles.compactItemLast]}>
                  <View style={styles.compactItemContent}>
                    <Text style={styles.compactEmail}>{invitation.inviteeEmail}</Text>
                    <View style={styles.compactBadges}>
                      {isTemp && inviting ? (
                        <View style={[styles.compactBadge, styles.pendingBadge, { flexDirection: 'row', alignItems: 'center' }]}>
                          <ActivityIndicator size="small" color="#4CAF50" style={{ marginRight: 4 }} />
                          <Text style={[styles.compactBadgeText, styles.pendingBadgeText]}>Sending...</Text>
                        </View>
                      ) : (
                        <View style={[styles.compactBadge, styles.pendingBadge]}>
                          <Text style={[styles.compactBadgeText, styles.pendingBadgeText]}>Pending</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {!isTemp && (
                    <TouchableOpacity
                      style={styles.compactActionButton}
                      onPress={() => handleCancelInvitation(invitation.id)}
                    >
                      <Ionicons name="close-circle-outline" size={20} color="#636E72" />
                    </TouchableOpacity>
                  )}
                </View>
                );
              })}
              {/* 已拒绝邀请 */}
              {declinedInvitations.map((invitation, index) => {
                const totalDeclined = declinedInvitations.length;
                const totalCancelled = cancelledInvitations.length;
                const totalRemoved = removedInvitations.length;
                const isLast = index === totalDeclined - 1 && totalCancelled === 0 && totalRemoved === 0;
                return (
                <View key={invitation.id} style={[styles.compactItem, styles.cancelledItem, isLast && styles.compactItemLast]}>
                  <View style={styles.compactItemContent}>
                    <Text style={[styles.compactEmail, styles.cancelledText]}>{invitation.inviteeEmail}</Text>
                    <View style={styles.compactBadges}>
                      <View style={[styles.compactBadge, styles.declinedBadge]}>
                        <Text style={[styles.compactBadgeText, styles.declinedBadgeText]}>Declined</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.compactActionButton}
                    onPress={() => handleReinvite(invitation.inviteeEmail)}
                  >
                    <Ionicons name="mail-outline" size={20} color="#6C5CE7" />
                  </TouchableOpacity>
                </View>
                );
              })}
              {/* 已撤回邀请 */}
              {cancelledInvitations.map((invitation, index) => {
                const totalCancelled = cancelledInvitations.length;
                const totalRemoved = removedInvitations.length;
                const isLast = index === totalCancelled - 1 && totalRemoved === 0;
                return (
                <View key={invitation.id} style={[styles.compactItem, styles.cancelledItem, isLast && styles.compactItemLast]}>
                  <View style={styles.compactItemContent}>
                    <Text style={[styles.compactEmail, styles.cancelledText]}>{invitation.inviteeEmail}</Text>
                    <View style={styles.compactBadges}>
                      <View style={[styles.compactBadge, styles.cancelledBadge]}>
                        <Text style={[styles.compactBadgeText, styles.cancelledBadgeText]}>Cancelled</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.compactActionButton}
                    onPress={() => handleReinvite(invitation.inviteeEmail)}
                  >
                    <Ionicons name="mail-outline" size={20} color="#6C5CE7" />
                  </TouchableOpacity>
                </View>
                );
              })}
              {/* 已移除邀请 */}
              {removedInvitations.map((invitation, index) => {
                const isLast = index === removedInvitations.length - 1;
                return (
                <View key={invitation.id} style={[styles.compactItem, styles.cancelledItem, isLast && styles.compactItemLast]}>
                  <View style={styles.compactItemContent}>
                    <Text style={[styles.compactEmail, styles.cancelledText]}>{invitation.inviteeEmail}</Text>
                    <View style={styles.compactBadges}>
                      <View style={[styles.compactBadge, styles.removedBadge]}>
                        <Text style={[styles.compactBadgeText, styles.removedBadgeText]}>Removed</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.compactActionButton}
                    onPress={() => handleReinvite(invitation.inviteeEmail)}
                  >
                    <Ionicons name="mail-outline" size={20} color="#6C5CE7" />
                  </TouchableOpacity>
                </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 邀请对话框 */}
      <Modal
        visible={showInviteModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlayContent}>
              <TouchableWithoutFeedback>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Invite Member</Text>
                    <TouchableOpacity
                      onPress={() => setShowInviteModal(false)}
                      style={styles.modalCloseButton}
                    >
                      <Ionicons name="close" size={24} color="#636E72" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.modalScrollContent}
                  >
                    <Text style={styles.modalSubtitle}>
                      Enter the email address of the person you want to invite
                    </Text>
                    <View style={styles.modalInputContainer}>
                      <Ionicons name="mail-outline" size={20} color="#636E72" style={styles.modalInputIcon} />
                      <TextInput
                        style={styles.modalInput}
                        placeholder="Email address"
                        placeholderTextColor="#95A5A6"
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        editable={!inviting}
                      />
                    </View>
                  </ScrollView>
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => {
                        setShowInviteModal(false);
                        setInviteEmail('');
                      }}
                      disabled={inviting}
                    >
                      <Text style={styles.modalButtonCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonSend, inviting && styles.modalButtonDisabled]}
                      onPress={handleSendInvitation}
                      disabled={inviting}
                    >
                      {inviting ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.modalButtonSendText}>Send Invitation</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  gradientTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D3436',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 8,
  },
  section: {
    marginBottom: 24,
  },
  /** Match categories-manage `sectionLabel` (e.g. Expense categories) */
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 4,
    marginTop: 2,
  },
  compactList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    overflow: 'hidden',
  },
  compactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  compactItemLast: {
    borderBottomWidth: 0,
  },
  cancelledItem: {
    opacity: 0.7,
    backgroundColor: '#F8F9FA',
  },
  compactItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactNameEmail: {
    flex: 1,
    marginRight: 12,
  },
  compactName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 2,
  },
  compactEmail: {
    fontSize: 13,
    color: '#636E72',
  },
  loadingPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  compactBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  compactBadge: {
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  compactBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  adminBadgeCompact: {
    backgroundColor: '#FFF3E0',
  },
  adminBadgeTextCompact: {
    color: '#FF9800',
  },
  pendingBadge: {
    backgroundColor: '#E8F5E9',
  },
  pendingBadgeText: {
    color: '#4CAF50',
  },
  declinedBadge: {
    backgroundColor: '#F5F5F5',
  },
  declinedBadgeText: {
    color: '#95A5A6',
  },
  cancelledBadge: {
    backgroundColor: '#FFF3E0',
  },
  cancelledBadgeText: {
    color: '#FF9800',
  },
  removedBadge: {
    backgroundColor: '#FFEBEE',
  },
  removedBadgeText: {
    color: '#E74C3C',
  },
  compactRemoveButton: {
    padding: 4,
    marginLeft: 8,
  },
  compactActionButton: {
    padding: 4,
    marginLeft: 8,
  },
  membersList: {
    gap: 12,
  },
  invitationsList: {
    gap: 12,
  },
  invitationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  cancelledInvitationCard: {
    opacity: 0.7,
    backgroundColor: '#F8F9FA',
  },
  invitationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  invitationInfo: {
    flex: 1,
    marginLeft: 12,
  },
  invitationEmail: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 4,
  },
  invitationStatus: {
    fontSize: 14,
    color: '#6C5CE7',
    fontWeight: '500',
  },
  invitationStatusCancelled: {
    fontSize: 14,
    color: '#95A5A6',
    fontWeight: '500',
  },
  cancelledText: {
    color: '#95A5A6',
  },
  invitationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  invitationDate: {
    fontSize: 13,
    color: '#95A5A6',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E0E7FF',
    gap: 8,
  },
  inviteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalOverlayContent: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalScrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2D3436',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginBottom: 20,
  },
  modalInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  modalInputIcon: {
    marginRight: 12,
  },
  modalInput: {
    flex: 1,
    fontSize: 16,
    color: '#2D3436',
    paddingVertical: 0,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  modalButtonCancel: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#636E72',
  },
  modalButtonSend: {
    backgroundColor: '#6C5CE7',
  },
  modalButtonSendText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
});
