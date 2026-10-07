[English](../en/publishing.md) | 简体中文

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
2. `packages/dsh-app-packager` 的 tarball 里 `package.json` 的 `app-packager` 依赖已从 `workspace:^0.2.0` 被 pnpm 重写成 `^0.2.0`（npm 不认 workspace 协议，未重写的包装上去会装不上）。
3. 两个 `package.json` 的 `version` 已递增。

两个包都发布在 npm 公共仓库上、**包名不带 scope**（`app-packager` 与 `dsh-app-packager`），发布前只需确认 `npm whoami` 是本人（`lw0129a`）：

```bash
npm login
```

### 首选：交给 GitHub Actions（trusted publishing，免 token 免验证码）

`.github/workflows/publish.yml` 已经就绪：推 `v*` tag 自动发布，或在 Actions 页签手动 `gh workflow run publish.yml`。它用 `id-token: write` 让 npm 通过 OIDC 认出这个仓库，**工作流里没有任何 npm token**，因此「bypass token 不能直发」和「需要 OTP」这两个问题都不存在。

一次性配置（两个包各做一次，账号恢复后）：npmjs.com → 包 → **Settings → Trusted Publisher → GitHub Actions**，填 `Organization or user = lw0129a`、`Repository = dsh-app-packager`、`Workflow filename = publish.yml`（工作流里没声明 `environment`，这一栏就留空 —— 两边必须一致）。

要求与坑：

- 需要 npm ≥ 11.5.1；工作流用 `node-version: '24'`（自带 npm 11.x），并**故意不设** `setup-node` 的 `registry-url`：那会写入 `_authToken` 占位，反而让 npm 不走 OIDC。
- 发布顺序由工作流保证：先 `app-packager`，再 `dsh-app-packager`（后者依赖前者）。
- 先用 `gh workflow run publish.yml -f dry_run=true` 空跑一遍（完整打包 + 鉴权，不上传），确认无误再正式跑。
- 账号还在临时封禁状态时 OIDC 一样会被拒（403），先恢复账号。
- tag 与两个 `package.json` 的版本必须一致，工作流发布前会校验。

### 账号开了 2FA 时：走 npm 的「暂存发布」（staged publishing）

npm 从 2026-07 起收紧了 bypass-2FA granular token：这类 token 不能再做账号/组织/包管理动作，官方 roadmap 也已把「直接发布」列进下一批移除项（见 [Restricting npm bypass-2FA granular access tokens](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)）。本机实测（账号 `lw0129a`，2FA 为 auth-and-writes，2026-10-07）：

| 试的路径 | 结果 |
| --- | --- |
| `pnpm publish` / `npm publish`，npmrc 里是登录态 token | `403 … Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.` |
| 直接发布，npmrc 里是勾了 Bypass 2FA 的 granular token | 被屏蔽成 `404 Not found`；注册表实际返回 `E_STAGE_REQUIRED`：`this token can only publish to a staging area, and "<包名>" does not exist yet. Create it first with a direct-capable token, then use 'npm stage publish'.` |
| `npm stage publish`（同一个 bypass token） | **成功**，无需验证码，且**能创建全新包**（npm 2026-10-02 起支持） |

结论：**用 `npm stage publish` 上传，再由本人带 2FA 批准**。但批准这一步**在 CLI 上走不通**：`npm stage approve <id>`（试过 Node 20/24 × npm 11.21.0/12.2.0、带与不带 `--otp`、以及裸 curl 打 `POST /-/stage/<id>/approve`）一律返回 `404 staged version "…" not found`，响应头还跟着 `npm-notice: npm tokens that bypass 2FA are being restricted…` —— 注册表把"这个凭证没资格批准"伪装成 404，而 npm CLI 只在收到 401 时才弹验证码输入框，所以它永远不会问你要码，换 Node 版本、换 npm 版本、重登都没用。

**可行的批准入口是 npmjs.com 的 `Staged Packages` 页签**（已登录的浏览器会话 + 页面上的 2FA 弹窗），本人实测通过；这也是 npm 官方文档 `content/packages-and-modules/securing-your-code/staged-publishing.mdx` 里写的两条路之一。

