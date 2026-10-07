#!/usr/bin/env bash
set -euo pipefail

TOOL_NAME="打包工具"
PIPELINE_ROOT="$(cd "$(dirname "$0")" && pwd)"
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/runner.sh"

run_action() {
  set +e
  "$@"
  local status=$?
  set -e
  return "$status"
}

pause() {
  printf '\n按回车返回菜单...'
  read -r _ || true
}

refresh_discovered_projects() {
  register_discovered_projects quiet >/dev/null 2>&1 || true
}

maybe_offer_initialization() {
  refresh_discovered_projects

  local initialized=0
  if [ -f "$PIPELINE_ROOT/config/init.local.env" ] || [ -f "$PIPELINE_ROOT/config/settings.local.env" ]; then
    initialized=1
  fi

  if [ "$initialized" -eq 1 ] && [ -n "$(project_ids)" ]; then
    return 0
  fi

  if [ "$initialized" -eq 0 ]; then
    printf '\n检测到打包工具尚未初始化。\n'
  else
    printf '\n本地环境配置已存在，但还没有读取到可用的 uni-app x 项目。\n'
    printf '请将项目放在 %s 同级目录，或运行初始化向导手动输入项目目录。\n' "$PIPELINE_ROOT"
  fi
  printf '是否现在运行初始化向导？[回车运行 / n 跳过]: '
  local answer=""
  read -r answer || return 0
  case "$answer" in
    n|N|no|NO) return 0 ;;
  esac
  run_action "$PIPELINE_ROOT/初始化.command" || true
}

project_display_name() {
  local id="$1" file source_dir
  file="$PIPELINE_ROOT/config/projects/$id.env"
  [ -f "$file" ] || { printf '%s\n' "$id"; return 0; }

  (
    # shellcheck source=/dev/null
    source "$file"
    source_dir="${SOURCE_DIR:-}"
    if [ -f "$source_dir/manifest.json" ]; then
      eval "$(manifest_metadata "$source_dir/manifest.json")"
      printf '%s\n' "${MANIFEST_NAME:-$id}"
    else
      printf '%s\n' "$id"
    fi
  )
}

packable_project_ids() {
  case "$1" in
    ios) ios_project_ids ;;
    android) android_project_ids ;;
    harmony) harmony_project_ids ;;
    all) project_ids ;;
    *) return 1 ;;
  esac
}

has_packable_projects() {
  [ -n "$(packable_project_ids "$1")" ]
}

platform_label() {
  case "$1" in
    ios) printf 'iOS' ;;
    android) printf 'Android' ;;
    harmony) printf 'HarmonyOS' ;;
    all) printf 'iOS + Android + HarmonyOS' ;;
    *) printf '%s' "$1" ;;
  esac
}

project_source_dir() {
  local file="$PIPELINE_ROOT/config/projects/$1.env"
  [ -f "$file" ] || return 1
  (
    unset SOURCE_DIR
    # shellcheck disable=SC1090
    source "$file" >/dev/null 2>&1 || exit 1
    printf '%s\n' "${SOURCE_DIR:-}"
  )
}

project_platforms() {
  local file="$PIPELINE_ROOT/config/projects/$1.env"
  [ -f "$file" ] || return 1
  (
    local platforms=""
    unset IOS_ENABLED ANDROID_ENABLED HARMONY_ENABLED
    # shellcheck disable=SC1090
    source "$file" >/dev/null 2>&1 || exit 1
    [ "${IOS_ENABLED:-true}" = "true" ] && platforms="iOS"
    if [ "${ANDROID_ENABLED:-false}" = "true" ]; then
      if [ -n "$platforms" ]; then
        platforms="$platforms + Android"
      else
        platforms="Android"
      fi
    fi
    if [ "${HARMONY_ENABLED:-true}" = "true" ]; then
      if [ -n "$platforms" ]; then
        platforms="$platforms + HarmonyOS"
      else
        platforms="HarmonyOS"
      fi
    fi
    [ -n "$platforms" ] || platforms="未启用"
    printf '%s\n' "$platforms"
  )
}

