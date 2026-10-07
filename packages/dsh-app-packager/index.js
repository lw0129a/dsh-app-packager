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
 * @module dsh-app-packager
 */
import {
  PLATFORM_LABELS,
  listProjects,
  materialize,
  isMaterialized,
  packageVersion,
  runDoctor,
  runEngine,
  shellAvailable,
} from 'app-packager';
import { PACKAGE_KINDS, PLATFORM_VALUES, engineArgsFor, mountWebPanel, summarizeOutput } from './web.js';
import { resolvePluginHome } from './index.mjs';

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

/** Trim a captured stream to its tail, so one huge build log cannot flood a turn. */
function tail(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `…（省略前 ${value.length - limit} 字符）\n${value.slice(-limit)}`;
}

/**
 * The engine home for this call: tool argument, then config, then the plugin's
 * own `home/` directory (with a one-time move of an older ~/AppPackager).
 */
function homeFor(config, args) {
  return resolvePluginHome(args.home || config.home || '', { moduleUrl: import.meta.url });
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

/** Run the engine once, after validating the arguments and the shell bridge. */
async function driveEngine(config, args, timeoutMs, options = {}) {
  // Validate arguments before touching the disk: a bad platform must not
  // materialize an engine home as a side effect.
  const engineArgs = engineArgsFor(args, options);
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
    lines.push('把 uni-app x 项目放到引擎同级目录，或运行 `npx app-packager init` 打开初始化向导。');
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
  if (value.blockedByCheck) lines.push('', '打包前环境检查未通过：先按上面的 [FAIL] 提示处理，再重新打包。');
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
  // `output.schema` is validated as a real JSON Schema by ctx.tools.register
  // (assertSupportedJsonSchema): `{ type: 'json' }` is rejected and takes the
  // whole entry down with it, tools and panel alike.
  const output = (render) => ({ schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: render(value) }] });
  const homeParam = { type: 'string', description: 'AppPackager 引擎目录（默认 ~/AppPackager，或 APP_PACKAGER_HOME 环境变量）' };
  // Both engine actions accept these: `check` is the dry run of exactly the same
  // option set, so the model can pre-flight a release wiring change.
  const optionParams = {
    fullPermission: { type: 'boolean', description: '是否合入全量权限与首次启动权限申请；省略则跟随 config/settings.env 的 FULL_PERMISSION_PROFILE' },
    packageKind: {
      type: 'string',
      enum: PACKAGE_KINDS,
      description: 'iOS 发布形态：adhoc 测试包 / appstore 正式包 / development 开发 / enterprise 企业；按 Bundle ID 自动选描述文件（仅 iOS 生效）',
    },
    profile: { type: 'string', description: '显式指定 .mobileprovision 路径（覆盖按发布形态自动选择；与 packageKind 类型不符会报错）' },
    set: {
      type: 'array',
      items: { type: 'string' },
      description: '覆盖打包参数，每项 KEY=VALUE，例如 MARKETING_VERSION=1.2.3；可覆盖 APP_NAME/BUNDLE_ID/TEAM_ID/EXPORT_METHOD/PACKAGE_KIND/SCHEME/CONFIGURATION/MARKETING_VERSION 等，路径类键不允许',
    },
  };

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
    description: 'Run the AppPackager environment check for one platform (signing certificates, SDK dirs, HBuilderX CLI) and return its report. Carries the same build options as app_packager_build, so it doubles as a dry run of a release/test wiring change.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORM_VALUES, description: '平台，默认 all' },
        project: { type: 'string', description: '项目 ID（config/projects/<id>.env），省略则检查该平台全部已启用项目（引擎侧 --all）' },
        ...optionParams,
        home: homeParam,
      },
      additionalProperties: false,
    },
    output: output((value) => renderEngineRun(value)),
    async execute(args) {
      const platform = String(args.platform || 'all');
      // `check` is an engine subcommand: without the flag this would start a build.
      const { home, result } = await driveEngine(config, { ...args, platform }, config.checkTimeoutMs, { check: true });
      return { ...engineRunValue(config, home, result), summary: `${platform} 打包环境检查` };
    },
  });

  ctx.tools.register({
    name: 'app_packager_build',
    description: 'Build an AppPackager package (IPA / APK / HAP) for one platform or all platforms, optionally uploading to pgyer and overriding the version. Can also pick the iOS release kind (test Ad Hoc vs App Store), an explicit signing profile, whether the full permission set is merged in, and KEY=VALUE build parameter overrides. Takes minutes; it first runs the environment check over the same projects and platforms and refuses to package when that check reports [FAIL], so fix those items and build again (skipCheck: true skips the check for a caller that just ran it).',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORM_VALUES, description: 'ios | android | harmony | all' },
        project: { type: 'string', description: '项目 ID；省略表示该平台全部已启用项目（platform=all 时就是全部项目，引擎侧 --all）' },
        upload: { type: 'string', description: '打包后上传的平台，例如 pgyer；多个用逗号分隔（pgyer,huawei），以宿主 config/upload.env 中 ENABLED=true 且已实现的平台为准' },
        noUpload: { type: 'boolean', description: '跳过上传' },
        version: { type: 'string', description: '覆盖产物版本号' },
        harmonyDebug: { type: 'boolean', description: 'HarmonyOS 生成 debug 侧载包' },
        keepWork: { type: 'boolean', description: '保留中间构建目录' },
        ...optionParams,
        skipCheck: { type: 'boolean', description: '跳过打包前的环境检查（默认会先按同一组项目与平台跑一次 check，不通过就不打包）' },
        home: homeParam,
      },
      additionalProperties: false,
      required: ['platform'],
    },
    output: output((value) => renderEngineRun(value)),
    async execute(args) {
      const platform = String(args.platform || '');
      // Same gate as the panel: the build only starts once the identical scope
      // passes `check`, so an unready environment is reported as such instead of
      // being buried under minutes of build output. `skipCheck` is for a caller
      // that has just checked.
      if (args.skipCheck !== true) {
        const pre = await driveEngine(config, { ...args, platform }, config.checkTimeoutMs, { check: true });
        if (!verdictOf(pre.result)) {
          const summary = summarizeOutput(pre.result.stdout || '');
          return {
            ...engineRunValue(config, pre.home, pre.result),
            summary: `${platform} 打包前环境检查未通过（已跳过打包，${summary.failures.length} 项 FAIL）`,
            blockedByCheck: true,
          };
        }
      }
      const { home, result } = await driveEngine(config, args, config.buildTimeoutMs);
      return { ...engineRunValue(config, home, result), summary: `${platform} 打包` };
    },
  });

  mountPanelWhenReady(ctx, config);
}

/**
 * Mount the GUI panel as soon as a web server exists.
 *
 * `webServer` is deliberately not an `inject` entry: cordis has no optional
 * inject, so a hard dependency would keep the four tools unloaded in a headless
 * profile. `ctx.inject(deps, cb)` runs the callback immediately when the service
 * is already there and otherwise waits for it (cordis lib/index.js:1600).
 */
function mountPanelWhenReady(ctx, config) {
  if (mountWebPanel(ctx, config)) return;
  ctx.inject?.(['webServer'], (panelCtx) => {
    mountWebPanel(panelCtx, config);
  });
}
