# 发布与上架

本文档记录把两个包发到 npm、并让插件出现在 DeepSeek Harness 插件市场里的完整步骤。

## 一、发布前检查

```bash
pnpm install
pnpm test                     # 两个包的 node --test 用例
pnpm -r pack --pack-destination /tmp/ap-pack   # 先看 tarball 内容再发布
```

要确认的三件事：

1. `packages/app-packager` 的 tarball 里带上了 `engine/`（约 46 个文件、~124 KB），入口 `engine/打包工具.command` 与 `engine/lib/common.sh` 都在。
   注意 **pnpm 打的包里所有文件都是 644**（`npm pack` 才保留 755），所以别指望 tarball 里的权限位：CLI 物化引擎时会把 `.command`/`.sh` 一律补回 755（`src/home.mjs` 的 `EXECUTABLE` 规则，有单测），用户手里那份是可双击的。
2. `packages/dsh-app-packager` 的 tarball 里 `package.json` 的 `@lw0129a/app-packager` 依赖已从 `workspace:^0.1.0` 被 pnpm 重写成 `^0.1.0`（npm 不认 workspace 协议，未重写的包装上去会装不上）。
3. 两个 `package.json` 的 `version` 已递增。

npm 账号需已登录（`npm whoami`），且 `@lw0129a` 这个 scope 归你所有：

```bash
npm login
```

### 账号开了 2FA 时：走 npm 的「暂存发布」（staged publishing）

npm 从 2026-07 起收紧了 bypass-2FA granular token：这类 token 不能再做账号/组织/包管理动作，官方 roadmap 也已把「直接发布」列进下一批移除项（见 [Restricting npm bypass-2FA granular access tokens](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)）。本机实测（账号 `lw0129a`，2FA 为 auth-and-writes，2026-10-07）：

| 试的路径 | 结果 |
| --- | --- |
| `pnpm publish` / `npm publish`，npmrc 里是登录态 token | `403 … Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.` |
| 直接发布，npmrc 里是勾了 Bypass 2FA 的 granular token | 被屏蔽成 `404 Not found`；注册表实际返回 `E_STAGE_REQUIRED`：`this token can only publish to a staging area, and "<包名>" does not exist yet. Create it first with a direct-capable token, then use 'npm stage publish'.` |
| `npm stage publish`（同一个 bypass token） | **成功**，无需验证码，且**能创建全新包**（npm 2026-10-02 起支持） |

结论：**用 `npm stage publish` 上传，再由本人带 2FA `npm stage approve` 批准**。批准这一步 bypass token 做不了（实测被屏蔽成 `404 staged version "…" not found`），必须真人在终端 `npm login` 后操作。

`npm stage` 需要 npm ≥ 11（`npm stage --help` 有输出即支持）。npm 12.2.0 要求 Node ≥ 22.22.2，所以 Node 20 上装 11.x：

```bash
npm i -g --prefix /tmp/ap-npm11 npm@11
/tmp/ap-npm11/bin/npm --version   # 期望 11.x
```

## 二、发布到 npm

先在本地用 tarball 验证一遍再打真包：

```bash
npm pack packages/app-packager --pack-destination /tmp/ap-pack
npm install -g --prefix /tmp/ap-prefix /tmp/ap-pack/lw0129a-app-packager-*.tgz
/tmp/ap-prefix/bin/app-packager doctor
```

> **`@lw0129a/dsh-app-packager` 只能用 `pnpm pack` / `pnpm publish` 打包。**
> 它依赖 `@lw0129a/app-packager` 时写的是 `workspace:^0.1.0`，只有 pnpm 会在打包/发布时改写成 `^0.1.0`；
> `npm pack` 会原样保留 workspace 协议，装到 profile 里会直接报
> `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` 或 `ERR_PNPM_FETCH_404`。
> 要单独检查插件 tarball：
>
> ```bash
> pnpm --filter @lw0129a/dsh-app-packager pack --pack-destination /tmp/ap-pack
> tar -xzOf /tmp/ap-pack/lw0129a-dsh-app-packager-*.tgz package/package.json | grep -A2 '"dependencies"'
> # 期望看到 "@lw0129a/app-packager": "^0.1.0"
> ```
>
> CI 的 `pack` 任务已自动校验这一点。

