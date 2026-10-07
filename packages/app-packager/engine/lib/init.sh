#!/usr/bin/env bash
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

INIT_STATE="$PIPELINE_ROOT/config/init.local.env"
DOWNLOAD_DIR="$PIPELINE_ROOT/sdk"
HX_SERIES=""
HX_VERSION=""
HBUILDERX_APP="${HBUILDERX_APP:-}"
HBUILDERX_CLI="${HBUILDERX_CLI:-}"
LOCAL_IOS_SDK_DIR="${LOCAL_IOS_SDK_DIR:-}"
LOCAL_ANDROID_SDK_DIR="${LOCAL_ANDROID_SDK_DIR:-}"
LOCAL_HARMONY_SDK_DIR="${LOCAL_HARMONY_SDK_DIR:-}"
LOCAL_IOS_RUNTIME_VERSION="${LOCAL_IOS_RUNTIME_VERSION:-}"
HARMONY_RUNTIME_VERSION="${HARMONY_RUNTIME_VERSION:-}"
ANDROID_STUDIO_APP="/Applications/Android Studio.app"
DEVECO_STUDIO_APP="/Applications/DevEco-Studio.app"
XCODE_APP="/Applications/Xcode.app"

title() {
  printf '\n========================================\n'
  printf ' %s\n' "$1"
  printf '========================================\n'
}

step() {
  printf '\n[%s] %s\n' "$1" "$2"
}

ok() { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; }

pause_enter() {
  printf '%s' "${1:-按回车继续...}"
  read -r _ || true
}

open_url() {
  local url="$1"
  printf '  打开: %s\n' "$url"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  fi
}

find_hbuilderx() {
  local candidate
  local -a candidates=(
    "${HBUILDERX_APP:-}"
    "/Applications/HBuilderX.app"
    "$HOME/Applications/HBuilderX.app"
  )

  if [ -n "${HBUILDERX_CLI:-}" ] && [ -x "$HBUILDERX_CLI" ]; then
    candidate="${HBUILDERX_CLI%/Contents/MacOS/cli}"
    [ "$candidate" != "$HBUILDERX_CLI" ] && candidates=("$candidate" "${candidates[@]}")
  fi

  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/Contents/MacOS/cli" ]; then
      HBUILDERX_APP="$candidate"
      HBUILDERX_CLI="$candidate/Contents/MacOS/cli"
      return 0
    fi
  done
  return 1
}

read_hbuilderx_version() {
  local plist="$HBUILDERX_APP/Contents/Info.plist"
  if [ -f "$plist" ]; then
    HX_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$plist" 2>/dev/null || true)"
  fi
  if [ -z "$HX_VERSION" ] && [ -x "$HBUILDERX_CLI" ]; then
    HX_VERSION="$("$HBUILDERX_CLI" --help 2>/dev/null | sed -n 's/.*HBuilderX(v\([^)]*\)).*/\1/p' | head -n 1 || true)"
  fi
  [ -n "$HX_VERSION" ] || HX_VERSION="unknown"
  HX_SERIES="$(printf '%s\n' "$HX_VERSION" | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')"
  [ -n "$HX_SERIES" ] || HX_SERIES="$LOCAL_IOS_RUNTIME_VERSION"
  [ -n "$HX_SERIES" ] || HX_SERIES="5.26"
}

ensure_hbuilderx() {
  step 1 "检查 HBuilderX"
  while ! find_hbuilderx; do
    fail "未检测到 HBuilderX"
    printf '  请先安装 HBuilderX: https://www.dcloud.io/hbuilderx.html\n'
    open_url "https://www.dcloud.io/hbuilderx.html"
    printf '安装完成后按回车重新检测，输入 q 退出: '
    read -r answer || answer=""
    [ "$answer" = "q" ] && return 1
  done

  read_hbuilderx_version
  ok "HBuilderX: $HBUILDERX_APP"
  ok "版本: $HX_VERSION"
  ok "SDK 系列: $HX_SERIES"

  if ! "$HBUILDERX_CLI" project list >/dev/null 2>&1; then
    warn "HBuilderX CLI 尚未就绪，正在尝试启动 HBuilderX"
    "$HBUILDERX_CLI" open >/dev/null 2>&1 || true
    sleep 5
    if ! "$HBUILDERX_CLI" project list >/dev/null 2>&1; then
      warn "HBuilderX CLI 仍不可用，请打开 HBuilderX 并完成登录/插件初始化后重新运行本向导"
    else
      ok "HBuilderX CLI 已就绪"
    fi
  else
    ok "HBuilderX CLI 已就绪"
  fi
}

check_apps() {
  step 2 "检查原生编辑器"

  if [ -d "$XCODE_APP" ] || command -v xcodebuild >/dev/null 2>&1; then
    ok "Xcode: $(xcodebuild -version 2>/dev/null | head -n 1 || true)"
    if ! xcode-select -p >/dev/null 2>&1; then
      warn "Xcode Command Line Tools 未选择，请运行: xcode-select --install"
    fi
  else
    fail "未检测到 Xcode"
    open_url "https://apps.apple.com/app/xcode/id497799835"
  fi

  if [ -d "$ANDROID_STUDIO_APP" ]; then
    ok "Android Studio: $ANDROID_STUDIO_APP"
  else
    fail "未检测到 Android Studio"
    open_url "https://developer.android.com/studio"
  fi

  if [ -d "$DEVECO_STUDIO_APP" ]; then
    ok "DevEco Studio: $DEVECO_STUDIO_APP"
    LOCAL_HARMONY_SDK_DIR="$DEVECO_STUDIO_APP/Contents/sdk"
  else
    fail "未检测到 DevEco Studio"
    open_url "https://developer.huawei.com/consumer/cn/deveco-studio/"
  fi
}

find_android_sdk() {
  local candidate="${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}"
  if [ -d "$candidate/platform-tools" ] || [ -d "$candidate/build-tools" ]; then
    printf '%s\n' "$candidate"
  fi
}

find_gradle() {
  local candidate="${ANDROID_GRADLE_BIN:-}"
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi
  find_cached_gradle
}

