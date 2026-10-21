#!/bin/bash
# 构建 LibreTV.app 并安装到 /Applications
set -euo pipefail
cd "$(dirname "$0")"

APP=build/LibreTV.app
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -o "$APP/Contents/MacOS/LibreTV" main.swift
cp Info.plist "$APP/Contents/Info.plist"

# 用站点自带的 512px 图标生成 icns
ICONSET=build/AppIcon.iconset
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../public/icons/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d ../public/icons/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign - "$APP"

if [ "${1:-}" != "--no-install" ]; then
  pkill -x LibreTV || true
  rm -rf /Applications/LibreTV.app
  cp -R "$APP" /Applications/
  open /Applications/LibreTV.app
  echo "已安装并启动 /Applications/LibreTV.app"
fi
