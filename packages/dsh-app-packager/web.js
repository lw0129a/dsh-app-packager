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
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PLATFORM_LABELS,
  isMaterialized,
  listProjects,
  listUploaders,
  materialize,
  packageVersion,
  resolveHome,
  runDoctor,
  runEngine,
  shellAvailable,
} from 'app-packager';

export const ROUTE_BASE = '/api/app-packager';
export const PLATFORM_VALUES = ['ios', 'android', 'harmony', 'all'];

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
 * @param {{platform?: string, project?: string, upload?: string, noUpload?: boolean,
 *   version?: string, harmonyDebug?: boolean, keepWork?: boolean}} args
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
  if (check) return out;
  if (args.upload) out.push('--upload', String(args.upload));
  if (args.noUpload) out.push('--no-upload');
  if (args.version) out.push('--version', String(args.version));
  if (args.harmonyDebug) out.push('--harmony-debug');
  if (args.keepWork) out.push('--keep-work');
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
 * Ask the host OS for a folder. The browser half cannot read the filesystem, so
 * the dialog has to run here; each platform's own picker is used instead of a
 * dependency, and a missing picker only means "type the path yourself".
 *
 * @param {{prompt?: string}} [options]
 * @returns {Promise<{path: string, cancelled?: boolean, error?: string}>}
 */
export async function pickFolder({ prompt = FOLDER_PROMPT } = {}) {
  const run = async (file, args) => (await execFileAsync(file, args, { windowsHide: true })).stdout.trim();
  let script;
  try {
    if (process.platform === 'darwin') {
      script = `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`;
      return { path: await run('osascript', ['-e', script]) };
    }
    if (process.platform === 'win32') {
      script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${JSON.stringify(prompt)}; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }`;
      return { path: await run('powershell', ['-NoProfile', '-STA', '-Command', script]) };
    }
    return { path: await run('zenity', ['--file-selection', '--directory', `--title=${prompt}`]) };
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    // Cancelling exits non-zero everywhere ("User canceled" / -128 / 1); only a
    // picker that does not exist at all is worth showing as an error.
    const cancelled = error?.code === 1 || /-128|user cancel|用户取消/i.test(detail);
    return { path: '', cancelled, error: cancelled ? '' : detail };
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
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    dropped: job.dropped,
    output: job.output,
    summary: summarizeOutput(job.output),
  };
}

/**
 * In-memory job registry for the panel: at most `limit` runs are kept (the
 * oldest *finished* one is evicted first) and each log is capped at `outputLimit`.
 *
 * @param {{spawn?: typeof runEngine, limit?: number, outputLimit?: number}} [options]
 */
export function createJobRunner({ spawn = runEngine, limit = JOB_LIMIT, outputLimit = OUTPUT_LIMIT } = {}) {
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
        for (const [index, argv] of commands.entries()) {
          if (job.cancelled) break;
          if (commands.length > 1) append(job, `▶ ${index + 1}/${commands.length}  ${argv.join(' ')}\n`);
          const result = await spawn(spec.home, argv, options);
          if (result.stdout) append(job, result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
          if (result.stderr) append(job, result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
          if (result.code !== 0 && job.code === null) {
            job.code = result.code;
            job.signal = result.signal;
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
export function createPanel({ config = {}, spawn = runEngine, pick = pickFolder, limit, outputLimit } = {}) {
  const runner = createJobRunner({ spawn, limit, outputLimit });
  const homeOf = () => resolveHome(config.home || '');

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

  return {
    runner,
    homeOf,

    state() {
      const home = homeOf();
      const projects = projectsOf(home);
      const uploaders = uploadersOf(home);
      return {
        home,
        engineVersion: packageVersion(),
        materialized: isMaterialized(home),
        shell: shellAvailable(),
        projects: Array.isArray(projects) ? projects : [],
        projectsError: Array.isArray(projects) ? '' : projects.error,
        uploaders: Array.isArray(uploaders) ? uploaders : [],
        uploadersError: Array.isArray(uploaders) ? '' : uploaders.error,
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
      if (!isMaterialized(home)) materialize(home);
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

    /** Start a `check` or `build` engine run; returns the job record. */
    startJob(spec = {}) {
      const kind = spec.kind === 'check' ? 'check' : 'build';
      const platforms = scopePlatforms(spec);
      const commands = engineCommandsFor(spec, { check: kind === 'check' });
      const home = homeOf();
      if (!isMaterialized(home)) materialize(home);
      const shell = shellAvailable();
      if (!shell.available) {
        throw new Error(`当前系统上无法运行 bash 引擎：${shell.error}\nWindows 请安装 Git for Windows（推荐）或启用 WSL。`);
      }
      return runner.start({
        kind,
        platform: platforms.join(','),
        project: scopeProjects(spec).join(','),
        home,
        commands,
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
     * Register one project directory by calling the engine's own `register`
     * subcommand, so the written config/projects/<id>.env is byte-identical to
     * what the interactive wizard produces. With a parent directory the engine
     * scans one level below it.
     */
    async addProject({ dir } = {}) {
      const target = String(dir || '').trim();
      if (!target) throw new Error('请先选择或输入项目目录');
      const home = homeOf();
      if (!isMaterialized(home)) materialize(home);
      const shell = shellAvailable();
      if (!shell.available) throw new Error(`当前系统上无法运行 bash 引擎：${shell.error}`);
      const result = await spawn(home, ['register', target], {
        stdio: 'pipe',
        searchRoots: config.searchRoots,
        timeoutMs: 120_000,
      });
      const projects = projectsOf(home);
      return {
        dir: target,
        code: result.code,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        projects: Array.isArray(projects) ? projects : [],
        projectsError: Array.isArray(projects) ? '' : projects.error,
      };
    },

    killJob(id) {
      return runner.kill(id);
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
    { path: `${ROUTE_BASE}/job`, run: (_body) => panel.startJob(_body) },
    { path: `${ROUTE_BASE}/job/log`, run: (_body, query) => panel.jobLog(query.id) },
    { path: `${ROUTE_BASE}/job/kill`, run: (_body, query) => panel.killJob(query.id) },
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
