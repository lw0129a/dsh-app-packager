#!/usr/bin/env bash
set -euo pipefail
SDK_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_ROOT="$(cd "$SDK_DIR/.." && pwd)"
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/init.sh"

if ! find_hbuilderx; then
  fail "未检测到 HBuilderX，无法确定 SDK 版本系列"
  printf '请先安装 HBuilderX: https://www.dcloud.io/hbuilderx.html\n'
  read -r _ || true
  exit 1
fi
read_hbuilderx_version
process_sdk_root
write_local_settings
printf '\n处理结束。按回车关闭...'
read -r _ || true
