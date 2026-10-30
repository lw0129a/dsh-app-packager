# AppPackager 签名目录

本目录用于保存本机 iOS 打包签名材料。

建议结构：

```text
signing/
├── apple/                 # Apple CA 证书，可选
└── current/
    ├── cert.p12
    └── <项目ID>.mobileprovision
```

`signing/current/`、`*.p12` 和 `*.mobileprovision` 已被 `.gitignore` 忽略，不应提交到 GitHub。

更新签名文件：

```bash
./setup-signing.sh   --p12 <证书.p12>   --profile <项目ID>=<项目.mobileprovision>
```
