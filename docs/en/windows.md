[English](windows.md) | [简体中文](../zh-CN/windows.md)

# Windows / Linux notes

The packaging engine is bash plus the macOS toolchain (`xcodebuild`, `codesign`, `security`, `plutil`). The Node layer exists to make it usable elsewhere; this page is precise about how far that goes.

## Summary

| Platform | Works? | How |
| --- | --- | --- |
| macOS | Fully (iOS / Android / HarmonyOS) | system `/bin/bash` + local Xcode / HBuilderX |
| Windows | Android / HarmonyOS yes, iOS no | Git for Windows `bash.exe` (recommended), or WSL |
| Linux | Android / HarmonyOS yes, iOS no | system bash; HBuilderX has no Linux build, so it needs an environment that can run it |

`list` / `doctor` / `env` are pure Node and behave identically on all three. `doctor` tells you exactly which toolchain is missing.

What is actually tested: every push runs the unit tests on `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18 / 20 / 22, plus `init` / `list` / `doctor` smoke runs on Windows and macOS/Linux. The Node-layer rows above are covered that way. Real Android / HarmonyOS builds are **not** covered — CI has no HBuilderX, JDK or Android SDK, so that part is on your machine.

## Windows: how the shell bridge finds bash

On Windows `app-packager` probes in this order and uses the first hit:

1. `bash.exe` pointed at by `APP_PACKAGER_BASH`;
2. `%ProgramFiles%\Git\bin\bash.exe` (default Git for Windows location);
3. `%ProgramFiles(x86)%\Git\bin\bash.exe`;
4. `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` (per-user install);
5. `bash.exe` / `bash` on `PATH`;
6. otherwise `wsl.exe -e bash` (after a `wsl -e bash -lc true` liveness probe).

The engine directory is translated into a path that shell understands:

- Git Bash: backslashes become forward slashes (`C:\Users\me\AppPackager` → `C:/Users/me/AppPackager`); Git Bash accepts either separator;
- WSL: `wslpath -a` turns it into `/mnt/c/...`.

The engine is invoked with `PIPELINE_ROOT` pointing at the engine directory and `PROJECT_SEARCH_ROOTS` at the project search root (default: the parent of the engine directory, `:`-separated for several), matching the engine's own convention. The working directory is the engine directory, so `config/`, `logs/`, `packages/` and `workspaces/` the engine derives all land there.

Pick your own bash:

```powershell
setx APP_PACKAGER_BASH "D:\tools\Git\bin\bash.exe"
```

When no bash is found:

```
无法运行 bash 引擎：未找到 Git Bash 或 WSL。Windows 请安装 Git for Windows（推荐）或启用 WSL，或设置 APP_PACKAGER_BASH 指向 bash.exe。
```

## Windows: why Git for Windows over WSL

The engine drives **Windows GUI toolchains**: HBuilderX's `cli.exe`, the JDK, the Android SDK, DevEco Studio. Under Git Bash those are invoked with plain `/c/...` paths, closest to how the original toolchain is used on macOS.

Under WSL, Windows programs are reachable via `/mnt/c/...`, but paths, casing, line endings and the working-directory behaviour of Gradle/HBuilderX go wrong easily; HBuilderX also has no Linux build, so it cannot be installed inside WSL. Therefore:

- to really produce Android APKs / HarmonyOS HAPs on Windows, install **Git for Windows** and HBuilderX, the JDK and the Android SDK on the Windows side;
- WSL is a fallback only (for example when the whole toolchain really lives inside WSL); path translation is handled by `wslpath`.

## Windows: configuration checklist

1. Install Git for Windows (tick "Add Git Bash to PATH" — it saves trouble).
2. Install HBuilderX and point `HBUILDERX_CLI` at the real `cli.exe`; engine config lives in `<engine dir>/config/settings.env` or `config/settings.local.env` (the latter is your local override and survives upgrades).
3. JDK / Android SDK: set `ANDROID_SDK_DIR`, or use the default location (macOS defaults to `~/Library/Android/sdk`; on Windows set it explicitly in `config/settings.local.env`).
4. Avoid non-ASCII characters and spaces in paths. The engine quotes properly, but every extra conversion layer on Windows is another risk.

Run the health check first — it names what is missing:

```powershell
app-packager doctor
app-packager doctor --platform android
```

## Linux

System bash is used directly (`kind: 'native'`). Android / HarmonyOS checks are the same as elsewhere, but HBuilderX ships no Linux build, so Linux is positioned as "pure Node commands + checks + whatever toolchain you supply", not a primary target.

## Why iOS is macOS-only

`lib/` contains 33 `security`, 15 `plutil`, 11 `xcodebuild` and 4 `codesign` call sites; signing and provisioning validation go through the Keychain and `codesign`, with no cross-platform equivalent. On non-macOS hosts `doctor` marks iOS as failed rather than reporting a misleading "available".

To ship an IPA from Windows, run a macOS build machine (or `app-packager build ios` on macOS) and keep Windows for Android / HarmonyOS.

## Line endings and encoding

- Engine scripts are LF. If you edit files under `engine/`, do not save them as CRLF, or Git Bash will fail with `bad interpreter`.
- Output is decoded as UTF-8 (`LANG` defaults to `zh_CN.UTF-8`); on a Windows terminal, run `chcp 65001` if you see mojibake.