project_reading_flow() {
  local platform="$1" choice project_path
  printf '\n当前没有可打包的 %s 项目。\n' "$(platform_label "$platform")"
  printf '请先读取项目：\n'
  printf '  1) 扫描打包工具同级目录并自动读取\n'
  printf '  2) 手动输入 uni-app x 项目绝对路径\n'
  printf '  0) 返回打包菜单\n'
  printf '请选择: '
  read -r choice || return 1

  case "$choice" in
    1)
      printf '\n扫描同级目录:\n'
      register_discovered_projects || true
      if ! has_packable_projects "$platform"; then
        printf '\n项目读取完成，但仍然没有可打包的 %s 项目。\n' "$(platform_label "$platform")"
        print_registered_projects
        return 1
      fi
      printf '\n项目读取完成:\n'
      print_registered_projects
      return 0
      ;;
    2)
      while true; do
        printf '\n请输入 uni-app x 项目绝对路径（可直接拖入终端，示例: /Users/name/work/your-uniapp-project）: '
        read -r project_path || return 1
        case "$project_path" in
          ''|0) continue ;;
          q|Q) return 1 ;;
        esac
        project_path="${project_path/#\~/$HOME}"
        if register_project_path "$project_path"; then
          if ! has_packable_projects "$platform"; then
            printf '\n项目已读取，但当前仍没有可打包的 %s 项目。\n' "$(platform_label "$platform")"
            print_registered_projects
            return 1
          fi
          printf '\n项目读取完成:\n'
          print_registered_projects
          return 0
        fi
      done
      ;;
    0|"") return 1 ;;
    *) printf '无效选择: %s\n' "$choice"; return 1 ;;
  esac
}

select_project() {
  local platform="${1:-all}" id name source_dir platforms input candidate index
  local -a ids=()

  while IFS= read -r id; do
    [ -n "$id" ] && ids+=("$id")
  done < <(packable_project_ids "$platform")

  if [ "${#ids[@]}" -eq 0 ]; then
    refresh_discovered_projects
    ids=()
    while IFS= read -r id; do
      [ -n "$id" ] && ids+=("$id")
    done < <(packable_project_ids "$platform")
  fi

  if [ "${#ids[@]}" -eq 0 ]; then
    project_reading_flow "$platform" >&2 || return 1
    ids=()
    while IFS= read -r id; do
      [ -n "$id" ] && ids+=("$id")
    done < <(packable_project_ids "$platform")
  fi

  if [ "${#ids[@]}" -eq 0 ]; then
    printf '没有可打包的 %s 项目。\\n' "$(platform_label "$platform")" >&2
    return 1
  fi

  printf '\n可用项目:\n' >&2
  for index in "${!ids[@]}"; do
    id="${ids[$index]}"
    name="$(project_display_name "$id")"
    source_dir="$(project_source_dir "$id" || true)"
    platforms="$(project_platforms "$id" || true)"
    printf '  %2d) %s - %s\n' "$((index + 1))" "$id" "$name" >&2
    printf '      平台: %s\n' "$platforms" >&2
    printf '      地址: %s\n' "$source_dir" >&2
  done

  printf '请选择项目编号或输入项目ID（0 取消）: ' >&2
  if ! read -r input; then
    return 2
  fi

  case "$input" in
    ''|0) return 1 ;;
  esac

  if [[ "$input" =~ ^[0-9]+$ ]]; then
    index="$((input - 1))"
    [ "$index" -ge 0 ] && [ "$index" -lt "${#ids[@]}" ] || {
      printf '无效项目编号: %s\n' "$input" >&2
      return 2
    }
    candidate="${ids[$index]}"
  else
    candidate="$input"
  fi

  if ! printf '%s\n' "${ids[@]}" | grep -qx "$candidate"; then
    printf '未找到项目: %s\n' "$candidate" >&2
    return 2
  fi

  printf '%s\n' "$candidate"
}

