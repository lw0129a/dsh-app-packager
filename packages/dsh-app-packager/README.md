# @lw0129a/dsh-app-packager

DeepSeek Harness 的 [AppPackager](https://github.com/lw0129a/app-packager) 插件：让 Harness 里可以直接列出项目、体检环境、检查打包条件、执行打包（iOS IPA / Android APK / HarmonyOS HAP）。

宿主侧插件（host-only），没有 Web UI；装上后会注册四个工具。

## 安装

在 Harness 插件市场搜索 **AppPackager** 安装，或者：

```bash
dsh plugin --profile desktop add @lw0129a/dsh-app-packager
```

装好后重启该 profile 生效。插件依赖 `@lw0129a/app-packager`（CLI + 打包引擎），会一并装上，无需单独安装。

## 工具

### `app_packager_list`

列出引擎目录里已配置的项目（读 `config/projects/*.env`），返回项目 ID、应用名、源码目录是否存在、启用的平台。

```
AppPackager 引擎目录：/Users/me/AppPackager
引擎版本：0.1.0
项目（1）:
- shop（商城）
  平台: iOS (IPA), Android (APK)
  源码: /Users/me/work/shop
```

纯 Node 实现，Windows 上也能用。第一次调用会把引擎物化到引擎目录。

### `app_packager_doctor`

体检这台机器能不能打包：Node 版本、bash 桥接（macOS/Linux 的 bash，Windows 的 Git Bash / WSL）、Xcode / 证书工具、HBuilderX CLI、JDK、Android SDK、DevEco Studio、HarmonyOS 签名目录、项目配置是否齐全。

参数 `platform`：`ios` / `android` / `harmony` / `all`（默认 `all`）。同样是纯 Node 实现。

### `app_packager_check`

调用引擎做某平台的打包前检查（证书、SDK 目录、HBuilderX CLI 等），返回引擎输出尾部与判定结果（`[FAIL]` 或非零退出码即判定失败）。

参数：`platform`（默认 `all`）、`project`（项目 ID，省略则全部）、`home`。

### `app_packager_build`

执行打包，耗时以分钟计（iOS 尤其），默认超时 90 分钟。

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

拿不准就先 `app_packager_check`，确认环境齐了再 `app_packager_build`。

## 配置

插件的配置项由 bundle patch 提供，可在自己的 profile `cordis.patch.yml` 里按 `id: app-packager` 重新插入覆盖：

```yaml
- insert:
    - id: app-packager
      name: '@lw0129a/dsh-app-packager'
      config:
        home: ''                 # 引擎目录；留空用 ~/AppPackager 或 APP_PACKAGER_HOME
        searchRoots: []          # 额外项目扫描目录（在引擎目录的父目录之外）
        checkTimeoutMs: 600000   # check 超时（毫秒）
        buildTimeoutMs: 5400000  # build 超时（毫秒）
        outputLimit: 12000       # 工具结果里保留的引擎输出字符数（取尾部）
```

也可在 Harness 的 **设置 → 插件 → 插件配置** 里改。

## 引擎目录与首次使用

默认引擎目录是 `~/AppPackager`（可用配置项或环境变量 `APP_PACKAGER_HOME` 覆盖）。第一次调用工具时，插件会把包内的打包引擎释放到那里；之后升级插件会更新引擎文件，但不会覆盖你本地的配置、证书、SDK 与产物。

想走交互式初始化向导（登记同级目录下的 uni-app x 项目、选择平台、配置签名），用 CLI 跑：

```bash
npx @lw0129a/app-packager init
```

## 平台

`list` / `doctor` 在任何平台都可用。`check` / `build` 需要 bash：macOS/Linux 自带，Windows 需 Git for Windows（推荐）或 WSL。iOS 打包只能在 macOS 上做 —— 非 macOS 时 `doctor` 会直接把 iOS 标为失败。

## 许可

MIT
