# shellcheck shell=bash

# 安装包上传扩展层。
# 打包流程只负责提供 BUILD_INFO_FILE，上传失败不回滚打包结果。

UPLOAD_PLATFORM_IDS="${UPLOAD_PLATFORM_IDS:-pgyer}"
UPLOAD_SELECTED_PLATFORMS="${UPLOAD_SELECTED_PLATFORMS:-}"

upload_platform_ids() {
  printf '%s' "${UPLOAD_PLATFORM_IDS:-}" \
    | sed -E 's/[，,;；[:space:]]+/ /g' \
    | tr ' ' '\n' \
    | awk '/^[A-Za-z0-9_]+$/ && !seen[$0]++'
}

upload_platform_var() {
  local provider="$1" field="$2" var value
  var="UPLOAD_PLATFORM_${provider}_${field}"
  value="${!var:-}"
  printf '%s\n' "$value"
}

upload_platform_name() {
  local name
  name="$(upload_platform_var "$1" NAME)"
  printf '%s\n' "${name:-$1}"
}

upload_platform_enabled() {
  local provider="$1" configured enabled
  for configured in $(upload_platform_ids); do
    [ "$configured" = "$provider" ] || continue
    enabled="$(upload_platform_var "$provider" ENABLED)"
    [ "${enabled:-true}" = "true" ]
    return $?
  done
  return 1
}

upload_platform_supports_artifact() {
  local provider="$1" platform="$2" platforms
  platforms="$(upload_platform_var "$provider" PLATFORMS)"
  case " $platforms " in
    *" $platform "*) return 0 ;;
    *) return 1 ;;
  esac
}

