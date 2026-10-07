# shellcheck shell=bash

log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
warn() { printf '[%s] WARN %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { printf '[%s] ERROR %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

# 自定义 UTS / 原生插件跨平台联编与归档校验
# shellcheck source=/dev/null
source "${PIPELINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/lib/plugins.sh"
# shellcheck source=/dev/null
source "${PIPELINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/lib/certificates.sh"
# shellcheck source=/dev/null
source "${PIPELINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/lib/upload.sh"
# shellcheck source=/dev/null
source "${PIPELINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/lib/parallel.sh"

find_cached_gradle() {
  local candidate
  while IFS= read -r candidate; do
    [ -x "$candidate" ] || continue
    if run_with_timeout 20 "$candidate" --version >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(find "$HOME/.gradle/wrapper/dists" -type f -path '*/gradle-*/bin/gradle' -perm -111 2>/dev/null | sort -V -r)
  return 1
}

run_with_timeout() {
  local seconds="$1"
  shift
  local cmd_pid watcher_pid status i
  "$@" &
  cmd_pid=$!
  (
    i=0
    while [ "$i" -lt "$seconds" ]; do
      kill -0 "$cmd_pid" 2>/dev/null || exit 0
      sleep 1
      i=$((i + 1))
    done
    kill -TERM "$cmd_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$cmd_pid" 2>/dev/null || true
  ) &
  watcher_pid=$!
  wait "$cmd_pid"
  status=$?
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  return "$status"
}

project_ids() {
  local f
  for f in "$PIPELINE_ROOT"/config/projects/*.env; do
    [ -f "$f" ] || continue
    basename "$f" .env
  done | sort
}

manifest_metadata() {
  python3 - "$1" <<'PY_MANIFEST'
from pathlib import Path
import re
import shlex
import sys
text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore')
def value(key):
    m = re.search(r'"%s"\s*:\s*"([^"]*)"' % re.escape(key), text)
    if m:
        return m.group(1)
    m = re.search(r'"%s"\s*:\s*([0-9]+)' % re.escape(key), text)
    return m.group(1) if m else ''
domains = []
m = re.search(r'"associatedDomains"\s*:\s*\[(.*?)\]', text, re.S)
if m:
    domains = re.findall(r'"([^"]+)"', m.group(1))
values = {
    'MANIFEST_NAME': value('name'),
    'MANIFEST_APP_ID': value('appid'),
    'MANIFEST_VERSION_NAME': value('versionName'),
    'MANIFEST_VERSION_CODE': value('versionCode'),
    'MANIFEST_ASSOCIATED_DOMAINS': ' '.join(domains),
}
for key in ('MANIFEST_NAME', 'MANIFEST_APP_ID', 'MANIFEST_VERSION_NAME', 'MANIFEST_VERSION_CODE', 'MANIFEST_ASSOCIATED_DOMAINS'):
    print(f'{key}={shlex.quote(values[key])}')
PY_MANIFEST
}

absolute_dir() {
  local path="$1"
  [ -d "$path" ] || return 1
  (cd "$path" 2>/dev/null && pwd -P)
}

is_uni_app_project() {
  local dir="$1"
  { [ -f "$dir/manifest.json" ] && [ -f "$dir/pages.json" ]; } ||
    { [ -f "$dir/src/manifest.json" ] && [ -f "$dir/src/pages.json" ]; }
}

project_manifest_path() {
  local dir="$1"
  if [ -f "$dir/manifest.json" ]; then
    printf '%s\n' "$dir/manifest.json"
  elif [ -f "$dir/src/manifest.json" ]; then
    printf '%s\n' "$dir/src/manifest.json"
  else
    return 1
  fi
}

project_pages_path() {
  local dir="$1"
  if [ -f "$dir/pages.json" ]; then
    printf '%s\n' "$dir/pages.json"
  elif [ -f "$dir/src/pages.json" ]; then
    printf '%s\n' "$dir/src/pages.json"
  else
    return 1
  fi
}

workspace_manifest_path() {
  local root="${1:-${WORKSPACE:-}}"
  project_manifest_path "$root"
}

workspace_app_file() {
  local root="${1:-${WORKSPACE:-}}"
  if [ -f "$root/App.uvue" ]; then
    printf '%s\n' "$root/App.uvue"
  elif [ -f "$root/src/App.uvue" ]; then
    printf '%s\n' "$root/src/App.uvue"
  else
    return 1
  fi
}

project_id_from_source_dir() {
  local base
  base="$(basename "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')"
  [ -n "$base" ] || base="uni-app-$(date '+%Y%m%d%H%M%S')"
  printf '%s\n' "$base"
}

project_bundle_id_from_source_dir() {
  local dir="$1" file value
  for file in \
    "$dir/app-android/app/build.gradle" \
    "$dir/scripts/ios-package/env/adhoc.env"; do
    [ -f "$file" ] || continue
    case "$file" in
      *.gradle)
        value="$(sed -nE "s/.*applicationId[[:space:]]+[\"']([^\"']+)[\"'].*/\1/p" "$file" | head -n 1)"
        if [ -z "$value" ]; then
          value="$(sed -nE "s/.*applicationId[[:space:]]+([^[:space:]\"']+).*/\1/p" "$file" | head -n 1)"
        fi
        ;;
      *)
        value="$(grep -E '^[[:space:]]*BUNDLE_ID[[:space:]]*=' "$file" 2>/dev/null | head -n 1 | cut -d= -f2- | sed -E 's/^[[:space:]]*\"?//; s/\"?[[:space:]]*(#.*)?$//')"
        ;;
    esac
    if [ -n "$value" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}

find_matching_ios_profile() {
  local bundle_id="$1" file plist app_id candidate
  [ -n "$bundle_id" ] || return 1

  while IFS= read -r -d '' file; do
    plist="$(mktemp)"
    if openssl smime -verify -inform DER -in "$file" -noverify -out "$plist" >/dev/null 2>&1; then
      app_id="$(plutil -extract Entitlements.application-identifier raw -o - "$plist" 2>/dev/null || true)"
      candidate="${app_id#*.}"
      if [ -n "$app_id" ] && [ "$candidate" = "$bundle_id" ]; then
        rm -f "$plist"
        printf '%s\n' "$file"
        return 0
      fi
    fi
    rm -f "$plist"
  done < <(find "$PIPELINE_ROOT/certificates/iOS" "$PIPELINE_ROOT/signing/current" \
    -maxdepth 4 -type f -iname '*.mobileprovision' -print0 2>/dev/null)
  return 1
}

ios_profile_files() {
  find "$PIPELINE_ROOT/certificates/iOS" "$PIPELINE_ROOT/signing/current" \
    -maxdepth 4 -type f -iname '*.mobileprovision' 2>/dev/null | sort
}

# 只解出描述文件字段，不做期望值/过期校验：清单展示与按类型查找复用同一套读取逻辑。
extract_ios_profile_fields() {
  local profile_file="$1" plist_file="$2" app_identifier
  [ -f "$profile_file" ] || return 1
  openssl smime -verify -inform DER -in "$profile_file" -noverify -out "$plist_file" >/dev/null 2>&1 || return 1

  PROFILE_NAME="$(plutil -extract Name raw -o - "$plist_file" 2>/dev/null || true)"
  PROFILE_UUID="$(plutil -extract UUID raw -o - "$plist_file" 2>/dev/null || true)"
  PROFILE_EXPIRY="$(plutil -extract ExpirationDate raw -o - "$plist_file" 2>/dev/null || true)"
  TEAM_ID="$(plutil -extract TeamIdentifier.0 raw -o - "$plist_file" 2>/dev/null || true)"
  app_identifier="$(plutil -extract Entitlements.application-identifier raw -o - "$plist_file" 2>/dev/null || true)"
  BUNDLE_ID="${app_identifier#*.}"
  extract_ios_profile_kind "$plist_file"
  return 0
}

extract_ios_profile_kind() {
  local plist_file="$1" get_task_allow="false" provisions_all="false"
  get_task_allow="$(plutil -extract Entitlements.get-task-allow raw -o - "$plist_file" 2>/dev/null || echo false)"
  provisions_all="$(plutil -extract ProvisionsAllDevices raw -o - "$plist_file" 2>/dev/null || echo false)"
  if [ "$provisions_all" = "true" ]; then
    PROFILE_KIND="enterprise"
  elif plutil -extract ProvisionedDevices raw -o - "$plist_file" >/dev/null 2>&1; then
    if [ "$get_task_allow" = "true" ]; then
      PROFILE_KIND="development"
    else
      PROFILE_KIND="adhoc"
    fi
  else
    PROFILE_KIND="appstore"
  fi
}

find_ios_profile_by_kind() {
  local bundle_id="$1" kind="$2" file plist
  [ -n "$bundle_id" ] || return 1
  [ -n "$kind" ] || return 1
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    plist="$(mktemp)"
    if extract_ios_profile_fields "$file" "$plist" \
      && [ "$BUNDLE_ID" = "$bundle_id" ] && [ "$PROFILE_KIND" = "$kind" ]; then
      rm -f "$plist"
      printf '%s\n' "$file"
      return 0
    fi
    rm -f "$plist"
  done < <(ios_profile_files)
  return 1
}

profiles_json() {
  local file plist expired epoch now
  {
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      plist="$(mktemp)"
      if extract_ios_profile_fields "$file" "$plist"; then
        expired="false"
        epoch="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$PROFILE_EXPIRY" '+%s' 2>/dev/null || echo 0)"
        now="$(date '+%s')"
        [ "$epoch" -gt "$now" ] || expired="true"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
          "$file" "$PROFILE_KIND" "$BUNDLE_ID" "$TEAM_ID" \
          "${PROFILE_NAME//$'\t'/ }" "$PROFILE_EXPIRY" "$PROFILE_UUID" "$expired"
      fi
      rm -f "$plist"
    done < <(ios_profile_files)
  } | python3 -c '
import json, sys
rows = []
for line in sys.stdin.read().splitlines():
    parts = line.split("\t")
    if len(parts) < 8:
        continue
    file, kind, bundle, team, name, expiry, uuid, expired = parts[:8]
    rows.append({
        "file": file,
        "kind": kind,
        "bundleId": bundle,
        "teamId": team,
        "name": name,
        "expiry": expiry,
        "uuid": uuid,
        "expired": expired == "true",
    })
print(json.dumps(rows, ensure_ascii=False, indent=2))
'
}

# --set 允许覆盖的键：只包含 write_package_env 生成的打包参数，
# 引擎自己推导的路径类键（SDK_ROOT/OUTPUT_ROOT/SOURCE_APP_DIR）不在其中。
PACKAGE_ENV_OVERRIDE_KEYS="APP_NAME APP_ID BUNDLE_ID TEAM_ID PROFILE_NAME SIGNING_CERTIFICATE EXPORT_METHOD PACKAGE_KIND SCHEME CONFIGURATION CHANNEL MARKETING_VERSION BUILD_NUMBER"

set_package_override() {
  local pair="$1" key="${1%%=*}" value=""
  [ "$pair" != "$key" ] || die "--set 需要 KEY=VALUE 形式: $pair"
  value="${pair#*=}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "--set 键名不合法: $key"
  case " $PACKAGE_ENV_OVERRIDE_KEYS " in
    *" $key "*) ;;
    *) die "--set 不支持的键: ${key}（可用: ${PACKAGE_ENV_OVERRIDE_KEYS}）" ;;
  esac
  case "$value" in
    *$'\n'*) die "--set 的值不能包含换行: $key" ;;
  esac
  APP_PACKAGER_SET_OVERRIDES="${APP_PACKAGER_SET_OVERRIDES:-}${key}=${value}"$'\n'
  export APP_PACKAGER_SET_OVERRIDES
}

# 命令行选项覆盖项目配置/全局设置，只影响本次调用。
apply_build_option_overrides() {
  if [ -n "${APP_PACKAGER_FULL_PERMISSION:-}" ]; then
    case "$APP_PACKAGER_FULL_PERMISSION" in
      true|false)
        FULL_PERMISSION_PROFILE="$APP_PACKAGER_FULL_PERMISSION"
        FULL_PERMISSION_PROMPT="$APP_PACKAGER_FULL_PERMISSION"
        ;;
    esac
  fi

  if [ -n "${APP_PACKAGER_PROFILE_FILE:-}" ]; then
    [ -f "$APP_PACKAGER_PROFILE_FILE" ] || die "指定的描述文件不存在: $APP_PACKAGER_PROFILE_FILE"
    PROFILE_FILE="$APP_PACKAGER_PROFILE_FILE"
  fi

  if [ -n "${APP_PACKAGER_PACKAGE_KIND:-}" ]; then
    local plist kind="" matched=""
    if [ -n "${APP_PACKAGER_PROFILE_FILE:-}" ]; then
      plist="$(mktemp)"
      extract_ios_profile_fields "$PROFILE_FILE" "$plist" && kind="$PROFILE_KIND"
      rm -f "$plist"
      if [ -n "$kind" ] && [ "$kind" != "$APP_PACKAGER_PACKAGE_KIND" ]; then
        die "请求 $APP_PACKAGER_PACKAGE_KIND 包，但指定/接线的描述文件是 $kind 类型: $PROFILE_FILE"
      fi
    else
      matched="$(find_ios_profile_by_kind "${EXPECTED_BUNDLE_ID:-}" "$APP_PACKAGER_PACKAGE_KIND" || true)"
      if [ -z "$matched" ]; then
        die "未找到 $APP_PACKAGER_PACKAGE_KIND 类型的描述文件（Bundle ID: ${EXPECTED_BUNDLE_ID:-未配置}）。把描述文件放到 signing/current/ 或 certificates/iOS/，或用 --profile <路径> 指定。"
      fi
      PROFILE_FILE="$matched"
    fi
  fi
}

project_search_roots() {
  local roots="${PROJECT_SEARCH_ROOTS:-$(dirname "$PIPELINE_ROOT")}"
  printf '%s\n' "$roots" | tr ':' '\n'
}

