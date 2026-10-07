# Windows / Linux 说明

打包引擎是 bash + macOS 工具链（`xcodebuild`、`codesign`、`security`、`plutil`）。Node 这一层负责让它尽量在别的系统上也能用起来，能用到什么程度，本文说清楚。

## 一句话结论

| 平台 | 能不能用 | 靠什么 |
| --- | --- | --- |
| macOS | 完整（iOS / Android / HarmonyOS） | 系统 `/bin/bash` + 本机 Xcode / HBuilderX |
| Windows | Android / HarmonyOS 可用，iOS 不可用 | Git for Windows 的 `bash.exe`（推荐），或 WSL |
| Linux | Android / HarmonyOS 可用，iOS 不可用 | 系统 bash；HBuilderX 无 Linux 版，实际需在能跑它的环境里 |

`list` / `doctor` / `env` 是纯 Node 实现，三个平台无差别可用；`doctor` 会明确告诉你缺哪一个工具链。

## Windows：shell 桥接怎么找 bash

`app-packager` 在 Windows 上按下面顺序探测，命中即用：

1. 环境变量 `APP_PACKAGER_BASH` 指向的 `bash.exe`；
2. `%ProgramFiles%\Git\bin\bash.exe`（Git for Windows 默认位置）；
3. `%ProgramFiles(x86)%\Git\bin\bash.exe`；
4. `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`（用户级安装）；
5. `PATH` 上的 `bash.exe` / `bash`；
6. 都找不到时回退 `wsl.exe -e bash`（会先用 `wsl -e bash -lc true` 探一次可用性）。

调用引擎时会把引擎目录转成该 shell 认得的路径：

- Git Bash：反斜杠转正斜杠（`C:\Users\me\AppPackager` → `C:/Users/me/AppPackager`），Git Bash 两种分隔符都认；
- WSL：用 `wslpath -a` 转成 `/mnt/c/...`。

环境变量 `PIPELINE_ROOT` 指向引擎目录，`PROJECT_SEARCH_ROOTS` 指向项目扫描根（默认是引擎目录的父目录，多个用 `:` 连接），与引擎原本的约定一致。工作目录设为引擎目录，因此引擎自己派生的 `config/`、`logs/`、`packages/`、`workspaces/` 都落在那里。

指定自己的 bash：

```powershell
setx APP_PACKAGER_BASH "D:\tools\Git\bin\bash.exe"
```

找不到 bash 时报错是：

```
无法运行 bash 引擎：未找到 Git Bash 或 WSL。Windows 请安装 Git for Windows（推荐）或启用 WSL，或设置 APP_PACKAGER_BASH 指向 bash.exe。
```

## Windows：为什么推荐 Git for Windows 而不是 WSL

引擎要调用 **Windows 上的 GUI 工具链**：HBuilderX 的 `cli.exe`、JDK、Android SDK、DevEco Studio。这些程序在 Git Bash 里直接用 `/c/...` 路径就能调起来，和原工具链在 macOS 上的用法最接近。

WSL 里跑 bash 时，Windows 程序虽然能通过 `/mnt/c/...` 调用，但路径、大小写、换行与 Gradle/HBuilderX 的工作目录行为都容易出岔子；HBuilderX 也没有 Linux 版，WSL 里装不了。所以：

- 想在 Windows 上真的出 Android APK / HarmonyOS HAP：装 **Git for Windows**，并在 Windows 侧装好 HBuilderX、JDK、Android SDK；
- WSL 只作为兜底（例如你确实把整套工具链装在 WSL 里），路径转换由 `wslpath` 负责。

## Windows：配置要点

1. 装 Git for Windows（勾选 "Add Git Bash to PATH" 更省事）。
2. 装 HBuilderX，并把 `HBUILDERX_CLI` 指到 `cli.exe` 的真实路径；引擎侧的配置写在 `<引擎目录>/config/settings.env` 或 `config/settings.local.env`（后者是本地覆盖，不会被升级覆盖）。
3. JDK / Android SDK：设 `ANDROID_SDK_DIR`，或放到默认位置（macOS 默认是 `~/Library/Android/sdk`，Windows 下请在 `config/settings.local.env` 里显式指定）。
4. 路径里尽量别用中文与空格；引擎侧的引号处理虽然在，但 Windows 上多一层转换就多一处风险。

先跑一遍体检，缺什么它会说：

```powershell
app-packager doctor
app-packager doctor --platform android
```

## Linux

系统 bash 直接可用（`kind: 'native'`）。Android / HarmonyOS 的检查项与其他平台一致，但 HBuilderX 官方没有 Linux 版，所以 Linux 上的定位是"能跑纯 Node 命令 + 检查 + 调用你自备的工具链"，不是主要使用场景。

## iOS 为什么只能在 macOS

`lib/` 里 33 处 `security`、15 处 `plutil`、11 处 `xcodebuild`、4 处 `codesign`，签名与描述文件校验都走 Keychain 和 `codesign`，没有等价的跨平台替代。非 macOS 上 `doctor` 会直接把 iOS 标为失败，不会给出误导性的"可用"。

想在 Windows 上出 IPA，现实做法是起一台 macOS 构建机（或在 macOS 上跑 `app-packager build ios`），Windows 只做 Android / HarmonyOS。

## 换行与编码

- 引擎脚本是 LF 换行；如果你用编辑器改 `engine/` 下的文件，别把它存成 CRLF，否则 Git Bash 下会出现 `bad interpreter` 一类错误。
- 输出编码统一按 UTF-8 解析（`LANG` 默认 `zh_CN.UTF-8`）；Windows 终端若显示乱码，先 `chcp 65001`。