`npm stage` 需要 npm ≥ 11（`npm stage --help` 有输出即支持）。npm 12.2.0 要求 Node ≥ 22.22.2，所以 Node 20 上装 11.x：

```bash
npm i -g --prefix /tmp/ap-npm11 npm@11
/tmp/ap-npm11/bin/npm --version   # 期望 11.x
```

## 二、发布到 npm

先用 `pnpm pack` 打出真正的发布件（**插件必须用 pnpm 打包**：它依赖 `app-packager` 时写的是 `workspace:^0.2.0`，只有 pnpm 会在打包时改写成 `^0.2.0`，`npm pack` 会原样保留 workspace 协议，装到 profile 里直接报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`）：

```bash
pnpm -r pack --pack-destination /tmp/ap-pack2
ls /tmp/ap-pack2                   # app-packager-0.2.0.tgz / dsh-app-packager-0.2.0.tgz（另有 private 的根包）

tar -xzOf /tmp/ap-pack2/dsh-app-packager-0.2.0.tgz package/package.json | grep -A2 '"dependencies"'
# 期望看到 "app-packager": "^0.2.0"
```

也可以先本地装一遍验证（可选）：

```bash
npm install -g --prefix /tmp/ap-prefix /tmp/ap-pack2/app-packager-0.2.0.tgz
/tmp/ap-prefix/bin/app-packager doctor
```

CI 的 `pack` 任务已自动校验「tarball 里不含 `workspace:`」与「引擎入口在位」。

确认无误后把两个 tarball 送进暂存区（`stage publish` 直接吃 tarball 路径，不需要额外的改写步骤）：

```bash
NPM=/tmp/ap-npm11/bin/npm          # 系统 npm 10.x 没有 stage 子命令

$NPM stage publish /tmp/ap-pack2/app-packager-0.2.0.tgz
$NPM stage publish /tmp/ap-pack2/dsh-app-packager-0.2.0.tgz

