/**
 * Web 用 react-native 垫片：在 react-native-web 基础上补上 requireNativeComponent，
 * 供部分原生组件库在 Web 上安全降级。
 */
const RN = require('react-native-web');

function requireNativeComponent() {
  return RN.View;
}

module.exports = {
  ...RN,
  requireNativeComponent,
};
