const RN = require('react-native-web');
function requireNativeComponent() {
  return RN.View;
}
module.exports = { ...RN, requireNativeComponent };
