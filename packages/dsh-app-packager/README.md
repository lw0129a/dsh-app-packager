[English](README.md) | [简体中文](README.zh-CN.md)

# dsh-app-packager

DeepSeek Harness bundle for [AppPackager](https://github.com/lw0129a/dsh-app-packager):
list your uni-app x projects, check the local toolchain, and build iOS IPA /
Android APK / HarmonyOS HAP without leaving a Harness session — from the agent
(four tools) or from a panel in the web GUI.

## Install

Search for **AppPackager** in the Harness plugin market, or:

```bash
dsh plugin --profile desktop add dsh-app-packager
```

Restart the profile afterwards. The plugin depends on `app-packager` (the CLI
and the packaging engine), which is installed with it.

## Panel in the web GUI

The bundle ships a client half (`./client.js`), so the web GUI gains an
**App packaging** entry in the sidebar's own panel list, with its page in the
centre column:

- **Engine** — engine directory, engine version, whether it is materialized,
  and which bash bridge was found (macOS/Linux `bash`, Windows Git Bash or WSL).
  *Init engine* materializes a missing engine in one click.
- **Environment check (Node)** — the same report as `app_packager_doctor`, for
  one platform or all of them, with hints for every failed item.
- **Projects** — every `config/projects/*.env`, its source directory (flagging
  a missing one), the platforms it enables, and per-project *Env check* /
  *Build* buttons. Shared build options: version override, upload to pgyer,
  HarmonyOS debug HAP, keep the intermediate work directory.
- **Job** — the running check/build with its live engine log, its verdict
  (`[FAIL]` or a non-zero exit code counts as failed) and a *Stop* button.

The panel only calls same-origin routes registered by this plugin
(`/api/app-packager/state|init|doctor|job|job/log|job/kill`) — no build logic
runs in the browser. It needs a profile that ships the web app
(`@deepseek-ai/dsh-web-app`, as the desktop and web profiles do); in a headless
profile the panel is simply absent and the four tools keep working.

## Tools

### `app_packager_list`

Lists the projects configured in the engine directory (`config/projects/*.env`):
project id, app name, whether the source directory exists, enabled platforms.

```
AppPackager 引擎目录：/Users/me/AppPackager
引擎版本：0.2.0
项目（1）:
- shop（商城）
  平台: iOS (IPA), Android (APK)
  源码: /Users/me/work/shop
```

Pure Node, so it also works on Windows. The first call materializes the engine.

### `app_packager_doctor`

Reports whether this machine can build: Node version, the bash bridge, Xcode /
signing tools, HBuilderX CLI, JDK, Android SDK, DevEco Studio, the HarmonyOS
signing directory and the project config. `platform`: `ios` / `android` /
`harmony` / `all` (default `all`). Also pure Node.

### `app_packager_check`

Runs the engine's `check` subcommand for one platform (certificates, SDK
directories, HBuilderX CLI) and returns the tail of its output plus a verdict.
Parameters: `platform` (default `all`), `project` (project id, omit for all),
`home`.

### `app_packager_build`

Runs a real build; minutes per platform (iOS especially), timeout 90 minutes.

| Parameter | Description |
| --- | --- |
| `platform` | required, `ios` / `android` / `harmony` / `all` |
| `project` | project id; optional with `platform=all` (means every project) |
| `upload` | upload after building, e.g. `pgyer` |
| `noUpload` | skip the upload stage |
| `version` | override the artifact version |
| `harmonyDebug` | emit a HarmonyOS debug side-load HAP |
| `keepWork` | keep the intermediate work directory |
| `home` | engine directory (usually omitted, see below) |

When unsure, run `app_packager_check` first.

## Configuration

The bundle patch provides the config; override it in your own profile
`cordis.patch.yml` by re-inserting `id: app-packager`:

```yaml
- insert:
    - id: app-packager
      name: 'dsh-app-packager'
      config:
        home: ''                 # engine dir; empty = ~/AppPackager or APP_PACKAGER_HOME
        searchRoots: []          # extra project scan roots (outside the engine's parent)
        checkTimeoutMs: 600000   # check timeout (ms)
        buildTimeoutMs: 5400000  # build timeout (ms)
        outputLimit: 12000       # engine output kept in a tool result (tail)
```

The same values are editable in Harness under **Settings → Plugins → Plugin
config**.

## Engine directory and first use

The default engine directory is `~/AppPackager` (override with the config key or
`APP_PACKAGER_HOME`). The first tool call (or the panel's *Init engine*)
releases the bundled engine there; later upgrades refresh the engine files but
never overwrite your own config, certificates, SDKs or artifacts.

For the interactive wizard (register uni-app x projects found next to the
engine, pick platforms, configure signing), use the CLI:

```bash
npx app-packager init
```

## Platform support

`list` / `doctor` work anywhere. `check` / `build` need bash: built in on
macOS/Linux, and on Windows through Git for Windows (recommended) or WSL. iOS
packaging is macOS only — elsewhere `doctor` reports iOS as failed rather than
pretending otherwise.

## Licence

MIT
