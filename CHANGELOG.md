# Changelog

All notable changes to this project are documented here. Both published packages share a version number.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/lw0129a/dsh-app-packager/compare/v0.2.1...main
[0.2.1]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.1
[0.2.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.2.0
[0.1.0]: https://github.com/lw0129a/dsh-app-packager/releases/tag/v0.1.0