discover_uni_app_projects() {
  local root dir resolved
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    root="$(absolute_dir "$root" || true)"
    [ -n "$root" ] || continue
    for dir in "$root"/*; do
      [ -d "$dir" ] || continue
      [ "$dir" = "$PIPELINE_ROOT" ] && continue
      case "$(basename "$dir")" in
        .*|node_modules|unpackage|_*) continue ;;
      esac
      is_uni_app_project "$dir" || continue
      resolved="$(absolute_dir "$dir" || true)"
      [ -n "$resolved" ] && printf '%s\n' "$resolved"
    done
  done < <(project_search_roots)
}

register_project_path() {
  local source_dir="$1" quiet="${2:-}"
  local manifest pages project_id default_id app_name app_id bundle_id profile_file matched_profile
  local config_file existing_source base_id suffix
  local expected_team_id android_enabled harmony_enabled

  source_dir="$(absolute_dir "$source_dir" || true)"
  if [ -z "$source_dir" ] || ! is_uni_app_project "$source_dir"; then
    [ "$quiet" = "quiet" ] || printf '  [WARN] 项目目录无效或不是 uni-app x 项目: %s\n' "$1"
    return 1
  fi

  manifest="$(project_manifest_path "$source_dir")"
  pages="$(project_pages_path "$source_dir")"
  [ -n "$manifest" ] && [ -n "$pages" ] || return 1

  default_id="$(project_id_from_source_dir "$source_dir")"
  project_id="$default_id"
  app_name="$(basename "$source_dir")"
  app_id=""
  eval "$(manifest_metadata "$manifest")"
  app_name="${MANIFEST_NAME:-$app_name}"
  app_id="${MANIFEST_APP_ID:-}"
  bundle_id="$(project_bundle_id_from_source_dir "$source_dir" || true)"
  expected_team_id=""
  android_enabled="false"
  [ -f "$source_dir/app-android/app/build.gradle" ] && android_enabled="true"
  harmony_enabled="false"
  if grep -q '"app-harmony"' "$manifest" 2>/dev/null || [ -d "$source_dir/harmony-configs" ]; then
    harmony_enabled="true"
  fi

  config_file="$PIPELINE_ROOT/config/projects/$project_id.env"
  if [ -f "$config_file" ]; then
    existing_source="$(
      set +u
      # shellcheck disable=SC1090
      source "$config_file" >/dev/null 2>&1 || true
      printf '%s' "${SOURCE_DIR:-}"
    )"
    if [ "$existing_source" = "$source_dir" ]; then
      [ "$quiet" = "quiet" ] || printf '  [OK] 项目已注册: %s (%s) -> %s\n' "$project_id" "$app_name" "$source_dir"
      return 0
    fi

    base_id="$project_id"
    suffix=2
    while [ -f "$PIPELINE_ROOT/config/projects/${base_id}-${suffix}.env" ]; do
      suffix=$((suffix + 1))
    done
    project_id="${base_id}-${suffix}"
    config_file="$PIPELINE_ROOT/config/projects/$project_id.env"
  fi

  matched_profile="$(find_matching_ios_profile "$bundle_id" || true)"
  if [ -n "$matched_profile" ]; then
    profile_file="$matched_profile"
  else
    profile_file="$PIPELINE_ROOT/signing/current/${project_id}.mobileprovision"
  fi

  mkdir -p "$PIPELINE_ROOT/config/projects"
  {
    printf 'PROJECT_ID=%q\n' "$project_id"
    printf 'SOURCE_DIR=%q\n' "$source_dir"
    printf 'HX_PROJECT_NAME=%q\n' "${project_id}-build"
    printf 'APP_NAME=%q\n' "$app_name"
    printf 'APP_ID=%q\n' "$app_id"
    printf 'EXPECTED_BUNDLE_ID=%q\n' "$bundle_id"
    printf 'EXPECTED_TEAM_ID=%q\n' "$expected_team_id"
    printf 'PROFILE_FILE=%q\n' "$profile_file"
    printf 'SCHEME=%q\n' "UniAppX"
    printf 'CONFIGURATION=%q\n' "Release"
    printf 'BUILD_SCRIPT_RELATIVE=%q\n' "scripts/ios-package/build-adhoc-ipa.sh"
    printf 'IOS_ENABLED=%q\n' "true"
    printf 'ANDROID_ENABLED=%q\n' "$android_enabled"
    printf 'ANDROID_MODULE_DIR=%q\n' "app-android"
    printf 'HARMONY_ENABLED=%q\n' "$harmony_enabled"
  } >"$config_file"

  if [ "$quiet" != "quiet" ]; then
    printf '  [OK] 已注册项目: %s (%s) -> %s\n' "$project_id" "$app_name" "$source_dir"
    if [ -n "$bundle_id" ]; then
      printf '       Bundle ID: %s\n' "$bundle_id"
    fi
    if [ -n "$matched_profile" ]; then
      printf '       Profile: %s\n' "$matched_profile"
    fi
  fi
  return 0
}

register_discovered_projects() {
  local quiet="${1:-}" path found=0 registered=0 failed=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    found=$((found + 1))
    if register_project_path "$path" "$quiet"; then
      registered=$((registered + 1))
    else
      failed=$((failed + 1))
    fi
  done < <(discover_uni_app_projects)

  if [ "$quiet" != "quiet" ]; then
    printf '  扫描目录: %s\n' "$(project_search_roots | tr '\n' ' ')"
    printf '  发现项目: %s，注册/已存在: %s，失败: %s\n' "$found" "$registered" "$failed"
  fi
  [ "$found" -gt 0 ]
}

# 登记用户明确指定的目录（不依赖 PROJECT_SEARCH_ROOTS）：
# 目录本身是 uni-app x 项目就登记它，否则登记其下一层的 uni-app x 项目。
register_paths() {
  local dir child registered=0
  for dir in "$@"; do
    if is_uni_app_project "$dir"; then
      register_project_path "$dir" && registered=$((registered + 1))
      continue
    fi
    for child in "$dir"/*; do
      [ -d "$child" ] || continue
      case "$(basename "$child")" in
        .*|node_modules|unpackage|_*) continue ;;
      esac
      is_uni_app_project "$child" || continue
      register_project_path "$child" && registered=$((registered + 1))
    done
  done

  if [ "$registered" -eq 0 ]; then
    printf '  [WARN] 指定目录里没有找到 uni-app x 项目（需要 manifest.json + pages.json）\n'
    return 1
  fi
  printf '  已登记/已存在项目: %s\n' "$registered"
  return 0
}

print_registered_projects() {
  local id file count=0
  printf '已读取项目:\n'
  for id in $(project_ids); do
    file="$PIPELINE_ROOT/config/projects/$id.env"
    [ -f "$file" ] || continue
    count=$((count + 1))
    (
      local source_dir display_name manifest_path platforms
      unset SOURCE_DIR APP_NAME IOS_ENABLED ANDROID_ENABLED HARMONY_ENABLED
      # shellcheck disable=SC1090
      source "$file" >/dev/null 2>&1 || exit 0
      source_dir="${SOURCE_DIR:-}"
      display_name="${APP_NAME:-$id}"
      manifest_path="$(project_manifest_path "$source_dir" 2>/dev/null || true)"
      if [ -n "$manifest_path" ]; then
        eval "$(manifest_metadata "$manifest_path")"
        display_name="${MANIFEST_NAME:-$display_name}"
      fi

      platforms=""
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

      printf '  %d) %s [%s]\n' "$count" "$display_name" "$id"
      printf '     平台: %s\n' "$platforms"
      printf '     地址: %s\n' "${source_dir:-未配置}"
    )
  done
  [ "$count" -gt 0 ] || printf '  （暂无项目，打包时会自动进入项目读取流程）\n'
}

load_project() {
  local id="$1"
  local file="$PIPELINE_ROOT/config/projects/$id.env"
  [ -f "$file" ] || die "未知项目: ${id}。可用项目: $(project_ids | tr '\n' ' ')"

  unset PROJECT_ID DISPLAY_NAME SOURCE_DIR HX_PROJECT_NAME APP_NAME APP_ID \
        EXPECTED_BUNDLE_ID EXPECTED_TEAM_ID PROFILE_FILE CHANNEL ASSOCIATED_DOMAINS \
        SCHEME CONFIGURATION BUILD_SCRIPT_RELATIVE PACKAGE_KIND EXPORT_METHOD WORKSPACE \
        RUN_ID RUN_DIR LOG_FILE PACKAGE_ENV TMP_DIR PROFILE_PLIST BUILD_STARTED_AT BUILD_LOCK_DIR \
        SOURCE_APP_DIR APP_IOS_DIR NATIVE_SDK_DIR APP_IOS_RESOLVED_REF \
        ANDROID_ENABLED ANDROID_APPLICATION_ID ANDROID_MODULE_DIR ANDROID_RESOURCE_DIR \
        ANDROID_APP_RESOURCE_DIR APK_SRC ANDROID_KEYSTORE_PROPERTIES ANDROID_KEYSTORE_FILE \
        ANDROID_KEY_ALIAS ANDROID_STORE_PASSWORD_SERVICE ANDROID_KEY_PASSWORD_SERVICE \
        ANDROID_SIGNING_MODE ANDROID_SIGNING_FINGERPRINT ANDROID_KEYSTORE_STORE_PASSWORD \
        ANDROID_KEYSTORE_KEY_PASSWORD HARMONY_ENABLED HARMONY_BUNDLE_NAME \
        HARMONY_APP_RESOURCE_DIR HAP_SRC HAP_FINAL HARMONY_SIGNED HARMONY_UNSIGNED_HAP \
        BUNDLE_ID TEAM_ID PROFILE_NAME PROFILE_UUID PROFILE_EXPIRY PROFILE_KIND \
        SIGNING_CERTIFICATE P12_PASSWORD TMP_KEYCHAIN KEYCHAIN_PASSWORD

  # shellcheck disable=SC1090
  source "$file"

  : "${PROJECT_ID:?项目配置缺少 PROJECT_ID}"
  : "${SOURCE_DIR:?项目配置缺少 SOURCE_DIR}"
  local manifest_path=""
  manifest_path="$(project_manifest_path "$SOURCE_DIR" 2>/dev/null || true)"
  if [ -n "$manifest_path" ]; then
    eval "$(manifest_metadata "$manifest_path")"
    DISPLAY_NAME="${MANIFEST_NAME:-${DISPLAY_NAME:-$PROJECT_ID}}"
    APP_ID="${MANIFEST_APP_ID:-${APP_ID:-}}"
    ASSOCIATED_DOMAINS="${MANIFEST_ASSOCIATED_DOMAINS:-${ASSOCIATED_DOMAINS:-}}"
  else
    DISPLAY_NAME="${DISPLAY_NAME:-$PROJECT_ID}"
  fi
  : "${APP_ID:?manifest.json 缺少 appid}"
  apply_build_option_overrides
  : "${PROFILE_FILE:?项目配置缺少 PROFILE_FILE}"

  APP_NAME="${APP_NAME:-$PROJECT_ID}"
  HARMONY_ENABLED="${HARMONY_ENABLED:-true}"
  HX_PROJECT_NAME="${HX_PROJECT_NAME:-${PROJECT_ID}-build}"
  CHANNEL="${CHANNEL:-adhoc}"
  ASSOCIATED_DOMAINS="${ASSOCIATED_DOMAINS:-}"
  SCHEME="${SCHEME:-UniAppX}"
  CONFIGURATION="${CONFIGURATION:-Release}"
  BUILD_SCRIPT_RELATIVE="${BUILD_SCRIPT_RELATIVE:-scripts/ios-package/build-adhoc-ipa.sh}"

  local build_platform_suffix="" run_id_suffix=""
  if [ -n "${APP_PACKAGER_BUILD_PLATFORM:-}" ]; then
    build_platform_suffix="-${APP_PACKAGER_BUILD_PLATFORM}"
    run_id_suffix="-${APP_PACKAGER_BUILD_PLATFORM}"
  fi
  WORKSPACE="$WORK_ROOT/$PROJECT_ID/${HX_PROJECT_NAME}${build_platform_suffix}"
  RUN_ID="$(date '+%Y%m%d-%H%M%S')${run_id_suffix}-$$"
  RUN_DIR="$LOG_ROOT/$PROJECT_ID/$RUN_ID"
  LOG_FILE="$RUN_DIR/build.log"
  PACKAGE_ENV="$RUN_DIR/package.env"
  PROFILE_PLIST="$RUN_DIR/profile.plist"
}

acquire_build_lock() {
  local lock_root lock_dir owner="" lock_name="$PROJECT_ID"
  [ -n "${APP_PACKAGER_BUILD_PLATFORM:-}" ] && lock_name="${PROJECT_ID}-${APP_PACKAGER_BUILD_PLATFORM}"
  lock_root="$PIPELINE_ROOT/.tmp/locks"
  lock_dir="$lock_root/${lock_name}.lock"
  mkdir -p "$lock_root"
  if mkdir "$lock_dir" 2>/dev/null; then
    BUILD_LOCK_DIR="$lock_dir"
    printf '%s\n' "$$" >"$BUILD_LOCK_DIR/pid"
    return 0
  fi

  owner="$(cat "$lock_dir/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    die "项目 $PROJECT_ID 正在打包中（PID ${owner}），拒绝并发覆盖工作区"
  fi

  warn "检测到项目 $PROJECT_ID 的过期构建锁，正在清理: $lock_dir"
  rm -rf "$lock_dir"
  mkdir "$lock_dir"
  BUILD_LOCK_DIR="$lock_dir"
  printf '%s\n' "$$" >"$BUILD_LOCK_DIR/pid"
}

init_run() {
  mkdir -p "$PIPELINE_ROOT/.tmp" "$RUN_DIR" "$PACKAGE_IOS_DIR" \
    "$PACKAGE_ANDROID_DIR" "$PACKAGE_HARMONY_DIR" "$(dirname "$WORKSPACE")"
  acquire_build_lock
  TMP_DIR="$(mktemp -d "$PIPELINE_ROOT/.tmp/build.XXXXXX")"
  BUILD_STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S %z')"
  BUILD_SUCCEEDED=0
}

cleanup() {
  set +e

  if [ "${ORIGINAL_KEYCHAINS+x}" = "x" ] && [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  fi

  if [ -n "${TMP_KEYCHAIN:-}" ]; then
    security delete-keychain "$TMP_KEYCHAIN" >/dev/null 2>&1 || true
  fi

  if [ -n "${TMP_DIR:-}" ]; then
    rm -rf "$TMP_DIR"
  fi

  if [ -n "${BUILD_LOCK_DIR:-}" ] && [ -d "$BUILD_LOCK_DIR" ]; then
    rm -rf "$BUILD_LOCK_DIR"
  fi

  local keep="0"
  if [ "${BUILD_SUCCEEDED:-0}" != "1" ]; then
    keep="1"
    warn "构建未成功，保留隔离工作区用于排查: ${WORKSPACE:-}"
  fi
  if [ "${CLI_KEEP_WORK:-0}" = "1" ] || [ "${KEEP_WORKSPACE:-false}" = "true" ]; then
    keep="1"
  fi
  if [ "$keep" != "1" ] && [ -n "${WORKSPACE:-}" ] && [ "${WORKSPACE#*$WORK_ROOT/}" != "$WORKSPACE" ]; then
    rm -rf "$WORKSPACE"
  fi
}

prepare_workspace() {
  [ -d "$SOURCE_DIR" ] || die "项目目录不存在: $SOURCE_DIR"
  case "$WORKSPACE" in
    "$WORK_ROOT"/*) ;;
    *) die "拒绝操作构建工作区之外的路径: $WORKSPACE" ;;
  esac

  rm -rf "$WORKSPACE"
  mkdir -p "$WORKSPACE"
  log "复制项目到隔离工作区: $WORKSPACE"
  rsync -a --delete \
    --exclude='/.git' \
    --exclude='/node_modules' \
    --exclude='/unpackage' \
    --exclude='/app-ios' \
    --exclude='/build' \
    --exclude='.DS_Store' \
    "$SOURCE_DIR/" "$WORKSPACE/" >>"$LOG_FILE" 2>&1 || die "复制项目失败"

  # 项目包含 postcss/tailwind 插件，HBuilderX 编译时需要本地 node_modules。
  # 使用复制而不是软链，避免 HBuilderX 缓存写回业务项目。
  if [ -d "$SOURCE_DIR/node_modules" ]; then
    log "复制 node_modules 到隔离工作区"
    rsync -a "$SOURCE_DIR/node_modules/" "$WORKSPACE/node_modules/" >>"$LOG_FILE" 2>&1 \
      || die "复制 node_modules 失败"
  elif [ -f "$WORKSPACE/package-lock.json" ]; then
    log "业务项目没有 node_modules，尝试离线 npm ci"
    (cd "$WORKSPACE" && npm ci --ignore-scripts --offline) >>"$LOG_FILE" 2>&1 \
      || die "离线 npm ci 失败，请先在业务项目执行 npm ci"
  fi
}

_ensure_hbuilderx_impl() {
  [ -x "$HBUILDERX_CLI" ] || die "HBuilderX CLI 不存在: $HBUILDERX_CLI"

  # 已运行时直接复用编译服务，不主动把 HBuilderX 拉到前台。
  if run_with_timeout 15 "$HBUILDERX_CLI" project list >/dev/null 2>&1; then
    return 0
  fi

  "$HBUILDERX_CLI" open >/dev/null 2>&1 || true
  local waited=0
  while [ "$waited" -lt 60 ]; do
    if run_with_timeout 15 "$HBUILDERX_CLI" project list >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  die "HBuilderX 未就绪，请在桌面会话中先登录并打开一次 HBuilderX"
}

ensure_hbuilderx() {
  # HBuilderX 编译位只有 1 个：别的平台正编着的时候这里会干等，所以状态要跟着走，
  # 不然面板上一直挂着上一句「复制隔离工作区」，看着像卡死。
  SEMAPHORE_PROGRESS=35 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" SEMAPHORE_RUN_MESSAGE="HBuilderX 连接检查" \
    with_semaphore "hbuilderx" "${PARALLEL_MAX_HBULDERX_JOBS_RESOLVED:-1}" _ensure_hbuilderx_impl
}

DEVECO_STUDIO_APP="${DEVECO_STUDIO_APP:-/Applications/DevEco-Studio.app}"
ANDROID_STUDIO_APP="${ANDROID_STUDIO_APP:-/Applications/Android Studio.app}"
XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"

sdk_series() {
  local version=""
  if [ -n "${HBUILDERX_APP:-}" ] && [ -f "$HBUILDERX_APP/Contents/Info.plist" ]; then
    version="$(plutil -extract CFBundleShortVersionString raw -o - "$HBUILDERX_APP/Contents/Info.plist" 2>/dev/null || true)"
  fi
  if [ -z "$version" ] && [ -n "${HBUILDERX_CLI:-}" ] && [ -x "$HBUILDERX_CLI" ]; then
    version="$("$HBUILDERX_CLI" --help 2>/dev/null | sed -n 's/.*HBuilderX(v\([^)]*\)).*/\1/p' | head -n 1 || true)"
  fi
  local series
  series="$(printf '%s\n' "$version" | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')"
  printf '%s\n' "${series:-${LOCAL_IOS_RUNTIME_VERSION:-5.26}}"
}

ios_sdk_dir() {
  printf '%s\n' "${LOCAL_IOS_SDK_DIR:-$PIPELINE_ROOT/sdk/iOS/$(sdk_series)}"
}

android_sdk_dir() {
  printf '%s\n' "${LOCAL_ANDROID_SDK_DIR:-$PIPELINE_ROOT/sdk/Android/$(sdk_series)}"
}

harmony_sdk_dir() {
  printf '%s\n' "${LOCAL_HARMONY_SDK_DIR:-$PIPELINE_ROOT/sdk/HarmonyOS/$(sdk_series)}"
}

ios_sdk_uniappx_ready() {
  local dir
  dir="$(ios_sdk_dir)"
  [ -d "$dir/UniAppXDemo/UniAppXDemo.xcodeproj" ] && [ -d "$dir/SDK" ]
}

