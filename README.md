# AppPackager（打包工具）

[![CI](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml/badge.svg)](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/app-packager.svg)](https://www.npmjs.com/package/app-packager)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

仓库：<https://github.com/lw0129a/dsh-app-packager>（MIT 开源）

把 uni-app x 项目一键打成 **iOS IPA / Android APK / HarmonyOS HAP** 的本地离线工具链：现在既能按原来的方式在 macOS 上直接运行，也能作为 npm 包安装、作为 **DeepSeek Harness 插件**在插件市场安装使用。

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
app-packager build android my-project --upload pgyer
app-packager build ios --all
```

不安装也能开箱试用：

```bash
npx app-packager doctor
npx app-packager build harmony my-project
```

引擎目录默认 `~/AppPackager`，可用 `APP_PACKAGER_HOME` 环境变量或 `--dir <路径>` 指定。初始化向导会把同级目录下的 uni-app x 项目自动登记到 `config/projects/`；也可以用 `--search-roots` 追加扫描目录。

### 方式二：DeepSeek Harness 插件

在 Harness 的插件市场搜索 **AppPackager** 安装；也可以直接把包装进某个 profile（`dsh plugin` 会把参数透传给该 profile 的 pnpm）：

```bash
dsh plugin --profile desktop add dsh-app-packager
```

装好后需要重启该 profile 才会挂载下面的工具。上架与发布流程见 [docs/publishing.md](docs/publishing.md)。

安装后模型可直接调用四个工具：

| 工具 | 作用 |
| --- | --- |
| `app_packager_list` | 列出已配置项目、启用平台、源码目录是否有效 |
| `app_packager_doctor` | 检查 Node / shell 桥接 / Xcode / HBuilderX / JDK / Android SDK / DevEco Studio / 项目配置 |
| `app_packager_check` | 调用引擎对某平台做打包环境检查（证书、SDK、CLI） |
| `app_packager_build` | 执行打包（`ios` / `android` / `harmony` / `all`），可上传 pgyer、覆盖版本号 |

首次调用会自动把引擎物化到 `~/AppPackager`；`app_packager_doctor` 在 Windows 上同样可用。

## 平台支持

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env`（纯 Node） | ✅ | ✅ | ✅ |
| 引擎交付、项目扫描 | ✅ | ✅ | ✅ |
| Android APK 打包 | ✅ | ⚠️ 需 Git for Windows 或 WSL（HBuilderX + JDK 需在对应环境内） | ⚠️ 同上 |
| HarmonyOS HAP 打包 | ✅ | ⚠️ 同上 | ⚠️ 同上 |
| iOS IPA 打包 | ✅ | ❌（iOS 只能在 macOS 上签名打包） | ❌ |

Windows 上 CLI 会自动寻找 Git Bash（`%ProgramFiles%\Git\bin\bash.exe`）或回退到 `wsl.exe`，并做路径转换；可用 `APP_PACKAGER_BASH` 指定自己的 bash。细节见 [docs/windows.md](docs/windows.md)。

CI 在 `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22 上跑单测与 `init` / `list` / `doctor` 冒烟，所以纯 Node 那几行是三个系统实测过的；真机 Android / HarmonyOS 出包（需要 HBuilderX 与本机 JDK、Android SDK）没有 CI 覆盖。

## 仓库结构

```
packages/
  app-packager/            # CLI + 打包引擎（engine/ 为原 bash 工具链，原样保留）
    bin/app-packager.mjs   # 可执行入口
    src/                   # home / projects / engine / doctor / cli
    engine/                # 打包工具.command、初始化.command、lib/、config/、signing/…
  dsh-app-packager/        # DeepSeek Harness 宿主插件（四个工具）
.github/workflows/ci.yml   # 三平台 × Node 18/20/22 + 打包检查
docs/                      # 发布、插件市场上架、Windows 说明
```

引擎侧（`packages/app-packager/engine/`）保持原项目的目录布局和运行方式不变，原有文档 [项目介绍.md](packages/app-packager/engine/项目介绍.md) 仍是引擎行为的权威说明。

## 开发

```bash
pnpm install
pnpm test          # 两个包的 node --test 用例
pnpm cli list      # 直接跑本地 CLI
pnpm doctor
```

## 发布

npm 发布与插件市场上架步骤见 [docs/publishing.md](docs/publishing.md)。

## 许可

MIT © 2026 lw0129a
