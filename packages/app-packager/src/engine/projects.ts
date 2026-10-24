/**
 * `load_project` / `--set` / project discovery, ported from `engine/lib/common.sh`.
 *
 * Project env files are sourced by bash, so they may hold quoted values; this
 * reader understands the quoting and comments the engine itself writes and
 * refuses anything fancier rather than pretending to be a shell.
 */
import fs from 'node:fs';
import path from 'node:path';
import { absoluteDir, die, isUniAppProject, manifestMetadata, projectIds, projectManifestPath, warn } from './common.js';

/** Keys `--set` may override. Path-ish keys the engine derives are deliberately absent. */
export const PACKAGE_ENV_OVERRIDE_KEYS = [
  'APP_NAME',
  'APP_ID',
  'BUNDLE_ID',
  'TEAM_ID',
  'PROFILE_NAME',
  'SIGNING_CERTIFICATE',
  'EXPORT_METHOD',
  'PACKAGE_KIND',
  'SCHEME',
  'CONFIGURATION',
  'CHANNEL',
  'MARKETING_VERSION',
  'BUILD_NUMBER',
];

/** Appends one `KEY=VALUE` to the `--set` list; throws on anything the engine would reject. */
export function setPackageOverride(pair: string, previous = ''): string {
  const cut = pair.indexOf('=');
  if (cut < 0) die(`--set 需要 KEY=VALUE 形式: ${pair}`);
  const key = pair.slice(0, cut);
  const value = pair.slice(cut + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) die(`--set 键名不合法: ${key}`);
  if (!PACKAGE_ENV_OVERRIDE_KEYS.includes(key)) {
    die(`--set 不支持的键: ${key}（可用: ${PACKAGE_ENV_OVERRIDE_KEYS.join(' ')}）`);
  }
  if (value.includes('\n')) die(`--set 的值不能包含换行: ${key}`);
  return `${previous}${key}=${value}\n`;
}

/** `KEY=VALUE` lines → map. Handles the `%q` quoting bash writes and `#` comments. */
export function parseEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(cut + 1);
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1);
    else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    env[key] = value;
  }
  return env;
}

export function projectSearchRoots(env: NodeJS.ProcessEnv = process.env, pipelineRoot = ''): string[] {
  const configured = env.PROJECT_SEARCH_ROOTS;
  const roots = configured ? configured.split(':') : [path.dirname(pipelineRoot)];
  return roots.map((root) => root.trim()).filter(Boolean);
}

const SKIP_DIRS = /^(?:\.|node_modules$|unpackage$|_)/;

/** One level under each search root, uni-app projects only. */
export function discoverUniAppProjects(roots: string[], pipelineRoot = ''): string[] {
  const found: string[] = [];
  for (const rawRoot of roots) {
    const root = absoluteDir(rawRoot);
    if (!root) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.test(entry.name)) continue;
      const dir = path.join(root, entry.name);
      if (dir === pipelineRoot) continue;
      if (!isUniAppProject(dir)) continue;
      const resolved = absoluteDir(dir);
      if (resolved) found.push(resolved);
    }
  }
  return found;
}

export interface ProjectContext {
  /** Every variable the project env file declares, plus the derived ones below. */
  vars: Record<string, string>;
  projectId: string;
  sourceDir: string;
  displayName: string;
  appId: string;
  workspace: string;
  runId: string;
  runDir: string;
  logFile: string;
  packageEnv: string;
  profilePlist: string;
}

export interface LoadProjectOptions {
  pipelineRoot: string;
  workRoot: string;
  logRoot: string;
  /** `APP_PACKAGER_BUILD_PLATFORM`: suffixes workspace and run id so platforms do not collide. */
  buildPlatform?: string;
  /** `--set` pairs, already validated. */
  overrides?: Record<string, string>;
  /** `APP_PACKAGER_FULL_PERMISSION` / `APP_PAGER_PROFILE_FILE` style CLI overrides. */
  fullPermission?: string;
  profileFile?: string;
}

/**
 * Mirrors `load_project`: read the project env, overlay manifest metadata, apply
 * the `--set` overrides, then derive the run paths. Throws (`die`) on the same
 * missing fields bash refuses, so a broken project fails the same way.
 */
