#!/usr/bin/env bash
set -euo pipefail
PIPELINE_ROOT="$(cd "$(dirname "$0")" && pwd)"
export PIPELINE_ROOT
exec "$PIPELINE_ROOT/lib/init.sh" "$@"
