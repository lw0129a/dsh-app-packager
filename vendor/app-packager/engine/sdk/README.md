# SDK 目录

把从 DCloud/uniapp 官网下载的 SDK 压缩包或已经解压的原始目录直接放在本目录，可以保留云盘下载下来的子目录，工具会递归扫描：

```text
sdk/
├── 处理SDK.command
├── README.md
├── <下载的压缩包或解压目录>
├── iOS/<版本>/
├── Android/<版本>/
└── HarmonyOS/<版本>/
```

处理方式：

1. 双击 `sdk/处理SDK.command`
2. 或在打包工具主菜单选择 `14. 更新/处理 SDK`
3. 工具会自动识别根目录中的 `.zip`、`.tar.gz`、`.tgz`、`.har` 或解压目录
4. 识别成功后自动归位到 `iOS/`、`Android/`、`HarmonyOS/`
5. 已处理的原始文件移动到 `_processed/`，避免重复处理
6. 默认保留根目录原始包和 `_processed/` 备份；如需自动清理，可在 `config/settings.env` 设置 `KEEP_SDK_ARCHIVES="false"`

如果文件仍带有 `.downloading` 或 `.baiduyun.p.downloading` 后缀，说明下载未完成，工具会明确提示，不会误处理。

如果只检测到部分平台 SDK，会明确提示缺失的 iOS、Android 或 HarmonyOS SDK。

官方 SDK 地址：

- iOS: https://doc.dcloud.net.cn/uni-app-x/native/download/ios.html
- iOS 5.26 直链: https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%405.26.zip
- Android: https://doc.dcloud.net.cn/uni-app-x/native/download/android.html
- HarmonyOS: https://doc.dcloud.net.cn/uni-app-x/native/use/harmony.html



兼容说明：

- 旧版 iOS `HBuilder-Hello` 离线 SDK 可以被识别并归位。
- 当前 AppPackager 分包流程需要 `UniAppX-iOS@<版本>`，包内包含 `UniAppXDemo/UniAppXDemo.xcodeproj`。
- 如果检测到旧版结构，菜单会显示警告，避免构建阶段才失败。

处理脚本在 SDK 缺失或文件无法识别时，会直接输出对应平台的官方页面、官方直链或 ohpm 包名。

每次处理结束会输出四类结果：

- 成功
- 异常
- 失败
- 无法读取
