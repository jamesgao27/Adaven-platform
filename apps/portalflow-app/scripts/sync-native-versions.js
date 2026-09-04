#!/usr/bin/env node
/**
 * 将 package.json 的 version 同步到原生工程，确保 EAS Build 使用正确版本号。
 * 构建号（iOS buildNumber / Android versionCode）由 EAS 的 remote + autoIncrement 管理。
 *
 * 使用：在改完 package.json version 后执行
 *   npm run version:sync
 * 或
 *   node scripts/sync-native-versions.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const plistPath = path.join(root, 'ios', 'Vouchap', 'Info.plist');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Invalid or missing version in package.json:', version);
  process.exit(1);
}

// iOS: CFBundleShortVersionString
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, 'utf8');
  plist = plist.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${version}$2`
  );
  fs.writeFileSync(plistPath, plist);
  console.log('Updated ios/Vouchap/Info.plist CFBundleShortVersionString ->', version);
}

// Android: versionName
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(
    /versionName\s+"[^"]+"/,
    `versionName "${version}"`
  );
  fs.writeFileSync(gradlePath, gradle);
  console.log('Updated android/app/build.gradle versionName ->', version);
}

console.log('Version sync done. Build numbers are managed by EAS (remote + autoIncrement).');
