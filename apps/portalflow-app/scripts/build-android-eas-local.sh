#!/usr/bin/env bash
# EAS 本地 Android production 构建：强制 Gradle 使用 JDK 21，避免 "Unsupported class file major version 69"
# 通过写入 android/gradle.properties 的 org.gradle.java.home，确保 EAS 在临时目录运行 Gradle 时也使用正确 JDK
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
GRADLE_PROP="${ROOT_DIR}/android/gradle.properties"

JAVA21_HOME=""
if command -v /usr/libexec/java_home &>/dev/null; then
  JAVA21_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true)
fi
if [ -z "$JAVA21_HOME" ] && [ -d "/opt/homebrew/opt/openjdk@21" ]; then
  JAVA21_HOME="/opt/homebrew/opt/openjdk@21"
fi
if [ -z "$JAVA21_HOME" ] && [ -d "/usr/local/opt/openjdk@21" ]; then
  JAVA21_HOME="/usr/local/opt/openjdk@21"
fi

if [ -z "$JAVA21_HOME" ]; then
  echo "Error: JDK 21 not found. Build will fail with 'Unsupported class file major version 69'."
  echo "Install: brew install openjdk@21"
  echo "Or set: export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
  exit 1
fi

# 备份并注入 org.gradle.java.home，使 EAS 打包后的项目在运行 Gradle 时使用 JDK 21
cleanup() {
  if [ -f "${GRADLE_PROP}.bak" ]; then
    mv "${GRADLE_PROP}.bak" "$GRADLE_PROP"
  fi
}
trap cleanup EXIT

cp "$GRADLE_PROP" "${GRADLE_PROP}.bak"
# 移除已有的 org.gradle.java.home 行（若有），再追加当前检测到的 JDK 21 路径
grep -v '^org\.gradle\.java\.home=' "${GRADLE_PROP}.bak" > "$GRADLE_PROP"
echo "org.gradle.java.home=$JAVA21_HOME" >> "$GRADLE_PROP"
echo "Using JDK 21 for Gradle: $JAVA21_HOME (injected into android/gradle.properties for EAS local build)"

exec npx eas-cli build --platform android --profile production --local "$@"