ios_sdk_ready() {
  local dir
  dir="$(ios_sdk_dir)"
  ios_sdk_uniappx_ready && return 0
  if find "$dir" -type d \( -name 'HBuilder-Hello.xcodeproj' -o -name 'UniAppXDemo.xcodeproj' \) -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

android_sdk_ready() {
  local dir
  dir="$(android_sdk_dir)"
  [ -d "$dir/SDK/libs" ] || [ -d "$dir/libs" ]
}

harmony_sdk_ready() {
  local dir
  dir="$(harmony_sdk_dir)"
  # 只看真正的 runtime 产物：oh-package.json5 是安装前由 sdk.sh/init.sh 自己创建的清单文件，
  # 拿它当就绪标志会把「ohpm 装失败」误判成已就绪。
  [ -d "$dir/oh_modules/@dcloudio/uni-app-x-runtime" ] ||
    [ -d "$dir/oh_modules/@dcloudio/uni-app-x-vapor-runtime" ] ||
    find "$dir" -type f -name '*.har' -print -quit 2>/dev/null | grep -q .
}

show_sdk_status() {
  local series ios_dir android_dir harmony_dir missing=0 partial_count=0 partial
  series="$(sdk_series)"
  ios_dir="$(ios_sdk_dir)"
  android_dir="$(android_sdk_dir)"
  harmony_dir="$(harmony_sdk_dir)"

  while IFS= read -r partial; do
    [ -n "$partial" ] || continue
    partial_count=$((partial_count + 1))
  done < <(find "$PIPELINE_ROOT/sdk" -type f \( -iname '*.downloading' -o -iname '*.baiduyun.p.downloading' \) -print 2>/dev/null)
  if [ "$partial_count" -gt 0 ]; then
    printf '\033[1;31m  [警告]\033[0m 检测到 %s 个未完成的 SDK 下载文件（.downloading）\n' "$partial_count"
    printf '         请先等待百度网盘/云盘下载完成，再运行 sdk/处理SDK.command\n'
  fi

  if ! ios_sdk_ready; then
    printf '\033[1;33m  [警告]\033[0m 缺少 iOS 离线 SDK（%s）\n' "$series"
    printf '         请运行 sdk/处理SDK.command 或初始化向导导入 iOS SDK，或配置 %s\n' "$ios_dir"
    printf '         官方页面: https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html\n'
    printf '         5.26直链: https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%%40%s.zip\n' "$series"
    missing=1
  elif ! ios_sdk_uniappx_ready; then
    printf '\033[1;33m  [警告]\033[0m iOS SDK 类型不匹配：当前是旧版 HBuilder-Hello\n'
    printf '         当前 AppPackager 分包流程需要 UniAppX-iOS@%s，包内必须包含 UniAppXDemo/UniAppXDemo.xcodeproj\n' "$series"
    printf '         官方页面: https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html\n'
    printf '         5.26直链: https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%%40%s.zip\n' "$series"
  fi
  if ! android_sdk_ready; then
    printf '\033[1;33m  [警告]\033[0m 缺少 Android 离线 SDK（%s）\n' "$series"
    printf '         请运行 sdk/处理SDK.command 或初始化向导导入 Android SDK，或配置 %s\n' "$android_dir"
    printf '         官方页面: https://doc.dcloud.net.cn/uni-app-x/native/download/android.html\n'
    missing=1
  fi
  if ! harmony_sdk_ready; then
    printf '\033[1;33m  [警告]\033[0m 缺少 HarmonyOS Runtime（%s）\n' "$series"
    printf '         请运行 sdk/处理SDK.command 或初始化向导安装 HarmonyOS runtime\n'
    printf '         官方页面: https://doc.dcloud.net.cn/uni-app-x/native/use/harmony.html\n'
    missing=1
  fi
  if [ "$missing" -eq 0 ]; then
    printf '\033[1;32m  [SDK 状态]\033[0m 正常（HBuilderX 系列 %s）\n' "$series"
  fi
}

generate_ios_resources() {
  log "调用 HBuilderX 编译 iOS App 资源（静默模式）"
  if ! SEMAPHORE_PROGRESS=35 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" \
    SEMAPHORE_RUN_MESSAGE="HBuilderX 生成 iOS 资源" \
    with_semaphore "hbuilderx" "${PARALLEL_MAX_HBULDERX_JOBS_RESOLVED:-1}" \
    run_with_timeout 900 "$HBUILDERX_CLI" publish app-ios --type appResource --project "$WORKSPACE" >>"$LOG_FILE" 2>&1; then
    tail -n 160 "$LOG_FILE" >&2 || true
    die "HBuilderX 生成本地 iOS App 资源失败"
  fi

  SOURCE_APP_DIR="$WORKSPACE/unpackage/resources/app-ios/$APP_ID"
  [ -d "$SOURCE_APP_DIR" ] || die "未找到 HBuilderX 产物: $SOURCE_APP_DIR"
  log "iOS 资源已生成: $SOURCE_APP_DIR"
}

read_profile_metadata() {
  local profile_file="$1"
  local plist_file="$2"

  [ -f "$profile_file" ] || die "描述文件不存在: $profile_file"
  extract_ios_profile_fields "$profile_file" "$plist_file" \
    || die "无法解析描述文件: $profile_file"

  [ -n "$PROFILE_NAME" ] || die "描述文件缺少 Name"
  [ -n "$PROFILE_UUID" ] || die "描述文件缺少 UUID"
  [ -n "$TEAM_ID" ] || die "描述文件缺少 TeamIdentifier"
  [ -n "$BUNDLE_ID" ] || die "描述文件缺少 application-identifier"
  case "$BUNDLE_ID" in
    '*') die "描述文件使用了通配 Bundle ID: $BUNDLE_ID" ;;
  esac

  local get_task_allow="false"
  get_task_allow="$(plutil -extract Entitlements.get-task-allow raw -o - "$plist_file" 2>/dev/null || echo false)"
  local provisions_all="false"
  provisions_all="$(plutil -extract ProvisionsAllDevices raw -o - "$plist_file" 2>/dev/null || echo false)"

  if [ "$provisions_all" = "true" ]; then
    PROFILE_KIND="enterprise"
  elif plutil -extract ProvisionedDevices raw -o - "$plist_file" >/dev/null 2>&1; then
    if [ "$get_task_allow" = "true" ]; then
      PROFILE_KIND="development"
    else
      PROFILE_KIND="adhoc"
    fi
  else
    PROFILE_KIND="appstore"
  fi

  local expiry_epoch now_epoch
  expiry_epoch="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$PROFILE_EXPIRY" '+%s' 2>/dev/null || echo 0)"
  now_epoch="$(date '+%s')"
  [ "$expiry_epoch" -gt "$now_epoch" ] || die "描述文件已过期: $PROFILE_EXPIRY"

  if [ -n "${EXPECTED_TEAM_ID:-}" ] && [ "$TEAM_ID" != "$EXPECTED_TEAM_ID" ]; then
    die "描述文件 Team 不匹配。期望 ${EXPECTED_TEAM_ID}，实际 ${TEAM_ID}"
  fi
  if [ -n "${EXPECTED_BUNDLE_ID:-}" ] && [ "$BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]; then
    die "描述文件 Bundle ID 不匹配。期望 ${EXPECTED_BUNDLE_ID}，实际 ${BUNDLE_ID}"
  fi
}

prepare_profile() {
  local resolved_profile=""
  if [ ! -f "$PROFILE_FILE" ] && [ -n "${EXPECTED_BUNDLE_ID:-}" ]; then
    resolved_profile="$(find_matching_ios_profile "$EXPECTED_BUNDLE_ID" || true)"
  fi
  if [ -n "$resolved_profile" ]; then
    log "项目配置未找到可用 Profile，使用证书目录中的匹配文件: $resolved_profile"
    PROFILE_FILE="$resolved_profile"
  fi
  read_profile_metadata "$PROFILE_FILE" "$PROFILE_PLIST"

  PACKAGE_KIND="${PACKAGE_KIND:-$PROFILE_KIND}"
  CHANNEL="$PROFILE_KIND"
  if [ -z "${EXPORT_METHOD:-}" ]; then
    case "$PROFILE_KIND" in
      adhoc)       EXPORT_METHOD="release-testing" ;;
      development) EXPORT_METHOD="development" ;;
      appstore)    EXPORT_METHOD="app-store-connect" ;;
      enterprise)  EXPORT_METHOD="enterprise" ;;
      *)           die "未知描述文件类型: $PROFILE_KIND" ;;
    esac
  fi

  mkdir -p "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" \
    "$HOME/Library/MobileDevice/Provisioning Profiles"
  cp -f "$PROFILE_FILE" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
  cp -f "$PROFILE_FILE" "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"

  log "Profile: $PROFILE_NAME [$PROFILE_KIND]"
  log "Bundle:  $BUNDLE_ID"
  log "Team:    $TEAM_ID"
  log "过期:    $PROFILE_EXPIRY"
}

