# shellcheck shell=bash

# 构建调度与资源闸门。
# 目标：允许不同项目和不同平台并行，但严格串行化 HBuilderX/Xcode/Gradle 等重型工具。

PARALLEL_BUILD_ENABLED="${PARALLEL_BUILD_ENABLED:-true}"
PARALLEL_AUTO_TUNE="${PARALLEL_AUTO_TUNE:-true}"
PARALLEL_MAX_JOBS="${PARALLEL_MAX_JOBS:-auto}"
PARALLEL_MAX_IOS_JOBS="${PARALLEL_MAX_IOS_JOBS:-2}"
PARALLEL_MAX_ANDROID_JOBS="${PARALLEL_MAX_ANDROID_JOBS:-2}"
PARALLEL_MAX_HARMONY_JOBS="${PARALLEL_MAX_HARMONY_JOBS:-2}"
PARALLEL_MAX_HBULDERX_JOBS="${PARALLEL_MAX_HBULDERX_JOBS:-1}"
PARALLEL_MAX_XCODE_JOBS="${PARALLEL_MAX_XCODE_JOBS:-1}"
PARALLEL_MAX_GRADLE_JOBS="${PARALLEL_MAX_GRADLE_JOBS:-1}"
PARALLEL_MAX_PREPARE_JOBS="${PARALLEL_MAX_PREPARE_JOBS:-2}"
PARALLEL_MAX_UPLOAD_JOBS="${PARALLEL_MAX_UPLOAD_JOBS:-2}"
PARALLEL_AUTO_JOBS_MAX="${PARALLEL_AUTO_JOBS_MAX:-3}"
PARALLEL_RESERVED_CPU_CORES="${PARALLEL_RESERVED_CPU_CORES:-1}"
PARALLEL_MEMORY_PER_JOB_MB="${PARALLEL_MEMORY_PER_JOB_MB:-4096}"
PARALLEL_QUEUE_POLL_SECONDS="${PARALLEL_QUEUE_POLL_SECONDS:-1}"
PARALLEL_QUEUE_REFRESH_SECONDS="${PARALLEL_QUEUE_REFRESH_SECONDS:-1}"
PARALLEL_LIVE_QUEUE_DISPLAY="${PARALLEL_LIVE_QUEUE_DISPLAY:-true}"
PARALLEL_FAIL_FAST="${PARALLEL_FAIL_FAST:-false}"
PARALLEL_PRINT_CHILD_LOGS="${PARALLEL_PRINT_CHILD_LOGS:-false}"
PARALLEL_GRADLE_WORKERS="${PARALLEL_GRADLE_WORKERS:-2}"

_parallel_numeric_or() {
  local value="$1" fallback="$2"
  case "$value" in
    ''|*[!0-9]*) printf '%s\n' "$fallback" ;;
    *) [ "$value" -ge 1 ] && printf '%s\n' "$value" || printf '%s\n' "$fallback" ;;
  esac
}

_parallel_total_cpus() {
  local value=""
  if command -v sysctl >/dev/null 2>&1; then
    value="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi
  [ -n "$value" ] || value="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  _parallel_numeric_or "$value" 4
}

_parallel_performance_cpus() {
  local value=""
  if command -v sysctl >/dev/null 2>&1; then
    value="$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || true)"
  fi
  [ -n "$value" ] || _parallel_total_cpus
}

_parallel_memory_mb() {
  local bytes=""
  if command -v sysctl >/dev/null 2>&1; then
    bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  fi
  case "$bytes" in
    ''|*[!0-9]*) printf '%s\n' '8192' ;;
    *) printf '%s\n' "$((bytes / 1024 / 1024))" ;;
  esac
}

parallel_auto_total_jobs() {
  local perf_cpus total_cpus memory_mb cpu_slots memory_slots memory_cap requested_cap result
  perf_cpus="$(_parallel_performance_cpus)"
  total_cpus="$(_parallel_total_cpus)"
  [ "$perf_cpus" -ge 1 ] 2>/dev/null || perf_cpus="$total_cpus"
  memory_mb="$(_parallel_memory_mb)"
  requested_cap="$(_parallel_numeric_or "$PARALLEL_AUTO_JOBS_MAX" 3)"

  cpu_slots=$((perf_cpus - $(_parallel_numeric_or "$PARALLEL_RESERVED_CPU_CORES" 1)))
  [ "$cpu_slots" -lt 1 ] && cpu_slots=1
  memory_slots=$((memory_mb / $(_parallel_numeric_or "$PARALLEL_MEMORY_PER_JOB_MB" 4096)))
  [ "$memory_slots" -lt 1 ] && memory_slots=1

  if [ "$memory_mb" -lt 8192 ]; then
    memory_cap=1
  elif [ "$memory_mb" -lt 32768 ]; then
    memory_cap=2
  else
    memory_cap="$requested_cap"
  fi

  result="$requested_cap"
  [ "$cpu_slots" -lt "$result" ] && result="$cpu_slots"
  [ "$memory_slots" -lt "$result" ] && result="$memory_slots"
  [ "$memory_cap" -lt "$result" ] && result="$memory_cap"
  [ "$result" -lt 1 ] && result=1
  printf '%s\n' "$result"
}

