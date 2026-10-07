# AppPackager

`AppPackager（打包工具）` 是一个运行在 macOS 上的本地离线打包工具，用于把本机已有的 uni-app x 项目打成：

- iOS `IPA`
- Android `APK`
- HarmonyOS `HAP`

本仓库不包含任何业务项目源码、业务项目路径、AppID、Bundle ID、签名证书或打包产物。uni-app 项目在运行时通过本地配置读取，和本工具仓库解耦。

> 独立性声明：`AppPackager` 是独立的新项目，不依赖、不读取、不复制、不关联旧打包项目。项目配置、SDK、签名、日志和产物均独立维护在本项目目录内。


完整说明见 [`项目介绍.md`](./项目介绍.md)。

官方 SDK 地址：

- iOS: https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html
- iOS 5.26 直链: https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%405.26.zip
- Android: https://doc.dcloud.net.cn/uni-app-x/native/download/android.html
- HarmonyOS: https://doc.dcloud.net.cn/uni-app-x/native/use/harmony.html



## 功能

- 多项目动态读取，不在代码中写死项目。
- 初始化向导自动检测 HBuilderX、Xcode、Android Studio、DevEco Studio 和本机依赖。
- 证书目录统一管理 iOS、Android、HarmonyOS 证书，并提供证书创建文档。
- iOS、Android、HarmonyOS 统一菜单入口，菜单上方直接展示已读取项目名称、支持平台和源码地址。
- 选择具体项目后只预检该项目已启用的平台，避免未启用平台阻断当前打包；Android 会实际启动 Gradle，并检查 apksigner/zipalign。
- 指定平台没有可打包项目时，会进入项目读取流程，支持扫描同级目录或输入项目绝对路径。
- 使用隔离工作区，不直接修改业务源码。
- HBuilderX 静默编译，不把构建项目导入编辑器窗口。
- 支持 iOS Profile、p12、Keychain 和临时 Keychain；项目配置优先，缺失时从 `certificates/iOS/` 按 Bundle ID 匹配 Profile 和同组 p12。
- 支持 Android 本地离线 Gradle 构建；项目 signingConfig 优先，缺失时使用 `certificates/Android/`，归档前执行 apksigner 与 zipalign 校验。
- 支持 HarmonyOS 通过 HBuilderX 本地生成 HAP；项目 signingConfigs 优先，缺失时使用 `certificates/HarmonyOS/`，证书文件只读且不修改。
- 按配置把全量 Android/iOS 权限合并到隔离副本；Android 运行权限申请列表从最终 manifest 派生；平台未配置图标或启动页时直接使用 uni-app 默认资源。
- 自定义插件处理不写死插件名称：无 UTS 时跳过，多个 UTS/原生插件逐项处理；iOS 校验归档类与原生资源，Android 从最终 APK DEX 校验插件包。
- 打包前会在菜单顶部显示 SDK 缺失警告，缺少 SDK 时阻止对应平台构建。
- 安装包统一归档，只保留最近若干份构建。
- 多项目/多平台打包使用并行调度，HBuilderX、Xcode、Gradle 各自有可配置资源闸门，默认不会并发启动重型工具。
- 安装包上传作为独立扩展：菜单可在打包前多选上传平台，当前支持蒲公英；上传失败不影响打包结果。
- 证书导入器支持传入任意来源目录，按平台归入 `iOS/`、`Android/`、`HarmonyOS/`，同名同内容自动去重。
- 提供环境检查、项目状态、诊断报告和局域网下载服务；CLI 批量构建/检查会正确返回失败退出码。

## 环境要求

- macOS
- Xcode 和 Command Line Tools
- Android Studio
- DevEco Studio（鸿蒙）
- HBuilderX（含 CLI）
- 本地 UniAppX iOS SDK
- Android SDK
- Gradle
- Node.js、npm、Python 3
- curl（上传安装包时使用）
- rsync、openssl、plutil、security、codesign、keytool、apksigner、zipalign、ditto、shasum

