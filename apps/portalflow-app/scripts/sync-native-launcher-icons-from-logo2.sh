#!/usr/bin/env bash
# Native ios/ and android/ override app.config.js, so EAS ships these files.
# Sources are the current Vouchap mark (receipt + green shield):
#   assets/vouchap-icon.png        opaque combined mark (iOS + legacy launcher)
#   assets/vouchap-foreground.png  transparent adaptive foreground
#   assets/vouchap-background.png  full-bleed adaptive background
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="$ROOT/assets/vouchap-icon.png"
FG="$ROOT/assets/vouchap-foreground.png"
BG="$ROOT/assets/vouchap-background.png"
for f in "$ICON" "$FG" "$BG"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing: $f" >&2
    exit 1
  fi
done

IOS_OUT="$ROOT/ios/Vouchap/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
# App Store Connect 90717: the 1024 marketing icon must not have an alpha channel.
magick "$ICON" -resize 1024x1024 -background white -flatten -alpha off -define png:exclude-chunks=date,time "$IOS_OUT"
echo "Wrote $IOS_OUT (opaque RGB, no alpha)"

# Adaptive icon canvas is 108dp. Legacy launcher glyphs use the inner sizes.
write_android() {
  local d="$1" fg="$2" la="$3"
  local mip="$ROOT/android/app/src/main/res/mipmap-${d}"
  local draw="$ROOT/android/app/src/main/res/drawable-${d}"
  mkdir -p "$mip" "$draw"
  magick "$FG" -resize "${fg}x${fg}" -define webp:method=6 "$mip/ic_launcher_foreground.webp"
  magick "$BG" -resize "${fg}x${fg}" "PNG32:$draw/ic_launcher_adaptive_bg.png"
  magick "$BG" -resize "${la}x${la}" "$FG" -resize "${la}x${la}" -gravity center -composite -define webp:method=6 "$mip/ic_launcher.webp"
  cp "$mip/ic_launcher.webp" "$mip/ic_launcher_round.webp"
  echo "Wrote mipmap-${d} and drawable-${d}"
}

write_android mdpi 108 48
write_android hdpi 162 72
write_android xhdpi 216 96
write_android xxhdpi 324 144
write_android xxxhdpi 432 192

echo "Done."
