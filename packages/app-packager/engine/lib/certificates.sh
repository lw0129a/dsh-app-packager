if ! declare -F title >/dev/null 2>&1; then
  title() {
    printf '\n========================================\n'
    printf ' %s\n' "$1"
    printf '========================================\n'
  }
fi

print_result_list() {
  local title="$1"
  shift
  printf '\n%s:\n' "$title"
  if [ "$#" -eq 0 ]; then
    printf '  无\n'
    return 0
  fi
  local item
  for item in "$@"; do
    printf '  - %s\n' "$item"
  done
}

certificate_platform_name() {
  case "$1" in
    ios) printf '%s\n' 'iOS' ;;
    android) printf '%s\n' 'Android' ;;
    harmony) printf '%s\n' 'HarmonyOS' ;;
    *) return 1 ;;
  esac
}

cert_ios_dir() { printf '%s\n' "$PIPELINE_ROOT/certificates/iOS"; }
cert_android_dir() { printf '%s\n' "$PIPELINE_ROOT/certificates/Android"; }
cert_harmony_dir() { printf '%s\n' "$PIPELINE_ROOT/certificates/HarmonyOS"; }

cert_ios_ready() {
  local dir="${1:-}" p12 profile
  dir="${dir:-$(cert_ios_dir)}"
  p12="$(find "$dir" "$PIPELINE_ROOT/signing/current" -maxdepth 4 -type f \( -iname '*.p12' -o -iname '*.pfx' \) -print -quit 2>/dev/null)"
  profile="$(find "$dir" "$PIPELINE_ROOT/signing/current" -maxdepth 4 -type f -iname '*.mobileprovision' -print -quit 2>/dev/null)"
  [ -n "$p12" ] && [ -n "$profile" ]
}

cert_android_ready() {
  local dir="${1:-}" keystore properties
  dir="${dir:-$(cert_android_dir)}"
  keystore="$(find "$dir" -maxdepth 4 -type f \( -iname '*.keystore' -o -iname '*.jks' \) -print -quit 2>/dev/null)"
  properties="$(find "$dir" -maxdepth 4 -type f -iname 'keystore.properties' -print -quit 2>/dev/null)"
  [ -n "$keystore" ] && [ -n "$properties" ]
}

directory_has_file_type() {
  local dir="$1" extension="$2"
  [ -n "$(find "$dir" -maxdepth 1 -type f -iname "*.${extension}" -print -quit 2>/dev/null)" ]
}