$NPM stage list                    # 看 stage id 与状态：validating → staged
```

然后由包维护者**本人**在 npmjs.com 上批准（会弹 2FA 验证码）：

1. 打开 <https://www.npmjs.com>（已登录 `@lw0129a`）；
2. 进 **Staged Packages** 页签 —— 每个待批包一行，显示包名、`PUBLIC`、版本、shasum、提交者，右侧是 **Approve / Reject / Inspect** 三个按钮；
3. 两个包各点一次 **Approve**，输入认证器里的 6 位码，立刻发布。

```bash
$NPM stage list                            # 批准成功的条目会消失
npm view app-packager version     # 期望 0.2.0
```

> - 刚 stage 完是 `status: validating`（注册表异步校验 tarball），此时批准/查看可能报 `staged version "…" not found`，等它变成 `staged` 再批。
> - **不要在这上面反复试 CLI**：`npm stage approve` 对这类凭证固定 404（见上一节），`--otp` 也救不回来。
> - **npm 恢复码不是 CLI 的 OTP**：把 `npm_recovery_codes.txt` 里的码喂给 `npm publish --otp=…`，注册表会先回 `Your account has been temporarily suspended due to a recent security-sensitive action.`，再给 `403 Forbidden - PUT …`；之后连 `npm stage publish` 也是 403（本机 2026-10-07 实测，读操作不受影响）。恢复码只属于 npmjs.com 的账号恢复流程，不能当 CLI 验证码用 —— 触发后只能等封禁解除或走官方申诉，不要反复重试。
> - `npm stage download <id>` 目前在注册表侧 404（`GET /-/stage/***/tarball`），所以**发布前在本地用 `pnpm -r pack` 检查 tarball**，别指望下载回来验。
> - 若本地 npm 缓存目录权限有问题（`EPERM … _cacache`），加 `npm_config_cache=/tmp/ap-npmcache`。
> - 发错了内容可以 `npm unpublish app-packager@<version>`，但 24 小时后同名同版本不可复用，优先发新版本。
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

- 2026-10-07：fork `lw0129a/awesome-dsh-plugin`，分支 `add-dsh-app-packager`，提了 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750)（只加上面那一个条目文件）。**合并前别删这个 fork**，删了 PR 会被自动关闭。
- 2026-10-08：发布 **0.2.0**：- 2026-10-07：**0.6.0** 完成：引擎新增 `sdk status|urls|install|process` 子命令，面板新增按本机 HBuilderX 版本（`5.26.2026091802`、series `5.26`）推荐并一键配置三平台离线 SDK 的卡片；引擎目录默认改到插件内 `<plugin>/home`（旧的 `~/AppPackager` 首次解析时改名搬入，升级期间暂存到 `<profile>/node_modules/.app-packager-home-backup`）。GitHub release `v0.6.0` 已发布并附两个离线 tgz；**npm 0.6.0 尚未发出** —— 账号在「恢复码当 OTP」的尝试后被临时封禁（见第二节的警告），发布路径已改为 GitHub Actions + trusted publishing（`.github/workflows/publish.yml`，见第一节）：账号恢复并在 npmjs.com 配好 trusted publisher 后，跑一次工作流即可把 0.6.0 发出去。
registry 上仍是 0.2.0。
插件新增 Web GUI 面板（宿主侧 `web.js` 六条同源路由 + 浏览器侧 `client.js`），仓库文档改为中英双份并补上协作规范。
- 2026-10-07：两个包**先以带 scope 的名字**（`@lw0129a/app-packager`、`@lw0129a/dsh-app-packager`）用 staged publishing 发出、由维护者在 npmjs.com 批准上线（0.1.0，暂存区已清空）；随后按需求**去掉 scope 改名**为 `app-packager` / `dsh-app-packager`（命令里不再出现 `@lw0129a/`），以同样流程重新发布 0.1.0。`@lw0129a/*` 那两个旧名只留在 registry 上，不再更新，可选择性 `npm deprecate` 指向新名。
- 2026-10-07：本机 `desktop` profile 已从「本地 tarball + `pnpm-workspace.yaml` override」改回从 registry 安装，并在一个全新临时 profile 里验证过 `dsh plugin --profile <name> add dsh-app-packager` 无需任何 override 即可装载（`--dump-config` 里能看到 `- id: app-packager` 那一层）。
- 当天唯一的红项是仓库年龄（仓库建于 `2026-10-07T02:50:28Z`，24 小时门槛在 `2026-10-08T02:50Z`），按第 3 条的机制等它自己转绿。
- 收录后市场是打开时实时拉的，重新打开插件市场即可搜到；npm 已发布，下载量与一键安装命令会自动补上。


## 四、用户侧安装方式

发布后用户有两种安装路径，README 里都要给出：

```bash
# 1) 插件市场 UI：搜索 AppPackager 点击安装

# 2) 命令行：把包装进指定 profile
dsh plugin --profile <profile> add dsh-app-packager
```

`dsh plugin` 是把参数透传给该 profile 目录的 pnpm（`dsh plugin --profile <name> <pnpm-args...>`），因此也可以 `add` 本地 tarball、`remove`、`update`。

插件装好后需要重启对应 profile 才会挂载四个工具。

## 五、版本与仓库

- 两个包同版本号一起递增：CLI 改了引擎或行为，插件通常也跟随发一版（插件依赖 CLI，声明的是 caret 范围，必要时同步提高下限）。
- 仓库用 `pnpm -r`，`packageManager` 字段锁定 pnpm 版本；CI 从 `packageManager` 取版本，所以改 pnpm 版本要同时改 `package.json` 与锁文件。
- GitHub 上开源的注意事项：`engine/` 里只有原工具链脚本与空的目录占位，`sdk/`、`certificates/` 下的私有内容、`.local.env` 与 `config/projects/*.env` 都由 `.gitignore` 排除，不要为了"完整"把它们提交上去。
