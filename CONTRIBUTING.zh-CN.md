[English](CONTRIBUTING.md) | 简体中文

# 参与贡献

感谢帮忙。这个项目交付的是一条本地打包流水线，改错一处可能让别人签不出包，下面这些规则就是为了避免这件事。

## 准备环境

```bash
git clone https://github.com/lw0129a/dsh-app-packager.git
cd dsh-app-packager
pnpm install          # pnpm 版本由 packageManager 字段锁定
pnpm test             # 先跑项目配置守卫，再跑两个包的 node --test
pnpm guard:check      # 只看 git 眼里的文件；`.githooks/pre-commit` 也会跑它
```

Node 18 及以上，`.nvmrc` 钉的是 Node 20。

## 提 PR 之前

```bash
pnpm test             # 必须（里面已经带了项目配置守卫）
pnpm docs:check       # 改了文档就必须跑
pnpm -r pack --pack-destination /tmp/ap-pack   # 改了会发布的内容就跑
```

一个 PR 只做一件事；任何行为改动都要带测试；改坏了的文档要在同一个 PR 里更新。完整规则见 [AGENTS.md](AGENTS.md)（它写给编码 agent，但同样是对人的约定），其中最关键的几条：

- **改引擎必须同提交更新引擎说明。** 涉及 `packages/app-packager/engine/` 下脚本、配置键、命令行参数、目录结构、产物、签名或上传规则的改动，必须在同一个提交里更新 `packages/app-packager/engine/项目介绍.md`（含变更记录与"最后更新"日期），并升引擎脚本版本号。
- **项目读取方式不许退化。** 初始化仍要能自动发现同级目录下的 uni-app x 项目（`manifest.json` + `pages.json`，或 `src/` 同构），同时保留手动指定绝对路径。
- **CLI 不许加运行时依赖。** `packages/app-packager` 只用 Node 内置模块；`packages/dsh-app-packager` 运行时不得导入 `@deepseek-ai/*`。
- **绝不提交凭据。** 证书、`*.p12`、描述文件、`signing/current/`、`sdk/` 内容、`config/*.local.env` 与 `config/projects/*.env` 都不进 Git。
- **不要在 macOS 之外声称支持 iOS**，也不要为了"跨平台"把 bash 引擎改写成 Node。

## 文档

面向用户的文档都是成对的，英文在前：

| 英文 | 中文 |
| --- | --- |
| `README.md` | `README.zh-CN.md` |
| `CONTRIBUTING.md` | `CONTRIBUTING.zh-CN.md` |
| `docs/en/*.md` | `docs/zh-CN/*.md` |
| `packages/*/README.md` | `packages/*/README.zh-CN.md` |

每份面向用户的文档首行都是语言切换行。改一边就要改另一边——`pnpm docs:check` 会因为缺了对应版本而失败。引擎自己的 `项目介绍.md` 保持中文：它是 bash 层行为的权威说明，受引擎侧 `AGENTS.md` 约束。

## 提交与分支

Conventional Commits，一次提交一件事：

```
feat: 新增 app_packager_upload_artifacts 工具
fix: 展开项目 env 里的 $PIPELINE_ROOT
docs: 补上 Windows 说明的英文版
```

从 `main` 切分支，保持线性历史（rebase 而不是 merge），按模板向 `main` 提 PR。

## 发布

仅维护者操作。两个包共用版本号；必要时提高插件对 CLI 的 caret 下限。流程见 [docs/zh-CN/publishing.md](docs/zh-CN/publishing.md)。发布走 npm 暂存发布 + 浏览器侧 2FA 批准，市场条目在另一个清单仓库里。

## 报 bug 与安全问题

用 issue 模板报 bug 与需求。安全相关的问题（凭据进了日志、tarball 里混进私有文件、不安全的 shell 调用）**不要**开公开 issue，按 [SECURITY.md](SECURITY.md) 的渠道上报。

## 许可

提交贡献即表示你同意以 [MIT 许可](LICENSE) 发布。
