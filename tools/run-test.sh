#!/usr/bin/env bash
# Run the extension inside an isolated, headless GNOME Shell and take
# screenshots. Does not touch the running session or the user's settings.
#
#   tools/run-test.sh [output-dir] [layout]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(realpath -m "${1:-$ROOT/build/test}")"
TMP="$(mktemp -d /tmp/cbp-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

rm -rf "$OUT"
mkdir -p "$OUT" "$TMP/config" "$TMP/data/gnome-shell/extensions" "$TMP/cache" "$TMP/runtime"
chmod 700 "$TMP/runtime"

glib-compile-schemas "$ROOT/src/schemas"
cp -r "$ROOT/src" "$TMP/data/gnome-shell/extensions/clipboard-plus@dukha"
if [ -d "$ROOT/build/locale" ]; then
    cp -r "$ROOT/build/locale" "$TMP/data/gnome-shell/extensions/clipboard-plus@dukha/locale"
fi

# sample image for the image tests
python3 "$ROOT/tools/sample-image.py" "$TMP/sample.png"

# preferences harness copy (prefs.js with its shell import replaced by a shim)
PD="$TMP/prefs"
cp -r "$ROOT/src" "$PD"
cp "$ROOT/tools/prefs-shim.js" "$PD/prefs-shim.js"
sed -i "s|resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js|./prefs-shim.js|" "$PD/prefs.js"
[ -d "$ROOT/build/locale" ] && cp -r "$ROOT/build/locale" "$PD/locale"
export CBP_PREFS_DIR="$PD"
export CBP_PREFS_HARNESS="$ROOT/tools/prefs-harness.js"

export XDG_CONFIG_HOME="$TMP/config"
export XDG_DATA_HOME="$TMP/data"
export XDG_CACHE_HOME="$TMP/cache"
export XDG_RUNTIME_DIR="$TMP/runtime"
export CBP_TEST_OUT="$OUT"
export CBP_TEST_IMAGE="$TMP/sample.png"
export CBP_TEST_ONLY="${2:-}"
export CBP_TEST_QUERY="${CBP_TEST_QUERY:-}"
export LANG="${CBP_LANG:-en_US.UTF-8}"
export LANGUAGE="${CBP_LANGUAGE:-}"
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS

timeout 180 dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --wayland-display=cbp-test-0 --virtual-monitor 1600x1000 \
    --automation-script="$ROOT/tools/shell-test.js" > "$OUT/shell.log" 2>&1 || true

echo "---- test log"
cat "$OUT/log.txt" 2>/dev/null || echo "(no log)"
echo "---- shell warnings/errors mentioning the extension"
grep -iE "clipboard-plus|cbp|JS ERROR|TypeError|ReferenceError|Gjs-CRITICAL|St-CRITICAL|Clutter-CRITICAL" "$OUT/shell.log" | grep -v "CBP-TEST" | head -40 || true