cert_harmony_ready() {
  local dir="${1:-}" bundle_dir project_file
  dir="${dir:-$(cert_harmony_dir)}"

  while IFS= read -r bundle_dir; do
    [ -n "$bundle_dir" ] || continue
    if { directory_has_file_type "$bundle_dir" p12 || directory_has_file_type "$bundle_dir" pfx; } && \
      directory_has_file_type "$bundle_dir" cer && \
      directory_has_file_type "$bundle_dir" p7b; then
      return 0
    fi
  done < <(find "$dir" -maxdepth 3 -type f -iname '*.p7b' -exec dirname {} \; 2>/dev/null | sort -u)

  for project_file in "$PIPELINE_ROOT"/config/projects/*.env; do
    [ -f "$project_file" ] || continue
    if (
      set +u
      # shellcheck source=/dev/null
      source "$project_file" >/dev/null 2>&1 || exit 1
      WORKSPACE="${SOURCE_DIR:-}" harmony_signing_material >/dev/null 2>&1
    ); then
      return 0
    fi
  done

  return 1
}

show_certificate_status() {
  local missing=0
  if ! cert_ios_ready; then
    printf '\033[1;33m  [警告]\033[0m iOS 证书不完整（需要 p12 + mobileprovision）\n'
    printf '         UniApp 官方文档: https://ask.dcloud.net.cn/article/152\n'
    missing=1
  fi
  if ! cert_android_ready; then
    printf '\033[1;33m  [警告]\033[0m 未配置 Android release keystore，将沿用项目内测试签名\n'
    printf '         UniApp 官方文档: https://ask.dcloud.net.cn/article/35777\n'
    missing=1
  fi
  if ! cert_harmony_ready; then
    printf '\033[1;33m  [警告]\033[0m HarmonyOS 证书不完整（需要 p12 + cer + p7b）\n'
    printf '         UniApp 官方文档: https://doc.dcloud.net.cn/uni-app-x/tutorial/runbuild.html#signing-configs\n'
    missing=1
  fi
  if [ "$missing" -eq 0 ]; then
    printf '\033[1;32m  [证书状态]\033[0m 正常\n'
  fi
}

report_harmony_profiles() {
  python3 - "$(cert_harmony_dir)" <<'PY_HARMONY_PROFILE_INDEX'
from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
rows = []
for profile in sorted(root.rglob('*.p7b')):
    try:
        text = profile.read_text(encoding='utf-8', errors='ignore')
        start = text.find('{')
        if start < 0:
            continue
        data, _ = json.JSONDecoder().raw_decode(text[start:])
    except Exception:
        continue
    bundle = data.get('bundle-info', {}).get('bundle-name', '') if isinstance(data.get('bundle-info'), dict) else ''
    profile_type = data.get('type', '')
    if bundle:
        rows.append((str(profile.relative_to(root)), str(profile_type), str(bundle)))

if not rows:
    raise SystemExit(0)
print('HarmonyOS Profile 索引:')
for path, profile_type, bundle in rows:
    print(f'  - {path} [{profile_type}] -> {bundle}')
PY_HARMONY_PROFILE_INDEX
}

ios_profile_bundle_id() {
  local profile_file="$1" plist app_identifier
  plist="$(mktemp)"
  if ! openssl smime -verify -inform DER -in "$profile_file" -noverify -out "$plist" >/dev/null 2>&1; then
    rm -f "$plist"
    return 1
  fi
  app_identifier="$(plutil -extract Entitlements.application-identifier raw -o - "$plist" 2>/dev/null || true)"
  rm -f "$plist"
  [ -n "$app_identifier" ] || return 1
  printf '%s\n' "${app_identifier#*.}"
}

harmony_profile_metadata() {
  local profile_file="$1"
  python3 - "$profile_file" <<'PY_HARMONY_PROFILE_METADATA'
from pathlib import Path
import json
import sys
try:
    text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore')
    start = text.find('{')
    data, _ = json.JSONDecoder().raw_decode(text[start:])
    bundle = data.get('bundle-info', {}).get('bundle-name', '') if isinstance(data.get('bundle-info'), dict) else ''
    profile_type = str(data.get('type', 'release') or 'release')
except Exception:
    raise SystemExit(1)
if not bundle:
    raise SystemExit(1)
print(bundle + '\t' + profile_type)
PY_HARMONY_PROFILE_METADATA
}

canonical_certificate_name() {
  local file="$1" platform="$2" base lower bundle profile_type canonical
  base="$(basename "$file")"
  lower="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')"
  case "$platform" in
    ios)
      case "$lower" in
        *.mobileprovision)
          bundle="$(ios_profile_bundle_id "$file" || true)"
          [ -n "$bundle" ] || return 1
          canonical="${bundle}.mobileprovision"
          ;;
        *.p12) canonical="ios-signing.p12" ;;
        *.pfx) canonical="ios-signing.pfx" ;;
      esac
      ;;
    android)
      case "$lower" in
        *.keystore) canonical="release.keystore" ;;
        *.jks) canonical="release.jks" ;;
        keystore.properties) canonical="keystore.properties" ;;
      esac
      ;;
    harmony)
      case "$lower" in
        *.p7b)
          local metadata
          metadata="$(harmony_profile_metadata "$file" || true)"
          [ -n "$metadata" ] || return 1
          IFS=$'\t' read -r bundle profile_type <<<"$metadata"
          canonical="${bundle}.${profile_type}.p7b"
          ;;
        *.p12) canonical="release.p12" ;;
        *.pfx) canonical="release.pfx" ;;
        *.cer)
          case "$lower" in
            *dev*|*debug*) canonical="dev.cer" ;;
            *) canonical="release.cer" ;;
          esac
          ;;
      esac
      ;;
  esac
  [ -n "$canonical" ] || return 1
  printf '%s\n' "$canonical"
}

find_identical_file() {
  local root="$1" source_file="$2" candidate source_name candidate_name
  source_name="$(basename "$source_file")"
  while IFS= read -r candidate; do
    candidate_name="$(basename "$candidate")"
    [ "$candidate_name" = "$source_name" ] || continue
    if cmp -s "$source_file" "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(find "$root" -maxdepth 4 -type f -print 2>/dev/null)
  return 1
}

snapshot_has_file_type() {
  local snapshot="$1" target_dir="$2" extension="$3" file
  while IFS= read -r file; do
    [ "$(dirname "$file")" = "$target_dir" ] || continue
    case "$(basename "$file" | tr '[:upper:]' '[:lower:]')" in
      *."$extension") return 0 ;;
    esac
  done <"$snapshot"
  return 1
}

copy_certificate_atomically() {
  local source_file="$1" target_file="$2" staged_file
  staged_file="$(mktemp "${target_file}.tmp.XXXXXX")" || return 1
  if ! cp -p "$source_file" "$staged_file"; then
    rm -f "$staged_file"
    return 1
  fi
  mv -f "$staged_file" "$target_file"
}

process_certificate_file() {
  local file="$1" source_root="$2" snapshot="$3"
  local base source_dir target_root platform target_name target history_file history_dir
  local has_p7b=0 has_profile=0 action="新增"

  [ -f "$file" ] || return 0
  [ -r "$file" ] || { unreadable+=("$file"); return 0; }

  base="$(basename "$file" | tr '[:upper:]' '[:lower:]')"
  source_dir="$(dirname "$file")"
  snapshot_has_file_type "$snapshot" "$source_dir" p7b && has_p7b=1
  snapshot_has_file_type "$snapshot" "$source_dir" mobileprovision && has_profile=1

  case "$base" in
    *.mobileprovision) platform="ios" ;;
    *.keystore|*.jks|keystore.properties) platform="android" ;;
    *.p7b) platform="harmony" ;;
    *.p12|*.pfx)
      if [ -n "$(find_identical_file "$(cert_ios_dir)" "$file" || true)" ]; then
        platform="ios"
      elif [ -n "$(find_identical_file "$(cert_harmony_dir)" "$file" || true)" ]; then
        platform="harmony"
      else
        case "$base" in
          *harmony*|*ohos*) platform="harmony" ;;
          *ios*|*apple*|*distribution*|*development*) platform="ios" ;;
          *release*|*debug*)
            if [ "$has_p7b" -eq 1 ]; then platform="harmony"; else platform="ios"; fi
            ;;
          *)
          if [ "$has_p7b" -eq 1 ] && [ "$has_profile" -eq 0 ]; then
            platform="harmony"
          elif [ "$has_profile" -eq 1 ] && [ "$has_p7b" -eq 0 ]; then
            platform="ios"
          else
            abnormal+=("p12 平台不明确: $file")
            return 0
          fi
          ;;
        esac
      fi
      ;;
    *.cer)
      case "$base" in
        *harmony*|*ohos*) platform="harmony" ;;
        *)
          if [ "$has_p7b" -eq 1 ]; then
            platform="harmony"
          else
            abnormal+=("cer 平台不明确: $file")
            return 0
          fi
          ;;
      esac
      ;;
    *) return 0 ;;
  esac

  case "$platform" in
    ios) target_root="$(cert_ios_dir)" ;;
    android) target_root="$(cert_android_dir)" ;;
    harmony) target_root="$(cert_harmony_dir)" ;;
  esac

  if [ "$platform" = "android" ] && [ "$base" = "keystore.properties" ]; then
    local keystore_name="release.keystore"
    snapshot_has_file_type "$source_dir" jks && keystore_name="release.jks"
    snapshot_has_file_type "$source_dir" keystore && keystore_name="release.keystore"
    python3 - "$file" "$keystore_name" <<'PY_NORMALIZE_KEYSTORE_PROPERTIES'
from pathlib import Path
import re
import sys
path = Path(sys.argv[1])
keystore_name = sys.argv[2]
text = path.read_text(encoding='utf-8', errors='ignore')
if re.search(r'^\s*storeFile\s*[:=]', text, flags=re.M):
    text, count = re.subn(r'^\s*storeFile\s*[:=].*$', f'storeFile={keystore_name}', text, count=1, flags=re.M)
else:
    text = f'storeFile={keystore_name}\n' + text
path.write_text(text, encoding='utf-8')
PY_NORMALIZE_KEYSTORE_PROPERTIES
  fi

  target_name="$(canonical_certificate_name "$file" "$platform" || true)"
  if [ -z "$target_name" ]; then
    abnormal+=("无法解析证书元数据: $file")
    return 0
  fi
  target="$target_root/$target_name"

  if [ -e "$target" ]; then
    if cmp -s "$file" "$target"; then
      success+=("未变化（来源保留）: $file -> $target")
      return 0
    fi
    if [ -n "${CERT_SEEN_FILE:-}" ] && grep -Fxq "$target" "$CERT_SEEN_FILE" 2>/dev/null; then
      abnormal+=("同一批次存在多个不同内容的候选文件: $target")
      return 0
    fi
    [ -n "${CERT_SEEN_FILE:-}" ] && printf '%s\n' "$target" >>"$CERT_SEEN_FILE"
    history_dir="${CERT_HISTORY_RUN:-$LOG_ROOT/certificate-history}/$platform"
    mkdir -p "$history_dir"
    history_file="$history_dir/$(basename "$target")"
    if [ -e "$history_file" ]; then
      history_file="$history_dir/$(date '+%Y%m%d%H%M%S')-$(basename "$target")"
    fi
    mv -f "$target" "$history_file"
    action="更新"
  else
    if [ -n "${CERT_SEEN_FILE:-}" ] && grep -Fxq "$target" "$CERT_SEEN_FILE" 2>/dev/null; then
      abnormal+=("同一批次存在多个不同内容的候选文件: $target")
      return 0
    fi
    [ -n "${CERT_SEEN_FILE:-}" ] && printf '%s\n' "$target" >>"$CERT_SEEN_FILE"
  fi

  if ! copy_certificate_atomically "$file" "$target"; then
    failure+=("复制失败，来源保留: $file")
    return 0
  fi
  success+=("${action}（来源保留）: $file -> $target")
  processed=$((processed + 1))
}

process_certificate_source() {
  local source="$1" resolved file snapshot cert_root="$PIPELINE_ROOT/certificates"
  resolved="$(absolute_dir "$source" 2>/dev/null || true)"
  [ -n "$resolved" ] || { abnormal+=("证书目录不存在: $source"); return 0; }

  case "$resolved" in
    "$(cert_ios_dir)"|"$(cert_android_dir)"|"$(cert_harmony_dir)")
      return 0
      ;;
  esac

  snapshot="$(mktemp)"
  find "$resolved" -maxdepth 4 -type f \
    \( -iname '*.mobileprovision' -o -iname '*.keystore' -o -iname '*.jks' \
       -o -iname '*.p7b' -o -iname '*.p12' -o -iname '*.pfx' -o -iname '*.cer' \
       -o -iname 'keystore.properties' \) -print 2>/dev/null >"$snapshot"

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      "$cert_root"/iOS/*|"$cert_root"/Android/*|"$cert_root"/HarmonyOS/*) continue ;;
    esac
    process_certificate_file "$file" "$resolved" "$snapshot"
  done <"$snapshot"
  rm -f "$snapshot"
}

process_certificates_root() {
  title "处理证书目录"
  mkdir -p "$(cert_ios_dir)" "$(cert_android_dir)" "$(cert_harmony_dir)" "$LOG_ROOT/certificate-history"
  local source processed=0
  local -a success=() abnormal=() failure=() unreadable=() sources=()
  CERT_HISTORY_RUN="$LOG_ROOT/certificate-history/$(date '+%Y%m%d-%H%M%S')"
  CERT_SEEN_FILE="$(mktemp)"

  if [ "$#" -gt 0 ]; then
    sources=("$@")
  else
    sources=("$PIPELINE_ROOT/certificates")
  fi

  for source in "${sources[@]}"; do
    process_certificate_source "$source"
  done

  # 证书根目录下不允许保留来源文件夹，导入完成后清理；外部给定目录不删除。
  for source in "${sources[@]}"; do
    source="$(absolute_dir "$source" 2>/dev/null || true)"
    [ -n "$source" ] || continue
    case "$source" in
      "$PIPELINE_ROOT/certificates"|"$(cert_ios_dir)"|"$(cert_android_dir)"|"$(cert_harmony_dir)") continue ;;
      "$PIPELINE_ROOT/certificates"/*) rm -rf "$source" ;;
    esac
  done

  rm -f "${CERT_SEEN_FILE:-}"

  printf '\n平台目录:\n'
  printf '  iOS:       %s\n' "$(cert_ios_dir)"
  printf '  Android:   %s\n' "$(cert_android_dir)"
  printf '  HarmonyOS: %s\n' "$(cert_harmony_dir)"
  printf '  历史备份:  %s\n' "$CERT_HISTORY_RUN"

  if ! cert_ios_ready; then abnormal+=("iOS 证书不完整"); fi
  if ! cert_android_ready; then abnormal+=("未配置 Android release keystore，将沿用项目内测试签名"); fi
  if ! cert_harmony_ready; then abnormal+=("HarmonyOS 证书不完整"); fi

  if [ "${#success[@]}" -eq 0 ]; then print_result_list "成功"; else print_result_list "成功" "${success[@]}"; fi
  if [ "${#abnormal[@]}" -eq 0 ]; then print_result_list "异常"; else print_result_list "异常" "${abnormal[@]}"; fi
  if [ "${#failure[@]}" -eq 0 ]; then print_result_list "失败"; else print_result_list "失败" "${failure[@]}"; fi
  if [ "${#unreadable[@]}" -eq 0 ]; then print_result_list "无法读取"; else print_result_list "无法读取" "${unreadable[@]}"; fi

  printf '\n当前证书状态:\n'
  show_certificate_status
  printf '\n'
  report_harmony_profiles
  printf '\nUniApp 官方证书创建文档:\n'
  printf '  iOS:      https://ask.dcloud.net.cn/article/152\n'
  printf '  Android:  https://ask.dcloud.net.cn/article/35777\n'
  printf '  HarmonyOS: https://doc.dcloud.net.cn/uni-app-x/tutorial/runbuild.html#signing-configs\n'
}
