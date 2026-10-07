[English](../en/architecture.md) | 简体中文

# 架构

三层、一套行为：原 bash 打包工具链始终是唯一事实来源，外面套一层 Node CLI 和一层 Harness 插件。

```
        用户                          agent（DeepSeek Harness）      浏览器（带 Web 的 profile）
          │                                     │                              │
   bin/app-packager.mjs        packages/dsh-app-packager/index.js      client.js（面板）
          │  （参数解析）              │  （4 个工具）     │                    │ fetch
          └──────────────┬───────────┴───────────────────┘                    │
                         ▼                        web.js（8 条 exact 路由）◄───┘
            packages/app-packager/src/*.mjs          ← 纯 Node，无运行时依赖
            home · projects · engine · doctor · cli
                         │  spawn bash（丢弃 stdin）
                         ▼
            <引擎目录，默认 ~/AppPackager>            ← 由 engine/ 物化而来
            lib/*.sh · config/ · signing/ · certificates/
```

## 模块

| 路径 | 职责 |
| --- | --- |
| `packages/app-packager/bin/app-packager.mjs` | 可执行入口，解析 argv 后交给 `src/cli.mjs`。 |
| `packages/app-packager/src/cli.mjs` | 命令表（`init` `doctor` `list` `register` `check` `build` `run` `env` `version`）、选项解析、无法识别的参数透传给引擎。 |
| `packages/app-packager/src/home.mjs` | 引擎目录解析（`--dir` → `APP_PACKAGER_HOME` → `~/AppPackager`）、带版本号的物化、保留用户文件、`HOME_GITIGNORE`。 |
| `packages/app-packager/src/projects.mjs` | 读 `config/projects/*.env`（引号、`\ ` 转义、`$VAR`/`${VAR}` 展开、`export` 前缀），并给出启用的平台。 |
| `packages/app-packager/src/engine.mjs` | bash 探测（`native` / `git-bash` / `wsl`）、路径转换、注入 `PIPELINE_ROOT` 与 `PROJECT_SEARCH_ROOTS`、带超时与逐行回显的 spawn。 |
| `packages/app-packager/src/doctor.mjs` | Node 侧体检（Node、引擎、shell 桥接、Xcode 工具、HBuilderX、JDK、Android SDK、DevEco Studio、签名目录、项目配置）。 |
| `packages/app-packager/engine/` | 原工具链，逐字节保留；行为权威说明是 `engine/项目介绍.md`。 |
| `packages/dsh-app-packager/index.js` | 宿主插件：注册四个工具（手写 JSON Schema），把引擎输出渲染成文本；不导入任何 `@deepseek-ai/*` 运行时包。 |
| `packages/dsh-app-packager/web.js` | 面板的宿主侧：`engineArgsFor`（工具参数 → 引擎 argv 的唯一出处）、内存里的小任务执行器（check/build、输出上限、SIGTERM 停止）、`mountWebPanel`（在 `webServer` 上注册 8 条 exact 路由并返回清理函数，多出的两条是宿主侧目录对话框与项目登记；没有 Web 服务时返回 `null`）。 |
| `packages/dsh-app-packager/client.js` | 面板的浏览器侧：手写的 `__ModuleLoader__` bundle（零构建、零 npm 依赖 —— `require('react')` 来自宿主 seed 表），往 `sidebar.panellist` 加一行、往 keyed 的 `main` 槽加一页。 |

## Web 面板

浏览器侧是第二棵 Cordis 树：宿主从包的 manifest 里读 `dsh.client` 与 `exports["./client"]`，把该文件挂在 `/plugins/<包名>/client.js`，再当作一个普通条目挂载。

- **bundle id 必须是 npm 包名**（`dsh-app-packager`），不是 patch 里的 row id —— 模块表以包名为键，写错会报 `bundle … loaded without registering "…" via __ModuleLoader__.load`。
- **`dsh.client` 只有四个字段**（`platform` / `inject` / `external` / `immediately`），入口只能是 `exports["./client"]`。`platform` 必须是 `"web"`；改 manifest 需要重启 DSH，只有 bundle 文件本身支持热重载。
- **刻意零构建**：宿主在运行时把 `react`、`react-dom` 与 `@deepseek-ai/dsh-client-*` UI 包交给 bundle，所以本仓库保持零依赖、client.js 可以自上而下读完。不要把它们加进 `dependencies`。
- **槽位**：`sidebar.panellist`（list → 需要 `id`、`order`、`label`）与 `main`（keyed → 需要 `key`）。槽位必须由父条目的 children 表声明，这两个由 shell 声明。
- **样式**用宿主的 `--dsw-alias-*` / `--dsh-*` token，由 bundle 注入 `<style>` 并用 `ctx.effect` 清理 —— 放在 bundle 旁边的 `.css` 文件不会被服务。
- **通信就是同源 `fetch`**：`webServer` 绝不写进 `inject`（硬依赖会让没有 Web 服务的 profile 里插件直接不激活），而是用 `ctx.get('webServer')` / `ctx.inject(['webServer'], …)` 获取；有没有它，四个工具都照常可用。

