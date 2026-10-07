# shellcheck shell=bash

pgyer_api_key() {
  if [ -n "${PGYER_API_KEY:-}" ]; then
    printf '%s\n' "$PGYER_API_KEY"
    return 0
  fi
  if command -v security >/dev/null 2>&1; then
    security find-generic-password -s "${PGYER_API_KEY_SERVICE:-app-packager-pgyer}" \
      -a "$USER" -w 2>/dev/null || true
  fi
}

pgyer_prompt_api_key() {
  local key="" save=""
  [ -t 0 ] && [ "${APP_PACKAGER_NONINTERACTIVE:-0}" != "1" ] || return 1
  printf '未找到蒲公英 API Key。请输入（不会回显；直接回车跳过上传）: ' >&2
  read -r -s key || key=""
  printf '\n' >&2
  [ -n "$key" ] || return 1

  if command -v security >/dev/null 2>&1; then
    printf '是否保存到 macOS Keychain？[Y/n]: ' >&2
    read -r save || save=""
    case "$save" in
      n|N|no|NO) ;;
      *)
        if security add-generic-password -U -s "${PGYER_API_KEY_SERVICE:-app-packager-pgyer}" \
          -a "$USER" -w "$key" >/dev/null 2>&1; then
          printf '蒲公英 API Key 已保存到 Keychain。\n' >&2
        else
          printf '警告：蒲公英 API Key 保存失败，本次仍继续上传。\n' >&2
        fi
        ;;
    esac
  fi
  printf '%s\n' "$key"
}

pgyer_harmony_p12_password() {
  if [ -n "${PGYER_HARMONY_P12_PASSWORD:-}" ]; then
    printf '%s\n' "$PGYER_HARMONY_P12_PASSWORD"
    return 0
  fi
  if [ -n "${HARMONY_P12_PASSWORD:-}" ]; then
    printf '%s\n' "$HARMONY_P12_PASSWORD"
    return 0
  fi
  if command -v security >/dev/null 2>&1; then
    security find-generic-password \
      -s "${PGYER_HARMONY_P12_PASSWORD_SERVICE:-app-packager-pgyer-harmony-p12}" \
      -a "$USER" -w 2>/dev/null && return 0
    security find-generic-password \
      -s "${HARMONY_P12_PASSWORD_SERVICE:-anjuyi-harmony-p12}" \
      -a "$USER" -w 2>/dev/null || true
  fi
}

pgyer_prompt_harmony_p12_password() {
  local password="" save=""
  [ -t 0 ] && [ "${APP_PACKAGER_NONINTERACTIVE:-0}" != "1" ] || return 1
  printf '上传 HarmonyOS HAP 需要 P12 密码。请输入（不会回显；直接回车跳过上传）: ' >&2
  read -r -s password || password=""
  printf '\n' >&2
  [ -n "$password" ] || return 1

  if command -v security >/dev/null 2>&1; then
    printf '是否保存到 macOS Keychain？[Y/n]: ' >&2
    read -r save || save=""
    case "$save" in
      n|N|no|NO) ;;
      *)
        if security add-generic-password -U \
          -s "${PGYER_HARMONY_P12_PASSWORD_SERVICE:-app-packager-pgyer-harmony-p12}" \
          -a "$USER" -w "$password" >/dev/null 2>&1; then
          printf 'HarmonyOS P12 密码已保存到 Keychain。\n' >&2
        else
          printf '警告：HarmonyOS P12 密码保存失败，本次仍继续上传。\n' >&2
        fi
        ;;
    esac
  fi
  printf '%s\n' "$password"
}

pgyer_description() {
  local fallback="$1"
  printf '%s\n' "${PGYER_UPDATE_DESCRIPTION:-${PGYER_BUILD_UPDATE_DESCRIPTION:-$fallback}}"
}

pgyer_artifact_path() {
  local info_file="$1" platform="$2"
  case "$platform" in
    ios) build_info_field "$info_file" ipa_path ;;
    android) build_info_field "$info_file" apk_path ;;
    harmony) build_info_field "$info_file" hap_path ;;
    *) return 1 ;;
  esac
}

