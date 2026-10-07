#!/usr/bin/env bash
# 引擎命令行选项自检：只覆盖不依赖真实证书与构建的纯逻辑
#   bash packages/app-packager/test/engine.test.sh
set -uo pipefail

REPO_ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../engine" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$REPO_ENGINE/config" "$TMP/config"
rm -rf "$TMP/config/projects"
mkdir -p "$TMP/config/projects" "$TMP/signing/current" "$TMP/logs"
# 复制而不是软链 lib：init.sh 等脚本会用「自己所在目录的上一级」重算 PIPELINE_ROOT，
# 软链会让它们把仓库当成引擎目录（测试就可能写进仓库）。
cp -R "$REPO_ENGINE/lib" "$TMP/lib"

fails=0
OUT=""
STATUS=0

engine() { # engine <bash 片段>：源码引擎后在临时 PIPELINE_ROOT 里执行片段
  OUT="$(PIPELINE_ROOT="$TMP" bash -c "source '$REPO_ENGINE/lib/common.sh'; source '$REPO_ENGINE/lib/runner.sh'; $1" 2>&1)"
  STATUS=$?
}

check() { # check <描述> <期望> <实际>
  if [ "$2" = "$3" ]; then
    printf 'ok   %s\n' "$1"
  else
    printf 'FAIL %s\n     期望: %s\n     实际: %s\n' "$1" "$2" "$3"
    fails=$((fails + 1))
  fi
}

check_contains() { # check_contains <描述> <子串> <文本>
  case "$3" in
    *"$2"*) printf 'ok   %s\n' "$1" ;;
    *) printf 'FAIL %s\n     应包含: %s\n     实际: %s\n' "$1" "$2" "$3"; fails=$((fails + 1)) ;;
  esac
}

engine 'parse_args --no-full-permission; printf "%s" "$APP_PACKAGER_FULL_PERMISSION"'
check "parse_args --no-full-permission" "false" "$OUT"

engine 'parse_args --full-permission ios --all; printf "%s|%s|%s" "$APP_PACKAGER_FULL_PERMISSION" "$PLATFORM" "$PROJECT_ID"'
check "parse_args --full-permission ios --all" "true|ios|__ALL__" "$OUT"

engine 'parse_args --package-kind appstore ios demo; printf "%s" "$APP_PACKAGER_PACKAGE_KIND"'
check "parse_args --package-kind appstore" "appstore" "$OUT"

engine 'parse_args --package-kind bogus'
check "parse_args --package-kind 非法值退出码" "1" "$STATUS"
check_contains "parse_args --package-kind 非法值提示" "仅支持 adhoc" "$OUT"

engine 'parse_args --set MARKETING_VERSION=1.2.3; printf "%s" "$APP_PACKAGER_SET_OVERRIDES"'
check "parse_args --set 合法键" "MARKETING_VERSION=1.2.3" "$OUT"

engine 'parse_args --set FOO=1'
check "parse_args --set 未知键退出码" "1" "$STATUS"
check_contains "parse_args --set 未知键提示" "不支持的键: FOO" "$OUT"

engine 'parse_args --set bad-key=1'
check "parse_args --set 非法键名退出码" "1" "$STATUS"
check_contains "parse_args --set 非法键名提示" "键名不合法" "$OUT"

engine 'parse_args --set NOVALUE'
check "parse_args --set 缺少等号退出码" "1" "$STATUS"
check_contains "parse_args --set 缺少等号提示" "KEY=VALUE" "$OUT"

engine 'parse_args --set "$(printf "MARKETING_VERSION=1\n2")"'
check "parse_args --set 值含换行退出码" "1" "$STATUS"
check_contains "parse_args --set 值含换行提示" "不能包含换行" "$OUT"

engine 'parse_args --set APP_NAME=一 --set APP_NAME=二; printf "%s" "$APP_PACKAGER_SET_OVERRIDES" | tr "\n" "|"'
check "parse_args --set 可重复且保留顺序" "APP_NAME=一|APP_NAME=二|" "$OUT"

engine 'APP_NAME=原名 APP_ID=__UNI__1 BUNDLE_ID=com.a.b TEAM_ID=T1 PROFILE_NAME=P1 \
  SIGNING_CERTIFICATE=C1 EXPORT_METHOD=release-testing PACKAGE_KIND=adhoc SCHEME=UniAppX \
  CONFIGURATION=Release APP_IOS_DIR=/sdk SOURCE_APP_DIR=/src RUN_DIR=/run PACKAGE_ENV='"$TMP"'/p.env \
  APP_PACKAGER_SET_OVERRIDES=$'"'"'MARKETING_VERSION=9.9.9\nAPP_NAME=A B\n'"'"'; \
  write_package_env; printf "%s|%s|%s" "$(grep -c "^APP_NAME=" "$PACKAGE_ENV")" "$(tail -n 1 "$PACKAGE_ENV")" "$(grep -c "^MARKETING_VERSION=" "$PACKAGE_ENV")"'
