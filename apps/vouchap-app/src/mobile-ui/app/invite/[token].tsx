import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/lib/supabase';
import { getInvitationById } from '@/lib/space-invitations';

type NextAction = { pathname: string; params?: Record<string, string> };

export default function InviteByTokenScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; id?: string }>();
  const invitationId = params.token ?? params.id;
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [message, setMessage] = useState('Checking invitation...');
  const [nextAction, setNextAction] = useState<NextAction | null>(null);
  const [buttonLabel, setButtonLabel] = useState('Continue');

  useEffect(() => {
    handleInvitation();
  }, []);

  const handleInvitation = async () => {
    try {
      if (!invitationId) {
        setStatus('error');
        setMessage('Invalid invitation link. Please check your email and try again.');
        setNextAction({ pathname: '/login' });
        setButtonLabel('Go to Login');
        return;
      }

      const invitation = await getInvitationById(invitationId);
      if (!invitation) {
        setStatus('error');
        setMessage('Invitation not found or expired. Please request a new invitation.');
        setNextAction({ pathname: '/login' });
        setButtonLabel('Go to Login');
        return;
      }

      if (invitation.status !== 'pending') {
        setStatus('error');
        setMessage('This invitation has already been used or cancelled.');
        setNextAction({ pathname: '/login' });
        setButtonLabel('Go to Login');
        return;
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (authUser) {
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('id', authUser.id)
          .single();

        if (userData && userData.email.toLowerCase() === invitation.inviteeEmail.toLowerCase()) {
          setStatus('ready');
          setMessage('This invitation is for you. Continue to accept it.');
          setNextAction({ pathname: '/handle-invitations' });
          setButtonLabel('Continue');
          return;
        }

        setStatus('error');
        setMessage('This invitation is for a different email address. Please log out and sign in with the correct account.');
        setNextAction({ pathname: '/login', params: { email: invitation.inviteeEmail } });
        setButtonLabel('Go to Login');
        return;
      }

      const { data: existingUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', invitation.inviteeEmail.toLowerCase())
        .single();

      if (existingUser) {
        setStatus('ready');
        setMessage('You already have an account. Sign in to accept this invitation.');
        setNextAction({
          pathname: '/login',
          params: { inviteId: invitationId, email: invitation.inviteeEmail },
        });
        setButtonLabel('Sign in');
        return;
      }

      setStatus('ready');
      setMessage('Create an account to accept this invitation.');
      setNextAction({
        pathname: '/register',
        params: { inviteId: invitationId, email: invitation.inviteeEmail },
      });
      setButtonLabel('Continue to registration');
    } catch (error) {
      console.error('Invitation handling error:', error);
      setStatus('error');
      setMessage('An error occurred. Please try again.');
      setNextAction({ pathname: '/login' });
      setButtonLabel('Go to Login');
    }
  };

  const onPressContinue = () => {
    if (nextAction) router.replace({ pathname: nextAction.pathname, params: nextAction.params } as any);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        {status === 'checking' ? (
          <>
            <ActivityIndicator size="large" color="#6C5CE7" />
            <Text style={styles.message}>{message}</Text>
          </>
        ) : (
          <>
            {status === 'error' ? (
              <Text style={styles.errorIcon}>✗</Text>
            ) : (
              <Text style={styles.successIcon}>✓</Text>
            )}
            <Text style={styles.message}>{message}</Text>
            {nextAction && (
              <TouchableOpacity style={styles.continueButton} onPress={onPressContinue} activeOpacity={0.8}>
                <Text style={styles.continueButtonText}>{buttonLabel}</Text>
              </TouchableOpacity>
            )}
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

