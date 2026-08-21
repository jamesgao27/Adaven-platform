/**
 * Web-only stack header: default react-navigation back uses PNG + Image tint on RN Web,
 * which often renders an empty (but clickable) icon. Use a Unicode chevron in system fonts.
 */
import { HeaderBackButton } from '@react-navigation/elements';
import React from 'react';
import { View, Text, Platform, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export type WebStackHeaderLeftProps = React.ComponentProps<typeof HeaderBackButton> & {
  canGoBack?: boolean;
};

export function WebStackHeaderLeft(props: WebStackHeaderLeftProps) {
  const { canGoBack, ...btn } = props;
  if (!canGoBack || !btn.onPress) return null;
  return (
    <HeaderBackButton
      {...btn}
      displayMode="minimal"
      backImage={({ tintColor: tc }) => (
        <View style={$iconBox}>
          <Text style={[$glyph, { color: tc }]}>{'\u2039'}</Text>
        </View>
      )}
    />
  );
}

const $iconBox: StyleProp<ViewStyle> = {
  width: 28,
  height: 28,
  justifyContent: 'center',
  alignItems: 'center',
};

const $glyph: TextStyle = {
  fontSize: 28,
  lineHeight: 28,
  fontWeight: '300',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/** Merge into Stack `screenOptions` on web only; native returns {} so default back button is unchanged. */
export function getWebStackHeaderLeftScreenOptions():
  | { headerLeft: (p: WebStackHeaderLeftProps) => React.ReactElement | null }
  | Record<string, never> {
  if (Platform.OS !== 'web') return {};
  return {
    headerLeft: (p: WebStackHeaderLeftProps) => <WebStackHeaderLeft {...p} />,
  };
}