resolve_p12_file() {
  local candidate

  if [ -n "${P12_FILE:-}" ] && [ -f "$P12_FILE" ]; then
    printf '%s\n' "$P12_FILE"
    return 0
  fi

  if [ -n "${PROFILE_FILE:-}" ] && [ -f "$PROFILE_FILE" ]; then
    candidate="$(find "$(dirname "$PROFILE_FILE")" -maxdepth 2 -type f \( -iname '*.p12' -o -iname '*.pfx' \) -print 2>/dev/null | sort | head -n 1)"
    [ -n "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  fi

  if [ -n "${PROJECT_ID:-}" ]; then
    candidate="$(find "$PIPELINE_ROOT/certificates/iOS/$PROJECT_ID" -maxdepth 4 -type f \( -iname '*.p12' -o -iname '*.pfx' \) -print -quit 2>/dev/null)"
    [ -n "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  fi
  candidate="$(find "$PIPELINE_ROOT/certificates/iOS" -maxdepth 4 -type f \( -iname '*.p12' -o -iname '*.pfx' \) -print 2>/dev/null | sort | head -n 1)"
  [ -n "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }

  for candidate in \
    "${SIGNING_ROOT:-$PIPELINE_ROOT/signing/current}"/*.p12 \
    "${SIGNING_ROOT:-$PIPELINE_ROOT/signing/current}"/*.pfx; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_android_keystore_properties() {
  local cert_dir candidate
  cert_dir="$(cert_android_dir)"
  local -a candidates=()

  [ -n "${ANDROID_KEYSTORE_PROPERTIES:-}" ] && candidates+=("${ANDROID_KEYSTORE_PROPERTIES}")
  candidates+=("${WORKSPACE:-}/app-android/keystore.properties")
  if [ -n "${PROJECT_ID:-}" ]; then
    candidates+=(
      "$cert_dir/$PROJECT_ID/keystore.properties"
      "$cert_dir/${PROJECT_ID}.keystore.properties"
    )
  fi
  candidates+=("$cert_dir/keystore.properties")

  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  local -a discovered=()
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    discovered+=("$candidate")
  done < <(find "$cert_dir" -maxdepth 4 -type f -iname 'keystore.properties' -print 2>/dev/null | sort)
  [ "${#discovered[@]}" -gt 0 ] || return 1
  [ "${#discovered[@]}" -eq 1 ] && { printf '%s\n' "${discovered[0]}"; return 0; }

  if [ -n "${PROJECT_ID:-}" ]; then
    for candidate in "${discovered[@]}"; do
      case "$candidate" in
        */"$PROJECT_ID"/*) printf '%s\n' "$candidate"; return 0 ;;
      esac
    done
  fi
  return 1
}

prepare_android_signing() {
  local gradle_file="$1" properties material
  ANDROID_SIGNING_MODE="project-signing"
  ANDROID_SIGNING_FINGERPRINT=""

  if [ -f "$gradle_file" ] && ! grep -q "debug\.keystore" "$gradle_file"; then
    warn "项目已配置独立 Android signingConfig，保持原配置不使用证书目录 fallback"
    return 0
  fi

  properties="$(resolve_android_keystore_properties || true)"
  if [ -z "$properties" ]; then
    warn "未配置 Android release keystore，将沿用项目内签名配置（当前项目通常是 debug keystore）"
    return 0
  fi

  material="$(python3 - "$properties" <<'PY_ANDROID_SIGNING'
from pathlib import Path
import re
import sys

properties_path = Path(sys.argv[1]).resolve()
values = {}
for raw_line in properties_path.read_text(encoding='utf-8', errors='ignore').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or line.startswith('!'):
        continue
    match = re.match(r'([^:=\s]+)\s*[:=]\s*(.*)$', line)
    if not match:
        continue
    key, value = match.groups()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    values[key] = value

required = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit('keystore.properties 缺少字段: ' + ', '.join(missing))

store_file = Path(values['storeFile']).expanduser()
if not store_file.is_absolute():
    store_file = (properties_path.parent / store_file).resolve()
if not store_file.is_file():
    raise SystemExit(f'Android keystore 不存在: {store_file}')
print('\t'.join([
    str(store_file),
    values['storePassword'],
    values['keyAlias'],
    values['keyPassword'],
]))
PY_ANDROID_SIGNING
  )" || die "无法读取 Android 签名配置: $properties"

  IFS=$'\t' read -r ANDROID_KEYSTORE_FILE ANDROID_KEYSTORE_STORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEYSTORE_KEY_PASSWORD <<<"$material"
  [ -f "$ANDROID_KEYSTORE_FILE" ] || die "Android keystore 不存在: $ANDROID_KEYSTORE_FILE"
  [ -n "$ANDROID_KEY_ALIAS" ] || ANDROID_KEY_ALIAS="release"

  if ! APP_PACKAGER_ANDROID_STORE_PASSWORD="$ANDROID_KEYSTORE_STORE_PASSWORD" \
    keytool -list -keystore "$ANDROID_KEYSTORE_FILE" \
      -storepass:env APP_PACKAGER_ANDROID_STORE_PASSWORD -alias "$ANDROID_KEY_ALIAS" >/dev/null 2>&1; then
    die "Android keystore 或密码/Alias 校验失败: $ANDROID_KEYSTORE_FILE"
  fi
  ANDROID_SIGNING_FINGERPRINT="$(APP_PACKAGER_ANDROID_STORE_PASSWORD="$ANDROID_KEYSTORE_STORE_PASSWORD" \
    keytool -list -v -keystore "$ANDROID_KEYSTORE_FILE" \
      -storepass:env APP_PACKAGER_ANDROID_STORE_PASSWORD -alias "$ANDROID_KEY_ALIAS" 2>/dev/null \
    | sed -n 's/.*SHA256: //p' | head -n 1 | tr -d ' ')"

  python3 - "$gradle_file" "$ANDROID_KEYSTORE_FILE" "$ANDROID_KEY_ALIAS" <<'PY_PATCH_ANDROID_SIGNING'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
store_file, alias = sys.argv[2:4]
text = path.read_text(encoding='utf-8')

def groovy_string(value):
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"

def matching_brace(source, open_index):
    depth = 0
    quote = None
    escaped = False
    for index in range(open_index, len(source)):
        char = source[index]
        if quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return index
    raise SystemExit('signingConfigs or release block is not closed')

signing_index = text.find('signingConfigs')
if signing_index < 0:
    raise SystemExit('Android signingConfigs block not found')
signing_open = text.find('{', signing_index)
if signing_open < 0:
    raise SystemExit('Android signingConfigs opening brace not found')
signing_close = matching_brace(text, signing_open)
signing_block = text[signing_open + 1:signing_close]
release_match = re.search(r'\brelease\s*\{', signing_block)
if not release_match:
    raise SystemExit('Android signingConfigs.release block not found')
release_start = signing_open + 1 + release_match.start()
release_open = text.find('{', release_start, signing_close)
release_close = matching_brace(text, release_open)
replacement = '''release {
            storeFile file(%s)
            storePassword System.getenv('APP_PACKAGER_ANDROID_STORE_PASSWORD')
            keyAlias %s
            keyPassword System.getenv('APP_PACKAGER_ANDROID_KEY_PASSWORD')
        }''' % (groovy_string(store_file), groovy_string(alias))
text = text[:release_start] + replacement + text[release_close + 1:]
path.write_text(text, encoding='utf-8')
print('patched Android release signingConfig')
PY_PATCH_ANDROID_SIGNING

  ANDROID_SIGNING_MODE="release-keystore"
  log "Android release 签名: ${ANDROID_KEY_ALIAS} (${ANDROID_SIGNING_FINGERPRINT:-未读取到指纹})"
}

verify_android_apk_signature() {
  local apk="$1" build_tools apksigner zipalign
  [ -f "$apk" ] || die "APK 不存在: $apk"
  build_tools="$(find "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}/build-tools" \
    -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  [ -n "$build_tools" ] || die "未找到 Android build-tools 目录"
  apksigner="$build_tools/apksigner"
  zipalign="$build_tools/zipalign"

  if [ -x "$apksigner" ]; then
    "$apksigner" verify --verbose "$apk" >>"$LOG_FILE" 2>&1 \
      || die "APK 签名校验失败: $apk"
    log "APK 签名校验通过"
  else
    die "未找到 apksigner，无法校验 APK 签名: $build_tools"
  fi

  if [ -x "$zipalign" ]; then
    "$zipalign" -c -P 16 4 "$apk" >>"$LOG_FILE" 2>&1 \
      || die "APK 对齐校验失败: $apk"
    log "APK 对齐校验通过"
  else
    die "未找到 zipalign，无法校验 APK 对齐: $build_tools"
  fi
}

prepare_keychain() {
  local resolved_p12
  resolved_p12="$(resolve_p12_file || true)"
  if [ -z "$resolved_p12" ]; then
    die "p12 证书不存在。请放入 $PIPELINE_ROOT/certificates/iOS/，或运行 setup-signing.sh 配置"
  fi
  if [ "$resolved_p12" != "${P12_FILE:-}" ]; then
    log "自动使用证书目录中的 p12: $resolved_p12"
  fi
  P12_FILE="$resolved_p12"

  P12_PASSWORD="${P12_PASSWORD:-}"
  if [ -z "$P12_PASSWORD" ]; then
    P12_PASSWORD="$(security find-generic-password -s "$P12_PASSWORD_SERVICE" -a "$USER" -w 2>/dev/null || true)"
  fi
  if [ -z "$P12_PASSWORD" ] && [ -t 0 ] && [ "${APP_PACKAGER_NONINTERACTIVE:-0}" != "1" ]; then
    read -r -s -p "请输入 p12 密码: " P12_PASSWORD
    printf '\n' >&2
  fi
  [ -n "$P12_PASSWORD" ] || die "未找到 p12 密码，请先运行 setup-signing.sh"

  TMP_KEYCHAIN="$TMP_DIR/build.keychain-db"
  KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
  ORIGINAL_KEYCHAINS=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    line="${line#\"}"
    line="${line%\"}"
    [ -n "$line" ] && ORIGINAL_KEYCHAINS+=("$line")
  done < <(security list-keychains -d user 2>/dev/null || true)

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN" >/dev/null
  security set-keychain-settings -lut 7200 "$TMP_KEYCHAIN" >/dev/null
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$TMP_KEYCHAIN" >/dev/null
  security import "$P12_FILE" -k "$TMP_KEYCHAIN" -P "$P12_PASSWORD" \
    -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
    || die "导入 p12 失败，请检查证书密码"

  local apple_cert
  for apple_cert in "$APPLE_CERTS_DIR"/*.cer; do
    [ -e "$apple_cert" ] || continue
    security import "$apple_cert" -k "$TMP_KEYCHAIN" \
      -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
      || warn "导入 Apple 证书失败: $apple_cert"
  done

  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" \
    "$TMP_KEYCHAIN" >/dev/null 2>&1 || warn "set-key-partition-list 失败"

  if [ "${#ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
    security list-keychains -d user -s "$TMP_KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}" >/dev/null
  else
    security list-keychains -d user -s "$TMP_KEYCHAIN" >/dev/null
  fi

  local identities identity_count
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  SIGNING_CERTIFICATE="$(printf '%s\n' "$identities" | grep -F "($TEAM_ID)" | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)"
  if [ -z "$SIGNING_CERTIFICATE" ]; then
    identity_count="$(printf '%s\n' "$identities" | sed -n 's/.*"\(.*\)".*/\1/p' | wc -l | tr -d ' ')"
    if [ "$identity_count" = "1" ]; then
      SIGNING_CERTIFICATE="$(printf '%s\n' "$identities" | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)"
    else
      die "未找到 Team $TEAM_ID 对应的代码签名身份，拒绝使用其他 Team 的证书"
    fi
  fi
  [ -n "$SIGNING_CERTIFICATE" ] || die "p12 和 Apple 证书链中没有可用的代码签名身份"
  log "签名证书: $SIGNING_CERTIFICATE"
}

manifest_platform_brand_configured() {
  local platform="$1" density rel
  case "$platform" in
    ios)
      [ -n "$(manifest_icon_path ios appstore || true)" ] && return 0
      [ -n "$(manifest_splash_path ios || true)" ] && return 0
      [ -n "$(manifest_ios_storyboard_path ios || true)" ] && return 0
      ;;
    android)
      for density in hdpi xhdpi xxhdpi xxxhdpi; do
        rel="$(manifest_icon_path android "$density" || true)"
        [ -n "$rel" ] && return 0
      done
      [ -n "$(manifest_splash_path android || true)" ] && return 0
      ;;
  esac
  return 1
}

generate_brand_assets() {
  if [ "${BRAND_ASSET_MODE:-manifest}" = "disabled" ]; then
    warn "图标和启动页原生资源替换已关闭"
    return 0
  fi

  if manifest_platform_brand_configured ios; then
    log "iOS 品牌资源: 使用 manifest.json 对应平台配置"
  else
    log "iOS 品牌资源: manifest 未配置，使用 uni-app 默认资源"
  fi

  if manifest_platform_brand_configured android; then
    log "Android 品牌资源: 使用 manifest.json 对应平台配置"
  else
    log "Android 品牌资源: manifest 未配置，使用 uni-app 默认资源"
  fi
}

manifest_icon_path() {
  python3 - "$(workspace_manifest_path)" "$1" "$2" <<'PY_ICON'
from pathlib import Path
import re
import sys
manifest, platform, key = sys.argv[1:4]
text = Path(manifest).read_text(encoding='utf-8', errors='ignore')
if platform == 'android':
    start = text.find('"app-android"')
    end = text.find('"app-ios"', start)
else:
    start = text.find('"app-ios"')
    end = text.find('"web"', start)
if start < 0:
    sys.exit(0)
block = text[start:end if end >= 0 else len(text)]
icons = block.find('"icons"')
if icons < 0:
    sys.exit(0)
splash = block.find('"splashScreens"', icons)
section = block[icons:splash if splash >= 0 else len(block)]
match = re.search(r'"%s"\s*:\s*"([^"]+\.(?:png|jpg|jpeg|webp))"' % re.escape(key), section, re.I)
if match:
    print(match.group(1))
PY_ICON
}

manifest_splash_path() {
  python3 - "$(workspace_manifest_path)" "$1" <<'PY_SPLASH'
from pathlib import Path
import re
import sys
manifest, platform = sys.argv[1:3]
text = Path(manifest).read_text(encoding='utf-8', errors='ignore')
if platform == 'android':
    start = text.find('"app-android"')
    end = text.find('"app-ios"', start)
else:
    start = text.find('"app-ios"')
    end = text.find('"web"', start)
if start < 0:
    sys.exit(0)
block = text[start:end if end >= 0 else len(text)]
pos = block.find('"splashScreens"')
if pos < 0:
    sys.exit(0)
section = block[pos:]
match = re.search(r'"([^"]+\.(?:png|jpg|jpeg|webp))"', section, re.I)
if match:
    print(match.group(1))
PY_SPLASH
}

manifest_ios_storyboard_path() {
  python3 - "$(workspace_manifest_path)" <<'PY_STORYBOARD_PATH'
from pathlib import Path
import re
import sys
text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore')
start = text.find('"app-ios"')
end = text.find('"web"', start)
if start < 0:
    sys.exit(0)
block = text[start:end if end >= 0 else len(text)]
match = re.search(r'"storyboard"\s*:\s*"([^"]+\.zip)"', block, re.I)
if match:
    print(match.group(1))
PY_STORYBOARD_PATH
}


prepare_native_ios_project() {
  local base_demo="$LOCAL_IOS_SDK_DIR/UniAppXDemo"
  local base_sdk="$LOCAL_IOS_SDK_DIR/SDK"
  [ -d "$base_demo/UniAppXDemo.xcodeproj" ] \
    || die "本地 UniAppX iOS SDK 不完整: $base_demo/UniAppXDemo.xcodeproj"
  [ -d "$base_sdk" ] || die "本地 UniAppX iOS SDK 不完整: $base_sdk"

  NATIVE_SDK_DIR="$RUN_DIR/native-sdk"
  APP_IOS_DIR="$NATIVE_SDK_DIR"
  rm -rf "$NATIVE_SDK_DIR"
  mkdir -p "$NATIVE_SDK_DIR"
  ln -s "$base_sdk" "$NATIVE_SDK_DIR/SDK"
  ln -s "$LOCAL_IOS_SDK_DIR/TemporarySampleFramework" "$NATIVE_SDK_DIR/TemporarySampleFramework"

  log "创建项目专属原生工程副本"
  ditto "$base_demo" "$NATIVE_SDK_DIR/UniAppXDemo" >>"$LOG_FILE" 2>&1 \
    || die "复制 UniAppXDemo 失败"
  ditto "$LOCAL_IOS_SDK_DIR/UTSPluginExample" "$NATIVE_SDK_DIR/UTSPluginExample" >>"$LOG_FILE" 2>&1 \
    || die "复制 UTSPluginExample 失败"

  integrate_ios_custom_uts_plugins
  patch_native_project
  APP_IOS_RESOLVED_REF="local-sdk-$LOCAL_IOS_RUNTIME_VERSION"
  [ -d "$APP_IOS_DIR/UniAppXDemo/UniAppXDemo.xcodeproj" ] \
    || die "原生工程缺少 UniAppXDemo.xcodeproj"
  log "原生工程: $APP_IOS_DIR"
}

merge_ios_entitlements() {
  local entitlements="$1" debug_entitlements="$2" profile_plist="$3" associated_domains="$4"
  python3 - "$entitlements" "$debug_entitlements" "$profile_plist" "$associated_domains" <<'PY_MERGE_ENTITLEMENTS'
from pathlib import Path
import plistlib
import shlex
import sys

entitlements_path = Path(sys.argv[1])
debug_entitlements_path = Path(sys.argv[2])
profile_path = Path(sys.argv[3])
associated_domains = shlex.split(sys.argv[4]) if sys.argv[4] else []

if entitlements_path.is_file():
    entitlements = plistlib.loads(entitlements_path.read_bytes())
else:
    entitlements = {}
if not isinstance(entitlements, dict):
    entitlements = {}

profile_entitlements = {}
if profile_path.is_file():
    profile = plistlib.loads(profile_path.read_bytes())
    value = profile.get('Entitlements', {})
    if isinstance(value, dict):
        profile_entitlements = value

capability_keys = {
    key for key in entitlements
    if key == 'aps-environment' or key == 'keychain-access-groups' or key.startswith('com.apple.developer.')
}
for key in capability_keys:
    if key not in profile_entitlements:
        entitlements.pop(key, None)

entitlements.pop('com.apple.developer.associated-domains', None)
if associated_domains and 'com.apple.developer.associated-domains' not in profile_entitlements:
    raise SystemExit('当前描述文件未授权 associated domains，无法写入 manifest 中的 Universal Link 域名')
if associated_domains:
    entitlements['com.apple.developer.associated-domains'] = associated_domains

excluded = {
    'application-identifier',
    'com.apple.developer.associated-domains',
    'com.apple.developer.team-identifier',
    'get-task-allow',
}
for key, value in profile_entitlements.items():
    if key in excluded:
        continue
    if key == 'aps-environment' or key == 'keychain-access-groups' or key.startswith('com.apple.developer.'):
        entitlements[key] = value

payload = plistlib.dumps(entitlements, fmt=plistlib.FMT_XML, sort_keys=False)
entitlements_path.write_bytes(payload)
debug_entitlements_path.write_bytes(payload)
print('merged iOS entitlements: ' + ', '.join(sorted(entitlements)))
PY_MERGE_ENTITLEMENTS
}

patch_native_project() {
  local plist="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/Info.plist"
  local entitlements="$APP_IOS_DIR/UniAppXDemo/UniAppX.entitlements"
  local debug_entitlements="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/UniAppXDemoDebug.entitlements"
  local pb="/usr/libexec/PlistBuddy"

  [ -f "$plist" ] || die "Info.plist 不存在: $plist"
  "$pb" -c "Set :uniapp-x:appid $APP_ID" "$plist"
  "$pb" -c "Set :uniapp-x:ipatype 2" "$plist"
  "$pb" -c "Set :uniapp-x:uniRuntimeVersion $LOCAL_IOS_RUNTIME_VERSION" "$plist"
  "$pb" -c "Set :uniapp-x:channel $CHANNEL" "$plist" 2>/dev/null || true
  "$pb" -c "Delete :uniapp-x:unionid" "$plist" 2>/dev/null || true
  "$pb" -c "Set :CFBundleDisplayName $DISPLAY_NAME" "$plist" 2>/dev/null \
    || "$pb" -c "Add :CFBundleDisplayName string $DISPLAY_NAME" "$plist"

  merge_ios_entitlements "$entitlements" "$debug_entitlements" "$PROFILE_PLIST" "$ASSOCIATED_DOMAINS"

  local pbxproj="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo.xcodeproj/project.pbxproj"
  [ -f "$pbxproj" ] || die "project.pbxproj 不存在: $pbxproj"
  python3 - "$pbxproj" "$SIGNING_CERTIFICATE" "$TEAM_ID" "$PROFILE_NAME" "$BUNDLE_ID" "${MARKETING_VERSION:-1.0}" <<'PY_PROJECT'
from pathlib import Path
import sys
path = Path(sys.argv[1])
identity, team, profile, bundle, marketing = sys.argv[2:7]
text = path.read_text(encoding='utf-8')
replacements = [
    ('CODE_SIGN_IDENTITY = "Apple Development";', f'CODE_SIGN_IDENTITY = "{identity}";'),
    ('DEVELOPMENT_TEAM = "";', f'DEVELOPMENT_TEAM = {team};'),
    ('PROVISIONING_PROFILE_SPECIFIER = "";', f'PROVISIONING_PROFILE_SPECIFIER = "{profile}";'),
    ('PRODUCT_BUNDLE_IDENTIFIER = io.dcloud.uniappxdemo;', f'PRODUCT_BUNDLE_IDENTIFIER = {bundle};'),
    ('MARKETING_VERSION = 1.0;', f'MARKETING_VERSION = {marketing};'),
]
for old_value, new_value in replacements:
    if old_value not in text:
        raise SystemExit(f'project setting not found: {old_value}')
    text = text.replace(old_value, new_value)
path.write_text(text, encoding='utf-8')
PY_PROJECT

  apply_ios_brand_assets
  patch_uts_plugin_projects

  # 官方 SDK 内置 HelloUniAppX 等示例 App。归档前全部删除，
  # 稍后由项目打包脚本只复制当前项目的 appid 目录。
  local apps_root="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/uni-app-x/apps"
  mkdir -p "$apps_root"
  find "$apps_root" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  patch_scene_delegate
  log "已清理 SDK 示例 App 目录"

  log "原生配置: appid=$APP_ID bundle=$BUNDLE_ID channel=$CHANNEL"
}

patch_scene_delegate() {
  local scene_file="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/SceneDelegate.m"
  [ -f "$scene_file" ] || die "SceneDelegate.m 不存在: $scene_file"
  cat > "$scene_file" <<'SCENE_DELEGATE'
#import "SceneDelegate.h"
#import "AppDelegate.h"
#import <DCloudUniappRuntime/DCloudUniappRuntime-Swift.h>
#import "UniAppX-Swift.h"

@interface SceneDelegate ()
@property (nonatomic, strong) UniAppRootSceneDelegate *sdkSceneDelegate;
@end

@implementation SceneDelegate

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions {
    self.sdkSceneDelegate = [[UniAppRootSceneDelegate alloc] init];
    [self.sdkSceneDelegate scene:scene willConnectToSession:session options:connectionOptions];
    if (![scene isKindOfClass:[UIWindowScene class]]) return;

    self.window = self.sdkSceneDelegate.window;
    if (!self.window) {
        self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    }

    UIViewController *host = [[UIViewController alloc] init];
    host.view.backgroundColor = [UIColor systemBackgroundColor];
    self.window.rootViewController = host;

    AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
    appDelegate.window = self.window;
    [self.window makeKeyAndVisible];

    // 正式 App 直接启动 UniApp，不再显示 UniAppX SDK 示例页面。
    dispatch_async(dispatch_get_main_queue(), ^{
        [UniAppBridge presentWithDefaultAnimationWithRootViewController:host];
    });
}

- (void)sceneDidBecomeActive:(UIScene *)scene {
    [self.sdkSceneDelegate sceneDidBecomeActive:scene];
}

- (void)sceneWillResignActive:(UIScene *)scene {
    [self.sdkSceneDelegate sceneWillResignActive:scene];
}

- (void)sceneWillEnterForeground:(UIScene *)scene {
    [self.sdkSceneDelegate sceneWillEnterForeground:scene];
}

- (void)sceneDidEnterBackground:(UIScene *)scene {
    [self.sdkSceneDelegate sceneDidEnterBackground:scene];
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts {
    [self.sdkSceneDelegate scene:scene openURLContexts:URLContexts];
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity {
    [self.sdkSceneDelegate scene:scene continueUserActivity:userActivity];
}

@end
SCENE_DELEGATE
}

patch_uts_plugin_projects() {
  local files=("$NATIVE_SDK_DIR"/UTSPluginExample/*/*.xcodeproj/project.pbxproj)
  [ -e "${files[0]}" ] || die "未找到 UTSPluginExample 工程"

  local pbx
  for pbx in "${files[@]}"; do
    perl -0pi -e 's/(CODE_SIGN_STYLE = (?:Automatic|Manual);)/$1\n\t\t\t\tCODE_SIGNING_ALLOWED = NO;/g' "$pbx"
    perl -pi -e 's/DEVELOPMENT_TEAM = YQM5H857L5;/DEVELOPMENT_TEAM = "";/g' "$pbx"
  done
  log "已关闭 ${#files[@]} 个 UTSPlugin framework 的独立签名"
}

write_package_env() {
  {
    printf 'APP_NAME=%q\n' "$APP_NAME"
    printf 'APP_ID=%q\n' "$APP_ID"
    printf 'BUNDLE_ID=%q\n' "$BUNDLE_ID"
    printf 'TEAM_ID=%q\n' "$TEAM_ID"
    printf 'PROFILE_NAME=%q\n' "$PROFILE_NAME"
    printf 'SIGNING_CERTIFICATE=%q\n' "$SIGNING_CERTIFICATE"
    printf 'EXPORT_METHOD=%q\n' "$EXPORT_METHOD"
    printf 'PACKAGE_KIND=%q\n' "$PACKAGE_KIND"
    printf 'SCHEME=%q\n' "$SCHEME"
    printf 'CONFIGURATION=%q\n' "$CONFIGURATION"
    printf 'SDK_ROOT=%q\n' "$APP_IOS_DIR"
    printf 'SOURCE_APP_DIR=%q\n' "$SOURCE_APP_DIR"
    printf 'OUTPUT_ROOT=%q\n' "$RUN_DIR/native-output"
    if [ -n "${MARKETING_VERSION:-}" ]; then
      printf 'MARKETING_VERSION=%q\n' "$MARKETING_VERSION"
    fi
    # --set KEY=VALUE 覆盖项由用户显式给出，写在最后：同名键以用户值为准。
    if [ -n "${APP_PACKAGER_SET_OVERRIDES:-}" ]; then
      local override
      while IFS= read -r override; do
        [ -n "$override" ] || continue
        printf '%s=%q\n' "${override%%=*}" "${override#*=}"
      done <<<"$APP_PACKAGER_SET_OVERRIDES"
    fi
  } > "$PACKAGE_ENV"
}

run_native_build() {
  local build_script="$WORKSPACE/$BUILD_SCRIPT_RELATIVE"
  [ -f "$build_script" ] || die "项目打包脚本不存在: $build_script"

  # workspace 会联编 UTSPluginExample。签名和 Bundle ID 已写入主 App target，
  # 不能再通过 xcodebuild 全局传入，否则会污染 framework target。
  python3 - "$build_script" <<'PY_PATCH'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
old = """BUILD_OVERRIDES=(
  "CODE_SIGN_STYLE=Manual"
  "DEVELOPMENT_TEAM=$TEAM_ID"
  "PROVISIONING_PROFILE_SPECIFIER=$PROFILE_NAME"
  "PRODUCT_BUNDLE_IDENTIFIER=$BUNDLE_ID"
  "CURRENT_PROJECT_VERSION=$BUILD_NUMBER"
)"""
new = """BUILD_OVERRIDES=(
  "CURRENT_PROJECT_VERSION=$BUILD_NUMBER"
)"""
if old not in text:
    raise SystemExit('BUILD_OVERRIDES marker not found')
text = text.replace(old, new, 1)
text = text.replace('  -project "$XCODE_PROJECT" \\', '  -workspace "$SDK_ROOT/UniAppXDemo/UniAppXDemo.xcworkspace" \\', 1)
path.write_text(text, encoding='utf-8')
PY_PATCH

  log "执行 Xcode Archive 和 IPA 导出"
  if ! SEMAPHORE_PROGRESS=70 SEMAPHORE_WAIT_MESSAGE="等待 Xcode 名额" \
    SEMAPHORE_RUN_MESSAGE="Xcode Archive 中" \
    with_semaphore "xcode" "${PARALLEL_MAX_XCODE_JOBS_RESOLVED:-1}" \
    bash "$build_script" --env-file "$PACKAGE_ENV" --clean >>"$LOG_FILE" 2>&1; then
    tail -n 200 "$LOG_FILE" >&2 || true
    die "Xcode 打包失败"
  fi

  IPA_SRC="$(find "$RUN_DIR/native-output" -type f -name '*.ipa' -print 2>/dev/null | sort | tail -n 1)"
  [ -n "$IPA_SRC" ] && [ -f "$IPA_SRC" ] || die "打包完成但未找到 IPA，日志: $LOG_FILE"
  log "IPA 已导出: $IPA_SRC"
}

sync_full_permissions() {
  [ "${FULL_PERMISSION_PROFILE:-false}" = "true" ] || return 0
  local manifest
  manifest="$(workspace_manifest_path)"
  local android_file="${FULL_ANDROID_PERMISSIONS_FILE:-}"
  local ios_file="${FULL_IOS_PRIVACY_FILE:-}"
  [ -f "$manifest" ] || die "manifest.json 不存在: $manifest"
  [ -f "$android_file" ] || die "全量 Android 权限配置不存在: $android_file"
  [ -f "$ios_file" ] || die "全量 iOS 隐私配置不存在: $ios_file"

  python3 - "$manifest" "$android_file" "$ios_file" <<'PY_FULL_PERMISSIONS'
from pathlib import Path
import json
import re
import sys

manifest_path = Path(sys.argv[1])
android_permissions = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
ios_privacy = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))
data = json.loads(manifest_path.read_text(encoding='utf-8', errors='ignore'))

android = data.setdefault('app-android', {}).setdefault('distribute', {})
existing = android.get('permissions', [])
if not isinstance(existing, list):
    existing = []

def permission_key(value):
    match = re.search(r'android:name="([^"]+)"', value)
    return match.group(1) if match else value

merged = []
seen = set()
for item in list(existing) + list(android_permissions):
    if not isinstance(item, str) or not item.strip():
        continue
    key = permission_key(item)
    if key in seen:
        continue
    seen.add(key)
    merged.append(item)
android['permissions'] = merged

ios = data.setdefault('app-ios', {}).setdefault('distribute', {})
privacy = ios.get('privacyDescription', {})
if not isinstance(privacy, dict):
    privacy = {}
privacy.update(ios_privacy)
ios['privacyDescription'] = privacy

manifest_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'full permissions: android={len(merged)}, ios_privacy={len(privacy)}')
PY_FULL_PERMISSIONS
}

patch_android_permission_bootstrap() {
  [ "${FULL_PERMISSION_PROMPT:-false}" = "true" ] || return 0

  local app_file manifest_path
  app_file="$(workspace_app_file 2>/dev/null || true)"
  if [ -z "$app_file" ]; then
    warn "未找到 App.uvue，跳过 Android 首次启动权限申请注入"
    return 0
  fi
  manifest_path="$(workspace_manifest_path 2>/dev/null || true)"
  [ -n "$manifest_path" ] || die "manifest.json 不存在，无法生成权限申请列表"

  python3 - "$app_file" "$manifest_path" <<'PY_PERMISSION_BOOTSTRAP'
from pathlib import Path
import json
import re
import sys

app_path = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
text = app_path.read_text(encoding='utf-8', errors='ignore')
marker = '// PIPELINE_PERMISSION_BOOTSTRAP'
if marker in text:
    print('Android 权限申请注入已存在，跳过')
    raise SystemExit(0)

try:
    manifest = json.loads(manifest_path.read_text(encoding='utf-8', errors='ignore'))
except Exception as exc:
    raise SystemExit(f'manifest.json 解析失败: {exc}')

raw_permissions = manifest.get('app-android', {}).get('distribute', {}).get('permissions', [])
if not isinstance(raw_permissions, list):
    raw_permissions = []

runtime_permissions = {
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_PHONE_STATE',
    'android.permission.READ_PHONE_NUMBERS',
    'android.permission.CALL_PHONE',
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_CALENDAR',
    'android.permission.WRITE_CALENDAR',
    'android.permission.BODY_SENSORS',
    'android.permission.ACTIVITY_RECOGNITION',
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_ADVERTISE',
}
permissions = []
seen = set()
for item in raw_permissions:
    if not isinstance(item, str):
        continue
    match = re.search(r'android:name="([^"]+)"', item)
    name = match.group(1) if match else item.strip()
    if name in runtime_permissions and name not in seen:
        seen.add(name)
        permissions.append(name)

if not permissions:
    print('manifest 未配置可申请的运行时权限，跳过 Android 权限申请注入')
    raise SystemExit(0)

values = ',\n'.join('  %r' % item for item in permissions)
helper = """// PIPELINE_PERMISSION_BOOTSTRAP
// #ifdef APP-ANDROID
const PIPELINE_ANDROID_PERMISSIONS: string[] = [
%s
] as string[]
let pipelinePermissionRequesting = false

function requestPipelinePermissions(): void {
  if (pipelinePermissionRequesting) return
  pipelinePermissionRequesting = true
  UTSAndroid.requestSystemPermission(
    UTSAndroid.getUniActivity()!,
    PIPELINE_ANDROID_PERMISSIONS,
    (_allRight: boolean, _grantedList: string[]): void => {},
    (_doNotAskAgain: boolean, _deniedList: string[]): void => {},
    false,
  )
  pipelinePermissionRequesting = false
}
// #endif

""" % values
anchor = 'export default {'
if anchor not in text:
    raise SystemExit('App.uvue export default marker not found')
text = text.replace(anchor, helper + anchor, 1)

pattern = r'(onLaunch\([^)]*\)\s*\{)'
match = re.search(pattern, text)
if match is None:
    raise SystemExit('App.uvue onLaunch marker not found')
insert = match.group(1) + '\n    // #ifdef APP-ANDROID\n    requestPipelinePermissions()\n    // #endif\n'
text = text[:match.start()] + insert + text[match.end():]
app_path.write_text(text, encoding='utf-8')
print(f'patched App.uvue permission bootstrap: {len(permissions)} permissions')
PY_PERMISSION_BOOTSTRAP
}

generate_android_resources() {
  patch_android_permission_bootstrap
  log "调用 HBuilderX 编译 Android App 资源（静默模式）"
  if ! SEMAPHORE_PROGRESS=35 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" \
    SEMAPHORE_RUN_MESSAGE="HBuilderX 生成 Android 资源" \
    with_semaphore "hbuilderx" "${PARALLEL_MAX_HBULDERX_JOBS_RESOLVED:-1}" \
    run_with_timeout 900 "$HBUILDERX_CLI" publish app-android --type appResource --project "$WORKSPACE" >>"$LOG_FILE" 2>&1; then
    tail -n 160 "$LOG_FILE" >&2 || true
    die "HBuilderX 生成本地 Android App 资源失败"
  fi

  ANDROID_RESOURCE_DIR="$WORKSPACE/unpackage/resources/app-android"
  [ -d "$ANDROID_RESOURCE_DIR" ] || die "未找到 Android 资源目录: $ANDROID_RESOURCE_DIR"
  local count uni_dir
  count="$(find "$ANDROID_RESOURCE_DIR" -mindepth 1 -maxdepth 1 -type d -name '__UNI__*' | wc -l | tr -d ' ')"
  [ "$count" = "1" ] || die "Android 资源目录中的 AppID 数量异常: $count"
  uni_dir="$(find "$ANDROID_RESOURCE_DIR" -mindepth 1 -maxdepth 1 -type d -name '__UNI__*' -print -quit)"
  ANDROID_APP_RESOURCE_DIR="$uni_dir"
  log "Android 资源已生成: $ANDROID_APP_RESOURCE_DIR"
}

copy_android_resources() {
  local java_src="$ANDROID_RESOURCE_DIR/uniappx/app-android/src"
  local java_dest="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/uniappx/src/main/java"
  local assets_root="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/uniappx/src/main/assets/apps"
  local assets_dest="$assets_root/$APP_ID"

  [ -d "$java_src" ] || die "Android Java 资源目录不存在: $java_src"
  rm -rf "$java_dest"
  mkdir -p "$java_dest"
  cp -R "$java_src/." "$java_dest/" >>"$LOG_FILE" 2>&1 || die "复制 Android Java 资源失败"

  mkdir -p "$assets_root"
  find "$assets_root" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  mkdir -p "$assets_dest"
  cp -R "$ANDROID_APP_RESOURCE_DIR/." "$assets_dest/" >>"$LOG_FILE" 2>&1 \
    || die "复制 Android App 资源失败"
  log "Android 资源已复制: $APP_ID"
}

manifest_version_code() {
  local manifest="$1"
  sed -n 's/.*"versionCode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1
}

patch_android_project() {
  local gradle_file="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/app/build.gradle"
  [ -f "$gradle_file" ] || die "Android build.gradle 不存在: $gradle_file"

  local gradle_properties="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/gradle.properties"
  if [ -f "$gradle_properties" ]; then
    python3 - "$gradle_properties" <<'PY_GRADLE_MEMORY'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
text, count = re.subn(
    r'^org\.gradle\.jvmargs=.*$',
    'org.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8',
    text,
    count=1,
    flags=re.M,
)
if count == 0:
    text = 'org.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8\n' + text
if re.search(r'^kotlin\.daemon\.jvmargs=', text, flags=re.M):
    text = re.sub(
        r'^kotlin\.daemon\.jvmargs=.*$',
        'kotlin.daemon.jvmargs=-Xmx4096m',
        text,
        count=1,
        flags=re.M,
    )
else:
    text += '\nkotlin.daemon.jvmargs=-Xmx4096m\n'
path.write_text(text, encoding='utf-8')
PY_GRADLE_MEMORY
    log "Android 编译内存已调整: Gradle/Kotlin 4096m"
  fi

  local version_code
  version_code="$(manifest_version_code "$(workspace_manifest_path)")"
  [ -n "$version_code" ] || version_code="1"

  if [ -z "${ANDROID_APPLICATION_ID:-}" ]; then
    ANDROID_APPLICATION_ID="$(sed -n 's/.*applicationId "\([^"]*\)".*/\1/p' "$gradle_file" | head -n 1)"
  fi

  python3 - "$gradle_file" "$MARKETING_VERSION" "$version_code" "${ANDROID_APPLICATION_ID:-}" <<'PY_ANDROID'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
marketing, version_code, application_id = sys.argv[2:5]
text = path.read_text(encoding='utf-8')
text, n1 = re.subn(r'versionCode\s+\d+', f'versionCode {version_code}', text, count=1)
text, n2 = re.subn(r'versionName\s+"[^"]*"', f'versionName "{marketing}"', text, count=1)
# uni-app x 5.26 的 ShareWithSystem Hook 实际包名带 DCloud 前缀。
text = text.replace(
    'uts.sdk.modules.uniShareWithSystem.ShareWithSystemHook',
    'uts.sdk.modules.DCloudUniShareWithSystem.ShareWithSystemHook',
)

if n1 != 1 or n2 != 1:
    raise SystemExit('Android version settings not found')
if application_id:
    text, n3 = re.subn(r'applicationId\s+"[^"]*"', f'applicationId "{application_id}"', text, count=1)
    if n3 != 1:
        raise SystemExit('Android applicationId not found')
path.write_text(text, encoding='utf-8')
PY_ANDROID

  if [ -n "${ANDROID_AGP_VERSION:-}" ]; then
    local versions_file="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/gradle/libs.versions.toml"
    if [ -f "$versions_file" ]; then
      python3 - "$versions_file" "$ANDROID_AGP_VERSION" <<'PY_AGP'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
version = sys.argv[2]
text = path.read_text(encoding='utf-8')
text, count = re.subn(r'^agp\s*=\s*"[^"]*"', f'agp = "{version}"', text, count=1, flags=re.M)
if count != 1:
    raise SystemExit('AGP version setting not found')
path.write_text(text, encoding='utf-8')
PY_AGP
    fi
  fi

  apply_android_brand_assets
  prepare_android_signing "$gradle_file"

  local strings_xml="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/app/src/main/res/values/strings.xml"
  mkdir -p "$(dirname "$strings_xml")"
  python3 - "$strings_xml" "$DISPLAY_NAME" <<'PY_STRINGS'
from pathlib import Path
import html
import sys
Path(sys.argv[1]).write_text(
    '<resources>\n    <string name="app_name">%s</string>\n</resources>\n' % html.escape(sys.argv[2]),
    encoding='utf-8'
)
PY_STRINGS

  sync_android_permissions
  printf 'sdk.dir=%s\n' "${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}" \
    > "$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/local.properties"
  log "Android 版本: $MARKETING_VERSION ($version_code, AGP ${ANDROID_AGP_VERSION:-project})"
}

apply_ios_storyboard_splash() {
  local zip_rel="$1" assets_root="$2" storyboard_dst="$3"
  local tmp_dir
  tmp_dir="$(mktemp -d "$TMP_DIR/storyboard.XXXXXX")"
  if ! ditto -x -k "$WORKSPACE/$zip_rel" "$tmp_dir" >/dev/null 2>&1; then
    warn "iOS 启动页 ZIP 解压失败: $zip_rel"
    rm -rf "$tmp_dir"
    return 1
  fi

  python3 - "$tmp_dir" "$assets_root" "$storyboard_dst" <<'PY_STORYBOARD'
from pathlib import Path
import json
import re
import shutil
import sys

src = Path(sys.argv[1])
assets = Path(sys.argv[2])
storyboard_dst = Path(sys.argv[3])

storyboards = list(src.rglob('*.storyboard'))
if not storyboards:
    raise SystemExit('storyboard not found in zip')

storyboard_text = storyboards[0].read_text(encoding='utf-8')
storyboard_text = re.sub(r'image="([^"]+)\.png"', r'image="\1"', storyboard_text)
storyboard_dst.parent.mkdir(parents=True, exist_ok=True)
storyboard_dst.write_text(storyboard_text, encoding='utf-8')

for png in src.rglob('*.png'):
    stem = png.stem
    match = re.search(r'@([123])x$', stem)
    scale = f'{match.group(1)}x' if match else '1x'
    name = re.sub(r'@[123]x$', '', stem) if match else stem
    imageset = assets / f'{name}.imageset'
    imageset.mkdir(parents=True, exist_ok=True)
    shutil.copy2(png, imageset / png.name)

    contents_path = imageset / 'Contents.json'
    if contents_path.exists():
        data = json.loads(contents_path.read_text(encoding='utf-8'))
    else:
        data = {'images': [], 'info': {'author': 'xcode', 'version': 1}}

    entries = {item.get('scale'): item for item in data.get('images', []) if item.get('scale')}
    for current_scale in ('1x', '2x', '3x'):
        entries.setdefault(current_scale, {'idiom': 'universal', 'scale': current_scale})
    entries[scale]['filename'] = png.name
    data['images'] = [entries[current_scale] for current_scale in ('1x', '2x', '3x')]
    contents_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_STORYBOARD
  local status=$?
  rm -rf "$tmp_dir"
  return "$status"
}

apply_ios_brand_assets() {
  [ "${BRAND_ASSET_MODE:-manifest}" != "disabled" ] || return 0
  if ! manifest_platform_brand_configured ios; then
    warn "manifest 未配置 iOS 图标和启动页，保留 uni-app 默认资源"
    return 0
  fi
  local assets_root="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/Assets.xcassets"
  local icon_dir="$assets_root/AppIcon.appiconset"
  local launch_dir="$assets_root/LaunchImage.imageset"
  local storyboard="$APP_IOS_DIR/UniAppXDemo/UniAppXDemo/Base.lproj/LaunchScreen.storyboard"
  local icon_rel icon_path splash_rel splash_path storyboard_rel

  icon_rel="$(manifest_icon_path ios appstore)"
  if [ -n "$icon_rel" ] && [ -f "$WORKSPACE/$icon_rel" ]; then
    mkdir -p "$icon_dir"
    cp -f "$WORKSPACE/$icon_rel" "$icon_dir/AppIcon.png"
    cat > "$icon_dir/Contents.json" <<'JSON'
{
  "images" : [
    {
      "filename" : "AppIcon.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
    log "iOS AppIcon 使用配置原图: $icon_rel"
  else
    warn "manifest 未配置 iOS appstore 图标，保留原生默认图标"
  fi

  storyboard_rel="$(manifest_ios_storyboard_path || true)"
  if [ -n "$storyboard_rel" ] && [ -f "$WORKSPACE/$storyboard_rel" ]; then
    if apply_ios_storyboard_splash "$storyboard_rel" "$assets_root" "$storyboard"; then
      log "iOS 启动页使用 manifest storyboard: $storyboard_rel"
    else
      warn "manifest iOS storyboard 处理失败，保留原生默认启动页"
    fi
  else
    splash_rel="$(manifest_splash_path ios)"
    if [ -n "$splash_rel" ] && [ -f "$WORKSPACE/$splash_rel" ]; then
      mkdir -p "$launch_dir"
      cp -f "$WORKSPACE/$splash_rel" "$launch_dir/LaunchImage.png"
      cat > "$launch_dir/Contents.json" <<'JSON'
{
  "images" : [
    {
      "filename" : "LaunchImage.png",
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
      cat > "$storyboard" <<'STORYBOARD'
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="23094" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="23084"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFill" image="LaunchImage" translatesAutoresizingMaskIntoConstraints="NO" id="Lch-2A-0hM"/>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="6Tk-OE-BBY"/>
                        <constraints>
                            <constraint firstItem="Lch-2A-0hM" firstAttribute="leading" secondItem="Ze5-6b-2t3" secondAttribute="leading" id="C0n-1A-000"/>
                            <constraint firstItem="Lch-2A-0hM" firstAttribute="top" secondItem="Ze5-6b-2t3" secondAttribute="top" id="C0n-1B-000"/>
                            <constraint firstAttribute="trailing" secondItem="Lch-2A-0hM" secondAttribute="trailing" id="C0n-1C-000"/>
                            <constraint firstAttribute="bottom" secondItem="Lch-2A-0hM" secondAttribute="bottom" id="C0n-1D-000"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="52.671755725190835" y="374.64788732394368"/>
        </scene>
    </scenes>
    <resources>
        <image name="LaunchImage" width="1242" height="2688"/>
    </resources>
</document>
STORYBOARD
      log "iOS 启动页使用配置原图: $splash_rel"
    else
      warn "manifest 未配置 iOS splashScreens 图片或 storyboard，使用项目内 pages/index/splash 页面"
    fi
  fi

}

apply_android_brand_assets() {
  [ "${BRAND_ASSET_MODE:-manifest}" != "disabled" ] || return 0
  if ! manifest_platform_brand_configured android; then
    warn "manifest 未配置 Android 图标和启动页，保留 uni-app 默认资源"
    return 0
  fi
  local module_dir="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}"
  local app_res="$module_dir/app/src/main/res"
  local uniapp_res="$module_dir/uniappx/src/main/res"
  local density rel src found=0
  local splash_rel splash_path

  for density in hdpi xhdpi xxhdpi xxxhdpi; do
    rel="$(manifest_icon_path android "$density")"
    [ -n "$rel" ] && [ -f "$WORKSPACE/$rel" ] || continue
    mkdir -p "$app_res/mipmap-$density"
    cp -f "$WORKSPACE/$rel" "$app_res/mipmap-$density/ic_launcher.png"
    cp -f "$WORKSPACE/$rel" "$app_res/mipmap-$density/ic_launcher_round.png"
    rm -f "$app_res/mipmap-$density/ic_launcher.webp" "$app_res/mipmap-$density/ic_launcher_round.webp"
    found=1
  done

  if [ "$found" = "1" ]; then
    rm -rf "$app_res/mipmap-anydpi-v26"
    log "Android AppIcon 使用 manifest 配置原图"
  else
    warn "manifest 未配置 Android 图标，保留原生默认图标"
  fi

  splash_rel="$(manifest_splash_path android)"
  if [ -n "$splash_rel" ] && [ -f "$WORKSPACE/$splash_rel" ]; then
    mkdir -p "$uniapp_res/drawable-nodpi" "$uniapp_res/drawable" "$uniapp_res/values" "$uniapp_res/values-v31"
    cp -f "$WORKSPACE/$splash_rel" "$uniapp_res/drawable-nodpi/launch_image.png"
    cat > "$uniapp_res/drawable/launch_screen.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/white" />
    <item android:drawable="@drawable/launch_image" android:gravity="fill" />
</layer-list>
XML
    cat > "$uniapp_res/values/themes.xml" <<'XML'
<resources>
    <style name="UniAppX.Activity.DefaultTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
        <item name="android:windowBackground">@drawable/launch_screen</item>
        <item name="android:statusBarColor">@android:color/white</item>
    </style>
</resources>
XML
    cat > "$uniapp_res/values-v31/themes.xml" <<'XML'
<resources>
    <style name="UniAppX.Activity.DefaultTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
        <item name="android:windowSplashScreenBackground">@android:color/white</item>
        <item name="android:windowSplashScreenAnimatedIcon">@drawable/launch_image</item>
        <item name="android:windowSplashScreenIconBackgroundColor">@android:color/white</item>
        <item name="android:windowBackground">@drawable/launch_screen</item>
        <item name="android:statusBarColor">@android:color/white</item>
    </style>
</resources>
XML
    log "Android 启动页使用配置原图: $splash_rel"
  else
    warn "manifest 未配置 Android splashScreens 图片，使用项目内 pages/index/splash 页面"
  fi
}


sync_android_permissions() {
  local android_manifest="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/app/src/main/AndroidManifest.xml"
  [ -f "$(workspace_manifest_path)" ] || die "manifest.json 不存在"
  [ -f "$android_manifest" ] || die "AndroidManifest.xml 不存在: $android_manifest"

  python3 - "$(workspace_manifest_path)" "$android_manifest" <<'PY_PERMISSIONS'
from pathlib import Path
import json
import re
import sys

manifest_path, android_manifest_path = sys.argv[1:3]
text = Path(manifest_path).read_text(encoding='utf-8', errors='ignore')
start = text.find('"app-android"')
end = text.find('"app-ios"', start)
if start < 0:
    raise SystemExit(0)
block = text[start:end if end >= 0 else len(text)]
pos = block.find('"permissions"')
if pos < 0:
    raise SystemExit(0)
left = block.find('[', pos)
if left < 0:
    raise SystemExit(0)
depth = 0
right = -1
in_string = False
escaped = False
for i in range(left, len(block)):
    ch = block[i]
    if in_string:
        if escaped:
            escaped = False
        elif ch == '\\':
            escaped = True
        elif ch == '"':
            in_string = False
        continue
    if ch == '"':
        in_string = True
    elif ch == '[':
        depth += 1
    elif ch == ']':
        depth -= 1
        if depth == 0:
            right = i
            break
if right < 0:
    raise SystemExit(0)

permissions = []
for match in re.finditer(r'"((?:\\.|[^"\\])*)"', block[left + 1:right], re.S):
    raw = '"' + match.group(1) + '"'
    try:
        value = json.loads(raw)
    except Exception:
        value = match.group(1)
    value = value.strip()
    if value:
        permissions.append(value)

xml = Path(android_manifest_path).read_text(encoding='utf-8', errors='ignore')
inserts = []
for permission in permissions:
    name_match = re.search(r'android:name="([^"]+)"', permission)
    marker = name_match.group(1) if name_match else permission
    if marker not in xml:
        inserts.append('    ' + permission)

if inserts:
    marker = '    <application'
    if marker not in xml:
        raise SystemExit('AndroidManifest.xml application node not found')
    xml = xml.replace(marker, '\n'.join(inserts) + '\n\n' + marker, 1)
    Path(android_manifest_path).write_text(xml, encoding='utf-8')
    print(f'synced {len(inserts)} permissions')
else:
    print('permissions already present')
PY_PERMISSIONS
  log "Android 权限已从 manifest.json 同步"
}

android_log_has_compile_errors() {
  [ -f "$LOG_FILE" ] || return 1
  grep -qE '^e: file://|Compilation error|Unresolved reference|No parameter with name|Argument type mismatch' "$LOG_FILE"
}

show_android_source_errors() {
  local errors unresolved permission_api_unresolved missing_params hints

  errors="$(grep -E '^(e: file://|.*Unresolved reference|.*No parameter with name|.*Argument type mismatch|.*Compilation error)' "$LOG_FILE" 2>/dev/null | awk '!seen[$0]++' | tail -n 160)"
  [ -n "$errors" ] || errors="$(tail -n 160 "$LOG_FILE" 2>/dev/null | awk '!seen[$0]++' || true)"

  unresolved="$(printf '%s\n' "$errors" | sed -n "s/.*Unresolved reference '\([^']*\)'.*/\1/p" | grep -Ev 'requestSystemPermission|RequestSystemPermissionOptions|uni_requestSystemPermission' | grep -E '^[A-Z][A-Za-z0-9_]*$' | sort -u | paste -sd ', ' -)"
  permission_api_unresolved="$(printf '%s\n' "$errors" | sed -n "s/.*Unresolved reference '\([^']*\)'.*/\1/p" | grep -E 'requestSystemPermission|RequestSystemPermissionOptions|uni_requestSystemPermission' | sort -u | paste -sd ', ' -)"
  missing_params="$(printf '%s\n' "$errors" | sed -n "s/.*No parameter with name '\([^']*\)'.*/\1/p" | sort -u | paste -sd ', ' -)"
  hints=""

  if [ -n "$permission_api_unresolved" ]; then
    hints="${hints}\n- 权限 API/模块缺失: ${permission_api_unresolved}。请检查项目是否配置并打包 uni-requestSystemPermission；若未配置该模块，请改用 UTSAndroid.requestSystemPermission(UTSAndroid.getUniActivity()!, permissions, success, fail)。"
  fi
  if [ -n "$unresolved" ]; then
    hints="${hints}\n- 缺少类型/符号: ${unresolved}。请检查 types/api.uts、对应 import 和接口返回值定义。"
  fi
  if [ -n "$missing_params" ]; then
    hints="${hints}\n- DTO/接口缺少字段: ${missing_params}。请检查 types/api.uts 或 service/api 下对应入参类型。"
  fi

  printf '\n' >&2
  printf '========== 需要修改业务项目源码 ==========\n' >&2
  printf '项目目录: %s\n' "$SOURCE_DIR" >&2
  printf '这类错误不能由打包工具自动补类型或字段，否则会掩盖业务代码问题。\n' >&2
  [ -n "$hints" ] && printf '%b\n' "$hints" >&2
  printf '\n编译器原始错误:\n%s\n' "$errors" >&2
  printf '完整日志: %s\n' "$LOG_FILE" >&2
  printf '==========================================\n\n' >&2
}

_run_gradle_build() {
  local android_dir="$1"
  shift
  (cd "$android_dir" && "$@")
}

build_android_apk() {
  local android_dir="$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}"
  local sdk_dir="${ANDROID_SDK_DIR:-$HOME/Library/Android/sdk}"
  local gradle_bin="${ANDROID_GRADLE_BIN:-}"
  local -a gradle_cmd=()
  [ -d "$sdk_dir" ] || die "Android SDK 不存在: $sdk_dir"

  if [ "${ANDROID_USE_PROJECT_WRAPPER:-false}" = "true" ] && [ -x "$android_dir/gradlew" ]; then
    gradle_cmd=("$android_dir/gradlew")
  else
    if [ -z "$gradle_bin" ] || [ ! -x "$gradle_bin" ] || ! run_with_timeout 20 "$gradle_bin" --version >/dev/null 2>&1; then
      gradle_bin="$(find_cached_gradle || true)"
    fi
    [ -n "$gradle_bin" ] && [ -x "$gradle_bin" ] || die "未找到可正常启动的 Gradle 可执行文件"
    gradle_cmd=("$gradle_bin")
  fi
  export ANDROID_HOME="$sdk_dir"
  export ANDROID_SDK_ROOT="$sdk_dir"
  if [ "${ANDROID_SIGNING_MODE:-project-signing}" = "release-keystore" ]; then
    export APP_PACKAGER_ANDROID_STORE_PASSWORD="$ANDROID_KEYSTORE_STORE_PASSWORD"
    export APP_PACKAGER_ANDROID_KEY_PASSWORD="$ANDROID_KEYSTORE_KEY_PASSWORD"
  fi

  log "执行 Android Gradle assembleRelease（优先离线）"
  if SEMAPHORE_PROGRESS=70 SEMAPHORE_WAIT_MESSAGE="等待 Gradle 名额" \
    SEMAPHORE_RUN_MESSAGE="Gradle assembleRelease 中" \
    with_semaphore "gradle" "${PARALLEL_MAX_GRADLE_JOBS_RESOLVED:-1}" \
    _run_gradle_build "$android_dir" "${gradle_cmd[@]}" \
    --offline --no-daemon --max-workers "${PARALLEL_GRADLE_WORKERS_RESOLVED:-2}" \
    clean assembleRelease >>"$LOG_FILE" 2>&1; then
    log "Android Gradle 离线构建成功"
  else
    if android_log_has_compile_errors; then
      show_android_source_errors
      die "Android 编译失败：请先按提示修改业务项目源码"
    fi

    warn "本地 Gradle 缓存不完整，改为联网补齐依赖后重试一次"
    if ! SEMAPHORE_PROGRESS=70 SEMAPHORE_WAIT_MESSAGE="等待 Gradle 名额" \
      SEMAPHORE_RUN_MESSAGE="Gradle assembleRelease 中" \
      with_semaphore "gradle" "${PARALLEL_MAX_GRADLE_JOBS_RESOLVED:-1}" \
      _run_gradle_build "$android_dir" "${gradle_cmd[@]}" \
      --no-daemon --max-workers "${PARALLEL_GRADLE_WORKERS_RESOLVED:-2}" \
      clean assembleRelease >>"$LOG_FILE" 2>&1; then
      show_android_source_errors
      die "Android Gradle 打包失败"
    fi
    log "Android Gradle 在线补齐并构建成功"
  fi

  APK_SRC="$android_dir/app/build/outputs/apk/release/app-release.apk"
  [ -f "$APK_SRC" ] || die "Gradle 完成但未找到 APK: $APK_SRC"
  log "APK 已导出: $APK_SRC"
}

apply_harmony_version_override() {
  local manifest version_code
  version_code="${HARMONY_VERSION_CODE:-}"
  [ -n "$version_code" ] || return 0
  [[ "$version_code" =~ ^[0-9]+$ ]] || die "HARMONY_VERSION_CODE 必须为正整数: $version_code"
  manifest="$(workspace_manifest_path 2>/dev/null || true)"
  [ -f "$manifest" ] || die "manifest.json 不存在，无法应用 HarmonyOS versionCode"
  python3 - "$manifest" "$version_code" <<'PY_HARMONY_VERSION_CODE'
from pathlib import Path
import json
import sys

manifest = Path(sys.argv[1])
override = sys.argv[2]
data = json.loads(manifest.read_text(encoding='utf-8'))
old = data.get('versionCode')
data['versionCode'] = override if isinstance(old, str) else int(override)
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_HARMONY_VERSION_CODE
  log "HarmonyOS versionCode 已覆盖为 $version_code"
}

harmony_bundle_name() {
  python3 - "$(workspace_manifest_path)" <<'PY_HARMONY_BUNDLE'
from pathlib import Path
import json
import sys
try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
except Exception:
    data = {}
print(data.get('app-harmony', {}).get('distribute', {}).get('bundleName', '') or '')
PY_HARMONY_BUNDLE
}

harmony_profile_upload_metadata() {
  local profile_file="$1"
  python3 - "$profile_file" <<'PY_HARMONY_PROFILE_UPLOAD_METADATA'
from pathlib import Path
import json
import sys

profile = Path(sys.argv[1])
try:
    text = profile.read_text(encoding='utf-8', errors='ignore')
    data, _ = json.JSONDecoder().raw_decode(text[text.find('{'):])
except Exception:
    raise SystemExit(1)

profile_type = str(data.get('type', '') or '-')
distribution = str(data.get('app-distribution-type', '') or '-')
debug_info = data.get('debug-info', {}) if isinstance(data.get('debug-info'), dict) else {}
device_ids = debug_info.get('device-ids', [])
if not isinstance(device_ids, list):
    device_ids = []
print('\t'.join([profile_type, distribution, str(len(device_ids))]))
PY_HARMONY_PROFILE_UPLOAD_METADATA
}

harmony_signing_material() {
  local manifest="" signing_kind="${HARMONY_PACKAGE_KIND:-release}"
  [ -n "${WORKSPACE:-}" ] && manifest="$(workspace_manifest_path 2>/dev/null || true)"
  python3 - "$manifest" "$signing_kind" <<'PY_HARMONY_SIGNING'
from pathlib import Path
import json
import os
import sys

manifest = Path(sys.argv[1]) if sys.argv[1] else None
signing_kind = sys.argv[2] if len(sys.argv) > 2 else 'release'
try:
    data = json.loads(manifest.read_text(encoding='utf-8')) if manifest and manifest.is_file() else {}
except Exception:
    data = {}

configs = data.get('app-harmony', {}).get('distribute', {}).get('signingConfigs', {})
config_order = ('default', 'release') if signing_kind == 'debug' else ('release', 'default')
for name in config_order:
    cfg = configs.get(name, {})
    if not isinstance(cfg, dict):
        continue
    files = [cfg.get('storeFile', ''), cfg.get('certpath', ''), cfg.get('profile', '')]
    if all(value and Path(value).is_file() for value in files):
        print('\t'.join([
            files[0],
            str(cfg.get('keyAlias', 'release')),
            files[1],
            files[2],
            str(cfg.get('signAlg', 'SHA256withECDSA')),
            str(cfg.get('storePassword', '')),
            str(cfg.get('keyPassword', '')),
        ]))
        raise SystemExit(0)
PY_HARMONY_SIGNING
}

harmony_compatible_version() {
  local profile="$WORKSPACE/unpackage/dist/build/app-harmony/build-profile.json5"
  python3 - "$profile" <<'PY_HARMONY_VERSION'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8', errors='ignore') if path.is_file() else ''
match = re.search(r'compatibleSdkVersion"\s*:\s*"[^"]*\((\d+)\)"', text)
print(match.group(1) if match else '13')
PY_HARMONY_VERSION
}

harmony_password_from_keychain() {
  security find-generic-password -s "$HARMONY_P12_PASSWORD_SERVICE" -a "$USER" -w 2>/dev/null || true
}

activate_harmony_temporary_install_patch() {
  HARMONY_TEMP_PATCH_APPLIED=""
  HARMONY_PGYER_COMPAT_PATCH=""
  HARMONY_BUILD_MODE="${HARMONY_BUILD_MODE:-release}"

  # [TEMP-10021] 本地侧载模式：不上传时使用项目原始 default debug signingConfig。
  if [ "${HARMONY_TEMP_FORCE_INSTALL_SIGNING:-false}" = "true" ] && \
    [ -z "${UPLOAD_SELECTED_PLATFORMS:-}" ]; then
    if [ "${HARMONY_PACKAGE_KIND:-release}" != "debug" ]; then
      HARMONY_PACKAGE_KIND="debug"
      HARMONY_BUILD_MODE="debug"
      HARMONY_TEMP_PATCH_APPLIED="TEMP-10021"
      warn "[TEMP-10021] HarmonyOS 测试侧载模式已启用：使用项目 default debug signingConfig"
    else
      HARMONY_TEMP_PATCH_APPLIED="TEMP-10021"
    fi
  fi

  # [PGYER-17700015] 蒲公英兼容模式：默认使用 release HAP + internal testing
  # Profile，并将 targetSdkVersion 对齐蒲公英 manifest 的 5.0.1(13)。
  if [ "${HARMONY_PACKAGE_KIND:-release}" != "debug" ] && \
    [ -n "${UPLOAD_SELECTED_PLATFORMS:-}" ] && \
    [[ ",${UPLOAD_SELECTED_PLATFORMS}," == *,pgyer,* ]]; then
    HARMONY_PGYER_COMPAT_PATCH="PGYER-17700015"
    if [ "${HARMONY_PGYER_DEBUGGABLE:-false}" = "true" ]; then
      HARMONY_BUILD_MODE="debug"
      warn "[PGYER-17700015] HarmonyOS 蒲公英兼容模式：Release 签名 + debug HAP 构建"
    else
      warn "[PGYER-17700015] HarmonyOS 蒲公英兼容模式：Release HAP + targetAPI 5.0.1(13)"
    fi
  fi
}

prepare_harmony_manifest_signing() {
  local manifest material password fallback
  manifest="$(workspace_manifest_path 2>/dev/null || true)"
  [ -f "$manifest" ] || return 0

  if [ "${HARMONY_PACKAGE_KIND:-release}" = "debug" ]; then
    python3 - "$manifest" <<'PY_USE_HARMONY_DEBUG_SIGNING'
from pathlib import Path
import copy
import json
import sys

manifest = Path(sys.argv[1])
data = json.loads(manifest.read_text(encoding='utf-8'))
distribute = data.setdefault('app-harmony', {}).setdefault('distribute', {})
signing = distribute.setdefault('signingConfigs', {})
debug_config = signing.get('default')
if not isinstance(debug_config, dict) or not debug_config:
    raise SystemExit('manifest 缺少 app-harmony.distribute.signingConfigs.default')
signing['release'] = copy.deepcopy(debug_config)
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_USE_HARMONY_DEBUG_SIGNING
    log "HarmonyOS 安装模式：使用项目 default debug signingConfig，仅在隔离工作区映射到 release 构建"
    return 0
  fi

  material="$(WORKSPACE="$WORKSPACE" harmony_signing_material || true)"
  if [ -n "$material" ]; then
    return 0
  fi

  fallback="$(python3 - "$manifest" "$HARMONY_SIGNING_CERT_DIR" <<'PY_HARMONY_FALLBACK'
from pathlib import Path
import json
import sys

manifest = Path(sys.argv[1])
cert_dir = Path(sys.argv[2])
try:
    data = json.loads(manifest.read_text(encoding='utf-8'))
except Exception:
    data = {}
bundle_name = data.get('app-harmony', {}).get('distribute', {}).get('bundleName', '') or ''
rows = []
for profile in sorted(cert_dir.glob('*.p7b')):
    try:
        text = profile.read_text(encoding='utf-8', errors='ignore')
        info, _ = json.JSONDecoder().raw_decode(text[text.find('{'):])
    except Exception:
        continue
    profile_bundle = info.get('bundle-info', {}).get('bundle-name', '') if isinstance(info.get('bundle-info'), dict) else ''
    profile_type = str(info.get('type', ''))
    if bundle_name and profile_bundle == bundle_name:
        rows.append((profile, profile_type))
rows.sort(key=lambda row: (row[1] != 'release', str(row[0])))
for profile, _ in rows:
    p12 = next(iter(sorted(cert_dir.glob('*.p12'))), None) or next(iter(sorted(cert_dir.glob('*.pfx'))), None)
    cer = cert_dir / ('release.cer' if 'release' in profile.name else 'dev.cer')
    if not cer.is_file():
        cer = next(iter(sorted(cert_dir.glob('*.cer'))), None)
    if p12 and cer:
        print('\t'.join([str(p12), str(cer), str(profile)]))
        raise SystemExit(0)
PY_HARMONY_FALLBACK
)"
  if [ -z "$fallback" ]; then
    warn "项目未配置 HarmonyOS signingConfigs，证书目录中也未找到 Bundle Name 匹配的证书；将使用 uni-app 默认处理"
    return 0
  fi

  local p12 cer profile
  IFS=$'\t' read -r p12 cer profile <<<"$fallback"
  password="${HARMONY_P12_PASSWORD:-$(harmony_password_from_keychain || true)}"
  if [ -z "$password" ] && [ -t 0 ] && [ "${APP_PACKAGER_NONINTERACTIVE:-0}" != "1" ]; then
    printf '项目未配置 HarmonyOS signingConfigs，请输入证书目录 fallback P12 密码: ' >&2
    read -r -s password || password=""
    printf '\n' >&2
  fi
  if [ -z "$password" ]; then
    warn "找到证书目录 fallback，但未提供 p12 密码；将使用 uni-app 默认处理"
    return 0
  fi

  HARMONY_FALLBACK_PASSWORD="$password" python3 - "$manifest" "$p12" "$cer" "$profile" \
    "${HARMONY_KEY_ALIAS:-release}" "${HARMONY_SIGN_ALG:-SHA256withECDSA}" <<'PY_INJECT_HARMONY_SIGNING'
from pathlib import Path
import json
import os
import sys

manifest = Path(sys.argv[1])
p12, cer, profile, alias, sign_alg = sys.argv[2:7]
data = json.loads(manifest.read_text(encoding='utf-8'))
distribute = data.setdefault('app-harmony', {}).setdefault('distribute', {})
config = {
    'storeFile': p12,
    'certpath': cer,
    'profile': profile,
    'keyAlias': alias,
    'signAlg': sign_alg,
    'storePassword': os.environ.get('HARMONY_FALLBACK_PASSWORD', ''),
    'keyPassword': os.environ.get('HARMONY_FALLBACK_PASSWORD', ''),
}
signing = distribute.setdefault('signingConfigs', {})
signing['release'] = config
signing['default'] = dict(config)
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_INJECT_HARMONY_SIGNING
  log "项目未配置 HarmonyOS signingConfigs，已使用证书目录 fallback: $(basename "$profile")"
}

materialize_harmony_signing_files() {
  local manifest kind target source temp_file
  manifest="$(workspace_manifest_path 2>/dev/null || true)"
  [ -f "$manifest" ] || die "manifest.json 不存在，无法读取 HarmonyOS signingConfigs"

  while IFS=$'\t' read -r kind target source; do
    [ -n "$kind" ] || continue
    [ -n "$target" ] || continue
    if [ "$kind" = "MATERIAL" ]; then
      [ -d "$source" ] || continue
      if [ ! -d "$target" ]; then
        mkdir -p "$(dirname "$target")"
        cp -R "$source" "$target" || die "复制 HarmonyOS material 目录失败: $source -> $target"
        log "已按 manifest 配置原样补齐 material 目录: $source -> $target"
      fi
      continue
    fi
    [ -n "$source" ] && [ -f "$source" ] || die "HarmonyOS signingConfigs 引用文件不存在，证书目录中也未找到对应文件: $target"
    mkdir -p "$(dirname "$target")"
    temp_file="$target.app-packager.$$.tmp"
    cp -p "$source" "$temp_file" || die "复制 HarmonyOS 签名文件失败: $source -> $target"
    mv -f "$temp_file" "$target" || die "写入 HarmonyOS signingConfigs 文件失败: $target"
    log "已按 manifest 配置原样补齐证书文件: $source -> $target"
  done < <(python3 - "$manifest" "$HARMONY_SIGNING_CERT_DIR" <<'PY_HARMONY_SIGNING_TARGETS'
from pathlib import Path
import json
import sys

manifest = Path(sys.argv[1])
cert_dir = Path(sys.argv[2])
data = json.loads(manifest.read_text(encoding='utf-8'))
bundle_name = data.get('app-harmony', {}).get('distribute', {}).get('bundleName', '') or ''
configs = data.get('app-harmony', {}).get('distribute', {}).get('signingConfigs', {})

def first(paths):
    values = sorted(path for path in paths if path.is_file())
    return values[0] if values else None

material_dirs = set()
for config_name, cfg in configs.items():
    if not isinstance(cfg, dict):
        continue
    profile_target = Path(cfg.get('profile', ''))
    profile_name = profile_target.name.lower()
    profile_type = 'debug' if config_name == 'default' or 'debug' in profile_name or 'devdebug' in profile_name else 'release'

    p12 = first(cert_dir.glob('*.p12')) or first(cert_dir.glob('*.pfx'))
    cer = cert_dir / ('dev.cer' if profile_type == 'debug' else 'release.cer')
    if not cer.is_file():
        cer = first(cert_dir.glob('*.cer'))

    profile = None
    if bundle_name:
        candidates = []
        for candidate in cert_dir.glob('*.p7b'):
            try:
                text = candidate.read_text(encoding='utf-8', errors='ignore')
                info, _ = json.JSONDecoder().raw_decode(text[text.find('{'):])
            except Exception:
                continue
            info_bundle = info.get('bundle-info', {}).get('bundle-name', '') if isinstance(info.get('bundle-info'), dict) else ''
            info_type = str(info.get('type', ''))
            if info_bundle == bundle_name and info_type == profile_type:
                candidates.append(candidate)
        profile = first(candidates)

    for key, source in (('storeFile', p12), ('certpath', cer), ('profile', profile)):
        target = cfg.get(key, '')
        if target and not Path(target).is_file():
            print('FILE\t' + str(target) + '\t' + (str(source) if source else ''))

    for target in (cfg.get('storeFile', ''), cfg.get('certpath', ''), cfg.get('profile', '')):
        if target:
            material_dirs.add(str(Path(target).parent / 'material'))

material_source = cert_dir / 'material'
if material_source.is_dir():
    for material_target in sorted(material_dirs):
        if not Path(material_target).is_dir():
            print('MATERIAL\t' + material_target + '\t' + str(material_source))
PY_HARMONY_SIGNING_TARGETS
  )
}

prepare_harmony_pgyer_build_profile() {
  local target_sdk config
  target_sdk="${HARMONY_PGYER_TARGET_SDK_VERSION:-5.0.1(13)}"
  config="$WORKSPACE/harmony-configs/build-profile.json5"
  mkdir -p "$(dirname "$config")"
  python3 - "$config" "$target_sdk" <<'PY_PGYER_BUILD_PROFILE'
from pathlib import Path
import json
import sys

config = Path(sys.argv[1])
target = sys.argv[2]
data = {
    'app': {
        'products': [
            {
                'name': 'default',
                'signingConfig': 'default',
                'compatibleSdkVersion': target,
                'targetSdkVersion': target,
                'runtimeOS': 'HarmonyOS',
                'buildOption': {
                    'strictMode': {
                        'caseSensitiveCheck': True,
                        'useNormalizedOHMUrl': True,
                    }
                },
            },
            {
                'name': 'release',
                'signingConfig': 'release',
                'compatibleSdkVersion': target,
                'targetSdkVersion': target,
                'runtimeOS': 'HarmonyOS',
                'buildOption': {
                    'strictMode': {
                        'caseSensitiveCheck': True,
                        'useNormalizedOHMUrl': True,
                    }
                },
            },
        ]
    }
}
config.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_PGYER_BUILD_PROFILE
  log "蒲公英兼容模式：隔离工作区的 targetSdkVersion 已固定为 $target_sdk"
}

prepare_harmony_pgyer_debug_signing() {
  local manifest
  manifest="$(workspace_manifest_path 2>/dev/null || true)"
  [ -f "$manifest" ] || die "manifest.json 不存在，无法准备蒲公英兼容签名"

  python3 - "$manifest" <<'PY_PGYER_DEBUG_SIGNING'
from pathlib import Path
import copy
import json
import sys

manifest = Path(sys.argv[1])
data = json.loads(manifest.read_text(encoding='utf-8'))
distribute = data.setdefault('app-harmony', {}).setdefault('distribute', {})
signing = distribute.setdefault('signingConfigs', {})
release_config = signing.get('release')
if not isinstance(release_config, dict) or not release_config:
    raise SystemExit('manifest 缺少 app-harmony.distribute.signingConfigs.release')
signing['default'] = copy.deepcopy(release_config)
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY_PGYER_DEBUG_SIGNING
  prepare_harmony_pgyer_build_profile
  log "蒲公英兼容模式：隔离工作区的 default 已映射到 Release signingConfig"
}

build_harmony_hap() {
  local build_root signed

  apply_harmony_version_override

  if [ "${HARMONY_BUILD_MODE:-release}" = "debug" ]; then
    if [ "${HARMONY_PACKAGE_KIND:-release}" = "release" ]; then
      prepare_harmony_manifest_signing
      materialize_harmony_signing_files
      prepare_harmony_pgyer_debug_signing
    fi
    # debug 构建用于本地侧载或蒲公英 17700015 兼容模式。
    if [ "${HARMONY_PGYER_COMPAT_PATCH:-}" = "PGYER-17700015" ]; then
      log "调用 HBuilderX debug 运行包流程（蒲公英兼容，使用 Release 签名）"
    else
      log "调用 HBuilderX debug 运行包流程（真机侧载，不安装）"
    fi
    if ! SEMAPHORE_PROGRESS=70 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" \
      SEMAPHORE_RUN_MESSAGE="HBuilderX 生成 debug HAP" \
      with_semaphore "hbuilderx" "${PARALLEL_MAX_HBULDERX_JOBS_RESOLVED:-1}" \
      run_with_timeout 1800 "$HBUILDERX_CLI" launch app-harmony \
      --project "$WORKSPACE" --buildType debug --compile true >>"$LOG_FILE" 2>&1; then
      tail -n 200 "$LOG_FILE" >&2 || true
      die "HBuilderX HarmonyOS debug 运行包生成失败"
    fi
    build_root="$WORKSPACE/unpackage/dist/dev/app-harmony"
  else
    prepare_harmony_manifest_signing
    materialize_harmony_signing_files
    if [ "${HARMONY_PGYER_COMPAT_PATCH:-}" = "PGYER-17700015" ]; then
      prepare_harmony_pgyer_build_profile
    fi
    log "调用 HBuilderX 本地打包 HarmonyOS（按 uni-app signingConfigs 签名）"
    if ! SEMAPHORE_PROGRESS=70 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" \
      SEMAPHORE_RUN_MESSAGE="HBuilderX 打包 HarmonyOS" \
      with_semaphore "hbuilderx" "${PARALLEL_MAX_HBULDERX_JOBS_RESOLVED:-1}" \
      run_with_timeout 1800 "$HBUILDERX_CLI" pack app-harmony --project "$WORKSPACE" >>"$LOG_FILE" 2>&1; then
      tail -n 200 "$LOG_FILE" >&2 || true
      die "HBuilderX HarmonyOS 本地打包失败"
    fi
    build_root="$WORKSPACE/unpackage/dist/build/app-harmony"
  fi

  [ -d "$build_root" ] || die "HBuilderX 未生成 HarmonyOS 工程目录: $build_root"
  signed="$(find "$build_root" -type f -name '*-signed.hap' -print -quit 2>/dev/null)"
  [ -n "$signed" ] && [ -f "$signed" ] || {
    tail -n 200 "$LOG_FILE" >&2 || true
    die "HBuilderX 未按 uni-app signingConfigs 生成 signed HAP: $build_root"
  }

  HAP_SRC="$signed"
  HARMONY_SIGNED="true"
  log "HarmonyOS 已按项目 signingConfigs 生成 HAP: $HAP_SRC"
}

verify_harmony_pgyer_compat_artifact() {
  [ "${HARMONY_PGYER_COMPAT_PATCH:-}" = "PGYER-17700015" ] || return 0
  [ -f "$HAP_FINAL" ] || die "蒲公英兼容校验失败：HAP 不存在: $HAP_FINAL"
  [ -f "$BUILD_INFO_FILE" ] || die "蒲公英兼容校验失败：build-info.json 不存在"

  HARMONY_EXPECTED_TARGET="${HARMONY_PGYER_TARGET_SDK_VERSION:-5.0.1(13)}" \
  HARMONY_EXPECTED_VERSION="${HARMONY_VERSION_CODE:-}" \
    python3 - "$HAP_FINAL" "$BUILD_INFO_FILE" <<'PY_HARMONY_PGYER_VERIFY'
from pathlib import Path
import json
import os
import re
import sys
import zipfile


def api_number(value):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)\((\d+)\)', value)
    if not match:
        raise ValueError(f'无法解析 targetSdkVersion: {value}')
    major, minor, patch, api = (int(item) for item in match.groups())
    return major * 10000000 + minor * 100000 + patch * 1000 + api

hap = Path(sys.argv[1])
info_file = Path(sys.argv[2])
with zipfile.ZipFile(hap) as archive:
    module = json.loads(archive.read('module.json'))
app = module.get('app', {})
info = json.loads(info_file.read_text(encoding='utf-8'))
expected_target = api_number(os.environ.get('HARMONY_EXPECTED_TARGET', '5.0.1(13)'))
expected_version = os.environ.get('HARMONY_EXPECTED_VERSION', '')
errors = []
if app.get('debug') is not False:
    errors.append(f"debug={app.get('debug')}，应为 false")
if app.get('buildMode') != 'release':
    errors.append(f"buildMode={app.get('buildMode')}，应为 release")
if app.get('targetAPIVersion') != expected_target:
    errors.append(f"targetAPIVersion={app.get('targetAPIVersion')}，应为 {expected_target}")
if info.get('package_kind') != 'release':
    errors.append(f"package_kind={info.get('package_kind')}，应为 release")
if info.get('harmony_profile_type') != 'release':
    errors.append(f"harmony_profile_type={info.get('harmony_profile_type')}，应为 release")
if info.get('harmony_profile_distribution') != 'internaltesting':
    errors.append(f"harmony_profile_distribution={info.get('harmony_profile_distribution')}，应为 internaltesting")
if int(info.get('harmony_profile_device_count') or 0) <= 0:
    errors.append('harmony_profile_device_count 必须大于 0')
if expected_version and str(app.get('versionCode')) != str(expected_version):
    errors.append(f"versionCode={app.get('versionCode')}，应为 {expected_version}")
if errors:
    print('蒲公英兼容校验失败:', file=sys.stderr)
    for item in errors:
        print(f'  - {item}', file=sys.stderr)
    raise SystemExit(1)
print(
    '蒲公英兼容校验通过: '
    f"versionCode={app.get('versionCode')} "
    f"targetAPIVersion={app.get('targetAPIVersion')} "
    f"profile={info.get('harmony_profile_type')}/{info.get('harmony_profile_distribution')} "
    f"device_count={info.get('harmony_profile_device_count')}"
)
PY_HARMONY_PGYER_VERIFY
}

collect_harmony_artifact() {
  local hap_sha info_file stamp version folder_name hap_suffix hap_name bundle_name
  local harmony_material="" harmony_p12="" harmony_alias="" harmony_cert="" harmony_profile=""
  local harmony_sign_alg="" harmony_store_password="" harmony_key_password=""
  local harmony_profile_meta="" harmony_profile_type="" harmony_profile_distribution=""
  local harmony_profile_device_count="0"
  local temporary_patch="${HARMONY_TEMP_PATCH_APPLIED:-}"
  local compatibility_patch="${HARMONY_PGYER_COMPAT_PATCH:-}"
  local harmony_build_mode="${HARMONY_BUILD_MODE:-release}"
  stamp="$(date '+%Y%m%d-%H%M%S')"
  version="${MARKETING_VERSION:-1.0.0}"
  folder_name="${PROJECT_ID}-${APP_ID}-${version}-${stamp}"
  BUILD_DIR="$PACKAGE_HARMONY_DIR/$folder_name"
  mkdir -p "$BUILD_DIR"

  bundle_name="$(harmony_bundle_name)"
  harmony_material="$(WORKSPACE="$WORKSPACE" harmony_signing_material 2>/dev/null || true)"
  if [ -n "$harmony_material" ]; then
    IFS=$'\t' read -r harmony_p12 harmony_alias harmony_cert harmony_profile \
      harmony_sign_alg harmony_store_password harmony_key_password <<<"$harmony_material"
    if [ -f "$harmony_profile" ]; then
      harmony_profile_meta="$(harmony_profile_upload_metadata "$harmony_profile" 2>/dev/null || true)"
      [ -n "$harmony_profile_meta" ] && IFS=$'\t' read -r harmony_profile_type \
        harmony_profile_distribution harmony_profile_device_count <<<"$harmony_profile_meta"
    fi
  fi
  hap_suffix="$([ "${HARMONY_SIGNED:-false}" = "true" ] && echo signed || echo unsigned)"
  [ "${HARMONY_PACKAGE_KIND:-release}" = "debug" ] && hap_suffix="$hap_suffix-install"
  hap_name="$folder_name-$hap_suffix.hap"
  HAP_FINAL="$BUILD_DIR/$hap_name"
  cp -f "$HAP_SRC" "$HAP_FINAL"
  hap_sha="$(shasum -a 256 "$HAP_FINAL" | awk '{print $1}')"
  info_file="$BUILD_DIR/build-info.json"

  local latest_base="${PROJECT_ID}-latest"
  [ "${HARMONY_PACKAGE_KIND:-release}" = "debug" ] && latest_base="${PROJECT_ID}-latest-install"
  ln -sfn "$folder_name" "$PACKAGE_HARMONY_DIR/$latest_base"
  ln -sfn "$folder_name/$hap_name" "$PACKAGE_HARMONY_DIR/$latest_base.hap"
  ln -sfn "$folder_name/build-info.json" "$PACKAGE_HARMONY_DIR/$latest_base.json"
  printf '%s\n' "$HAP_FINAL" > "$PACKAGE_HARMONY_DIR/$latest_base.path"

  node -e '
    const fs = require("fs");
    const [out, projectId, displayName, appId, bundleName, version, signed, packageKind, hap,
      harmonyP12, profilePath, profileType, profileDistribution, profileDeviceCount,
      temporaryPatch, compatibilityPatch, buildMode, sha256, builtAt] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({
      project_id: projectId,
      display_name: displayName,
      platform: "harmony",
      app_id: appId,
      bundle_name: bundleName,
      version: version,
      signed: signed === "true",
      package_kind: packageKind,
      hap_path: hap,
      harmony_p12_path: harmonyP12,
      harmony_profile_path: profilePath,
      harmony_profile_type: profileType,
      harmony_profile_distribution: profileDistribution,
      harmony_profile_device_count: Number(profileDeviceCount || 0),
      temporary_patch: temporaryPatch,
      compatibility_patch: compatibilityPatch,
      build_mode: buildMode,
      hap_sha256: sha256,
      built_at: builtAt
    }, null, 2) + "\n");
  ' "$info_file" "$PROJECT_ID" "$DISPLAY_NAME" "$APP_ID" "$bundle_name" "$version" \
    "${HARMONY_SIGNED:-false}" "${HARMONY_PACKAGE_KIND:-release}" "$HAP_FINAL" \
    "$harmony_p12" "$harmony_profile" "$harmony_profile_type" \
    "$harmony_profile_distribution" "${harmony_profile_device_count:-0}" \
    "$temporary_patch" "$compatibility_patch" "$harmony_build_mode" "$hap_sha" "$BUILD_STARTED_AT"

  BUILD_INFO_FILE="$info_file"
  prune_harmony_build_dirs
}

prune_harmony_build_dirs() {
  [ -d "$PACKAGE_HARMONY_DIR" ] || return 0
  local count=0 dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    count=$((count + 1))
    if [ "$count" -gt "${KEEP_BUILD_COUNT:-5}" ]; then
      rm -rf "$dir"
    fi
  done < <(find "$PACKAGE_HARMONY_DIR" -mindepth 1 -maxdepth 1 -type d \
    -name "${PROJECT_ID}-*" -print0 | xargs -0 ls -dt 2>/dev/null)
}

prune_harmony_outputs() {
  if [ -n "${BUILD_DIR:-}" ] && [ -d "$BUILD_DIR" ] && [ -f "$LOG_FILE" ]; then
    cp -f "$LOG_FILE" "$BUILD_DIR/build.log"
  fi
  prune_logs
}

print_harmony_result() {
  local latest_base="${PROJECT_ID}-latest"
  [ "${HARMONY_PACKAGE_KIND:-release}" = "debug" ] && latest_base="${PROJECT_ID}-latest-install"
  local latest="$PACKAGE_HARMONY_DIR/$latest_base.hap"
  printf '\n'
  printf '========== HAP READY ==========\n'
  printf 'PROJECT=%s\n' "$PROJECT_ID"
  printf 'DISPLAY_NAME=%s\n' "$DISPLAY_NAME"
  printf 'VERSION=%s\n' "${MARKETING_VERSION:-unknown}"
  printf 'SIGNED=%s\n' "${HARMONY_SIGNED:-false}"
  printf 'PACKAGE_KIND=%s\n' "${HARMONY_PACKAGE_KIND:-release}"
  if should_show_build_paths; then
    printf 'HAP_PATH=%s\n' "$HAP_FINAL"
    printf 'HAP_FILE_URL=file://%s\n' "$HAP_FINAL"
    printf 'LATEST_HAP=%s\n' "$latest"
    printf 'LATEST_BUILD=%s\n' "$PACKAGE_HARMONY_DIR/$latest_base"
    printf 'BUILD_DIR=%s\n' "$BUILD_DIR"
    printf 'BUILD_INFO=%s\n' "${BUILD_INFO_FILE:-}"
  fi
  printf 'LOG=%s\n' "$LOG_FILE"
  if [ "${HARMONY_SIGNED:-false}" != "true" ]; then
    printf 'WARN=当前为 unsigned HAP，请配置 HarmonyOS p12 密码后重新签名/打包\n'
  fi
  printf 'TIP=需要局域网下载时运行: %s/serve-packages.sh\n' "$PIPELINE_ROOT"
}

collect_android_artifact() {
  local apk_sha source_commit info_file stamp version folder_name apk_name
  stamp="$(date '+%Y%m%d-%H%M%S')"
  version="${MARKETING_VERSION:-1.0.0}"
  folder_name="${PROJECT_ID}-${APP_ID}-${version}-${stamp}"
  BUILD_DIR="$PACKAGE_ANDROID_DIR/$folder_name"
  mkdir -p "$BUILD_DIR"

  apk_name="$folder_name-release.apk"
  APK_FINAL="$BUILD_DIR/$apk_name"
  cp -f "$APK_SRC" "$APK_FINAL"
  apk_sha="$(shasum -a 256 "$APK_FINAL" | awk '{print $1}')"
  source_commit="local"
  info_file="$BUILD_DIR/build-info.json"

  ln -sfn "$folder_name" "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest"
  ln -sfn "$folder_name/$apk_name" "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest.apk"
  ln -sfn "$folder_name/build-info.json" "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest.json"
  printf '%s\n' "$APK_FINAL" > "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest.path"

  node -e '
    const fs = require("fs");
    const [out, projectId, displayName, appId, applicationId, version, apk,
      sha256, sourceCommit, signingMode, signingFingerprint, builtAt] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({
      project_id: projectId,
      display_name: displayName,
      platform: "android",
      app_id: appId,
      application_id: applicationId,
      version: version,
      apk_path: apk,
      apk_sha256: sha256,
      source_commit: sourceCommit,
      android_signing_mode: signingMode,
      android_signing_sha256: signingFingerprint,
      built_at: builtAt
    }, null, 2) + "\n");
  ' "$info_file" "$PROJECT_ID" "$DISPLAY_NAME" "$APP_ID" \
    "${ANDROID_APPLICATION_ID:-}" "$version" "$APK_FINAL" "$apk_sha" "$source_commit" \
    "${ANDROID_SIGNING_MODE:-project-signing}" "${ANDROID_SIGNING_FINGERPRINT:-}" "$BUILD_STARTED_AT"

  BUILD_INFO_FILE="$info_file"
  prune_android_build_dirs
}

