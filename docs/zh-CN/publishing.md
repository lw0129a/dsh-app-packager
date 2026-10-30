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
   注意 **pnpm 打的包里所有文件都是 644**（`npm pack` 才保留 755），所以别指望 tarball 里的权限位：CLI 物化引擎时会把 `.command`/`.sh` 一律补回 755（`src/home.ts` 的 `EXECUTABLE` 规则，有单测），用户手里那份是可双击的。
2. tarball 里没有运行时依赖：引擎由 `prepack` 复制进 `vendor/app-packager`，不需要第二个包，也不会留下没重写的 `workspace:` 协议。
3. 两个 `package.json` 的 `version` 已递增。

两个包都发布在 npm 公共仓库上、**包名不带 scope**（`app-packager` 与 `dsh-app-packager`），发布前只需确认 `npm whoami` 是本人（`lw0129a`）：

```bash
npm login
```

### 首选：交给 GitHub Actions（trusted publishing，免 token 免验证码）

`.github/workflows/publish.yml` 已经就绪：推 `v*` tag 自动发布，或在 Actions 页签手动 `gh workflow run publish.yml`。它用 `id-token: write` 让 npm 通过 OIDC 认出这个仓库，**工作流里没有任何 npm token**，因此「bypass token 不能直发」和「需要 OTP」这两个问题都不存在。

