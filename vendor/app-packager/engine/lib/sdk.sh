#!/usr/bin/env bash
# SDK 状态查询、官方下载入口推荐与一键配置。
#
# 由 `打包工具.command sdk ...` 调用，面板与外部工具通过同一条 CLI 走这里，
# 不重复实现「HBuilderX 版本 → SDK 系列 → 下载地址」这套逻辑。
#
#   sdk status               机器可读的 JSON（面板用）
#   sdk urls                 人读的下载入口清单
#   sdk install <平台|all>   一键配置（iOS/Android 自动下载官方直链，HarmonyOS 走 ohpm）
#   sdk process              处理 sdk/ 目录里已经下载好的压缩包
#
# install 支持的额外参数：--yes 免交互、--file <压缩包|目录> 用本地文件代替下载。
set -euo pipefail

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/init.sh"

SDK_KINDS="ios android harmony"

sdk_label() {
  case "$1" in
    ios) printf 'iOS' ;;
    android) printf 'Android' ;;
    harmony) printf 'HarmonyOS' ;;
    *) printf '%s' "$1" ;;
  esac
}

sdk_dir_for() {
  case "$1" in
    ios) ios_sdk_dir ;;
    android) android_sdk_dir ;;
    harmony) harmony_sdk_dir ;;
    *) return 1 ;;
  esac
}

# ready / mismatch / missing
sdk_state_for() {
  case "$1" in
    ios)
      if ios_sdk_uniappx_ready; then
        printf 'ready'
      elif ios_sdk_ready; then
        printf 'mismatch'
      else
        printf 'missing'
      fi
      ;;
    android) android_sdk_ready && printf 'ready' || printf 'missing' ;;
    harmony) harmony_sdk_ready && printf 'ready' || printf 'missing' ;;
    *) printf 'unknown' ;;
  esac
}

# 不含版本号的固定直链模板；Android 的文件名带构建号，只能从官方页面解析。
# series 省略时按本机 HBuilderX 的系列取。
sdk_direct_url() {
  local series="${2:-$(sdk_series)}"
  case "$1" in
    ios) printf 'https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%%40%s.zip\n' "$series" ;;
    *) return 1 ;;
  esac
}

# 官方页面上该系列对应的文件名/包名，供用户手动下载时对照。
sdk_package_hint() {
  local series="${2:-$(sdk_series)}"
  case "$1" in
    ios) printf 'UniAppX-iOS@%s.zip' "$series" ;;
    android) printf 'Android-uni-app-x-SDK@<构建号>-%s.zip' "$series" ;;
    harmony) printf '@dcloudio/uni-app-x-runtime@%s.*' "$series" ;;
    *) printf '' ;;
  esac
}

sdk_json_escape() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'
}

sdk_json_bool() {
  [ "${1:-}" = "true" ] && printf 'true' || printf 'false'
}

