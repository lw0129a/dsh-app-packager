#!/usr/bin/env bash
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/config/settings.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/settings.local.env" ] && source "$PIPELINE_ROOT/config/settings.local.env"

PORT="${1:-8000}"
HOST_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[ -n "$HOST_IP" ] || HOST_IP="127.0.0.1"

printf '安装包下载服务:\n'
printf '  本机: http://127.0.0.1:%s/\n' "$PORT"
printf '  局域网: http://%s:%s/\n' "$HOST_IP" "$PORT"
printf '  可用最新包:\n'
while IFS= read -r latest; do
  [ -n "$latest" ] || continue
  printf '    http://%s:%s/%s\n' "$HOST_IP" "$PORT" "${latest#"$PACKAGE_ROOT"/}"
done < <(find "$PACKAGE_ROOT" \( -type f -o -type l \) \( -name '*-latest.ipa' -o -name '*-latest.apk' -o -name '*-latest.hap' \) -print 2>/dev/null | sort)
printf '目录: %s\n\n' "$PACKAGE_ROOT"

exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$PACKAGE_ROOT"
