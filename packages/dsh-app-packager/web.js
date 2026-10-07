/**
 * AppPackager Web panel — host half of the Harness GUI.
 *
 * Serves the same-origin JSON routes the browser half (`./client.js`) calls:
 * engine state, one-click engine init, the Node-side doctor, and cancellable
 * check/build jobs whose output the panel polls while they run.
 *
 * The HTTP server is reached through `ctx.webServer` when the profile has one
 * (the desktop/web profiles ship `@deepseek-ai/dsh-web-app`). It is not a hard
 * `inject` dependency: cordis has no optional inject, and requiring the server
 * would keep the four tools inactive in a headless profile.
 *
 * @module dsh-app-packager/web
 */
import { execFile as execFileCallback, spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  PLATFORM_LABELS,
  isMaterialized,
  listProjects,
  listUploaders,
  materialize,
  materializedVersion,
  packageVersion,
  parseEnvFile,
  runDoctor,
  runEngine,
  shellAvailable,
} from 'app-packager';
import { pluginRoot, resolvePluginHome } from './index.mjs';

export const ROUTE_BASE = '/api/app-packager';
export const PLATFORM_VALUES = ['ios', 'android', 'harmony', 'all'];
export const SDK_PLATFORM_VALUES = ['ios', 'android', 'harmony'];

const JOB_LIMIT = 6;
const OUTPUT_LIMIT = 400_000;
const BODY_LIMIT = 1_000_000;
const execFileAsync = promisify(execFileCallback);

/**
 * Build the engine CLI argument list: `打包工具.command [check] <平台> [项目] [选项]`.
 *
 * `check` is an engine subcommand, not a flag, so it must come first; passing a
 * bare platform would ask the engine for a full build instead of a check.
 *
 * No project means every project the platform has enabled, which the engine
 * spells `--all` for a single platform (`all` already means every project of
 * every platform); without it `selected_projects` dies on "请指定项目 ID".
 *
 * Build options (iOS release kind, an explicit profile, full permissions, and
 * `KEY=VALUE` overrides) are pass-through: omitting them leaves the engine's own
 * `config/settings.env` and the wired profile in charge.
 *
 * @param {{platform?: string, project?: string, upload?: string, noUpload?: boolean,
 *   version?: string, harmonyDebug?: boolean, keepWork?: boolean, fullPermission?: boolean,
 *   packageKind?: string, profile?: string, set?: string|string[]}} args
 * @param {{check?: boolean}} [options]
 * @returns {string[]}
 */
export function engineArgsFor(args = {}, { check = false } = {}) {
  const platform = String(args.platform || '').toLowerCase();
  if (!PLATFORM_VALUES.includes(platform)) {
    throw new Error(`platform 必须是 ${PLATFORM_VALUES.join(' | ')}，收到 ${JSON.stringify(args.platform)}`);
  }
  const out = check ? ['check', platform] : [platform];
  if (args.project) out.push(String(args.project));
  else if (platform !== 'all') out.push('--all');
  if (!check) {
    if (args.upload) out.push('--upload', String(args.upload));
    if (args.noUpload) out.push('--no-upload');
    if (args.version) out.push('--version', String(args.version));
    if (args.harmonyDebug) out.push('--harmony-debug');
    if (args.keepWork) out.push('--keep-work');
  }
  // The rest is also carried by `check`: that run is the dry run of exactly
  // these options, and the engine validates the profile and permission switch
  // the same way before it builds anything.
  if (args.fullPermission === true) out.push('--full-permission');
  else if (args.fullPermission === false) out.push('--no-full-permission');
  if (args.profile) out.push('--profile', String(args.profile));
  // The release kind is an iOS concept: on another platform the engine would
  // still look for the profile and fail the run for no good reason.
  const kind = String(args.packageKind || '').trim();
  if (kind) {
    if (!PACKAGE_KINDS.includes(kind)) {
      throw new Error(`packageKind 必须是 ${PACKAGE_KINDS.join(' | ')}，收到 ${JSON.stringify(args.packageKind)}`);
    }
    if (platform === 'ios' || platform === 'all') out.push('--package-kind', kind);
  }
  for (const pair of overrideList(args.set === undefined ? args.overrides : args.set)) out.push('--set', pair);
  return out;
}

export const PACKAGE_KINDS = ['adhoc', 'appstore', 'development', 'enterprise'];

