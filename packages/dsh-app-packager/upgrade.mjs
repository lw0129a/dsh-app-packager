#!/usr/bin/env node
/**
 * Upgrade the installed DSH plugin while keeping everything inside its home
 * directory (offline SDKs, certificates, project config, logs).
 *
 *   node <plugin>/upgrade.mjs [pnpm-args-extra...]
 *
 * Home lives in <plugin>/home, so replacing the plugin would delete it. This
 * script renames home to <profile>/node_modules/.app-packager-home-backup, runs
 * the upgrade, then renames it back — a rename, never a copy, so a 1 GB SDK
 * download costs nothing.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_NAME, homeInPlugin, isNewerVersion, pluginRoot, withHomePreserved } from './index.mjs';

const root = pluginRoot();
if (!root) {
  console.error('当前代码不在 DSH 插件目录内（node_modules/dsh-app-packager），无法自动升级。');
  console.error('请手动升级：dsh plugin --profile <profile> add ' + PACKAGE_NAME + '@latest');
  process.exit(2);
}

const profileName = process.env.DSH_PROFILE || 'desktop';
const profileDir = process.env.DSH_PROFILE_DIR
  || path.dirname(path.dirname(root));

function run(command, args, cwd) {
  return new Promise((resolve) => {
    console.log(`$ ${command} ${args.join(' ')}  (cwd: ${cwd})`);
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', (error) => resolve({ code: 1, error: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

async function registryLatest() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const info = await res.json();
    return typeof info.version === 'string' ? info.version : null;
  } catch {
    return null;
  }
}

async function upgrade() {
  const extra = process.argv.slice(2).filter((arg) => arg !== '--force');
  const dsh = '/usr/local/bin/dsh';
  if (fs.existsSync(dsh)) {
    return run(dsh, ['plugin', '--profile', profileName, 'add', `${PACKAGE_NAME}@latest`, ...extra], profileDir);
  }
  return run('pnpm', ['add', `${PACKAGE_NAME}@latest`, ...extra], profileDir);
}

console.log(`插件目录: ${root}`);
console.log(`引擎主目录: ${homeInPlugin(root)}`);
console.log(`DSH profile: ${profileName} (${profileDir})`);

// 本地 tarball 装的版本可能比 registry 还新（例如 0.6.0 还没发出去）：那种
// 「升级」只会把装好的功能换回旧版，所以先比一次版本，--force 才强制重装。
const installed = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const latest = await registryLatest();
if (!process.argv.includes('--force')) {
  if (!latest) {
    console.log('查不到 registry 上的最新版本，按原样继续。');
  } else if (!isNewerVersion(latest, installed)) {
    console.log(`registry 上是 ${latest}，本机已经是 ${installed}，没有可升级的新版本（要强制重装：加 --force）。`);
    process.exit(0);
  }
}

const result = await withHomePreserved(root, upgrade);

if (result.code === 0) {
  console.log('\n升级完成。重启 DeepSeek Harness 后生效。');
} else {
  console.error(`\n升级失败（退出码 ${result.code}${result.error ? `：${result.error}` : ''}）。`);
}
process.exit(result.code === 0 ? 0 : 1);
