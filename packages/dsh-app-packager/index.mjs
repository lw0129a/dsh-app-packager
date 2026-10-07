/**
 * Locate the installed DSH plugin directory and resolve the engine home inside it.
 *
 * The engine home holds everything the AppPackager engine downloads while it
 * runs: offline SDKs (sdk/), signing certificates, project config (config/) and
 * built artifacts (packages/, logs/). It must sit inside the installed DSH
 * plugin directory instead of next to $HOME, so a single plugin folder carries
 * the whole tool.
 *
 * Upgrading the plugin replaces node_modules/dsh-app-packager, so upgrade.mjs
 * moves home aside before the upgrade and moves it back afterwards — a fresh
 * plugin version must never throw away a 1 GB SDK download.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory name of the engine home inside the plugin. */
export const HOME_DIR_NAME = 'home';
/** Where older versions kept the engine home. */
export const LEGACY_HOME_NAME = 'AppPackager';
/** Sibling of the plugin that holds home while an upgrade runs. */
export const UPGRADE_BACKUP_DIR_NAME = '.app-packager-home-backup';
/** Installed package name, so a nested dependency is never mistaken for the plugin. */
export const PACKAGE_NAME = 'dsh-app-packager';
/** Engine entry script; an engine home always has it (or `.engine-version`). */
export const ENGINE_ENTRY_NAME = '打包工具.command';

/**
 * The directory the plugin was installed into, or null when the code runs
 * straight from a repository checkout (no node_modules in the path) or from a
 * nested dependency tree.
 *
 * `import.meta.url` is the exact answer while the file is loaded as-is; the
 * DSH_PROFILE_DIR lookup keeps it working if a host ever loads the plugin from
 * a bundled copy somewhere else.
 */
export function pluginRoot(moduleUrl = import.meta.url, env = process.env) {
  const fromModule = pluginRootFromModule(moduleUrl);
  if (fromModule) return fromModule;
  if (env.DSH_PROFILE_DIR) {
    const installed = path.join(env.DSH_PROFILE_DIR, 'node_modules', PACKAGE_NAME);
    if (fs.existsSync(path.join(installed, 'package.json'))) return installed;
  }
  return null;
}

function pluginRootFromModule(moduleUrl) {
  const dir = path.dirname(fileURLToPath(moduleUrl));
  const parts = dir.split(path.sep);
  const start = parts.lastIndexOf('node_modules');
  const end = parts.length - 1;
  if (start < 0 || start === end) return null;
  if (parts.indexOf('node_modules', start + 1) >= 0) return null;
  // Scoped package: <...>/node_modules/@scope/name
  const scoped = parts[start + 1] && parts[start + 1].startsWith('@');
  const nameIndex = scoped ? start + 2 : start + 1;
  if (parts[nameIndex] !== PACKAGE_NAME) return null;
  return parts.slice(0, nameIndex + 1).join(path.sep) || path.sep;
}

export function legacyHome() {
  return path.join(os.homedir(), LEGACY_HOME_NAME);
}

export function homeInPlugin(root) {
  return path.join(root, HOME_DIR_NAME);
}

export function upgradeBackupDir(root) {
  return path.join(path.dirname(root), UPGRADE_BACKUP_DIR_NAME);
}

/**
 * Home precedence: explicit config > APP_PACKAGER_HOME > <plugin>/home > ~/AppPackager.
 *
 * The first time <plugin>/home is about to be used, an existing ~/AppPackager
 * is renamed into place so previously downloaded SDKs and registered projects
 * move with it. A rename never copies data: if the two paths live on different
 * volumes the old home is kept and reported instead of being duplicated.
 *
 * The move only ever happens for a directory that really is an engine home
 * (`.engine-version` or the engine entry script) — an unrelated folder that
 * happens to carry the old name is left untouched. `legacy` exists so callers
 * (and tests) can name that directory explicitly instead of relying on $HOME.
 */
export function resolvePluginHome(explicit, options = {}) {
  const { moduleUrl = import.meta.url, env = process.env, onNotice, legacy = legacyHome() } = options;
  const notice = typeof onNotice === 'function' ? onNotice : () => {};

  if (explicit) return path.resolve(explicit);
  if (env.APP_PACKAGER_HOME) return path.resolve(env.APP_PACKAGER_HOME);

  const root = pluginRoot(moduleUrl, env);
  if (!root) return legacy;

  const home = homeInPlugin(root);
  if (fs.existsSync(home)) return home;
  if (!looksLikeEngineHome(legacy)) return home;

  try {
    fs.renameSync(legacy, home);
    notice(`已把 ${legacy} 迁移到插件目录内：${home}`);
    return home;
  } catch (error) {
    notice(`无法把 ${legacy} 迁移到 ${home}（${error.code || error.message}），继续使用原目录。`);
    return legacy;
  }
}

/**
 * Loose `x.y.z` comparison: is `candidate` a newer release than `current`?
 *
 * Used before upgrading from a locally packed tarball: the registry's `latest`
 * can be older than what is installed (a version that has not been published
 * yet), and "upgrading" to it would silently take features away.
 */
export function isNewerVersion(candidate, current) {
  const parse = (value) => String(value).split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const next = parse(candidate);
  const have = parse(current);
  for (let i = 0; i < 3; i += 1) {
    if (next[i] !== have[i]) return next[i] > have[i];
  }
  return false;
}

/** True only for a directory that is (or was) an engine home, never a lookalike. */
export function looksLikeEngineHome(dir) {
  return fs.existsSync(path.join(dir, '.engine-version')) || fs.existsSync(path.join(dir, ENGINE_ENTRY_NAME));
}

/**
 * Move home aside, run `upgrade()`, then move home back.
 *
 * Every failure path restores the backups before rethrowing, so a failed
 * upgrade leaves the user with the home they started with.
 */
export async function withHomePreserved(root, upgrade) {
  const home = homeInPlugin(root);
  const backup = upgradeBackupDir(root);

  const move = (from, to) => {
    if (!fs.existsSync(from)) return false;
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return true;
  };

  let stashed = false;
  try {
    stashed = move(home, backup);
    console.log(stashed ? `已把 ${home} 暂存到 ${backup}` : `没有需要暂存的数据（${home} 不存在）`);
    return await upgrade();
  } finally {
    if (stashed) {
      try {
        move(backup, home);
        console.log(`已恢复到 ${home}`);
      } catch (error) {
        console.error(`恢复 ${home} 失败：${error.message}\n数据仍在 ${backup}，请手动移回。`);
      }
    }
  }
}