upload_platform_load_script() {
  local provider="$1" script
  script="$(upload_platform_var "$provider" SCRIPT)"
  [ -n "$script" ] || script="lib/uploaders/${provider}.sh"
  case "$script" in
    /*) ;;
    *) script="$PIPELINE_ROOT/$script" ;;
  esac
  [ -f "$script" ] || return 1
  # shellcheck source=/dev/null
  source "$script"
}

upload_platform_supports_any() {
  local provider="$1" platforms="$2" platform
  for platform in $platforms; do
    upload_platform_supports_artifact "$provider" "$platform" && return 0
  done
  return 1
}

upload_platform_available() {
  local provider="$1" function_name
  upload_platform_enabled "$provider" || return 1
  upload_platform_load_script "$provider" || return 1
  function_name="$(upload_platform_var "$provider" FUNCTION)"
  [ -n "$function_name" ] && declare -F "$function_name" >/dev/null 2>&1
}

upload_root_dir() {
  printf '%s\n' "${UPLOAD_ROOT:-${LOG_ROOT:-$PIPELINE_ROOT/logs}/uploads}"
}

build_info_field() {
  local info_file="$1" key="$2"
  node -e '
    const fs = require("fs");
    const [info, key] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(info, "utf8"));
    const value = data[key];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$info_file" "$key"
}

set_upload_platforms() {
  local input="$1" provider selected=""
  for provider in $(printf '%s' "$input" | sed -E 's/[，,;；[:space:]]+/ /g'); do
    if ! upload_platform_enabled "$provider"; then
      warn "未启用或未知的上传平台: $provider"
      continue
    fi
    if ! upload_platform_available "$provider"; then
      warn "上传平台尚未实现: $provider"
      continue
    fi
    case ",$selected," in
      *",$provider,"*) ;;
      *) [ -n "$selected" ] && selected="$selected,$provider" || selected="$provider" ;;
    esac
  done
  UPLOAD_SELECTED_PLATFORMS="$selected"
  export UPLOAD_SELECTED_PLATFORMS
}

prompt_upload_platforms() {
  local build_platforms="${1:-ios android harmony}" answer="" provider index=1
  local -a candidates=()
  local -a names=()

  for provider in $(upload_platform_ids); do
    upload_platform_available "$provider" || continue
    upload_platform_supports_any "$provider" "$build_platforms" || continue
    candidates+=("$provider")
    names+=("$(upload_platform_name "$provider")")
  done

  UPLOAD_SELECTED_PLATFORMS=""
  export UPLOAD_SELECTED_PLATFORMS
  [ "${#candidates[@]}" -gt 0 ] || return 0

  printf '\n是否需要上传安装包？\n'
  printf '  0) 不上传\n'
  for provider in "${candidates[@]}"; do
    printf '  %s) %s\n' "$index" "$(upload_platform_name "$provider")"
    index=$((index + 1))
  done
  printf '请选择上传平台（可多选，如 1 或 1,2；直接回车不上传）: '
  read -r answer || answer=""

  case "$answer" in
    ''|0|n|N|no|NO|不上传) return 0 ;;
  esac

  local token choice selected=""
  answer="$(printf '%s' "$answer" | sed -E 's/[，,、;；[:space:]]+/ /g')"
  for token in $answer; do
    case "$token" in
      0|n|N|no|NO)
        UPLOAD_SELECTED_PLATFORMS=""
        export UPLOAD_SELECTED_PLATFORMS
        return 0
        ;;
      *[!0-9]*)
        warn "忽略无效上传平台编号: $token"
        continue
        ;;
    esac
    choice="$token"
    if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#candidates[@]}" ]; then
      warn "忽略超出范围的上传平台编号: $choice"
      continue
    fi
    provider="${candidates[$((choice - 1))]}"
    case ",$selected," in
      *",$provider,"*) ;;
      *) [ -n "$selected" ] && selected="$selected,$provider" || selected="$provider" ;;
    esac
  done

  set_upload_platforms "$selected"
  if [ -n "${UPLOAD_SELECTED_PLATFORMS:-}" ]; then
    printf '已选择上传平台: %s\n' "$(printf '%s' "$UPLOAD_SELECTED_PLATFORMS" | tr ',' ' ')"
  else
    printf '未选择上传平台，仅执行打包。\n'
  fi
}

upload_artifact_with_platform() {
  local provider="$1" info_file="$2" function_name
  if ! upload_platform_load_script "$provider"; then
    warn "上传平台缺少 provider 脚本: $provider"
    return 1
  fi
  function_name="$(upload_platform_var "$provider" FUNCTION)"
  if [ -z "$function_name" ] || ! declare -F "$function_name" >/dev/null 2>&1; then
    warn "上传平台缺少 provider 函数: $provider"
    return 1
  fi
  "$function_name" "$info_file"
}

run_post_build_uploads() {
  local info_file="${1:-${BUILD_INFO_FILE:-}}" provider artifact_platform strict="${2:-false}" status=0
  [ -n "${UPLOAD_SELECTED_PLATFORMS:-}" ] || return 0
  if [ -z "$info_file" ] || [ ! -f "$info_file" ]; then
    warn "上传跳过：未找到构建信息文件"
    [ "$strict" = "true" ] && return 1
    return 0
  fi

  artifact_platform="$(build_info_field "$info_file" platform 2>/dev/null || true)"
  [ -n "$artifact_platform" ] || {
    warn "上传跳过：构建信息缺少 platform: $info_file"
    [ "$strict" = "true" ] && return 1
    return 0
  }

  for provider in $(printf '%s' "$UPLOAD_SELECTED_PLATFORMS" | tr ',' ' '); do
    if ! upload_platform_enabled "$provider"; then
      warn "上传跳过：平台未启用: $provider"
      status=1
      continue
    fi
    if ! upload_platform_supports_artifact "$provider" "$artifact_platform"; then
      log "上传跳过：$(upload_platform_name "$provider") 不支持 $(printf '%s' "$artifact_platform" | tr '[:lower:]' '[:upper:]') 安装包"
      status=1
      continue
    fi
    if ! upload_artifact_with_platform "$provider" "$info_file"; then
      warn "上传失败但不影响打包结果: $(upload_platform_name "$provider") / $artifact_platform"
      status=1
    fi
  done
  # 打包流程把上传当附加步骤（失败也不回滚打包），独立上传流程则要把失败如实返回。
  [ "$strict" = "true" ] && return "$status"
  return 0
}

# ---------------------------------------------------------------------------
# 独立上传流程（打包工具.command upload）
#
# 打包和上传是两件事：upload 只读「上一次打包」留下的 build-info.json，把当时
# 归档的安装包送到分发平台，不触发任何构建。
# ---------------------------------------------------------------------------

upload_latest_info_file() {
  local platform="$1"
  case "$platform" in
    ios) printf '%s\n' "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest.json" ;;
    android) printf '%s\n' "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest.json" ;;
    harmony) printf '%s\n' "$PACKAGE_HARMONY_DIR/${PROJECT_ID}-latest.json" ;;
    *) return 1 ;;
  esac
}

upload_enabled_platforms() {
  local id
  for id in $(upload_platform_ids); do
    upload_platform_enabled "$id" && printf '%s\n' "$id"
  done
}

upload_latest_artifact() {
  local platform="$1" info_file
  info_file="$(upload_latest_info_file "$platform")" || die "upload 不认识平台: $platform"
  if [ ! -f "$info_file" ]; then
    warn "上传跳过：$(printf '%s' "$platform" | tr '[:lower:]' '[:upper:]') 还没有打包记录（${info_file}），先打包一次"
    return 1
  fi
  log "上传 $(printf '%s' "$platform" | tr '[:lower:]' '[:upper:]') 最近一次打包的安装包"
  BUILD_INFO_FILE="$info_file"
  export BUILD_INFO_FILE
  run_post_build_uploads "$info_file" true
}
