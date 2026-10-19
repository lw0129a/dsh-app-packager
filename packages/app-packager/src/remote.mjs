/**
 * 远程 macOS 执行器：把引擎命令转到另一台 macOS 上跑，再把产物拉回来。
 *
 * Windows 不能本地打 iOS（Xcode 只在 macOS 上），所以 Windows 用户跑一台
 * macOS 虚拟机或第二台 Mac，`build ios --remote user@vm` 就转发过去执行。
 * 只用 ssh / scp：macOS、Linux 自带，Windows 10+ 也自带 OpenSSH 客户端。
 *
 * 约定：远程机器上有一份引擎目录（默认 `~/AppPackager`，`app-packager init`
 * 或从主机 rsync 过去都行），项目的 `SOURCE_DIR` 以那台机器上的路径为准。
 *
 * @module app-packager/remote
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ENGINE_ENTRY = '打包工具.command';

/** 平台名到引擎产物目录的映射（`build all` 时逐个拉）。 */
export const PLATFORM_DIRS = { ios: 'iOS', android: 'Android', harmony: 'HarmonyOS' };

/** `user@host`、`user@host:2222`、`ssh://user@host:2222` 都能解析。 */
export function parseRemoteTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('远程目标不能为空，例如 --remote user@192.168.1.20');
  const rest = raw.replace(/^ssh:\/\//, '');
  const at = rest.lastIndexOf('@');
  const user = at === -1 ? '' : rest.slice(0, at);
  let host = at === -1 ? rest : rest.slice(at + 1);
  let port;
  const colon = host.lastIndexOf(':');
  if (colon !== -1) {
    const maybePort = host.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      port = Number(maybePort);
      host = host.slice(0, colon);
    }
  }
  if (!host) throw new Error(`远程目标缺少主机名：${value}`);
  return { user, host, port, spec: user ? `${user}@${host}` : host };
}

/** POSIX 单引号转义：远程命令里每个参数都过一遍，空格和引号都不会被 shell 吃掉。 */
function quoteArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * 远程引擎命令。`~` 开头写成 `"$HOME/…"` 让远端 shell 自己展开，
 * 其余路径原样单引号包住。
 */
export function remoteEngineCommand(home, args) {
  const value = String(home);
  const homeExpr = value.startsWith('~') ? `"$HOME${value.slice(1)}"` : quoteArg(value);
  const rest = args.map(quoteArg).join(' ');
  return `cd ${homeExpr} && exec bash ${quoteArg(ENGINE_ENTRY)}${rest ? ` ${rest}` : ''}`;
}

export function sshArgv(target, remoteCommand, { key, allowPassword = false } = {}) {
  const args = [];
  if (target.port) args.push('-p', String(target.port));
  if (key) args.push('-i', key);
  args.push('-o', 'ConnectTimeout=8');
  // 默认不弹密码：批量/插件场景里挂住没人输入，不如立刻失败。
  if (!allowPassword) args.push('-o', 'BatchMode=yes');
  args.push(target.spec, remoteCommand);
  return args;
}

export function scpArgv(target, remotePath, localPath, { key, recursive = true } = {}) {
  const args = [];
  if (target.port) args.push('-P', String(target.port));
  if (key) args.push('-i', key);
  args.push('-o', 'BatchMode=yes');
  if (recursive) args.push('-r');
  args.push(`${target.spec}:${remotePath}`, localPath);
  return args;
}

/** spawn 一个外部命令，等到退出；`code` 为整数，被信号杀掉按 1 处理。 */
export function runCommand(command, argv, { stdio = 'inherit', timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio, env: env || process.env });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

/** 在远程机器上跑一次引擎命令，返回退出码。 */
export function runRemote({ target, key, home = '~/AppPackager', args = [], timeoutMs, stdio = 'inherit', env, allowPassword }) {
  const remoteCommand = remoteEngineCommand(home, args);
  return runCommand('ssh', sshArgv(target, remoteCommand, { key, allowPassword }), { stdio, timeoutMs, env });
}

/**
 * 把远程 `packages/<平台>/` 拉回本地同名目录。
 * 返回第一个失败的退出码，全成功返回 0。
 */
export async function pullArtifacts({ target, key, remoteHome = '~/AppPackager', localHome, platform }) {
  const names = platform === 'all' ? Object.values(PLATFORM_DIRS) : [PLATFORM_DIRS[platform]].filter(Boolean);
  const dest = path.join(localHome, 'packages');
  for (const name of names) {
    const remotePath = `${remoteHome}/packages/${name}`;
    const code = await runCommand('scp', scpArgv(target, remotePath, dest, { key }), { env: process.env });
    if (code !== 0) return code;
  }
  return 0;
}