install_missing_dependencies() {
  local -a brew_packages=()
  local package

  if ! xcode-select -p >/dev/null 2>&1; then
    printf '  Xcode Command Line Tools 未安装，是否现在运行 xcode-select --install？[Y/n]: '
    read -r answer || answer=""
    case "$answer" in
      n|N|no|NO) warn "已跳过 Xcode Command Line Tools 安装" ;;
      *)
        xcode-select --install >/dev/null 2>&1 || true
        pause_enter "请在系统弹窗中完成安装，完成后按回车继续: "
        ;;
    esac
  fi

  command -v brew >/dev/null 2>&1 || {
    warn "未找到 Homebrew，无法自动安装命令行依赖"
    open_url "https://brew.sh/"
    return 0
  }

  for package in node python@3 openssl rsync; do
    case "$package" in
      node) command -v node >/dev/null 2>&1 || brew_packages+=("node") ;;
      python@3) command -v python3 >/dev/null 2>&1 || brew_packages+=("python@3") ;;
      openssl) command -v openssl >/dev/null 2>&1 || brew_packages+=("openssl") ;;
      rsync) command -v rsync >/dev/null 2>&1 || brew_packages+=("rsync") ;;
    esac
  done

  if [ "${#brew_packages[@]}" -eq 0 ]; then
    ok "Homebrew 依赖已齐全"
    return 0
  fi

  printf '  缺少依赖: %s\n' "${brew_packages[*]}"
  printf '  是否使用 Homebrew 安装？[y/N]: '
  read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES)
      brew install "${brew_packages[@]}"
      ;;
    *)
      warn "已跳过 Homebrew 依赖安装"
      ;;
  esac
}

prepare_android_licenses() {
  local sdkmanager=""
  if [ -n "${ANDROID_SDK_DIR:-}" ]; then
    sdkmanager="$(find "$ANDROID_SDK_DIR/cmdline-tools" -type f -name sdkmanager -perm -111 2>/dev/null | head -n 1)"
  fi
  [ -n "$sdkmanager" ] || return 0

  if [ -f "$ANDROID_SDK_DIR/licenses/android-sdk-license" ]; then
    ok "Android SDK License 已存在"
    return 0
  fi

  printf '  Android SDK License 尚未接受，是否现在执行 sdkmanager --licenses？[y/N]: '
  read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES)
      yes | "$sdkmanager" --licenses || true
      ;;
    *)
      warn "已跳过 Android SDK License"
      ;;
  esac
}

check_dependencies() {
  step 4 "检查打包依赖"
  local tool missing=0
  for tool in rsync openssl plutil security codesign keytool ditto shasum curl node npm python3 xcodebuild; do
    if command -v "$tool" >/dev/null 2>&1; then
      ok "$tool: $(command -v "$tool")"
    else
      fail "$tool 未找到"
      missing=$((missing + 1))
    fi
  done

  local android_sdk gradle_bin java_bin adb_bin
  android_sdk="$(find_android_sdk || true)"
  if [ -n "$android_sdk" ]; then
    ANDROID_SDK_DIR="$android_sdk"
    ok "Android SDK: $ANDROID_SDK_DIR"
  else
    fail "未找到 Android SDK，请打开 Android Studio 完成 SDK 安装"
    missing=$((missing + 1))
  fi

  gradle_bin="$(find_gradle || true)"
  if [ -n "$gradle_bin" ]; then
    ok "Gradle: $gradle_bin"
  else
    fail "未找到 Gradle，请先打开 Android Studio 或安装 Gradle"
    missing=$((missing + 1))
  fi

  java_bin="$(command -v java || true)"
  [ -n "$java_bin" ] || java_bin="$ANDROID_STUDIO_APP/Contents/jbr/Contents/Home/bin/java"
  if [ -x "$java_bin" ]; then
    ok "Java: $java_bin"
  else
    fail "未找到 Java，请打开 Android Studio 并安装内置 JDK"
    missing=$((missing + 1))
  fi

  adb_bin="$(command -v adb || true)"
  [ -n "$adb_bin" ] || adb_bin="${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}/platform-tools/adb"
  if [ -x "$adb_bin" ]; then
    ok "ADB: $adb_bin"
  else
    warn "未找到 ADB，连接实体 Android 设备前需要安装 platform-tools"
  fi

  if security find-generic-password -s "$P12_PASSWORD_SERVICE" -a "$USER" >/dev/null 2>&1; then
    ok "Keychain 已保存 p12 密码: $P12_PASSWORD_SERVICE"
  else
    warn "Keychain 未保存 p12 密码，后续运行 setup-signing.sh 配置"
  fi

  if command -v xcodebuild >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1; then
    ok "Xcode 签名环境已就绪"
  else
    warn "Xcode/Command Line Tools 未完全就绪"
  fi

  printf ' 依赖检查完成，缺少项: %s\n' "$missing"
}

show_official_sdk_links() {
  local page="$1" html links
  html="$(mktemp)"
  if ! curl -L --max-time 20 -fsS "$page" -o "$html" 2>/dev/null; then
    rm -f "$html"
    warn "无法读取官方下载页，请手动打开：$page"
    return 0
  fi
  links="$(grep -oE 'https://(yun\.139\.com|pan\.baidu\.com|web-ext-storage\.dcloud\.net\.cn/uni-app-x/sdk)[^"< ]+' "$html" | sed 's/&amp;/\&/g' | sort -u | head -n 8 || true)"
  rm -f "$html"
  if [ -n "$links" ]; then
    printf '  官方页面中的下载入口（请选择与 HBuilderX %s 对应的条目）：\n' "$HX_VERSION"
    printf '%s\n' "$links" | sed 's/^/    /'
  else
    warn "官方页面未解析到云盘链接，请手动打开页面下载"
  fi
}

official_page() {
  case "$1" in
    ios) printf '%s\n' "https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html" ;;
    android) printf '%s\n' "https://doc.dcloud.net.cn/uni-app-x/native/download/android.html" ;;
    harmony) printf '%s\n' "https://doc.dcloud.net.cn/uni-app-x/native/use/harmony.html" ;;
    *) return 1 ;;
  esac
}

resolve_direct_sdk_url() {
  local kind="$1" series="$2" page html pattern url
  page="$(official_page "$kind" 2>/dev/null || true)"
  [ -n "$page" ] || return 1
  html="$(mktemp)"
  curl -L --max-time 20 -fsS "$page" -o "$html" 2>/dev/null || { rm -f "$html"; return 1; }

  case "$kind" in
    ios) pattern='https://web-ext-storage\.dcloud\.net\.cn/uni-app-x/sdk/iOS/[^"< ]+' ;;
    android) pattern='https://web-ext-storage\.dcloud\.net\.cn/uni-app-x/sdk/Android/[^"< ]+' ;;
    *) rm -f "$html"; return 1 ;;
  esac

  url="$(grep -oE "$pattern" "$html" | grep -F "$series" | grep -v '\-Vapor' | head -n 1 || true)"
  rm -f "$html"
  [ -n "$url" ] || return 1
  printf '%s\n' "$url"
}

