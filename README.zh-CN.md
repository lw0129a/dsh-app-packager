[English](README.md) | 简体中文

# AppPackager（打包工具）

[![CI](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml/badge.svg)](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/app-packager.svg)](https://www.npmjs.com/package/app-packager)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

仓库：<https://github.com/lw0129a/dsh-app-packager>（MIT 开源）

把 uni-app x 项目一键打成 **iOS IPA / Android APK / HarmonyOS HAP** 的本地离线工具链：既能按原来的方式在 macOS 上直接运行，也能作为 npm 包安装、作为 **DeepSeek Harness 插件**在插件市场安装使用。

- CLI：`app-packager` —— 一个零运行时依赖的 Node 命令行，把打包引擎（bash）交付到你机器上的 `~/AppPackager`。
- 插件：`dsh-app-packager` —— 在 DeepSeek Harness 里用四个工具完成「看项目 / 查环境 / 检查 / 打包」，无需记命令。
- 开源协议：MIT。

> 本仓库不内置业务项目，不上传业务源码；项目在运行时从 `config/projects/*.env` 读取，构建复制到隔离工作区，产物归档到 `packages/`。SDK、签名、产物、工作区与本地配置都不进 Git。

## 快速开始

### 方式一：命令行

```bash
# 全局安装（也可以直接用 npx）
npm i -g app-packager
# 或 pnpm add -g app-packager

app-packager init          # 首次：把打包引擎复制到 ~/AppPackager，并进入初始化向导
app-packager doctor        # 检查这台机器能打哪些平台
app-packager list          # 列出已发现的 uni-app x 项目
app-packager register ~/work/shop   # 登记任意目录下的项目
app-packager build android my-project --upload pgyer
app-packager build ios --all
```

不安装也能开箱试用：

```bash
npx app-packager doctor
npx app-packager build harmony my-project
```

引擎目录默认 `~/AppPackager`，可用 `APP_PACKAGER_HOME` 环境变量或 `--dir <路径>` 指定。初始化向导会把同级目录下的 uni-app x 项目自动登记到 `config/projects/`；也可以用 `--search-roots` 追加扫描目录，或用 `app-packager register <路径>`（面板里的「选择目录…」按钮）登记磁盘上任意位置的项目。

### 方式二：DeepSeek Harness 插件

在 Harness 的插件市场搜索 **AppPackager** 安装；也可以直接把包装进某个 profile（`dsh plugin` 会把参数透传给该 profile 的 pnpm）：

```bash
dsh plugin --profile desktop add dsh-app-packager
```

装好后需要重启该 profile 才会挂载下面的工具。上架与发布流程见 [docs/zh-CN/publishing.md](docs/zh-CN/publishing.md)。

安装后模型可直接调用四个工具：

| 工具 | 作用 |
| --- | --- |
| `app_packager_list` | 列出已配置项目、启用平台、源码目录是否有效 |
| `app_packager_doctor` | 检查 Node / shell 桥接 / Xcode / HBuilderX / JDK / Android SDK / DevEco Studio / 项目配置 |
| `app_packager_check` | 调用引擎对某平台做打包环境检查（证书、SDK、CLI） |
| `app_packager_build` | 执行打包（`ios` / `android` / `harmony` / `all`）；不给项目即该平台全部已启用项目，上传可给多个平台（`pgyer,huawei`），可覆盖版本号 |

首次调用会自动把引擎物化到 `<插件目录>/home`（首次解析时会把已有的 `~/AppPackager` 改名搬进去，SDK 与已登记项目都跟着走）；`app_packager_doctor` 在 Windows 上同样可用。

### Web 面板

同一个插件还带浏览器侧代码（`./client.js`）：装了 Web 界面的 profile 会在侧栏面板列表里多一个 **应用打包** 入口，页面开在中栏：

- **引擎** —— 引擎目录、版本、是否已物化、探测到的 bash 桥接，缺引擎时一键初始化。
- **环境检查** —— 与 `app_packager_doctor` 同一份报告，可只查某个平台或全部，每个失败项都带修复提示。
- **项目** —— 登记/删除项目：可以一次选多个目录（「选择目录…」支持多选，也可以每行一个手动填），列出已登记项目的源码目录与启用的平台，每行带「删除」——两步确认后只删引擎目录里的 `config/projects/<id>.env`，不动项目源码。
- **打包范围** —— 打包的唯一入口：平台 × 项目批量打包（不勾项目 = 该平台全部项目），在一个任务里串行执行，日志用 `▶ i/n` 标出。**打包前会先按同一组项目与平台跑一次环境检查**，有 `[FAIL]` 就停下并把失败项列出来，让用户先处理，通过后才真正开始打包。
- **打包选项** —— 版本号；**全量权限**开关（默认跟随 `config/settings.env` 的 `FULL_PERMISSION_PROFILE`，可以只对这一次打包改）；**iOS 包型**（测试包 Ad Hoc / 正式包 App Store / development / enterprise，按项目 Bundle ID 挑描述文件，本机没有该类型时灰掉并说明原因）；**描述文件**下拉（列出签名目录里的 `.mobileprovision`，带包型、Bundle ID 与是否过期，留空＝按包型或项目接线自动选）；**自定义配置项**（每行一个 `KEY=VALUE` 覆盖打包参数，如 `MARKETING_VERSION=1.2.3`，可从项目自带的 `scripts/ios-package/env/*.env` 载入预设，路径类键不允许覆盖）；上传平台来自引擎的 `config/upload.env`，不可用的灰掉并注明原因，勾选的拼成一个逗号分隔的 `--upload`；*HarmonyOS debug 包* 与 *保留构建目录* 收进「高级选项」。
- **SDK** —— 读出本机 HBuilderX 与其版本系列，逐平台显示 SDK 状态（`ready` / `mismatch` / `missing`）与目录；「一键配置」按需下载并解压对应的 iOS / Android / HarmonyOS SDK，「处理已下载的 SDK」导入已经放在 `sdk/` 里的压缩包，每行还给 DCloud 官方下载页（iOS 另有系列推出的官方直链）。
- **升级插件** —— 把 `dsh-app-packager@latest` 装回当前 profile；升级期间引擎目录先改名让开，所以已下载的 SDK、证书与已登记项目不会被重装删掉。
- **任务** —— 当前 check/build 的实时引擎日志、判定结果（出现 `[FAIL]` 或非零退出码即失败）与「停止」按钮。

面板只调用宿主侧注册的九条同源路由（`/api/app-packager/state|init|doctor|pick|project|project/remove|job|job/log|job/kill`），打包始终在宿主进程里跑，不在浏览器里执行。headless profile 里不出现面板，四个工具照常可用。

## 平台支持

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env`（纯 Node） | ✅ | ✅ | ✅ |
| 引擎交付、项目扫描 | ✅ | ✅ | ✅ |
| Android APK 打包 | ✅ | ⚠️ 需 Git for Windows 或 WSL（HBuilderX + JDK 需在对应环境内） | ⚠️ 同上 |
| HarmonyOS HAP 打包 | ✅ | ⚠️ 同上 | ⚠️ 同上 |
| iOS IPA 打包 | ✅ | ❌（iOS 只能在 macOS 上签名打包） | ❌ |

Windows 上 CLI 会自动寻找 Git Bash（`%ProgramFiles%\Git\bin\bash.exe`）或回退到 `wsl.exe`，并做路径转换；可用 `APP_PACKAGER_BASH` 指定自己的 bash。细节见 [docs/zh-CN/windows.md](docs/zh-CN/windows.md)。

CI 在 `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22 上跑单测与 `init` / `list` / `doctor` 冒烟，所以纯 Node 那几行是三个系统实测过的；真机 Android / HarmonyOS 出包（需要 HBuilderX 与本机 JDK、Android SDK）没有 CI 覆盖。

## 仓库结构

```
packages/
  app-packager/            # CLI + 打包引擎（engine/ 为原 bash 工具链，原样保留）
    bin/app-packager.mjs   # 可执行入口
    src/                   # home / projects / engine / doctor / cli
    engine/                # 打包工具.command、初始化.command、lib/、config/、signing/…
  dsh-app-packager/        # DeepSeek Harness 插件：四个工具（index.js、web.js）+ Web 面板（client.js）
.github/workflows/ci.yml   # 三平台 × Node 18/20/22 + 打包检查
docs/zh-CN/                # 发布上架、Windows 说明、架构（中文）
docs/en/                   # 对应英文版
AGENTS.md                  # AI 助手与维护者规则
```

引擎侧（`packages/app-packager/engine/`）保持原项目的目录布局和运行方式不变，原有文档 [项目介绍.md](packages/app-packager/engine/项目介绍.md) 仍是引擎行为的权威说明。

## 文档

| 文档 | 中文 | English |
| --- | --- | --- |
| 架构与模块 | [architecture.md](docs/zh-CN/architecture.md) | [architecture.md](docs/en/architecture.md) |
| 发布与插件市场上架 | [publishing.md](docs/zh-CN/publishing.md) | [publishing.md](docs/en/publishing.md) |
| Windows / Linux | [windows.md](docs/zh-CN/windows.md) | [windows.md](docs/en/windows.md) |
| 参与贡献 | [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 引擎行为说明 | [项目介绍.md](packages/app-packager/engine/项目介绍.md) | —（引擎侧文档保持中文） |

## 开发

```bash
pnpm install
pnpm test          # 两个包的 node --test 用例
pnpm docs:check    # 中英文档配对与链接检查
pnpm cli list      # 直接跑本地 CLI
pnpm doctor
```

改动约定见 [AGENTS.md](AGENTS.md)（铁律：改引擎必须同提交更新引擎说明；中英文档必须成对）。

## 许可

MIT © 2026 [lw0129a](https://github.com/lw0129a)