parallel_init() {
  [ "${PARALLEL_INITIALIZED:-0}" = "1" ] && [ -n "${PARALLEL_MAX_JOBS_RESOLVED:-}" ] && return 0
  local auto_total fallback_total
  if [ "$PARALLEL_AUTO_TUNE" = "true" ]; then
    auto_total="$(parallel_auto_total_jobs)"
  else
    auto_total=2
  fi
  fallback_total="$auto_total"
  [ "$fallback_total" -gt 2 ] && fallback_total=2

  if [ "$PARALLEL_BUILD_ENABLED" != "true" ]; then
    PARALLEL_MAX_JOBS_RESOLVED=1
    PARALLEL_MAX_IOS_JOBS_RESOLVED=1
    PARALLEL_MAX_ANDROID_JOBS_RESOLVED=1
    PARALLEL_MAX_HARMONY_JOBS_RESOLVED=1
  else
    if [ "$PARALLEL_MAX_JOBS" = "auto" ]; then
      PARALLEL_MAX_JOBS_RESOLVED="$auto_total"
    else
      PARALLEL_MAX_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_JOBS" "$fallback_total")"
    fi

    if [ "$PARALLEL_MAX_IOS_JOBS" = "auto" ]; then
      PARALLEL_MAX_IOS_JOBS_RESOLVED="$auto_total"
    else
      PARALLEL_MAX_IOS_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_IOS_JOBS" 2)"
    fi
    if [ "$PARALLEL_MAX_ANDROID_JOBS" = "auto" ]; then
      PARALLEL_MAX_ANDROID_JOBS_RESOLVED="$auto_total"
    else
      PARALLEL_MAX_ANDROID_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_ANDROID_JOBS" 2)"
    fi
    if [ "$PARALLEL_MAX_HARMONY_JOBS" = "auto" ]; then
      PARALLEL_MAX_HARMONY_JOBS_RESOLVED="$auto_total"
    else
      PARALLEL_MAX_HARMONY_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_HARMONY_JOBS" 2)"
    fi
  fi

  PARALLEL_MAX_HBULDERX_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_HBULDERX_JOBS" 1)"
  PARALLEL_MAX_XCODE_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_XCODE_JOBS" 1)"
  PARALLEL_MAX_GRADLE_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_GRADLE_JOBS" 1)"
  PARALLEL_MAX_PREPARE_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_PREPARE_JOBS" 2)"
  PARALLEL_MAX_UPLOAD_JOBS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_MAX_UPLOAD_JOBS" 2)"
  PARALLEL_GRADLE_WORKERS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_GRADLE_WORKERS" 2)"
  PARALLEL_QUEUE_POLL_SECONDS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_QUEUE_POLL_SECONDS" 1)"
  PARALLEL_QUEUE_REFRESH_SECONDS_RESOLVED="$(_parallel_numeric_or "$PARALLEL_QUEUE_REFRESH_SECONDS" 1)"

  [ "$PARALLEL_MAX_IOS_JOBS_RESOLVED" -gt "$PARALLEL_MAX_JOBS_RESOLVED" ] && PARALLEL_MAX_IOS_JOBS_RESOLVED="$PARALLEL_MAX_JOBS_RESOLVED"
  [ "$PARALLEL_MAX_ANDROID_JOBS_RESOLVED" -gt "$PARALLEL_MAX_JOBS_RESOLVED" ] && PARALLEL_MAX_ANDROID_JOBS_RESOLVED="$PARALLEL_MAX_JOBS_RESOLVED"
  [ "$PARALLEL_MAX_HARMONY_JOBS_RESOLVED" -gt "$PARALLEL_MAX_JOBS_RESOLVED" ] && PARALLEL_MAX_HARMONY_JOBS_RESOLVED="$PARALLEL_MAX_JOBS_RESOLVED"

  PARALLEL_INITIALIZED=1
  export PARALLEL_INITIALIZED
  export PARALLEL_MAX_JOBS_RESOLVED PARALLEL_MAX_IOS_JOBS_RESOLVED
  export PARALLEL_MAX_ANDROID_JOBS_RESOLVED PARALLEL_MAX_HARMONY_JOBS_RESOLVED
  export PARALLEL_MAX_HBULDERX_JOBS_RESOLVED PARALLEL_MAX_XCODE_JOBS_RESOLVED
  export PARALLEL_MAX_GRADLE_JOBS_RESOLVED PARALLEL_GRADLE_WORKERS_RESOLVED
  export PARALLEL_MAX_PREPARE_JOBS_RESOLVED PARALLEL_MAX_UPLOAD_JOBS_RESOLVED
  export PARALLEL_QUEUE_POLL_SECONDS_RESOLVED PARALLEL_QUEUE_REFRESH_SECONDS_RESOLVED
}

