[English](windows-ios-vm.md) | [简体中文](../zh-CN/windows-ios-vm.md)

# Building iOS from Windows with a macOS virtual machine

Windows has no Xcode, and nothing replaces `xcodebuild` / `codesign` / `security` on that platform, so **an iOS build always happens on macOS**. If buying a second Mac or using cloud packaging (queues, per-build fees, uploading certificates) both sound bad, a local macOS VM is the closest thing to "fully local": it runs inside your Windows box, you talk to it over local SSH, there is no queue, no per-build charge, and nothing leaves your network.

This page covers three starting points:

| You have | Start at |
| --- | --- |
| No VM at all | [Part 1: install VMware](#part-1-install-vmware) |
| VMware, no macOS yet | [Part 2: install macOS](#part-2-install-macos-in-vmware) |
| A booting macOS VM | [Part 3: wire up the build path](#part-3-wire-up-the-build-path) |

## Read this first: the license

Apple's macOS license only permits virtualizing macOS on **Apple-branded hardware** ([license text](https://www.apple.com/legal/sla/docs/macOSSequoia.pdf)). Running a macOS VM on a regular PC works technically but violates that license — your call, your risk.

For anything long-lived or team-wide, **a Mac mini (new or used Intel) is far less trouble than a VM**, and the wiring is identical to Part 3: point `--remote` at that machine.

## Hardware

- CPU: Intel VT-x or AMD-V; VMware Workstation needs Hyper-V disabled (WSL2 / Docker Desktop turn it on — see [Pitfalls](#pitfalls))
- RAM: host ≥ 16 GB (give the VM 8–12 GB)
- Disk: NVMe/SSD, ≥ 120 GB free (Xcode + iOS SDK + build cache is 60–80 GB)
- macOS version: Intel images — Sonoma 14 or Sequoia 15 (Xcode 16 needs macOS 14.5+)
- Apple Silicon images do not boot on an x86 host VM, don't download the wrong one

---

## Part 1: install VMware

VMware Workstation Pro is now free for personal use from Broadcom, and the download needs a Broadcom account:

1. Open the [VMware Workstation Pro download page on the Broadcom support portal](https://support.broadcom.com/group/ecx/productdownloads?subfamily=VMware%20Workstation%20Pro).
2. Register / sign in (free), then pick **VMware Workstation Pro for Personal Use** under *VMware Cloud Foundation* → *My Downloads*.
3. Download the Windows installer and install it. Official notes: [Download and license VMware Desktop Hypervisor](https://knowledge.broadcom.com/external/article/368667/download-and-license-vmware-desktop-hype.html); portal walkthrough: [Broadcom Support Portal](https://knowledge.broadcom.com/external/article/397417/).
4. Don't create a VM yet — VMware's guest list has no macOS until you unlock it (Part 2).

Alternatives: VirtualBox (free, poor macOS support and performance), UTM (Apple Silicon hosts only). Not recommended.

## Part 2: install macOS in VMware

### 1. Get a macOS installer (legitimate route)

**With a Mac to borrow** (most reliable): on that Mac run

```bash
softwareupdate --fetch-full-installer --full-installer-version 15.6
```

That leaves an `InstallAssistant.pkg`; install it, take the installer from `/Applications`, and convert to an ISO with `hdiutil` (VMware wants an ISO or an unlocked dmg).

**Without a Mac**: use `macrecovery.py` from OpenCorePkg to download the recovery image straight from Apple's servers:

```bash
# Python 3 required; board id / model arguments are listed in the OC4VM docs for your macOS version
python3 macrecovery.py -b Mac-4B682C642B45593E -m 00000000000000000 download
```

It fetches `BaseSystem.dmg` and friends for an online recovery install. Prebuilt "hackintosh images" from third-party sites cannot be verified — avoid them.

### 2. Unlock macOS in VMware

Two options, pick one:

- [DrDonk/OC4VM](https://github.com/DrDonk/oc4vm): generates the OpenCore boot ISO plus a ready `.vmx`, solving SMBIOS spoofing too. **Recommended** — highest install success rate.
- [paolo-projects/auto-unlocker](https://github.com/paolo-projects/auto-unlocker): only removes VMware's guest restriction; restart VMware and macOS appears in the new-VM wizard.

Then create the VM: type **Apple OS X / macOS**, 4 vCPUs, 8–12 GB RAM, 100 GB disk (SCSI, formatted APFS during setup), 512 MB+ video memory.

### 3. Install

Mount the ISO (or the OpenCore boot ISO) → boot the installer → format the virtual disk as APFS in Disk Utility → install. No Apple ID is needed during setup, and none is needed for local builds — skip it.

Install VMware Tools afterwards (shared folders, clipboard, display resolution).

### 4. Sanity check

A working VM answers these from Terminal:

```bash
xcode-select --install        # installs the command line tools
sw_vers                       # confirm ≥ 14.5
```

---

## Part 3: wire up the build path

Goal: one command on Windows, the build runs in the VM, the IPA lands in Windows' `packages/iOS` automatically.

### 1. Toolchain inside the VM

```bash
# Xcode (App Store or developer.apple.com), then accept the license once
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch

# HBuilderX for macOS: https://www.dcloud.io/hbuilderx.html
# Point the engine config at its CLI:
#   HBUILDERX_CLI=/Applications/HBuilderX.app/Contents/MacOS/cli

# The AppPackager bash engine, installed on this macOS
npx app-packager init --dir ~/AppPackager
```

The project source needs to exist on this machine: a VMware shared folder or an `rsync` copy both work. The project's `SOURCE_DIR` must be the **macOS path**.

### 2. Enable SSH in the VM

System Settings → General → Sharing → turn on *Remote Login*, or from the shell:

```bash
sudo systemsetup -setremotelogin on
```

Verify from the Windows host (Windows 10+ ships an OpenSSH client; Git Bash has `ssh` too):

```powershell
ssh-keygen -t ed25519            # only if you have no key yet
ssh-copy-id user@192.168.1.20    # install the public key in the VM
ssh user@192.168.1.20 true       # returns without a password = wired
```

With VMware NAT you can also forward host port 2222 to the guest's 22 in *Virtual Network Editor* and then always write `user@127.0.0.1:2222`.

### 3. Build from Windows

```powershell
# First prove the VM can run the engine check
ssh user@192.168.1.20 'bash ~/AppPackager/打包工具.command check ios'

# Build: run remotely, then pull packages/iOS back
app-packager build ios my-project --remote user@192.168.1.20
```

Flags:

| Flag | Effect |
| --- | --- |
| `--remote <user@host[:port]>` | Run on that macOS (`build` and `check` both support it) |
| `--remote-key <path>` | Private key (otherwise ssh-agent / default keys) |
| `--remote-home <path>` | Remote engine home, default `~/AppPackager` |
| `--no-pull` | Keep the artifacts on the remote side |

Remote execution uses `ssh`, artifact retrieval uses `scp`; both ship with the OS. `BatchMode=yes` is on by default, so it **never** waits for a password in the background — an unconfigured key fails fast with a real exit code.

### 4. Acceptance checklist

1. `ssh vm true` works without a password;
2. `ssh vm 'bash ~/AppPackager/打包工具.command check ios'` is all green;
3. `app-packager build ios <project> --remote vm` exits 0;
4. a fresh `.ipa` (or `-latest.json`) appears in the local `~/AppPackager/packages/iOS/`.

All four pass means the path is wired. The panel and CI can then reuse the same command.

---

## Pitfalls

- **VMware won't start / Hyper-V conflict**: WSL2, Docker Desktop and Windows Sandbox all enable Hyper-V. Turn them off (`bcdedit /set hypervisorlaunchmode off`, then reboot) or switch to VirtualBox.
- **Clock drift**: a slept VM drifts, and `xcodebuild` then fails certificate validity. Install VMware Tools and keep time synced (`sudo sntp -sS time.apple.com`).
- **Not enough disk**: Xcode is ~15 GB, iOS SDK plus simulator runtimes another 30 GB+, and build caches keep growing. 100 GB is a floor, not a target.
- **First `xcodebuild` stuck on the license**: run `sudo xcodebuild -license accept` once.
- **Shared-folder paths with spaces or non-ASCII**: the engine quotes paths, but VMware shared folders plus the toolchain are fragile with non-ASCII — avoid them.
- **Xcode version mismatch**: the offline iOS SDK expects a matching Xcode; upgrade both together.
- **A laggy VM window**: virtual GPUs are weak. Command-line builds are unaffected — slow UI does not mean slow builds.

## Alternatives

| Option | Cost | Notes |
| --- | --- | --- |
| Mac mini (M4 base) | one-time hardware | Least hassle; same wiring as Part 3, point `--remote` at it |
| Old MacBook / Intel Mac mini | used | Fine, as long as macOS ≥ 14.5 |
| macOS VM (this page) | free | Works on a single Windows box, but violates Apple's license and needs upkeep |
| DCloud cloud packaging | per build | Not recommended: queues, per-build fees, certificate upload |

Either way the Windows side is the same call: `app-packager build ios <project> --remote <target>`.
