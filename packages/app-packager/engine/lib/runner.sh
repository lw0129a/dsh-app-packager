#!/usr/bin/env bash
set -euo pipefail

if [ -z "${PIPELINE_ROOT:-}" ]; then
  PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/common.sh"
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/config/settings.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/parallel.env" ] && source "$PIPELINE_ROOT/config/parallel.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/upload.env" ] && source "$PIPELINE_ROOT/config/upload.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/settings.local.env" ] && source "$PIPELINE_ROOT/config/settings.local.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/parallel.local.env" ] && source "$PIPELINE_ROOT/config/parallel.local.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/upload.local.env" ] && source "$PIPELINE_ROOT/config/upload.local.env"
parallel_init

ACTION="build"
PLATFORM=""
PROJECT_ID=""
CLI_VERSION=""
CLI_KEEP_WORK=0
UPLOAD_SELECTED_PLATFORMS=""

usage() {
  cat <<'USAGE'
打包工具统一入口

用法:
  打包工具.command ios <项目ID> [选项]
  打包工具.command android <项目ID> [选项]
  打包工具.command harmony <项目ID> [选项]
  打包工具.command ios --all [选项]
  打包工具.command android --all [选项]
  打包工具.command harmony --all [选项]
  打包工具.command all [项目ID] [选项]
  打包工具.command list
  打包工具.command check ios <项目ID>
  打包工具.command check android <项目ID>
  打包工具.command check harmony <项目ID>

项目:
  从 config/projects/*.env 动态读取，不在本仓库内置业务项目。

设备/平台:
  ios         苹果 IPA
  android     安卓 APK
  harmony     鸿蒙 HAP
  all         全部平台和已启用项目

并行构建:
  config/parallel.env        人工维护总并发、平台并发和重型工具限制
  config/parallel.local.env  本机并行覆盖配置，Git 忽略

上传配置:
  config/upload.env        人工维护上传平台、接口和轮询参数
  config/upload.local.env  本机 API Key、P12 密码，Git 忽略

选项:
  --version <版本>    覆盖 manifest 中的 versionName
  --keep-work         保留隔离构建工作区
  --harmony-debug     使用项目 default debug signingConfig 生成可侧载 HAP
  --upload <平台>     打包成功后上传；当前支持 pgyer，可逗号分隔多个平台
  --no-upload         显式跳过上传
  --all               当前平台的所有已启用项目
  -h, --help          查看帮助

示例:
  打包工具.command ios <项目ID>
  打包工具.command android <项目ID>
  打包工具.command harmony <项目ID>
  打包工具.command ios --all
  打包工具.command android --all
  打包工具.command harmony --all
  打包工具.command android <项目ID> --upload pgyer
  打包工具.command all <项目ID> --upload pgyer
  打包工具.command all
USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      list) ACTION="list"; shift ;;
      check) ACTION="check"; shift ;;
      ios|apple|苹果) PLATFORM="ios"; shift ;;
      android|安卓) PLATFORM="android"; shift ;;
      harmony|harmonyos|鸿蒙) PLATFORM="harmony"; shift ;;
      all) PLATFORM="all"; shift ;;
      --all) PROJECT_ID="__ALL__"; shift ;;
      --version)
        [ "$#" -ge 2 ] || die "--version 缺少参数"
        CLI_VERSION="$2"; shift 2 ;;
      --keep-work) CLI_KEEP_WORK=1; shift ;;
      --harmony-debug) export HARMONY_PACKAGE_KIND="debug"; shift ;;
      --upload)
        [ "$#" -ge 2 ] || die "--upload 缺少平台参数"
        set_upload_platforms "$2"
        [ -n "$UPLOAD_SELECTED_PLATFORMS" ] || die "--upload 未解析到可用平台: $2"
        shift 2 ;;
      --no-upload)
        UPLOAD_SELECTED_PLATFORMS=""
        export UPLOAD_SELECTED_PLATFORMS
        shift ;;
      -h|--help) usage; exit 0 ;;
      --*) die "未知参数: $1" ;;
      *)
        [ -z "$PROJECT_ID" ] || die "只能指定一个项目"
        PROJECT_ID="$1"; shift ;;
    esac
  done
}

ios_project_ids() {
  local id file
  for id in $(project_ids); do
    file="$PIPELINE_ROOT/config/projects/$id.env"
    (
      # shellcheck source=/dev/null
      source "$file"
      [ "${IOS_ENABLED:-true}" = "true" ] && printf '%s\n' "${PROJECT_ID:-$id}"
    )
  done
}

android_project_ids() {
  local id file
  for id in $(project_ids); do
    file="$PIPELINE_ROOT/config/projects/$id.env"
    (
      # shellcheck source=/dev/null
      source "$file"
      [ "${ANDROID_ENABLED:-false}" = "true" ] && printf '%s\n' "${PROJECT_ID:-$id}"
    )
  done
}

harmony_project_ids() {
  local id file
  for id in $(project_ids); do
    file="$PIPELINE_ROOT/config/projects/$id.env"
    (
      # shellcheck source=/dev/null
      source "$file"
      [ "${HARMONY_ENABLED:-true}" = "true" ] && printf '%s\n' "${PROJECT_ID:-$id}"
    )
  done
}

project_platform_enabled() {
  local id="$1" platform="$2" candidate
  case "$platform" in
    ios)
      while IFS= read -r candidate; do
        [ "$candidate" = "$id" ] && return 0
      done < <(ios_project_ids)
      ;;
    android)
      while IFS= read -r candidate; do
        [ "$candidate" = "$id" ] && return 0
      done < <(android_project_ids)
      ;;
    harmony)
      while IFS= read -r candidate; do
        [ "$candidate" = "$id" ] && return 0
      done < <(harmony_project_ids)
      ;;
    *)
      return 1
      ;;
  esac
  return 1
}

selected_projects() {
  local platform="$1"
  if [ "$PROJECT_ID" = "__ALL__" ]; then
    case "$platform" in
      ios) ios_project_ids ;;
      android) android_project_ids ;;
      harmony) harmony_project_ids ;;
      *) die "未知平台: $platform" ;;
    esac
  else
    [ -n "$PROJECT_ID" ] || die "请指定项目 ID"
    printf '%s\n' "$PROJECT_ID"
  fi
}

run_ios() {
  local id="$1"
  project_platform_enabled "$id" ios || die "项目 $id 未启用 iOS 打包"
  ios_sdk_uniappx_ready || die "缺少符合 uni-app x 分包流程的 iOS SDK（需要 UniAppXDemo/UniAppXDemo.xcodeproj）。请运行 sdk/处理SDK.command 导入正确版本"
  ( build_ios_project "$id" )
}

run_android() {
  local id="$1"
  project_platform_enabled "$id" android || die "项目 $id 未启用 Android 打包"
  android_sdk_ready || die "缺少 Android 离线 SDK。请先运行 sdk/处理SDK.command 或 初始化.command 导入 Android SDK"
  ( build_android_project "$id" )
}

run_harmony() {
  local id="$1"
  project_platform_enabled "$id" harmony || die "项目 $id 未启用 HarmonyOS 打包"
  harmony_sdk_ready || die "缺少 HarmonyOS Runtime。请先运行 sdk/处理SDK.command 或 初始化.command 安装"
  [ -d "$DEVECO_STUDIO_APP" ] || die "未检测到 DevEco Studio: $DEVECO_STUDIO_APP"
  ( build_harmony_project "$id" )
}

list_projects() {
  printf '%-12s %-22s %-6s %-8s %-10s %s\n' 'ID' '名称' 'iOS' 'Android' 'Harmony' '源码目录'
  local id found=0
  for id in $(project_ids); do
    found=$((found + 1))
    (
      load_project "$id"
      printf '%-12s %-22s %-6s %-8s %-10s %s\n' \
        "$PROJECT_ID" "$DISPLAY_NAME" "${IOS_ENABLED:-true}" "${ANDROID_ENABLED:-false}" "${HARMONY_ENABLED:-true}" "$SOURCE_DIR"
    )
  done
  if [ "$found" -eq 0 ]; then
    printf '未发现项目。请将 uni-app x 项目放到 %s 同级目录，或运行初始化向导。\n' "$PIPELINE_ROOT"
  fi
}

run_build_runner() {
  local runner="$1" id status=0
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    "$runner" "$id" || return $?
  done
  return "$status"
}

run_build_platform_projects() {
  local platform="$1" id
  local -a tasks=()
  while IFS= read -r id; do
    [ -n "$id" ] && tasks+=("${platform}"$'\t'"${id}")
  done
  run_build_tasks "${tasks[@]}"
}

run_all_enabled_build_tasks() {
  local id
  local -a tasks=()
  while IFS= read -r id; do
    [ -n "$id" ] && tasks+=("ios"$'\t'"${id}")
  done < <(ios_project_ids)
  while IFS= read -r id; do
    [ -n "$id" ] && tasks+=("android"$'\t'"${id}")
  done < <(android_project_ids)
  while IFS= read -r id; do
    [ -n "$id" ] && tasks+=("harmony"$'\t'"${id}")
  done < <(harmony_project_ids)
  run_build_tasks "${tasks[@]}"
}

run_project_build_tasks() {
  local id="$1"
  local -a tasks=()
  project_platform_enabled "$id" ios && tasks+=("ios"$'\t'"${id}")
  project_platform_enabled "$id" android && tasks+=("android"$'\t'"${id}")
  project_platform_enabled "$id" harmony && tasks+=("harmony"$'\t'"${id}")
  run_build_tasks "${tasks[@]}"
}

run_check_runner() {
  local runner="$1" id status=0 run_status=0
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    run_status=0
    "$runner" "$id" || run_status=$?
    if [ "$run_status" -ne 0 ] && [ "$status" -eq 0 ]; then
      status="$run_status"
    fi
  done
  return "$status"
}

main() {
  parse_args "$@"

  if [ "$ACTION" = "list" ]; then
    list_projects
    return 0
  fi

  local status=0
  case "$ACTION" in
    check)
      case "$PLATFORM" in
        ios) run_check_runner check_ios_project < <(selected_projects ios); return $? ;;
        android) run_check_runner check_android_project < <(selected_projects android); return $? ;;
        harmony) run_check_runner check_harmony_project < <(selected_projects harmony); return $? ;;
        all)
          local run_status=0
          run_status=0
          run_check_runner check_ios_project < <(ios_project_ids) || run_status=$?
          if [ "$run_status" -ne 0 ] && [ "$status" -eq 0 ]; then status="$run_status"; fi
          run_status=0
          run_check_runner check_android_project < <(android_project_ids) || run_status=$?
          if [ "$run_status" -ne 0 ] && [ "$status" -eq 0 ]; then status="$run_status"; fi
          run_status=0
          run_check_runner check_harmony_project < <(harmony_project_ids) || run_status=$?
          if [ "$run_status" -ne 0 ] && [ "$status" -eq 0 ]; then status="$run_status"; fi
          return "$status" ;;
        *) die "check 需要指定 ios、android、harmony 或 all" ;;
      esac
      ;;
    build)
      case "$PLATFORM" in
        ios) run_build_platform_projects ios < <(selected_projects ios); return $? ;;
        android) run_build_platform_projects android < <(selected_projects android); return $? ;;
        harmony) run_build_platform_projects harmony < <(selected_projects harmony); return $? ;;
        all)
          if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "__ALL__" ]; then
            run_all_enabled_build_tasks
          else
            [ -f "$PIPELINE_ROOT/config/projects/${PROJECT_ID}.env" ] || die "未知项目: ${PROJECT_ID}。可用项目: $(project_ids | tr '\n' ' ')"
            run_project_build_tasks "$PROJECT_ID"
          fi
          ;;
        *) die "请指定平台: ios、android、harmony 或 all" ;;
      esac
      return 0 ;;
  esac
}

check_ios_project() {
  load_project "$1"
  local errors=0 warnings=0
  printf '\n========== CHECK: %s (%s) ==========\n' "$PROJECT_ID" "$DISPLAY_NAME"

  if [ -d "$SOURCE_DIR" ]; then
    printf '[OK]   源码目录: %s\n' "$SOURCE_DIR"
  else
    printf '[FAIL] 源码目录不存在: %s\n' "$SOURCE_DIR"; errors=$((errors + 1))
  fi

  if [ -x "$HBUILDERX_CLI" ]; then
    printf '[OK]   HBuilderX CLI: %s\n' "$HBUILDERX_CLI"
  else
    printf '[FAIL] HBuilderX CLI 不存在: %s\n' "$HBUILDERX_CLI"; errors=$((errors + 1))
  fi

  if command -v xcodebuild >/dev/null 2>&1; then
    printf '[OK]   Xcode: %s\n' "$(xcodebuild -version 2>/dev/null | head -n 1)"
  else
    printf '[FAIL] 未找到 xcodebuild\n'; errors=$((errors + 1))
  fi

  local resolved_profile=""
  if [ -n "${EXPECTED_BUNDLE_ID:-}" ]; then
    resolved_profile="$(find_matching_ios_profile "$EXPECTED_BUNDLE_ID" || true)"
  fi
  if [ -n "$resolved_profile" ]; then
    PROFILE_FILE="$resolved_profile"
  fi

  if [ -f "$PROFILE_FILE" ]; then
    local tmp_plist
    tmp_plist="$(mktemp)"
    if read_profile_metadata "$PROFILE_FILE" "$tmp_plist" >/dev/null 2>&1; then
      printf '[OK]   Profile: %s\n' "$PROFILE_NAME"
      printf '       Bundle:  %s\n' "$BUNDLE_ID"
      printf '       Team:    %s\n' "$TEAM_ID"
      printf '       Type:    %s\n' "$PROFILE_KIND"
      printf '       Expiry:  %s\n' "$PROFILE_EXPIRY"
    else
      printf '[FAIL] Profile 无法解析或不匹配: %s\n' "$PROFILE_FILE"; errors=$((errors + 1))
    fi
    rm -f "$tmp_plist"
  else
    printf '[FAIL] Profile 不存在: %s\n' "$PROFILE_FILE"; errors=$((errors + 1))
  fi

  local resolved_p12
  resolved_p12="$(resolve_p12_file || true)"
  if [ -n "$resolved_p12" ]; then
    printf '[OK]   p12: %s\n' "$resolved_p12"
  else
    printf '[FAIL] p12 不存在: %s\n' "$P12_FILE"; errors=$((errors + 1))
  fi

  if security find-generic-password -s "$P12_PASSWORD_SERVICE" -a "$USER" >/dev/null 2>&1; then
    printf '[OK]   Keychain 已保存 p12 密码: %s\n' "$P12_PASSWORD_SERVICE"
  else
    printf '[WARN] Keychain 未保存 p12 密码，运行 setup-signing.sh 配置\n'; warnings=$((warnings + 1))
  fi

  if [ -d "$LOCAL_IOS_SDK_DIR/UniAppXDemo/UniAppXDemo.xcodeproj" ]; then
    printf '[OK]   本地 iOS SDK: %s\n' "$LOCAL_IOS_SDK_DIR"
  else
    printf '[FAIL] 本地 iOS SDK 不完整: %s\n' "$LOCAL_IOS_SDK_DIR"; errors=$((errors + 1))
  fi

  if [ -f "$SOURCE_DIR/$BUILD_SCRIPT_RELATIVE" ]; then
    printf '[OK]   打包脚本: %s\n' "$SOURCE_DIR/$BUILD_SCRIPT_RELATIVE"
  else
    printf '[FAIL] 打包脚本不存在: %s\n' "$SOURCE_DIR/$BUILD_SCRIPT_RELATIVE"; errors=$((errors + 1))
  fi

  printf '结果: errors=%s warnings=%s\n' "$errors" "$warnings"
  [ "$errors" -eq 0 ]
}

build_ios_project() {
  load_project "$1"
  init_run
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  exec > >(tee -a "$LOG_FILE") 2>&1

  printf '\n'
  printf '========================================\n'
  printf ' PROJECT=%s (%s)\n' "$PROJECT_ID" "$DISPLAY_NAME"
  printf ' RUN_ID=%s\n' "$RUN_ID"
  printf ' LOG=%s\n' "$LOG_FILE"
  printf '========================================\n'
  task_progress 5 "初始化构建环境"

  require_cmd rsync
  require_cmd openssl
  require_cmd plutil
  require_cmd security
  require_cmd node
  require_cmd shasum

  if [ -n "$CLI_VERSION" ]; then
    MARKETING_VERSION="$CLI_VERSION"
  else
    local manifest_path=""
    manifest_path="$(project_manifest_path "$SOURCE_DIR" 2>/dev/null || true)"
    if [ -n "$manifest_path" ]; then
      MARKETING_VERSION="$(manifest_version "$manifest_path" || true)"
    else
      MARKETING_VERSION=""
    fi
  fi
  [ -n "${MARKETING_VERSION:-}" ] || warn "未读取到 versionName，将使用 Xcode 工程默认版本"

  log "版本: ${MARKETING_VERSION:-Xcode default}"
  SEMAPHORE_PROGRESS=15 SEMAPHORE_WAIT_MESSAGE="等待工作区准备名额" SEMAPHORE_RUN_MESSAGE="复制隔离工作区" \
    with_semaphore "workspace-prepare" "${PARALLEL_MAX_PREPARE_JOBS_RESOLVED:-2}" prepare_workspace
  sync_full_permissions
  generate_brand_assets
  ensure_hbuilderx
  generate_ios_resources
  task_progress 35 "生成 iOS 资源"
  prepare_profile
  prepare_keychain
  prepare_native_ios_project
  write_package_env
  task_progress 50 "准备签名和 Xcode 工程"
  run_native_build
  task_progress 75 "执行 Xcode Archive"
  verify_ios_custom_uts_plugins "$IPA_SRC"
  collect_artifact
  task_artifact_path "$IPA_FINAL"
  task_progress 90 "归档 IPA"
  print_result
  BUILD_SUCCEEDED=1
  run_upload_stage "$BUILD_INFO_FILE" || true
  task_progress 100 "已完成"
  prune_outputs
}

check_android_project() {
  load_project "$1"
  local errors=0 warnings=0 gradle_bin keystore_properties build_tools
  printf '\n========== ANDROID CHECK: %s ==========\n' "$PROJECT_ID"

  [ "$ANDROID_ENABLED" = "true" ] && printf '[OK]   Android 已启用\n' || { printf '[FAIL] Android 未启用\n'; errors=$((errors + 1)); }
  [ -d "$SOURCE_DIR" ] && printf '[OK]   源码目录: %s\n' "$SOURCE_DIR" || { printf '[FAIL] 源码目录不存在: %s\n' "$SOURCE_DIR"; errors=$((errors + 1)); }
  [ -f "$SOURCE_DIR/${ANDROID_MODULE_DIR:-app-android}/app/build.gradle" ] \
    && printf '[OK]   Android 工程: %s\n' "$SOURCE_DIR/${ANDROID_MODULE_DIR:-app-android}" \
    || { printf '[FAIL] Android 工程不存在\n'; errors=$((errors + 1)); }
  [ -d "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}" ] \
    && printf '[OK]   Android SDK: %s\n' "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}" \
    || { printf '[FAIL] Android SDK 不存在\n'; errors=$((errors + 1)); }

  gradle_bin=""
  if [ "${ANDROID_USE_PROJECT_WRAPPER:-false}" = "true" ] && [ -x "$SOURCE_DIR/${ANDROID_MODULE_DIR:-app-android}/gradlew" ]; then
    gradle_bin="$SOURCE_DIR/${ANDROID_MODULE_DIR:-app-android}/gradlew"
  else
    gradle_bin="${ANDROID_GRADLE_BIN:-}"
    if [ -z "$gradle_bin" ] || [ ! -x "$gradle_bin" ] || ! run_with_timeout 20 "$gradle_bin" --version >/dev/null 2>&1; then
      gradle_bin="$(find_cached_gradle || true)"
    fi
  fi
  if [ -n "$gradle_bin" ] && [ -x "$gradle_bin" ] && run_with_timeout 20 "$gradle_bin" --version >/dev/null 2>&1; then
    printf '[OK]   Gradle: %s\n' "$gradle_bin"
  else
    printf '[FAIL] Gradle 不存在或无法启动: %s\n' "${gradle_bin:-未找到}"; errors=$((errors + 1))
  fi

  build_tools="$(find "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}/build-tools" \
    -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$build_tools" ] && [ -x "$build_tools/apksigner" ] && [ -x "$build_tools/zipalign" ]; then
    printf '[OK]   APK 校验工具: %s\n' "$build_tools"
  else
    printf '[FAIL] Android build-tools 缺少 apksigner 或 zipalign\n'; errors=$((errors + 1))
  fi

  if command -v keytool >/dev/null 2>&1; then
    printf '[OK]   keytool: %s\n' "$(command -v keytool)"
  else
    printf '[FAIL] 未找到 keytool\n'; errors=$((errors + 1))
  fi

  keystore_properties="$(resolve_android_keystore_properties || true)"
  if [ -n "$keystore_properties" ]; then
    printf '[OK]   Release keystore 配置: %s\n' "$keystore_properties"
  else
    printf '[WARN] 未配置 release keystore，将沿用项目内签名配置（当前可能是 debug keystore）\n'
    warnings=$((warnings + 1))
  fi

  printf '结果: errors=%s warnings=%s\n' "$errors" "$warnings"
  [ "$errors" -eq 0 ]
}

check_harmony_project() {
  load_project "$1"
  local errors=0 warnings=0 material p12 alias cert profile sign_alg store_password key_password
  printf '\n========== HARMONY CHECK: %s ==========\n' "$PROJECT_ID"

  [ "$HARMONY_ENABLED" = "true" ] && printf '[OK]   HarmonyOS 已启用\n' || { printf '[FAIL] HarmonyOS 未启用\n'; errors=$((errors + 1)); }
  [ -d "$SOURCE_DIR" ] && printf '[OK]   源码目录: %s\n' "$SOURCE_DIR" || { printf '[FAIL] 源码目录不存在: %s\n' "$SOURCE_DIR"; errors=$((errors + 1)); }
  [ -x "$HBUILDERX_CLI" ] && printf '[OK]   HBuilderX CLI: %s\n' "$HBUILDERX_CLI" || { printf '[FAIL] HBuilderX CLI 不存在\n'; errors=$((errors + 1)); }
  [ -d "$DEVECO_STUDIO_APP" ] && printf '[OK]   DevEco Studio: %s\n' "$DEVECO_STUDIO_APP" || { printf '[FAIL] DevEco Studio 不存在\n'; errors=$((errors + 1)); }
  harmony_sdk_ready && printf '[OK]   HarmonyOS Runtime: %s\n' "$(harmony_sdk_dir)" || { printf '[FAIL] HarmonyOS Runtime 不存在\n'; errors=$((errors + 1)); }

  material="$(WORKSPACE="$SOURCE_DIR" harmony_signing_material || true)"
  if [ -n "$material" ]; then
    IFS=$'\t' read -r p12 alias cert profile sign_alg store_password key_password <<<"$material"
    printf '[OK]   HarmonyOS signingConfigs: %s\n' "$(basename "$profile")"
    printf '[OK]   P12: %s\n' "$p12"
    printf '[OK]   Cert: %s\n' "$cert"
    printf '[OK]   Alias: %s; SignAlg: %s\n' "$alias" "$sign_alg"
    if [ -d "$(dirname "$p12")/material" ]; then
      printf '[OK]   加密密码 material 目录存在\n'
      printf '[OK]   证书文件按 uni-app manifest.json 原样提供给 HBuilderX\n'
    else
      printf '[FAIL] 缺少 HarmonyOS 加密密码必需的 material 目录: %s\n' "$(dirname "$p12")/material"
      errors=$((errors + 1))
    fi
  else
    printf '[FAIL] uni-app signingConfigs 引用的 HarmonyOS 证书文件不完整\n'
    printf '         请确认 manifest.json 中的 storeFile、certpath、profile 均存在\n'
    errors=$((errors + 1))
  fi

  printf '结果: errors=%s warnings=%s\n' "$errors" "$warnings"
  [ "$errors" -eq 0 ]
}

build_harmony_project() {
  load_project "$1"
  [ "$HARMONY_ENABLED" = "true" ] || die "项目 $PROJECT_ID 尚未启用 HarmonyOS 打包"
  init_run
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  exec > >(tee -a "$LOG_FILE") 2>&1

  printf '\n'
  printf '========================================\n'
  printf ' HARMONY PROJECT=%s (%s)\n' "$PROJECT_ID" "$DISPLAY_NAME"
  printf ' RUN_ID=%s\n' "$RUN_ID"
  printf ' LOG=%s\n' "$LOG_FILE"
  printf '========================================\n'
  task_progress 5 "初始化构建环境"

  require_cmd rsync
  require_cmd node
  require_cmd shasum
  require_cmd java
  require_cmd unzip

  if [ -n "$CLI_VERSION" ]; then
    MARKETING_VERSION="$CLI_VERSION"
  else
    local manifest_path=""
    manifest_path="$(project_manifest_path "$SOURCE_DIR" 2>/dev/null || true)"
    if [ -n "$manifest_path" ]; then
      MARKETING_VERSION="$(manifest_version "$manifest_path" || true)"
    else
      MARKETING_VERSION=""
    fi
  fi
  [ -n "${MARKETING_VERSION:-}" ] || MARKETING_VERSION="1.0.0"

  activate_harmony_temporary_install_patch
  SEMAPHORE_PROGRESS=15 SEMAPHORE_WAIT_MESSAGE="等待工作区准备名额" SEMAPHORE_RUN_MESSAGE="复制隔离工作区" \
    with_semaphore "workspace-prepare" "${PARALLEL_MAX_PREPARE_JOBS_RESOLVED:-2}" prepare_workspace
  ensure_hbuilderx
  task_progress 35 "准备 HarmonyOS 编译"
  build_harmony_hap
  task_progress 75 "生成并签名 HAP"
  collect_harmony_artifact
  verify_harmony_pgyer_compat_artifact
  task_artifact_path "$HAP_FINAL"
  task_progress 90 "归档 HAP"
  print_harmony_result
  BUILD_SUCCEEDED=1
  run_upload_stage "$BUILD_INFO_FILE" || true
  task_progress 100 "已完成"
  prune_harmony_outputs
}

build_android_project() {
  load_project "$1"
  [ "$ANDROID_ENABLED" = "true" ] || die "项目 $PROJECT_ID 尚未启用 Android 打包"
  init_run
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  exec > >(tee -a "$LOG_FILE") 2>&1

  printf '\n'
  printf '========================================\n'
  printf ' ANDROID PROJECT=%s (%s)\n' "$PROJECT_ID" "$DISPLAY_NAME"
  printf ' RUN_ID=%s\n' "$RUN_ID"
  printf ' LOG=%s\n' "$LOG_FILE"
  printf '========================================\n'
  task_progress 5 "初始化构建环境"

  require_cmd rsync
  require_cmd node
  require_cmd shasum
  require_cmd find
  require_cmd keytool

  if [ -n "$CLI_VERSION" ]; then
    MARKETING_VERSION="$CLI_VERSION"
  else
    local manifest_path=""
    manifest_path="$(project_manifest_path "$SOURCE_DIR" 2>/dev/null || true)"
    if [ -n "$manifest_path" ]; then
      MARKETING_VERSION="$(manifest_version "$manifest_path" || true)"
    else
      MARKETING_VERSION=""
    fi
  fi
  [ -n "${MARKETING_VERSION:-}" ] || MARKETING_VERSION="1.0.0"

  SEMAPHORE_PROGRESS=15 SEMAPHORE_WAIT_MESSAGE="等待工作区准备名额" SEMAPHORE_RUN_MESSAGE="复制隔离工作区" \
    with_semaphore "workspace-prepare" "${PARALLEL_MAX_PREPARE_JOBS_RESOLVED:-2}" prepare_workspace
  sync_full_permissions
  generate_brand_assets
  ensure_hbuilderx
  generate_android_resources
  task_progress 35 "生成 Android 资源"
  copy_android_resources
  patch_android_project
  task_progress 50 "准备 Android 工程"
  build_android_apk
  task_progress 75 "执行 Gradle assembleRelease"
  verify_android_apk_signature "$APK_SRC"
  verify_android_custom_plugins "$APK_SRC"
  collect_android_artifact
  task_artifact_path "$APK_FINAL"
  task_progress 90 "归档 APK"
  print_android_result
  BUILD_SUCCEEDED=1
  run_upload_stage "$BUILD_INFO_FILE" || true
  task_progress 100 "已完成"
  prune_android_outputs
}