## 快速开始

1. 双击 `初始化.command`。

初始化向导会：

- 检测 HBuilderX 是否安装，并读取 HBuilderX 版本。
- 根据 HBuilderX 版本匹配 Android/iOS/HarmonyOS SDK 系列。
- 打开 DCloud 官方 SDK 下载页并列出官方下载入口。
- 初始化向导支持直接输入 SDK 压缩包路径或下载 URL，也可以把压缩包/解压目录直接放到 `sdk/`，再运行 `sdk/处理SDK.command`。
- 主菜单 `14. 更新/处理 SDK` 也可以执行同一套 SDK 归位处理。
- 检测 Xcode、Android Studio、DevEco Studio。
- 检查 Node、Python、Gradle、Android SDK、Xcode Command Line Tools、Keychain 等依赖。
- 导入或更新证书，来源目录只复制不移动；支持初始化时传入来源目录，也支持自动扫描 `certificates/`。
- 刷新已注册项目的 iOS Profile，再扫描同级目录读取 uni-app x 项目并生成 `config/projects/*.env`；也支持手动输入其他绝对路径。
- 可选使用 DevEco `ohpm` 安装 HarmonyOS runtime。
- 生成本机专用配置 `config/settings.local.env`，并确保 `config/upload.local.env`、`config/parallel.local.env` 存在；这些文件不会提交到 Git。

2. 如果采用手动配置，也可以复制项目模板：

```bash
cp config/projects/project.env.example config/projects/my-project.env
```

建议优先把 uni-app x 项目放在与 AppPackager 同级目录。运行 `初始化.command` 时会自动发现并写入 `config/projects/*.env`；模板仅用于自动发现失败或需要自定义配置时。

3. 运行 `certificates/处理证书.command` 导入证书，或在主菜单选择 `15. 更新/处理证书`。可以传入任意来源目录：

```bash
./certificates/处理证书.command "/absolute/path/to/cert-dir"
```

工具会按平台把证书复制到 `certificates/iOS/`、`certificates/Android/`、`certificates/HarmonyOS/`，来源目录不会移动或删除；打包时从这些平台目录递归读取。

4. 配置 iOS 签名：

```bash
./setup-signing.sh \
  --p12 <证书.p12> \
  --profile my-project=<项目.mobileprovision>
```

5. Android 如需正式 release 签名，通过 `处理证书.command` 导入，或平铺放置：

```text
certificates/Android/release.keystore
certificates/Android/keystore.properties
```

未配置时继续沿用业务项目自己的签名配置。若项目仍使用 `debug.keystore`，构建完成信息和 `build-info.json` 会标记为测试签名。

6. 双击 `打包工具.command`，按菜单操作。

项目名称为 `AppPackager`，界面和命令行中文名称保留为“打包工具”。

兼容旧入口：

```text
一键打包.command
```

旧入口会自动转发到 `打包工具.command`。

## 命令行

```bash
# iOS
./打包工具.command ios <项目ID>

# Android
./打包工具.command android <项目ID>

# HarmonyOS
./打包工具.command harmony <项目ID>

# iOS 全部已启用项目
./打包工具.command ios --all

# Android 全部已启用项目
./打包工具.command android --all

# HarmonyOS 全部已启用项目
./打包工具.command harmony --all

# HarmonyOS 正常打包（使用项目 release signingConfig）
./打包工具.command harmony <项目ID>
./打包工具.command harmony --all

# HarmonyOS 蒲公英内测分发（要求 release + internaltesting Profile）
./打包工具.command harmony <项目ID> --upload pgyer

# 显式生成 debug 侧载测试包
./打包工具.command harmony <项目ID> --harmony-debug

# 全部平台全部已启用项目
./打包工具.command all

# 指定项目全部平台
./打包工具.command all <项目ID>

# 查看项目
./打包工具.command list

# 检查环境；批量检查中任一项失败会返回非 0 退出码
./打包工具.command check ios <项目ID>
./打包工具.command check android <项目ID>
./打包工具.command check harmony <项目ID>
./打包工具.command check all

# 打包成功后上传到蒲公英
./打包工具.command android <项目ID> --upload pgyer
./打包工具.command ios --all --upload pgyer
# HarmonyOS 蒲公英内测分发（使用项目 release 签名配置）
./打包工具.command harmony <项目ID> --upload pgyer

# 多个上传平台可用逗号分隔
./打包工具.command android <项目ID> --upload pgyer,other-provider

# 显式跳过上传
./打包工具.command android <项目ID> --no-upload

# 覆盖版本号
./打包工具.command ios <项目ID> --version 1.0.1-test
```

