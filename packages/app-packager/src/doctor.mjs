/**
 * Environment diagnosis shared by `app-packager doctor` and the DSH tool.
 *
 * It answers one question: on THIS machine, which platforms can be built right
 * now. Checks that cannot be established are warnings with a hint, never silent
 * passes — a false "ok" costs a failed build hours later.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExecutable, shellAvailable } from './engine.mjs';
import { materializedVersion, packageVersion, isMaterialized } from './home.mjs';
import { listProjects } from './projects.mjs';
import { parseEnvFile } from './projects.mjs';

const PLATFORM_LABELS = { ios: 'iOS (IPA)', android: 'Android (APK)', harmony: 'HarmonyOS (HAP)' };

function check(id, label, status, detail, hint) {
  return { id, label, status, detail: detail || '', hint: hint || '' };
}

function probeExecutable(id, label, names, hint) {
  for (const name of names) {
    const found = findExecutable(name);
    if (found) return check(id, label, 'ok', found);
  }
  return check(id, label, 'fail', `未找到 ${names.join(' / ')}`, hint);
}

function readSettings(home) {
  const file = path.join(home, 'config', 'settings.env');
  if (!fs.existsSync(file)) return {};
  try {
    return parseEnvFile(file, { PIPELINE_ROOT: home, HOME: os.homedir() });
  } catch {
    return {};
  }
}

export function runDoctor({ home, platform = 'all' } = {}) {
  const wantPlatform = (name) => platform === 'all' || platform === name;
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);

  checks.push(
    nodeMajor >= 18
      ? check('node', 'Node.js', 'ok', `v${process.versions.node}`)
      : check('node', 'Node.js', 'fail', `v${process.versions.node}`, '需要 Node.js >= 18'),
  );

  const materialized = isMaterialized(home);
  if (!materialized) {
    checks.push(check('engine', '打包引擎', 'fail', `${home} 未初始化`, '运行 `app-packager init` 复制引擎并完成初始化向导'));
  } else {
    const drift = materializedVersion(home) !== packageVersion();
    checks.push(
      drift
        ? check('engine', '打包引擎', 'warn', `${home} 的引擎版本与当前 CLI 不一致`, '运行 `app-packager init --force` 刷新引擎脚本')
        : check('engine', '打包引擎', 'ok', home),
    );
  }

  const shell = shellAvailable();
  checks.push(
    shell.available
      ? check('bash', 'bash / 引擎桥接', 'ok', `${shell.shell.kind} · ${shell.shell.command}${shell.shell.hint ? ` · ${shell.shell.hint}` : ''}`)
      : check('bash', 'bash / 引擎桥接', 'fail', shell.error, 'Windows 安装 Git for Windows，或启用 WSL'),
  );

  const settings = materialized ? readSettings(home) : {};
  if (wantPlatform('ios')) {
    if (process.platform !== 'darwin') {
      checks.push(check('ios.host', PLATFORM_LABELS.ios, 'fail', `当前系统 ${process.platform} 无法构建 iOS`, 'iOS 打包只能在 macOS 上完成（需要 Xcode）'));
    } else {
      checks.push(check('ios.host', 'macOS / Xcode 主机', 'ok', `darwin ${os.release()}`));
      checks.push(probeExecutable('ios.xcodebuild', 'xcodebuild', ['xcodebuild'], '安装 Xcode 并在终端执行 `xcode-select --install`'));
      checks.push(probeExecutable('ios.security', 'security / codesign', ['security', 'codesign'], '安装 Xcode Command Line Tools'));
      const hb = settings.HBUILDERX_CLI;
      if (!hb) {
        checks.push(check('ios.hbuilderx', 'HBuilderX CLI', 'warn', '尚未初始化，无法读取 HBUILDERX_CLI', '运行 `app-packager init` 后重试'));
      } else if (fs.existsSync(hb)) {
        checks.push(check('ios.hbuilderx', 'HBuilderX CLI', 'ok', hb));
      } else {
        checks.push(check('ios.hbuilderx', 'HBuilderX CLI', 'fail', `${hb} 不存在`, '安装 HBuilderX，或在 config/settings.local.env 覆盖 HBUILDERX_CLI'));
      }
    }
  }

  if (wantPlatform('android')) {
    checks.push(probeExecutable('android.java', 'Java (JDK)', ['java'], '安装 JDK 17+ 并配置 JAVA_HOME'));
    const sdkDir = settings.ANDROID_SDK_DIR || path.join(os.homedir(), 'Library', 'Android', 'sdk');
    checks.push(
      fs.existsSync(sdkDir)
        ? check('android.sdk', 'Android SDK', 'ok', sdkDir)
        : check('android.sdk', 'Android SDK', 'warn', `${sdkDir} 不存在`, '安装 Android SDK，或在 config/settings.local.env 覆盖 ANDROID_SDK_DIR'),
    );
  }

  if (wantPlatform('harmony')) {
    const hvigor = findExecutable('hvigorw') || findExecutable('hvigorw.bat');
    const deveco = [
      '/Applications/DevEco-Studio.app',
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Huawei', 'DevEco Studio'),
    ].filter(Boolean).find((dir) => fs.existsSync(dir));
    checks.push(
      deveco || hvigor
        ? check('harmony.toolchain', 'HarmonyOS 工具链', 'ok', deveco || hvigor)
        : check('harmony.toolchain', 'HarmonyOS 工具链', 'warn', '未发现 DevEco Studio 或 hvigorw', '安装 DevEco Studio；引擎也会从业务项目的 hvigorw 兜底'),
    );
    if (!settings.HARMONY_SIGNING_CERT_DIR) {
      checks.push(check('harmony.signing', 'HarmonyOS 签名目录', 'warn', '尚未初始化', '运行 `app-packager init` 后重试'));
    } else {
      checks.push(check('harmony.signing', 'HarmonyOS 签名目录', 'ok', settings.HARMONY_SIGNING_CERT_DIR));
    }
  }

  const projects = materialized ? listProjects(home) : [];
  if (!materialized) {
    checks.push(check('projects', '项目配置', 'warn', '引擎未初始化', '运行 `app-packager init`'));
  } else if (projects.length === 0) {
    checks.push(check('projects', '项目配置', 'warn', '未发现 config/projects/*.env', '把 uni-app x 项目放在引擎同级目录，或运行 `app-packager register <项目目录>`；插件面板里有「选择目录…」按钮'));
  } else {
    const missing = projects.filter((project) => project.sourceDir && !project.sourceDirExists);
    checks.push(
      missing.length === 0
        ? check('projects', '项目配置', 'ok', `${projects.length} 个项目：${projects.map((project) => project.id).join(', ')}`)
        : check('projects', '项目配置', 'warn', `${missing.length}/${projects.length} 个项目的 SOURCE_DIR 不存在`, `检查 ${missing.map((project) => project.file).join(', ')}`),
    );
  }

  const failed = checks.filter((item) => item.status === 'fail');
  return {
    ok: failed.length === 0,
    home,
    platform,
    platformName: platform === 'all' ? '全部平台' : PLATFORM_LABELS[platform] || platform,
    checks,
    failures: failed.length,
    warnings: checks.filter((item) => item.status === 'warn').length,
    projects: projects.map((project) => ({
      id: project.id,
      enabledPlatforms: project.enabledPlatforms,
      sourceDir: project.sourceDir,
      sourceDirExists: project.sourceDirExists,
    })),
  };
}

export { PLATFORM_LABELS };