check "write_package_env 标准键保留、覆盖项按 %q 写在最后" '2|APP_NAME=A\ B|1' "$OUT"

engine 'APP_PACKAGER_FULL_PERMISSION=false; FULL_PERMISSION_PROFILE=true; FULL_PERMISSION_PROMPT=true; \
  apply_build_option_overrides; printf "%s|%s" "$FULL_PERMISSION_PROFILE" "$FULL_PERMISSION_PROMPT"'
check "apply_build_option_overrides 关闭全权限" "false|false" "$OUT"

engine 'APP_PACKAGER_PROFILE_FILE=/nope/absent.mobileprovision; apply_build_option_overrides'
check "apply_build_option_overrides 描述文件不存在退出码" "1" "$STATUS"
check_contains "apply_build_option_overrides 描述文件不存在提示" "指定的描述文件不存在" "$OUT"

engine 'APP_PACKAGER_PACKAGE_KIND=appstore; EXPECTED_BUNDLE_ID=com.szaj.admin.app; apply_build_option_overrides'
check "apply_build_option_overrides 缺少该类型描述文件退出码" "1" "$STATUS"
check_contains "apply_build_option_overrides 缺少该类型描述文件提示" "未找到 appstore 类型的描述文件" "$OUT"

engine 'profiles_json'
check "profiles_json 空目录返回空数组" "[]" "$OUT"
check "profiles_json 空目录退出码" "0" "$STATUS"

# ---- SDK 状态与一键配置（lib/sdk.sh）----
engine_sdk() { # engine_sdk <bash 片段>：源码 sdk.sh 后在临时 PIPELINE_ROOT 里执行片段
  OUT="$(PIPELINE_ROOT="$TMP" bash -c "source '$TMP/lib/sdk.sh'; $1" 2>&1)"
  STATUS=$?
}

engine_sdk_json() { # 只取 stdout：JSON 里不能混进任何提示行
  OUT="$(PIPELINE_ROOT="$TMP" bash -c "source '$TMP/lib/sdk.sh'; $1" 2>/dev/null)"
  STATUS=$?
}

engine_sdk 'sdk_label ios; printf "|"; sdk_label harmony; printf "|"; sdk_label android'
check "sdk_label 三平台" "iOS|HarmonyOS|Android" "$OUT"

engine_sdk 'sdk_state_for ios'
check "sdk_state_for 没装 SDK 时为 missing" "missing" "$OUT"

engine_sdk 'sdk_direct_url ios'
check_contains "sdk_direct_url 给 iOS 确定性直链" "UniAppX-iOS%405.26.zip" "$OUT"

engine_sdk 'sdk_package_hint android'
check_contains "sdk_package_hint Android 文件名带构建号" "Android-uni-app-x-SDK@" "$OUT"

engine_sdk 'sdk_install windows --yes'
check "sdk_install 非法平台按用法错误退出" "2" "$STATUS"
check_contains "sdk_install 非法平台提示" "未知平台: windows" "$OUT"

# 没装成就不能报成功：非交互（stdin 关闭）下 harmony 会走「拒绝安装」分支。
engine_sdk 'sdk_install harmony </dev/null >/dev/null 2>&1'
check "sdk_install harmony 非交互拒绝安装后不算成功" "1" "$STATUS"
engine_sdk 'sdk_install harmony </dev/null 2>&1 | grep -c "SDK 配置完成"'
check "sdk_install harmony 未装成时不打印「配置完成」" "0" "$OUT"

engine_sdk 'mkdir -p "$(harmony_sdk_dir)"; : > "$(harmony_sdk_dir)/oh-package.json5"; \
  if harmony_sdk_ready; then printf 0; else printf 1; fi'
check "harmony_sdk_ready 不认自己刚建的 oh-package.json5（旧版假阳性）" "1" "$OUT"

engine_sdk 'mkdir -p "$(harmony_sdk_dir)/oh_modules/@dcloudio/uni-app-x-runtime"; \
  if harmony_sdk_ready; then printf 0; else printf 1; fi'
check "harmony_sdk_ready 认 uni-app-x-runtime" "0" "$OUT"

engine_sdk_json 'sdk_status_json'
check "sdk_status_json 退出码" "0" "$STATUS"
PARSED="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{const v=JSON.parse(s);
console.log([v.platforms.map((p)=>p.id).join(","),v.platforms.length,typeof v.hbuilderx.found,v.incompleteDownloads,typeof v.sdkRoot].join("|"))})' 2>&1)"
check "sdk_status_json 是合法 JSON 且含三平台" "ios,android,harmony|3|boolean|0|string" "$PARSED"

if [ "$fails" -eq 0 ]; then
  printf '\nengine.test.sh 全部通过\n'
else
  printf '\nengine.test.sh 失败 %s 项\n' "$fails"
fi
exit "$([ "$fails" -eq 0 ] && echo 0 || echo 1)"