确认无误后上传到暂存区（两个包都要，先 CLI）：

```bash
NPM=/tmp/ap-npm11/bin/npm          # 系统 npm 10.x 没有 stage 子命令

# CLI 包：在包目录里直接 stage
(cd packages/app-packager && $NPM stage publish --access public)

# 插件包：npm stage publish 不会重写 workspace: 协议，先在临时副本里等价重写
rm -rf /tmp/ap-plugin-stage && mkdir -p /tmp/ap-plugin-stage
cp -R packages/dsh-app-packager/. /tmp/ap-plugin-stage/
rm -rf /tmp/ap-plugin-stage/node_modules /tmp/ap-plugin-stage/test
sed -i '' 's#"@lw0129a/app-packager": "workspace:\^0.1.0"#"@lw0129a/app-packager": "^0.1.0"#' /tmp/ap-plugin-stage/package.json
(cd /tmp/ap-plugin-stage && $NPM stage publish --access public)

$NPM stage list                    # 看 stage id 与状态：validating → staged
```

然后由包维护者**本人**在终端批准（会提示输入认证器里的 6 位码，30 秒内有效）：

```bash
$NPM login                         # 写新的 session token，会覆盖 ~/.npmrc 里的 granular token
$NPM stage approve <CLI 的 stage id>
$NPM stage approve <插件的 stage id>
$NPM stage list                    # 批准成功的条目会消失
npm view @lw0129a/app-packager version
```

> - 刚 stage 完是 `status: validating`（注册表异步校验 tarball），此时批准会报 `staged version "…" not found`，等它变成 `staged` 再批。
> - `npm stage download <id>` 目前在注册表侧 404（`GET /-/stage/***/tarball`），所以**发布前在本地用 `pnpm -r pack` 检查 tarball**，别指望下载回来验。
> - 若本地 npm 缓存目录权限有问题（`EPERM … _cacache`），加 `npm_config_cache=/tmp/ap-npmcache`。
> - 发错了内容可以 `npm unpublish @lw0129a/app-packager@<version>`，但 24 小时后同名同版本不可复用，优先发新版本。
> - 包发出去后，去 npmjs.com 的包设置里配 **trusted publishing（OIDC）**，让 GitHub Actions 用仓库身份发布，之后连暂存批准都省了。

## 三、让插件出现在插件市场

Harness 的插件市场（dshmarket）**不接收插件条目 PR**，也**不搜索你本地装了什么**：它的搜索和列表只有一份数据源 —— 精选清单 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。插件只装进自己 profile、没进这份清单时，在市场里怎么搜都搜不到，这不是坏了。

- 市场打开时实时拉取 `https://awesome-dsh-plugin.com/plugins.json`（`dshmarket/lib/regions.js` 里的 `CATALOG_OFFICIAL`；中国区改从 npm 包 `dsh-plugin-catalog` 里的同名文件读，见 `dshmarket/lib/catalog-npm.js`）。可用环境变量 `DSHM_REGISTRY_URL` 指向同结构镜像。
- 清单里的 `page` / `install` / `stars` / `downloads` / `capabilities` / `added` 由对方 CI 自动生成，提交时只写人工字段。

**发布 npm 不是上架的前提**：`contributing.md` 的「npm package（optional）」一节写明 listing 与发不发 npm 无关。发 npm 只是换来市场里的下载量数字与预构建安装。条目里**不能**手写 `npm:` 键（会被校验拒绝），映射是对方从 registry 自动采集的 —— 条件是**已发布包的 `repository` 字段指回被收录的那个仓库**（本项目两个包的 `repository` 都已指向 `lw0129a/dsh-app-packager`）。

条目是对方仓库里的一个新 YAML 文件，一个包一个文件：

```text
data/plugins/<owner>__<repo>.yml                            # 根包
data/plugins/<owner>__<repo>--<子包路径，/ 换成 ->.yml        # monorepo 子包
```

本项目是 monorepo（根包是纯 CLI，插件在 `packages/dsh-app-packager`），所以走子包形式：`url` 指向子目录，`name` 用 `#` 带上子包名。

