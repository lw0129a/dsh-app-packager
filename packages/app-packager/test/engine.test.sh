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

# 已就绪的平台不能重复下载/安装（否则点一次「一键配置」就重下 800M+）。
engine_sdk 'mkdir -p "$(harmony_sdk_dir)/oh_modules/@dcloudio/uni-app-x-runtime"; \
  find_hbuilderx() { return 0; }; read_hbuilderx_version() { HX_VERSION=5.26.2026091802; HX_SERIES=5.26; }; \
  sdk_install harmony --yes; printf "|rc=%s" "$?"'
check_contains "sdk_install 已就绪的平台打印「已就绪，跳过」" "已就绪，跳过" "$OUT"
check_contains "sdk_install 已就绪时整体仍然成功" "|rc=0" "$OUT"
engine_sdk 'mkdir -p "$(harmony_sdk_dir)/oh_modules/@dcloudio/uni-app-x-runtime"; \
  find_hbuilderx() { return 0; }; read_hbuilderx_version() { HX_VERSION=5.26.2026091802; HX_SERIES=5.26; }; \
  install_harmony_runtime() { printf "SHOULD_NOT_RUN"; return 1; }; \
  sdk_install harmony --yes 2>&1 | grep -c SHOULD_NOT_RUN'
check "sdk_install 已就绪时不再调用安装动作" "0" "$OUT"

# 人读版（sdk urls / sdk text）也要读出本机 HBuilderX 版本：面板走 JSON，文本模式曾恒为「未知」。
engine_sdk 'find_hbuilderx() { return 0; }; read_hbuilderx_version() { HX_VERSION=5.26.2026091802; HX_SERIES=5.26; }; \
  sdk_status_text | grep "^版本:"'
check "sdk_status_text 报出本机 HBuilderX 版本" "版本: 5.26.2026091802" "$OUT"
engine_sdk 'find_hbuilderx() { return 1; }; sdk_status_text | grep "^版本:"'
check "sdk_status_text 未检测到 HBuilderX 时仍写未知" "版本: 未知" "$OUT"
# HarmonyOS 的「包名」是 DevEco 的 ohpm 包，npm 上查不到；标签不能跟 iOS/Android 的压缩包名混在一起。
engine_sdk 'sdk_series() { printf "5.26"; }; find_hbuilderx() { return 0; }; \
  read_hbuilderx_version() { HX_VERSION=5.26.2026091802; HX_SERIES=5.26; }; \
  sdk_status_text | grep "ohpm 包名:"'
check "sdk_status_text 把 HarmonyOS 的包名标成 ohpm 包" \
  "  ohpm 包名: @dcloudio/uni-app-x-runtime@5.26.*（DevEco Studio 的 ohpm 仓库，不在 npm 上）" "$OUT"

# settings.local.env 里的 SDK 路径写成跟随引擎目录的形式：引擎目录整体挪走后不失效。
engine_sdk 'LOCAL_IOS_SDK_DIR="$PIPELINE_ROOT/sdk/iOS/5.26"; LOCAL_ANDROID_SDK_DIR=""; \
  LOCAL_HARMONY_SDK_DIR=""; write_local_settings >/dev/null; \
  grep "^LOCAL_IOS_SDK_DIR=" "$PIPELINE_ROOT/config/settings.local.env"'
check "settings 里引擎目录内的 SDK 路径跟着引擎目录走" \
  'LOCAL_IOS_SDK_DIR="$PIPELINE_ROOT/sdk/iOS/5.26"' "$OUT"
engine_sdk 'LOCAL_IOS_SDK_DIR="$PIPELINE_ROOT/sdk/iOS/5.26"; write_local_settings >/dev/null; \
  source "$PIPELINE_ROOT/config/settings.local.env"; printf "%s" "$LOCAL_IOS_SDK_DIR"'
check "settings source 回来仍是同一个绝对路径" "$TMP/sdk/iOS/5.26" "$OUT"

engine_sdk_json 'sdk_status_json'
check "sdk_status_json 退出码" "0" "$STATUS"
PARSED="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{const v=JSON.parse(s);
console.log([v.platforms.map((p)=>p.id).join(","),v.platforms.length,typeof v.hbuilderx.found,v.incompleteDownloads,typeof v.sdkRoot].join("|"))})' 2>&1)"
check "sdk_status_json 是合法 JSON 且含三平台" "ios,android,harmony|3|boolean|0|string" "$PARSED"
# 字段名就是对外契约（项目介绍.md §6 逐字列了它们），写错文档就等于承诺了不存在的字段，钉住：
KEYS="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{const v=JSON.parse(s);
console.log([Object.keys(v).sort().join(","),Object.keys(v.platforms[0]).sort().join(",")].join("|"))})' 2>&1)"
check "sdk_status_json 字段名与文档一致（platforms[] 是 package，没有 settingsFile/hint）" \
  "archives,hbuilderx,incompleteDownloads,platforms,sdkRoot|dir,direct,id,label,package,page,ready,series,state" "$KEYS"