prune_android_build_dirs() {
  [ -d "$PACKAGE_ANDROID_DIR" ] || return 0
  local count=0 dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    count=$((count + 1))
    if [ "$count" -gt "${KEEP_BUILD_COUNT:-5}" ]; then
      rm -rf "$dir"
    fi
  done < <(find "$PACKAGE_ANDROID_DIR" -mindepth 1 -maxdepth 1 -type d \
    -name "${PROJECT_ID}-*" -print0 | xargs -0 ls -dt 2>/dev/null)
}

prune_android_outputs() {
  if [ -n "${BUILD_DIR:-}" ] && [ -d "$BUILD_DIR" ] && [ -f "$LOG_FILE" ]; then
    cp -f "$LOG_FILE" "$BUILD_DIR/build.log"
  fi
  rm -rf "$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/.gradle" \
    "$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/app/build" \
    "$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/build" \
    "$WORKSPACE/${ANDROID_MODULE_DIR:-app-android}/local.properties"
  prune_logs
}

print_android_result() {
  local latest="$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest.apk"
  printf '\n'
  printf '========== APK READY ==========\n'
  printf 'PROJECT=%s\n' "$PROJECT_ID"
  printf 'DISPLAY_NAME=%s\n' "$DISPLAY_NAME"
  printf 'VERSION=%s\n' "${MARKETING_VERSION:-unknown}"
  if should_show_build_paths; then
    printf 'APK_PATH=%s\n' "$APK_FINAL"
    printf 'APK_FILE_URL=file://%s\n' "$APK_FINAL"
    printf 'LATEST_APK=%s\n' "$latest"
    printf 'LATEST_BUILD=%s\n' "$PACKAGE_ANDROID_DIR/${PROJECT_ID}-latest"
    printf 'BUILD_DIR=%s\n' "$BUILD_DIR"
    printf 'BUILD_INFO=%s\n' "${BUILD_INFO_FILE:-}"
  fi
  printf 'ANDROID_SIGNING=%s\n' "${ANDROID_SIGNING_MODE:-project-signing}"
  printf 'ANDROID_SIGNING_SHA256=%s\n' "${ANDROID_SIGNING_FINGERPRINT:-}"
  printf 'LOG=%s\n' "$LOG_FILE"
  if [ "${ANDROID_SIGNING_MODE:-project-signing}" != "release-keystore" ]; then
    printf 'WARN=当前 APK 使用业务项目内签名配置（通常为 debug keystore），不能作为正式发布包\n'
  fi
  printf 'TIP=需要局域网下载时运行: %s/serve-packages.sh\n' "$PIPELINE_ROOT"
}