```yaml
# data/plugins/lw0129a__dsh-app-packager--packages-dsh-app-packager.yml
url: https://github.com/lw0129a/dsh-app-packager/tree/main/packages/dsh-app-packager
name: lw0129a/dsh-app-packager#dsh-app-packager
category: dev
description:
  en: 'Packaging pipeline for uni-app x projects: drives the HBuilderX CLI to build, sign and upload iOS, Android and HarmonyOS apps from per-project config files, and exposes the engine to the agent as list / doctor / check / build tools.'
  zh: 'uni-app x 项目打包流水线：按项目配置调用 HBuilderX CLI 打出并签名 iOS / Android / HarmonyOS 安装包，并以 list / doctor / check / build 四个工具暴露给 agent。'
```

| 字段 | 说明 |
| --- | --- |
| `url` | 仓库（或子目录）地址，用于抓 stars；**必须是公开仓库** |
| `name` | `<owner>/<repo>`；monorepo 子包写 `<owner>/<repo>#<子包名>`，同时决定文件名 |
| `category` | 取对方 `contributing.md` 列出的取值；本插件是构建/打包流程，用 `dev` |
| `description.zh` / `.en` | 中英双语，两句意思必须一致；只有 `en` 是必填。**内容里出现 `: `（冒号加空格）必须加引号**，否则 YAML 把它当嵌套键 |
| `tarball` | 可选，GitHub Release 里的预构建 tgz（不发 npm 时用） |

### 对方 CI 会检查什么（`scripts/check-submission.mjs`）

1. 一个 PR 最多 3 条 entry。
2. **`dsh.bundle`**：从条目指向的那份 `package.json` 读（根包，或 `packages/` · `plugins/` · `apps/` 子包）。本项目的插件在 `packages/dsh-app-packager/package.json`，声明的正是 `dsh.bundle.patch`，符合这条。
3. **`MIN_AGE_DAYS = 1`：仓库创建满 1 天。这条红是自己会消失的** —— 校验器原话是不要重提、不要空推、不要关掉重开，`regate.yml`（cron `19 */6 * * *`）每 6 小时重跑一遍 gate，时间一到自动转绿。
4. 仓库要打 `dsh-plugin` topic。
5. 官方 `@deepseek-ai/*` 包必须是 `peerDependencies` 而不是 `dependencies`。
6. 首次贡献者的 fork PR 需要维护者点一次 approve，workflow 才会真正跑（GitHub 的 `action_required`）—— 这不是提交本身有问题。

截图可选：在自己的仓库里放 `screenshots.json`（与插件的 `package.json` 同级），列 1–8 个图片路径，市场详情页会显示；不写就从 README 里抽。

### 本项目的上架记录

- 2026-10-07：fork `lw0129a/awesome-dsh-plugin`，分支 `add-dsh-app-packager`，提了 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750)（只加上面那一个条目文件）。
- 当天唯一的红项是仓库年龄（仓库建于 `2026-10-07T02:50:28Z`，24 小时门槛在 `2026-10-08T02:50Z`），按第 3 条的机制等它自己转绿。
- 收录后市场是打开时实时拉的，重新打开插件市场即可搜到；npm 发布完成后下载量与一键安装命令会自动补上。


## 四、用户侧安装方式

发布后用户有两种安装路径，README 里都要给出：

```bash
# 1) 插件市场 UI：搜索 AppPackager 点击安装

# 2) 命令行：把包装进指定 profile
dsh plugin --profile <profile> add @lw0129a/dsh-app-packager
```

`dsh plugin` 是把参数透传给该 profile 目录的 pnpm（`dsh plugin --profile <name> <pnpm-args...>`），因此也可以 `add` 本地 tarball、`remove`、`update`。

插件装好后需要重启对应 profile 才会挂载四个工具。

## 五、版本与仓库

- 两个包同版本号一起递增：CLI 改了引擎或行为，插件通常也跟随发一版（插件依赖 CLI，声明的是 caret 范围，必要时同步提高下限）。
- 仓库用 `pnpm -r`，`packageManager` 字段锁定 pnpm 版本；CI 从 `packageManager` 取版本，所以改 pnpm 版本要同时改 `package.json` 与锁文件。
- GitHub 上开源的注意事项：`engine/` 里只有原工具链脚本与空的目录占位，`sdk/`、`certificates/` 下的私有内容、`.local.env` 与 `config/projects/*.env` 都由 `.gitignore` 排除，不要为了"完整"把它们提交上去。