sdk_status_json() {
  local series found=false version app cli kind state dir page direct package first=1

  app="${HBUILDERX_APP:-}"
  cli="${HBUILDERX_CLI:-}"
  version=""
  if find_hbuilderx >/dev/null 2>&1; then
    read_hbuilderx_version
    found=true
    version="$HX_VERSION"
  fi
  series="$(sdk_series)"

  printf '{'
  printf '"hbuilderx":{"found":%s,"app":"%s","cli":"%s","version":"%s","series":"%s"},' \
    "$(sdk_json_bool "$found")" \
    "$(sdk_json_escape "$app")" \
    "$(sdk_json_escape "$cli")" \
    "$(sdk_json_escape "$version")" \
    "$(sdk_json_escape "$series")"
  printf '"sdkRoot":"%s","platforms":[' "$(sdk_json_escape "$PIPELINE_ROOT/sdk")"

  for kind in $SDK_KINDS; do
    state="$(sdk_state_for "$kind")"
    dir="$(sdk_dir_for "$kind")"
    page="$(official_page "$kind" 2>/dev/null || true)"
    direct="$(sdk_direct_url "$kind" "$series" 2>/dev/null || true)"
    package="$(sdk_package_hint "$kind" "$series")"
    [ "$first" = 1 ] || printf ','
    first=0
    printf '{"id":"%s","label":"%s","series":"%s","dir":"%s","state":"%s","ready":%s,"page":"%s","direct":"%s","package":"%s"}' \
      "$kind" "$(sdk_label "$kind")" "$(sdk_json_escape "$series")" "$(sdk_json_escape "$dir")" \
      "$state" "$(sdk_json_bool "$([ "$state" = ready ] && printf true || printf false)")" \
      "$(sdk_json_escape "$page")" "$(sdk_json_escape "$direct")" "$(sdk_json_escape "$package")"
  done
  printf ']'

  first=1
  printf ',"archives":['
  while IFS= read -r archive; do
    [ -n "$archive" ] || continue
    [ "$first" = 1 ] || printf ','
    first=0
    printf '"%s"' "$(sdk_json_escape "$archive")"
  done < <(find "$PIPELINE_ROOT/sdk" -maxdepth 2 -type f \
    \( -iname '*.zip' -o -iname '*.har' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.7z' \) \
    -not -iname '*.downloading' -print 2>/dev/null | sort)
  printf ']'

  local incomplete=0 partial
  while IFS= read -r partial; do
    [ -n "$partial" ] || continue
    incomplete=$((incomplete + 1))
  done < <(find "$PIPELINE_ROOT/sdk" -type f \( -iname '*.downloading' -o -iname '*.baiduyun.p.downloading' \) -print 2>/dev/null)
  printf ',"incompleteDownloads":%s}\n' "$incomplete"
}

sdk_status_text() {
  local series kind state dir page direct package
  # 人读版也要先解析本机 HBuilderX，否则「版本」一栏恒为未知（JSON 版会解析）。
  if find_hbuilderx >/dev/null 2>&1; then
    read_hbuilderx_version
  fi
  series="$(sdk_series)"
  printf '\nHBuilderX: %s\n' "${HBUILDERX_APP:-（未检测到）}"
  printf '版本: %s\n' "${HX_VERSION:-未知}"
  printf 'SDK 系列: %s\n' "$series"
  printf 'SDK 目录: %s\n' "$PIPELINE_ROOT/sdk"

  for kind in $SDK_KINDS; do
    state="$(sdk_state_for "$kind")"
    dir="$(sdk_dir_for "$kind")"
    page="$(official_page "$kind" 2>/dev/null || true)"
    direct="$(sdk_direct_url "$kind" "$series" 2>/dev/null || true)"
    package="$(sdk_package_hint "$kind" "$series")"
    case "$state" in
      ready) printf '\n[OK] %s 已就绪\n' "$(sdk_label "$kind")" ;;
      mismatch) printf '\n[FAIL] %s 类型不匹配（需要 UniAppX 版本）\n' "$(sdk_label "$kind")" ;;
      *) printf '\n[FAIL] %s 未安装\n' "$(sdk_label "$kind")" ;;
    esac
    printf '  版本: %s\n' "$series"
    printf '  目录: %s\n' "$dir"
    printf '  官方页面: %s\n' "$page"
    [ -n "$direct" ] && printf '  直接下载: %s\n' "$direct"
    case "$kind" in
      # HarmonyOS 的 runtime 是 DevEco 的 ohpm 包，npm 上查不到（`npm view` 会 404），标签要说清。
      harmony) printf '  ohpm 包名: %s（DevEco Studio 的 ohpm 仓库，不在 npm 上）\n' "$package" ;;
      *) printf '  文件名/包名: %s\n' "$package" ;;
    esac
    printf '  一键配置: %s sdk install %s --yes\n' "$(basename "$PIPELINE_ROOT/打包工具.command")" "$kind"
  done
  printf '\n处理 sdk/ 目录里已下载的压缩包: %s sdk process\n' "$(basename "$PIPELINE_ROOT/打包工具.command")"
}

sdk_process() {
  if ! find_hbuilderx >/dev/null 2>&1; then
    fail "未检测到 HBuilderX，无法确定 SDK 系列"
    return 1
  fi
  read_hbuilderx_version
  process_sdk_root
  write_local_settings
}