/**
 * `KEY=VALUE` overrides, from an array or one multi-line textarea value. Blank
 * lines and `#` comments are dropped so a project preset can be pasted as is;
 * a line without a `KEY=` is refused here rather than by a failing engine run.
 *
 * @param {string|string[]} [value]
 * @returns {string[]}
 */
export function overrideList(value) {
  const raw = value === undefined || value === null ? [] : Array.isArray(value) ? value : String(value).split(/\r?\n/);
  const out = [];
  for (const line of raw.map((item) => String(item).trim()).filter((item) => item && !item.startsWith('#'))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) throw new Error(`自定义配置项必须写成 KEY=VALUE：${line}`);
    out.push(line);
  }
  return out;
}

/**
 * Platforms an SDK job configures: an explicit list, a single platform, or all
 * of them. `check`/`build` accept the engine's `all`; SDK installs are one
 * engine call per platform, so `all` is expanded here.
 *
 * @param {{platforms?: string[], platform?: string}} [spec]
 * @returns {string[]}
 */
export function sdkPlatforms(spec = {}) {
  const requested = Array.isArray(spec.platforms) && spec.platforms.length > 0
    ? spec.platforms
    : spec.platform && spec.platform !== 'all'
      ? [spec.platform]
      : SDK_PLATFORM_VALUES;
  const list = [...new Set(requested.map((value) => String(value).trim()).filter((value) => SDK_PLATFORM_VALUES.includes(value)))];
  if (list.length === 0) throw new Error(`platforms 只能是 ${SDK_PLATFORM_VALUES.join('/')}`);
  return list;
}

/** Bash-style truthiness, matching the engine's own `is_true` on these switches. */
function isOn(value, fallback) {
  return value === undefined ? fallback : !/^(false|0|no|off)$/i.test(String(value).trim());
}
/** Directory mtime as a cheap change stamp; a missing directory is just "never". */
function dirStamp(dir) {
  try {
    return String(fs.statSync(dir).mtimeMs);
  } catch {
    return '-';
  }
}

/** The project's own env files (`--env-file` inputs) offered to the panel as presets. */
function presetsOf(sourceDir) {
  const out = {};
  if (!sourceDir) return out;
  for (const rel of ['scripts/ios-package/env', 'scripts/env']) {
    let names;
    try {
      names = fs.readdirSync(path.join(sourceDir, rel));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.env$/i.test(name)) continue;
      try {
        out[name.replace(/\.env$/i, '')] = fs.readFileSync(path.join(sourceDir, rel, name), 'utf8');
      } catch {
        /* unreadable preset: just leave it out of the list */
      }
    }
  }
  return out;
}

/**
 * The platforms a request covers, from `platforms` (a multi-select subset) or
 * the older single `platform`. `all` subsumes the rest, and the engine takes
 * one platform per run, so the panel gets one command per platform.
 *
 * @param {{platform?: string, platforms?: string|string[]}} args
 * @returns {string[]}
 */
export function scopePlatforms(args = {}) {
  const raw = args.platforms === undefined ? [args.platform] : args.platforms;
  const picked = [];
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    const platform = String(value || '').toLowerCase();
    if (!PLATFORM_VALUES.includes(platform)) {
      throw new Error(`platform 必须是 ${PLATFORM_VALUES.join(' | ')}，收到 ${JSON.stringify(value)}`);
    }
    if (platform === 'all') return ['all'];
    if (!picked.includes(platform)) picked.push(platform);
  }
  if (picked.length === 0) throw new Error('至少选择一个平台');
  return picked;
}

/**
 * The project ids a request covers, from `projects` (a multi-select subset) or
 * the older single `project`. Empty means every project the platform enables,
 * which `engineArgsFor` spells `--all`.
 *
 * @param {{project?: string, projects?: string|string[]}} args
 * @returns {string[]}
 */
