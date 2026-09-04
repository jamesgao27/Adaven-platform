import React, { useRef, useEffect } from 'react';
import { View, Animated, PanResponder, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}

function SwipeableRow({ children, onDelete, disabled = false }: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const panStartX = useRef(0);

  useEffect(() => {
    if (disabled) {
      // 如果禁用，重置位置
      translateX.setValue(0);
    }
  }, [disabled, translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        if (disabled) return false;
        return false; // 不立即捕获，等待移动
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (disabled) return false;
        // 降低阈值，更容易触发
        // 检查是否是水平滑动（水平距离大于垂直距离的1.5倍）
        const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
        // 降低触发阈值到5px
        return isHorizontal && Math.abs(gestureState.dx) > 5;
      },
      onPanResponderGrant: (evt) => {
        if (disabled) return;
        panStartX.current = evt.nativeEvent.pageX;
      },
      onPanResponderMove: (_, gestureState) => {
        if (disabled) return;
        // 允许向左滑动，限制最大滑动距离
        if (gestureState.dx < 0) {
          // 限制最大滑动距离为删除按钮宽度（80px）
          const maxTranslate = -80;
          const newTranslate = Math.max(gestureState.dx, maxTranslate);
          translateX.setValue(newTranslate);
        } else if (gestureState.dx > 0) {
          // 允许向右滑动一点，但限制在0
          translateX.setValue(Math.min(gestureState.dx * 0.3, 20));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (disabled) return;
        // 降低删除阈值到60px，更容易触发删除
        const deleteThreshold = -60;
        // 或者如果滑动速度很快（vx < -0.5），也触发删除
        const isFastSwipe = gestureState.vx < -0.5;
        
        if (gestureState.dx < deleteThreshold || isFastSwipe) {
          // 滑动超过阈值或快速滑动，执行删除
          Animated.timing(translateX, {
            toValue: -200,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onDelete();
            translateX.setValue(0);
          });
        } else {
          // 恢复原位置
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 50,
            friction: 7,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        // 手势被中断，恢复原位置
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <View style={styles.deleteAction}>
        <Ionicons name="trash" size={24} color="#fff" />
      </View>
      <Animated.View
        style={[
          styles.content,
          {
            transform: [{ translateX }],
          },
        ]}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  deleteAction: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#E74C3C',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  content: {
    backgroundColor: '#fff',
  },
});

export default SwipeableRow;
export { SwipeableRow };