parallel_config_summary() {
  parallel_init
  if [ "$PARALLEL_BUILD_ENABLED" = "true" ]; then
    printf '并行构建: 启用（总并发 %s，iOS %s，Android %s，Harmony %s；准备 %s，上传 %s；HBuilderX %s，Xcode %s，Gradle %s）\n' \
      "$PARALLEL_MAX_JOBS_RESOLVED" "$PARALLEL_MAX_IOS_JOBS_RESOLVED" \
      "$PARALLEL_MAX_ANDROID_JOBS_RESOLVED" "$PARALLEL_MAX_HARMONY_JOBS_RESOLVED" \
      "$PARALLEL_MAX_PREPARE_JOBS_RESOLVED" "$PARALLEL_MAX_UPLOAD_JOBS_RESOLVED" \
      "$PARALLEL_MAX_HBULDERX_JOBS_RESOLVED" "$PARALLEL_MAX_XCODE_JOBS_RESOLVED" \
      "$PARALLEL_MAX_GRADLE_JOBS_RESOLVED"
  else
    printf '并行构建: 已关闭（顺序执行）\n'
  fi
}

_parallel_write_semaphore_owner() {
  local target="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, sys; open(sys.argv[1], "w").write(str(os.getppid()))' "$target" 2>/dev/null && return 0
  fi
  printf '%s\n' "$$" >"$target" 2>/dev/null
}

with_semaphore() {
  local name="$1" limit="$2"
  shift 2
  parallel_init
  limit="$(_parallel_numeric_or "$limit" 1)"
  local root slot slot_dir owner child rc=0 waited=0 last_beat=0 heartbeat
  root="$PIPELINE_ROOT/.tmp/semaphores/$name"
  mkdir -p "$root"
  heartbeat="$(_parallel_numeric_or "${SEMAPHORE_HEARTBEAT_SECONDS:-15}" 15)"

  if [ -n "${SEMAPHORE_WAIT_MESSAGE:-}" ] && declare -F task_status_write >/dev/null 2>&1; then
    task_status_write "waiting" "${SEMAPHORE_PROGRESS:-0}" "$SEMAPHORE_WAIT_MESSAGE"
  fi

  while :; do
    slot=1
    while [ "$slot" -le "$limit" ]; do
      slot_dir="$root/$slot"
      if mkdir "$slot_dir" 2>/dev/null; then
        if ! _parallel_write_semaphore_owner "$slot_dir/pid"; then
          rm -rf "$slot_dir"
          slot=$((slot + 1))
          continue
        fi
        if [ -n "${SEMAPHORE_RUN_MESSAGE:-}" ] && declare -F task_status_write >/dev/null 2>&1; then
          task_status_write "running" "${SEMAPHORE_PROGRESS:-0}" "$SEMAPHORE_RUN_MESSAGE"
        fi
        (
          "$@"
        ) &
        child=$!
        if wait "$child"; then
          rc=0
        else
          rc=$?
        fi
        rm -rf "$slot_dir"
        return "$rc"
      fi

      owner="$(cat "$slot_dir/pid" 2>/dev/null || true)"
      if [ -z "$owner" ]; then
        sleep "${PARALLEL_QUEUE_POLL_SECONDS_RESOLVED:-1}"
        owner="$(cat "$slot_dir/pid" 2>/dev/null || true)"
      fi
      if [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$slot_dir"
      fi
      slot=$((slot + 1))
    done
    waited=$((waited + ${PARALLEL_QUEUE_POLL_SECONDS_RESOLVED:-1}))
    # 等位子的时候也要让状态动起来：消息带上已等秒数，面板/日志才看得出在排队。
    if [ -n "${SEMAPHORE_WAIT_MESSAGE:-}" ] && [ $((waited - last_beat)) -ge "$heartbeat" ] \
      && declare -F task_status_write >/dev/null 2>&1; then
      last_beat="$waited"
      task_status_write "waiting" "${SEMAPHORE_PROGRESS:-0}" "${SEMAPHORE_WAIT_MESSAGE}（已等 ${waited}s）"
    fi
    sleep "${PARALLEL_QUEUE_POLL_SECONDS_RESOLVED:-1}"
  done
}

parallel_platform_limit() {
  parallel_init
  case "$1" in
    ios) printf '%s\n' "$PARALLEL_MAX_IOS_JOBS_RESOLVED" ;;
    android) printf '%s\n' "$PARALLEL_MAX_ANDROID_JOBS_RESOLVED" ;;
    harmony) printf '%s\n' "$PARALLEL_MAX_HARMONY_JOBS_RESOLVED" ;;
    *) printf '%s\n' 1 ;;
  esac
}

