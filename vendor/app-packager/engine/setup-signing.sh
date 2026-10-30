#!/usr/bin/env bash
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINE_ROOT
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/lib/common.sh"
# shellcheck source=/dev/null
source "$PIPELINE_ROOT/config/settings.env"
# shellcheck source=/dev/null
[ -f "$PIPELINE_ROOT/config/settings.local.env" ] && source "$PIPELINE_ROOT/config/settings.local.env"

P12_SOURCE=""
SKIP_PASSWORD=0
PROFILE_SPECS=()

usage() {
  cat <<'USAGE'
AppPackager 更新打包签名文件

用法:
  ./setup-signing.sh --p12 <证书.p12> \
    --profile <项目ID>=<项目.mobileprovision> \
    --profile <另一个项目ID>=<另一个项目.mobileprovision>

选项:
  --p12 <path>          更新共享 p12 证书
  --profile <项目ID>=<path>  更新指定项目的 mobileprovision
  --skip-password       不更新 Keychain 中的 p12 密码
  -h, --help            查看帮助

说明:
  证书和 Profile 只复制到 打包工具/signing/current，
  不修改任何业务项目。
USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --p12)
        [ "$#" -ge 2 ] || die "--p12 缺少参数"
        P12_SOURCE="$2"; shift 2 ;;
      --profile)
        [ "$#" -ge 2 ] || die "--profile 缺少参数"
        PROFILE_SPECS+=("$2"); shift 2 ;;
      --skip-password) SKIP_PASSWORD=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
}

update_profile() {
  local spec="$1"
  local id="${spec%%=*}"
  local src="${spec#*=}"
  local project_file plist expected_bundle expected_team
  [ "$id" != "$spec" ] || die "--profile 格式应为 id=路径: $spec"
  project_file="$PIPELINE_ROOT/config/projects/$id.env"
  [ -f "$project_file" ] || die "未知项目: $id"
  [ -f "$src" ] || die "Profile 不存在: $src"

  expected_bundle="$(
    unset EXPECTED_BUNDLE_ID
    # shellcheck disable=SC1090
    source "$project_file" >/dev/null 2>&1 || exit 1
    printf '%s' "${EXPECTED_BUNDLE_ID:-}"
  )"
  expected_team="$(
    unset EXPECTED_TEAM_ID
    # shellcheck disable=SC1090
    source "$project_file" >/dev/null 2>&1 || exit 1
    printf '%s' "${EXPECTED_TEAM_ID:-}"
  )"

  plist="$(mktemp)"
  EXPECTED_BUNDLE_ID="$expected_bundle"
  EXPECTED_TEAM_ID="$expected_team"
  if ! read_profile_metadata "$src" "$plist" >/dev/null 2>&1; then
    rm -f "$plist"
    die "Profile 解析失败或与项目不匹配: $src"
  fi
  rm -f "$plist"

  cp -f "$src" "$SIGNING_ROOT/$id.mobileprovision"
  chmod 600 "$SIGNING_ROOT/$id.mobileprovision"

  printf '[OK] %s Profile: %s\n' "$id" "$PROFILE_NAME"
  printf '     Bundle: %s\n' "$BUNDLE_ID"
  printf '     Team:   %s\n' "$TEAM_ID"
  printf '     Type:   %s\n' "$PROFILE_KIND"
  printf '     Expiry: %s\n' "$PROFILE_EXPIRY"
}

project_has_explicit_profile() {
  local id="$1" spec
  for spec in "${PROFILE_SPECS[@]-}"; do
    [ "${spec%%=*}" = "$id" ] && return 0
  done
  return 1
}

read_profile_bundle_id() {
  local profile_file="$1" plist bundle app_identifier
  plist="$(mktemp)"
  if ! openssl smime -verify -inform DER -in "$profile_file" -noverify -out "$plist" >/dev/null 2>&1; then
    rm -f "$plist"
    return 1
  fi
  app_identifier="$(plutil -extract Entitlements.application-identifier raw -o - "$plist" 2>/dev/null || true)"
  rm -f "$plist"
  [ -n "$app_identifier" ] || return 1
  bundle="${app_identifier#*.}"
  printf '%s\n' "$bundle"
}

discover_default_profiles() {
  local project_file project_id expected_bundle profile_file profile_bundle
  [ -d "$PIPELINE_ROOT/config/projects" ] || return 0

  for project_file in "$PIPELINE_ROOT"/config/projects/*.env; do
    [ -f "$project_file" ] || continue
    project_id="$(basename "$project_file" .env)"
    project_has_explicit_profile "$project_id" && continue

    profile_file="$(cert_ios_dir)/${project_id}.mobileprovision"
    if [ -f "$profile_file" ]; then
      PROFILE_SPECS+=("${project_id}=${profile_file}")
      continue
    fi

    expected_bundle="$(
      unset EXPECTED_BUNDLE_ID
      # shellcheck disable=SC1090
      source "$project_file" >/dev/null 2>&1 || exit 1
      printf '%s' "${EXPECTED_BUNDLE_ID:-}"
    )"
    [ -n "$expected_bundle" ] || continue

    while IFS= read -r profile_file; do
      [ -f "$profile_file" ] || continue
      profile_bundle="$(read_profile_bundle_id "$profile_file" || true)"
      if [ -n "$profile_bundle" ] && [ "$profile_bundle" = "$expected_bundle" ]; then
        PROFILE_SPECS+=("${project_id}=${profile_file}")
        break
      fi
    done < <(find "$(cert_ios_dir)" -maxdepth 1 -type f -iname '*.mobileprovision' -print 2>/dev/null | sort)
  done
}

main() {
  parse_args "$@"
  mkdir -p "$SIGNING_ROOT"
  chmod 700 "$PIPELINE_ROOT/signing" "$SIGNING_ROOT" 2>/dev/null || true

  # 未显式传参时，自动使用 certificates/iOS 中的证书和 Profile。
  if [ -z "$P12_SOURCE" ]; then
    local auto_p12
    auto_p12="$(find "$(cert_ios_dir)" -maxdepth 1 -type f \( -iname '*.p12' -o -iname '*.pfx' \) -print -quit 2>/dev/null)"
    [ -n "$auto_p12" ] && P12_SOURCE="$auto_p12"
  fi

  discover_default_profiles

  if [ -n "$P12_SOURCE" ]; then
    [ -f "$P12_SOURCE" ] || die "p12 不存在: $P12_SOURCE"
    cp -f "$P12_SOURCE" "$P12_FILE"
    chmod 600 "$P12_FILE"
    printf '[OK] p12: %s\n' "$P12_FILE"
  fi

  local spec
  if [ "${#PROFILE_SPECS[@]}" -gt 0 ]; then
    for spec in "${PROFILE_SPECS[@]}"; do
      update_profile "$spec"
    done
  fi

  if [ "$SKIP_PASSWORD" != "1" ] && [ -f "$P12_FILE" ]; then
    printf '即将更新 macOS Keychain 中的 p12 密码。\n'
    printf 'Keychain 服务名: %s\n' "$P12_PASSWORD_SERVICE"
    printf 'security 会提示输入密码，不需要把密码写入任何文件。\n'
    security add-generic-password -U -a "$USER" -s "$P12_PASSWORD_SERVICE" -w
    printf '[OK] Keychain 密码已更新\n'
  fi
}

main "$@"