print_sdk_download_address() {
  local kind="$1" page direct package
  page="$(official_page "$kind" 2>/dev/null || true)"
  [ -n "$page" ] && printf '  官方页面: %s\n' "$page"

  if [ "$kind" = "harmony" ]; then
    package="@dcloudio/uni-app-x-runtime@${HX_SERIES}.*"
    printf '  ohpm 包名: %s\n' "$package"
    return 0
  fi

  direct="$(resolve_direct_sdk_url "$kind" "${HX_SERIES:-5.26}" || true)"
  if [ -n "$direct" ]; then
    printf '  直接下载: %s\n' "$direct"
  else
    printf '  请在官方页面中选择与 HBuilderX %s 对应的 %s SDK。\n' "${HX_VERSION:-$HX_SERIES}" "$kind"
  fi
}

extract_archive() {
  local archive="$1" dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  case "$(printf '%s' "$archive" | tr '[:upper:]' '[:lower:]')" in
    *.zip) ditto -x -k "$archive" "$dest" ;;
    *.tar.gz|*.tgz) tar -xzf "$archive" -C "$dest" ;;
    *) fail "暂不支持的压缩格式: $archive"; return 1 ;;
  esac
}

find_ios_sdk_root() {
  local root="$1" xcodeproj demo
  xcodeproj="$(find "$root" -type d \( -name 'UniAppXDemo.xcodeproj' -o -name 'HBuilder-Hello.xcodeproj' \) -print -quit 2>/dev/null)"
  if [ -n "$xcodeproj" ]; then
    demo="$(dirname "$xcodeproj")"
    printf '%s\n' "$(dirname "$demo")"
    return 0
  fi
  # 兼容旧版 iOS 离线 SDK：SDK/Feature-iOS.xls + SDK/HBuilder-Hello。
  if find "$root" -type f -name 'Feature-iOS.xls' -print -quit 2>/dev/null | grep -q .; then
    printf '%s\n' "$root"
    return 0
  fi
  return 1
}

find_android_sdk_root() {
  local root="$1" marker
  marker="$(find "$root" -type d -path '*/SDK/libs' -print -quit 2>/dev/null)"
  if [ -n "$marker" ]; then
    printf '%s\n' "$(dirname "$(dirname "$marker")")"
    return 0
  fi
  marker="$(find "$root" -type d -name 'libs' -print -quit 2>/dev/null)"
  [ -n "$marker" ] || return 1
  printf '%s\n' "$(dirname "$marker")"
}

find_harmony_sdk_root() {
  local root="$1" marker
  marker="$(find "$root" -type f -name 'oh-package.json5' -print -quit 2>/dev/null)"
  if [ -n "$marker" ]; then
    printf '%s\n' "$(dirname "$marker")"
    return 0
  fi
  marker="$(find "$root" -type f -name '*.har' -print -quit 2>/dev/null)"
  [ -n "$marker" ] || return 1
  printf '%s\n' "$(dirname "$marker")"
}

platform_dir_name() {
  case "$1" in
    ios) printf '%s\n' 'iOS' ;;
    android) printf '%s\n' 'Android' ;;
    harmony) printf '%s\n' 'HarmonyOS' ;;
    *) return 1 ;;
  esac
}

detect_sdk_version_from_path() {
  local source="$1" version name
  name="$(basename "$source" | sed 's/%40/@/g')"
  version="$(printf '%s\n' "$name" | grep -Eo '[0-9]+\.[0-9]+' | head -n 1 || true)"
  printf '%s\n' "${version:-${HX_SERIES:-5.26}}"
}

detect_sdk_kind_from_path() {
  local source="$1" base tmp
  base="$(basename "$source" | tr '[:upper:]' '[:lower:]')"
  case "$base" in
    *android*) printf '%s\n' 'android'; return 0 ;;
    *harmony*|*ohos*|*.har) printf '%s\n' 'harmony'; return 0 ;;
    *ios*|*uniappx*) printf '%s\n' 'ios'; return 0 ;;
  esac

  if [ -d "$source" ]; then
    find "$source" -type d \( -name 'UniAppXDemo.xcodeproj' -o -name 'HBuilder-Hello.xcodeproj' \) -print -quit 2>/dev/null | grep -q . && { printf '%s\n' 'ios'; return 0; }
    find "$source" -type f -name 'Feature-iOS.xls' -print -quit 2>/dev/null | grep -q . && { printf '%s\n' 'ios'; return 0; }
    find "$source" -type d -path '*/SDK/libs' -print -quit 2>/dev/null | grep -q . && { printf '%s\n' 'android'; return 0; }
    find "$source" -type f -name 'oh-package.json5' -print -quit 2>/dev/null | grep -q . && { printf '%s\n' 'harmony'; return 0; }
    find "$source" -type f -name '*.har' -print -quit 2>/dev/null | grep -q . && { printf '%s\n' 'harmony'; return 0; }
  elif [ -f "$source" ]; then
    tmp="$DOWNLOAD_DIR/.detect-$RANDOM-$$"
    extract_archive "$source" "$tmp" >/dev/null 2>&1 || { rm -rf "$tmp"; return 1; }
    find "$tmp" -type d \( -name 'UniAppXDemo.xcodeproj' -o -name 'HBuilder-Hello.xcodeproj' \) -print -quit 2>/dev/null | grep -q . && { rm -rf "$tmp"; printf '%s\n' 'ios'; return 0; }
    find "$tmp" -type f -name 'Feature-iOS.xls' -print -quit 2>/dev/null | grep -q . && { rm -rf "$tmp"; printf '%s\n' 'ios'; return 0; }
    find "$tmp" -type d -path '*/SDK/libs' -print -quit 2>/dev/null | grep -q . && { rm -rf "$tmp"; printf '%s\n' 'android'; return 0; }
    find "$tmp" -type f -name 'oh-package.json5' -print -quit 2>/dev/null | grep -q . && { rm -rf "$tmp"; printf '%s\n' 'harmony'; return 0; }
    rm -rf "$tmp"
  fi
  return 1
}