build_platform_projects() {
  local platform="$1" id
  local -a tasks=()
  case "$platform" in
    ios)
      while IFS= read -r id; do
        [ -n "$id" ] && tasks+=("ios"$'\t'"${id}")
      done < <(ios_project_ids)
      ;;
    android)
      while IFS= read -r id; do
        [ -n "$id" ] && tasks+=("android"$'\t'"${id}")
      done < <(android_project_ids)
      ;;
    harmony)
      while IFS= read -r id; do
        [ -n "$id" ] && tasks+=("harmony"$'\t'"${id}")
      done < <(harmony_project_ids)
      ;;
  esac
  run_build_tasks "${tasks[@]}"
}

build_all_platforms() {
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

build_project_ios_android() {
  local id="$1"
  local -a tasks=()
  project_platform_enabled "$id" ios && tasks+=("ios"$'\t'"${id}")
  project_platform_enabled "$id" android && tasks+=("android"$'\t'"${id}")
  run_build_tasks "${tasks[@]}"
}

build_project_all_platforms() {
  local id="$1"
  local -a tasks=()
  project_platform_enabled "$id" ios && tasks+=("ios"$'\t'"${id}")
  project_platform_enabled "$id" android && tasks+=("android"$'\t'"${id}")
  project_platform_enabled "$id" harmony && tasks+=("harmony"$'\t'"${id}")
  run_build_tasks "${tasks[@]}"
}


check_all_platforms() {
  local id status=0
  while IFS= read -r id; do
    run_action check_ios_project "$id" || status=$?
  done < <(ios_project_ids)
  while IFS= read -r id; do
    run_action check_android_project "$id" || status=$?
  done < <(android_project_ids)
  while IFS= read -r id; do
    run_action check_harmony_project "$id" || status=$?
  done < <(harmony_project_ids)
  return "$status"
}

generate_local_diagnostic_report() {
  local stamp report log file id status=0
  local -a logs=() artifacts=()
  stamp="$(date '+%Y%m%d-%H%M%S')"
  report="$PIPELINE_ROOT/logs/diagnostics/$stamp-diagnostic.txt"
  mkdir -p "$(dirname "$report")"

  while IFS= read -r -d '' log; do
    logs+=("$log")
  done < <(find "$PIPELINE_ROOT/logs" -mindepth 3 -maxdepth 3 -type f -name 'build.log' -print0 2>/dev/null)

  while IFS= read -r -d '' file; do
    artifacts+=("$file")
  done < <(find "$PIPELINE_ROOT/packages" -type f \( -name '*.ipa' -o -name '*.apk' -o -name '*.app' -o -name '*.hap' \) -print0 2>/dev/null)

  {
    printf '%s本地诊断报告\n' "$TOOL_NAME"
    printf '生成时间: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    printf '说明: 本报告由本机脚本生成，不调用 Codex。\n'
    printf 'PIPELINE_ROOT=%s\n' "$PIPELINE_ROOT"
    printf '\n===== 环境检查 =====\n'
    check_all_platforms 2>&1 || true

    printf '\n===== 并行构建配置 =====\n'
    parallel_config_summary 2>&1 || true

    printf '\n===== 项目与产物状态 =====\n'
    list_projects 2>&1 || true
    for id in $(project_ids); do
      printf '\n%s iOS latest: %s\n' "$id" "$PIPELINE_ROOT/packages/iOS/${id}-latest.ipa"
      printf '%s Android latest: %s\n' "$id" "$PIPELINE_ROOT/packages/Android/${id}-latest.apk"
      printf '%s HarmonyOS latest: %s\n' "$id" "$PIPELINE_ROOT/packages/HarmonyOS/${id}-latest.hap"
    done

    printf '\n===== 最近 5 份构建日志的末尾 =====\n'
    if [ "${#logs[@]}" -gt 0 ]; then
      printf '%s\n' "${logs[@]}" | xargs ls -t 2>/dev/null | head -n 5 | while IFS= read -r log; do
        printf '\n----- %s -----\n' "$log"
        tail -n 160 "$log" 2>/dev/null || true
      done
    else
      printf '暂无构建日志\n'
    fi

    printf '\n===== 最近产物（最多 30 个） =====\n'
    if [ "${#artifacts[@]}" -gt 0 ]; then
      printf '%s\n' "${artifacts[@]}" | xargs ls -lht 2>/dev/null | head -n 30
    else
      printf '暂无产物\n'
    fi
  } >"$report" 2>&1

  printf '\n本地诊断报告已生成，不消耗 token:\n%s\n' "$report"
}

show_menu() {
  refresh_discovered_projects
  printf '\n'
  printf '========================================\n'
  printf ' %s\n' "$TOOL_NAME"
  printf '========================================\n'
  show_sdk_status
  show_certificate_status
  parallel_config_summary
  printf '%s\n' '----------------------------------------'
  print_registered_projects
  printf '%s\n' '----------------------------------------'
  printf '打包操作（打包成功后可选上传平台）:\n'
  printf '  1. 打包指定项目 - iOS\n'
  printf '  2. 打包指定项目 - Android\n'
  printf '  3. 打包指定项目 - HarmonyOS\n'
  printf '  4. 打包指定项目 - iOS + Android\n'
  printf '  5. 打包指定项目 - iOS + Android + HarmonyOS\n'
  printf '\n----------------------------------------\n\n'
  printf '  6. 全部项目 - iOS\n'
  printf '  7. 全部项目 - Android\n'
  printf '  8. 全部项目 - HarmonyOS\n'
  printf '  9. 全部项目 - iOS + Android + HarmonyOS\n'
  printf '\n----------------------------------------\n\n'
  printf ' 10. 检查全部环境\n'
  printf ' 11. 查看项目和产物状态\n'
  printf ' 12. 生成本地诊断报告\n'
  printf ' 13. 初始化/修复打包环境\n'
  printf ' 14. 更新/处理 SDK\n'
  printf ' 15. 更新/处理证书\n'
  printf ' 16. 退出 / 0 退出 / 回车 退出\n'
  printf '========================================\n'
  printf '请选择: '
}

preflight_hbuilderx() {
  local cli="${HBUILDERX_CLI:-${HBUILDERX_APP:-/Applications/HBuilderX.app}/Contents/MacOS/cli}"
  local waited=0

  if [ "${PREFLIGHT_HB_STATUS:-}" = "ready" ]; then
    printf '  [正常] HBuilderX CLI 服务可用（已检查）\n'
    return 0
  fi
  if [ "${PREFLIGHT_HB_STATUS:-}" = "failed" ]; then
    return 1
  fi

  if [ ! -x "$cli" ]; then
    printf '  [失败] HBuilderX CLI 不存在: %s\n' "$cli"
    printf '         请先安装 HBuilderX，或运行“初始化/修复打包环境”。\n'
    PREFLIGHT_HB_STATUS="failed"
    return 1
  fi

  if run_with_timeout 15 "$cli" project list >/dev/null 2>&1; then
    printf '  [正常] HBuilderX CLI 服务可用\n'
    PREFLIGHT_HB_STATUS="ready"
    return 0
  fi

  printf '  [提示] HBuilderX CLI 服务未运行，正在尝试启动...\n'
  "$cli" open >/dev/null 2>&1 || true
  while [ "$waited" -lt 30 ]; do
    if run_with_timeout 5 "$cli" project list >/dev/null 2>&1; then
      printf '  [正常] HBuilderX CLI 服务已启动并可访问\n'
      PREFLIGHT_HB_STATUS="ready"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  printf '  [失败] HBuilderX 未能在 30 秒内进入可用状态\n'
  printf '         请手动打开 HBuilderX，完成登录/插件初始化后重试。\n'
  PREFLIGHT_HB_STATUS="failed"
  return 1
}

preflight_ios_environment() {
  local selector status=0 xcode_version

  printf '\n[iOS 打包前环境检查]\n'
  preflight_hbuilderx || status=1

  if command -v xcodebuild >/dev/null 2>&1; then
    xcode_version="$(xcodebuild -version 2>/dev/null || true)"
    xcode_version="${xcode_version%%$'\n'*}"
    printf '  [正常] Xcode: %s\n' "$xcode_version"
  else
    printf '  [失败] 未找到 xcodebuild，请安装 Xcode 和 Command Line Tools。\n'
    status=1
  fi

  selector="$(xcode-select -p 2>/dev/null || true)"
  if [ -n "$selector" ]; then
    printf '  [正常] Xcode Command Line Tools: %s\n' "$selector"
  else
    printf '  [失败] Xcode Command Line Tools 未选择，请运行: xcode-select --install\n'
    status=1
  fi

  [ "$status" -eq 0 ] && printf '  iOS 打包环境检查通过。\n'
  return "$status"
}

preflight_android_environment() {
  local status=0 sdk_dir gradle_bin java_bin android_studio_app build_tools

  printf '\n[Android 打包前环境检查]\n'
  preflight_hbuilderx || status=1

  android_studio_app="${ANDROID_STUDIO_APP:-/Applications/Android Studio.app}"
  if [ -d "$android_studio_app" ]; then
    printf '  [正常] Android Studio 已安装: %s\n' "$android_studio_app"
    printf '         当前 Gradle 构建不要求保持 Android Studio 窗口打开。\n'
  else
    printf '  [提示] 未检测到 Android Studio，将继续检查 Android SDK/JDK/Gradle。\n'
  fi

  sdk_dir="${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}"
  if [ -d "$sdk_dir/platform-tools" ] || [ -d "$sdk_dir/build-tools" ]; then
    printf '  [正常] Android SDK: %s\n' "$sdk_dir"
  else
    printf '  [失败] Android SDK 不完整或不存在: %s\n' "$sdk_dir"
    printf '         请打开 Android Studio 完成 SDK 安装。\n'
    status=1
  fi

  java_bin="$(command -v java 2>/dev/null || true)"
  [ -n "$java_bin" ] || java_bin="$android_studio_app/Contents/jbr/Contents/Home/bin/java"
  if [ -x "$java_bin" ]; then
    printf '  [正常] Java: %s\n' "$java_bin"
  else
    printf '  [失败] 未找到可执行的 Java/JDK。\n'
    status=1
  fi

  gradle_bin="${ANDROID_GRADLE_BIN:-}"
  if [ -z "$gradle_bin" ] || [ ! -x "$gradle_bin" ]; then
    gradle_bin="$(find_cached_gradle || true)"
  fi
  if [ -n "$gradle_bin" ] && [ -x "$gradle_bin" ]; then
    if run_with_timeout 20 "$gradle_bin" --version >/dev/null 2>&1; then
      printf '  [正常] Gradle: %s\n' "$gradle_bin"
    else
      printf '  [失败] Gradle 可执行文件无法启动: %s\n' "$gradle_bin"
      printf '         请检查 JDK 与 ~/.gradle/native 缓存，或在初始化向导中重新选择 Gradle。\n'
      status=1
    fi
  else
    printf '  [失败] 未找到本地 Gradle。\n'
    printf '         请打开 Android Studio 或运行“初始化/修复打包环境”。\n'
    status=1
  fi

  build_tools="$(find "$sdk_dir/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$build_tools" ] && [ -x "$build_tools/apksigner" ] && [ -x "$build_tools/zipalign" ]; then
    printf '  [正常] APK 校验工具: %s\n' "$build_tools"
  else
    printf '  [失败] Android build-tools 缺少 apksigner 或 zipalign，无法验证最终 APK。\n'
    status=1
  fi

  [ "$status" -eq 0 ] && printf '  Android 打包环境检查通过。\n'
  return "$status"
}

preflight_harmony_environment() {
  local status=0 ohpm hvigor runtime_dir

  printf '\n[HarmonyOS 打包前环境检查]\n'
  preflight_hbuilderx || status=1

  if [ -d "${DEVECO_STUDIO_APP:-/Applications/DevEco-Studio.app}" ]; then
    printf '  [正常] DevEco Studio 已安装: %s\n' "${DEVECO_STUDIO_APP:-/Applications/DevEco-Studio.app}"
    printf '         本地 hvigor 构建不要求保持 DevEco Studio 窗口打开。\n'
  else
    printf '  [失败] 未找到 DevEco Studio。\n'
    status=1
  fi

  ohpm="${DEVECO_STUDIO_APP:-/Applications/DevEco-Studio.app}/Contents/tools/ohpm/bin/ohpm"
  hvigor="${DEVECO_STUDIO_APP:-/Applications/DevEco-Studio.app}/Contents/tools/hvigor/bin/hvigorw"
  if [ -x "$ohpm" ]; then
    printf '  [正常] ohpm: %s\n' "$ohpm"
  else
    printf '  [失败] 未找到 DevEco ohpm。\n'
    status=1
  fi
  if [ -x "$hvigor" ]; then
    printf '  [正常] hvigorw: %s\n' "$hvigor"
  else
    printf '  [失败] 未找到 DevEco hvigorw。\n'
    status=1
  fi

  runtime_dir="$(harmony_sdk_dir)"
  if harmony_sdk_ready; then
    printf '  [正常] HarmonyOS Runtime: %s\n' "$runtime_dir"
  else
    printf '  [失败] HarmonyOS Runtime 缺失: %s\n' "$runtime_dir"
    printf '         请运行“更新/处理 SDK”或重新运行初始化向导。\n'
    status=1
  fi

  printf '  [提示] HarmonyOS 将在选择项目后按 manifest.json signingConfigs 检查；只有生成 signed HAP 才会归档。\n'

  [ "$status" -eq 0 ] && printf '  HarmonyOS 打包环境检查通过。\n'
  return "$status"
}

preflight_for_choice() {
  local choice="$1" status=0

  PREFLIGHT_HB_STATUS=""

  case "$choice" in
    1|6) preflight_ios_environment || status=1 ;;
    2|7) preflight_android_environment || status=1 ;;
    3|8) preflight_harmony_environment || status=1 ;;
    4)
      preflight_ios_environment || status=1
      preflight_android_environment || status=1
      ;;
    5|9)
      preflight_ios_environment || status=1
      preflight_android_environment || status=1
      preflight_harmony_environment || status=1
      ;;
    *) return 0 ;;
  esac

  if [ "$status" -ne 0 ]; then
    printf '\n环境未就绪，已取消本次打包并返回菜单。\n'
    return 1
  fi
  return 0
}

