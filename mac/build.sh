#!/usr/bin/env bash
# 构建 DSH Remote.app(arm64 + x86_64 通用二进制)。
#   ./build.sh              构建并安装到 ~/Applications
#   ./build.sh --no-install 只构建,并打包 build/DSH-Remote.zip(CI 使用)
# 版本号取自环境变量 BUILD_NUMBER(默认 0)与当前 git 提交。
# 应用内更新源取自 UPDATE_REPO(owner/repo);未设置时从 git remote origin 推断。
set -euo pipefail
cd "$(dirname "$0")"
INSTALL=1
[ "${1:-}" = "--no-install" ] && INSTALL=0

BUILD_NUMBER="${BUILD_NUMBER:-0}"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
UPDATE_REPO="${UPDATE_REPO:-$(git remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com(:[0-9]+)?[:/]([^/]+/[^/.]+)(\.git)?/?$#\2#p')}"
APP="build/DSH Remote.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -target "$arch-apple-macos13" \
    -framework AppKit -framework WebKit ./*.swift -o "build/DSHRemote-$arch"
done
lipo -create build/DSHRemote-arm64 build/DSHRemote-x86_64 -output "$APP/Contents/MacOS/DSHRemote"
rm build/DSHRemote-arm64 build/DSHRemote-x86_64
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.joshua.dsh-remote</string>
  <key>CFBundleName</key><string>DSH Remote</string>
  <key>CFBundleDisplayName</key><string>DSH Remote</string>
  <key>CFBundleExecutable</key><string>DSHRemote</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.${BUILD_NUMBER} (${SHA})</string>
  <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
  <key>DSHRemoteCommit</key><string>${SHA}</string>
  <key>DSHRemoteUpdateRepo</key><string>${UPDATE_REPO}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>用于 DSH 的语音输入。</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
EOF
codesign --force --deep -s - "$APP"

if [ "$INSTALL" = 1 ]; then
  mkdir -p ~/Applications
  rm -rf ~/Applications/"DSH Remote.app"
  cp -R "$APP" ~/Applications/
  echo "installed: ~/Applications/DSH Remote.app (1.0.${BUILD_NUMBER} ${SHA}, updates: ${UPDATE_REPO:-none})"
else
  ditto -c -k --keepParent "$APP" build/DSH-Remote.zip
  echo "packaged: build/DSH-Remote.zip (1.0.${BUILD_NUMBER} ${SHA})"
fi
