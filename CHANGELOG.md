# Changelog

All notable changes to this project are documented here. Both published packages share a version number.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-07

### Added

- **The packaging decisions are now pickable per run, in the panel and in both tools.** Four engine options back them (engine script version `2026.10.08.2`): `--full-permission` / `--no-full-permission` overrides the full-permission merge for one build (both the Android permission list + iOS privacy strings and the first-launch runtime prompt, leaving `config/settings.env` alone); `--package-kind adhoc|appstore|development|enterprise` picks the iOS provisioning profile by bundle id and release kind; `--profile <path>` names one explicitly (a kind mismatch is an error, not a silent fallback); `--set KEY=VALUE` (repeatable) overrides build parameters such as `MARKETING_VERSION` or `APP_NAME`, restricted to the keys the engine itself writes into the package env — path-like keys (`SDK_ROOT`, `OUTPUT_ROOT`, `SOURCE_APP_DIR`) are refused.
- **Panel: *full permissions*, *iOS release kind*, *profile* and *custom build parameters*.** The kind dropdown greys out a kind that has no local profile for the selected projects and says why; the profile dropdown lists what the engine found (kind, bundle id, expiry) and defaults to *Auto*; the parameter box takes one `KEY=VALUE` per line and can load the project's own `scripts/ios-package/env/*.env` as a preset (quotes and comments stripped, keys outside the engine's allow-list dropped). The panel keeps no second copy of that allow-list: the engine's `PACKAGE_ENV_OVERRIDE_KEYS` is read out of `lib/common.sh` and shipped with `state`.
- **Engine: `profiles` subcommand** printing the signing profiles as JSON (`file`, `kind`, `bundleId`, `teamId`, `name`, `expiry`, `uuid`, `expired`) — the panel lists profiles by asking the engine instead of parsing `.mobileprovision` files itself, and the subcommand skips the usual closing banner so its output stays machine readable. Profile inspection was split into `extract_ios_profile_fields` / `extract_ios_profile_kind` / `find_ios_profile_by_kind`, which `read_profile_metadata` now reuses.
- `app_packager_check` carries the same options as `app_packager_build`, because a check *is* the dry run of the same wiring: a missing or mismatched profile and a wrong permission switch are reported before anything is built.
- `packages/app-packager/test/engine.test.sh` (wired into `pnpm test`) self-checks option parsing and the package-env overrides against a temporary engine root, so the bash half has a regression test without real certificates or a real build.

### Fixed

- **`--set` with an unknown key printed a shell error instead of the key.** The message expanded `$key` right before a full-width `（` and bash glued the multi-byte character onto the variable name (`lib/common.sh: line 304: key…: unbound variable`). Both messages now use `${key}` / `${PACKAGE_ENV_OVERRIDE_KEYS}`, and the engine scripts were swept for the same pattern.

## [0.3.0] - 2026-10-08

### Added

- **Upload targets are part of the panel, and only the ones the engine can actually use are tickable.** The engine already supported several uploaders (`UPLOAD_PLATFORM_IDS`, e.g. pgyer plus four pre-registered app stores); the panel now lists each one with the same verdict the engine reaches — enabled in `config/upload.env` (or overridden in `config/upload.local.env`), provider script present, provider function declared — and greys out the rest with the reason (`未启用` / `引擎里还没有实现`), so a checkbox never promises an upload the engine will skip. Ticked targets are sent as one comma separated `--upload a,b`; the engine still filters them per artefact platform. `app-packager`'s Node half reads the registry directly (`listUploaders()` / `selectableUploaders()`), which is also what a Windows host without bash needs.
- **Build scope in the panel: platforms × projects.** A *Build scope* block picks any set of platforms (`all` subsumes the rest) and any subset of projects (none ticked = every project that platform enables), with one *Env check* / *Build* pair for the selection. The engine CLI takes exactly one platform and one project per run, so a selection becomes several engine runs executed back to back inside one job — the log marks each with `▶ i/n` and the job succeeds only if every run did, keeping the first failing exit code. This is what makes "one platform, all projects" (`check ios --all`) and "several platforms, some projects" possible from the GUI; it was previously only reachable from the MCP `all` platform.
- Two options that were plain checkboxes moved into an *Advanced* fold, each with a one-line explanation: *HarmonyOS debug HAP* and *Keep work dir*.

