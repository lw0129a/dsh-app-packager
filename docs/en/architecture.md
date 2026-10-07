[English](architecture.md) | [简体中文](../zh-CN/architecture.md)

# Architecture

Three layers, one behaviour: the original bash packaging toolchain stays the single source of truth, with a Node CLI and a Harness plugin wrapped around it.

```
        user                          agent (DeepSeek Harness)        browser (web profile)
          │                                     │                              │
   bin/app-packager.mjs        packages/dsh-app-packager/index.js      client.js (panel)
          │  (arg parsing)            │  (4 tools)        │                    │ fetch
          └──────────────┬───────────┴───────────────────┘                    │
                         ▼                        web.js (9 exact routes) ◄───┘
            packages/app-packager/src/*.mjs          ← pure Node, no runtime deps
            home · projects · engine · doctor · cli
                         │  spawn bash (stdin ignored)
                         ▼
            <engine dir, default <plugin>/home>      ← materialised from engine/
            lib/*.sh · config/ · signing/ · certificates/
```

## Modules

| Path | Responsibility |
| --- | --- |
| `packages/app-packager/bin/app-packager.mjs` | Executable entry; parses argv and dispatches to `src/cli.mjs`. |
| `packages/app-packager/src/cli.mjs` | Command table (`init` `doctor` `list` `register` `check` `build` `run` `env` `version`), option parsing, pass-through of unknown engine arguments. |
| `packages/app-packager/src/home.mjs` | Engine directory resolution (`--dir` → `APP_PACKAGER_HOME` → the repository default), version-stamped materialisation, user-file preservation, `HOME_GITIGNORE`. |
| `packages/dsh-app-packager/index.mjs` | The plugin's single source for the engine directory and the upgrade wrapper: `resolvePluginHome` (explicit config → `APP_PACKAGER_HOME` → `<plugin>/home`, renaming a legacy `~/AppPackager` into place once — and only when that directory really is an engine home), `withHomePreserved` (stashes the home in the profile's `node_modules/.app-packager-home-backup` around an upgrade and restores it either way) and `pluginRoot`. Shared by the host tools, the panel backend and the upgrade script. |
| `packages/dsh-app-packager/upgrade.mjs` | What *Upgrade plugin* runs: `dsh plugin --profile <name> add dsh-app-packager@latest`, falling back to `pnpm add` in the profile directory, wrapped in `withHomePreserved`. |
| `packages/app-packager/src/projects.mjs` | Reads `config/projects/*.env` (quoting, `\ ` escapes, `$VAR`/`${VAR}` expansion, `export` prefix) and reports enabled platforms. |
| `packages/app-packager/src/engine.mjs` | bash discovery (`native` / `git-bash` / `wsl`), path translation, `PIPELINE_ROOT` + `PROJECT_SEARCH_ROOTS` injection, spawn with timeout and line streaming. |
| `packages/app-packager/src/doctor.mjs` | Node-side environment checks (Node, engine, shell bridge, Xcode tooling, HBuilderX, JDK, Android SDK, DevEco Studio, signing dirs, project config). |
| `packages/app-packager/engine/` | The original toolchain, byte-for-byte; `engine/项目介绍.md` is its authoritative spec. |
| `packages/dsh-app-packager/index.js` | Host plugin: registers 4 tools with hand-written JSON Schemas, renders engine output as text; no `@deepseek-ai/*` runtime imports. |
| `packages/dsh-app-packager/web.js` | Host half of the panel: `engineArgsFor` (the single place that turns tool arguments into engine argv), a small in-memory job runner (check/build, output cap, SIGTERM stop) and `mountWebPanel`, which registers nine exact routes on `webServer` (the three extra ones are the host folder dialog, project registration and project removal) and returns a disposer — `null` when no web server exists. |
| `packages/dsh-app-packager/client.js` | Browser half: a hand-written `__ModuleLoader__` bundle (no build step, no npm dependency — `require('react')` comes from the host's seed table) contributing a row to `sidebar.panellist` and a page to the keyed `main` slot. |

## Web panel

The browser side is a second Cordis tree: the host reads `dsh.client` + `exports["./client"]` from the package manifest, serves the file at `/plugins/<package-name>/client.js` and mounts it as one more entry.

- **Bundle id must be the npm package name** (`dsh-app-packager`), not the patch row id — the module table is keyed by package name, and a mismatch fails with `bundle … loaded without registering "…" via __ModuleLoader__.load`.
- **`dsh.client` has exactly four fields** (`platform` / `inject` / `external` / `immediately`); the entry point is `exports["./client"]`. `platform` must be `"web"`, and changing the manifest needs a DSH restart — only the bundle file itself hot-reloads.
- **No build step, on purpose**: the host hands `react`, `react-dom` and the `@deepseek-ai/dsh-client-*` UI packages to the bundle at runtime, so this repository stays dependency-free and the file can be read top to bottom. Do not add them to `dependencies`.
- **Slots**: `sidebar.panellist` (list → needs `id`, `order`, `label`) and `main` (keyed → needs `key`). A slot only exists if a parent entry declares it; the shell declares these two.
- **Styling** uses the host's `--dsw-alias-*` / `--dsh-*` tokens, injected as a `<style>` element from the bundle and removed through `ctx.effect` — a `.css` file next to the bundle would never be served.
- **Communication is plain same-origin `fetch`** against the host routes; `webServer` is never listed in `inject` (a hard dependency would deactivate the plugin in profiles without a web server) — it is looked up with `ctx.get('webServer')` / `ctx.inject(['webServer'], …)`, and the four tools work with or without it.

## Contracts worth keeping

- **The engine directory lives inside the plugin**: `<plugin>/home`. A legacy `~/AppPackager` is moved in with `renameSync` on first resolution (never a copy — multi-GB SDKs move instantly); across volumes it stays where it is and the notice reaches the panel. The rename only happens for a directory that really is an engine home (`.engine-version` or `打包工具.command` present), so a folder that merely shares the name is left alone.
- **An upgrade stashes the home outside the plugin directory**: reinstalling deletes `node_modules/dsh-app-packager` first, so `withHomePreserved` renames the home to `<profile>/node_modules/.app-packager-home-backup` and moves it back when the install finishes or fails — downloaded SDKs and registered projects never disappear with a reinstall.
- **Engine environment**: the engine is always invoked as `bash <engineDir>/打包工具.command <args>` with `PIPELINE_ROOT` (shell-ified engine dir), `PROJECT_SEARCH_ROOTS` (`:`-separated, defaults to the engine dir's parent) and `LANG`; cwd is the engine dir. `PIPELINE_ROOT` pre-set by the caller wins, exactly as in `lib/runner.sh`.
- **stdin is always ignored** (`stdio: ['ignore', …]`): the headless branch of `打包工具.command` ends with `printf '按回车退出...'; read -r _`, which would otherwise hang a spawned process.
- **User-owned paths survive upgrades**: `home.mjs` skips `config/*.local.env`, `config/init.local.env`, `config/projects/*.env`, `certificates/`, `signing/`, `sdk/`, `packages/`, `logs/`, `workspaces/` when copying, and `.engine-version` records what was materialised.
- **Executable bits are restored** (`EXECUTABLE = /\.(command|sh)$/i` → 755) because pnpm archives every file as 644.
- **Success is not just the exit code**: the plugin treats output containing `[FAIL]` as a failure (`verdictOf`).
- **SDK recommendation logic exists only in the engine**: HBuilderX version → SDK series → official download entry → download, unpack and place, all of it in `engine/lib/sdk.sh` (`sdk status|urls|install|process`). The panel builds no URLs of its own: the iOS archive name follows from the series, Android's carries a build number and can only be scraped from DCloud's page, HarmonyOS installs its runtime through ohpm, and `--file` takes an archive you downloaded yourself.
- **`check` and `build` are different subcommands**: engine argv is built in `web.js` (`engineArgsFor`), because a bare platform argument means *build* in `lib/runner.sh`. Checking a platform is always `打包工具.command check <platform> [project]`.
- **Build options have a single source of truth**: `--full-permission` / `--no-full-permission`, `--package-kind`, `--profile` and `--set KEY=VALUE` are all produced by `engineArgsFor` and **shared by `check` and `build`** (a check is the dry run of the same wiring, so a missing or mismatched profile and a wrong permission switch surface there first). `--package-kind` is an iOS concept and is never passed on another platform. The panel does not parse `.mobileprovision` files itself; it calls the engine's `profiles` subcommand (cached on the mtime of `signing/current`, `signing/apple` and `certificates/iOS`). The keys `--set` accepts are read from `PACKAGE_ENV_OVERRIDE_KEYS` in the engine's `lib/common.sh` and shipped with `state`, so the panel filters project presets with the engine's own allow-list instead of keeping a second copy.
- **A materialised engine directory gets a `.gitignore`** (`HOME_GITIGNORE`) protecting `config/projects/*.env`, `certificates/*`, `*.p12`, `*.mobileprovision`, `*.ipa`, `*.apk`, `*.hap`.

## Tests and CI

`node --test`, no framework: `packages/app-packager/test/packager.test.mjs` (env parsing, project discovery, materialisation, doctor), `packages/app-packager/test/engine.test.sh` (`parse_args` options, the package-env allow-list, the JSON of `profiles` and `sdk status`, `harmony_sdk_ready` — all inside a temporary `PIPELINE_ROOT`, which works because the harness copies `lib/` instead of symlinking it) and `packages/dsh-app-packager/test/plugin.test.mjs` (tool registration, schemas, rendering, argument validation, the host routes against fake request/response objects, the job runner, and a smoke test that loads `client.js` with a stubbed React and asserts the panel registers into `sidebar.panellist` + `main`). CI runs both on `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22, plus CLI smoke runs and a `pnpm -r pack` job that validates the tarballs. The bash engine itself is untouched and untested by CI — Android/HarmonyOS builds need a real machine with HBuilderX.

## Extending it

- **New CLI command**: add it to the table in `src/cli.mjs`; anything the engine already understands can also be reached through `app-packager run <engine args>`.
- **New agent tool**: add a definition inside `apply()` in `packages/dsh-app-packager/index.js` (`{name, description, parameters, output, execute}`) and cover it in `test/plugin.test.mjs`.
- **New engine argument**: teach `engineArgsFor` in `packages/dsh-app-packager/web.js` (tools and panel share it) and extend the CLI pass-through if it belongs there too.
- **Panel changes**: edit `client.js` only — it hot-reloads in a running DSH; remember `package.json` changes need a restart.
- **Engine changes**: edit `packages/app-packager/engine/`, bump the script version inside it, and update `engine/项目介绍.md` in the same commit (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## Non-goals

- **iOS anywhere but macOS.** Signing goes through Keychain/`codesign`/`plutil`; the Node layer only reports that honestly.
- **Rewriting the bash engine in Node.** It would break the promise that the original toolchain still runs unchanged on macOS.
