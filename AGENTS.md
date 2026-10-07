# AGENTS.md — 给 AI 编码助手与本仓库维护者的规则

本文件是仓库级的 AI/开发规范。子目录里还有一份**引擎侧**的规则
[`packages/app-packager/engine/AGENTS.md`](packages/app-packager/engine/AGENTS.md)，
处理 `engine/` 内文件时它同样生效；两者冲突时以更严格的那条为准。

## 1. 这个仓库是什么

把 uni-app x 项目打成 iOS IPA / Android APK / HarmonyOS HAP 的本地工具链，三层结构：

- `packages/app-packager/engine/` —— 原 bash 打包引擎，**逐字节保留**，行为权威说明是 [`engine/项目介绍.md`](packages/app-packager/engine/项目介绍.md)；
- `packages/app-packager/src/*.mjs` —— 零运行时依赖的 Node CLI（物化引擎、读项目配置、探测 bash、体检、转发命令）；
- `packages/dsh-app-packager/` —— DeepSeek Harness 插件：`index.js` 注册四个工具，`web.js` 是面板的宿主侧（引擎 argv、任务执行器、6 条同源路由），`client.js` 是浏览器侧面板（手写 `__ModuleLoader__` bundle，零构建）。

分层与数据流的完整说明见 [`docs/zh-CN/architecture.md`](docs/zh-CN/architecture.md)。

## 2. 铁律（违反即视为未完成）

1. **引擎行为变了，文档必须同步。** 任何对 `engine/` 下脚本、配置键、命令行参数、目录结构、产物、签名或上传规则的改动，必须在同一个提交里更新
   `packages/app-packager/engine/项目介绍.md`（含其"变更记录"与"最后更新"日期），并升引擎脚本版本号。这条规则继承自引擎自己的 `AGENTS.md`。
2. **项目读取方式不许退化。** 初始化时必须能自动发现同级目录下的 uni-app x 项目（`manifest.json` + `pages.json` 或 `src/` 同构），同时保留手动指定绝对路径的能力。
3. **不要把敏感文件提交进 Git。** `certificates/`（证书、p12、描述文件）、`signing/current/`、`sdk/` 内容、`config/*.local.env`、`config/init.local.env`、`config/projects/*.env` 一律排除；`.gitignore` 里已有规则，别为了"完整"绕过。
4. **CLI 不许加运行时依赖。** `packages/app-packager` 只用 Node 内置模块（`node:fs`/`node:path`/`node:child_process`…）。插件包同样不导入 `@deepseek-ai/*` 运行时包（schemastery 是可选的 peer）。
   **唯一例外**是浏览器侧的 `client.js`：它在 factory 闭包里 `require("react")`（及宿主 seed 表里的其他 UI 包），这是宿主运行时注入的，不是 npm 依赖 —— 所以不要把它们写进 `dependencies`/`peerDependencies`，也不要在 `index.js`/`web.js`（宿主侧、Node 里跑）里 import 它们。
   `webServer` 也不许写进 `inject`：硬依赖会让没有 Web 服务的 profile 里插件整个不激活，四个工具也没了。
5. **不要重写引擎。** 不要为了"跨平台"把 `lib/*.sh` 改写成 Node；跨平台由 Node 层做桥接（见 `docs/zh-CN/windows.md`）。
6. **不要声称 macOS 之外的 iOS 支持。** 非 macOS 上 `doctor` 必须如实把 iOS 判为不可用。

## 3. 常用命令

```bash
pnpm install                       # 安装 workspace（packageManager 锁定 pnpm 版本）
pnpm test                          # 两个包的 node --test
node --test packages/app-packager/test/packager.test.mjs       # 单包
node --test packages/dsh-app-packager/test/plugin.test.mjs
pnpm cli list                      # 直接跑本地 CLI（= node packages/app-packager/bin/app-packager.mjs）
pnpm docs:check                    # 中英文档配对检查
pnpm -r pack --pack-destination /tmp/ap-pack   # 发布前看 tarball
```

## 4. 代码规范

- Node ESM，文件后缀 `.mjs`（CLI）与 `.js`（`type: module` 的插件包）；不要引入打包器。
- 导出函数保持小而纯：能单测的逻辑放 `src/*.mjs`，副作用（读盘、spawn）集中在 `home.mjs` / `engine.mjs`。
- **新增或修改行为必须带测试**（`node --test`，不用框架、不加 fixture 目录）。当前基线：CLI 5 例 + 插件 10 例（含宿主路由用假 req/res 驱动、任务执行器、`client.js` 用 stub React 加载的冒烟测试）。
- `engine/` 下的 bash 保持原样缩进与风格，**换行必须是 LF**（`.gitattributes` 已固定），不要格式化无关文件。
- 中文注释与文案是本仓库的既有风格；代码标识符、配置键、日志中的技术名词用英文。
- 面板（`web.js` / `client.js`）有一条硬约束：**bundle id 必须是 npm 包名**（`dsh-app-packager`），入口由 `exports["./client"]` + `dsh.client.platform === "web"` 决定。样式只用宿主的 `--dsw-alias-*` / `--dsh-*` token，禁止硬编码颜色；`client.js` 改动会被运行中的 DSH 热重载，改 `package.json` 必须重启。

## 5. 文档规范（中英双份）

- 英文是 `README.md`、`CONTRIBUTING.md`、`docs/en/*.md`、`.github/*`；中文是 `README.zh-CN.md`、`CONTRIBUTING.zh-CN.md`、`docs/zh-CN/*.md`。
- 每份面向用户的文档**首行**是语言切换行（`[English](…) | 简体中文` / `[English](…) | [简体中文](…)`）。
- 改了一份必须同步另一份，`pnpm docs:check` 会检查配对与切换行。
- npm 页面展示各包的 `README.md`（英文），中文版随包一起发布为 `README.zh-CN.md`，两边的链接都要可用。
- 引擎的 `项目介绍.md` 保持中文（它是引擎行为的权威说明，且被引擎侧 AGENTS.md 约束），不属于本次双语范围。

## 6. 提交与发布

- 提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` / `ci:`，一次提交一件事。
- 版本号两个包同步递增；插件依赖 CLI 用 caret 范围。
- 发布走 npm 暂存发布 + 本人在 npmjs.com 批准，完整流程见 [`docs/zh-CN/publishing.md`](docs/zh-CN/publishing.md)。
- 不要 `git push --force` 到 `main`；不要删除市场 fork（会让 PR 关闭），见 `docs/zh-CN/publishing.md` 的上架记录。

## 7. 完成前自检

1. `pnpm test` 全绿；改了文档结构时 `pnpm docs:check` 通过。
2. 动了引擎 → `项目介绍.md` 已同步。
3. 两个包的 `version` 是否需要递增；`CHANGELOG.md` 是否补了条目。
4. `git status` 里没有证书、密钥、项目私有配置。
