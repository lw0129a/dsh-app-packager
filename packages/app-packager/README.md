[English](README.md) | [简体中文](README.zh-CN.md)

# app-packager

One-command builds of **iOS IPA / Android APK / HarmonyOS HAP** from uni-app x projects. Zero runtime dependencies — Node built-ins only.

It does two things:

1. materialises the packaging engine shipped inside the package (the original `打包工具.command` bash toolchain) into an engine directory, `~/AppPackager` by default;
2. does project discovery and environment checks in Node, then hands the actual build to the engine — system bash on macOS, Git Bash or WSL on Windows.

Full documentation: [repository README](https://github.com/lw0129a/dsh-app-packager#readme).

## Install

```bash
npm i -g app-packager
# or
pnpm add -g app-packager
```

Or run it without installing:

```bash
npx app-packager doctor
```

## Usage

```bash
app-packager init                 # first run: unpack the engine into ~/AppPackager and start the wizard
app-packager init --no-wizard     # engine only, no wizard
app-packager doctor               # health check: Node / bash / Xcode / HBuilderX / JDK / SDK / project config
app-packager doctor --platform android
app-packager list                 # list discovered uni-app x projects (reads config/projects/*.env)
app-packager register ~/work/shop  # register a project dir (a parent dir is scanned one level down)
app-packager env                  # print engine dir, version, shell and search roots

app-packager check android shop   # pre-build check for one platform
app-packager build android shop   # build
app-packager build ios --all      # every project with iOS enabled
app-packager build harmony shop --harmony-debug
app-packager build android shop --upload pgyer --version 1.2.0

app-packager ios shop             # `build` may be omitted; the argument is forwarded to the engine
app-packager run list             # or forward arbitrary engine arguments explicitly

app-packager sdk status           # HBuilderX version + each platform's SDK state as JSON
app-packager sdk urls             # the same, as a human readable list of download entries
app-packager sdk install ios      # download and unpack the matching iOS SDK (--yes for no prompts)
app-packager sdk process          # import archives you already put in sdk/
```

### Options

| Option | Meaning |
| --- | --- |
| `--dir <path>` | Engine directory (same as `APP_PACKAGER_HOME`; defaults to `~/AppPackager`) |
| `--json` | JSON output for `doctor` / `list` / `env`, for scripting |
| `--search-roots <path>` | Project search roots, `:`-separated (defaults to the engine directory's parent) |
| `--upload pgyer` / `--no-upload` | Upload to pgyer after building / explicitly skip upload |
| `--version <version>` | Override the build version |
| `--harmony-debug` | Produce a HarmonyOS debug sideload package |
| `--keep-work` | Keep this run's temporary workspace |
| `--force` | `init`: overwrite engine files (local config, certificates, SDK and artefacts are always preserved) |
| `--no-wizard` | `init`: skip the interactive wizard |

### Pgyer uploads

`--upload pgyer` needs a pgyer API key: it reads `PGYER_API_KEY` from the environment first (the panel stores the key you type into the engine directory's `config/upload.local.env`), then the macOS Keychain (service `app-packager-pgyer`), and only prompts on an interactive terminal as a last resort. iOS and Android artifacts go through pgyer's official CLI, `@pgyer/cli`: it is **never installed globally or up front** — the first real upload runs `npm install` into `tools/pgyer-cli` inside the engine directory (needs Node.js 18+ and npm; `PGYER_CLI_DIR` moves it, `PGYER_CLI_VERSION` pins `0.1.5`). HarmonyOS HAP keeps using the API upload, because pgyer requires the P12 certificate to accompany a HAP and the CLI has no such step.

## Engine directory

The first run copies the package's `engine/` into the engine directory and records the version in `.engine-version`. Afterwards:

- when the package ships a newer engine, `init` updates engine files **without touching your local files**: `config/settings.local.env`, `config/*.local.env`, `config/projects/*.env` (except `.example`), `certificates/`, `signing/`, `sdk/`, `packages/`, `logs/` and `workspaces/` are left alone;
- use `app-packager init --force` for a full reset (user files still survive);
- `APP_PACKAGER_HOME` lets several engine directories coexist, for example one per business line.

Project configuration, signing and SDK details are in the engine's own `项目介绍.md` (Chinese).

## Platform support

| Capability | macOS | Windows | Linux |
| --- | --- | --- | --- |
| `list` / `doctor` / `env` | ✅ | ✅ | ✅ |
| Android APK / HarmonyOS HAP | ✅ | ⚠️ needs Git for Windows or WSL | ⚠️ needs your own toolchain |
| iOS IPA | ✅ | ❌ | ❌ |

Windows specifics (bash probe order, path translation, why Git for Windows over WSL) are in [`docs/en/windows.md`](../../docs/en/windows.md).

## Development

```bash
node --test test/
```

## Licence

MIT
