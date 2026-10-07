/**
 * AppPackager tools for DeepSeek Harness — host half of the bundle.
 *
 * Wraps the bundled AppPackager engine: `app_packager_list` and
 * `app_packager_doctor` answer from Node alone (so they also work on Windows,
 * where the bash engine cannot run yet), while `app_packager_check` and
 * `app_packager_build` drive the engine through the platform shell bridge
 * (macOS/Linux bash, or Git Bash / WSL on Windows).
 *
 * Tool definitions are registered through the public `ctx.tools.register`
 * contract with plain JSON Schema parameters, so the plugin carries no build
 * step and no harness-package import beyond the optional Config schema.
 *
 * @module @lw0129a/dsh-app-packager
 */
import {
  PLATFORM_LABELS,
  listProjects,
  materialize,
  isMaterialized,
  packageVersion,
  resolveHome,
  runDoctor,
  runEngine,
  shellAvailable,
} from '@lw0129a/app-packager';

export const name = 'app-packager';

/** Without the tool registry the plugin stays inactive instead of throwing. */
export const inject = ['tools'];

/** Optional: only used to validate/complete the bundle patch config. */
let Config;
try {
  const z = (await import('@deepseek-ai/schemastery')).default;
  Config = z.object({
    home: z.string().default(''),
    searchRoots: z.array(z.string()).default([]),
    checkTimeoutMs: z.number().default(600000),
    buildTimeoutMs: z.number().default(5400000),
    outputLimit: z.number().default(12000),
  });
  // `undefined` would fail the loader's schema check.
} catch {
  /* schemastery is missing (bare `node` run, tests): config falls back to defaults. */
}
export { Config };

const DEFAULT_CONFIG = {
  home: '',
  searchRoots: [],
  checkTimeoutMs: 600000,
  buildTimeoutMs: 5400000,
  outputLimit: 12000,
};

const PLATFORM_VALUES = ['ios', 'android', 'harmony', 'all'];

/** Trim a captured stream to its tail, so one huge build log cannot flood a turn. */
function tail(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `…（省略前 ${value.length - limit} 字符）\n${value.slice(-limit)}`;
}

/** The engine home for this call: tool argument, then config, then env/default. */
function homeFor(config, args) {
  return resolveHome(args.home || config.home || '');
}

/** Materialize the engine on first use so a fresh install needs no extra step. */
function ensureReady(home) {
  if (isMaterialized(home)) return { ready: true, materialized: false };
  const result = materialize(home);
  return { ready: true, materialized: true, copied: result.copied };
}

function requireShell(home) {
  const shell = shellAvailable();
  if (!shell.available) {
    const error = new Error(
      `当前系统上无法运行 bash 引擎：${shell.error}\n` +
        `macOS/Linux 自带 bash；Windows 请安装 Git for Windows（推荐）或启用 WSL。\n` +
        `引擎目录：${home}`,
    );
    error.name = 'ShellUnavailableError';
    throw error;
  }
  return shell.shell;
}

/** Build the engine CLI argument list (`打包工具.command <平台> [项目] [选项]`). */
function engineArgsFor(args) {
  const platform = String(args.platform || '').toLowerCase();
  if (!PLATFORM_VALUES.includes(platform)) {
    throw new Error(`platform 必须是 ${PLATFORM_VALUES.join(' | ')}，收到 ${JSON.stringify(args.platform)}`);
  }
  const out = [platform];
  if (args.project) out.push(String(args.project));
  if (args.upload) out.push('--upload', String(args.upload));
  if (args.noUpload) out.push('--no-upload');
  if (args.version) out.push('--version', String(args.version));
  if (args.harmonyDebug) out.push('--harmony-debug');
  if (args.keepWork) out.push('--keep-work');
  return out;
}

async function driveEngine(config, args, timeoutMs) {
  // Validate arguments before touching the disk: a bad platform must not
  // materialize an engine home as a side effect.
  const engineArgs = engineArgsFor(args);
  const home = homeFor(config, args);
  ensureReady(home);
  const shell = requireShell(home);
  const result = await runEngine(home, engineArgs, {
    stdio: 'pipe',
    stdin: 'ignore',
    searchRoots: args.searchRoots || config.searchRoots,
    timeoutMs,
    shell,
  });
  return { home, result };
}

/** Parse the engine's `[OK]/[FAIL]` check output into a verdict. */
function verdictOf(result) {
  const ok = result.code === 0 && !/\[FAIL\]/.test(result.stdout);
  return ok;
}

function renderList(value) {
  const lines = [`AppPackager 引擎目录：${value.home}`, `引擎版本：${value.engineVersion}`];
  if (value.projects.length === 0) {
    lines.push('未发现项目配置 config/projects/*.env。');
    lines.push('把 uni-app x 项目放到引擎同级目录，或运行 `npx @lw0129a/app-packager init` 打开初始化向导。');
    return lines.join('\n');
  }
  lines.push(`项目（${value.projects.length}）:`);
  for (const project of value.projects) {
    const platforms = project.enabledPlatforms.map((key) => PLATFORM_LABELS[key] || key).join(', ') || '未启用任何平台';
    lines.push(`- ${project.id}${project.appName ? `（${project.appName}）` : ''}`);
    lines.push(`  平台: ${platforms}`);
    lines.push(`  源码: ${project.sourceDir || '(未配置)'}${project.sourceDir && !project.sourceDirExists ? ' —— 目录不存在' : ''}`);
    if (project.error) lines.push(`  读取错误: ${project.error}`);
  }
  return lines.join('\n');
}

