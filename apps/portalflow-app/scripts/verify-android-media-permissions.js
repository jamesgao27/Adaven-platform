#!/usr/bin/env node
/**
 * Android 媒体权限合规性检查脚本
 * 用于 Google Play Photo/Video Permissions 政策合规
 * 参考: https://support.google.com/googleplay/android-developer/answer/13392821
 *
 * 用法: node scripts/verify-android-media-permissions.js
 * 或:   npm run verify:android:permissions
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN_PERMISSIONS = [
  'READ_MEDIA_IMAGES',
  'READ_MEDIA_VIDEO',
  'READ_MEDIA_VISUAL', // 也需避免
];

const ROOT = path.resolve(__dirname, '..');

function findFiles(dir, pattern, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules/.cache', '.git', 'build', 'dist'].some((x) => full.includes(x))) {
        findFiles(full, pattern, files);
      }
    } else if (pattern.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

function grepForbidden(content, filePath, isManifest = false) {
  const lines = content.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // 排除注释：HTML 注释、JS 单行注释
    if (isManifest && line.trim().startsWith('<!--')) continue;
    const beforeComment = line.split(/\s*\/\//)[0]; // JS: 忽略 // 后的内容
    const beforeXmlComment = beforeComment.split(/<!--[\s\S]*?-->/)[0];
    const effective = beforeXmlComment || line;
    for (const perm of FORBIDDEN_PERMISSIONS) {
      // 仅在「声明」中出现时报错：permissions 数组、"perm"、android:name="...perm..."
      const looksLikeDeclaration =
        effective.includes(`"${perm}"`) ||
        effective.includes(`'${perm}'`) ||
        (isManifest && effective.includes(perm) && effective.includes('uses-permission'));
      if (looksLikeDeclaration) {
        found.push({ permission: perm, line: i + 1, content: line.trim() });
      }
    }
  }
  return found;
}

function main() {
  let hasErrors = false;

  console.log('🔍 Android 媒体权限合规性检查 (Google Play Photo/Video Policy)\n');

  // 1. app.config.js
  const appConfigPath = path.join(ROOT, 'app.config.js');
  if (fs.existsSync(appConfigPath)) {
    const content = fs.readFileSync(appConfigPath, 'utf-8');
    const found = grepForbidden(content, appConfigPath, false);
    if (found.length > 0) {
      hasErrors = true;
      console.log('❌ app.config.js 发现禁止权限:');
      found.forEach((f) => console.log(`   行 ${f.line}: ${f.permission}`));
    } else {
      console.log('✅ app.config.js: 无 READ_MEDIA_* 权限');
    }
  }

  // 2. android/app 下所有 AndroidManifest.xml
  const androidDir = path.join(ROOT, 'android');
  if (fs.existsSync(androidDir)) {
    const manifests = findFiles(androidDir, /AndroidManifest\.xml$/);
    for (const m of manifests) {
      const content = fs.readFileSync(m, 'utf-8');
      const found = grepForbidden(content, m, true);
      const rel = path.relative(ROOT, m);
      if (found.length > 0) {
        hasErrors = true;
        console.log(`\n❌ ${rel} 发现禁止权限:`);
        found.forEach((f) => console.log(`   行 ${f.line}: ${f.permission} - ${f.content}`));
      } else {
        console.log(`✅ ${rel}: 无 READ_MEDIA_* 权限`);
      }
    }
  } else {
    console.log('⚠️  android/ 目录不存在（可能使用 managed workflow）');
  }

  // 3. 依赖库中可能注入的权限（仅作参考，build 合并后以实际 manifest 为准）
  const nodeModules = path.join(ROOT, 'node_modules');
  const suspicious = [];
  if (fs.existsSync(nodeModules)) {
    for (const pkg of ['expo-image-picker', 'react-native-document-scanner-plugin']) {
      const manifest = path.join(nodeModules, pkg, 'android', 'src', 'main', 'AndroidManifest.xml');
      if (fs.existsSync(manifest)) {
        const content = fs.readFileSync(manifest, 'utf-8');
        const found = grepForbidden(content, manifest, true);
        if (found.length > 0) {
          suspicious.push({ pkg, found });
        }
      }
    }
  }

  if (suspicious.length > 0) {
    console.log('\n⚠️  以下依赖可能声明禁止权限（需在合并 manifest 中确认）:');
    suspicious.forEach((s) => {
      console.log(`   ${s.pkg}: ${s.found.map((f) => f.permission).join(', ')}`);
    });
    hasErrors = true;
  }

  // 4. 若存在 mergeReleaseManifests 产物，检查合并后的 manifest
  const mergedManifests = path.join(ROOT, 'android', 'app', 'build', 'intermediates', 'merged_manifests');
  if (fs.existsSync(mergedManifests)) {
    const files = findFiles(mergedManifests, /AndroidManifest\.xml$/);
    for (const m of files) {
      const content = fs.readFileSync(m, 'utf-8');
      const found = grepForbidden(content, m, true);
      const rel = path.relative(ROOT, m);
      if (found.length > 0) {
        hasErrors = true;
        console.log(`\n❌ 合并 manifest ${rel} 发现禁止权限:`);
        found.forEach((f) => console.log(`   行 ${f.line}: ${f.permission}`));
      } else {
        console.log(`✅ 合并 manifest (release): 无 READ_MEDIA_* 权限`);
      }
    }
  } else {
    console.log('\n💡 提示: 运行 `cd android && ./gradlew mergeReleaseManifests` 后再次执行本脚本可验证合并后 manifest');
  }

  // 总结
  console.log('\n' + '─'.repeat(50));
  if (hasErrors) {
    console.log('❌ 检查未通过，请移除 READ_MEDIA_IMAGES / READ_MEDIA_VIDEO 后重新提交');
    process.exit(1);
  } else {
    console.log('✅ 检查通过，符合 Google Play Photo/Video Permissions 政策');
    process.exit(0);
  }
}

main();
