[English](README.md) | 简体中文

# app-packager

一条命令把 uni-app x 项目打成 **iOS IPA / Android APK / HarmonyOS HAP**。零运行时依赖，只用 Node 内置模块。

它做两件事：

1. 把包内自带的打包引擎（原 `打包工具.command` bash 工具链）释放到引擎目录，默认 `~/AppPackager`；
2. 用 Node 完成项目发现与环境体检，真正的打包转发给引擎 —— macOS 走系统 bash，Windows 走 Git Bash 或 WSL。

完整文档见[仓库说明](https://github.com/lw0129a/dsh-app-packager#readme)。

## 安装

```bash
npm i -g app-packager
# 或
pnpm add -g app-packager
```

不安装直接跑：

```bash
npx app-packager doctor
```

## 用法

```bash
app-packager init                 # 首次：释放引擎到 ~/AppPackager 并进入初始化向导
app-packager init --no-wizard     # 只释放引擎，不走向导
app-packager doctor               # 体检：Node / bash / Xcode / HBuilderX / JDK / SDK / 项目配置
app-packager doctor --platform android
app-packager list                 # 列出已发现的 uni-app x 项目（读 config/projects/*.env）
app-packager register ~/work/shop  # 登记项目目录（给父目录则扫描其下一层）
app-packager env                  # 打印引擎目录、版本、shell 与扫描根

app-packager check android shop   # 打包前检查某平台
app-packager build android shop   # 打包
app-packager build ios --all      # 打所有启用 iOS 的项目
app-packager build harmony shop --harmony-debug
app-packager build android shop --upload pgyer --version 1.2.0

app-packager upload ios shop             # 只上传「上一次打包」归档的安装包，不重新打包
app-packager upload all shop --to pgyer  # --to 指定分发平台，可逗号分隔

app-packager ios shop             # 可省略 build，参数直接透传给引擎
app-packager run list             # 或用 run 显式转发任意引擎参数

app-packager sdk status           # 读出 HBuilderX 版本与各平台 SDK 状态（JSON）
app-packager sdk urls             # 同一份信息的人读版：官方下载入口清单
app-packager sdk install ios      # 下载并解压对应系列的 iOS SDK（加 --yes 免交互）
app-packager sdk process          # 处理你自己放进 sdk/ 的压缩包
```

### 选项

| 选项 | 说明 |
| --- | --- |
| `--dir <路径>` | 引擎目录（等同 `APP_PACKAGER_HOME`，默认 `~/AppPackager`） |
| `--json` | `doctor` / `list` / `env` 输出 JSON，便于脚本处理 |
| `--search-roots <路径>` | 项目扫描根，`:` 分隔（默认引擎目录的上一级） |
| `--upload pgyer` / `--no-upload` | 打包后上传 pgyer / 明确不上传 |
| `--to pgyer` | `upload` 动作的分发平台，可逗号分隔；不写则用 `config/upload.env` 里已启用的平台 |
| `--version <版本>` | 覆盖打包版本号 |
| `--harmony-debug` | 打 HarmonyOS 调试侧载包 |
| `--keep-work` | 保留本次临时工作区 |
| `--force` | `init`：覆盖引擎文件（本地配置、证书、SDK、产物始终保留） |
| `--no-wizard` | `init`：跳过交互向导 |

### 蒲公英上传

`--upload pgyer` 需要本机的蒲公英 API Key：优先读环境变量 `PGYER_API_KEY`（面板里保存的 Key 会写进引擎目录的 `config/upload.local.env`），其次读 macOS Keychain（service `app-packager-pgyer`），最后才在交互终端里问。iOS/Android 产物走蒲公英官方 CLI `@pgyer/cli` 的快速上传，CLI **不预装、不装全局**，第一次真的上传时才用 `npm install` 装进引擎目录内部的 `tools/pgyer-cli`（需要 Node.js 18+ 与 npm；`PGYER_CLI_DIR` 可改位置，`PGYER_CLI_VERSION` 默认 `0.1.5`）。HarmonyOS HAP 仍走接口上传，因为蒲公英要求 HAP 随包上传 P12 证书，而官方 CLI 没有这一步。

上传是一条独立流程：`app-packager upload <平台> <项目> [--to 平台]` 把**上一次打包**归档好的安装包送出去（`packages/<平台>/<项目ID>-latest.json` 指向的那个文件），完全不重新打包；还没有打包记录时只会提示一句。打包时顺手勾的上传仍然「失败不影响打包结果」，而这条独立动作如实返回上传结果——「跳过」也算失败（没有归档、构建信息缺 `platform`、provider 缺失或未启用），不会静悄悄报成功；面板的「上传」板块就是按这个语义做的。蒲公英的 **User Key**（API 1.0 的 `uKey`）是可选项，只有接口上传会用到：官方 CLI 与 API 2.0 都只认 API Key。写进 `config/upload.local.env` 的 `PGYER_USER_KEY` 即可（对应 `UPLOAD_PLATFORM_pgyer_USER_KEY_VAR`），填了之后 HAP 的接口请求会带上 `_u_key`。

## 引擎目录

首次运行会把包内 `engine/` 复制到引擎目录，并写入 `.engine-version` 记录版本。之后：

- 包内引擎更新时，`init` 只更新引擎文件，**不动你的本地文件**：`config/settings.local.env`、`config/*.local.env`、`config/projects/*.env`（`.example` 除外）、`certificates/`、`signing/`、`sdk/`、`packages/`、`logs/`、`workspaces/` 都保持原样；
- 需要完全重置时用 `app-packager init --force`（用户文件仍然保留）；
- `APP_PACKAGER_HOME` 可以让多个引擎目录共存，例如按业务线各一份。

项目配置、签名与 SDK 的细节见引擎自带的 `项目介绍.md`。

## 平台支持

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env` | ✅ | ✅ | ✅ |
| Android APK / HarmonyOS HAP | ✅ | ⚠️ 需 Git for Windows 或 WSL | ⚠️ 需自备工具链 |
| iOS IPA | ✅ | ❌ | ❌ |

Windows 的细节（bash 探测顺序、路径转换、为什么推荐 Git for Windows 而不是 WSL）见 [`docs/zh-CN/windows.md`](../../docs/zh-CN/windows.md)。

## 开发

```bash
node --test test/
```

## 许可

MIT