export function scopeProjects(args = {}) {
  const raw = args.projects === undefined ? (args.project ? [args.project] : []) : args.projects;
  const picked = [];
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    const id = String(value === undefined || value === null ? '' : value).trim();
    if (id && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

/** One engine run per platform × project: the engine CLI takes exactly one of each. */
export function engineCommandsFor(args = {}, { check = false } = {}) {
  const platforms = scopePlatforms(args);
  const projects = scopeProjects(args);
  const combos = [];
  for (const platform of platforms) {
    for (const project of projects.length > 0 ? projects : ['']) combos.push({ platform, project });
  }
  return combos.map(({ platform, project }) => engineArgsFor({ ...args, platform, project }, { check }));
}

const FOLDER_PROMPT = '选择 uni-app x 项目目录';

/**
 * Ask the host OS for one or more folders. The browser half cannot read the
 * filesystem, so the dialog has to run here; each platform's own picker is used
 * instead of a dependency, and a missing picker only means "type the path
 * yourself". macOS and Linux pick several folders at once; the Windows dialog
 * can only return one, so the panel falls back to repeated picks there.
 *
 * @param {{prompt?: string}} [options]
 * @returns {Promise<{path: string, paths: string[], cancelled?: boolean, error?: string}>}
 */
export async function pickFolder({ prompt = FOLDER_PROMPT } = {}) {
  const run = async (file, args) => (await execFileAsync(file, args, { windowsHide: true })).stdout;
  const split = (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  let script;
  try {
    if (process.platform === 'darwin') {
      // `choose folder` wants {alias, ...} back with `as alias list` when
      // multiple selections are allowed, hence the explicit coercion.
      script = `set chosen to (choose folder with prompt ${JSON.stringify(prompt)} with multiple selections allowed)\nset out to ""\nrepeat with f in chosen\nset out to out & (POSIX path of f) & linefeed\nend repeat\nreturn out`;
      const paths = split(await run('osascript', ['-e', script]));
      return { path: paths[0] || '', paths };
    }
    if (process.platform === 'win32') {
      script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${JSON.stringify(prompt)}; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }`;
      const paths = split(await run('powershell', ['-NoProfile', '-STA', '-Command', script]));
      return { path: paths[0] || '', paths };
    }
    const paths = split(await run('zenity', ['--file-selection', '--directory', '--multiple', '--separator=\n', `--title=${prompt}`]));
    return { path: paths[0] || '', paths };
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    // Cancelling exits non-zero everywhere ("User canceled" / -128 / 1); only a
    // picker that does not exist at all is worth showing as an error.
    const cancelled = error?.code === 1 || /-128|user cancel|用户取消/i.test(detail);
    return { path: '', paths: [], cancelled, error: cancelled ? '' : detail };
  }
}

/** Keep the tail of a long build log so one run cannot grow without bound. */
function append(job, chunk) {
  if (!chunk) return;
  job.output += chunk;
  if (job.output.length > job.outputLimit) {
    const overflow = job.output.length - job.outputLimit;
    job.dropped += overflow;
    job.output = job.output.slice(overflow);
  }
}

/**
 * Append what the job log is still missing after an engine run: `runEngine`
 * already streams every complete line through `onLine` (that is what keeps a
 * long build readable while it runs), so re-appending its captured stdout would
 * print the whole run twice. Only an unterminated tail line is new.
 */
function appendResult(job, result) {
  for (const text of [result.stdout, result.stderr]) {
    if (!text) continue;
    const tail = String(text).slice(String(text).lastIndexOf('\n') + 1);
    if (tail) append(job, `${tail}\n`);
  }
}

const FAIL_LINE = /^\s*\[FAIL\]\s*(.+?)\s*$/;
const WARN_LINE = /^\s*\[WARN\]\s*(.+?)\s*$/;
const RESULT_LINE = /结果:\s*errors=(\d+)\s+warnings=(\d+)/g;

/**
 * Turn engine output into the explicit error summary the panel shows above the
 * raw log: the `[FAIL]` / `[WARN]` lines themselves plus their totals. The
 * engine prints one `结果: errors=N warnings=M` per checked project, so those
 * counts are summed; without them the line counts stand in for a run still in
 * flight.
 *
 * @param {string} [text]
 * @returns {{errorCount: number, warningCount: number, failures: string[], warnings: string[]}}
 */
export function summarizeOutput(text = '') {
  const failures = [];
  const warnings = [];
  for (const line of String(text).split('\n')) {
    const failure = FAIL_LINE.exec(line);
    const warning = WARN_LINE.exec(line);
    if (failure) failures.push(failure[1]);
    if (warning) warnings.push(warning[1]);
  }
  let errorCount = failures.length;
  let warningCount = warnings.length;
  const counted = [...String(text).matchAll(RESULT_LINE)];
  if (counted.length > 0) {
    errorCount = counted.reduce((total, match) => total + Number(match[1]), 0);
    warningCount = counted.reduce((total, match) => total + Number(match[2]), 0);
  }
  return { errorCount, warningCount, failures, warnings };
}

function jobView(job) {
  return {
    id: job.id,
    kind: job.kind,
    platform: job.platform,
    project: job.project,
    platformLabel: PLATFORM_LABELS[job.platform] || job.platform,
    running: job.running,
    code: job.code,
    signal: job.signal,
    ok: job.ok,
    error: job.error,
    blockedByCheck: Boolean(job.blockedByCheck),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    dropped: job.dropped,
    output: job.output,
    summary: summarizeOutput(job.output),
  };
}

/**
 * Run the plugin's own node script (the 升级插件 action) with the same streaming
 * contract as `runEngine`, so the panel shows and cancels it like an engine run.
 */
export function runNode(script, args = [], { cwd, timeoutMs, onLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
    child.stdout.on('data', consume('stdout'));
    child.stderr.on('data', consume('stderr'));

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
      resolve({ code: code ?? 1, signal: signal ?? null, stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}

/**
 * In-memory job registry for the panel: at most `limit` runs are kept (the
 * oldest *finished* one is evicted first) and each log is capped at `outputLimit`.
 *
 * @param {{spawn?: typeof runEngine, nodeSpawn?: typeof runNode, limit?: number, outputLimit?: number}} [options]
 */
export function createJobRunner({ spawn = runEngine, nodeSpawn = runNode, limit = JOB_LIMIT, outputLimit = OUTPUT_LIMIT } = {}) {
  /** @type {any[]} */
  const jobs = [];
  let seq = 0;

  function evict() {
    for (let index = jobs.length - 1; index >= 0 && jobs.length > limit; index -= 1) {
      if (!jobs[index].running) jobs.splice(index, 1);
    }
    if (jobs.length > limit) jobs.length = limit; // all still running: keep the newest
  }

  function find(id) {
    return jobs.find((job) => job.id === id);
  }

  return {
    list() {
      return jobs.map(jobView);
    },
    get(id) {
      const job = find(String(id || ''));
      return job ? jobView(job) : undefined;
    },
    /**
     * Drop every settled job (the panel's 清除). A running job is never removed:
     * the child process keeps going, so forgetting it would lose the only handle
     * on it — `kill` would then have nothing to signal.
     */
    clear() {
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (!jobs[index].running) jobs.splice(index, 1);
      }
      return jobs.map(jobView);
    },
    /**
     * @param {object} spec `{kind, platform, project, home, args, commands, timeoutMs,
     *   searchRoots, shell}`
     *
     * `commands` runs several engine calls back to back inside one job: the engine
     * CLI takes a single platform per run, so "android + ios" is two runs. Only a
     * cancel stops the batch early — a failing platform still lets the remaining
     * ones report their own state — and the first non-zero exit code is kept.
     */
    start(spec) {
      const commands = (Array.isArray(spec.commands) && spec.commands.length > 0 ? spec.commands : [spec.args]).map(
        (argv) => (Array.isArray(argv) ? argv.map(String) : [String(argv)]),
      );
      const job = {
        id: `job-${++seq}`,
        kind: spec.kind,
        platform: String(spec.platform || 'all'),
        project: String(spec.project || ''),
        commands,
        cancelled: false,
        startedAt: Date.now(),
        finishedAt: 0,
        running: true,
        code: null,
        signal: null,
        ok: false,
        error: '',
        output: '',
        dropped: 0,
        outputLimit,
        child: null,
      };
      jobs.unshift(job);
      evict();

      const options = {
        stdio: 'pipe',
        stdin: 'ignore',
        timeoutMs: spec.timeoutMs,
        searchRoots: spec.searchRoots,
        shell: spec.shell,
        onSpawn: (child) => {
          job.child = child;
        },
        onLine: (line) => append(job, `${line}\n`),
      };

      (async () => {
        // An upgrade job runs the plugin's own node script; everything else runs
        // the engine in `home`.
        const runOnce = (argv) =>
          spec.node
            ? nodeSpawn(spec.node.script, spec.node.args || [], { ...options, cwd: spec.node.cwd })
            : spawn(spec.home, argv, options);

        // A build only starts once the same scope passes `check`: a missing
        // profile, a wrong permission switch or an unfinished SDK are the
        // callers' to fix, and running the build first would bury that under
        // minutes of engine output.
        if (spec.precheck && Array.isArray(spec.precheck.commands) && spec.precheck.commands.length > 0) {
          append(job, `▶ 打包前环境检查（${spec.precheck.commands.length} 项）\n`);
          let blocked = false;
          for (const [index, argv] of spec.precheck.commands.entries()) {
            if (job.cancelled) break;
            if (spec.precheck.commands.length > 1) append(job, `· 检查 ${index + 1}/${spec.precheck.commands.length}  ${argv.join(' ')}\n`);
            const result = await spawn(spec.home, argv, { ...options, timeoutMs: spec.precheck.timeoutMs });
            appendResult(job, result);
            if (result.code !== 0 || /\[FAIL\]/.test(`${result.stdout || ''}${result.stderr || ''}`)) blocked = true;
          }
          if (job.cancelled) {
            // fall through to the shared exit below
          } else if (blocked) {
            job.blockedByCheck = true;
            job.code = 1;
            append(job, `\n✗ 环境检查未通过，已停止打包。请先按上面的 [FAIL] 提示处理，再重新打包。\n`);
          } else {
            append(job, `✓ 环境检查通过，开始打包\n\n`);
          }
        }

        if (!job.blockedByCheck) {
          for (const [index, argv] of commands.entries()) {
            if (job.cancelled) break;
            if (commands.length > 1) append(job, `▶ ${index + 1}/${commands.length}  ${argv.join(' ')}\n`);
            const result = await runOnce(argv);
            appendResult(job, result);
            if (result.code !== 0 && job.code === null) {
              job.code = result.code;
              job.signal = result.signal;
            }
          }
        }
        if (job.code === null) job.code = 0;
        job.ok = job.code === 0 && !/\[FAIL\]/.test(job.output);
      })()
        .catch((error) => {
          job.code = -1;
          job.error = String(error?.message || error);
        })
        .finally(() => {
          job.running = false;
          job.finishedAt = Date.now();
          job.child = null;
        });

      return jobView(job);
    },
    async kill(id) {
      const job = find(String(id || ''));
      if (!job) throw new Error(`未知任务：${id}`);
      if (!job.running) return jobView(job);
      job.cancelled = true;
      const child = job.child;
      job.error = '已被取消';
      // ponytail: SIGTERM then SIGKILL after 5s; grandchildren the engine
      // spawned survive, which only wastes a build slot in a rare cancel.
      if (child) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        timer.unref?.();
      }
      return jobView(job);
    },
  };
}

/**
 * Panel operations, independent of HTTP so they can be unit tested.
 *
 * @param {{config?: object, spawn?: typeof runEngine, limit?: number, outputLimit?: number}} [options]
 */
export function createPanel({ config = {}, spawn = runEngine, nodeSpawn = runNode, pick = pickFolder, limit, outputLimit, moduleUrl = import.meta.url, env = process.env } = {}) {
  const runner = createJobRunner({ spawn, nodeSpawn, limit, outputLimit });
  const homeNotices = [];
  const homeOf = () => resolvePluginHome(config.home || '', {
    moduleUrl,
    env,
    onNotice: (text) => {
      if (!homeNotices.includes(text)) homeNotices.push(text);
    },
  });

  function projectsOf(home) {
    try {
      return listProjects(home).map((project) => ({
        id: project.id,
        appName: project.appName,
        sourceDir: project.sourceDir,
        sourceDirExists: project.sourceDirExists,
        bundleId: project.bundleId,
        enabledPlatforms: project.enabledPlatforms,
        error: project.error,
      }));
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }

  /** Uploaders the engine declares in config/upload.env, with their enabled state. */
  function uploadersOf(home) {
    try {
      return listUploaders(home).map(({ id, name, enabled, available, platforms, reason }) => ({
        id,
        name,
        enabled,
        available,
        platforms,
        reason,
      }));
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }

  /**
   * Signing profiles, straight from the engine's own `profiles` subcommand: the
   * panel must not re-implement `.mobileprovision` parsing (kind, bundle id and
   * expiry all come from the same bash code that later picks the profile).
   *
   * Cached by the newest mtime under signing/ — a bash spawn per panel refresh
   * would be wasted work, and adding a profile touches that directory.
   */
  let profileCache = null;
  async function profilesOf(home) {
    const stamp = [ 'signing/current', 'signing/apple', 'certificates/iOS' ].map((rel) => dirStamp(path.join(home, rel))).join('|');
    if (profileCache && profileCache.home === home && profileCache.stamp === stamp) return profileCache.value;

    const shell = shellAvailable();
    if (!shell.available) return { error: `当前系统上无法运行 bash 引擎：${shell.error}` };
    let result;
    try {
      result = await spawn(home, ['profiles'], { stdio: 'pipe', timeoutMs: 60_000, searchRoots: config.searchRoots, shell: shell.shell });
    } catch (error) {
      return { error: `无法读取签名描述文件：${String(error?.message || error)}` };
    }
    if (result.code !== 0) {
      return { error: String(result.stderr || result.stdout || `profiles 退出码 ${result.code}`).trim() };
    }
    try {
      const value = JSON.parse(String(result.stdout || '').trim() || '[]');
      if (!Array.isArray(value)) return { error: 'profiles 输出不是数组' };
      profileCache = { home, stamp, value };
      return value;
    } catch (error) {
      return { error: `无法解析 profiles 输出：${String(error?.message || error)}` };
    }
  }

  /**
   * HBuilderX version and per-platform SDK readiness, straight from the engine's
   * `sdk status`: the same bash code that recommends a download entry is the one
   * that later finds the SDK again, so the panel only renders its JSON.
   */
  let sdkCache = null;
  async function sdkStatusOf(home) {
    const stamp = [ 'sdk', 'config/settings.env' ].map((rel) => dirStamp(path.join(home, rel))).join('|');
    if (sdkCache && sdkCache.home === home && sdkCache.stamp === stamp) return sdkCache.value;

    const shell = shellAvailable();
    if (!shell.available) return { error: `当前系统上无法运行 bash 引擎：${shell.error}` };
    let result;
    try {
      result = await spawn(home, ['sdk', 'status'], { stdio: 'pipe', timeoutMs: 60_000, searchRoots: config.searchRoots, shell: shell.shell });
    } catch (error) {
      return { error: `无法读取 SDK 状态：${String(error?.message || error)}` };
    }
    if (result.code !== 0) {
      return { error: String(result.stderr || result.stdout || `sdk status 退出码 ${result.code}`).trim() };
    }
    try {
      const value = JSON.parse(String(result.stdout || '').trim() || '{}');
      sdkCache = { home, stamp, value };
      return value;
    } catch (error) {
      return { error: `无法解析 sdk status 输出：${String(error?.message || error)}` };
    }
  }

  /** Defaults the panel mirrors from config/settings.env (the engine still owns them). */
  function optionsOf(home) {
    let env = {};
    try {
      env = parseEnvFile(path.join(home, 'config', 'settings.env'));
    } catch {
      /* no settings yet: fall back to the engine's own defaults below */
    }
    return { fullPermission: isOn(env.FULL_PERMISSION_PROFILE, true) };
  }

  /**
   * The keys the engine accepts as `--set` overrides, read from the engine itself
   * so the panel can filter project presets without duplicating the list.
   */
  async function overrideKeysOf(home) {
    try {
      const text = fs.readFileSync(path.join(home, 'lib', 'common.sh'), 'utf8');
      const match = text.match(/^PACKAGE_ENV_OVERRIDE_KEYS="([^"]*)"/m);
      return match ? match[1].trim().split(/\s+/).filter(Boolean) : null;
    } catch {
      return null;
    }
  }

  return {
    runner,
    homeOf,

    async state() {
      const home = homeOf();
      const projects = projectsOf(home);
      const uploaders = uploadersOf(home);
      const profiles = await profilesOf(home);
      const sdk = await sdkStatusOf(home);
      const root = pluginRoot(moduleUrl, env);
      const list = Array.isArray(projects) ? projects : [];
      // The home holds a copy of the engine: report the version actually on
      // disk so the panel can flag a stale copy instead of claiming "ready".
      const engineVersion = packageVersion();
      const materialized = isMaterialized(home);
      const homeVersion = materialized ? materializedVersion(home) || '' : '';
      return {
        home,
        // The engine home lives inside the plugin; show it so the download
        // directory is never a mystery (plus any one-time migration notice).
        plugin: { root, home, notices: homeNotices },
        engineVersion,
        materialized,
        homeVersion,
        engineDrift: materialized && homeVersion !== engineVersion,
        shell: shellAvailable(),
        projects: list,
        projectsError: Array.isArray(projects) ? '' : projects.error,
        uploaders: Array.isArray(uploaders) ? uploaders : [],
        uploadersError: Array.isArray(uploaders) ? '' : uploaders.error,
        profiles: Array.isArray(profiles) ? profiles : [],
        profilesError: Array.isArray(profiles) ? '' : profiles.error,
        options: optionsOf(home),
        overrideKeys: await overrideKeysOf(home),
        sdk: sdk && !sdk.error ? sdk : null,
        sdkError: sdk && sdk.error ? sdk.error : '',
        canUpgrade: Boolean(root),
        // The project's own packaging env files, offered as `--set` presets.
        presets: Object.fromEntries(list.map((project) => [project.id, presetsOf(project.sourceDir)])),
        jobs: runner.list(),
      };
    },

    init({ force = false } = {}) {
      const home = homeOf();
      const result = materialize(home, { force: Boolean(force) });
      return { home, force: Boolean(force), ...result, materialized: isMaterialized(home) };
    },

    doctor({ platform = 'all' } = {}) {
      const home = homeOf();
      // No-op while the home already carries the current engine; otherwise this
      // refreshes the scripts a plugin upgrade left behind (user data stays).
      materialize(home);
      const report = runDoctor({ home, platform });
      return {
        ok: report.ok,
        home: report.home,
        platform: report.platform,
        platformName: report.platformName,
        failures: report.failures,
        warnings: report.warnings,
        checks: report.checks.map(({ id, label, status, detail, hint }) => ({ id, label, status, detail, hint })),
      };
    },

    /** Start a `check` / `build` / `sdk` / `upgrade` run; returns the job record. */
    startJob(spec = {}) {
      const home = homeOf();
      // No-op while the home already carries the current engine; otherwise this
      // refreshes the scripts a plugin upgrade left behind (user data stays).
      materialize(home);
      const shell = shellAvailable();
      if (!shell.available) {
        throw new Error(`当前系统上无法运行 bash 引擎：${shell.error}\nWindows 请安装 Git for Windows（推荐）或启用 WSL。`);
      }

      // 一键配置 SDK：按 HBuilderX 版本下载官方 iOS/Android SDK 并归位、ohpm 装
      // HarmonyOS runtime，或处理已经下载到 sdk/ 的压缩包。每个平台一次引擎调用。
      if (spec.kind === 'sdk') {
        const platforms = sdkPlatforms(spec);
        const commands = spec.processOnly === true
          ? [['sdk', 'process']]
          : platforms.map((platform) => ['sdk', 'install', platform, '--yes']);
        if (spec.process === true && spec.processOnly !== true) commands.push(['sdk', 'process']);
        return runner.start({
          kind: 'sdk',
          platform: platforms.join(','),
          home,
          commands,
          timeoutMs: config.sdkTimeoutMs || 3_600_000,
          searchRoots: config.searchRoots,
          shell: shell.shell,
        });
      }

      // 升级插件：home 在插件目录内，升级前先把它暂存到插件旁边、升级完再移回
      // （upgrade.mjs），所以已下载的 SDK / 证书 / 项目配置都不会丢。
      if (spec.kind === 'upgrade') {
        const root = pluginRoot(moduleUrl, env);
        if (!root) {
          throw new Error('当前代码不在 DSH 插件目录内，无法自动升级。请执行：dsh plugin --profile <profile> add dsh-app-packager@latest');
        }
        return runner.start({
          kind: 'upgrade',
          home,
          commands: [['upgrade']],
          node: { script: path.join(root, 'upgrade.mjs'), args: [], cwd: root },
          timeoutMs: config.upgradeTimeoutMs || 1_800_000,
        });
      }

      const kind = spec.kind === 'check' ? 'check' : 'build';
      const platforms = scopePlatforms(spec);
      const commands = engineCommandsFor(spec, { check: kind === 'check' });
      // Builds are gated on the same scope passing `check` first (the panel's
      // "fix the environment, then package" flow). `skipCheck` is the explicit
      // escape hatch for a caller that just checked.
      const precheck =
        kind === 'build' && spec.skipCheck !== true
          ? { commands: engineCommandsFor(spec, { check: true }), timeoutMs: config.checkTimeoutMs || 600_000 }
          : null;
      return runner.start({
        kind,
        platform: platforms.join(','),
        project: scopeProjects(spec).join(','),
        home,
        commands,
        precheck,
        timeoutMs: kind === 'check' ? config.checkTimeoutMs || 600_000 : config.buildTimeoutMs || 5_400_000,
        searchRoots: config.searchRoots,
        shell: shell.shell,
      });
    },

    jobLog(id) {
      const job = runner.get(id);
      if (!job) throw new Error(`未知任务：${id}`);
      return job;
    },

    /** Host-side folder dialog; never throws for a plain cancel. */
    pickFolder(options) {
      return pick(options);
    },

    /**
     * Register project directories by calling the engine's own `register`
     * subcommand, so the written config/projects/<id>.env is byte-identical to
     * what the interactive wizard produces. With a parent directory the engine
     * scans one level below it. `dir` may hold several paths (newline or comma
     * separated) — the engine takes them all in one call.
     */
    async addProject({ dir } = {}) {
      const dirs = String(dir || '')
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (dirs.length === 0) throw new Error('请先选择或输入项目目录');
      const home = homeOf();
      // No-op while the home already carries the current engine; otherwise this
      // refreshes the scripts a plugin upgrade left behind (user data stays).
      materialize(home);
      const shell = shellAvailable();
      if (!shell.available) throw new Error(`当前系统上无法运行 bash 引擎：${shell.error}`);
      const result = await spawn(home, ['register', ...dirs], {
        stdio: 'pipe',
        searchRoots: config.searchRoots,
        timeoutMs: 120_000,
      });
      const projects = projectsOf(home);
      return {
        dirs,
        code: result.code,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        projects: Array.isArray(projects) ? projects : [],
        projectsError: Array.isArray(projects) ? '' : projects.error,
      };
    },

    /**
     * Forget a registered project: it is one file the engine itself wrote
     * (`config/projects/<id>.env`), and the user's project on disk is never
     * touched. The id must be one the engine just listed, so a stray value
     * cannot escape the config directory.
     */
    removeProject({ id } = {}) {
      const target = String(id || '').trim();
      const home = homeOf();
      const projects = projectsOf(home);
      if (!Array.isArray(projects)) throw new Error(projects.error);
      if (!projects.some((project) => project.id === target)) throw new Error(`未登记的项目：${target}`);
      fs.rmSync(path.join(home, 'config', 'projects', `${target}.env`));
      const after = projectsOf(home);
      return { id: target, projects: Array.isArray(after) ? after : [], projectsError: Array.isArray(after) ? '' : after.error };
    },

    killJob(id) {
      return runner.kill(id);
    },

    /** Forget settled jobs so the panel's job card can go back to 「暂无任务」. */
    clearJobs() {
      return runner.clear();
    },
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function queryOf(req) {
  try {
    return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
  } catch {
    return {};
  }
}

/**
 * Register the panel routes on the harness HTTP server.
 *
 * @param {object} ctx cordis context (needs a `webServer` service).
 * @param {object} [config] bundle patch config.
 * @returns {(() => void) | null} disposer, or null when no web server is up yet.
 */
export function mountWebPanel(ctx, config = {}) {
  // `ctx.get` reads a service without the inject requirement; touching
  // `ctx.webServer` from a plugin that does not inject it throws
  // ("cannot get property \"webServer\" without inject"), so never do that here.
  const webServer = ctx?.get?.('webServer');
  if (!webServer || typeof webServer.register !== 'function') return null;

  const panel = createPanel({ config });
  const routes = [
    { path: `${ROUTE_BASE}/state`, run: () => panel.state() },
    { path: `${ROUTE_BASE}/init`, run: (_body, _query) => panel.init(_body) },
    { path: `${ROUTE_BASE}/doctor`, run: (_body) => panel.doctor(_body) },
    { path: `${ROUTE_BASE}/pick`, run: () => panel.pickFolder() },
    { path: `${ROUTE_BASE}/project`, run: (body) => panel.addProject(body) },
    { path: `${ROUTE_BASE}/project/remove`, run: (body) => panel.removeProject(body) },
    { path: `${ROUTE_BASE}/job`, run: (_body) => panel.startJob(_body) },
    { path: `${ROUTE_BASE}/job/log`, run: (_body, query) => panel.jobLog(query.id) },
    { path: `${ROUTE_BASE}/job/kill`, run: (_body, query) => panel.killJob(query.id) },
    { path: `${ROUTE_BASE}/job/clear`, run: () => panel.clearJobs() },
  ];

  const disposers = [];
  for (const route of routes) {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: route.path,
        handler: async (req, res) => {
          try {
            const payload = await route.run(await readJson(req), queryOf(req));
            sendJson(res, 200, payload);
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message || error) });
          }
        },
      }),
    );
  }
  return () => {
    for (const dispose of disposers.splice(0)) dispose?.();
  };
}
