[English](README.md) | [简体中文](README.zh-CN.md)

# AppPackager

[![CI](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml/badge.svg)](https://github.com/lw0129a/dsh-app-packager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/app-packager.svg)](https://www.npmjs.com/package/app-packager)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Repository: <https://github.com/lw0129a/dsh-app-packager> (MIT)

A local, offline toolchain that turns uni-app x projects into **iOS IPA / Android APK / HarmonyOS HAP** builds. It keeps running the original way on macOS, and is also installable as an npm package and as a **DeepSeek Harness plugin** from the plugin market.

- **CLI** — `app-packager`, a dependency-free Node command line that delivers the bash packaging engine to `~/AppPackager` on your machine.
- **Plugin** — `dsh-app-packager`, four agent tools in DeepSeek Harness for *list projects / check environment / verify a platform / build*, so nobody has to memorise the command line.
- **Licence** — MIT.

> This repository ships no business project and contains no application source. Projects are read at runtime from `config/projects/*.env`, builds are copied into an isolated workspace, and artefacts are archived under `packages/`. SDKs, signing material, artefacts, workspaces and local configuration never enter Git.

## Quick start

### Option 1: command line

```bash
# install globally (or just use npx)
npm i -g app-packager
# or: pnpm add -g app-packager

app-packager init          # first run: copy the engine to ~/AppPackager and start the wizard
app-packager doctor        # what can this machine build?
app-packager list          # list the uni-app x projects found
app-packager register ~/work/shop   # register a project dir anywhere on disk
app-packager build android my-project --upload pgyer
app-packager build ios --all
```

Without installing anything:

```bash
npx app-packager doctor
npx app-packager build harmony my-project
```

The engine directory defaults to `~/AppPackager`; override it with the `APP_PACKAGER_HOME` environment variable or `--dir <path>`. The wizard registers uni-app x projects found next to it into `config/projects/`; `--search-roots` adds more directories to scan, and `app-packager register <path>` (or the panel's **Choose folder…** button) registers a project anywhere on disk.

### Option 2: DeepSeek Harness plugin

Install **AppPackager** from the Harness plugin market, or add the package to a profile directly (`dsh plugin` forwards its arguments to that profile's pnpm):

```bash
dsh plugin --profile desktop add dsh-app-packager
```

Restart the profile to mount the tools. Publishing and marketplace listing are documented in [docs/en/publishing.md](docs/en/publishing.md).

Once installed the agent can call four tools:

| Tool | What it does |
| --- | --- |
| `app_packager_list` | Lists configured projects, enabled platforms and whether each source directory exists |
| `app_packager_doctor` | Checks Node / shell bridge / Xcode / HBuilderX / JDK / Android SDK / DevEco Studio / project config |
| `app_packager_check` | Runs the engine's pre-build check for one platform (certificates, SDK, CLI) |
| `app_packager_build` | Builds (`ios` / `android` / `harmony` / `all`); no project means every enabled project of that platform, upload takes one or more targets (`pgyer,huawei`), version override |

The first call materialises the engine into `~/AppPackager`; `app_packager_doctor` works on Windows too.

### Web panel

The same plugin ships a browser half (`./client.js`), so a profile with the web UI gets an **AppPackager** row in the sidebar panel list and a page in the centre column:

- **Engine** — engine directory, version, materialised state and the detected bash bridge, with a one-click initialise.
- **Environment** — the same report as `app_packager_doctor`, for one platform or all, each failure carrying its fix hint.
- **Projects** — every `config/projects/*.env` with its source directory, enabled platforms and per-project *check* / *build* buttons.
- **Build scope** — batch platforms × projects (no project ticked = all of them), run back to back in one job and marked `▶ i/n` in the log.
- **Shared build options** — version override; upload targets read from the engine's `config/upload.env`, greyed out with a reason when unusable and sent as one comma separated `--upload`; *HarmonyOS debug HAP* and *Keep work dir* in an *Advanced* fold.
- **Jobs** — live engine output of the running check/build, its verdict (`[FAIL]` or a non-zero exit code means failure) and a stop button.

The panel talks to eight same-origin routes the host half registers (`/api/app-packager/state|init|doctor|pick|project|job|job/log|job/kill`); builds still run in the host process, never in the browser. A headless profile simply shows no panel — the four tools work everywhere.

## Platform support

| Capability | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env` (pure Node) | ✅ | ✅ | ✅ |
| Engine delivery, project discovery | ✅ | ✅ | ✅ |
| Android APK builds | ✅ | ⚠️ needs Git for Windows or WSL (HBuilderX + JDK must live in that environment) | ⚠️ same |
| HarmonyOS HAP builds | ✅ | ⚠️ same | ⚠️ same |
| iOS IPA builds | ✅ | ❌ (iOS can only be signed and packaged on macOS) | ❌ |

On Windows the CLI looks for Git Bash (`%ProgramFiles%\Git\bin\bash.exe`) and falls back to `wsl.exe`, translating paths as needed; `APP_PACKAGER_BASH` points at your own bash. Details in [docs/en/windows.md](docs/en/windows.md).

CI runs the unit tests and `init` / `list` / `doctor` smoke runs on `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22, so the pure-Node rows are exercised on all three systems. Real Android / HarmonyOS builds (which need HBuilderX plus a local JDK and Android SDK) are **not** covered by CI.

## Repository layout

```
packages/
  app-packager/            # CLI + packaging engine (engine/ is the original bash toolchain, kept as-is)
    bin/app-packager.mjs   # executable entry
    src/                   # home / projects / engine / doctor / cli
    engine/                # 打包工具.command, 初始化.command, lib/, config/, signing/ …
  dsh-app-packager/        # DeepSeek Harness plugin: four tools (index.js, web.js) + web panel (client.js)
.github/workflows/ci.yml   # three platforms × Node 18/20/22 + packaging checks
docs/en/                   # architecture, publishing, Windows notes
docs/zh-CN/                # the same documents in Chinese
AGENTS.md                  # rules for coding agents and maintainers
```

The engine (`packages/app-packager/engine/`) keeps the original project's layout and invocation exactly; its own [项目介绍.md](packages/app-packager/engine/项目介绍.md) remains the authoritative description of engine behaviour (Chinese, as before).

## Documentation

| Document | English | 中文 |
| --- | --- | --- |
| Architecture and modules | [architecture.md](docs/en/architecture.md) | [architecture.md](docs/zh-CN/architecture.md) |
| Publishing and marketplace listing | [publishing.md](docs/en/publishing.md) | [publishing.md](docs/zh-CN/publishing.md) |
| Windows / Linux | [windows.md](docs/en/windows.md) | [windows.md](docs/zh-CN/windows.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) | [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) |
| Engine behaviour | — (engine docs stay Chinese) | [项目介绍.md](packages/app-packager/engine/项目介绍.md) |

## Development

```bash
pnpm install
pnpm test          # node --test for both packages
pnpm docs:check    # documentation pairing and link check
pnpm cli list      # run the local CLI
pnpm doctor
```

Ground rules live in [AGENTS.md](AGENTS.md): engine changes must update the engine spec in the same commit, and every user-facing document exists in both languages.

## Licence

MIT © 2026 [lw0129a](https://github.com/lw0129a)