find_sdk_root_for_kind() {
  local kind="$1" source="$2"
  case "$kind" in
    ios) find_ios_sdk_root "$source" ;;
    android) find_android_sdk_root "$source" ;;
    harmony) find_harmony_sdk_root "$source" ;;
  esac
}

install_sdk_source() {
  local kind="$1" source="$2" version="$3"
  local platform extracted root target temp_extract=""
  platform="$(platform_dir_name "$kind")" || { fail "未知 SDK 类型: $kind"; return 1; }
  target="$PIPELINE_ROOT/sdk/$platform/$version"
  mkdir -p "$PIPELINE_ROOT/sdk/$platform"

  local source_lower
  source_lower="$(printf '%s' "$source" | tr '[:upper:]' '[:lower:]')"
  if [ -f "$source" ] && [[ "$source_lower" == *.har ]]; then
    rm -rf "$target"
    mkdir -p "$target"
    cp -f "$source" "$target/"
    LOCAL_HARMONY_SDK_DIR="$target"
    ok "HarmonyOS HAR 已处理并归位: $target"
    return 0
  fi

  if [ ! -r "$source" ]; then
    fail "无法读取: $source"
    return 2
  fi

  if [ -d "$source" ]; then
    extracted="$source"
  else
    extracted="$DOWNLOAD_DIR/.extract-$kind-$RANDOM-$$"
    temp_extract="$extracted"
    if ! extract_archive "$source" "$extracted"; then
      return 2
    fi
  fi

  root="$(find_sdk_root_for_kind "$kind" "$extracted" || true)"
  if [ -z "$root" ]; then
    fail "未能从 $source 识别出有效的 $kind SDK 根目录"
    return 1
  fi

  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$root/." "$target/"
  case "$kind" in
    ios) LOCAL_IOS_SDK_DIR="$target" ;;
    android) LOCAL_ANDROID_SDK_DIR="$target" ;;
    harmony) LOCAL_HARMONY_SDK_DIR="$target" ;;
  esac
  [ -n "$temp_extract" ] && rm -rf "$temp_extract"
  ok "$kind SDK 已处理并归位: $target"
  return 0
}