preflight_for_project() {
  local project="$1" status=0
  if project_platform_enabled "$project" ios; then
    preflight_ios_environment || status=1
  fi
  if project_platform_enabled "$project" android; then
    preflight_android_environment || status=1
  fi
  if project_platform_enabled "$project" harmony; then
    preflight_harmony_environment || status=1
  fi
  if [ "$status" -ne 0 ]; then
    printf '\n环境未就绪，已取消本次打包并返回菜单。\n'
    return 1
  fi
  return 0
}

execute_selection() {
  local choice="$1" project status=0 id

  UPLOAD_SELECTED_PLATFORMS=""
  export UPLOAD_SELECTED_PLATFORMS

  case "$choice" in
    1)
      project="$(select_project ios)" || { status=$?; [ "$status" -eq 1 ] && return 0; return "$status"; }
      preflight_for_choice 1 || return 0
      prompt_upload_platforms ios
      run_build_tasks "ios"$'\t'"${project}"
      ;;
    2)
      project="$(select_project android)" || { status=$?; [ "$status" -eq 1 ] && return 0; return "$status"; }
      preflight_for_choice 2 || return 0
      prompt_upload_platforms android
      run_build_tasks "android"$'\t'"${project}"
      ;;
    3)
      project="$(select_project harmony)" || { status=$?; [ "$status" -eq 1 ] && return 0; return "$status"; }
      preflight_for_choice 3 || return 0
      prompt_upload_platforms harmony
      run_build_tasks "harmony"$'\t'"${project}"
      ;;
    4)
      project="$(select_project all)" || { status=$?; [ "$status" -eq 1 ] && return 0; return "$status"; }
      preflight_for_project "$project" || return 0
      prompt_upload_platforms "ios android"
      build_project_ios_android "$project"
      ;;
    5)
      project="$(select_project all)" || { status=$?; [ "$status" -eq 1 ] && return 0; return "$status"; }
      preflight_for_project "$project" || return 0
      prompt_upload_platforms "ios android harmony"
      build_project_all_platforms "$project"
      ;;
    6)
      if ! has_packable_projects ios; then
        project_reading_flow ios
        return 0
      fi
      preflight_for_choice 6 || return 0
      prompt_upload_platforms ios
      build_platform_projects ios
      ;;
    7)
      if ! has_packable_projects android; then
        project_reading_flow android
        return 0
      fi
      preflight_for_choice 7 || return 0
      prompt_upload_platforms android
      build_platform_projects android
      ;;
    8)
      if ! has_packable_projects harmony; then
        project_reading_flow harmony
        return 0
      fi
      preflight_for_choice 8 || return 0
      prompt_upload_platforms harmony
      build_platform_projects harmony
      ;;
    9)
      if ! has_packable_projects all; then
        project_reading_flow all
        return 0
      fi
      preflight_for_choice 9 || return 0
      prompt_upload_platforms "ios android harmony"
      build_all_platforms
      ;;
    10) check_all_platforms ;;
    11) run_action list_projects ;;
    12) run_action generate_local_diagnostic_report ;;
    13) run_action "$PIPELINE_ROOT/初始化.command" ;;
    14) run_action "$PIPELINE_ROOT/sdk/处理SDK.command" ;;
    15) run_action "$PIPELINE_ROOT/certificates/处理证书.command" ;;
    0|16) return 10 ;;
    *) printf '无效选择: %s\n' "$choice"; return 2 ;;
  esac
}

