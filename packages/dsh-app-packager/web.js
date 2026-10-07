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
import {
  PLATFORM_LABELS,
  isMaterialized,
  listProjects,
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

/**
 * Build the engine CLI argument list: `打包工具.command [check] <平台> [项目] [选项]`.
 *
 * `check` is an engine subcommand, not a flag, so it must come first; passing a
 * bare platform would ask the engine for a full build instead of a check.
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
  if (check) return out;
  if (args.upload) out.push('--upload', String(args.upload));
  if (args.noUpload) out.push('--no-upload');
  if (args.version) out.push('--version', String(args.version));
  if (args.harmonyDebug) out.push('--harmony-debug');
  if (args.keepWork) out.push('--keep-work');
  return out;
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
     * @param {object} spec `{kind, platform, project, home, args, timeoutMs, searchRoots, shell}`
     */
    start(spec) {
      const job = {
        id: `job-${++seq}`,
        kind: spec.kind,
        platform: String(spec.platform || 'all'),
        project: String(spec.project || ''),
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

      spawn(spec.home, spec.args, {
        stdio: 'pipe',
        stdin: 'ignore',
        timeoutMs: spec.timeoutMs,
        searchRoots: spec.searchRoots,
        shell: spec.shell,
        onSpawn: (child) => {
          job.child = child;
        },
        onLine: (line) => append(job, `${line}\n`),
      })
        .then((result) => {
          if (result.stdout) append(job, result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
          if (result.stderr) append(job, result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
          job.code = result.code;
          job.signal = result.signal;
          job.ok = result.code === 0 && !/\[FAIL\]/.test(job.output);
        })
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
export function createPanel({ config = {}, spawn = runEngine, limit, outputLimit } = {}) {
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

  return {
    runner,
    homeOf,

    state() {
      const home = homeOf();
      const projects = projectsOf(home);
      return {
        home,
        engineVersion: packageVersion(),
        materialized: isMaterialized(home),
        shell: shellAvailable(),
        projects: Array.isArray(projects) ? projects : [],
        projectsError: Array.isArray(projects) ? '' : projects.error,
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
      const args = engineArgsFor(spec, { check: kind === 'check' });
      const home = homeOf();
      if (!isMaterialized(home)) materialize(home);
      const shell = shellAvailable();
      if (!shell.available) {
        throw new Error(`当前系统上无法运行 bash 引擎：${shell.error}\nWindows 请安装 Git for Windows（推荐）或启用 WSL。`);
      }
      return runner.start({
        kind,
        platform: spec.platform,
        project: spec.project,
        home,
        args,
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
