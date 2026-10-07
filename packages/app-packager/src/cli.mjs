/**
 * `app-packager` — the cross-platform front door.
 *
 * Commands that only read local files (list, doctor, env) run in Node and
 * therefore work on Windows too. Commands that must actually build (build,
 * check, init --wizard) hand over to the bash engine through the Git-Bash/WSL
 * bridge.
 */
import path from 'node:path';
import { ENGINE_WIZARD, engineEntryPath, isMaterialized, materialize, packageVersion, resolveHome } from './home.mjs';
import { runEngine, shellAvailable } from './engine.mjs';
import { listProjects, PLATFORMS } from './projects.mjs';
import { runDoctor } from './doctor.mjs';

const MARKS = { ok: '✓', warn: '!', fail: '✗' };

const HELP = `AppPackager ${packageVersion()} — uni-app x 打包命令行

用法:
  app-packager <命令> [参数...]

命令:
  init                 复制打包引擎到 APP_PACKAGER_HOME，并运行初始化向导
  doctor [--platform]  检查当前机器能构建哪些平台（默认全部）
  list                 列出已配置的项目
  check <平台> [项目]  调用引擎检查打包环境
  build <平台> [项目]  调用引擎执行打包（平台: ios | android | harmony | all）
  run <引擎参数...>    原样透传给引擎（等价于 打包工具.command 的命令行模式）
  env                  打印引擎目录与解析结果
  version              打印版本

常用选项:
  --dir <路径>         指定 APP_PACKAGER_HOME（默认 ~/AppPackager，可用环境变量 APP_PACKAGER_HOME）
  --json               机器可读输出（doctor / list / env）
  --search-roots <路径> 额外指定 uni-app x 项目扫描目录（多个用 ${path.delimiter} 分隔）
  --upload <平台>      打包后上传，例如 --upload pgyer
  --no-upload          跳过上传
  --version <版本号>   覆盖产物版本号
  --harmony-debug      生成 HarmonyOS debug 侧载包
  --force              与 init 连用：强制刷新引擎脚本
  --no-wizard          与 init 连用：只复制引擎，不进入初始化向导

示例:
  app-packager init
  app-packager doctor --platform android
  app-packager list
  app-packager build android my-project --upload pgyer
  app-packager build ios --all
`;

