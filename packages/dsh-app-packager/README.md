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
  *Build* buttons; the whole list folds under the **Project list** header, and each
  row keeps its own *Remove* button. The **Choose folder…** button opens the host's own folder
  dialog and *Add project* registers the picked directory through the engine's
  `register` subcommand, so a project anywhere on disk gets the same
  `config/projects/<id>.env` the wizard would write. The field is the folder
  that **holds** your projects (e.g. `/Users/lw/work/anjuyi`) — the engine scans
  one level below it and registers every uni-app x project it finds, so picking
  projects one by one is unnecessary (several picked folders are joined into
  that one field).
- **Build scope** — the batch entry point: any set of platforms (tick *All* for
  the three) and any subset of projects (none ticked = every project that
  platform enables), with one *Env check* / *Build* pair. The engine CLI takes a
  single platform and a single project per run, so a selection becomes several
  engine runs executed back to back inside one job, each marked `▶ i/n` in the
  log; the job succeeds only if every run did, keeping the first failing exit
  code.
- **Shared build options** — version override; **Upload** lists the upload
  targets the engine declares in `config/upload.env` and that are actually
  usable (`ENABLED=true` with provider script and function present — pgyer by
  default), greying out the rest with the reason (disabled / not implemented in
  the engine yet) and sending the ticked ones as one comma separated `--upload`.
  An uploader that declares `UPLOAD_PLATFORM_<id>_API_KEY_VAR` (pgyer declares
  `PGYER_API_KEY`) also gets a masked credential row: *Save* writes the key into
  `config/upload.local.env` (mode 600, the file `lib/init.sh` sources), the row
  says whether one is stored, and the key only ever travels engine-ward — `GET
  state` carries a `credentialConfigured` boolean, never the secret. The same
  row reports whether the official CLI is installed (with its package and
  version once it is). *HarmonyOS debug HAP* and *Keep work dir* live in an
  *Advanced* fold, each with a one-line explanation.
- **SDK** — the detected HBuilderX app/CLI and its version series, and each
  platform's SDK directory with its state (`ready` / `mismatch` / `missing`).
  *One-click setup* asks the engine to download and unpack the matching SDK for
  the ticked platforms, *Process downloaded SDKs* imports archives already in
  `sdk/`, and each row links to DCloud's official download page — plus the
  direct iOS archive URL, which follows from the version series alone.
- **Upgrade plugin** — reinstalls `dsh-app-packager@latest` into the current
  profile. The engine directory is renamed out of the way for the duration, so
  an upgrade can never delete your downloaded SDKs, certificates or registered
  projects; the button is hidden when the plugin does not run from a profile's
  `node_modules`. Once the upgrade job succeeds the card tells you to reload the
  page (⌘R) — the browser half only comes back on the next page load — and offers
  a *Reload page* button.
- **Job** — the running check/build with its live engine log, its verdict
  (`[FAIL]` or a non-zero exit code counts as failed) and a *Stop* button.
  Engine `[FAIL] …` / `[WARN] …` lines are also lifted into their own box above
  the log together with the totals, so a missing profile, p12 or SDK is readable
  without scrolling the raw output. The job lives in the host process, not in the
  browser tab: switching to another DeepSeek Harness tab (or reloading the panel)
  re-adopts the newest job from `GET state`, so a build that is still running
  comes back with its log, verdict and *Stop* button, and a finished one stays on
  screen until you start another build or press *Clear* (settled jobs only — a
  running one is never dropped, or there would be nothing left to stop).

The panel only calls same-origin routes registered by this plugin
(`/api/app-packager/state|init|doctor|pick|project|project/remove|job|job/log|job/kill|job/clear|upload/credential`) — no
build logic runs in the browser. It needs a profile that ships the web app
(`@deepseek-ai/dsh-web-app`, as the desktop and web profiles do); in a headless
profile the panel is simply absent and the four tools keep working.

## Tools

### `app_packager_list`

Lists the projects configured in the engine directory (`config/projects/*.env`):
project id, app name, whether the source directory exists, enabled platforms.

```
AppPackager 引擎目录：<plugin>/home
引擎版本：0.6.2
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
        home: ''                 # engine dir; empty = <plugin>/home or APP_PACKAGER_HOME
        searchRoots: []          # extra project scan roots (outside the engine's parent)
        checkTimeoutMs: 600000   # check timeout (ms)
        buildTimeoutMs: 5400000  # build timeout (ms)
        outputLimit: 12000       # engine output kept in a tool result (tail)
```

The same values are editable in Harness under **Settings → Plugins → Plugin
config**.

## Engine directory and first use

The engine directory lives inside the plugin (`<plugin>/home`), so it travels
with the plugin; `APP_PACKAGER_HOME` or the `home` config key points it
somewhere else. An existing `~/AppPackager` from an earlier version is renamed
into place on first use — a rename, never a copy, so multi-GB SDKs and
registered projects move instantly.

The first tool call (or the panel's *Init engine*) releases the bundled engine
there; later upgrades refresh the engine files (when the `.engine-version` in the
directory differs from the package version, the next tool call or panel button
refreshes it in place, and until then that panel row reads "the directory holds
X — needs a refresh") but never overwrite your own
config, certificates, SDKs or artifacts. *Upgrade plugin* in the panel goes one
step further and reinstalls the npm package, keeping the engine directory
stashed until the install finishes.

> **Do not reinstall this package around the panel.** `<plugin>/home` sits inside
> the package directory, so any pnpm command that really reinstalls it —
> `pnpm install --force`, adding another version, changing the `file:` spec —
> deletes the engine directory along with it, SDKs, certificates and registered
> projects included. Use *Upgrade plugin* in the panel, or
> `node <plugin>/upgrade.mjs`, which stashes the engine directory first; both
> also refuse to move you onto an older release than the one installed.
>
> **When the sidebar entry disappears.** The host composes the plugin list once at
> startup and silently skips a plugin whose package directory is missing. Check in
> order: (1) `ls <plugin>` (i.e. `<profile>/node_modules/dsh-app-packager`); (2) if it
> is gone, read `<profile>/.plugin-manager/logs/*/pnpm.log` — a failed install leaves
> `Command failed with exit code 1`, and pnpm removes the old package directory
> first, taking the SDKs, certificates and projects in `home` with it; (3) install it
> back (plugin market, or `dsh plugin --profile <profile> add dsh-app-packager`) and
> **restart DSH** — the list is composed at startup only.

For the interactive wizard (register uni-app x projects found next to the
engine, pick platforms, configure signing), use the CLI:

```bash
npx app-packager init
npx app-packager register ~/work/shop   # or register a directory directly
```

## Platform support

`list` / `doctor` work anywhere. `check` / `build` need bash: built in on
macOS/Linux, and on Windows through Git for Windows (recommended) or WSL. iOS
packaging is macOS only — elsewhere `doctor` reports iOS as failed rather than
pretending otherwise.

## Licence

MIT
