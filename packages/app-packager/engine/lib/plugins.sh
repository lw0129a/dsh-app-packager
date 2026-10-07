plugin_platform_dir_name() {
  case "$1" in
    ios) printf '%s\n' 'app-ios' ;;
    android) printf '%s\n' 'app-android' ;;
    harmony) printf '%s\n' 'app-harmony' ;;
    *) return 1 ;;
  esac
}

plugin_platform_label() {
  case "$1" in
    ios) printf '%s\n' 'iOS' ;;
    android) printf '%s\n' 'Android' ;;
    harmony) printf '%s\n' 'HarmonyOS' ;;
    *) printf '%s\n' "$1" ;;
  esac
}

list_uts_plugin_ids() {
  local platform="$1" platform_dir root plugin
  platform_dir="$(plugin_platform_dir_name "$platform")" || return 1
  for root in \
    "$WORKSPACE/uni_modules" \
    "$WORKSPACE/unpackage/resources/app-${platform}/uni_modules"; do
    [ -d "$root" ] || continue
    for plugin in "$root"/*; do
      [ -d "$plugin/utssdk/$platform_dir" ] && basename "$plugin"
    done
  done | sort -u
}

integrate_ios_custom_uts_plugins() {
  [ "${IOS_CUSTOM_UTS_INTEGRATION:-true}" = "true" ] || return 0

  local resource_root="$WORKSPACE/unpackage/resources/app-ios"
  local plugin_root="$resource_root/uni_modules"
  local host_root="$NATIVE_SDK_DIR/UTSPluginExample"
  local plugin_src plugin_id host_dir host_name host_src
  local -a plugin_sources=() host_dirs=() used_hosts=()

  [ -d "$host_root" ] || die "UTSPluginExample 目录不存在: $host_root"
  [ -d "$plugin_root" ] || {
    log "未检测到 iOS 自定义 UTS 编译产物，跳过 UTS 联编"
    return 0
  }

  while IFS= read -r -d '' plugin_src; do
    plugin_sources+=("$plugin_src")
  done < <(find "$plugin_root" -type d -path '*/utssdk/app-ios/src' -print0 2>/dev/null)

  if [ "${#plugin_sources[@]}" -eq 0 ]; then
    log "未检测到 iOS 自定义 UTS 编译产物，跳过 UTS 联编"
    return 0
  fi

  while IFS= read -r -d '' host_dir; do
    host_dirs+=("$host_dir")
  done < <(find "$host_root" -mindepth 1 -maxdepth 1 -type d -name 'unimodule*' -print0 2>/dev/null)

  if [ "${#plugin_sources[@]}" -gt "${#host_dirs[@]}" ]; then
    die "iOS 自定义 UTS 插件数量(${#plugin_sources[@]})超过 SDK 可复用宿主数量(${#host_dirs[@]})"
  fi

  for plugin_src in "${plugin_sources[@]}"; do
    plugin_id="${plugin_src%/utssdk/app-ios/src}"
    plugin_id="${plugin_id##*/}"

    host_dir=""
    for candidate in "${host_dirs[@]}"; do
      case " ${used_hosts[*]-} " in
        *" $candidate "*) continue ;;
      esac
      host_dir="$candidate"
      break
    done
    [ -n "$host_dir" ] || die "没有可用的 iOS UTS 宿主工程: $plugin_id"

    host_name="$(basename "$host_dir")"
    host_src="$host_dir/$host_name"
    [ -d "$host_src" ] || die "UTS 宿主源码目录不存在: $host_src"

    rm -f "$host_src"/*.swift
    cp -R "$plugin_src/." "$host_src/" >>"$LOG_FILE" 2>&1 \
      || die "挂载自定义 UTS 插件失败: $plugin_id"

    python3 - "$host_src" "$plugin_id" <<'PY_FIX_IOS_UTS_SWIFT'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
plugin_id = sys.argv[2]
fixed_files = 0
fixed_count = 0
for path in root.rglob('*.swift'):
    text = path.read_text(encoding='utf-8', errors='ignore')
    fixed, count = re.subn(
        r'URL\(string:\s*encodeURI\(([^()]+)\)\)',
        r'URL(string: encodeURI(\1) ?? \1)',
        text,
    )
    if count:
        path.write_text(fixed, encoding='utf-8')
        fixed_files += 1
        fixed_count += count
if fixed_count:
    print(f'iOS UTS Swift optional fix: {plugin_id} ({fixed_count})')
PY_FIX_IOS_UTS_SWIFT

    used_hosts+=("$host_dir")
    log "iOS 自定义 UTS 插件已挂载: $plugin_id -> $host_name"
  done

  log "iOS 自定义 UTS 插件联编数量: ${#plugin_sources[@]}"
}

verify_ios_custom_uts_plugins() {
  local ipa="$1"
  [ -f "$ipa" ] || die "IPA 不存在: $ipa"

  python3 - "$ipa" "$WORKSPACE" <<'PY_VERIFY_IOS_PLUGINS'
from pathlib import Path
import os
import re
import sys
import zipfile

ipa = Path(sys.argv[1])
workspace = Path(sys.argv[2])
resource_root = workspace / 'unpackage' / 'resources' / 'app-ios'

plugin_sources = []
for base in (resource_root / 'uni_modules', workspace / 'uni_modules'):
    if not base.is_dir():
        continue
    for plugin_dir in base.iterdir():
        src = plugin_dir / 'utssdk' / 'app-ios' / 'src'
        if src.is_dir():
            plugin_sources.append((plugin_dir.name, src))

plugins = {}
for plugin_id, src in plugin_sources:
    classes = set()
    for swift_file in src.rglob('*.swift'):
        text = swift_file.read_text(encoding='utf-8', errors='ignore')
        classes.update(re.findall(r'@objc\(([^)]+)\)', text))
        classes.update(re.findall(r'\bpublic\s+(?:final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)', text))
    plugins.setdefault(plugin_id, set()).update(classes)

native_names = set()
scan_roots = [workspace / 'nativeplugins', workspace / 'uni_modules', resource_root]
for root in scan_roots:
    if not root.is_dir():
        continue
    for current, dirs, files in os.walk(root):
        for dirname in dirs:
            if dirname.endswith(('.framework', '.xcframework', '.bundle')):
                native_names.add(dirname)
        for filename in files:
            if filename.endswith(('.a', '.dylib')):
                native_names.add(filename)

if not plugins and not native_names:
    print('未检测到 iOS 自定义 UTS/原生插件，跳过归档校验')
    raise SystemExit(0)

with zipfile.ZipFile(ipa) as archive:
    names = archive.namelist()
    framework_blobs = [
        archive.read(name)
        for name in names
        if name.startswith('Payload/') and '/Frameworks/' in name and not name.endswith('/')
    ]

missing = []
for plugin_id, classes in sorted(plugins.items()):
    for class_name in sorted(classes):
        needle = class_name.encode('utf-8')
        if not any(needle in blob for blob in framework_blobs):
            missing.append(f'{plugin_id}:{class_name}')

for native_name in sorted(native_names):
    if not any(native_name in name for name in names):
        missing.append(f'native:{native_name}')

if missing:
    print('iOS 自定义插件归档校验失败，缺少: ' + ', '.join(missing), file=sys.stderr)
    raise SystemExit(2)

parts = []
if plugins:
    plugin_parts = []
    for plugin_id, classes in sorted(plugins.items()):
        class_text = ','.join(sorted(classes)) if classes else '已编译'
        plugin_parts.append(f'{plugin_id}={class_text}')
    parts.append('UTS[' + '; '.join(plugin_parts) + ']')
if native_names:
    parts.append('原生资源[' + ','.join(sorted(native_names)) + ']')
print('iOS 自定义插件归档校验通过: ' + ' '.join(parts))
PY_VERIFY_IOS_PLUGINS
}

android_uts_package_map() {
  python3 - "$WORKSPACE" "$ANDROID_RESOURCE_DIR" <<'PY_ANDROID_PLUGIN_MAP'
from pathlib import Path
import re
import sys

workspace = Path(sys.argv[1])
android_resource = Path(sys.argv[2])
roots = [
    workspace / 'uni_modules',
    android_resource / 'uni_modules',
    workspace / 'app-android',
]

packages = {}

def plugin_id_from_path(path, root):
    parts = path.relative_to(root).parts
    if 'utssdk' in parts:
        return parts[parts.index('utssdk') - 1]
    if root.name == 'app-android' and parts:
        if parts[0] not in {'app', 'uniappx', 'gradle', 'buildSrc'}:
            return parts[0]
    return ''

for root in roots:
    if not root.is_dir():
        continue
    for source in list(root.rglob('*.kt')) + list(root.rglob('*.java')):
        rel = str(source)
        if '/utssdk/' not in rel and root.name == 'app-android':
            parts = source.relative_to(root).parts
            if not parts or parts[0] in {'app', 'uniappx', 'gradle', 'buildSrc'}:
                continue
            if 'src' not in parts:
                continue
            src_index = parts.index('src')
            if src_index + 1 >= len(parts) or parts[src_index + 1] != 'main':
                continue
        plugin_id = plugin_id_from_path(source, root)
        if not plugin_id:
            continue
        text = source.read_text(encoding='utf-8', errors='ignore')
        match = re.search(r'^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)', text, re.M)
        if match:
            packages.setdefault(plugin_id, set()).add(match.group(1))

for plugin_id, values in sorted(packages.items()):
    print(plugin_id + '\t' + ','.join(sorted(values)))
PY_ANDROID_PLUGIN_MAP
}

verify_android_custom_plugins() {
  local apk="$1"
  [ -f "$apk" ] || die "APK 不存在: $apk"

  local package_map
  package_map="$(android_uts_package_map)"

  python3 - "$apk" "$package_map" "$WORKSPACE" <<'PY_VERIFY_ANDROID_PLUGINS'
from pathlib import Path
import os
import sys
import zipfile

apk = Path(sys.argv[1])
package_rows = sys.argv[2].splitlines()
workspace = Path(sys.argv[3])

expected = {}
for row in package_rows:
    if not row.strip():
        continue
    plugin_id, packages = row.split('\t', 1)
    expected[plugin_id] = [item for item in packages.split(',') if item]

with zipfile.ZipFile(apk) as archive:
    dex_names = [name for name in archive.namelist() if name.startswith('classes') and name.endswith('.dex')]
    dex_blobs = [archive.read(name) for name in dex_names]

missing = []
for plugin_id, packages in sorted(expected.items()):
    for package in packages:
        descriptor = ('L' + package.replace('.', '/') + '/').encode('utf-8')
        if not any(descriptor in blob for blob in dex_blobs):
            missing.append(f'{plugin_id}:{package}')

native_count = 0
for root in (workspace / 'nativeplugins', workspace / 'uni_modules'):
    if not root.is_dir():
        continue
    for current, dirs, files in os.walk(root):
        native_count += sum(1 for name in files if name.endswith(('.aar', '.jar', '.so')))

if missing:
    print('Android 自定义插件归档校验失败，DEX 中缺少: ' + ', '.join(missing), file=sys.stderr)
    raise SystemExit(2)

if not expected and not native_count:
    print('未检测到 Android 自定义 UTS/原生插件，跳过归档校验')
    raise SystemExit(0)

with zipfile.ZipFile(apk) as archive:
    bad_entry = archive.testzip()
if bad_entry:
    print(f'Android APK 结构校验失败，损坏条目: {bad_entry}', file=sys.stderr)
    raise SystemExit(2)

parts = []
if expected:
    parts.append('UTS[' + '; '.join(f'{plugin}={",".join(packages)}' for plugin, packages in sorted(expected.items())) + ']')
if native_count:
    parts.append(f'非UTS原生插件文件[{native_count}，已随 Gradle 合并]')
print('Android 自定义插件归档校验通过: ' + ' '.join(parts))
PY_VERIFY_ANDROID_PLUGINS
}

report_harmony_custom_plugins() {
  local ids
  ids="$(list_uts_plugin_ids harmony | tr '\n' ' ')"
  if [ -z "$ids" ]; then
    log "未检测到 HarmonyOS 自定义 UTS 插件"
  else
    warn "检测到 HarmonyOS 自定义 UTS 插件，但当前尚未接入 HarmonyOS 打包归档校验: $ids"
  fi
}
