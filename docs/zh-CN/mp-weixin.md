[English](../en/mp-weixin.md) | 简体中文

# 打包并上传微信小程序

微信小程序和 iOS / Android / HarmonyOS 不一样：它没有安装包，产物是一个目录，上传到微信公众平台才算「发出去」。所以 AppPackager 把它做成一条命令：**编译 + 上传一次完成**。

```bash
app-packager build mp-weixin <项目ID>            # 编译并上传
app-packager build mp-weixin <项目ID> --no-upload # 只编译，归档目录
app-packager check mp-weixin <项目ID>             # 打包前环境检查
```

不需要微信开发者工具，也不需要扫码：上传走的是「微信小程序代码上传密钥」（CI 机器人），HBuilderX 一条 `publish` 命令就能编译加上传。

## 前置准备

| 需要什么 | 怎么弄 |
| --- | --- |
| HBuilderX ≥ 4.41 | uni-app x 从 4.41 起才支持发行微信小程序；`app-packager doctor mp-weixin` 会读版本 |
| uni-app x 项目 | 经典 uni-app（vue2/3）项目不在支持范围，和 iOS / HarmonyOS 的本地打包路线一致 |
| 小程序 AppID | 写在项目 `manifest.json` 的 `mp-weixin.appid`；也可以用 `MP_WEIXIN_APPID` 或项目 env 覆盖 |
| 代码上传密钥 | [mp.weixin.qq.com](https://mp.weixin.qq.com) → 开发 → 开发管理 → 开发设置 → 小程序代码上传 → 生成并下载密钥，放到 `certificates/WeChatMP/xxx.key` |
| IP 白名单 | 同一页面的 IP 白名单里加上本机出口 IP，否则上传报 `200002` |
| 开发者权限 | 生成密钥的微信号需要是该小程序的开发者，并且有「开发管理」权限 |

密钥目录默认 `certificates/WeChatMP/`，也可以设 `MP_WEIXIN_CERT_DIR` / `MP_WEIXIN_PRIVATE_KEY` 指到别处。密钥等同于密码，别提交进仓库（引擎的 `guard:check` 会拦业务配置与密钥）。

## 常用参数

| 参数 / 配置 | 作用 |
| --- | --- |
| `--version 1.2.3` | 覆盖上传的版本号，默认取 `manifest.json` 的 `versionName` |
| `--no-upload` | 只编译，不传微信公众平台 |
| `MP_WEIXIN_DESCRIPTION` | 上传时的版本描述，默认写构建时间 |
| `MP_WEIXIN_ROBOT` | 机器人编号（1–30），多台机器并行上传时各用一个号 |
| `MP_WEIXIN_UPLOAD=false` | 等同于每次 `--no-upload` |
| `MP_WEIXIN_TIMEOUT` | HBuilderX publish 的超时秒数，默认 1800 |
| `--mp-weixin-upload true\|false` | 显式覆盖「构建后是否上传」，优先于 `settings.env` / 项目 env；排在 `--no-upload` 之后生效。面板的「构建后上传微信公众平台」勾选就映射到它 |

## 产物在哪

```
packages/MPWeixin/<项目ID>-<AppID>-<版本>-<时间戳>/mp-weixin/   # 小程序目录（不压缩）
packages/MPWeixin/<项目ID>-<AppID>-<版本>-<时间戳>/build-info.json
packages/MPWeixin/<项目ID>-latest/                              # 指向最近一次的软链
```

插件面板里，勾选平台 `微信小程序` 后打包卡片会多出「构建后上传微信公众平台」复选（默认勾上）；产物会出现在产物列表，“上传”状态直接读 `build-info.json` 的 `uploaded` 字段，因为小程序是目录，不提供「下载」按钮——要拿文件直接打开上面的目录。

目录不打包成 zip：小程序上传要的就是目录本身，压缩只会多一步解压。`build-info.json` 记了版本、AppID、是否上传、编译目录，`upload` 之外的自动化可以直接读它。

## 为什么不在 `all` 里

`all` 的语义是「所有能产出安装包的平台」，微信小程序不产出安装包、上传又内联在构建里，混进去会打乱别人 `build all` 的习惯。要打小程序就显式点名：命令行 `build mp-weixin`、菜单第 17 项、面板平台勾选里的「微信小程序」。

## 常见报错

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `200002` / `invalid ip` | 出口 IP 不在白名单 | 公众平台加 IP 白名单后重试 |
| `invalid appid` / 密钥不匹配 | AppID 与密钥不是同一个小程序 | 确认 `mp-weixin.appid` 与密钥来源一致 |
| HBuilderX 版本过低 | < 4.41 | 升级 HBuilderX |
| `publish` 卡住或提示未登录 | HBuilderX CLI 服务没起或没登录 | 打开一次 HBuilderX，登录 DCloud 账号后重试；`check mp-weixin` 会先探这条 |
| 找不到 `unpackage/dist/build/mp-weixin` | 编译失败但没退出非零 | 看 `logs/` 里该次构建日志，HBuilderX 的真实报错在最后 100 行 |