manifest_version() {
  local manifest="$1"
  sed -n 's/.*"versionName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1
}

collect_artifact() {
  local ipa_sha source_commit app_ios_commit info_file stamp version folder_name ipa_name
  stamp="$(date '+%Y%m%d-%H%M%S')"
  version="${MARKETING_VERSION:-1.0.0}"
  folder_name="${PROJECT_ID}-${APP_ID}-${version}-${stamp}"
  BUILD_DIR="$PACKAGE_IOS_DIR/$folder_name"
  mkdir -p "$BUILD_DIR"

  ipa_name="$folder_name-$PACKAGE_KIND.ipa"
  IPA_FINAL="$BUILD_DIR/$ipa_name"
  cp -f "$IPA_SRC" "$IPA_FINAL"

  ipa_sha="$(shasum -a 256 "$IPA_FINAL" | awk '{print $1}')"
  source_commit="local"
  app_ios_commit="$APP_IOS_RESOLVED_REF"
  info_file="$BUILD_DIR/build-info.json"

  ln -sfn "$folder_name" "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest"
  ln -sfn "$folder_name/$ipa_name" "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest.ipa"
  ln -sfn "$folder_name/build-info.json" "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest.json"
  printf '%s\n' "$IPA_FINAL" > "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest.path"

  node -e '
    const fs = require("fs");
    const [out, projectId, displayName, appId, bundleId, version, teamId,
      profileName, profileUuid, profileExpiry, signingCertificate, ipa,
      sha256, sourceCommit, appIosCommit, buildStartedAt] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({
      project_id: projectId,
      display_name: displayName,
      app_id: appId,
      bundle_id: bundleId,
      version: version,
      team_id: teamId,
      profile_name: profileName,
      profile_uuid: profileUuid,
      profile_expires_at: profileExpiry,
      signing_certificate: signingCertificate,
      ipa_path: ipa,
      ipa_sha256: sha256,
      source_commit: sourceCommit,
      app_ios_commit: appIosCommit,
      built_at: buildStartedAt
    }, null, 2) + "\n");
  ' "$info_file" "$PROJECT_ID" "$DISPLAY_NAME" "$APP_ID" "$BUNDLE_ID" \
    "$version" "$TEAM_ID" "$PROFILE_NAME" "$PROFILE_UUID" "$PROFILE_EXPIRY" \
    "$SIGNING_CERTIFICATE" "$IPA_FINAL" "$ipa_sha" "$source_commit" "$app_ios_commit" "$BUILD_STARTED_AT"

  BUILD_INFO_FILE="$info_file"
  prune_build_dirs
}