parallel_run_build_task() {
  local platform="$1" project_id="$2"
  export APP_PACKAGER_BUILD_PLATFORM="$platform"
  case "$platform" in
    ios) run_ios "$project_id" ;;
    android) run_android "$project_id" ;;
    harmony) run_harmony "$project_id" ;;
    *) die "未知构建平台: $platform" ;;
  esac
}

run_upload_stage() {
  local info_file="$1"
  if [ -z "${UPLOAD_SELECTED_PLATFORMS:-}" ]; then
    task_progress 95 "无需上传"
    return 0
  fi
  SEMAPHORE_PROGRESS=95 SEMAPHORE_WAIT_MESSAGE="等待上传名额" SEMAPHORE_RUN_MESSAGE="上传安装包" \
    with_semaphore "upload" "${PARALLEL_MAX_UPLOAD_JOBS_RESOLVED:-2}" run_post_build_uploads "$info_file" || true
}

should_show_build_paths() {
  [ -z "${UPLOAD_SELECTED_PLATFORMS:-}" ]
}

task_artifact_path() {
  local artifact_path="$1"
  [ -n "${TASK_ARTIFACT_FILE:-}" ] || return 0
  printf '%s\n' "$artifact_path" >"$TASK_ARTIFACT_FILE" 2>/dev/null || true
}

task_progress() {
  local progress="${1:-0}" message="${2:-进行中}"
  TASK_LAST_PROGRESS="$progress"
  task_status_write "running" "$progress" "$message"
}

_parallel_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r' '  '
}

task_status_write() {
  local status="$1" progress="${2:-0}" message="${3:-}"
  [ -n "${TASK_STATUS_FILE:-}" ] || return 0
  case "$progress" in
    ''|*[!0-9]*) progress=0 ;;
  esac
  [ "$progress" -lt 0 ] && progress=0
  [ "$progress" -gt 100 ] && progress=100
  local sequence="${TASK_SEQUENCE:-0}" tmp_file
  case "$sequence" in ''|*[!0-9]*) sequence=0 ;; esac
  tmp_file="$TASK_STATUS_FILE.tmp.$$"
  mkdir -p "$(dirname "$TASK_STATUS_FILE")"
  printf '{"status":"%s","progress":%s,"message":"%s","platform":"%s","project":"%s","sequence":%s,"updated_at":"%s"}\n' \
    "$(_parallel_json_escape "$status")" "$progress" "$(_parallel_json_escape "$message")" \
    "$(_parallel_json_escape "${TASK_PLATFORM:-}")" "$(_parallel_json_escape "${TASK_PROJECT:-}")" \
    "$sequence" "$(date '+%H:%M:%S')" >"$tmp_file"
  mv -f "$tmp_file" "$TASK_STATUS_FILE"
}

task_status_read_progress() {
  local file="${1:-${TASK_STATUS_FILE:-}}"
  [ -n "$file" ] && [ -f "$file" ] || { printf '0\n'; return 0; }
  sed -n 's/.*"progress":\([0-9][0-9]*\).*/\1/p' "$file" | head -n 1
  return 0
}

_parallel_status_value() {
  local file="$1"
  [ -f "$file" ] || return 0
  sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' "$file" | head -n 1
}

