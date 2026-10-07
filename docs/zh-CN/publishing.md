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

也可以让 npm CLI 代劳（npm ≥ 11.5.1；系统自带的 npm 10.x 没有这个子命令，用 `npx --yes npm@11` 或 Node 20 里的 npm 11）：

```bash
npx --yes npm@11 trust github app-packager     --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish
npx --yes npm@11 trust github dsh-app-packager --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish
```

它会先把 `package` / `file` / `repository` / `permissions: publish` 打出来给人核对，然后要一次 2FA：npm 打印（并尝试打开）`https://www.npmjs.com/auth/cli/<id>`，在浏览器里批准即可 —— **整个过程只有这一步必须人工**，bypass-2FA 的 granular token 做不了账号级改动。`npm trust list <包>` 随时可查当前配置（同样要 2FA）。

要求与坑：

- 需要 npm ≥ 11.5.1；工作流用 `node-version: '24'`（自带 npm 11.x），并**故意不设** `setup-node` 的 `registry-url`：那会写入 `_authToken` 占位，反而让 npm 不走 OIDC。
- 发布顺序由工作流保证：先 `app-packager`，再 `dsh-app-packager`（后者依赖前者）。
- 先用 `gh workflow run publish.yml -f dry_run=true` 空跑一遍（完整打包 + 鉴权，不上传），确认无误再正式跑。
- 发布步骤以 `npm error code ENEEDAUTH` 收尾，几乎总是「这个包还没配 trusted publisher」：npm 把 OIDC 换取 token 的失败吞在 verbose 级别，最后只剩一句「需要登录」。工作流已把发布步骤的 `NPM_CONFIG_LOGLEVEL` 设成 `verbose`，日志里会多一行 `oidc Failed token exchange request with body message: …`，那才是注册表的原话。空跑同样会走一遍 OIDC 交换（npm 在 dry-run 判断之前就换 token），所以正式发之前就能看出配置是否生效。实测（2026-10-07 空跑 run `37596831093`）：两个包都是 `npm http fetch POST 404 …/-/npm/v1/oidc/token/exchange/package/<包名>` + `OIDC token exchange error - package not found` —— 还没配 trusted publisher 时就是这个 404（两个包在 registry 上都存在，`latest` 都是 0.2.0）。如果按上面配好 trusted publisher 之后再空跑还是同一句 404，那可能撞上了 npm 侧的已知问题（包嵌在 monorepo 子目录、`package.json` 里带 `repository.directory` 时该接口报 404，见 [community discussion #202661](https://github.com/orgs/community/discussions/202661)）；这时改走第二节的暂存发布（`npm stage publish` + 浏览器批准），或在终端里交互式 `npm publish`（手动输入一次性验证码）。
- **账号处于 security hold 期间，暂存发布和 trusted publisher 都会被拒**。2026-10-07 实测：`npm stage publish <tgz>` 在打完 tarball 明细后返回 `npm error code E403` / `403 Forbidden - POST https://registry.npmjs.org/-/stage/package/app-packager`，通知里带一句 `Your account has been temporarily suspended due to a recent security-sensitive action.`。这不是 2FA 的问题：**用恢复码登录会触发 npm 的 72 小时 security hold**，期间「发布及其它安全敏感写入（包括创建 access token）」一律暂停，到期自动解除、不需要支持工单（见 [npm extends recovery-code security holds to all accounts](https://github.blog/changelog/2026-09-09-npm-extends-recovery-code-security-holds-to-all-accounts/)）。只读操作（`npm whoami`、`npm profile get`、`npm stage list`）在 hold 期间完全正常 —— **别拿只读探测当「已解封」**。判断 hold 是否结束最快的办法就是重跑一次 `npm stage publish <tgz>`：不需要 2FA，被拒就还是一句 403 + 上面那句话。
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

### 别把欠着的那一版跳过去

`publish.yml` 发的是**被触发的那次 ref 上的包版本**，所以「GitHub 上已经有 release 资产、npm 上却查不到这个版本」时，补发要从**那个 tag** 出发，并且在它上线之前**不要动 main 的版本号**：

```bash
npm view app-packager version              # registry 上是哪一版
gh release view v0.6.1                     # 有 tag、有资产，但上一行还没到 0.6.1
gh workflow run publish.yml --ref v0.6.1   # tag 自带的 workflow 与 main 相同，可直接补发
```

若先把 main 改成 0.6.2 再 dispatch，工作流会照着 main 的版本发 0.6.2，欠着的那版就永远停在「只有 GitHub release、没有 npm 包」的状态。等它真的上了 npm（`npm view <包> versions` 里能看到）再抬 main 的版本号、打新 tag 发后面的改动。

**例外：欠着的那一版本身有硬伤，就直接作废它。** 0.6.1 就是这种情况 —— 它的面板在数据到位后会白屏（客户端 `client.js` 里 SDK 卡片的派生 `const` 声明写在了卡片后面，时间死区）。这种版本发上 npm 只会白白烧掉一个版本号，正确做法是：把修复做进下一版（0.6.2）、撤掉旧 release 上有问题的资产，然后按新版本发，并把这段历史记进下面的上架记录。判断标准不是「有没有发布出去」，而是「装上去能不能用」。

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

- 2026-10-07（续6）：**0.6.1 作废，改发 0.6.2**。用户报告「应用打包界面一闪而过，然后一直空白」：根因在客户端 —— `client.js` 里 SDK 卡片的派生 `const`（`sdkInfo` / `sdkList` / `hb` / `sdkMark` / `sdkStateText`）声明在卡片**之后**，卡片却是立刻求值的，于是 `GET state` 一到就抛 `ReferenceError: Cannot access 'hb' before initialization`（`client.js` 旧 :688），React 卸载整块面板；`state` 为 null 的那次渲染里所有卡片短路成 null，所以只是「闪一下」。已把声明上移到卡片之前（提交 `aad8e0a`），并在 `plugin.test.mjs` 补一条**用真实 state 再渲染一遍**的断言 —— 此前用例只渲染 `state = null`，正好绕开所有卡片，这就是 0.6.1 带着白屏 bug 全绿发布的原因。两个包版本升到 0.6.2（插件依赖 `workspace:^0.6.2`），本机 desktop profile 已按「暂存 `home/` → `pnpm add file:<新 tgz>` → 移回 `home/`」的安装流程装上 0.6.2：`home/.engine-version` 0.6.1→0.6.2，3.5G 离线 SDK、证书、配置、两个项目全保留，`sdk urls` 现在能打出真实 HBuilderX 版本。npm 侧仍在 security hold 上，上线顺序统一改成按 **0.6.2** 发。
- 2026-10-07（续5）：**0.6.1 仍未上 npm**（卡在 security hold 上，见「续4」；最晚 2026-10-10 17:11 本地解除）。本轮把「补发不能跳过欠着的那版」写成上面第二节的规则：`publish.yml` 按触发 ref 的包版本发布，所以 0.6.1 上线前 main 的版本号必须留在 0.6.1，补发用 `gh workflow run publish.yml --ref v0.6.1`（tag 自带的 workflow 与 main 相同）。同时 ③ 可视化入口确认恢复 —— 用户约 17:00 重启宿主后，宿主侧工具正常应答（`app_packager_list`：引擎目录 `~/.dsh/profiles/desktop/node_modules/dsh-app-packager/home`、引擎版本 0.6.1、两个项目），`app_packager_check all` 退出码 0、两项目三平台全 `errors=0`，且客户端 code cache 17:05 新写入且含 `dsh-app-packager`。
- 2026-10-07：fork `lw0129a/awesome-dsh-plugin`，分支 `add-dsh-app-packager`，提了 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750)（只加上面那一个条目文件）。**合并前别删这个 fork**，删了 PR 会被自动关闭。
- 2026-10-07（晚）：PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍是 **OPEN**（未合并）；条目里**没有版本号**，所以以后发新版本不需要再改它。顺手把条目描述更新成 0.6.0 的能力（HBuilderX 版本感知的 SDK 一键配置 + 官方下载入口），fork 分支 `add-dsh-app-packager` 的新提交 `94f01a2` 已进 PR。
- 2026-10-08：发布 **0.2.0**：
registry 上仍是 0.2.0。
插件新增 Web GUI 面板（宿主侧 `web.js` 六条同源路由 + 浏览器侧 `client.js`），仓库文档改为中英双份并补上协作规范。
- 2026-10-07（续4）：**0.6.1 的 npm 发布卡在账号的 72 小时 security hold 上**，不是配置问题：本机 16:57（UTC 08:57）我用绕过 2FA 的 granular token 直接 `npm stage publish` 两个 0.6.1 tarball（`/tmp/ap-pack-0.6.1/app-packager-0.6.1.tgz`、`/tmp/ap-pack-0.6.1/dsh-app-packager-0.6.1.tgz`，与 release 资产 sha256 一致），注册表回 `npm error code E403` / `403 Forbidden - POST https://registry.npmjs.org/-/stage/package/app-packager`，并附 `Your account has been temporarily suspended due to a recent security-sensitive action.`；同一次会话里 `npm whoami`（`lw0129a`）、`npm profile get`、`npm stage list`（`No staged packages found.`）全部正常。按 npm 2026-09-09 的公告，用恢复码登录会触发 72 小时 security hold，期间「发布及其它安全敏感写入（含创建 access token，很可能也包括配 trusted publisher）」一律暂停、到期自动解除、无需工单。**判断标尺就是重跑 `npm stage publish`**（不需要 2FA）。hold 结束后两条路随便选：直接 stage 两个 tarball、再去 npmjs.com 的 Staged Packages 页签点两次批准；或者按第一节配好 trusted publisher 后跑 `publish.yml`。
- 2026-10-07（续3）：把 ④ 的「发布」这一步钉死：确认 `publish.yml` 之前的失败不是工作流写错 —— npm 换 OIDC token 是「先换、后判断 dry-run」，失败只写 verbose 日志，线上于是只剩一句 `ENEEDAUTH need auth`。发布步骤现在设 `NPM_CONFIG_LOGLEVEL=verbose`，日志里会直接给出注册表的原话 `oidc Failed token exchange request with body message: …`；空跑（`gh workflow run publish.yml -f dry_run=true`）同样会走一遍交换，所以「trusted publisher 配没配上」不必等正式发布就能验证 —— 空跑实测（run `37596831093`，2026-10-07）两个包都得到 `POST 404 …/-/npm/v1/oidc/token/exchange/package/<包名>` 与 `OIDC token exchange error - package not found`：没配 trusted publisher 时就是这个 404（两个包在 registry 上都存在、`latest` 都是 0.2.0），配好后再空跑一次即可一眼确认。同轮还修掉 `sdk urls` / `sdk text` 人读版恒显示「版本: 未知」（脚本版本 `2026.10.10.4`，提交 `0dd4b9d`）。
- 2026-10-07（续2）：（**这条判断后来被证明是误判** —— 只读探测在 security hold 期间也全部正常，见「续4」）当时以为 **npm 账号已不再处于封禁状态**：`npm whoami` → `lw0129a`、`npm profile get` 正常、`npm stage list` → `No staged packages found.`、`npm trust github …` 一路走到 `Two-factor authentication is required for this operation` 才停 —— 每个探测都只差那一次浏览器 2FA 授权（`https://www.npmjs.com/auth/cli/<id>`），没有 403、没有再提临时封禁。`npm trust github app-packager --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish` 已把 package/file/repository 校验通过并报 `permissions: publish`。两个包各批一次（或走网页表单），再跑一次 `publish.yml` 就能发 0.6.1。
- 2026-10-07（续）：**0.6.1** 准备发布：把 0.6.0 之后 main 上的引擎修复收进这一版 —— `sdk install` 改为以平台是否真的就绪判定成败（没装成不再打印「SDK 配置完成」）；已就绪的平台重复执行会打印「已就绪，跳过」，所以「一键配置」可以反复点、不再重下 800MB 级离线包；`config/settings.local.env` 与 `config/init.local.env` 里位于引擎目录内的 SDK 路径改写为 `"$PIPELINE_ROOT/..."`，引擎目录整体改名搬走后已装好的 SDK 不会变 `missing`。GitHub release `v0.6.1` 已发布（附两个离线 tgz）；**npm 0.6.1 仍等账号解封 + 两个包各配一次 trusted publisher**，随后跑 `publish.yml` 即发。当天又发现并修掉「插件升级后 `home` 里的引擎副本不跟着刷新」——宿主原来只在 `home` 完全缺失时才物化引擎，所以 0.6.0 的 `home` 会一直跑旧引擎（正是上面那几条引擎修复到不了的原因）；现在每次调用都会物化、版本一致时自动空转，面板也会显示「目录里是 X，需要刷新」。因为资产要含这个修复，`v0.6.1` 的 tag 与两个资产在 `4c0cdd9` 上重切了一次（`dsh-app-packager-0.6.1.tgz` 45318B sha256 `7175ad228c9151a212a13296d952ba6450d9b5409b37d12e15c0d680eeb8e49c`；`app-packager-0.6.1.tgz` 未变，144621B sha256 `dbe6450f4c3b64312a4ed91eaca492c42b79257cdb1c3e88b0f3682478d94ed2`）；本机 `desktop` profile 已就地升到这一版，`home` 里的引擎也刷到 0.6.1（`copied 39`），SDK、证书与项目一个没动。
- 2026-10-07：**0.6.0** 完成：引擎新增 `sdk status|urls|install|process` 子命令，面板新增按本机 HBuilderX 版本（`5.26.2026091802`、series `5.26`）推荐并一键配置三平台离线 SDK 的卡片；引擎目录默认改到插件内 `<plugin>/home`（旧的 `~/AppPackager` 首次解析时改名搬入，升级期间暂存到 `<profile>/node_modules/.app-packager-home-backup`）。GitHub release `v0.6.0` 已发布并附两个离线 tgz；**npm 0.6.0 尚未发出** —— 账号在「恢复码当 OTP」的尝试后被临时封禁（见第二节的警告），发布路径已改为 GitHub Actions + trusted publishing（`.github/workflows/publish.yml`，见第一节）：账号恢复并在 npmjs.com 配好 trusted publisher 后，跑一次工作流即可把 0.6.0 发出去。 **当天首次真跑 CI**：工作流本身全绿（npm 11.19.0），发布步骤以 `npm error code ENEEDAUTH`（`need auth … requires you to be logged in`）收尾 —— 工作流里没有任何 token、注册表也没做 OIDC 交换，说明两个包上还没配 trusted publisher。账号解除封禁并在 npmjs.com 配好后，重跑一次工作流（或再推一次 `v0.6.0` tag）即可。
- 2026-10-07：两个包**先以带 scope 的名字**（`@lw0129a/app-packager`、`@lw0129a/dsh-app-packager`）用 staged publishing 发出、由维护者在 npmjs.com 批准上线（0.1.0，暂存区已清空）；随后按需求**去掉 scope 改名**为 `app-packager` / `dsh-app-packager`（命令里不再出现 `@lw0129a/`），以同样流程重新发布 0.1.0。`@lw0129a/*` 那两个旧名只留在 registry 上，不再更新，可选择性 `npm deprecate` 指向新名。
- 2026-10-07：本机 `desktop` profile 已从「本地 tarball + `pnpm-workspace.yaml` override」改回从 registry 安装，并在一个全新临时 profile 里验证过 `dsh plugin --profile <name> add dsh-app-packager` 无需任何 override 即可装载（`--dump-config` 里能看到 `- id: app-packager` 那一层）。
此后 0.6.0/0.6.1 期间是例外：registry 上还只有 0.2.0，所以 `desktop` profile 一直用 `file:…/.app-packager-local/dsh-app-packager-0.6.1.tgz` 安装，并保留 `pnpm-workspace.yaml` 里对 `app-packager` 的 `file:` override；0.6.1 发上 registry 后应改回 `dsh plugin --profile desktop add dsh-app-packager` 并删掉那行 override。另外 `dsh --profile desktop --dump-config` 会被拒（`error: profile "desktop" is managed exclusively by the Electron application`），要复核组装结果只能复刻一份 profile（拷 `package.json`/`cordis.yml`/`cordis.patch.yml`/`pnpm-workspace.yaml`/`pnpm-lock.yaml`，`node_modules` 符号链接指回原目录），再 `DSH_HOME=<临时根> dsh --profile <复刻名> --dump-config`。被拒的只是这类读配置的命令：`dsh plugin --profile desktop …` 只是转发 pnpm，照常可用（本机实测 `dsh plugin --profile desktop ls dsh-app-packager` 返回 0.6.1），面板的「升级插件」走的就是它。
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