prune_build_dirs() {
  [ -d "$PACKAGE_IOS_DIR" ] || return 0
  local count=0 dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    count=$((count + 1))
    if [ "$count" -gt "${KEEP_BUILD_COUNT:-5}" ]; then
      rm -rf "$dir"
    fi
  done < <(find "$PACKAGE_IOS_DIR" -mindepth 1 -maxdepth 1 -type d \
    -name "${PROJECT_ID}-*" -print0 | xargs -0 ls -dt 2>/dev/null)
}

prune_logs() {
  local project_log_root="$LOG_ROOT/$PROJECT_ID"
  [ -d "$project_log_root" ] || return 0
  local count=0 dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    count=$((count + 1))
    if [ "$count" -gt "${KEEP_LOG_COUNT:-5}" ]; then
      rm -rf "$dir"
    fi
  done < <(find "$project_log_root" -mindepth 1 -maxdepth 1 -type d -print0 | xargs -0 ls -dt 2>/dev/null)

  find "$project_log_root" -mindepth 2 -maxdepth 2 -type d \
    \( -name native-output -o -name native-sdk \) -exec rm -rf {} + 2>/dev/null || true
}

prune_outputs() {
  if [ -n "${BUILD_DIR:-}" ] && [ -d "$BUILD_DIR" ] && [ -f "$LOG_FILE" ]; then
    cp -f "$LOG_FILE" "$BUILD_DIR/build.log"
  fi
  rm -rf "$RUN_DIR/native-output" "$RUN_DIR/native-sdk"
  prune_logs
}