function parseArgs(argv) {
  const flags = { _: [] };
  const takesValue = new Set(['--dir', '--platform', '--search-roots', '--upload', '--version']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (takesValue.has(token)) {
      flags[token.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      flags[token.slice(2)] = true;
      continue;
    }
    flags._.push(token);
  }
  return flags;
}

function searchRootsFrom(flags) {
  const raw = flags['search-roots'] || process.env.APP_PACKAGER_SEARCH_ROOTS;
  if (!raw) return undefined;
  return String(raw)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function printDoctor(report) {
  console.log(`AppPackager 环境检查 — ${report.platformName}`);
  console.log(`引擎目录: ${report.home}${isMaterialized(report.home) ? '' : '（未初始化）'}`);
  console.log('');
  for (const item of report.checks) {
    const detail = item.detail ? ` — ${item.detail}` : '';
    console.log(`${MARKS[item.status] || '?'} ${item.label}${detail}`);
    if (item.status !== 'ok' && item.hint) console.log(`    → ${item.hint}`);
  }
  console.log('');
  console.log(report.ok ? `通过（${report.warnings} 项警告）` : `${report.failures} 项失败，${report.warnings} 项警告`);
}

function printProjects(home, projects) {
  console.log(`引擎目录: ${home}`);
  if (projects.length === 0) {
    console.log('未发现项目配置 config/projects/*.env。');
    console.log('把 uni-app x 项目放到引擎同级目录，然后运行 `app-packager init`。');
    return;
  }
  for (const project of projects) {
    const state = project.sourceDirExists ? '' : '（SOURCE_DIR 不存在）';
    console.log(`- ${project.id}${state}`);
    console.log(`  源码: ${project.sourceDir || '(未配置)'}`);
    console.log(`  平台: ${project.enabledPlatforms.join(', ') || '(全部关闭)'}`);
    if (project.bundleId) console.log(`  Bundle ID: ${project.bundleId}`);
  }
}

async function withEngine(home, args, flags, { stdio = 'inherit', timeoutMs, script, stdin = 'ignore' } = {}) {
  if (!isMaterialized(home)) {
    console.error(`引擎未初始化：${home}`);
    console.error('先运行 `app-packager init`。');
    return 1;
  }
  const shell = shellAvailable();
  if (!shell.available) {
    console.error(`无法运行 bash 引擎：${shell.error}`);
    return 1;
  }
  const result = await runEngine(home, args, { stdio, stdin, script, searchRoots: searchRootsFrom(flags), timeoutMs });
  return result.code;
}

export async function main(argv) {
  const flags = parseArgs(argv);
  const command = flags._[0] || 'help';
  const home = resolveHome(flags.dir);

  if (flags.version && command !== 'build') {
    console.log(packageVersion());
    return 0;
  }

  switch (command) {
    case 'help':
    case '--help':
    case '-h': {
      console.log(HELP);
      return 0;
    }
    case 'version': {
      console.log(packageVersion());
      return 0;
    }
    case 'env': {
      const payload = {
        version: packageVersion(),
        home,
        materialized: isMaterialized(home),
        engineEntry: engineEntryPath(home),
        searchRoots: searchRootsFrom(flags) || [path.dirname(home)],
        shell: shellAvailable(),
      };
      console.log(flags.json ? JSON.stringify(payload, null, 2) : Object.entries(payload).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n'));
      return 0;
    }
    case 'init': {
      const result = materialize(home, { force: Boolean(flags.force) });
      console.log(result.upToDate ? `引擎已是最新（${result.version}）：${home}` : `引擎已就绪：${home}（${result.copied} 个文件，保留 ${result.skipped} 个本地文件）`);
      if (flags['no-wizard']) {
        console.log('跳过初始化向导。下一步：把 uni-app x 项目放到引擎同级目录，然后运行 `app-packager init`（不加 --no-wizard）。');
        return 0;
      }
      console.log('');
      return withEngine(home, [path.basename(ENGINE_WIZARD)], flags);
    }
    case 'doctor': {
      const platform = flags.platform || 'all';
      if (!['all', ...PLATFORMS].includes(platform)) {
        console.error(`未知平台：${platform}（可选 ${['all', ...PLATFORMS].join(' | ')}）`);
        return 1;
      }
      const report = runDoctor({ home, platform });
      if (flags.json) console.log(JSON.stringify(report, null, 2));
      else printDoctor(report);
      return report.ok ? 0 : 1;
    }
    case 'list': {
      const projects = listProjects(home);
      if (flags.json) console.log(JSON.stringify({ home, projects }, null, 2));
      else printProjects(home, projects);
      return 0;
    }
    case 'check': {
      const platform = flags._[1];
      if (!platform || !['all', 'ios', 'android', 'harmony'].includes(platform)) {
        console.error('用法: app-packager check <ios|android|harmony|all> [项目ID]');
        return 1;
      }
      const args = ['check', platform];
      if (flags._[2]) args.push(flags._[2]);
      return withEngine(home, args, flags);
    }
    case 'build': {
      const platform = flags._[1];
      if (!platform || !['all', 'ios', 'android', 'harmony'].includes(platform)) {
        console.error('用法: app-packager build <ios|android|harmony|all> [项目ID|--all] [选项]');
        return 1;
      }
      const args = [platform];
      if (flags._[2]) args.push(flags._[2]);
      else if (flags.all) args.push('--all');
      for (const key of ['upload', 'no-upload', 'harmony-debug', 'keep-work']) {
        if (flags[key] === undefined) continue;
        args.push(`--${key}`);
        if (typeof flags[key] === 'string') args.push(flags[key]);
      }
      if (typeof flags.version === 'string') args.push('--version', flags.version);
      return withEngine(home, args, flags);
    }
    case 'run': {
      return withEngine(home, flags._.slice(1), flags);
    }
    default: {
      // Unknown first token: treat the whole command line as an engine action,
      // so `app-packager ios my-project` keeps working like the .command file.
      if (['ios', 'android', 'harmony', 'all'].includes(command)) {
        return withEngine(home, argv, flags);
      }
      console.error(`未知命令：${command}`);
      console.error('运行 `app-packager help` 查看用法。');
      return 1;
    }
  }
}