_parallel_status_final() {
  case "$1" in
    success|failed|skipped) return 0 ;;
    *) return 1 ;;
  esac
}

_parallel_any_failed_status() {
  local file
  for file in "${PARALLEL_TASK_STATUS_FILES[@]:-}"; do
    [ -n "$file" ] || continue
    [ "$(_parallel_status_value "$file")" = "failed" ] && return 0
  done
  return 1
}

# 面板（以及任何管道/CI）里 stdout 不是 TTY：上面那套 ANSI 重绘直接被丢掉，
# 于是「构建队列」之后整段日志一动不动，看着就像卡死。这里改成一行快照：
# 只在内容变了、或每 PARALLEL_QUEUE_HEARTBEAT_SECONDS（默认 30）秒说一句时打印，
# 既能看到进度往前走，也不会把日志刷满。
_parallel_render_queue_plain() {
  local status_dir="$1" line now last_at
  line="$(python3 - "$status_dir" <<'PY_PLAIN'
from pathlib import Path
import json
import sys

rows = []
for path in sorted(Path(sys.argv[1]).glob('*.json')):
    try:
        rows.append(json.loads(path.read_text(encoding='utf-8')))
    except Exception:
        continue
rows.sort(key=lambda row: int(row.get('sequence', 0) or 0))
parts = []
for row in rows:
    try:
        progress = int(row.get('progress', 0) or 0)
    except Exception:
        progress = 0
    parts.append('%s %s%% %s' % (
        str(row.get('platform', '?')), max(0, min(100, progress)), str(row.get('message', ''))))
print(' | '.join(parts))
PY_PLAIN
)"
  [ -n "$line" ] || return 0
  now="$(date '+%s')"
  last_at="${PARALLEL_PLAIN_QUEUE_LAST_AT:-0}"
  if [ "$line" = "${PARALLEL_PLAIN_QUEUE_LAST_LINE:-}" ] &&
    [ $((now - last_at)) -lt "${PARALLEL_QUEUE_HEARTBEAT_SECONDS:-30}" ]; then
    return 0
  fi
  printf '  [%s] %s\n' "$(date '+%H:%M:%S')" "$line"
  PARALLEL_PLAIN_QUEUE_LAST_LINE="$line"
  PARALLEL_PLAIN_QUEUE_LAST_AT="$now"
}

render_parallel_queue() {
  local status_dir="$1"
  [ "${PARALLEL_LIVE_QUEUE_DISPLAY:-true}" = "true" ] || return 0
  [ -d "$status_dir" ] || return 0
  if [ ! -t 1 ]; then
    _parallel_render_queue_plain "$status_dir"
    return 0
  fi

  printf '\033[2J\033[H'
  python3 - "$status_dir" <<'PY_QUEUE'
from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
rows = []
for path in sorted(root.glob('*.json')):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        continue
    data['_path'] = str(path)
    rows.append(data)
if not rows:
    raise SystemExit(0)

rows.sort(key=lambda row: int(row.get('sequence', 0) or 0))
labels = {
    'queued': '排队中',
    'running': '进行中',
    'waiting': '等待中',
    'success': '成功',
    'failed': '失败',
    'skipped': '已跳过',
}
platforms = [
    ('android', 'Android'),
    ('ios', 'iOS'),
    ('harmony', 'HarmonyOS'),
]
counts = {key: 0 for key in labels}
for row in rows:
    counts[str(row.get('status', ''))] = counts.get(str(row.get('status', '')), 0) + 1

print('========================================')
print(' 构建队列')
print('========================================')
print('进行中 %s    等待中 %s    排队中 %s    成功 %s    失败 %s' % (
    counts.get('running', 0), counts.get('waiting', 0),
    counts.get('queued', 0), counts.get('success', 0), counts.get('failed', 0)))
for platform, title in platforms:
    group = [row for row in rows if row.get('platform') == platform]
    if not group:
        continue
    running = sum(1 for row in group if row.get('status') in ('running', 'waiting'))
    success = sum(1 for row in group if row.get('status') == 'success')
    failed = sum(1 for row in group if row.get('status') == 'failed')
    print('')
    print('[%s]  运行 %s/%s  成功 %s  失败 %s' % (title, running, len(group), success, failed))
    for row in group:
        status = str(row.get('status', 'queued'))
        label = labels.get(status, status)
        try:
            progress = int(row.get('progress', 0) or 0)
        except Exception:
            progress = 0
        progress = max(0, min(100, progress))
        filled = int(round(progress / 10))
        bar = '█' * filled + '░' * (10 - filled)
        project = str(row.get('project', 'unknown'))
        message = str(row.get('message', ''))
        print('  %02d  %-28s %-6s [%s] %3d%%  %s' % (
            int(row.get('sequence', 0) or 0), project, label, bar, progress, message))
print('')
print('========================================')
PY_QUEUE
}