print_result() {
  local latest="$PACKAGE_IOS_DIR/${PROJECT_ID}-latest.ipa"
  printf '\n'
  printf '========== IPA READY ==========\n'
  printf 'PROJECT=%s\n' "$PROJECT_ID"
  printf 'DISPLAY_NAME=%s\n' "$DISPLAY_NAME"
  printf 'VERSION=%s\n' "${MARKETING_VERSION:-unknown}"
  if should_show_build_paths; then
    printf 'IPA_PATH=%s\n' "$IPA_FINAL"
    printf 'IPA_FILE_URL=file://%s\n' "$IPA_FINAL"
    printf 'LATEST_IPA=%s\n' "$latest"
    printf 'LATEST_BUILD=%s\n' "$PACKAGE_IOS_DIR/${PROJECT_ID}-latest"
    printf 'BUILD_DIR=%s\n' "$BUILD_DIR"
    printf 'BUILD_INFO=%s\n' "${BUILD_INFO_FILE:-}"
  fi
  printf 'LOG=%s\n' "$LOG_FILE"

  if [ -n "${PUBLISH_DIR:-}" ]; then
    mkdir -p "$PUBLISH_DIR/$PROJECT_ID"
    cp -f "$IPA_FINAL" "$PUBLISH_DIR/$PROJECT_ID/latest.ipa"
    if should_show_build_paths; then
      printf 'PUBLISHED_IPA=%s\n' "$PUBLISH_DIR/$PROJECT_ID/latest.ipa"
      if [ -n "${PUBLIC_BASE_URL:-}" ]; then
        printf 'DOWNLOAD_URL=%s/%s/latest.ipa\n' "${PUBLIC_BASE_URL%/}" "$PROJECT_ID"
      fi
    fi
  elif [ -n "${PUBLIC_BASE_URL:-}" ]; then
    warn "配置了 PUBLIC_BASE_URL 但没有 PUBLISH_DIR，未复制可下载文件"
  fi

  printf 'TIP=需要局域网下载时运行: %s/serve-packages.sh\n' "$PIPELINE_ROOT"
}
