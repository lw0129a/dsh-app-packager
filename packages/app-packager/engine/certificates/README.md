# 证书目录

证书目录使用平铺结构。证书导入器会递归扫描任意来源目录，解析证书内容后放入以下平台目录：

```text
certificates/
├── 处理证书.command
├── README.md
├── iOS/
│   ├── <BundleID>.mobileprovision
│   └── ios-signing.p12
├── Android/
│   ├── release.keystore
│   └── keystore.properties
├── HarmonyOS/
│   ├── <BundleName>.release.p7b
│   ├── <BundleName>.debug.p7b
│   ├── release.p12
│   ├── release.cer
│   ├── dev.cer
│   └── material/
```

导入任意来源目录：

```bash
./处理证书.command "/absolute/path/to/cert-dir"
```

处理过程只复制；来源位于 `certificates/` 下时，导入成功后清理来源目录。证书目录最终只保留 `iOS/`、`Android/`、`HarmonyOS/`、`README.md` 和 `处理证书.command`。再次执行同一个命令即为更新操作：

- 内容相同：判定为未变化，不生成重复文件，来源保留。
- 内容不同：旧文件自动移动到 `logs/certificate-history/<时间>/<平台>/`，新文件替换当前平铺文件。
- Profile 更新和 p12/keystore 更新可以分别执行，未提供的文件会保留。
- 未知来源目录名称不会进入目标路径，目标文件名由 Bundle ID、Bundle Name、证书类型和 keystore 固定角色决定。

处理方式：

1. 双击 `处理证书.command`，或在打包工具主菜单选择“更新/处理证书”。
2. 也可以把来源目录拖到命令后面。
3. 初始化向导同样支持导入证书：`初始化.command "/来源目录"`，或初始化交互中输入来源目录。
4. 工具会递归识别、校验并平铺归位证书。
5. 缺失或不完整时会提示需要补齐的文件。

## iOS 证书创建

1. 登录 Apple Developer / Certificates, Identifiers & Profiles。
2. 创建 App ID，并配置对应 Bundle ID。
3. 创建 Apple Development 或 Apple Distribution 证书。
4. 根据测试方式创建 Development、Ad Hoc 或 App Store Profile。
5. 在 macOS Keychain Access 中将证书和私钥导出为 `.p12`。
6. 将 `.p12` 和 `.mobileprovision` 放入 `certificates/iOS/`。
7. 运行 `setup-signing.sh`，将 p12 密码保存到 Keychain。

UniApp 官方证书文档：

- https://ask.dcloud.net.cn/article/152

Apple Developer：

- https://developer.apple.com/account/resources/certificates/list
- https://developer.apple.com/account/resources/profiles/list

## Android 证书创建

使用 `keytool` 创建 release keystore：

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

然后准备 `keystore.properties`：

```properties
storeFile=release.keystore
storePassword=...
keyAlias=release
keyPassword=...
```

导入器会平铺为：

```text
certificates/Android/release.keystore
certificates/Android/keystore.properties
```

如果存在多个 Android 项目且需要使用不同的 keystore，可在项目中通过 `ANDROID_KEYSTORE_PROPERTIES` 指定独立路径；默认平铺位置作为共享 release keystore。

未配置 release keystore 时，Android 会沿用业务项目自己的签名配置；如果该配置仍是 `debug.keystore`，构建结果会明确标记为测试签名。

UniApp 官方证书文档：

- https://ask.dcloud.net.cn/article/35777

Android 官方文档：

- https://developer.android.com/studio/publish/app-signing

## HarmonyOS 证书创建

1. 在 DevEco Studio 中登录华为开发者账号。
2. 创建/导入应用签名配置。
3. 生成或获取 `.p12` 密钥库。
4. 获取 `.cer` 数字证书。
5. 获取 `.p7b` Profile 文件。
6. HarmonyOS 签名完全以业务项目 `manifest.json` 的 `app-harmony.distribute.signingConfigs` 为准。

平台证书目录只作为同名文件来源。AppPackager 会原样补齐配置引用的 `storeFile`、`certpath`、`profile` 和同目录 `material/`，不修改证书文件内容，不派生新的证书链，也不自行二次签名。`material/` 用于解密 manifest 中的加密密码，必须与证书材料一起保留。

UniApp 官方证书文档：

- https://doc.dcloud.net.cn/uni-app-x/tutorial/runbuild.html#signing-configs

华为官方入口：

- https://developer.huawei.com/consumer/cn/deveco-studio/

## p12 区分规则

iOS 和 HarmonyOS 都可能使用 `.p12`，必须明确区分：

- iOS p12 放到 `certificates/iOS/`
- HarmonyOS p12 放到 `certificates/HarmonyOS/`
- 不要把 p12 直接放在 `certificates/` 根目录，除非文件名能明确包含 `ios`、`apple`、`harmony` 或 `ohos`
- 无法判断平台时，处理脚本会放入“异常”，不会自动猜测

## 注意

- 证书文件不会提交到 Git。
- `.p12`、`.keystore`、`.jks`、`.cer`、`.p7b` 等敏感文件不要上传公开仓库。
