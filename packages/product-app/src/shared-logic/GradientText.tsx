import React from 'react';
import { View, Text, ViewStyle, TextStyle, LayoutChangeEvent, Platform } from 'react-native';

// MaskedView 内部使用 requireNativeComponent，Web 上不可用，仅在原生端动态导入
let MaskedView: React.ComponentType<any> | null = null;
let LinearGradient: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
  MaskedView = require('@react-native-community/masked-view').default;
  LinearGradient = require('expo-linear-gradient').LinearGradient;
}

interface GradientTextProps {
  text: string;
  style?: TextStyle;
  containerStyle?: ViewStyle;
  colors?: string[];
}

export const GradientText: React.FC<GradientTextProps> = ({
  text,
  style,
  containerStyle,
  colors = ['#0066FF', '#8B00FF', '#FF1493'],
}) => {
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  // 若包含换行则按 \n 分行（保证每行单独渲染、不自动折行）；否则按逗号分行（兼容旧用法）
  const lines: string[] = text.includes('\n')
    ? text.split('\n').map((s) => s.trim()).filter(Boolean)
    : (() => {
        const parts = text.split(',');
        const out: string[] = [];
        parts.forEach((part, index) => {
          if (index === 0) out.push(part.trim() + ',');
          else out.push(part.trim());
        });
        return out;
      })();

  const isAndroid = Platform.OS === 'android';
  const isWeb = Platform.OS === 'web';
  const solidColor = colors[0] || '#6C5CE7';

  const textStyle: TextStyle = {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    ...style,
    ...((isAndroid || isWeb) && { color: solidColor }),
  };

  // 每行单独 Text，numberOfLines={1} + adjustsFontSizeToFit 保证窄屏也是固定行数、不折行
  const lineProps = { numberOfLines: 1 as const, adjustsFontSizeToFit: true, minimumFontScale: 0.65 };

  const renderLines = (lineStyle: TextStyle) =>
    lines.map((line, i) => (
      <Text key={i} style={lineStyle} {...lineProps}>
        {line}
      </Text>
    ));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (dimensions.width !== width || dimensions.height !== height)) {
      setDimensions({ width, height });
    }
  };

  // Web / Android：单色文字，不依赖 MaskedView
  if (isWeb || isAndroid) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, containerStyle]}>
        {renderLines(textStyle)}
      </View>
    );
  }

  // iOS：渐变效果（MaskedView + LinearGradient 已在上方按需 require）
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center' }, containerStyle]}>
      {dimensions.width > 0 && dimensions.height > 0 && MaskedView && LinearGradient ? (
        <MaskedView
          style={{ width: dimensions.width, height: dimensions.height, alignItems: 'center', justifyContent: 'center' }}
          maskElement={
            <View style={{ width: dimensions.width, height: dimensions.height, alignItems: 'center', justifyContent: 'center' }}>
              {renderLines(textStyle)}
            </View>
          }
        >
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: dimensions.width, height: dimensions.height }}
          />
        </MaskedView>
      ) : (
        <View
          onLayout={onLayout}
          style={{ width: '100%', alignItems: 'center', justifyContent: 'center' }}
        >
          {renderLines(textStyle)}
        </View>
      )}
    </View>
  );
};