import_sdk_archive() {
  local kind="$1" input="${2:-}" version="${3:-}" archive platform_dir
  platform_dir="$DOWNLOAD_DIR"
  mkdir -p "$platform_dir"
  [ -n "$version" ] || version="$(detect_sdk_version_from_path "$input")"

  if [ -n "$input" ] && [[ "$input" =~ ^https?:// ]]; then
    archive="$platform_dir/$(basename "${input%%\?*}")"
    printf '  正在下载: %s\n' "$input"
    curl -L --fail --progress-bar "$input" -o "$archive" || return 1
    input="$archive"
  fi

  if [ -z "$input" ]; then
    local -a archives=()
    while IFS= read -r archive; do
      [ -n "$archive" ] || continue
      local base
      base="$(basename "$archive" | tr '[:upper:]' '[:lower:]')"
      case "$kind" in
        ios) [[ "$base" == *ios* || "$base" == *uniappx* ]] && archives+=("$archive") ;;
        android) [[ "$base" == *android* ]] && archives+=("$archive") ;;
        harmony) [[ "$base" == *harmony* || "$base" == *ohos* || "$base" == *.har ]] && archives+=("$archive") ;;
      esac
    done < <(find "$platform_dir" -maxdepth 1 -type f \( -iname '*.zip' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.har' \) -print 2>/dev/null | sort)

    if [ "${#archives[@]}" -eq 1 ]; then
      input="${archives[0]}"
      ok "在 sdk/ 中发现 $kind SDK: $input"
    elif [ "${#archives[@]}" -gt 1 ]; then
      printf '  在 sdk/ 中找到多个 %s SDK 文件，请选择：\n' "$kind"
      local index
      for index in "${!archives[@]}"; do
        printf '    %d) %s\n' "$((index + 1))" "${archives[$index]}"
      done
      printf '  请输入编号或完整路径: '
      read -r input || input=""
      if [[ "$input" =~ ^[0-9]+$ ]]; then
        index="$((input - 1))"
        if [ "$index" -ge 0 ] && [ "$index" -lt "${#archives[@]}" ]; then
          input="${archives[$index]}"
        else
          fail "无效编号: $input"
          return 1
        fi
      fi
    else
      printf '  sdk/ 中没有自动识别到 %s SDK 压缩包。\n' "$kind"
      printf '  请输入 %s SDK 压缩包路径或直接下载 URL，直接回车跳过: ' "$kind"
      read -r input || input=""
      [ -n "$input" ] || return 1
    fi
  fi

  input="${input/#\~/$HOME}"
  [ -e "$input" ] || { fail "文件或目录不存在: $input"; return 1; }
  install_sdk_source "$kind" "$input" "$version"
}

print_result_list() {
  local title="$1"
  shift
  printf '\n%s:\n' "$title"
  if [ "$#" -eq 0 ]; then
    printf '  无\n'
    return 0
  fi
  printf '%s\n' "$@" | sort -u | sed 's/^/  - /'
}

process_sdk_root() {
  title "处理 sdk/ 中的 SDK 文件"
  mkdir -p "$PIPELINE_ROOT/sdk" "$PIPELINE_ROOT/sdk/_processed"
  local processed=0 partial_count=0 unknown_count=0 partial archive kind version root marker list roots status
  local -a success_items=() abnormal_items=() failure_items=() unreadable_items=()
  list="$(mktemp)"
  roots="$(mktemp)"

  while IFS= read -r partial; do
    [ -n "$partial" ] || continue
    partial_count=$((partial_count + 1))
    abnormal_items+=("未完成下载: $partial")
  done < <(find "$PIPELINE_ROOT/sdk" -type f \( -iname '*.downloading' -o -iname '*.baiduyun.p.downloading' \) ! -path '*/_processed/*' ! -path '*/_backup/*' ! -path '*/.extract-*/*' -print 2>/dev/null)

  if [ "$partial_count" -gt 0 ]; then
    warn "检测到 $partial_count 个未完成的 SDK 下载文件（.downloading），本次不会处理这些文件"
    printf '  请等待百度网盘/云盘下载完成后再运行 sdk/处理SDK.command。\n'
  fi

  # 处理完整压缩包。
  find "$PIPELINE_ROOT/sdk" -type f \
    \( -iname '*.zip' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.har' \) \
    ! -iname '*.downloading' \
    ! -path '*/_processed/*' \
    ! -path '*/_backup/*' \
    ! -path '*/.extract-*/*' \
    ! -path '*/iOS/*' -not -path '*/Android/*' -not -path '*/HarmonyOS/*' \
    -print 2>/dev/null | sort >"$list"

  while IFS= read -r archive; do
    [ -n "$archive" ] || continue
    case "$archive" in
      "$PIPELINE_ROOT/sdk/iOS"/*|"$PIPELINE_ROOT/sdk/Android"/*|"$PIPELINE_ROOT/sdk/HarmonyOS"/*|"$PIPELINE_ROOT/sdk/_processed"/*|"$PIPELINE_ROOT/sdk/_backup"/*) continue ;;
    esac
    kind="$(detect_sdk_kind_from_path "$archive" || true)"
    if [ -z "$kind" ]; then
      failure_items+=("无法识别 SDK 类型: $archive")
      unknown_count=$((unknown_count + 1))
      continue
    fi
    version="$(detect_sdk_version_from_path "$archive")"
    if install_sdk_source "$kind" "$archive" "$version"; then
      status=0
    else
      status=$?
    fi
    if [ "$status" -eq 10 ]; then
      success_items+=("$kind SDK 已存在: $archive")
      continue
    fi
    if [ "$status" -eq 0 ]; then
      processed=$((processed + 1))
      success_items+=("$kind SDK: $archive -> sdk/$(platform_dir_name "$kind")/$version")
      if [ "$kind" = "ios" ] && ! ios_sdk_uniappx_ready; then
        abnormal_items+=("iOS SDK 为旧版 HBuilder-Hello 结构: $archive")
      fi
      mkdir -p "$PIPELINE_ROOT/sdk/_processed/$(platform_dir_name "$kind")"
      mv "$archive" "$PIPELINE_ROOT/sdk/_processed/$(platform_dir_name "$kind")/$(basename "$archive")"
    elif [ "$status" -eq 2 ]; then
      unreadable_items+=("$archive")
    else
      failure_items+=("${archive}（未找到有效 SDK 根目录）")
    fi
  done <"$list"

  # 处理解压后的原始目录：通过 SDK 标志文件识别。
  find "$PIPELINE_ROOT/sdk" -type d -name 'UniAppXDemo.xcodeproj' \
    ! -path '*/_processed/*' ! -path '*/_backup/*' ! -path '*/.extract-*/*' -not -path '*/iOS/*' -not -path '*/Android/*' -not -path '*/HarmonyOS/*' -print 2>/dev/null |
    while IFS= read -r marker; do
      [ -n "$marker" ] || continue
      printf 'ios|%s\n' "$(dirname "$(dirname "$marker")")" >>"$roots"
    done

  find "$PIPELINE_ROOT/sdk" -type d -path '*/SDK/libs' \
    ! -path '*/_processed/*' ! -path '*/_backup/*' ! -path '*/.extract-*/*' -not -path '*/iOS/*' -not -path '*/Android/*' -not -path '*/HarmonyOS/*' -print 2>/dev/null |
    while IFS= read -r marker; do
      [ -n "$marker" ] || continue
      printf 'android|%s\n' "$(dirname "$(dirname "$marker")")" >>"$roots"
    done

  find "$PIPELINE_ROOT/sdk" -type f \( -name 'oh-package.json5' -o -name '*.har' \) \
    ! -path '*/_processed/*' ! -path '*/_backup/*' ! -path '*/.extract-*/*' -not -path '*/iOS/*' -not -path '*/Android/*' -not -path '*/HarmonyOS/*' -print 2>/dev/null |
    while IFS= read -r marker; do
      [ -n "$marker" ] || continue
      printf 'harmony|%s\n' "$(dirname "$marker")" >>"$roots"
    done

  if [ -s "$roots" ]; then
    sort -u "$roots" >"$roots.sorted"
    while IFS='|' read -r kind root; do
      [ -n "$kind" ] && [ -n "$root" ] || continue
      case "$root" in
        "$PIPELINE_ROOT/sdk/iOS"/*|"$PIPELINE_ROOT/sdk/Android"/*|"$PIPELINE_ROOT/sdk/HarmonyOS"/*|"$PIPELINE_ROOT/sdk/_processed"/*|"$PIPELINE_ROOT/sdk/_backup"/*) continue ;;
      esac
      if find "$root" -type f -iname '*.downloading' -print -quit 2>/dev/null | grep -q .; then
        abnormal_items+=("目录包含未完成下载文件: $root")
        continue
      fi
      version="$(detect_sdk_version_from_path "$root")"
      if install_sdk_source "$kind" "$root" "$version"; then
        status=0
      else
        status=$?
      fi
      if [ "$status" -eq 10 ]; then
        success_items+=("$kind SDK 已存在: $root")
        continue
      fi
      if [ "$status" -eq 0 ]; then
        processed=$((processed + 1))
        success_items+=("$kind SDK: $root -> sdk/$(platform_dir_name "$kind")/$version")
        if [ "$kind" = "ios" ] && ! ios_sdk_uniappx_ready; then
          abnormal_items+=("iOS SDK 为旧版 HBuilder-Hello 结构: $root")
        fi
        mkdir -p "$PIPELINE_ROOT/sdk/_processed/$(platform_dir_name "$kind")"
        mv "$root" "$PIPELINE_ROOT/sdk/_processed/$(platform_dir_name "$kind")/$(basename "$root")"
      elif [ "$status" -eq 2 ]; then
        unreadable_items+=("$root")
      else
        failure_items+=("${root}（未找到有效 SDK 根目录）")
      fi
    done <"$roots.sorted"
    rm -f "$roots.sorted"
  fi

  rm -f "$list" "$roots"

  if [ "$processed" -eq 0 ]; then
    warn "sdk/ 中没有检测到新的待处理 SDK"
    printf '  如果 SDK 已经归位，可以直接使用；否则请把下载完成的压缩包或解压目录放到 sdk/。\n'
  fi

  if ! ios_sdk_ready; then
    abnormal_items+=("iOS SDK 缺失")
  elif ! ios_sdk_uniappx_ready; then
    abnormal_items+=("iOS SDK 为旧版 HBuilder-Hello，需要 UniAppX-iOS@$HX_SERIES")
  fi
  if ! android_sdk_ready; then
    abnormal_items+=("Android SDK 缺失")
  fi
  if ! harmony_sdk_ready; then
    abnormal_items+=("HarmonyOS Runtime 缺失")
  fi

  if [ "${#success_items[@]}" -eq 0 ]; then print_result_list "成功"; else print_result_list "成功" "${success_items[@]}"; fi
  if [ "${#abnormal_items[@]}" -eq 0 ]; then print_result_list "异常"; else print_result_list "异常" "${abnormal_items[@]}"; fi
  if [ "${#failure_items[@]}" -eq 0 ]; then print_result_list "失败"; else print_result_list "失败" "${failure_items[@]}"; fi
  if [ "${#unreadable_items[@]}" -eq 0 ]; then print_result_list "无法读取"; else print_result_list "无法读取" "${unreadable_items[@]}"; fi

  printf '\n当前 SDK 状态:\n'
  show_sdk_status

  if [ "$unknown_count" -gt 0 ]; then
    printf '\n无法识别文件的官方下载地址:\n'
    printf '  iOS SDK:\n'
    print_sdk_download_address ios
    printf '  Android SDK:\n'
    print_sdk_download_address android
    printf '  HarmonyOS Runtime:\n'
    print_sdk_download_address harmony
  else
    if ! ios_sdk_ready; then
      printf '\niOS SDK 缺失，请从以下地址下载：\n'
      print_sdk_download_address ios
    fi
    if ! android_sdk_ready; then
      printf '\nAndroid SDK 缺失，请从以下地址下载：\n'
      print_sdk_download_address android
    fi
    if ! harmony_sdk_ready; then
      printf '\nHarmonyOS Runtime 缺失，请从以下地址安装：\n'
      print_sdk_download_address harmony
    fi
  fi

  cleanup_unused_files
}

cleanup_unused_files() {
  local count_ds count_macos count_extract count_arch count_processed kind archive target_ready
  count_ds=0
  count_macos=0
  count_extract=0
  count_arch=0
  count_processed=0

  count_ds="$(find "$PIPELINE_ROOT" -type f -name '.DS_Store' -print 2>/dev/null | wc -l | tr -d ' ')"
  find "$PIPELINE_ROOT" -type f -name '.DS_Store' -delete 2>/dev/null || true

  count_macos="$(find "$PIPELINE_ROOT" -type d -name '__MACOSX' -print 2>/dev/null | wc -l | tr -d ' ')"
  find "$PIPELINE_ROOT" -type d -name '__MACOSX' -prune -exec rm -rf {} + 2>/dev/null || true

  count_extract="$(find "$PIPELINE_ROOT/sdk" -maxdepth 1 -type d -name '.extract-*' -print 2>/dev/null | wc -l | tr -d ' ')"
  find "$PIPELINE_ROOT/sdk" -maxdepth 1 -type d -name '.extract-*' -exec rm -rf {} + 2>/dev/null || true

  if [ "${KEEP_SDK_ARCHIVES:-true}" != "true" ]; then
    while IFS= read -r archive; do
      [ -n "$archive" ] || continue
      kind="$(detect_sdk_kind_from_path "$archive" || true)"
      target_ready=0
      case "$kind" in
        ios) ios_sdk_ready && target_ready=1 ;;
        android) android_sdk_ready && target_ready=1 ;;
        harmony) harmony_sdk_ready && target_ready=1 ;;
      esac
      if [ "$target_ready" -eq 1 ]; then
        rm -f "$archive"
        count_arch=$((count_arch + 1))
      fi
    done < <(find "$PIPELINE_ROOT/sdk" -maxdepth 1 -type f \( -iname '*.zip' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.har' \) -print 2>/dev/null)

    if ios_sdk_ready && [ -d "$PIPELINE_ROOT/sdk/_processed/iOS" ]; then
      rm -rf "$PIPELINE_ROOT/sdk/_processed/iOS"
      count_processed=$((count_processed + 1))
    fi
    if android_sdk_ready && [ -d "$PIPELINE_ROOT/sdk/_processed/Android" ]; then
      rm -rf "$PIPELINE_ROOT/sdk/_processed/Android"
      count_processed=$((count_processed + 1))
    fi
    if harmony_sdk_ready && [ -d "$PIPELINE_ROOT/sdk/_processed/HarmonyOS" ]; then
      rm -rf "$PIPELINE_ROOT/sdk/_processed/HarmonyOS"
      count_processed=$((count_processed + 1))
    fi
  fi

  printf '\n清理无用文件:\n'
  printf '  .DS_Store: %s\n' "$count_ds"
  printf '  __MACOSX: %s\n' "$count_macos"
  printf '  临时解压目录: %s\n' "$count_extract"
  if [ "${KEEP_SDK_ARCHIVES:-true}" = "true" ]; then
    printf '  已归位平台的原始压缩包: 保留\n'
    printf '  _processed 平台备份: 保留\n'
  else
    printf '  已归位平台的原始压缩包: %s\n' "$count_arch"
    printf '  _processed 平台备份: %s\n' "$count_processed"
  fi
}

install_harmony_runtime() {
  local ohpm="$DEVECO_STUDIO_APP/Contents/tools/ohpm/bin/ohpm"
  local dir="$PIPELINE_ROOT/sdk/HarmonyOS/$HX_SERIES"
  local package="@dcloudio/uni-app-x-runtime@${HX_SERIES}.*"

  if [ ! -x "$ohpm" ]; then
    warn "未找到 DevEco ohpm，跳过 HarmonyOS runtime 自动安装"
    return 0
  fi

  mkdir -p "$dir"
  if [ ! -f "$dir/oh-package.json5" ]; then
    # 目录名通常是 5.26 这类纯数字+点号，不能直接作为 ohpm 项目名。
    # 使用固定合法 name，避免 ohpm init -y 报 name contains invalid characters。
    cat >"$dir/oh-package.json5" <<'JSON'
{
  "name": "app-packager-harmony-runtime",
  "version": "1.0.0",
  "description": "HarmonyOS runtime for app-packager",
  "main": "Index.ets",
  "author": "",
  "license": "ISC",
  "dependencies": {}
}
JSON
  fi

  printf '  是否使用 ohpm 安装 %s 到 sdk/HarmonyOS/%s？[y/N]: ' "$package" "$HX_SERIES"
  read -r answer || answer=""
  case "$answer" in
    y|Y|yes|YES)
      if (cd "$dir" && "$ohpm" install "$package" --save-prod); then
        LOCAL_HARMONY_SDK_DIR="$dir"
        ok "HarmonyOS runtime 已安装: $package"
      else
        warn "HarmonyOS runtime 安装失败，请在 DevEco Studio 中执行 ohpm install"
      fi
      ;;
    *)
      warn "已跳过 HarmonyOS runtime 自动安装"
      ;;
  esac
}

setup_sdks() {
  step 3 "准备离线 SDK"
  mkdir -p "$PIPELINE_ROOT/sdk/iOS/$HX_SERIES" \
    "$PIPELINE_ROOT/sdk/Android/$HX_SERIES" \
    "$PIPELINE_ROOT/sdk/HarmonyOS/$HX_SERIES" \
    "$DOWNLOAD_DIR"

  LOCAL_IOS_RUNTIME_VERSION="$HX_SERIES"
  HARMONY_RUNTIME_VERSION="$HX_SERIES"
  LOCAL_IOS_SDK_DIR="$PIPELINE_ROOT/sdk/iOS/$HX_SERIES"
  LOCAL_ANDROID_SDK_DIR="$PIPELINE_ROOT/sdk/Android/$HX_SERIES"
  LOCAL_HARMONY_SDK_DIR="${LOCAL_HARMONY_SDK_DIR:-$PIPELINE_ROOT/sdk/HarmonyOS/$HX_SERIES}"

  local page
  for kind in ios android; do
    page="$(official_page "$kind")"
    printf '\n-- %s SDK --\n' "$kind"
    printf '  官方页面: %s\n' "$page"
    printf '  需要版本: HBuilderX %s，SDK 系列 %s\n' "$HX_VERSION" "$HX_SERIES"
    printf '  请从官方页面下载对应版本压缩包。\n'
    show_official_sdk_links "$page"
    local direct_url
    direct_url="$(resolve_direct_sdk_url "$kind" "$HX_SERIES" || true)"
    if [ -n "$direct_url" ]; then
      printf '  官方直链: %s\n' "$direct_url"
      printf '  是否现在自动下载并导入？[Y/n]: '
      read -r answer || answer=""
      case "$answer" in
        n|N|no|NO) ;;
        *)
          if import_sdk_archive "$kind" "$direct_url" "$HX_SERIES"; then
            continue
          fi
          ;;
      esac
    fi
    open_url "$page"
    if import_sdk_archive "$kind"; then
      :
    else
      warn "已跳过 $kind SDK 导入，后续可重新运行初始化工具"
    fi
  done

  printf '\n-- harmony SDK --\n'
  printf '  HarmonyOS uni-app x SDK 通过 DevEco 的 ohpm 依赖安装：\n'
  printf '    @dcloudio/uni-app-x-runtime: "%s.*"\n' "$HX_SERIES"
  printf '  官方说明: %s\n' "$(official_page harmony)"
  if [ -d "$DEVECO_STUDIO_APP/Contents/sdk" ]; then
    ok "已检测到 DevEco SDK: $DEVECO_STUDIO_APP/Contents/sdk"
    install_harmony_runtime
  else
    warn "未检测到 DevEco SDK，安装 DevEco Studio 后重新运行初始化"
  fi
}

setup_certificates() {
  local source="${1:-}" answer=""

  step 5 "导入/更新证书"
  mkdir -p "$PIPELINE_ROOT/certificates/iOS" \
    "$PIPELINE_ROOT/certificates/Android" \
    "$PIPELINE_ROOT/certificates/HarmonyOS" \
    "$PIPELINE_ROOT/certificates/_history"

  if [ -n "$source" ]; then
    source="${source/#\~/$HOME}"
    if [ -d "$source" ]; then
      ok "证书来源目录: $source"
      process_certificates_root "$source"
      return 0
    fi
    warn "证书来源目录不存在，改为扫描 certificates/ 下的来源目录: $source"
  fi

  printf '  可输入包含 iOS/Android/HarmonyOS 证书的来源目录，直接回车扫描 certificates/，输入 s 跳过: '
  read -r answer || answer=""
  case "$answer" in
    s|S|skip|SKIP) warn "已跳过证书导入，后续仍可在主菜单执行“更新/处理证书”" ;;
    '')
      process_certificates_root
      ;;
    *)
      answer="${answer/#\~/$HOME}"
      if [ -d "$answer" ]; then
        process_certificates_root "$answer"
      else
        warn "证书来源目录不存在，本次未导入: $answer"
      fi
      ;;
  esac
}

refresh_harmony_signing_files() {
  local project_file project_id source_dir
  [ -d "$PIPELINE_ROOT/config/projects" ] || return 0

  for project_file in "$PIPELINE_ROOT"/config/projects/*.env; do
    [ -f "$project_file" ] || continue
    project_id="$(basename "$project_file" .env)"
    source_dir="$(
      unset SOURCE_DIR
      # shellcheck source=/dev/null
      source "$project_file" >/dev/null 2>&1 || exit 1
      printf '%s' "${SOURCE_DIR:-}"
    )"
    [ -n "$source_dir" ] && [ -d "$source_dir" ] || continue
    if ( WORKSPACE="$source_dir" materialize_harmony_signing_files ); then
      ok "已按项目 signingConfigs 检查 HarmonyOS 证书文件: $project_id"
    else
      warn "HarmonyOS signingConfigs 引用的证书文件不完整: $project_id"
    fi
  done
}

refresh_project_profiles() {
  local project_file project_id expected_bundle profile_file tmp_file
  [ -d "$PIPELINE_ROOT/config/projects" ] || return 0

  for project_file in "$PIPELINE_ROOT"/config/projects/*.env; do
    [ -f "$project_file" ] || continue
    project_id="$(basename "$project_file" .env)"
    expected_bundle="$(
      unset EXPECTED_BUNDLE_ID
      # shellcheck disable=SC1090
      source "$project_file" >/dev/null 2>&1 || exit 1
      printf '%s' "${EXPECTED_BUNDLE_ID:-}"
    )"
    [ -n "$expected_bundle" ] || continue
    profile_file="$(find_matching_ios_profile "$expected_bundle" || true)"
    [ -n "$profile_file" ] || continue

    tmp_file="$(mktemp)"
    python3 - "$project_file" "$tmp_file" "$profile_file" <<'PY_REFRESH_PROFILE'
from pathlib import Path
import re
import sys
source_path = Path(sys.argv[1])
target_path = Path(sys.argv[2])
profile = sys.argv[3]
text = source_path.read_text(encoding='utf-8', errors='surrogateescape')
replacement = 'PROFILE_FILE=' + repr(profile) + '\n'
if re.search(r'^PROFILE_FILE=.*$', text, flags=re.M):
    text = re.sub(r'^PROFILE_FILE=.*$', replacement.rstrip('\n'), text, count=1, flags=re.M)
else:
    text = text.rstrip('\n') + '\n' + replacement
target_path.write_text(text, encoding='utf-8', errors='surrogateescape')
PY_REFRESH_PROFILE
    mv -f "$tmp_file" "$project_file"
    ok "已刷新项目 Profile: $project_id -> $profile_file"
  done
}

register_project() {
  step 6 "读取并注册 uni-app x 项目"
  local found=0 path answer project_path search_root
  search_root="$(dirname "$PIPELINE_ROOT")"

  printf '  正在扫描同级目录中的 uni-app x 项目: %s\n' "$search_root"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    found=$((found + 1))
    register_project_path "$path" || true
  done < <(discover_uni_app_projects)

  if [ "$found" -gt 0 ]; then
    ok "初始化已读取 $found 个 uni-app x 项目，配置写入 config/projects/"
    printf '  是否继续添加同级目录之外的项目？[y/N]: '
    read -r answer || answer=""
    case "$answer" in
      y|Y|yes|YES) ;;
      *) return 0 ;;
    esac
  else
    warn "未在 $search_root 中发现 uni-app x 项目"
    printf '  请将项目放在打包工具同级目录，或现在输入项目绝对路径。\n'
  fi

  while true; do
    printf '  请输入 uni-app x 项目目录（可直接拖入终端），输入 q 跳过: ' >&2
    read -r project_path || return 1
    [ "$project_path" = "q" ] && return 0
    project_path="${project_path/#\~/$HOME}"
    if register_project_path "$project_path"; then
      return 0
    fi
  done
}

ensure_upload_local_config() {
  local file="$PIPELINE_ROOT/config/upload.local.env"
  local example="$PIPELINE_ROOT/config/upload.local.env.example"
  if [ ! -f "$file" ] && [ -f "$example" ]; then
    cp "$example" "$file"
    ok "已生成本机上传配置: $file"
  fi
}

ensure_parallel_local_config() {
  local file="$PIPELINE_ROOT/config/parallel.local.env"
  local example="$PIPELINE_ROOT/config/parallel.local.env.example"
  if [ ! -f "$file" ] && [ -f "$example" ]; then
    cp "$example" "$file"
    ok "已生成本机并行构建配置: $file"
  fi
}

write_local_settings() {
  local file="$PIPELINE_ROOT/config/settings.local.env" upload_local=""
  if [ -f "$file" ]; then
    upload_local="$(grep -E '^(PGYER_|UPLOAD_|HARMONY_P12_PASSWORD=)' "$file" 2>/dev/null || true)"
  fi
  {
    printf '# 由初始化向导生成，本文件已加入 .gitignore。\n'
    printf 'HBUILDERX_APP=%q\n' "$HBUILDERX_APP"
    printf 'HBUILDERX_CLI=%q\n' "$HBUILDERX_CLI"
    printf 'LOCAL_IOS_SDK_DIR=%q\n' "$LOCAL_IOS_SDK_DIR"
    printf 'LOCAL_ANDROID_SDK_DIR=%q\n' "$LOCAL_ANDROID_SDK_DIR"
    printf 'LOCAL_HARMONY_SDK_DIR=%q\n' "$LOCAL_HARMONY_SDK_DIR"
    printf 'LOCAL_IOS_RUNTIME_VERSION=%q\n' "$LOCAL_IOS_RUNTIME_VERSION"
    printf 'HARMONY_RUNTIME_VERSION=%q\n' "$HARMONY_RUNTIME_VERSION"
    printf 'ANDROID_SDK_DIR=%q\n' "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}"
    printf 'ANDROID_GRADLE_BIN=%q\n' "$(find_gradle || true)"
    if [ -n "$upload_local" ]; then
      printf '\n# 保留已有上传平台配置\n'
      printf '%s\n' "$upload_local"
    fi
  } >"$file"
  ok "本地初始化配置已写入: $file"
}

write_init_state() {
  {
    printf 'INITIALIZED_AT=%q\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    printf 'HBUILDERX_VERSION=%q\n' "$HX_VERSION"
    printf 'HX_SERIES=%q\n' "$HX_SERIES"
    printf 'IOS_SDK_DIR=%q\n' "$LOCAL_IOS_SDK_DIR"
    printf 'ANDROID_SDK_DIR=%q\n' "$LOCAL_ANDROID_SDK_DIR"
    printf 'HARMONY_SDK_DIR=%q\n' "$LOCAL_HARMONY_SDK_DIR"
  } >"$INIT_STATE"
  ok "初始化状态已写入: $INIT_STATE"
}

summary() {
  step 7 "初始化完成"
  printf '  HBuilderX: %s (%s)\n' "$HBUILDERX_APP" "$HX_VERSION"
  printf '  iOS SDK: %s\n' "$LOCAL_IOS_SDK_DIR"
  printf '  Android SDK: %s\n' "$LOCAL_ANDROID_SDK_DIR"
  printf '  Harmony SDK: %s\n' "$LOCAL_HARMONY_SDK_DIR"
  printf '  证书目录: %s\n' "$PIPELINE_ROOT/certificates"
  printf '  并行构建配置: %s\n' "$PIPELINE_ROOT/config/parallel.env"
  parallel_config_summary
  printf '\n'
  print_registered_projects
  printf '\n  下一步:\n'
  printf '    1. 双击 打包工具.command\n'
  printf '    2. 选择对应项目平台进行打包\n'
  printf '    3. 如果 iOS 证书暂未配置，先运行 setup-signing.sh\n'
}

main() {
  local cert_source="${1:-}"
  title "AppPackager 初始化向导"
  printf '  工具目录: %s\n' "$PIPELINE_ROOT"
  printf '  本向导会检测 HBuilderX、原生编辑器、离线 SDK、证书、项目配置和本机依赖。\n'
  if [ -n "$cert_source" ]; then
    printf '  证书来源目录: %s\n' "$cert_source"
  fi
  pause_enter "按回车开始初始化: "

  ensure_hbuilderx
  check_apps
  setup_sdks
  check_dependencies
  install_missing_dependencies
  prepare_android_licenses
  setup_certificates "$cert_source"
  ensure_upload_local_config
  ensure_parallel_local_config
  refresh_project_profiles
  register_project
  refresh_harmony_signing_files
  write_local_settings
  write_init_state
  cleanup_unused_files
  summary
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