function renderDoctor(value) {
  const lines = [`环境检查 — ${value.platformName}`, `引擎目录：${value.home}`, ''];
  for (const check of value.checks) {
    const mark = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '✗';
    lines.push(`${mark} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
    if (check.hint) lines.push(`    → ${check.hint}`);
  }
  lines.push('');
  lines.push(value.ok ? '结论：当前环境可以打包。' : `结论：${value.failures} 项失败、${value.warnings} 项警告。`);
  return lines.join('\n');
}

function renderEngineRun(value) {
  const lines = [
    value.ok ? `✓ ${value.summary}` : `✗ ${value.summary}`,
    `退出码：${value.code}${value.signal ? `（信号 ${value.signal}）` : ''}`,
    `引擎目录：${value.home}`,
  ];
  if (value.stderr) lines.push('', 'stderr:', value.stderr);
  if (value.output) lines.push('', '输出:', value.output);
  return lines.join('\n');
}

function engineRunValue(config, home, result) {
  return {
    ok: verdictOf(result),
    code: result.code,
    signal: result.signal,
    home,
    shell: result.shellKind,
    stderr: tail(result.stderr, Math.min(4000, config.outputLimit)),
    output: tail(result.stdout, config.outputLimit),
  };
}

/**
 * @param {object} ctx harness context (needs `tools`).
 * @param {object} [rawConfig] bundle patch config.
 */
export function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...rawConfig };
  const output = (render) => ({ schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: render(value) }] });
  const homeParam = { type: 'string', description: 'AppPackager 引擎目录（默认 ~/AppPackager，或 APP_PACKAGER_HOME 环境变量）' };

  ctx.tools.register({
    name: 'app_packager_list',
    description: 'List the uni-app x projects configured for AppPackager, with their enabled build platforms.',
    parameters: { type: 'object', properties: { home: homeParam }, additionalProperties: false },
    output: output(renderList),
    async execute(args) {
      const home = homeFor(config, args);
      const ready = ensureReady(home);
      return {
        home,
        engineVersion: packageVersion(),
        materialized: ready.materialized,
        projects: listProjects(home).map((project) => ({
          id: project.id,
          appName: project.appName,
          sourceDir: project.sourceDir,
          sourceDirExists: project.sourceDirExists,
          bundleId: project.bundleId,
          enabledPlatforms: project.enabledPlatforms,
          error: project.error,
        })),
      };
    },
  });

  ctx.tools.register({
    name: 'app_packager_doctor',
    description: 'Check whether this machine can build iOS, Android and HarmonyOS packages (Node, shell bridge, Xcode, HBuilderX, JDK, Android SDK, DevEco Studio, project config).',
    parameters: {
      type: 'object',
      properties: {
        home: homeParam,
        platform: { type: 'string', enum: PLATFORM_VALUES, description: '只检查某个平台，默认 all' },
      },
      additionalProperties: false,
    },
    output: output(renderDoctor),
    async execute(args) {
      const home = homeFor(config, args);
      ensureReady(home);
      const report = runDoctor({ home, platform: args.platform || 'all' });
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
  });

  ctx.tools.register({
    name: 'app_packager_check',
    description: 'Run the AppPackager environment check for one platform (signing certificates, SDK dirs, HBuilderX CLI) and return its report.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORM_VALUES, description: '平台，默认 all', required: false },
        project: { type: 'string', description: '项目 ID（config/projects/<id>.env），省略则检查全部项目' },
        home: homeParam,
      },
      additionalProperties: false,
    },
    output: output((value) => renderEngineRun(value)),
    async execute(args) {
      const platform = String(args.platform || 'all');
      const { home, result } = await driveEngine(config, { ...args, platform }, config.checkTimeoutMs);
      return { ...engineRunValue(config, home, result), summary: `${platform} 打包环境检查` };
    },
  });

  ctx.tools.register({
    name: 'app_packager_build',
    description: 'Build an AppPackager package (IPA / APK / HAP) for one platform or all platforms, optionally uploading to pgyer and overriding the version. Takes minutes; call app_packager_check first when unsure.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORM_VALUES, description: 'ios | android | harmony | all', required: true },
        project: { type: 'string', description: '项目 ID；platform=all 时可省略，表示全部项目' },
        upload: { type: 'string', description: '打包后上传的平台，例如 pgyer' },
        noUpload: { type: 'boolean', description: '跳过上传' },
        version: { type: 'string', description: '覆盖产物版本号' },
        harmonyDebug: { type: 'boolean', description: 'HarmonyOS 生成 debug 侧载包' },
        keepWork: { type: 'boolean', description: '保留中间构建目录' },
        home: homeParam,
      },
      additionalProperties: false,
    },
    output: output((value) => renderEngineRun(value)),
    async execute(args) {
      const platform = String(args.platform || '');
      const { home, result } = await driveEngine(config, args, config.buildTimeoutMs);
      return { ...engineRunValue(config, home, result), summary: `${platform} 打包` };
    },
  });
}