_parallel_prune_logs() {
  [ -d "$LOG_ROOT/parallel" ] || return 0
  local count=0 dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    count=$((count + 1))
    [ "$count" -gt "${KEEP_LOG_COUNT:-5}" ] && rm -rf "$dir"
  done < <(find "$LOG_ROOT/parallel" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | xargs -0 ls -dt 2>/dev/null)
}

_start_parallel_task() {
  local index="$1"
  local platform="${PARALLEL_TASK_PLATFORMS[$index]}"
  local project_id="${PARALLEL_TASK_PROJECTS[$index]}"
  local status_file="${PARALLEL_TASK_STATUS_FILES[$index]}"
  local console_file="${PARALLEL_TASK_CONSOLE_FILES[$index]}"
  local exit_file="${PARALLEL_TASK_EXIT_FILES[$index]}"
  local artifact_file="${PARALLEL_TASK_ARTIFACT_FILES[$index]}"
  local pid
  export TASK_STATUS_FILE="$status_file"
  export TASK_ARTIFACT_FILE="$artifact_file"
  export TASK_PLATFORM="$platform"
  export TASK_PROJECT="$project_id"
  export TASK_SEQUENCE="$index"

  if [ "${PARALLEL_PRINT_CHILD_LOGS:-false}" = "true" ]; then
    (
      if [ "${PARALLEL_SINGLE_TASK_INTERACTIVE:-0}" = "1" ]; then
        unset APP_PACKAGER_NONINTERACTIVE
      else
        export APP_PACKAGER_NONINTERACTIVE=1
      fi
      task_status_write running 1 "准备中"
      if parallel_run_build_task "$platform" "$project_id"; then
        task_status_write success 100 "已完成"
        printf '0\n' >"$exit_file"
      else
        local rc=$?
        local progress
        progress="$(task_status_read_progress "$status_file")"
        task_status_write failed "${progress:-0}" "失败"
        printf '%s\n' "$rc" >"$exit_file"
      fi
    ) &
  else
    (
      if [ "${PARALLEL_SINGLE_TASK_INTERACTIVE:-0}" = "1" ]; then
        unset APP_PACKAGER_NONINTERACTIVE
      else
        export APP_PACKAGER_NONINTERACTIVE=1
      fi
      task_status_write running 1 "准备中"
      if parallel_run_build_task "$platform" "$project_id"; then
        task_status_write success 100 "已完成"
        printf '0\n' >"$exit_file"
      else
        local rc=$?
        local progress
        progress="$(task_status_read_progress "$status_file")"
        task_status_write failed "${progress:-0}" "失败"
        printf '%s\n' "$rc" >"$exit_file"
      fi
    ) >"$console_file" 2>&1 &
  fi
  pid=$!
  PARALLEL_TASK_PIDS[$index]="$pid"
}