# 本地诊断: 打包工具.command diagnose
if [ "${1:-}" = "diagnose" ]; then
  generate_local_diagnostic_report
  printf '\n按回车退出...'
  read -r _ || true
  exit 0
fi

# 可通过参数直接执行，例如:
#   打包工具.command ios <项目ID>
#   打包工具.command android <项目ID>
#   打包工具.command all
if [ "$#" -gt 0 ]; then
  refresh_discovered_projects
  case "${1:-}" in
    ios) preflight_for_choice 6 || exit 1 ;;
    android) preflight_for_choice 7 || exit 1 ;;
    harmony) preflight_for_choice 8 || exit 1 ;;
    all)
      if [ -n "${2:-}" ] && [[ "${2:-}" != --* ]]; then
        preflight_for_project "$2" || exit 1
      else
        preflight_for_choice 9 || exit 1
      fi
      ;;
  esac
  if run_action main "$@"; then
    status=0
  else
    status=$?
  fi
  printf '\n打包结束，退出码: %s\n' "$status"
  printf '按回车退出...'
  read -r _ || true
  exit "$status"
fi

maybe_offer_initialization

while true; do
  show_menu
  if ! read -r choice; then
    printf '\n'
    break
  fi

  if [ -z "$choice" ]; then
    printf '\n'
    break
  fi

  set +e
  execute_selection "$choice"
  status=$?
  set -e

  if [ "$status" -eq 10 ]; then
    break
  fi
  if [ "$status" -ne 0 ]; then
    printf '\n执行失败，退出码: %s\n' "$status"
  fi
  pause
done

printf '\n已退出。\n'
printf '按回车关闭...'
read -r _ || true
