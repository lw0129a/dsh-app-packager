#!/usr/bin/env bash
set -euo pipefail
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_ROOT="$(cd "$CERT_DIR/.." && pwd)"
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/common.sh"
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/config/settings.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/settings.local.env" ] && source "$PIPELINE_ROOT/config/settings.local.env"
process_certificates_root "$@"
printf '\n处理结束。按回车关闭...'
read -r _ || true