run_parallel_build_queue() {
  local -a tasks=("$@")
  parallel_init
  local task_count="${#tasks[@]}" max_jobs="$PARALLEL_MAX_JOBS_RESOLVED"
  local run_dir stamp index=0 task platform project_id
  local -a PARALLEL_TASK_PLATFORMS=()
  local -a PARALLEL_TASK_PROJECTS=()
  local -a PARALLEL_TASK_STATUS_FILES=()
  local -a PARALLEL_TASK_CONSOLE_FILES=()
  local -a PARALLEL_TASK_EXIT_FILES=()
  local -a PARALLEL_TASK_ARTIFACT_FILES=()
  local -a PARALLEL_TASK_PIDS=()
  local stop_launching=0 failed=0 running_total=0 pending=0 active=0

  stamp="$(date '+%Y%m%d-%H%M%S')-$$"
  run_dir="$LOG_ROOT/parallel/$stamp"
  mkdir -p "$run_dir/status"

  for task in "${tasks[@]}"; do
    [ -n "$task" ] || continue
    IFS=$'\t' read -r platform project_id <<<"$task"
    [ -n "$platform" ] && [ -n "$project_id" ] || continue
    index=$((index + 1))
    local status_file="$run_dir/status/${index}.json"
    PARALLEL_TASK_PLATFORMS[$index]="$platform"
    PARALLEL_TASK_PROJECTS[$index]="$project_id"
    PARALLEL_TASK_STATUS_FILES[$index]="$status_file"
    PARALLEL_TASK_CONSOLE_FILES[$index]="$run_dir/${index}-${platform}-${project_id}.console.log"
    PARALLEL_TASK_EXIT_FILES[$index]="$run_dir/${index}-${platform}-${project_id}.exit"
    PARALLEL_TASK_ARTIFACT_FILES[$index]="$run_dir/${index}-${platform}-${project_id}.artifact.path"
    TASK_STATUS_FILE="$status_file" TASK_PLATFORM="$platform" TASK_PROJECT="$project_id" TASK_SEQUENCE="$index" \
      task_status_write queued 0 "排队中"
  done

  printf '\n========== 构建队列 ==========\n'
  parallel_config_summary
  printf '任务数=%s，最大同时执行=%s\n' "$task_count" "$max_jobs"
  printf '每个任务独立日志；主日志目录: %s\n' "$run_dir"
  render_parallel_queue "$run_dir/status"

  while :; do
    if [ "$PARALLEL_FAIL_FAST" = "true" ] && _parallel_any_failed_status; then
      stop_launching=1
    fi

    running_total=0
    local running_ios=0 running_android=0 running_harmony=0
    index=1
    while [ "$index" -le "$task_count" ]; do
      local status_file="${PARALLEL_TASK_STATUS_FILES[$index]}"
      local status
      status="$(_parallel_status_value "$status_file")"
      case "$status" in running|waiting) ;; *) index=$((index + 1)); continue;; esac
      local pid="${PARALLEL_TASK_PIDS[$index]:-}"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        running_total=$((running_total + 1))
        case "${PARALLEL_TASK_PLATFORMS[$index]}" in
          ios) running_ios=$((running_ios + 1)) ;;
          android) running_android=$((running_android + 1)) ;;
          harmony) running_harmony=$((running_harmony + 1)) ;;
        esac
      fi
      index=$((index + 1))
    done

    index=1
    while [ "$index" -le "$task_count" ]; do
      local status_file="${PARALLEL_TASK_STATUS_FILES[$index]}"
      local status
      status="$(_parallel_status_value "$status_file")"
      [ "$status" = "queued" ] || { index=$((index + 1)); continue; }
      if [ "$stop_launching" = "1" ]; then
        TASK_STATUS_FILE="$status_file" TASK_PLATFORM="${PARALLEL_TASK_PLATFORMS[$index]}" \
          TASK_PROJECT="${PARALLEL_TASK_PROJECTS[$index]}" TASK_SEQUENCE="$index" \
          task_status_write failed 0 "未执行（fail-fast）"
        index=$((index + 1))
        continue
      fi
      [ "$running_total" -lt "$max_jobs" ] || break
      local platform="${PARALLEL_TASK_PLATFORMS[$index]}"
      local limit
      limit="$(parallel_platform_limit "$platform")"
      case "$platform" in
        ios) [ "$running_ios" -lt "$limit" ] || { index=$((index + 1)); continue; } ;;
        android) [ "$running_android" -lt "$limit" ] || { index=$((index + 1)); continue; } ;;
        harmony) [ "$running_harmony" -lt "$limit" ] || { index=$((index + 1)); continue; } ;;
      esac
      _start_parallel_task "$index"
      running_total=$((running_total + 1))
      case "$platform" in
        ios) running_ios=$((running_ios + 1)) ;;
        android) running_android=$((running_android + 1)) ;;
        harmony) running_harmony=$((running_harmony + 1)) ;;
      esac
      index=$((index + 1))
    done

    render_parallel_queue "$run_dir/status"

    pending=0
    active=0
    index=1
    while [ "$index" -le "$task_count" ]; do
      local status_file="${PARALLEL_TASK_STATUS_FILES[$index]}"
      local status
      status="$(_parallel_status_value "$status_file")"
      case "$status" in
        queued) pending=$((pending + 1)) ;;
        running|waiting)
          local pid="${PARALLEL_TASK_PIDS[$index]:-}"
          if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            active=$((active + 1))
          else
            wait "$pid" 2>/dev/null || true
            if ! _parallel_status_final "$(_parallel_status_value "$status_file")"; then
              local progress
              progress="$(task_status_read_progress "$status_file")"
              TASK_STATUS_FILE="$status_file" TASK_PLATFORM="${PARALLEL_TASK_PLATFORMS[$index]}" \
                TASK_PROJECT="${PARALLEL_TASK_PROJECTS[$index]}" TASK_SEQUENCE="$index" \
                task_status_write failed "${progress:-0}" "进程异常退出"
            fi
            PARALLEL_TASK_PIDS[$index]=""
          fi
          ;;
      esac
      index=$((index + 1))
    done

    [ "$pending" -eq 0 ] && [ "$active" -eq 0 ] && break
    sleep "${PARALLEL_QUEUE_REFRESH_SECONDS_RESOLVED:-1}"
  done

  index=1
  while [ "$index" -le "$task_count" ]; do
    local pid="${PARALLEL_TASK_PIDS[$index]:-}"
    [ -n "$pid" ] && wait "$pid" 2>/dev/null || true
    local final_status
    final_status="$(_parallel_status_value "${PARALLEL_TASK_STATUS_FILES[$index]}")"
    if [ "$final_status" = "failed" ]; then
      failed=1
      printf '[任务失败] %s / %s，日志: %s\n' \
        "${PARALLEL_TASK_PLATFORMS[$index]}" "${PARALLEL_TASK_PROJECTS[$index]}" \
        "${PARALLEL_TASK_CONSOLE_FILES[$index]}" >&2
      if [ "${PARALLEL_PRINT_CHILD_LOGS:-false}" != "true" ] && [ -f "${PARALLEL_TASK_CONSOLE_FILES[$index]}" ]; then
        tail -n 160 "${PARALLEL_TASK_CONSOLE_FILES[$index]}" >&2 || true
      fi
    fi
    index=$((index + 1))
  done

  render_parallel_queue "$run_dir/status"
  if should_show_build_paths; then
    printf '\n产物文件地址:\n'
    local printed_artifact=0 path_file artifact_path task_status
    index=1
    while [ "$index" -le "$task_count" ]; do
      task_status="$(_parallel_status_value "${PARALLEL_TASK_STATUS_FILES[$index]}")"
      path_file="${PARALLEL_TASK_ARTIFACT_FILES[$index]}"
      if [ "$task_status" = "success" ] && [ -s "$path_file" ]; then
        artifact_path="$(cat "$path_file" 2>/dev/null || true)"
        [ -n "$artifact_path" ] && {
          printf '  [%s] %s: %s\n' "${PARALLEL_TASK_PLATFORMS[$index]}" \
            "${PARALLEL_TASK_PROJECTS[$index]}" "$artifact_path"
          printed_artifact=1
        }
      fi
      index=$((index + 1))
    done
    [ "$printed_artifact" -eq 1 ] || printf '  无可列出的成功产物\n'
  fi
  _parallel_prune_logs
  printf '========== 构建队列结束 ==========\n'
  [ "$failed" -eq 0 ] || return 1
  return 0
}