export function loadProject(id: string, options: LoadProjectOptions): ProjectContext {
  const file = path.join(options.pipelineRoot, 'config', 'projects', `${id}.env`);
  if (!fs.existsSync(file)) die(`未知项目: ${id}。可用项目: ${projectIds(options.pipelineRoot).join(' ')}`);

  const vars = { ...parseEnvFile(file) };
  const projectId = vars.PROJECT_ID || id;
  if (!vars.SOURCE_DIR) die('项目配置缺少 SOURCE_DIR');
  const sourceDir = vars.SOURCE_DIR;

  const manifest = projectManifestPath(sourceDir);
  if (manifest) {
    const meta = manifestMetadata(manifest);
    vars.DISPLAY_NAME = meta.name || vars.DISPLAY_NAME || projectId;
    vars.APP_ID = meta.appId || vars.APP_ID || '';
    if (meta.associatedDomains.length) vars.ASSOCIATED_DOMAINS = meta.associatedDomains.join(' ');
  } else {
    vars.DISPLAY_NAME = vars.DISPLAY_NAME || projectId;
  }
  if (!vars.APP_ID) die('manifest.json 缺少 appid');

  if (options.fullPermission === 'true' || options.fullPermission === 'false') {
    vars.FULL_PERMISSION_PROFILE = options.fullPermission;
    vars.FULL_PERMISSION_PROMPT = options.fullPermission;
  }
  if (options.profileFile) {
    if (!fs.existsSync(options.profileFile)) die(`指定的描述文件不存在: ${options.profileFile}`);
    vars.PROFILE_FILE = options.profileFile;
  }
  for (const [key, value] of Object.entries(options.overrides || {})) vars[key] = value;
  if (!vars.PROFILE_FILE) die('项目配置缺少 PROFILE_FILE');

  vars.APP_NAME = vars.APP_NAME || projectId;
  vars.HARMONY_ENABLED = vars.HARMONY_ENABLED || 'true';
  vars.HX_PROJECT_NAME = vars.HX_PROJECT_NAME || `${projectId}-build`;
  vars.CHANNEL = vars.CHANNEL || 'adhoc';
  vars.SCHEME = vars.SCHEME || 'UniAppX';
  vars.CONFIGURATION = vars.CONFIGURATION || 'Release';
  vars.BUILD_SCRIPT_RELATIVE = vars.BUILD_SCRIPT_RELATIVE || 'scripts/ios-package/build-adhoc-ipa.sh';

  const suffix = options.buildPlatform ? `-${options.buildPlatform}` : '';
  const workspace = path.join(options.workRoot, projectId, `${vars.HX_PROJECT_NAME}${suffix}`);
  const runId = `${timestampId()}${suffix}-${process.pid}`;
  const runDir = path.join(options.logRoot, projectId, runId);

  return {
    vars,
    projectId,
    sourceDir,
    displayName: vars.DISPLAY_NAME,
    appId: vars.APP_ID,
    workspace,
    runId,
    runDir,
    logFile: path.join(runDir, 'build.log'),
    packageEnv: path.join(runDir, 'package.env'),
    profilePlist: path.join(runDir, 'profile.plist'),
  };
}

const timestampId = (now = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

/** `init_run`: the directories every build needs before it starts. */
export function initRun(context: ProjectContext, pipelineRoot: string, packageDirs: string[]): string {
  for (const dir of [path.join(pipelineRoot, '.tmp'), context.runDir, ...packageDirs, path.dirname(context.workspace)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpDir = fs.mkdtempSync(path.join(pipelineRoot, '.tmp', 'build.'));
  return tmpDir;
}

export interface BuildLock {
  dir: string;
  release: () => void;
}

/**
 * `acquire_build_lock`: one build per project (per platform) at a time. A lock
 * whose pid is gone is stale and gets taken over, matching the bash engine.
 */
export function acquireBuildLock(pipelineRoot: string, projectId: string, buildPlatform?: string): BuildLock {
  const name = buildPlatform ? `${projectId}-${buildPlatform}` : projectId;
  const root = path.join(pipelineRoot, '.tmp', 'locks');
  const dir = path.join(root, `${name}.lock`);
  fs.mkdirSync(root, { recursive: true });

  const take = () => {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'pid'), `${process.pid}\n`);
    return { dir, release: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };
  try {
    return take();
  } catch {
    /* somebody holds it — check whether they are still alive */
  }
  const owner = Number(fs.existsSync(path.join(dir, 'pid')) ? fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim() : '');
  // Alive means "the signal could be sent", including EPERM (someone else's process).
  const alive = Boolean(owner) && (() => {
    try {
      process.kill(owner, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  })();
  if (alive) die(`项目 ${projectId} 正在打包中（PID ${owner}），拒绝并发覆盖工作区`);
  warn(`检测到项目 ${projectId} 的过期构建锁，正在清理: ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return take();
}