pgyer_write_result() {
  local info_file="$1" status="$2" result_file="$3" error_message="${4:-}"
  node - "$info_file" "$status" "$result_file" "$error_message" <<'NODE'
const fs = require("fs");
const [infoFile, status, resultFile, errorMessage] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
let detail = {
  provider: "pgyer",
  status,
  updated_at: new Date().toISOString()
};
if (status === "success" && resultFile && fs.existsSync(resultFile)) {
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const data = result.data || result;
  detail = {
    ...detail,
    build_key: data.buildKey || data.build_key || result.build_key || "",
    shortcut_url: data.buildShortcutUrl || data.shortcut_url || result.shortcut_url || "",
    qr_code_url: data.buildQRCodeURL || data.qr_code_url || result.qr_code_url || "",
    install_password: data.buildPassword || data.install_password || result.install_password || ""
  };
} else if (errorMessage) {
  detail.error = errorMessage;
}
info.uploads = info.uploads && typeof info.uploads === "object" ? info.uploads : {};
info.uploads.pgyer = detail;
fs.writeFileSync(infoFile, JSON.stringify(info, null, 2) + "\n");
NODE
}

pgyer_write_failure_result() {
  local info_file="$1" result_file="$2" error_message="$3"
  node - "$info_file" "$result_file" "$error_message" <<'NODE'
const fs = require("fs");
const [infoFile, resultFile, errorMessage] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
const payload = {
  status: "failed",
  provider: "pgyer",
  project_id: info.project_id || "",
  platform: info.platform || "",
  version: info.version || "",
  file_path: info.ipa_path || info.apk_path || info.hap_path || "",
  error: errorMessage,
  updated_at: new Date().toISOString()
};
fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\n");
NODE
}