run_build_tasks() {
  local -a tasks=("$@")
  local task_count="${#tasks[@]}"
  [ "$task_count" -gt 0 ] || return 0
  parallel_init

  if [ "$task_count" -eq 1 ]; then
    export PARALLEL_SINGLE_TASK_INTERACTIVE=1
  else
    export PARALLEL_SINGLE_TASK_INTERACTIVE=0
  fi

  if { [ "$task_count" -gt 1 ] && [ "$PARALLEL_BUILD_ENABLED" = "true" ] && \
    [ "$PARALLEL_MAX_JOBS_RESOLVED" -gt 1 ]; } || \
    { [ "$task_count" -eq 1 ] && [ "${PARALLEL_LIVE_QUEUE_DISPLAY:-true}" = "true" ] && [ -t 1 ]; }; then
    run_parallel_build_queue "${tasks[@]}"
    return $?
  fi

  local task platform project_id rc=0 task_rc=0
  for task in "${tasks[@]}"; do
    IFS=$'\t' read -r platform project_id <<<"$task"
    [ -n "$platform" ] && [ -n "$project_id" ] || continue
    if with_semaphore "platform-$platform" "$(parallel_platform_limit "$platform")" \
      parallel_run_build_task "$platform" "$project_id"; then
      continue
    fi
    task_rc=$?
    [ "$rc" -eq 0 ] && rc="$task_rc"
    [ "$PARALLEL_FAIL_FAST" = "true" ] && return "$task_rc"
  done
  return "$rc"
}