## 安装包上传

主菜单在环境预检完成后询问是否上传，并以列表展示启用中的上传平台，可多选。上传逻辑位于 `lib/upload.sh` 和 `lib/uploaders/`，与签名、打包逻辑解耦。

当前支持蒲公英上传 iOS IPA、Android APK 和 HarmonyOS HAP；HAP 发布需要发布证书 P12、“指定设备发布”Profile（包含测试设备 UDID）和 P12 明文密码。蒲公英配置兼容原 `uni-platform-app` 的 `PGYER_API_KEY`、`PGYER_UPDATE_DESCRIPTION` 字段，未复制企业微信、Web 构建或 Docker 推送逻辑。上传平台和通用参数在 `config/upload.env` 中人工维护，当前已预留蒲公英、App Store、华为应用市场、小米应用市场、应用宝；API Key、Token、证书密码等本机敏感配置放在 `config/upload.local.env`：

```bash
cp config/upload.local.env.example config/upload.local.env
# 编辑 config/upload.local.env
```

也可以使用 macOS Keychain（service `app-packager-pgyer`）：

```bash
security add-generic-password -U -a "$USER" -s app-packager-pgyer -w
```

HarmonyOS HAP 需要使用发布证书 P12 和“指定设备发布”Profile 签名；`--harmony-debug` 仅用于本地侧载，不用于蒲公英。HAP 上传还需要额外配置 P12 明文密码：

```bash
security add-generic-password -U -a "$USER" -s app-packager-pgyer-harmony-p12 -w
```

上传结果写入对应包的 `build-info.json` 的 `uploads` 字段，原始响应和日志位于 `logs/uploads/<平台>/`。上传失败只警告，不影响已经生成的安装包。未选择上传平台时终端会列出成功产物的文件地址；选择任意上传平台后不再展开这些地址。

## HarmonyOS 临时安装补丁

`[TEMP-10021]` 默认关闭：正常 `harmony` 打包使用项目原有 `release` signingConfig 和 `pack app-harmony`。如需临时生成真机侧载 debug 包，使用 `--harmony-debug`，或把 `HARMONY_TEMP_FORCE_INSTALL_SIGNING` 改为 `true`；该模式使用项目原始 `signingConfigs.default`，不修改源项目、不修改证书，产物入口为 `<项目ID>-latest-install.hap`。选择蒲公英上传时始终跳过测试补丁。

`[PGYER-17700015]` 默认启用：选择蒲公英上传时，AppPackager 使用项目的 release/internal testing 签名配置，并将 HAP 的 `targetSdkVersion` 对齐蒲公英安装 manifest 的 `5.0.1(13)`，规避蒲公英安装错误 `17700015`。该兼容模式仍保留 Release 证书、`internaltesting` Profile 和设备 UDID，不修改源项目或证书。项目可在 `config/projects/<项目ID>.env` 中配置 `HARMONY_VERSION_CODE` 覆盖 HAP 版本号；构建后会自动校验 release、目标 API、Profile 和设备列表，不满足即失败。

## 并行构建

