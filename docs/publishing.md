# 发布与上架

本文档记录把两个包发到 npm、并让插件出现在 DeepSeek Harness 插件市场里的完整步骤。

## 一、发布前检查

```bash
pnpm install
pnpm test                     # 两个包的 node --test 用例
pnpm -r pack --pack-destination /tmp/ap-pack   # 先看 tarball 内容再发布
```

要确认的三件事：

1. `packages/app-packager` 的 tarball 里带上了 `engine/`（约 45 个文件、~115 KB），且 `engine/打包工具.command` 与 `engine/初始化.command` 仍是可执行位（`tar -tvzf` 看权限位是否为 `-rwxr-xr-x`）。
2. `packages/dsh-app-packager` 的 tarball 里 `package.json` 的 `@lw0129a/app-packager` 依赖已从 `workspace:^0.1.0` 被 pnpm 重写成 `^0.1.0`（npm 不认 workspace 协议，未重写的包装上去会装不上）。
3. 两个 `package.json` 的 `version` 已递增。

npm 账号需已登录（`npm whoami`），且 `@lw0129a` 这个 scope 归你所有：

```bash
npm login
```

## 二、发布到 npm

先在本地用 tarball 验证一遍再打真包：

```bash
npm pack packages/app-packager --pack-destination /tmp/ap-pack
npm install -g --prefix /tmp/ap-prefix /tmp/ap-pack/lw0129a-app-packager-*.tgz
/tmp/ap-prefix/bin/app-packager doctor
```

确认无误后发布（两个包都要发，顺序无所谓，但 CLI 先发更符合直觉）：

```bash
pnpm --filter @lw0129a/app-packager publish --access public
pnpm --filter @lw0129a/dsh-app-packager publish --access public
```

> `publishConfig.access` 已在两个包里设为 `public`，`pnpm publish` 会带上。
> 若本地 npm 缓存目录权限有问题（`EPERM … _cacache`），可临时指定 `npm_config_cache=/tmp/ap-npmcache`。
> 发错了内容可以 `npm unpublish @lw0129a/app-packager@<version>`，但 24 小时后同名同版本不可复用，优先发新版本。

## 三、让插件出现在插件市场

Harness 的插件市场（dshmarket）**不接收插件条目 PR**，它读取的是精选清单 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：

- 市场打开时实时拉取 `https://awesome-dsh-plugin.com/plugins.json`（可用环境变量 `DSHM_REGISTRY_URL` 指向同结构的镜像）。
- 清单里的 `stars` / `downloads` / `capabilities` 由对方的 CI 每日自动刷新，提交时只需要人工字段。

所以上架顺序是：**先发 npm，再向 awesome-dsh-plugin 提一个 PR 增加一条 entry**，站点与市场通常在一天内自动收录。

提交前先确保 npm 包已可安装（对方 CI 会去 registry 校验 `npm` 字段与版本）：

```bash
npm view @lw0129a/dsh-app-packager version
```

PR 里附加的条目按现有条目的字段写（以 `dsh-local-ai` 为参照）：

```json
{
  "name": "dsh-app-packager",
  "owner": "lw0129a",
  "url": "https://github.com/lw0129a/app-packager",
  "category": "tools",
  "npm": "@lw0129a/dsh-app-packager",
  "version": "0.1.0",
  "description": {
    "en": "Build iOS/Android/HarmonyOS packages for uni-app x projects from DeepSeek Harness: list configured projects, check toolchains, run the packaging engine.",
    "zh": "在 DeepSeek Harness 里打包 uni-app x 项目（iOS/Android/HarmonyOS）：列出已配置项目、检查工具链、调用打包引擎出包。"
  }
}
```

字段说明（对照清单现有条目）：

| 字段 | 说明 |
| --- | --- |
| `name` | 清单内唯一名，通常与 npm 包名去掉 scope 后一致 |
| `owner` | GitHub 用户名 |
| `url` | 仓库地址，用于抓 stars |
| `category` | 取 `categories` 里的键；本插件宜用 `tools`（工具与能力），偏构建流程也可用 `dev` |
| `npm` | npm 包名（带 scope 要写全） |
| `version` | 上架时的版本，之后由 CI 跟随 registry 刷新 |
| `description.en` / `.zh` | 中英双语，市场按语言显示 |

`page` / `stars` / `downloads` / `install` / `added` / `capabilities` 等字段由对方 CI 生成，不必手写。清单的贡献规范在 awesome-dsh-plugin 仓库根目录的 `contributing.md`，提 PR 前先读一遍。

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