pgyer_upload_legacy_artifact() {
  local info_file="$1" platform="$2" project_id="$3" version="$4" file_path="$5"
  local api_key http_code response_file result_file error_file stamp description curl_error=""
  api_key="$(pgyer_api_key || true)"
  if [ -z "$api_key" ]; then
    api_key="$(pgyer_prompt_api_key || true)"
  fi
  if [ -z "$api_key" ]; then
    warn "蒲公英上传跳过：未配置 API Key。可设置 PGYER_API_KEY，或保存到 Keychain service ${PGYER_API_KEY_SERVICE:-app-packager-pgyer}"
    return 1
  fi

  stamp="$(date '+%Y%m%d-%H%M%S')"
  local upload_dir
  upload_dir="$(upload_root_dir)/pgyer"
  mkdir -p "$upload_dir"
  response_file="$upload_dir/${stamp}-${project_id}-${platform}.response.json"
  result_file="$upload_dir/${stamp}-${project_id}-${platform}.json"
  error_file="$upload_dir/${stamp}-${project_id}-${platform}.curl.log"
  description="$(pgyer_description "${project_id} ${version} ${platform} ${BUILD_STARTED_AT:-}")"

  log "上传到蒲公英: $(basename "$file_path")"
  local -a curl_args=(
    -sS
    --connect-timeout 20
    --max-time "${PGYER_UPLOAD_TIMEOUT_SECONDS:-600}"
    -o "$response_file"
    -w '%{http_code}'
    -F "file=@${file_path}"
    --form-string "_api_key=${api_key}"
    --form-string "buildType=${platform}"
  )
  [ -n "$description" ] && curl_args+=(--form-string "buildUpdateDescription=${description}")
  [ -n "${PGYER_BUILD_INSTALL_TYPE:-}" ] && curl_args+=(--form-string "buildInstallType=${PGYER_BUILD_INSTALL_TYPE}")
  [ -n "${PGYER_BUILD_PASSWORD:-}" ] && curl_args+=(--form-string "buildPassword=${PGYER_BUILD_PASSWORD}")

  http_code="$(curl "${curl_args[@]}" "${PGYER_LEGACY_UPLOAD_URL:-${PGYER_API_BASE_URL:-https://upload.pgyer.com/apiv2/app/upload}}" 2>"$error_file" || true)"
  if [ -z "$http_code" ] || [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    curl_error="HTTP ${http_code:-unknown}"
    [ -s "$error_file" ] && curl_error="$curl_error: $(tr '\n' ' ' <"$error_file" | cut -c1-500)"
    pgyer_write_failure_result "$info_file" "$result_file" "$curl_error"
    pgyer_write_result "$info_file" "failed" "$result_file" "$curl_error"
    warn "蒲公英上传失败: $curl_error"
    return 1
  fi

  if ! node - "$response_file" "$result_file" "$info_file" "$stamp" <<'NODE'
const fs = require("fs");
const [responseFile, resultFile, infoFile, stamp] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
let response = {};
try {
  response = JSON.parse(fs.readFileSync(responseFile, "utf8"));
} catch (error) {
  response = { code: -1, message: `响应不是有效 JSON: ${error.message}` };
}
const code = Number(response.code);
if (code !== 0) {
  const message = response.message || `蒲公英返回 code=${response.code}`;
  const failed = {
    status: "failed",
    provider: "pgyer",
    project_id: info.project_id || "",
    platform: info.platform || "",
    version: info.version || "",
    file_path: info.ipa_path || info.apk_path || "",
    error: message,
    response,
    uploaded_at: stamp
  };
  fs.writeFileSync(resultFile, JSON.stringify(failed, null, 2) + "\n");
  process.exit(1);
}
const data = response.data || {};
const result = {
  status: "success",
  provider: "pgyer",
  project_id: info.project_id || "",
  platform: info.platform || "",
  version: info.version || "",
  file_path: info.ipa_path || info.apk_path || "",
  build_key: data.buildKey || "",
  shortcut_url: data.buildShortcutUrl || "",
  qr_code_url: data.buildQRCodeURL || "",
  install_password: data.buildPassword || "",
  response,
  uploaded_at: stamp
};
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
NODE
  then
    curl_error="蒲公英接口返回失败，详见: $result_file"
    pgyer_write_result "$info_file" "failed" "$result_file" "$curl_error"
    warn "$curl_error"
    return 1
  fi

  pgyer_write_result "$info_file" "success" "$result_file"
  local shortcut
  shortcut="$(node -e 'const r=require(process.argv[1]); process.stdout.write(r.shortcut_url||"")' "$result_file" 2>/dev/null || true)"
  log "蒲公英上传成功${shortcut:+: $shortcut}"
  return 0
}

pgyer_harmony_fail() {
  local info_file="$1" result_file="$2" message="$3"
  pgyer_write_failure_result "$info_file" "$result_file" "$message"
  pgyer_write_result "$info_file" "failed" "$result_file" "$message"
  warn "$message"
  return 1
}

pgyer_upload_harmony_artifact() {
  local info_file="$1" project_id="$2" version="$3" hap_path="$4"
  local harmony_p12_path="" api_key="" p12_password="" stamp upload_dir description
  local token_response token_status token_code build_key endpoint signature cos_token token_values
  local hap_response hap_status cert_response cert_status poll_response poll_status poll_values poll_code poll_message
  local result_file error_file deadline

  harmony_p12_path="$(build_info_field "$info_file" harmony_p12_path 2>/dev/null || true)"
  if [ -z "$harmony_p12_path" ] || [ ! -f "$harmony_p12_path" ]; then
    warn "蒲公英 HAP 上传失败：构建信息缺少可用的 HarmonyOS P12: $harmony_p12_path"
    return 1
  fi

  local profile_type profile_distribution profile_device_count
  profile_type="$(build_info_field "$info_file" harmony_profile_type 2>/dev/null || true)"
  profile_distribution="$(build_info_field "$info_file" harmony_profile_distribution 2>/dev/null || true)"
  profile_device_count="$(build_info_field "$info_file" harmony_profile_device_count 2>/dev/null || true)"
  if [ "$profile_type" = "debug" ]; then
    warn "蒲公英 HAP 上传失败：当前是 Debug Profile。蒲公英要求 release + internaltesting Profile"
    return 1
  fi
  if [ -n "$profile_distribution" ] && [ "$profile_distribution" != "internaltesting" ]; then
    warn "蒲公英 HAP 上传失败：当前 P7B 分发类型为 $profile_distribution，必须是 internaltesting"
    return 1
  fi
  if [ -n "$profile_device_count" ] && [ "$profile_device_count" -eq 0 ]; then
    warn "蒲公英 HAP 上传失败：当前 P7B 不包含测试设备 UDID"
    return 1
  fi

  api_key="$(pgyer_api_key || true)"
  [ -n "$api_key" ] || api_key="$(pgyer_prompt_api_key || true)"
  if [ -z "$api_key" ]; then
    warn "蒲公英 HAP 上传跳过：未配置 API Key"
    return 1
  fi

  p12_password="$(pgyer_harmony_p12_password || true)"
  [ -n "$p12_password" ] || p12_password="$(pgyer_prompt_harmony_p12_password || true)"
  if [ -z "$p12_password" ]; then
    warn "蒲公英 HAP 上传跳过：未配置 HarmonyOS P12 密码。可设置 PGYER_HARMONY_P12_PASSWORD，或保存到 Keychain service ${PGYER_HARMONY_P12_PASSWORD_SERVICE:-app-packager-pgyer-harmony-p12}"
    return 1
  fi

  command -v curl >/dev/null 2>&1 || { warn "蒲公英 HAP 上传失败：缺少 curl"; return 1; }
  command -v node >/dev/null 2>&1 || { warn "蒲公英 HAP 上传失败：缺少 node"; return 1; }

  stamp="$(date '+%Y%m%d-%H%M%S')"
  upload_dir="$(upload_root_dir)/pgyer"
  mkdir -p "$upload_dir"
  token_response="$upload_dir/${stamp}-${project_id}-harmony.get-cost-token.json"
  hap_response="$upload_dir/${stamp}-${project_id}-harmony.upload-file.json"
  cert_response="$upload_dir/${stamp}-${project_id}-harmony.upload-cert.json"
  poll_response="$upload_dir/${stamp}-${project_id}-harmony.build-info.json"
  result_file="$upload_dir/${stamp}-${project_id}-harmony.json"
  error_file="$upload_dir/${stamp}-${project_id}-harmony.curl.log"
  description="$(pgyer_description "${project_id} ${version} harmony ${BUILD_STARTED_AT:-}")"

  log "获取蒲公英 HAP 上传凭证: $(basename "$hap_path")"
  local -a token_args=(
    -sS
    --connect-timeout 20
    --max-time "${PGYER_UPLOAD_TIMEOUT_SECONDS:-600}"
    -o "$token_response"
    -w '%{http_code}'
    --form-string "_api_key=${api_key}"
    --form-string "buildType=hap"
  )
  [ -n "$description" ] && token_args+=(--form-string "buildUpdateDescription=${description}")
  [ -n "${PGYER_BUILD_INSTALL_TYPE:-}" ] && token_args+=(--form-string "buildInstallType=${PGYER_BUILD_INSTALL_TYPE}")
  [ -n "${PGYER_BUILD_PASSWORD:-}" ] && token_args+=(--form-string "buildPassword=${PGYER_BUILD_PASSWORD}")
  token_status="$(curl "${token_args[@]}" "${PGYER_GET_COS_TOKEN_URL:-https://www.pgyer.com/apiv2/app/getCOSToken}" 2>"$error_file" || true)"
  if [ -z "$token_status" ] || [ "$token_status" -lt 200 ] || [ "$token_status" -ge 300 ]; then
    return $(pgyer_harmony_fail "$info_file" "$result_file" "获取上传凭证失败: HTTP ${token_status:-unknown}")
  fi

  token_values="$(node - "$token_response" <<'NODE' 2>/dev/null
const fs = require("fs");
const response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const data = response.data || {};
const params = data.params || {};
console.log([
  Number(response.code),
  data.key || "",
  data.endpoint || "",
  params.signature || "",
  params["x-cos-security-token"] || ""
].join("\t"));
NODE
)" || return $(pgyer_harmony_fail "$info_file" "$result_file" "上传凭证响应无法解析: $token_response")
  IFS=$'\t' read -r token_code build_key endpoint signature cos_token <<<"$token_values"
  if [ "${token_code:-1}" != "0" ] || [ -z "$build_key" ] || [ -z "$endpoint" ] || [ -z "$signature" ] || [ -z "$cos_token" ]; then
    return $(pgyer_harmony_fail "$info_file" "$result_file" "获取上传凭证失败，详见: $token_response")
  fi

  log "上传 HarmonyOS HAP: $(basename "$hap_path")"
  hap_status="$(curl -sS \
    --connect-timeout 20 \
    --max-time "${PGYER_UPLOAD_TIMEOUT_SECONDS:-600}" \
    -o "$hap_response" \
    -w '%{http_code}' \
    --form-string "key=${build_key}" \
    --form-string "signature=${signature}" \
    --form-string "x-cos-security-token=${cos_token}" \
    --form-string "x-cos-meta-file-name=$(basename "$hap_path")" \
    -F "file=@${hap_path}" \
    "$endpoint" 2>>"$error_file" || true)"
  if [ -z "$hap_status" ] || [ "$hap_status" -lt 200 ] || [ "$hap_status" -ge 300 ]; then
    return $(pgyer_harmony_fail "$info_file" "$result_file" "HAP 文件上传失败: HTTP ${hap_status:-unknown}")
  fi

  log "上传蒲公英 HarmonyOS P12 证书"
  cert_status="$(curl -sS \
    --connect-timeout 20 \
    --max-time "${PGYER_UPLOAD_TIMEOUT_SECONDS:-600}" \
    -o "$cert_response" \
    -w '%{http_code}' \
    -F "file=@${harmony_p12_path}" \
    --form-string "_api_key=${api_key}" \
    --form-string "password=${p12_password}" \
    --form-string "buildKey=${build_key}" \
    "${PGYER_HARMONY_CERT_UPLOAD_URL:-https://upload.pgyer.com/apiv2/app/uploadHarmonyCert}" 2>>"$error_file" || true)"
  if [ -z "$cert_status" ] || [ "$cert_status" -lt 200 ] || [ "$cert_status" -ge 300 ]; then
    return $(pgyer_harmony_fail "$info_file" "$result_file" "P12 证书上传失败: HTTP ${cert_status:-unknown}")
  fi
  if ! node - "$cert_response" <<'NODE'
const fs = require("fs");
const response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (Number(response.code) !== 0) process.exit(1);
NODE
  then
    return $(pgyer_harmony_fail "$info_file" "$result_file" "P12 证书上传失败，详见: $cert_response")
  fi

  deadline=$((SECONDS + ${PGYER_POLL_TIMEOUT_SECONDS:-300}))
  while :; do
    poll_status="$(curl -sS -G \
      --connect-timeout 20 \
      --max-time 60 \
      -o "$poll_response" \
      -w '%{http_code}' \
      --data-urlencode "_api_key=${api_key}" \
      --data-urlencode "buildKey=${build_key}" \
      "${PGYER_BUILD_INFO_URL:-https://www.pgyer.com/apiv2/app/buildInfo}" 2>>"$error_file" || true)"
    if [ -z "$poll_status" ] || [ "$poll_status" -lt 200 ] || [ "$poll_status" -ge 300 ]; then
      return $(pgyer_harmony_fail "$info_file" "$result_file" "查询发布状态失败: HTTP ${poll_status:-unknown}")
    fi

    poll_values="$(node - "$poll_response" <<'NODE' 2>/dev/null
const fs = require("fs");
const response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log([Number(response.code), response.message || ""].join("\t"));
NODE
)" || return $(pgyer_harmony_fail "$info_file" "$result_file" "发布状态响应无法解析: $poll_response")
    IFS=$'\t' read -r poll_code poll_message <<<"$poll_values"
    if [ "$poll_code" = "0" ]; then
      break
    fi
    if [ "$poll_code" != "1247" ]; then
      return $(pgyer_harmony_fail "$info_file" "$result_file" "蒲公英 HAP 发布失败: ${poll_message:-code=$poll_code}")
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      return $(pgyer_harmony_fail "$info_file" "$result_file" "蒲公英 HAP 发布超时，详见: $poll_response")
    fi
    sleep "${PGYER_POLL_INTERVAL_SECONDS:-3}"
  done

  node - "$info_file" "$hap_path" "$harmony_p12_path" "$build_key" "$poll_response" "$cert_response" "$stamp" "$result_file" <<'NODE'
const fs = require("fs");
const [infoFile, hapPath, p12Path, buildKey, pollFile, certFile, stamp, resultFile] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
const poll = JSON.parse(fs.readFileSync(pollFile, "utf8"));
const cert = JSON.parse(fs.readFileSync(certFile, "utf8"));
const data = poll.data || {};
const result = {
  status: "success",
  provider: "pgyer",
  project_id: info.project_id || "",
  platform: "harmony",
  version: info.version || "",
  file_path: hapPath,
  p12_path: p12Path,
  build_key: data.buildKey || buildKey,
  shortcut_url: data.buildShortcutUrl || "",
  qr_code_url: data.buildQRCodeURL || "",
  install_password: data.buildPassword || "",
  certificate_response: cert,
  response: poll,
  uploaded_at: stamp
};
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
NODE

  pgyer_write_result "$info_file" "success" "$result_file"
  local shortcut
  shortcut="$(node -e 'const r=require(process.argv[1]); process.stdout.write(r.shortcut_url||"")' "$result_file" 2>/dev/null || true)"
  log "蒲公英 HarmonyOS 上传成功${shortcut:+: $shortcut}"
  return 0
}

upload_pgyer_artifact() {
  local info_file="$1" platform project_id version file_path
  [ -f "$info_file" ] || { warn "蒲公英上传失败：构建信息不存在: $info_file"; return 1; }

  platform="$(build_info_field "$info_file" platform 2>/dev/null || true)"
  project_id="$(build_info_field "$info_file" project_id 2>/dev/null || true)"
  version="$(build_info_field "$info_file" version 2>/dev/null || true)"
  file_path="$(pgyer_artifact_path "$info_file" "$platform" 2>/dev/null || true)"

  [ -n "$file_path" ] && [ -f "$file_path" ] || {
    warn "蒲公英上传失败：安装包不存在: $file_path"
    return 1
  }

  case "$platform" in
    ios|android) pgyer_upload_legacy_artifact "$info_file" "$platform" "$project_id" "$version" "$file_path" ;;
    harmony) pgyer_upload_harmony_artifact "$info_file" "$project_id" "$version" "$file_path" ;;
    *) warn "蒲公英上传失败：不支持的产物平台: $platform"; return 1 ;;
  esac
}
