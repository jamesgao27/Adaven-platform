import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Animated,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ScrollViewWithScrollHintProps = React.ComponentProps<typeof ScrollView> & {
  /** Optional style for the wrapper View (e.g. flex: 1) */
  wrapperStyle?: ViewStyle;
};

export default function ScrollViewWithScrollHint({
  wrapperStyle,
  onLayout,
  onContentSizeChange,
  onScroll,
  children,
  style,
  ...rest
}: ScrollViewWithScrollHintProps) {
  const [listLayoutHeight, setListLayoutHeight] = useState(0);
  const [listContentHeight, setListContentHeight] = useState(0);
  const [atScrollBottom, setAtScrollBottom] = useState(false);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const layoutHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  layoutHeightRef.current = listLayoutHeight;
  contentHeightRef.current = listContentHeight;

  const canScroll = listLayoutHeight > 0 && listContentHeight > listLayoutHeight + 2;
  const showScrollHint = canScroll && !atScrollBottom;

  useEffect(() => {
    if (!showScrollHint) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: 5,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showScrollHint, bounceAnim]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setListLayoutHeight(e.nativeEvent.layout.height);
    onLayout?.(e);
  };

  const handleContentSizeChange = (w: number, h: number) => {
    setListContentHeight(h);
    onContentSizeChange?.(w, h);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const layoutH = layoutHeightRef.current;
    const contentH = contentHeightRef.current;
    const atBottom = layoutH > 0 && contentH > 0 && y + layoutH >= contentH - 10;
    setAtScrollBottom(atBottom);
    onScroll?.(e);
  };

  return (
    <View style={[styles.wrapper, wrapperStyle]}>
      <ScrollView
        style={style}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        {...rest}
      >
        {children}
      </ScrollView>
      {showScrollHint && (
        <View style={styles.scrollHintOverlay} pointerEvents="none">
          <Animated.View
            style={[styles.scrollHintIcon, { transform: [{ translateY: bounceAnim }] }]}
          >
            <Ionicons name="chevron-down" size={24} color="#6C5CE7" />
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    position: 'relative',
  },
  scrollHintOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollHintIcon: {},
});