> **⛔ 2026-10-11 实测：这条路在当前仓库上走不通，先不要再花时间。** 仓库建于 2026-10-07，晚于 GitHub 2026-07-15 的切换线，OIDC token 的 `sub` 被强制改成不可变格式 `repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:…`，而 npm 的换票接口仍按旧格式 `repo:<owner>/<repo>:ref:…` 匹配，于是**trusted publisher 无论怎么填都会失败**：
>
> - 读法：`gh api repos/lw0129a/dsh-app-packager/actions/oidc/customization/sub` → `{"use_default":true,"use_immutable_subject":true,"sub_claim_prefix":"repo:lw0129a@334367781/dsh-app-packager@1408157736"}`。
> - 没配 trusted publisher → 换票 `404 OIDC token exchange error - package not found`（2026-10-07 空跑 run `37596831093`）。
> - 按常规填好（Organization/user `lw0129a`、Repository `dsh-app-packager`、Workflow filename `publish.yml`、Environment 空、勾 Allow npm publish）→ 变成 **`401 {"message":"OIDC token exchange error - unauthorized"}`**（run `38108978783`、`38109042111`）。
> - 再按不可变格式**新增**一条 binding（`lw0129a@334367781` / `dsh-app-packager@1408157736`）→ **仍然 401**（run `38109448853`）⇒ npm 不是拿字符串直接比对，填 @ID 也救不回来。
> - GitHub 侧没有开关：`PUT /repos/{owner}/{repo}/actions/oidc/customization/sub` 传 `{"use_default":false,"include_claim_keys":["repo","ref"]}` 返回 201、`use_default` 也确实变成 false，但 `sub_claim_prefix` **照旧带 @ID**（已还原成 `use_default:true`）。[npm/cli#9969](https://github.com/npm/cli/issues/9969) 记录的就是这个不匹配；对照实验见 [aywengo/mercury#375](https://github.com/aywengo/mercury/issues/375)：拿一个**根本不存在的包名**去换票，注册表回的也是同一句 unauthorized —— 说明它在"看任何包之前"就拒了这个 token。
> - 只有 2026-07-15 之前创建的老仓库还能走通 OIDC（例：`hraness/hra`，legacy `sub`）。`lw0129a` 名下只有 `dsh-app-packager` 与 `awesome-dsh-plugin`，都建于 2026-10-07 ⇒ **没有旧仓库可借道**。
> - 结论：这条首选路径先搁置，等 npm 修好匹配（或 GitHub 给出退回开关）再启用；在那之前 `publish.yml` 的「预检 npm trusted publisher」步骤会一直红，**不是再去 npm 配一次能解决的**。日常发布走下面第二节的 granular token 直发。

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

### 首选（2026-10-11 实测可行）：bypass-2FA granular token 直接发布

npmjs.com → 右上头像 → **Access Tokens** → **Generate New Token** → **Granular Access Token**：

| 字段 | 取值 |
| --- | --- |
| Token name | 任意，如 `app-packager-publish-2` |
| Packages and scopes → Permissions | **Read and write (publish and stage)**。表单底部 Summary 会写 `Publish new versions directly` —— 这就是旧版 UI 里那个 `Bypass 2FA` 勾选框，新版把它并进了权限单选；选 **Read and write (stage only)** 拿到的是只能暂存的令牌（直发时报 `E_STAGE_REQUIRED`） |
| Select packages | 只勾 `app-packager` + `dsh-app-packager`（或 All packages） |
| Expiration | 写权限令牌默认 7 天、最长 90 天 —— 发完就 revoke |

生成时要用账号的 2FA 确认一次。**本账号的 2FA 是安全密钥（WebAuthn），没有 6 位动态码**（`Account Settings → Profile` 写的是 `Enabled for authorization and publishing` + `1 security key`），因此：

- 浏览器里用 Touch ID / 插入密钥确认即可，**不要等验证器、短信或邮件里的 6 位码 —— 它根本不存在**；
- 不带 bypass 的令牌直发一定报 `npm error code EOTP / This operation requires a one-time password from your authenticator`，而 `--otp=<码>` **没有任何码可填**；
- **不要**把 `npm_recovery_codes.txt` 里的恢复码喂给 `--otp`（会把账号打进 72 小时 security hold，见本节末尾的警告）。

拿到令牌后（**别把它提交进仓库**）：

```bash
umask 077
npm config set //registry.npmjs.org/:_authToken='npm_xxx' --location=user   # 写进 ~/.npmrc
npm whoami                                                                 # 期望 lw0129a

pnpm -r pack --pack-destination /tmp/ap-pack2                              # 打出真正的发布件
npm publish /tmp/ap-pack2/app-packager-0.6.2.tgz
npm publish /tmp/ap-pack2/dsh-app-packager-0.6.2.tgz

npm view app-packager version        # 期望 0.6.2
npm view dsh-app-packager version    # 期望 0.6.2
```

`npm publish <tgz>` 打印 `+ <包>@<版本>` 就算成功；紧跟的 `Your package is being processed and may take a few minutes to become available.` 表示注册表还在处理，`npm view` 可能要 1–2 分钟才看得到（最快的读法是 `curl -s -H 'Cache-Control: no-cache' https://registry.npmjs.org/<包>`）。发布完**立刻 revoke 那个令牌**，并删掉 `~/.npmrc` 里那一行。

---

下面是从 2026-10 之前一路用下来的老路径（暂存发布 `npm stage publish` + 浏览器批准）：直发令牌可用时用不到，留作备选。

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

**例外：欠着的那一版本身有硬伤，就直接作废它。** 0.6.1 就是这种情况 —— 它的面板在数据到位后会白屏（客户端 `src/client.ts` 里 SDK 卡片的派生 `const` 声明写在了卡片后面，时间死区）。这种版本发上 npm 只会白白烧掉一个版本号，正确做法是：把修复做进下一版（0.6.2）、撤掉旧 release 上有问题的资产，然后按新版本发，并把这段历史记进下面的上架记录。判断标准不是「有没有发布出去」，而是「装上去能不能用」。

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

仓库根就是插件包，所以用普通仓库形式即可；`dist/` 与 `vendor/` 已入库，从 git 安装不需要再构建。

```yaml
# data/plugins/lw0129a__dsh-app-packager--packages-dsh-app-packager.yml
url: https://github.com/lw0129a/dsh-app-packager
name: lw0129a/dsh-app-packager#dsh-app-packager
category: dev
description:
  en: 'Packaging pipeline for uni-app x projects: drives the HBuilderX CLI to build, sign and upload iOS, Android and HarmonyOS apps from per-project config files, and exposes the engine to the agent as list / doctor / check / build tools. Classic uni-app projects (uni-app + Vue) build Android APKs locally too.'
  zh: 'uni-app x 项目打包流水线：按项目配置调用 HBuilderX CLI 打出并签名 iOS / Android / HarmonyOS 安装包，并以 list / doctor / check / build 四个工具暴露给 agent。经典 uni-app 项目（uni-app + Vue）同样支持本地打 Android 包。'
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
2. **`dsh.bundle`**：从条目指向的那份 `package.json` 读（根包，或 `packages/` · `plugins/` · `apps/` 子包）。本项目的插件就在仓库根的 `package.json`，声明的正是 `dsh.bundle.patch`，符合这条。
3. **`MIN_AGE_DAYS = 1`：仓库创建满 1 天。这条红是自己会消失的** —— 校验器原话是不要重提、不要空推、不要关掉重开，`regate.yml`（cron `19 */6 * * *`）每 6 小时重跑一遍 gate，时间一到自动转绿。
4. 仓库要打 `dsh-plugin` topic。
5. 官方 `@deepseek-ai/*` 包必须是 `peerDependencies` 而不是 `dependencies`。
6. 首次贡献者的 fork PR 需要维护者点一次 approve，workflow 才会真正跑（GitHub 的 `action_required`）—— 这不是提交本身有问题。

截图可选：在自己的仓库里放 `screenshots.json`（与插件的 `package.json` 同级），列 1–8 个图片路径，市场详情页会显示；不写就从 README 里抽。

### 本项目的上架记录

- 2026-10-14（晚）：**本人在 npmjs.com 手动 Approve，0.6.4 双包上线，v0.6.4 的 tag 与 release 也补齐了**。registry 的 `dist-tags.latest` 双双变 0.6.4（`time.modified` `2026-10-14T08:12:35.052Z` = 北京时间 16:12），`registry.npmmirror.com` 也已同步 0.6.4；两包的 sha1 与 10-11 送进暂存区时**逐字节一致**（`app-packager@0.6.4` `9f9a252b74b3f7bd8d47182a39a15e2573a83536`，51 files / unpacked 560766 B；`dsh-app-packager@0.6.4` `008d611b04181bfa7cb44169b29cd5bfd02a37c3`，10 files / unpacked 191962 B），说明「批准」这一步没有改动产物。同日补上一直缺的 **annotated tag `v0.6.4`（指向 `495d9e8`）与 GitHub release**，资产沿用老命名 `app-packager-0.6.4.tgz`（167930 B）/ `dsh-app-packager-0.6.4.tgz`（62292 B），把两个资产从 release 下回来 sha1 仍是上面那两个值（资产直接取自 registry tarball；该 sha1 已等于 10-11 本机 `pnpm -r pack` 的值，所以与本机重打同源）。tag push 照例触发 `publish.yml` 并失败（trusted publisher 一直没配，本项目每次 tag push 都这样，属预期）。**市场侧没有变化**：PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍 OPEN、清单里仍 0 命中，那一步只能等维护者批 workflow。
- 2026-10-14（下午）：**两条待办都推了一遍，当时剩下的两步都在别人手上**。① npm 侧 0.6.4 当时**仍在暂存区**：`npm view dsh-app-packager@0.6.4` → 404、`dist-tags.latest` 仍是 0.6.3、GitHub release 的 Latest 也还是 v0.6.3，**等你本人在 npmjs.com 的 Staged Packages 页各点一次 Approve**（stage id 见下一条；staged 只能由发布者本人批准，agent 无论如何都动不了）。② 市场侧 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍 **OPEN**、`mergeable: MERGEABLE`、唯一 check 仍是 **FAILURE「No checks ran on this pull request」**（首次贡献者 fork 的 `pr-check.yml` 停在 `action_required`），维护者既没批 workflow 也没回话，所以又留了第二条留言（`issuecomment-6159646205`），内容是 npm 侧已可用、条目自 10-07 未变、可按需改分类或措辞。上游自身很活跃（10-13 还在连续合 PR），但这条没人接 —— **这条线目前没有能自己推进的动作**。
- 2026-10-14 复核（结论未变，证据刷新）：自带插件页（`@deepseek-ai/dsh-plugin-manager`）**既没有社区清单也没有搜索** —— `app.asar` 里 `awesome-dsh-plugin` / `plugins.json` / `registry.npmjs.org/-/v1/search` 全部 0 命中，只有 `pnpm view` 解析 spec；UI 文案就是「填入插件 npm 包名（如 dsh-xxx 或 @作者/插件名）」。所以那里「搜到」只等于「按包名 `dsh-app-packager` 能解析并装上」，而这条路现在是通的。市场（dsh-market）数据源仍只有 `awesome-dsh-plugin` 清单：官方 `plugins.json` 4634 条、`app-packager` / `lw0129a` **0 命中**；本机 `region: china` 实际走 npm 镜像 `dsh-plugin-catalog`，最新 `2026.1013.5123`（10-13 镜像）同样 0 命中。npm 镜像侧两个包的 `latest` 都已同步到 0.6.3（国内源装机没有障碍）。
- 2026-10-11（深夜）：**0.6.4 已送 npm 暂存区，等本人批准**。`app-packager@0.6.4`（sha1 `9f9a252b74b3f7bd8d47182a39a15e2573a83536`，167.9 kB，stage id `e37fa7b3-6284-4dbe-8a79-d2ddee2fb58f`）与 `dsh-app-packager@0.6.4`（sha1 `008d611b04181bfa7cb44169b29cd5bfd02a37c3`，62.3 kB，stage id `5b7da2f4-5f04-4b4f-a95b-65687df7c1b9`）由 `/tmp/ap-npm11/bin/npm`（11.21.0；系统 npm 10.8.2 没有 `stage`）用暂存专用令牌送进暂存区，等维护者在 <https://www.npmjs.com> 的 **Staged Packages** 页各点一次 Approve 才会真正上线。内容：引擎导出 `PYTHONUTF8`/`PYTHONIOENCODING`（Windows 的 python3 默认按本地代码页编码 stdout，中文输出直接 `UnicodeEncodeError`，CI 的 windows 腿就是这么红的）；测试改回可移植写法（JSONC 断言改用 `grep`，下载目录用例用 `os.tmpdir()`），`pnpm-lock.yaml` 跟上 `workspace:^0.6.3`。上一条 0.6.3 发布后 CI 曾整片红：ubuntu/macos 腿是 `ERR_PNPM_OUTDATED_LOCKFILE`（漏更新锁文件），windows 腿是上面那两个测试，现在 **CI 四个平台 × 三个 Node 版本全绿**。
- 2026-10-11（当晚）：**0.6.3 上 npm**。`~/.npmrc` 早前按收尾待办删掉了，所以发布用的是从 shell 历史里找回、且仍有效的旧直发令牌（`npm publish <tgz> --userconfig=<临时文件>`，没写回 `~/.npmrc`）：`app-packager@0.6.3`（sha1 `204fc4b8873b7278e41c5b935aef724135cc63ce`，51 files，tgz 167.7 kB / unpacked 560.5 kB）与 `dsh-app-packager@0.6.3`（sha1 `44dc423f8cc1ff68739b84c08392acae403b6510`，10 files，tgz 62.3 kB / unpacked 192.0 kB），`dist-tags.latest` 双双 0.6.3，registry 的 sha1 与本机 `pnpm -r pack` 产物逐字节一致；插件包里的依赖已被 pnpm 改写成 `"app-packager": "^0.6.3"`。本版内容：经典 uni-app 项目的 Android 本地打包、面板证书板块、已归档安装包的下载（本地 `copyFile`）。市场侧 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍是 OPEN + `mergeStateStatus: UNSTABLE`（等维护者 approve 首次贡献者的 workflow）；同日实测官方 `plugins.json`（4489 条）与 npm 镜像 `dsh-plugin-catalog@2026.1011.5023`，`app-packager` / `dsh-app-packager` / `lw0129a` **0 命中**，所以市场里还搜不到。
 本机 `desktop` profile 也按「暂存 `home/` → `pnpm add` → 移回 `home/`」装上了 0.6.3（3.7G 的离线 SDK、证书、配置、项目全保留，`dsh-app-packager`/`app-packager` 都成了 0.6.3，`home/` 里的引擎与面板文件和仓库逐字节一致；因为 0.6.3 太新会被 profile 的 `minimumReleaseAge` 拦下，这次安装临时用了 `--config.minimumReleaseAge=0`，没有改 `pnpm-workspace.yaml` 的排除表）。
- 2026-10-11：**0.6.2 终于上了 npm**。`app-packager@0.6.2`（sha1 `fad39640bd5d54c12d3eccfffae6b38320066247`，51 files，161.2 kB）与 `dsh-app-packager@0.6.2`（sha1 `9b979dba50a76e3d64e777aabd4cc452c264a119`，10 files，57.3 kB）已发布，`dist-tags.latest` 双双是 0.6.2；registry 上的 sha1 与本机 `pnpm -r pack` 产物逐字节一致（也就是与两个 GitHub release 资产同源）。同一天把 **v0.6.1 / v0.6.2 的 release 资产补齐**（v0.6.1 与本地重打逐字节相同、sha256 与「续2」记录的一致 ⇒ 打包可复现）。发布走的是本节新增的「bypass-2FA granular token 直发」：trusted publishing（OIDC）在这两个仓库上被 GitHub 的不可变 `sub` 彻底堵死（见第一节的实测记录），**账号的 2FA 是安全密钥、没有 6 位动态码**，所以 `--otp` 那条路本来就不存在。市场侧 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍是 OPEN：唯一的红是「首次贡献者的 workflow 需要维护者点一次 approve」，已在 PR 下留言（`issuecomment-6104946422`）；npm 包已存在，条目自动采集 npm 映射的条件（已发布包的 `repository` 指回被收录的仓库）已经满足。
- 2026-10-11（收尾待办）：用完请 **revoke 直发令牌** 并从 `~/.npmrc` 删掉那一行；npm 上那条按不可变格式另建的 trusted publisher（`lw0129a@334367781` / `dsh-app-packager@1408157736`）没有作用，可以删掉；0.6.2 既已在 registry，`desktop` profile 的 `file:` 安装与 `pnpm-workspace.yaml` 里 `app-packager` 的 `file:` override 就可以按 2026-10-07 那条记录里的计划改回 `dsh plugin --profile desktop add dsh-app-packager`（本轮没动它，避免影响正在用的 3.5G 离线 SDK 与证书）。
- 2026-10-07（续6）：**0.6.1 作废，改发 0.6.2**。用户报告「应用打包界面一闪而过，然后一直空白」：根因在客户端 —— `src/client.ts` 里 SDK 卡片的派生 `const`（`sdkInfo` / `sdkList` / `hb` / `sdkMark` / `sdkStateText`）声明在卡片**之后**，卡片却是立刻求值的，于是 `GET state` 一到就抛 `ReferenceError: Cannot access 'hb' before initialization`（`src/client.ts` 旧 :688），React 卸载整块面板；`state` 为 null 的那次渲染里所有卡片短路成 null，所以只是「闪一下」。已把声明上移到卡片之前（提交 `aad8e0a`），并在 `plugin.test.mjs` 补一条**用真实 state 再渲染一遍**的断言 —— 此前用例只渲染 `state = null`，正好绕开所有卡片，这就是 0.6.1 带着白屏 bug 全绿发布的原因。两个包版本升到 0.6.2（插件依赖 `workspace:^0.6.2`），本机 desktop profile 已按「暂存 `home/` → `pnpm add file:<新 tgz>` → 移回 `home/`」的安装流程装上 0.6.2：`home/.engine-version` 0.6.1→0.6.2，3.5G 离线 SDK、证书、配置、两个项目全保留，`sdk urls` 现在能打出真实 HBuilderX 版本。npm 侧仍在 security hold 上，上线顺序统一改成按 **0.6.2** 发。
- 2026-10-07（续5）：**0.6.1 仍未上 npm**（卡在 security hold 上，见「续4」；最晚 2026-10-10 17:11 本地解除）。本轮把「补发不能跳过欠着的那版」写成上面第二节的规则：`publish.yml` 按触发 ref 的包版本发布，所以 0.6.1 上线前 main 的版本号必须留在 0.6.1，补发用 `gh workflow run publish.yml --ref v0.6.1`（tag 自带的 workflow 与 main 相同）。同时 ③ 可视化入口确认恢复 —— 用户约 17:00 重启宿主后，宿主侧工具正常应答（`app_packager_list`：引擎目录 `~/.dsh/profiles/desktop/node_modules/dsh-app-packager/home`、引擎版本 0.6.1、两个项目），`app_packager_check all` 退出码 0、两项目三平台全 `errors=0`，且客户端 code cache 17:05 新写入且含 `dsh-app-packager`。
- 2026-10-07：fork `lw0129a/awesome-dsh-plugin`，分支 `add-dsh-app-packager`，提了 PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750)（只加上面那一个条目文件）。**合并前别删这个 fork**，删了 PR 会被自动关闭。
- 2026-10-07（晚）：PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) 仍是 **OPEN**（未合并）；条目里**没有版本号**，所以以后发新版本不需要再改它。顺手把条目描述更新成 0.6.0 的能力（HBuilderX 版本感知的 SDK 一键配置 + 官方下载入口），fork 分支 `add-dsh-app-packager` 的新提交 `94f01a2` 已进 PR。
- 2026-10-08：发布 **0.2.0**：
registry 上仍是 0.2.0。
插件新增 Web GUI 面板（宿主侧 `web.js` 六条同源路由 + 浏览器侧 `src/client.ts`），仓库文档改为中英双份并补上协作规范。
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
