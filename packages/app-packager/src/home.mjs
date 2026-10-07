/**
 * Resolve and materialize the AppPackager home directory.
 *
 * The engine (packages/app-packager/engine) is a set of bash scripts that own
 * their own PIPELINE_ROOT: they read config/, download sdk/, keep logs/ and
 * archive packages/ below it. An installed npm package lives in a read-only
 * node_modules tree, so the engine is copied once into a writable home and the
 * scripts then run untouched from there.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
export const ENGINE_SOURCE = path.join(PACKAGE_ROOT, 'engine');
export const ENGINE_ENTRY = '打包工具.command';
export const ENGINE_WIZARD = '初始化.command';
export const VERSION_FILE = '.engine-version';

/** Paths inside the home that belong to the user and are never overwritten. */
const USER_OWNED = [
  /^config\/settings\.local\.env$/,
  /^config\/upload\.local\.env$/,
  /^config\/parallel\.local\.env$/,
  /^config\/init\.local\.env$/,
  /^config\/projects\/(?!.*\.example$).*\.env$/,
  /^certificates\/(?!README\.md$)(?!处理证书\.command$)/,
  /^signing\/(?!README\.md$)(?!apple\/)/,
  /^sdk\/(?!README\.md$)(?!处理SDK\.command$)/,
  /^packages\//,
  /^logs\/(?!\.gitkeep$)/,
  /^workspaces\//,
  /^\.tmp\//,
];

export function isUserOwned(relativePath) {
  const rel = relativePath.split(path.sep).join('/');
  return USER_OWNED.some((pattern) => pattern.test(rel));
}

export function packageVersion() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return manifest.version;
}

/**
 * Home precedence: explicit --dir > APP_PACKAGER_HOME > ~/AppPackager.
 * The default sits directly in the user's home so that uni-app x projects kept
 * next to it are still discovered by the engine's sibling scan.
 */
export function resolveHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.APP_PACKAGER_HOME) return path.resolve(process.env.APP_PACKAGER_HOME);
  return path.join(os.homedir(), 'AppPackager');
}

export function engineEntryPath(home) {
  return path.join(home, ENGINE_ENTRY);
}

export function isMaterialized(home) {
  return fs.existsSync(engineEntryPath(home));
}

export function materializedVersion(home) {
  try {
    return fs.readFileSync(path.join(home, VERSION_FILE), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Copy the packaged engine into `home`.
 *
 * Scripts, docs and templates are refreshed on every version bump; files the
 * user owns (local config, certificates, sdk, packages, logs, workspaces) are
 * left alone.
 */
export function materialize(home, { force = false } = {}) {
  const version = packageVersion();
  if (!force && isMaterialized(home) && materializedVersion(home) === version) {
    return { copied: 0, skipped: 0, version, upToDate: true };
  }
  if (!fs.existsSync(ENGINE_SOURCE)) {
    throw new Error(`packaged engine not found at ${ENGINE_SOURCE}`);
  }

  const result = { copied: 0, skipped: 0, version, upToDate: false };
  fs.mkdirSync(home, { recursive: true });

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name);
      const rel = path.relative(ENGINE_SOURCE, src);
      if (entry.isDirectory()) {
        walk(src);
        continue;
      }
      if (isUserOwned(rel)) {
        result.skipped += 1;
        continue;
      }
      const dest = path.join(home, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      try {
        // Windows has no POSIX mode bits; the engine is always invoked as
        // `bash <script>`, so a failed chmod is harmless there.
        fs.chmodSync(dest, fs.statSync(src).mode & 0o777);
      } catch {
        /* best effort */
      }
      result.copied += 1;
    }
  };
  walk(ENGINE_SOURCE);

  fs.writeFileSync(path.join(home, VERSION_FILE), `${version}\n`);
  return result;
}
