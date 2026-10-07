#!/usr/bin/env bash
# 兼容旧引用。插件逻辑已统一迁移到 lib/plugins.sh。
PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/plugins.sh"