# 面板/CI 里 stdout 不是 TTY：上下重绘的队列表整块被丢掉，日志从「构建队列」之后
# 一动不动，看着像卡死。非 TTY 改打一行快照，并且不重复刷屏。
engine '
  status_dir="$PIPELINE_ROOT/status"; mkdir -p "$status_dir"
  printf "%s\n" "{\"status\":\"waiting\",\"progress\":35,\"message\":\"等待 HBuilderX 名额\",\"platform\":\"android\",\"project\":\"demo\",\"sequence\":1,\"updated_at\":\"18:09:00\"}" > "$status_dir/1.json"
  out="$(PARALLEL_QUEUE_HEARTBEAT_SECONDS=30 render_parallel_queue "$status_dir"; PARALLEL_QUEUE_HEARTBEAT_SECONDS=30 render_parallel_queue "$status_dir")"
  printf "%s|%s" "$out" "$(printf "%s\n" "$out" | grep -c "android 35%")"'
check_contains "非 TTY 下队列打一行进度快照" "android 35% 等待 HBuilderX 名额" "$OUT"
check "队列没变化、也没到心跳点就不重复刷" "1" "${OUT##*|}"

# 等名额时必须把「已等多少秒」写进状态：否则面板上一直挂着上一句消息，
# HBuilderX 只有 1 个编译位，另外两个平台真的会干等好几分钟。
# （不走 run_with_timeout：/bin/bash 3.2 上被 TERM 的后台作业会把调用方一起带走。）
engine '
  mkdir -p "$PIPELINE_ROOT/.tmp/semaphores/hbuilderx/1" "$PIPELINE_ROOT/status"
  printf "%s\n" "$$" > "$PIPELINE_ROOT/.tmp/semaphores/hbuilderx/1/pid"
  export TASK_STATUS_FILE="$PIPELINE_ROOT/status/9.json" TASK_PLATFORM=android TASK_PROJECT=demo TASK_SEQUENCE=9
  export SEMAPHORE_PROGRESS=15 SEMAPHORE_WAIT_MESSAGE="等待 HBuilderX 名额" SEMAPHORE_HEARTBEAT_SECONDS=1
  with_semaphore hbuilderx 1 true &
  waiting=$!
  sleep 2
  cat "$TASK_STATUS_FILE"
  kill "$waiting" 2>/dev/null || true'
check_contains "等名额时状态带上已等秒数" "等待 HBuilderX 名额（已等" "$OUT"

# HBuilderX 5.26 的 Android 编译器不认「项目在 node_modules 里」的路径：编译器自己生成的
# ./uni_modules/<插件>/instans/types 相对导入会报 "index not found"，于是 npm 分发
# （home 在 <profile>/node_modules/dsh-app-packager/home 下）时 Android 必然失败。
engine 'source "$PIPELINE_ROOT/lib/init.sh" >/dev/null 2>&1
  APP_PACKAGER_CACHE_ROOT=/tmp/ap-cache
  WORK_ROOT="/x/node_modules/dsh-app-packager/home/workspaces"
  relocate_work_root_out_of_node_modules >/dev/null
  printf "%s" "$WORK_ROOT"'
check "工作区在 node_modules 里就挪到缓存目录" "/tmp/ap-cache/workspaces" "$OUT"

engine 'source "$PIPELINE_ROOT/lib/init.sh" >/dev/null 2>&1
  WORK_ROOT="$HOME/AppPackager/workspaces"
  relocate_work_root_out_of_node_modules >/dev/null
  printf "%s" "$WORK_ROOT"'
check "工作区不在 node_modules 里就原样保留" "$HOME/AppPackager/workspaces" "$OUT"

if [ "$fails" -eq 0 ]; then
  printf '\nengine.test.sh 全部通过\n'
else
  printf '\nengine.test.sh 失败 %s 项\n' "$fails"
fi
exit "$([ "$fails" -eq 0 ] && echo 0 || echo 1)"