## 需要守住的约定

- **引擎环境**：始终以 `bash <引擎目录>/打包工具.command <args>` 调用，注入 `PIPELINE_ROOT`（shell 化的引擎目录）、`PROJECT_SEARCH_ROOTS`（`:` 分隔，默认引擎目录的父目录）与 `LANG`；工作目录为引擎目录。调用方若已设 `PIPELINE_ROOT` 则沿用，与 `lib/runner.sh` 一致。
- **stdin 永远丢弃**（`stdio: ['ignore', …]`）：`打包工具.command` 的 headless 分支结尾是 `printf '按回车退出...'; read -r _`，否则被 spawn 的进程会挂住。
- **升级不动用户文件**：`home.mjs` 复制时跳过 `config/*.local.env`、`config/init.local.env`、`config/projects/*.env`、`certificates/`、`signing/`、`sdk/`、`packages/`、`logs/`、`workspaces/`，并用 `.engine-version` 记录物化版本。
- **补回可执行位**（`EXECUTABLE = /\.(command|sh)$/i` → 755），因为 pnpm 打的 tarball 里所有文件都是 644。
- **成功不只看出口码**：输出里出现 `[FAIL]` 时插件判定为失败（`verdictOf`）。
- **`check` 与 `build` 是两个子命令**：引擎 argv 由 `web.js` 的 `engineArgsFor` 拼装，因为在 `lib/runner.sh` 里裸平台参数意味着**打包**。检查某平台永远是 `打包工具.command check <平台> [项目]`。
- **物化出的引擎目录会写一份 `.gitignore`**（`HOME_GITIGNORE`），保护 `config/projects/*.env`、`certificates/*`、`*.p12`、`*.mobileprovision`、`*.ipa`、`*.apk`、`*.hap`。

## 测试与 CI

`node --test`，不引框架：`packages/app-packager/test/packager.test.mjs`（env 解析、项目发现、物化、doctor）与 `packages/dsh-app-packager/test/plugin.test.mjs`（工具注册、schema、渲染、参数校验、用假 req/res 驱动宿主路由、任务执行器，以及用 stub React 加载 `client.js` 并断言面板注册进 `sidebar.panellist` + `main` 的冒烟测试）。CI 在 `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 18/20/22 上跑这两组，外加 CLI 冒烟与 `pnpm -r pack` 的 tarball 校验。bash 引擎本身未被 CI 覆盖——真机 Android/HarmonyOS 出包需要装了 HBuilderX 的机器。

## 怎么扩展

- **加命令**：在 `src/cli.mjs` 的命令表里加；引擎本来就认识的参数也可以走 `app-packager run <引擎参数>`。
- **加 agent 工具**：在 `packages/dsh-app-packager/index.js` 的 `apply()` 里加一条定义（`{name, description, parameters, output, execute}`），并在 `test/plugin.test.mjs` 里补用例。
- **加引擎参数**：教 `packages/dsh-app-packager/web.js` 的 `engineArgsFor`（工具与面板共用一份），需要时再补 CLI 的透传。
- **改面板**：只动 `client.js` —— 运行中的 DSH 会热重载它；记住改 `package.json` 必须重启。
- **改引擎**：改 `packages/app-packager/engine/`，同时升它的脚本版本，并在同一个提交里更新 `engine/项目介绍.md`（见 [CONTRIBUTING.zh-CN.md](../../CONTRIBUTING.zh-CN.md)）。

## 非目标

- **除 macOS 外的 iOS**：签名走 Keychain/`codesign`/`plutil`，Node 这层只负责如实报告。
- **把 bash 引擎重写成 Node**：那会破坏"原工具链在 macOS 上仍原样可跑"这个承诺。
