#!/usr/bin/env bash
# Re-extract strings, refresh tr.po and compile .mo files into build/locale.
set -euo pipefail
cd "$(dirname "$0")/.."
xgettext --from-code=UTF-8 -k_ -kngettext:1,2 -kpgettext:1c,2 -kN_ --language=JavaScript \
    -o po/clipboard-plus.pot --package-name="Clipboard+" \
    --msgid-bugs-address="https://github.com/uuRCnn/clipboard-plus/issues" \
    src/extension.js src/prefs.js src/lib/*.js
python3 tools/po-tr.py
for po in po/*.po; do
    lang=$(basename "$po" .po)
    mkdir -p "build/locale/$lang/LC_MESSAGES"
    msgfmt --check -o "build/locale/$lang/LC_MESSAGES/clipboard-plus.mo" "$po"
done
echo "translations ok"
