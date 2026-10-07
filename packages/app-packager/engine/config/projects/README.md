# 项目配置

`AppPackager（打包工具）` 不内置任何 uni-app 项目，也不会把业务源码或本地路径提交到仓库。

运行时会读取：

```text
config/projects/*.env
```

新增项目：

推荐直接运行 `初始化.command`。初始化会自动扫描 AppPackager 同级目录，识别 `manifest.json + pages.json`（兼容 `src/`）并生成配置；主菜单启动时也会静默补扫描。

建议将 uni-app x 项目放在与 AppPackager 同级目录。项目位于其他目录时，可在初始化向导中输入绝对路径。

也可以手动配置：

1. 复制 `project.env.example` 为 `config/projects/<项目ID>.env`。
2. 修改 `SOURCE_DIR` 为本地 uni-app x 项目绝对路径。
3. 按需要修改 Bundle ID、Team ID、Profile 路径和平台开关。
4. 重新打开 `打包工具.command`，菜单会自动读取新项目。

如果 Android 需要正式 release 签名，可在项目中配置 `ANDROID_KEYSTORE_PROPERTIES`，或直接创建：

```text
certificates/Android/<项目ID>/release.keystore
certificates/Android/<项目ID>/keystore.properties
```

未配置 release keystore 时，Android 继续沿用业务项目自己的签名配置；当前项目通常为 debug keystore，产物会明确标记为测试签名。

`config/projects/*.env` 已加入 `.gitignore`，不会上传到 GitHub。

菜单顶部会显示每个已读取项目的名称、支持平台和源码地址。如果当前平台没有可打包项目，菜单会引导重新扫描同级目录或输入项目绝对路径。
