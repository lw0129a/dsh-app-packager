[English](README.md) | 简体中文

# dsh-app-packager

DeepSeek Harness 的 [AppPackager](https://github.com/lw0129a/dsh-app-packager) 插件：不用离开 Harness 会话就能列出 uni-app x 项目、体检本机环境、打出 iOS IPA / Android APK / HarmonyOS HAP —— 既能给 agent 用（四个工具），也能在 Web GUI 的面板里点。

## 安装

在 Harness 插件市场搜索 **AppPackager** 安装，或者：

```bash
dsh plugin --profile desktop add dsh-app-packager
```

装好后重启该 profile 生效。插件依赖 `app-packager`（CLI + 打包引擎），会一并装上。

## Web GUI 面板

插件带浏览器侧代码（`./client.js`），因此 Web GUI 的侧栏面板列表里会多一个 **应用打包** 入口，页面开在中栏：

- **引擎** —— 引擎目录、引擎版本、是否已物化，以及探测到的 bash 桥接（macOS/Linux 的 `bash`、Windows 的 Git Bash 或 WSL）；缺引擎时点「初始化引擎」一键释放。
- **环境检查（Node）** —— 与 `app_packager_doctor` 同一份报告，可只查某个平台或全部，每个失败项都带修复提示。
- **项目** —— 列出 `config/projects/*.env`：源码目录（不存在会标注）、启用的平台，每个项目一组「环境检查 / 打包」按钮，每行自己一个折叠箭头（「删除」始终留在头行上）。输入框填的是「项目总文件夹」——放项目的那一层（例如 `/Users/lw/work/anjuyi`），「选择目录…」打开系统自带的目录对话框，「添加项目」把选中的目录交给引擎的 `register` 子命令登记，因此磁盘上任意位置的项目都会得到与向导完全一致的 `config/projects/<id>.env`；引擎会自动往下扫一层，把里面的 uni-app x 项目一次性全部登记（选中的是项目本身也能用，多个目录用逗号或换行分隔）。
- **打包范围** —— 批量入口：平台多选（勾「全部」即三平台）与项目多选（一个都不勾 = 该平台下全部已启用项目），一组「环境检查 / 打包」按钮。引擎一次只接受一个平台和一个项目，所以一组选择会被拆成多次引擎调用在一个任务里串行执行，日志用 `▶ i/n` 标出每次调用；只有每次都成功才算成功，退出码取第一个失败的。
- **公共打包选项** —— 版本号；**上传**列出引擎 `config/upload.env` 声明且真正可用的上传平台（`ENABLED=true` 且脚本与函数都在，本机默认是蒲公英），不可用的会灰掉并写出原因（未启用 / 引擎里还没有实现），勾选的平台拼成一个逗号分隔的 `--upload`；*HarmonyOS debug 包* 与 *保留构建目录* 收在「高级选项」里，各带一行说明。
- **SDK** —— 读出本机 HBuilderX 与其版本系列，逐平台列出 SDK 目录与状态（`ready` / `mismatch` / `missing`）。「一键配置」让引擎按勾选的平台下载并解压对应 SDK，「处理已下载的 SDK」导入已经放在 `sdk/` 里的压缩包；每行还给 DCloud 官方下载页，iOS 另给只能由版本系列推出来的官方直链。
- **升级插件** —— 把 `dsh-app-packager@latest` 装回当前 profile。升级期间引擎目录先改名让开，因此升级不会删掉你已下载的 SDK、证书与已登记项目；插件不是跑在 profile 的 `node_modules` 里时，这个按钮不显示。升级成功后任务卡片会提示刷新页面（⌘R）——浏览器侧那半边要等一次页面加载才回来——并给一个「刷新页面」按钮。
- **任务** —— 当前 check/build 的实时引擎日志、判定结果（出现 `[FAIL]` 或非零退出码即失败）与「停止」按钮。引擎输出里的 `[FAIL] …` / `[WARN] …` 行还会被单独提到日志上方的框里并给出总计，缺 Profile、缺 p12、SDK 不完整这类问题不用翻日志就能看到。任务活在宿主进程里、不在浏览器标签里：切到别的 DeepSeek Harness 标签（或刷新面板）会从 `GET state` 重新认领最新那条，所以还在跑的构建会带着日志、判定与「停止」按钮一起回来，跑完的那条也会一直留在界面上，直到你起下一个构建或点「清除」（只清除已结束的 —— 运行中的绝不动，否则就没法停它了）。

面板只调用本插件注册的同源路由（`/api/app-packager/state|init|doctor|pick|project|job|job/log|job/kill|job/clear`），打包逻辑不在浏览器里跑。它需要带 Web 应用的 profile（`@deepseek-ai/dsh-web-app`，desktop 与 web profile 都带）；headless profile 里面板不出现，四个工具照常可用。

## 工具

### `app_packager_list`

列出引擎目录里配置的项目（`config/projects/*.env`）：项目 ID、应用名、源码目录是否存在、启用的平台。

```
AppPackager 引擎目录：<插件目录>/home
引擎版本：0.6.2
项目（1）:
- shop（商城）
  平台: iOS (IPA), Android (APK)
  源码: /Users/me/work/shop
```

纯 Node 实现，Windows 上也能用。第一次调用会把引擎物化到引擎目录。

### `app_packager_doctor`

体检这台机器能不能打包：Node 版本、bash 桥接、Xcode / 证书工具、HBuilderX CLI、JDK、Android SDK、DevEco Studio、HarmonyOS 签名目录、项目配置。参数 `platform`：`ios` / `android` / `harmony` / `all`（默认 `all`）。同样是纯 Node 实现。

### `app_packager_check`

调用引擎的 `check` 子命令做某平台的打包前检查（证书、SDK 目录、HBuilderX CLI 等），返回引擎输出尾部与判定结果。参数：`platform`（默认 `all`）、`project`（项目 ID，省略则全部）、`home`。

### `app_packager_build`

执行真实打包，耗时以分钟计（iOS 尤其），超时 90 分钟。

| 参数 | 说明 |
| --- | --- |
| `platform` | 必填，`ios` / `android` / `harmony` / `all` |
| `project` | 项目 ID；`platform=all` 时可省略，表示全部项目 |
| `upload` | 打包后上传，例如 `pgyer` |
| `noUpload` | 跳过上传 |
| `version` | 覆盖产物版本号 |
| `harmonyDebug` | HarmonyOS 输出 debug 侧载包 |
| `keepWork` | 保留中间构建目录 |
| `home` | 引擎目录（一般不用传，见下） |

拿不准就先 `app_packager_check`。

## 配置

插件的配置项由 bundle patch 提供，可在自己的 profile `cordis.patch.yml` 里按 `id: app-packager` 重新插入覆盖：

```yaml
- insert:
    - id: app-packager
      name: 'dsh-app-packager'
      config:
        home: ''                 # 引擎目录；留空用 <插件目录>/home 或 APP_PACKAGER_HOME
        searchRoots: []          # 额外项目扫描目录（在引擎目录的父目录之外）
        checkTimeoutMs: 600000   # check 超时（毫秒）
        buildTimeoutMs: 5400000  # build 超时（毫秒）
        outputLimit: 12000       # 工具结果里保留的引擎输出字符数（取尾部）
```

也可在 Harness 的 **设置 → 插件 → 插件配置** 里改。

## 引擎目录与首次使用

引擎目录就在插件目录里（`<插件目录>/home`），跟着插件走；可用配置项或环境变量 `APP_PACKAGER_HOME` 指到别处。老版本留在 `~/AppPackager` 的引擎目录会在第一次解析时被改名搬进来 —— 是改名而不是复制，所以几 GB 的 SDK 与已登记项目瞬间就位。

第一次调用工具（或点面板的「初始化引擎」）时，插件会把包内的打包引擎释放到那里；之后升级插件会更新引擎文件（目录里 `.engine-version` 与包版本不一致时，下次调用工具或点面板按钮会就地刷新；刷新前面板在这一行会写「目录里是 X，需要刷新」），但不会覆盖你本地的配置、证书、SDK 与产物。面板里的「升级插件」更进一步，会重装 npm 包，并在整个安装期间把引擎目录暂存到一边。

> **别绕开面板去重装这个包。** `<插件目录>/home` 就在包的目录里，任何真正重装它的 pnpm 命令（`pnpm install --force`、换版本、改 `file:` 指向）都会连引擎目录一起删掉——SDK、证书、已登记项目都在里面。要换版本就用面板的「升级插件」，或 `node <插件目录>/upgrade.mjs`：它们会先把引擎目录暂存到一边，而且 registry 上不比本机新时会直接拒绝、不把你换回旧版。

> **侧栏入口消失时怎么查。** 宿主只在启动时组装一次插件清单，插件包目录缺失时它会跳过这个插件、不报错。按顺序看：① `ls <插件目录>`（即 `<profile>/node_modules/dsh-app-packager`）还在不在；② 不在就看 `<profile>/.plugin-manager/logs/*/pnpm.log`——安装失败会留下 `Command failed with exit code 1`，而 pnpm 装之前会先删旧包目录，`home` 里面的 SDK、证书与项目一起没了；③ 用插件市场或 `dsh plugin --profile <profile> add dsh-app-packager` 装回来，然后**重启 DSH**——清单只在启动时组装。

想走交互式初始化向导（登记同级目录下的 uni-app x 项目、选择平台、配置签名），用 CLI 跑：

```bash
npx app-packager init
npx app-packager register ~/work/shop   # 也可以直接登记某个目录
```

## 平台

`list` / `doctor` 在任何平台都可用。`check` / `build` 需要 bash：macOS/Linux 自带，Windows 需 Git for Windows（推荐）或 WSL。iOS 打包只能在 macOS 上做 —— 非 macOS 时 `doctor` 会直接把 iOS 标为失败。

## 许可

MIT