sdk_install() {
  local kind="${1:-}"
  [ -n "$kind" ] || { fail "用法: sdk install <ios|android|harmony|all> [--yes] [--file <包>]"; return 2; }
  shift || true

  local assume_yes=0 file=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes | -y) assume_yes=1 ;;
      --file)
        file="${2:-}"
        [ -n "$file" ] || { fail "--file 需要跟一个压缩包或目录路径"; return 2; }
        shift
        ;;
      *) fail "未知参数: $1"; return 2 ;;
    esac
    shift
  done

  local -a kinds=()
  case "$kind" in
    all) kinds=(ios android harmony) ;;
    ios | android | harmony) kinds=("$kind") ;;
    *) fail "未知平台: ${kind}（可用: ios、android、harmony、all）"; return 2 ;;
  esac
  if [ -n "$file" ] && [ "${#kinds[@]}" -gt 1 ]; then
    fail "--file 只能配合单一平台使用，例如: sdk install ios --file <包>"
    return 2
  fi
  if [ -n "$file" ] && [ ! -e "$file" ]; then
    fail "找不到文件: $file"
    return 2
  fi

  if ! find_hbuilderx >/dev/null 2>&1; then
    fail "未检测到 HBuilderX，请先安装: https://www.dcloud.io/hbuilderx.html"
    return 1
  fi
  read_hbuilderx_version
  local series="$HX_SERIES"
  local current_url url current status=0

  title "一键配置 SDK（HBuilderX ${HX_VERSION}，SDK 系列 ${series}）"

  for current in "${kinds[@]}"; do
    printf '\n-- %s SDK --\n' "$(sdk_label "$current")"
    # 已经就绪的平台不重下也不重装（点击「一键配置」天然幂等）；--file 是显式意图，照常执行。
    if [ -z "$file" ] && [ "$(sdk_state_for "$current")" = ready ]; then
      ok "$(sdk_label "$current") SDK 已就绪，跳过：$(sdk_dir_for "$current")"
      continue
    fi
    if [ -n "$file" ]; then
      import_sdk_archive "$current" "$file" "$series" || true
    else
      case "$current" in
        ios | android)
          url=""
          url="$(resolve_direct_sdk_url "$current" "$series" 2>/dev/null || true)"
          if [ -z "$url" ]; then
            fail "没有从官方页面解析到 $current SDK 直链"
            print_sdk_download_address "$current" || true
            printf '  手动下载后运行: %s sdk install %s --file <下载的压缩包>\n' \
              "$(basename "$PIPELINE_ROOT/打包工具.command")" "$current"
            status=1
            continue
          fi
          ok "下载入口: $url"
          import_sdk_archive "$current" "$url" "$series" || true
          ;;
        harmony)
          if [ "$assume_yes" = 1 ]; then
            SDK_AUTO_INSTALL=yes install_harmony_runtime || true
          else
            SDK_AUTO_INSTALL=ask install_harmony_runtime || true
          fi
          ;;
      esac
    fi
    # 结果以「真的就绪」为准：拒绝安装、ohpm 缺失、下载或解压失败都不能报成功。
    if [ "$(sdk_state_for "$current")" != ready ]; then
      warn "$(sdk_label "$current") SDK 未就绪：$(sdk_dir_for "$current")"
      status=1
    fi
  done

  write_local_settings
  printf '\n'
  if [ "$status" = 0 ]; then
    ok "SDK 配置完成，重新运行环境检查即可看到结果"
  else
    warn "部分 SDK 未配置成功，请按上面的提示处理"
  fi
  return "$status"
}

sdk_main() {
  local command="${1:-status}"
  shift || true
  case "$command" in
    status | json) sdk_status_json ;;
    text | info) sdk_status_text ;;
    urls) sdk_status_text ;;
    install) sdk_install "$@" ;;
    process) sdk_process "$@" ;;
    help | -h | --help)
      printf '用法: %s sdk <status|urls|install <ios|android|harmony|all> [--yes] [--file <包>]|process>\n' \
        "$(basename "$PIPELINE_ROOT/打包工具.command")"
      ;;
    *)
      fail "未知的 sdk 子命令: $command"
      printf '用法: sdk <status|urls|install <ios|android|harmony|all> [--yes] [--file <包>]|process>\n'
      return 2
      ;;
  esac
}
