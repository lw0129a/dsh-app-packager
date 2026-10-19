[English](../en/windows-ios-vm.md) | 简体中文

# Windows 上用 macOS 虚拟机打 iOS 包

Windows 上没有 Xcode，`xcodebuild` / `codesign` / `security` 也没有跨平台替代，所以 **iOS 包只能由 macOS 编译**。不想买第二台 Mac、也不想用云打包（排队 + 计次 + 证书上传）的话，本机装一台 macOS 虚拟机是最接近「全本地」的做法：虚拟机在你这台 Windows 里，走本地 SSH，不排队、不计次、不出网。

本文按三种起点写：

| 你的现状 | 从这里开始 |
| --- | --- |
| 没有任何虚拟机 | [第一部分：装 VMware](#第一部分装-vmware) |
| 有 VMware，但没装 macOS | [第二部分：装 macOS](#第二部分在-vmware-里装-macos) |
| 虚拟机里已经能开机进 macOS | [第三部分：打通打包链路](#第三部分打通打包链路) |

## 先看这一条：许可

Apple 的 macOS 许可协议只允许在 **Apple 品牌硬件**上虚拟化 macOS（[许可协议原文](https://www.apple.com/legal/sla/docs/macOSSequoia.pdf)）。在普通 PC 上跑 macOS 虚拟机技术上可行，但属于违约，风险自负。

如果你的用途是长期、团队化的发布流程，**买一台 Mac mini（或一台二手 Intel Mac mini）比折腾虚拟机省事得多**，链路和本文第三部分完全一样——把 `--remote` 指向那台机器即可。

## 硬件要求

- CPU：Intel VT-x 或 AMD-V；VMware Workstation 需要 Hyper-V 关闭（WSL2 / Docker Desktop 会打开它，见[常见坑](#常见坑)）
- 内存：物理机 ≥ 16 GB（分给虚拟机 8–12 GB）
- 磁盘：NVMe/SSD ≥ 120 GB 空闲（Xcode + iOS SDK + 构建缓存 60–80 GB）
- macOS 版本：Intel 镜像选 macOS Sonoma 14 或 Sequoia 15（Xcode 16 起要求 macOS 14.5+）
- Apple Silicon 镜像不能跑在 x86 主机的 VMware 上，别下载错

---

## 第一部分：装 VMware

VMware Workstation Pro 现在由 Broadcom 免费提供（个人使用），下载需要 Broadcom 账号：

1. 打开 [Broadcom 支持门户的 VMware Workstation Pro 下载页](https://support.broadcom.com/group/ecx/productdownloads?subfamily=VMware%20Workstation%20Pro)；
2. 注册/登录 Broadcom 账号（免费），在 *VMware Cloud Foundation* → *My Downloads* 里选 **VMware Workstation Pro for Personal Use**；
3. 下载 Windows 版安装包并安装。官方说明见 [Download and license VMware Desktop Hypervisor](https://knowledge.broadcom.com/external/article/368667/download-and-license-vmware-desktop-hype.html)，门户操作见 [Broadcom Support Portal 指南](https://knowledge.broadcom.com/external/article/397417/)；
4. 装完先别建虚拟机——VMware 默认的来宾系统列表里没有 macOS，需要第二步的解锁工具。

替代品：VirtualBox（免费，但 macOS 支持差、性能低）、UTM（仅适合 Apple Silicon 主机）。不推荐。

## 第二部分：在 VMware 里装 macOS

### 1. 拿到 macOS 安装介质（合法路径）

**有 Mac 可借用**（最稳）：在那台 Mac 上执行

```bash
softwareupdate --fetch-full-installer --full-installer-version 15.6
```

得到 `InstallAssistant.pkg`，安装后从 `/Applications` 取出安装器，再用 `hdiutil` 转成 ISO（VMware 需要 ISO 或已解锁的 dmg）。

**没有 Mac**：用 OpenCorePkg 自带的 `macrecovery.py` 直接从 Apple 服务器下载恢复镜像（不需要 Mac）：

```bash
# 需要 Python 3；board id / 机型参数见 OC4VM 文档，按你选的 macOS 版本取
python3 macrecovery.py -b Mac-4B682C642B45593E -m 00000000000000000 download
```

它会下载 `BaseSystem.dmg` 等文件，用于在线恢复安装。第三方网站打包的「黑苹果镜像」来源不可验证，不建议。

### 2. 解锁 VMware 的 macOS 支持

两种做法，选一个：

- [DrDonk/OC4VM](https://github.com/DrDonk/oc4vm)：生成 OpenCore 引导 ISO 和对应的 VMware 配置文件，发行版里带现成的 `.vmx`，**推荐**——它同时解决 SMBIOS/机型伪装，安装成功率更高；
- [paolo-projects/auto-unlocker](https://github.com/paolo-projects/auto-unlocker)：只解锁 VMware 的来宾系统限制，装完重启 VMware，新建虚拟机时就能选 macOS。

解锁后新建虚拟机：类型选 **Apple OS X / macOS**，CPU 4 核、内存 8–12 GB、磁盘 100 GB（SCSI，安装时格式化为 APFS），显卡显存 512 MB 以上。

### 3. 安装

挂载 ISO（或 OpenCore 引导 ISO）→ 进入安装器 → 用「磁盘工具」把虚拟磁盘格式化成 APFS → 安装。安装过程中不要求登录 Apple ID，本地打包也用不到，直接跳过。

装完建议装 VMware Tools（共享文件夹、剪贴板、显示分辨率都靠它）。

### 4. 自检

终端里能跑这几条就算 VM 本身没问题：

```bash
xcode-select --install        # 会弹安装命令行工具的窗口
sw_vers                       # 确认版本 ≥ 14.5
```

---

## 第三部分：打通打包链路

目标：Windows 上一条命令，虚拟机里编译，IPA 自动回到 Windows 的 `packages/iOS`。

### 1. 虚拟机里装齐工具链

```bash
# Xcode（App Store 或 developer.apple.com），装完首次运行一次授权
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch

# HBuilderX for macOS：https://www.dcloud.io/hbuilderx.html
# 引擎配置里指到它的 CLI：
#   HBUILDERX_CLI=/Applications/HBuilderX.app/Contents/MacOS/cli

# 引擎本体（AppPackager 的 bash 引擎，装在这台 macOS 上）
npx app-packager init --dir ~/AppPackager
```

项目源码要在这台机器上有一份：VMware 共享文件夹（把主机项目目录挂进来）或 `rsync` 同步都行。项目的 `SOURCE_DIR` 必须写成 **macOS 上的路径**。

### 2. 虚拟机里开 SSH

系统设置 → 通用 → 共享 → 打开「远程登录」；或命令行：

```bash
sudo systemsetup -setremotelogin on
```

在 Windows 主机上验证（Windows 10+ 自带 OpenSSH 客户端；Git Bash 里也自带 `ssh`）：

```powershell
ssh-keygen -t ed25519            # 没有密钥时才需要
ssh-copy-id user@192.168.1.20    # 把公钥装进虚拟机
ssh user@192.168.1.20 true       # 无密码返回即打通
```

用 VMware NAT 时也可以在「虚拟网络编辑器」里把主机的 2222 端口转发到虚拟机的 22，然后统一写 `user@127.0.0.1:2222`。

### 3. 从 Windows 触发打包

```powershell
# 先确认虚拟机能跑引擎的检查
ssh user@192.168.1.20 'bash ~/AppPackager/打包工具.command check ios'

# 打包：远程执行 + 把 packages/iOS 拉回本地
app-packager build ios my-project --remote user@192.168.1.20
```

可用参数：

| 参数 | 作用 |
| --- | --- |
| `--remote <user@host[:端口]>` | 在这台 macOS 上执行（`build` / `check` 都支持） |
| `--remote-key <路径>` | 指定私钥（不写就用 ssh-agent / 默认密钥） |
| `--remote-home <路径>` | 远程引擎目录，默认 `~/AppPackager` |
| `--no-pull` | 远程构建成功但不把产物拉回来 |

远程执行用的是 `ssh`，产物回传用的是 `scp`，两者都不需要额外安装；默认加了 `BatchMode=yes`，**不会**在后台挂住等密码——密钥没配好会立刻失败并报退出码。

### 4. 验收清单

1. `ssh vm true` 免密成功；
2. `ssh vm 'bash ~/AppPackager/打包工具.command check ios'` 全绿；
3. `app-packager build ios <项目> --remote vm` 结束时代码为 0；
4. 本地 `~/AppPackager/packages/iOS/` 出现新的 `.ipa`（或 `-latest.json`）。

四条都过，链路就通了。之后面板/CI 都可以复用同一条命令。

---

## 常见坑

- **VMware 起不来 / 报 Hyper-V 冲突**：WSL2、Docker Desktop、Windows 沙盒都会开 Hyper-V。要么关掉它们（`bcdedit /set hypervisorlaunchmode off` 后重启），要么换 VirtualBox。
- **时钟漂移**：虚拟机睡眠后时间跑偏，`xcodebuild` 会因为证书有效期报签名错误。装 VMware Tools 并让系统自动对时（`sudo sntp -sS time.apple.com`）。
- **磁盘不够**：Xcode 本体 ~15 GB，iOS SDK + 模拟器运行时再 30 GB+，构建缓存还会涨。100 GB 是下限。
- **首次 `xcodebuild` 卡在 license**：跑一次 `sudo xcodebuild -license accept`。
- **共享文件夹路径含空格或中文**：引擎会加引号，但 VMware 共享目录 + 构建工具链对非 ASCII 路径支持不稳，尽量放在 `/Users/共享/…` 之外。
- **Xcode 版本与 HBuilderX 不匹配**：iOS 离线 SDK 对 Xcode 版本有要求，HBuilderX 升级后同步升级 Xcode。
- **虚拟机窗口卡顿**：显卡驱动在虚拟机里普遍一般，命令行构建不受影响，别因为 UI 卡就以为构建卡。

## 替代方案

| 方案 | 成本 | 说明 |
| --- | --- | --- |
| Mac mini（M4 起步） | 一次性硬件 | 最省心，链路同第三部分，`--remote` 指向它 |
| 旧 MacBook / Intel Mac mini | 二手 | 能用就行，注意 macOS 版本 ≥ 14.5 |
| macOS 虚拟机（本文） | 0 元 | 单机 Windows 可行，但违反 Apple 许可、维护成本高 |
| DCloud 云打包 | 按次计费 | 不推荐：排队、计次、证书要上传 |

不管用哪种，Windows 侧的调用方式都一样：`app-packager build ios <项目> --remote <目标>`。
