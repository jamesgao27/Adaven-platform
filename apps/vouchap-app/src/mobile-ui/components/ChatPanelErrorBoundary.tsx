import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type Props = {
  children: ReactNode;
  /** Optional reset key — remount children when this changes */
  resetKey?: string;
};

type State = {
  error: Error | null;
};

/**
 * Isolates chat side-panel crashes so the main list/detail area stays usable.
 * Desktop list pages default-open the chat panel; an uncaught render error there
 * previously blanked the entire web shell.
 */
export class ChatPanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChatPanelErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.box}>
          <Text style={styles.title}>Chat temporarily unavailable</Text>
          <Text style={styles.msg}>The list is still usable. Tap Retry to reload chat.</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({ error: null })}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    width: 420,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#E9ECEF',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 8,
  },
  msg: {
    fontSize: 14,
    color: '#636E72',
    marginBottom: 16,
    lineHeight: 20,
  },
  btn: {
    backgroundColor: '#6C5CE7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
