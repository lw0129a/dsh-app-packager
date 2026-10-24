/**
 * Engine settings, read the way the bash engine reads them: PIPELINE_ROOT is the
 * engine home, then config/settings.env, then config/settings.local.env on top.
 * Values may reference earlier keys (`$PACKAGE_ROOT/...`), which parseEnvText
 * expands in order.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvText } from '../projects.js';

export interface Settings {
  [key: string]: string;
}

const FILES = ['config/settings.env', 'config/settings.local.env'];

/** Defaults the engine needs before any file is read (`lib/common.sh` does the same). */
function seed(home: string): Settings {
  return { PIPELINE_ROOT: home, HOME: os.homedir(), USER: os.userInfo().username };
}

export function loadSettings(home: string, base: Settings = {}): Settings {
  const vars: Settings = { ...seed(home), ...base };
  for (const name of FILES) {
    const file = path.join(home, name);
    if (!fs.existsSync(file)) continue;
    Object.assign(vars, parseEnvText(fs.readFileSync(file, 'utf8'), vars));
  }
  return vars;
}

/** Package directory for a platform, honouring whatever settings.env says. */
export function packageDir(settings: Settings, platform: 'ios' | 'android' | 'harmony' | 'mp-weixin'): string {
  const key = { ios: 'PACKAGE_IOS_DIR', android: 'PACKAGE_ANDROID_DIR', harmony: 'PACKAGE_HARMONY_DIR', 'mp-weixin': 'PACKAGE_MP_WEIXIN_DIR' }[platform];
  return settings[key] || path.join(settings.PACKAGE_ROOT || path.join(settings.PIPELINE_ROOT, 'packages'), platform);
}

export function keepCount(settings: Settings, key: 'KEEP_BUILD_COUNT' | 'KEEP_LOG_COUNT'): number {
  const value = Number.parseInt(settings[key] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : 5;
}