多项目/多平台打包默认启用阶段式并行调度：工作区准备和上传阶段可以并行，HBuilderX/Xcode/Gradle 默认分别限制为 1 个重型任务，避免编辑器或电脑资源被瞬时打满。一个项目进入 HBuilderX/Xcode/Gradle 阶段后，其他项目可以先进入工作区准备或资源处理队列。

配置位于：

```text
config/parallel.env
config/parallel.local.env
```

常用项：

```bash
PARALLEL_BUILD_ENABLED="true"
PARALLEL_MAX_JOBS="auto"
PARALLEL_MAX_IOS_JOBS="2"
PARALLEL_MAX_ANDROID_JOBS="2"
PARALLEL_MAX_HARMONY_JOBS="2"
PARALLEL_MAX_HBULDERX_JOBS="1"
PARALLEL_MAX_XCODE_JOBS="1"
PARALLEL_MAX_GRADLE_JOBS="1"
PARALLEL_MAX_PREPARE_JOBS="2"
PARALLEL_MAX_UPLOAD_JOBS="2"
PARALLEL_GRADLE_WORKERS="2"
PARALLEL_QUEUE_REFRESH_SECONDS="1"
PARALLEL_LIVE_QUEUE_DISPLAY="true"
```

终端会按平台分块显示队列，并显示 `排队中`、`进行中`、`等待中`、`成功`、`失败` 状态、进度条和当前阶段。

`config/parallel.local.env` 已加入 `.gitignore`，可针对不同电脑覆盖配置。自动调优默认按内存保守限制：8GB 以下总并发 1，32GB 以下最多 2，32GB 及以上最多 3。并行任务不进行交互式密码输入，批量上传前请先把 API Key、P12 密码写入 `config/upload.local.env` 或 Keychain。

## 项目配置

初始化时会扫描打包工具同级目录，自动识别满足以下条件的项目：

```text
manifest.json + pages.json
或
src/manifest.json + src/pages.json
```

识别成功后自动生成：

```text
config/projects/<项目ID>.env
```

运行时同样读取这些配置。手动模板：

```text
config/projects/project.env.example
```

`config/projects/*.env` 已加入 `.gitignore`，本地项目路径和配置不会上传到 GitHub。项目读取支持根目录和 `src/` 两种布局，后续资源、权限、版本和签名补丁统一使用实际布局路径。

## 产物

构建产物统一放在：

```text
packages/
├── iOS/
├── Android/
└── HarmonyOS/
```

每个项目提供 `latest` 快捷入口：

```text
packages/iOS/<项目ID>-latest.ipa
packages/Android/<项目ID>-latest.apk
packages/HarmonyOS/<项目ID>-latest.hap
```

默认只保留最近 5 份构建文件夹和日志。

## GitHub 上传规则

以下内容默认不会提交：

- 本机初始化配置：`config/settings.local.env`、`config/init.local.env`、`config/upload.local.env`、`config/parallel.local.env`
- 本地 uni-app 项目配置：`config/projects/*.env`
- 构建工作区：`workspaces/`
- 实际 SDK 内容：`sdk/iOS/`、`sdk/Android/`、`sdk/HarmonyOS/`、`sdk/_processed/`
- 安装包产物：`packages/`
- 签名证书和 Profile：`signing/current/`、`*.p12`、`*.mobileprovision`
- 临时文件：`.tmp/`
- Python 缓存：`__pycache__/`
- 日志内容：`logs/*`，仅保留 `logs/.gitkeep`
- macOS 和编辑器生成文件

## 文档维护

只要修改本项目的脚本、配置、项目读取方式、权限、依赖、操作流程、产物结构或签名规则，就必须同步更新：

```text
项目介绍.md
```

项目内已通过以下文件固化该规则：

```text
AGENTS.md
.cursor/rules/project-docs.mdc
```

处理脚本在 SDK 缺失或文件无法识别时，会直接输出对应平台的官方页面、官方直链或 ohpm 包名。
