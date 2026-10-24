/** Port of the offline-SDK helpers in `engine/lib/common.sh` (`sdk_series` and the ready checks). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './settings.js';

const DEFAULT_SERIES = '5.26';

/**
 * The SDK series HBuilderX is built for: `config/sdk.local.env` wins, then the
 * HBuilderX apps own Info.plist, then the packaged default.
 */
export function sdkSeries(settings: Settings, _home = ''): string {
  const configured = String(settings.SDK_SERIES || '').trim();
  if (configured) return configured;
  const app = String(settings.HBUILDERX_APP || '/Applications/HBuilderX.app');
  const plist = path.join(app, 'Contents', 'Info.plist');
  try {
    const output =
      process.platform === 'darwin'
        ? execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf8', timeout: 20000 })
        : '';
    const match = /(\d+\.\d+)/.exec(output);
    if (match) return match[1];
  } catch {
    /* fall through to the packaged default */
  }
  return DEFAULT_SERIES;
}

/** `SDK/<series>/iOS` — also honours an explicit `IOS_SDK_DIR`. */
export function iosSdkDir(settings: Settings, home: string): string {
  return String(settings.IOS_SDK_DIR || path.join(home, 'sdk', sdkSeries(settings, home), 'iOS'));
}

export function androidSdkDir(settings: Settings, home: string): string {
  return String(settings.ANDROID_SDK_DIR || path.join(home, 'sdk', sdkSeries(settings, home), 'Android'));
}

export function harmonySdkDir(settings: Settings, home: string): string {
  return String(settings.HARMONY_SDK_DIR || path.join(home, 'sdk', sdkSeries(settings, home), 'HarmonyOS'));
}

const hasProject = (dir: string, name: string): boolean => fs.existsSync(path.join(dir, name, 'UniAppXDemo.xcodeproj')) && fs.existsSync(path.join(dir, name, 'SDK'));

/** A uni-app x iOS SDK: the Xcode project plus its SDK directory. */
export function iosSdkUniappxReady(settings: Settings, home: string): boolean {
  const dir = iosSdkDir(settings, home);
  return hasProject(dir, 'UniAppXDemo');
}

/** Any usable iOS offline SDK — uni-app x layout or the classic HBuilder-Hello one. */
export function iosSdkReady(settings: Settings, home: string): boolean {
  if (iosSdkUniappxReady(settings, home)) return true;
  const dir = iosSdkDir(settings, home);
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .some((entry) => entry.isDirectory() && (entry.name === 'HBuilder-Hello.xcodeproj' || entry.name === 'UniAppXDemo.xcodeproj'));
}

export function androidSdkReady(settings: Settings, home: string): boolean {
  const dir = androidSdkDir(settings, home);
  return fs.existsSync(path.join(dir, 'SDK', 'libs')) || fs.existsSync(path.join(dir, 'libs'));
}

/**
 * Only real runtime output counts: `oh-package.json5` is a manifest the SDK
 * step writes itself, so trusting it would report a failed ohpm install as
 * ready.
 */
export function harmonySdkReady(settings: Settings, home: string): boolean {
  const dir = harmonySdkDir(settings, home);
  for (const name of ['uni-app-x-runtime', 'uni-app-x-vapor-runtime']) {
    if (fs.existsSync(path.join(dir, 'oh_modules', '@dcloudio', name))) return true;
  }
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith('.har'));
}
