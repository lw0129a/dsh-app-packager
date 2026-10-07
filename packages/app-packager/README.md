# app-packager

把 uni-app x 项目一键打成 **iOS IPA / Android APK / HarmonyOS HAP** 的命令行工具，零运行时依赖（只用 Node 内置模块）。

它做两件事：

1. 把随包发布的打包引擎（原 `打包工具.command` 那一套 bash 工具链）物化到你机器上的引擎目录，默认 `~/AppPackager`；
2. 用 Node 直接做项目发现、环境体检，再把真正的打包动作交给引擎执行 —— macOS 用系统 bash，Windows 自动找 Git Bash 或 WSL。

## 安装

```bash
npm i -g app-packager
# 或
pnpm add -g app-packager
```

不安装也能用：

```bash
npx app-packager doctor
```

## 用法

```bash
app-packager init                 # 首次：释放引擎到 ~/AppPackager 并进入初始化向导
app-packager init --no-wizard     # 只要引擎，不进向导
app-packager doctor               # 体检：Node / bash / Xcode / HBuilderX / JDK / SDK / 项目配置
app-packager doctor --platform android
app-packager list                 # 列出已发现的 uni-app x 项目（读 config/projects/*.env）
app-packager env                  # 打印引擎目录、版本、shell 与扫描根

app-packager check android shop   # 只做某平台的打包前检查
app-packager build android shop   # 打包
app-packager build ios --all      # 所有启用了 iOS 的项目
app-packager build harmony shop --harmony-debug
app-packager build android shop --upload pgyer --version 1.2.0

app-packager ios shop             # 也可以省略 build，直接透传给引擎
app-packager run list             # 或显式透传任意引擎参数
```

### 选项

| 选项 | 说明 |
| --- | --- |
| `--dir <路径>` | 指定引擎目录（等价于环境变量 `APP_PACKAGER_HOME`，默认 `~/AppPackager`） |
| `--json` | `doctor` / `list` / `env` 输出 JSON，便于脚本消费 |
| `--search-roots <路径>` | 项目扫描根，多个用 `:` 分隔（默认引擎目录的父目录） |
| `--upload pgyer` / `--no-upload` | 打包后上传蒲公英 / 明确不上传 |
| `--version <版本号>` | 覆盖本次构建的版本号 |
| `--harmony-debug` | HarmonyOS 出 debug 包 |
| `--keep-work` | 保留本次的临时工作区 |
| `--force` | `init` 时强制覆盖引擎文件（本地配置、证书、SDK、产物始终保留） |
| `--no-wizard` | `init` 时不进交互向导 |

## 引擎目录

首次运行会把包内的 `engine/` 复制到引擎目录，并写一个 `.engine-version` 记录版本。之后：

- 包里引擎版本更高时，`init` 会更新引擎文件，**但不会动你的本地文件**：`config/settings.local.env`、`config/*.local.env`、`config/projects/*.env`（`.example` 除外）、`certificates/`、`signing/`、`sdk/`、`packages/`、`logs/`、`workspaces/` 都原样保留。
- 想全部重置用 `app-packager init --force`（用户文件依然保留）。
- 用 `APP_PACKAGER_HOME` 可以多套引擎目录并存，例如给不同业务线各一份配置。

项目配置、签名、SDK 的细节见引擎自带的 `项目介绍.md`。

## 平台支持

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env` | ✅ | ✅ | ✅ |
| Android APK / HarmonyOS HAP | ✅ | ⚠️ 需 Git for Windows 或 WSL | ⚠️ 需自备工具链 |
| iOS IPA | ✅ | ❌ | ❌ |

Windows 细节（bash 探测顺序、路径转换、为什么推荐 Git for Windows）见仓库里的 `docs/windows.md`。

## 开发

```bash
node --test test/
```

## 许可

MIT
