[English](../en/mp-weixin.md) | [简体中文](../zh-CN/mp-weixin.md)

# Package and upload a WeChat mini program

A WeChat mini program is not an installer: the build output is a directory, and it only "ships" once it is uploaded to the WeChat MP platform. AppPackager therefore makes it one command: **compile and upload in a single run**.

```bash
app-packager build mp-weixin <project-id>            # compile and upload
app-packager build mp-weixin <project-id> --no-upload # compile only, archive the directory
app-packager check mp-weixin <project-id>             # pre-flight check
```

No WeChat DevTools and no QR scan: upload uses a **mini program code upload key** (the CI robot), and HBuilderX's `publish` command compiles and uploads in one step.

## Prerequisites

| What you need | How to get it |
| --- | --- |
| HBuilderX ≥ 4.41 | uni-app x only supports mini program publishing from 4.41; `app-packager doctor mp-weixin` reads the version |
| A uni-app x project | Classic uni-app (vue2/3) projects are out of scope, same as the iOS / HarmonyOS local routes |
| The mini program AppID | `mp-weixin.appid` in the project's `manifest.json`; `MP_WEIXIN_APPID` or the project env can override it |
| A code upload key | [mp.weixin.qq.com](https://mp.weixin.qq.com) → 开发 → 开发管理 → 开发设置 → 小程序代码上传 → generate and download, then put it in `certificates/WeChatMP/xxx.key` |
| IP allowlist | Add this machine's egress IP on the same page, otherwise upload fails with `200002` |
| Developer permission | The WeChat account that generates the key must be a developer of that mini program with 开发管理 access |

The key directory defaults to `certificates/WeChatMP/`; set `MP_WEIXIN_CERT_DIR` / `MP_WEIXIN_PRIVATE_KEY` to point elsewhere. The key is a password — never commit it (`guard:check` rejects business config and keys).

## Common options

| Option / setting | Effect |
| --- | --- |
| `--version 1.2.3` | Overrides the uploaded version; defaults to `versionName` from `manifest.json` |
| `--no-upload` | Compile only, do not upload |
| `MP_WEIXIN_DESCRIPTION` | Upload description; defaults to the build time |
| `MP_WEIXIN_ROBOT` | Robot number (1–30) when several machines upload in parallel |
| `MP_WEIXIN_UPLOAD=false` | Same as `--no-upload` every time |
| `MP_WEIXIN_TIMEOUT` | HBuilderX publish timeout in seconds, default 1800 |
| `--mp-weixin-upload true\|false` | Explicitly overrides "upload after build"; wins over `settings.env` / the project env and is applied after `--no-upload`. The panel's "Upload to WeChat after build" checkbox maps to it |

## Where the output goes

```
packages/MPWeixin/<project-id>-<appid>-<version>-<timestamp>/mp-weixin/   # the mini program directory (not zipped)
packages/MPWeixin/<project-id>-<appid>-<version>-<timestamp>/build-info.json
packages/MPWeixin/<project-id>-latest/                                    # symlink to the newest build
```

In the plugin panel, ticking the `WeChat mini program` platform adds an "Upload to WeChat after build" checkbox to the build card (on by default). The build then shows up in the artifact list; its status comes from `uploaded` in `build-info.json`. Because the output is a directory there is no Download button — open the folder above instead.

The directory is not zipped: the upload wants the directory itself and compression only adds an unzip step. `build-info.json` records the version, AppID, whether it was uploaded, and the compile directory, so automation can read it directly.

## Why it is not part of `all`

`all` means "every platform that produces an installer". A mini program produces no installer and uploads inline with the build, so folding it in would break people's `build all` habits. Name it explicitly: `build mp-weixin` on the CLI, menu item 17, or the "WeChat mini program" platform checkbox in the panel.

## Troubleshooting

| Error | Cause | Fix |
| --- | --- | --- |
| `200002` / `invalid ip` | Egress IP is not allowlisted | Add it on the MP platform and retry |
| `invalid appid` / key mismatch | AppID and key belong to different mini programs | Make `mp-weixin.appid` match the key's source |
| HBuilderX too old | < 4.41 | Upgrade HBuilderX |
| `publish` hangs or asks to log in | HBuilderX CLI service is down or logged out | Open HBuilderX once, log in to DCloud, retry; `check mp-weixin` probes this |
| `unpackage/dist/build/mp-weixin` missing | Compilation failed without a non-zero exit | Read that run's log under `logs/`; HBuilderX's real error is in the last 100 lines |
