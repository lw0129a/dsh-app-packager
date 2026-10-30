#!/usr/bin/env bash
set -euo pipefail
PIPELINE_ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$PIPELINE_ROOT/打包工具.command" "$@"
