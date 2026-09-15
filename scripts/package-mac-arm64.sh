#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIGNER_NAME="${CSC_NAME:-Fupu Technology (Beijing) Co., Ltd. (4M8PLCQCFP)}"
SIGNER_IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Fupu Technology (Beijing) Co., Ltd. (4M8PLCQCFP)}"
SIGNING_KEYCHAIN="${CODESIGN_KEYCHAIN:-/Users/zhangjianle/Library/Keychains/login.keychain-db}"

cd "$PROJECT_DIR"
export RAYON_NUM_THREADS=2
export UV_THREADPOOL_SIZE=2

if ! security find-identity -v -p codesigning | grep -Fq "$SIGNER_IDENTITY"; then
  echo "未找到可用的 Developer ID Application 签名身份：$SIGNER_IDENTITY" >&2
  exit 1
fi

npm run build
CSC_NAME="$SIGNER_NAME" ./node_modules/.bin/electron-builder --mac dmg --arm64

APP_PATH="$(find release/mac-arm64 -maxdepth 1 -type d -name '*.app' -print -quit)"
APP_VERSION="$(node -p 'require("./package.json").version')"
DMG_PATH="$PROJECT_DIR/release/流绘 FlowSketch-${APP_VERSION}-arm64.dmg"

if [[ -z "$APP_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "打包结束，但未找到 ARM64 App 或 DMG 产物。" >&2
  exit 1
fi

/usr/bin/codesign \
  --force \
  --sign "$SIGNER_IDENTITY" \
  --keychain "$SIGNING_KEYCHAIN" \
  --timestamp \
  --verbose=2 \
  "$DMG_PATH"

/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH"
/usr/bin/codesign --verify --strict --verbose=2 "$DMG_PATH"

EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")"
ARCHITECTURES="$(lipo -archs "$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME")"
if [[ "$ARCHITECTURES" != "arm64" ]]; then
  echo "架构验证失败，实际架构：$ARCHITECTURES" >&2
  exit 1
fi

echo "ARM64 签名安装包已生成：$DMG_PATH"
