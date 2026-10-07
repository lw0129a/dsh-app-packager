/**
 * How the Node front door reaches the bash engine.
 *
 * macOS and Linux run the engine with the system bash. Windows has no bash, so
 * the bridge looks for Git for Windows first and falls back to WSL, translating
 * paths through `wslpath` on the way in. iOS builds stay macOS-only: Xcode does
 * not exist elsewhere, and the engine says so by itself.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { engineEntryPath } from './home.mjs';

const isWindows = process.platform === 'win32';

function isExecutableFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (!isWindows) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH lookup without a shell, honouring PATHEXT on Windows. */
export function findExecutable(name) {
  if (name.includes('/') || name.includes('\\')) {
    return isExecutableFile(name) ? name : null;
  }
  const exts = isWindows ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + (isWindows ? ext.toLowerCase() : ''));
      if (isExecutableFile(candidate)) return candidate;
      if (isWindows && isExecutableFile(path.join(dir, name + ext))) return path.join(dir, name + ext);
    }
  }
  return null;
}

const GIT_BASH_CANDIDATES = () =>
  [
    process.env.APP_PACKAGER_BASH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    findExecutable('bash.exe'),
    findExecutable('bash'),
  ].filter(Boolean);

function wslPath(winPath) {
  const probe = spawnSync('wsl.exe', ['-e', 'wslpath', '-a', winPath], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  return probe.stdout.trim() || null;
}

/**
 * @returns {{kind: 'native'|'git-bash'|'wsl', command: string, argsPrefix: string[],
 *            toShellPath: (p: string) => string|null, hint?: string}}
 */
export function resolveShell() {
  if (!isWindows) {
    const bash = isExecutableFile('/bin/bash') ? '/bin/bash' : findExecutable('bash');
    if (!bash) throw new Error('未找到 bash：请安装 Git Bash（Windows）或使用 macOS/Linux。');
    return { kind: 'native', command: bash, argsPrefix: [], toShellPath: (p) => p };
  }

  for (const candidate of GIT_BASH_CANDIDATES()) {
    if (isExecutableFile(candidate)) {
      return {
        kind: 'git-bash',
        command: candidate,
        argsPrefix: [],
        // Git Bash accepts both separators; forward slashes survive in env vars.
        toShellPath: (p) => p.replace(/\\/g, '/'),
      };
    }
  }

  const wsl = findExecutable('wsl.exe') || (fs.existsSync('C:\\Windows\\System32\\wsl.exe') ? 'C:\\Windows\\System32\\wsl.exe' : null);
  if (wsl) {
    const usable = spawnSync(wsl, ['-e', 'bash', '-lc', 'true'], { encoding: 'utf8' });
    if (usable.status === 0) {
      return {
        kind: 'wsl',
        command: wsl,
        argsPrefix: ['-e', 'bash'],
        toShellPath: (p) => wslPath(p),
        hint: 'Windows 通过 WSL 运行 bash 引擎；HBuilderX / Android SDK 需要在 WSL 内可见。',
      };
    }
  }

  throw new Error(
    '未找到 Git Bash 或 WSL。Windows 请安装 Git for Windows（推荐）或启用 WSL，' +
      '或设置 APP_PACKAGER_BASH 指向 bash.exe。',
  );
}

export function shellAvailable() {
  try {
    return { available: true, shell: resolveShell() };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

/**
 * Arguments that make bash run one engine action.
 *
 * @param {string} [options.script] engine script to run instead of the default
 *   entry (used for the interactive 初始化.command wizard).
 */
export function engineCommand(home, args, { searchRoots, shell = resolveShell(), script } = {}) {
  const entry = shell.toShellPath(script ? path.join(home, script) : engineEntryPath(home));
  const root = shell.toShellPath(home);
  if (!entry || !root) {
    throw new Error('无法把路径转换为 bash 路径；请检查 WSL 是否可用（wslpath）。');
  }
  const search = (searchRoots && searchRoots.length ? searchRoots : [path.dirname(home)])
    .map((dir) => shell.toShellPath(dir))
    .filter(Boolean)
    .join(':');
  return {
    shell,
    command: shell.command,
    args: [...shell.argsPrefix, entry, ...args],
    env: {
      ...process.env,
      PIPELINE_ROOT: root,
      PROJECT_SEARCH_ROOTS: search,
      LANG: process.env.LANG || 'zh_CN.UTF-8',
    },
    cwd: root,
  };
}

/**
 * Run one engine action.
 *
 * @param {object} options
 * @param {string} options.home
 * @param {string[]} options.args
 * @param {'inherit'|'pipe'} [options.stdio]
 * @param {'inherit'|'ignore'} [options.stdin] `inherit` is required by the
 *   interactive wizard; every non-interactive call must ignore stdin so the
 *   engine's trailing `read` sees EOF instead of hanging a child process.
 * @param {number} [options.timeoutMs]
 * @param {(line: string, stream: 'stdout'|'stderr') => void} [options.onLine]
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onSpawn]
 *   called with the child right after spawn, so a caller can cancel the run.
 * @param {string[]} [options.searchRoots]
 * @param {string} [options.script]
 */
export function runEngine(home, args, { stdio = 'inherit', stdin = 'ignore', timeoutMs, onLine, onSpawn, searchRoots, shell, script } = {}) {
  const prepared = engineCommand(home, args, { searchRoots, shell, script });
  return new Promise((resolve, reject) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      stdio: [ stdin, stdio === 'pipe' ? 'pipe' : stdio, stdio === 'pipe' ? 'pipe' : stdio ],
    });
    onSpawn?.(child);

    const stdout = [];
    const stderr = [];
    const carry = { stdout: '', stderr: '' };
    const consume = (stream) => (chunk) => {
      const text = chunk.toString('utf8');
      (stream === 'stdout' ? stdout : stderr).push(text);
      if (!onLine) return;
      const parts = (carry[stream] + text).split(/\r?\n/);
      carry[stream] = parts.pop() ?? '';
      for (const line of parts) onLine(line, stream);
    };
    if (stdio === 'pipe') {
      child.stdout.on('data', consume('stdout'));
      child.stderr.on('data', consume('stderr'));
    }

    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
      }, timeoutMs);
    }

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? 1,
        signal: signal ?? null,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        shellKind: prepared.shell.kind,
      });
    });
  });
}