### Fixed

- **A build with no project no longer dies on `请指定项目 ID`.** Omitting the project only ever meant "all projects" for `platform=all`; for a single platform the engine needs the explicit `--all`, so `app_packager_build` / `app_packager_check` without a project (or the panel's batch scope) failed before doing anything. `engineArgsFor()` now appends `--all` for every single-platform run without a project, verified against the real engine (`check ios --all` checks both configured projects).

## [0.2.3] - 2026-10-08

### Added

- **The panel now shows engine errors instead of hiding them in the log.** A check or build whose engine output contains `[FAIL] …` / `[WARN] …` lines gets an explicit box above the raw log, listing those lines and the total counts (the engine prints one `结果: errors=N warnings=M` per checked project, so the counts are summed; a run still in flight falls back to the line counts). So a missing profile, a missing p12, an incomplete iOS SDK or a missing HarmonyOS runtime is readable without scrolling, in both the failed and the partially-warned case. `web.js` exports `summarizeOutput()` and every job record carries `summary`, so the same structure is available to any other surface.

## [0.2.2] - 2026-10-08

### Added

- **`register`** registers a uni-app x project from anywhere on disk, on both surfaces: the CLI (`app-packager register <dir...>`) and the engine itself (`./打包工具.command register <dir...>`, engine script version `2026.10.08.1`). It reuses the wizard's registration code, so the written `config/projects/<id>.env` is identical; a directory that is not itself a project has its immediate children scanned. The command is non-interactive — no platform preflight, no "press enter" — and exits 1 with `[WARN] 指定目录里没有找到 uni-app x 项目` when nothing matches. Nothing outside the engine directory is written.
- **Panel: *Choose folder…* / *Add project*** — the projects card takes a directory, either typed or picked from the host's own folder dialog (macOS `osascript`, Windows PowerShell `FolderBrowserDialog`, Linux `zenity`; where no picker exists the panel asks for a typed path instead). *Add project* runs the engine's `register`, then refreshes the list. Two new same-origin routes carry it: `/api/app-packager/pick` and `/api/app-packager/project`.

### Fixed

- **Chinese project names no longer show as mojibake.** The engine writes `APP_NAME` with `printf '%q'`, and macOS bash 3.2 emits a mixture of raw bytes and `\NNN` escapes for one character (under `LC_ALL=C` it is all-octal). `src/projects.mjs` did not understand `$'...'` at all, so `app-packager list` and the panel displayed the escape text — and a plain UTF-8 read could not even recover it, because the value can contain a partial UTF-8 sequence. `parseEnvText` now decodes ANSI-C escapes, and `parseEnvFile` re-reads a file byte-wise when its UTF-8 form is lossy, so both escape shapes and hand-written UTF-8 files all decode to the original name.

## [0.2.1] - 2026-10-08

### Fixed

- **Tool schemas are valid JSON Schema again.** `app_packager_build` and `app_packager_check` declared a property-level `required: true` / `required: false`. The host forwards a tool's `parameters` verbatim to the model API, where `required` is only legal on an object schema and must be an array, so *every* request carrying those tools failed before the turn could start: `Invalid schema for function 'app_packager_build': true is not of type "array"`. `build` now uses an object-level `required: ["platform"]` and `check` declares none. `output.schema` was also the unsupported shorthand `{ type: "json" }`, which the host rejects via `assertSupportedJsonSchema` and which takes the whole plugin entry down (tools *and* panel); it is now `{ type: "object" }`. `test/plugin.test.mjs` asserts all four tools are free of property-level `required` and that `build` requires exactly `platform`.
- The web panel reads the web server with `ctx.get('webServer')` only. Touching `ctx.webServer` from a plugin that does not declare it in `inject` throws `cannot get property "webServer" without inject`, which killed plugin activation in every profile without a web server.

### Changed

- **Zero-impact principle** documented as the repository's highest-priority rule (`AGENTS.md`, `engine/AGENTS.md`, `engine/.cursor/rules/project-docs.mdc`, `engine/项目介绍.md` §14): a bug, misconfiguration, missing dependency or plugin failure in AppPackager must never affect the user's machine, software or projects — user projects are read-only, writes stay inside the engine directory and explicit output directories, the DeepSeek Harness installation and its other plugins are never modified, destructive actions ask first, and failures fail in place and leave a log.

## [0.2.0] - 2026-10-08

### Added

- **Web panel** in the Harness GUI: the plugin now ships a browser half (`client.js`, hand-written `__ModuleLoader__` bundle, no build step) contributing an *AppPackager* row to the sidebar panel list and a page to the centre column — engine state and one-click initialise, environment report, project list with shared build options and per-project check/build buttons, and live engine output with a stop button. The host half (`web.js`) registers six same-origin routes (`/api/app-packager/state|init|doctor|job|job/log|job/kill`) and keeps a small in-memory job runner.
- Bilingual documentation: English `README.md` / `CONTRIBUTING.md` / `docs/en/*` with Chinese `README.zh-CN.md` / `CONTRIBUTING.zh-CN.md` / `docs/zh-CN/*`, shipped to npm alongside each package's README. `pnpm docs:check` enforces the pairing.
- Repository conventions: `AGENTS.md` (rules for coding agents and contributors), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `docs/en/architecture.md`, issue forms, a pull request template, `.editorconfig` and Dependabot.
- `CHANGELOG.md` (this file).

### Fixed

- `app_packager_check` used to forward a bare platform argument, which the engine reads as *build*; it now runs `打包工具.command check <platform> [project]`.

## [0.1.0] - 2026-10-07

First public release of both packages, extracted from the original macOS-only `打包工具.command` toolchain.

### Added

- `app-packager`, a dependency-free Node CLI that materialises the packaging engine into an engine directory (default `~/AppPackager`, override with `--dir` or `APP_PACKAGER_HOME`) and forwards commands to it: `init`, `doctor`, `list`, `env`, `check`, `build`, `run`, plus pass-through of any engine argument (`app-packager ios my-project`).
- Engine directory upgrades that never touch user files (`config/*.local.env`, `config/projects/*.env`, `certificates/`, `signing/`, `sdk/`, `packages/`, `logs/`, `workspaces/`), tracked by `.engine-version`, with a generated `.gitignore` protecting signing material and per-project config.
- Executable-bit restoration for `.command` / `.sh` files, which pnpm archives as `644`.
- `dsh-app-packager`, a DeepSeek Harness host plugin registering four tools: `app_packager_list`, `app_packager_doctor`, `app_packager_check`, `app_packager_build`.
- Windows and Linux support in the Node layer: Git Bash (`APP_PACKAGER_BASH` → `%ProgramFiles%\Git\bin\bash.exe` → … ) with `wsl.exe` fallback and `wslpath` conversion, documented in `docs/zh-CN/windows.md`.
- GitHub Actions CI: unit tests plus CLI smoke runs on `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22, and a packaging job validating the published tarballs.
- The original bash engine, unchanged, including its authoritative Chinese specification `packages/app-packager/engine/项目介绍.md`.

[Unreleased]: https://github.com/lw0129a/dsh-app-packager/compare/v0.4.0...main
[0.4.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.4.0
[0.3.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.3.0
[0.2.3]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.3
[0.2.2]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.2
[0.2.1]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.1
[0.2.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.0
[0.1.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.1.0
