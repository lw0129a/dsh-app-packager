/**
 * Ports of `engine/lib/common.sh` helpers that are pure path/manifest work.
 * Same inputs, same answers as the bash engine, so both can run side by side
 * while the rest of the engine moves over.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './run.js';

const stamp = () => new Date().toTimeString().slice(0, 8);

export function log(message: string): void {
  process.stderr.write(`[${stamp()}] ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`[${stamp()}] WARN ${message}\n`);
}

/** The bash engine's `die`, as a throwable: the CLI prints it and exits with 1. */
export class EngineError extends Error {
  override name = 'EngineError';
}

export function die(message: string): never {
  throw new EngineError(message);
}

export function requireCmd(command: string, env: NodeJS.ProcessEnv = process.env): void {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!dirs.some((dir) => fs.existsSync(path.join(dir, command)))) die(`缺少命令: ${command}`);
}

/** Absolute path of an existing directory, symlinks resolved; undefined when it is not one. */
export function absoluteDir(target: string): string | undefined {
  try {
    if (!fs.statSync(target).isDirectory()) return undefined;
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

export function projectIds(home: string): string[] {
  const dir = path.join(home, 'config', 'projects');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.env'))
    .map((name) => name.slice(0, -4))
    .sort();
}

export interface ManifestMetadata {
  name: string;
  appId: string;
  versionName: string;
  versionCode: string;
  associatedDomains: string[];
}

/** `manifest_metadata`: the handful of fields packaging needs from manifest.json (JSONC). */
export function manifestMetadata(file: string): ManifestMetadata {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const value = (key: string) => {
    const quoted = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text);
    if (quoted) return quoted[1];
    const numeric = new RegExp(`"${key}"\\s*:\\s*([0-9]+)`).exec(text);
    return numeric ? numeric[1] : '';
  };
  const domains = /"associatedDomains"\s*:\s*\[([\s\S]*?)\]/.exec(text);
  return {
    name: value('name'),
    appId: value('appid'),
    versionName: value('versionName'),
    versionCode: value('versionCode'),
    associatedDomains: domains ? [...domains[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [],
  };
}

const firstOf = (dir: string, candidates: string[]): string | undefined =>
  candidates.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));

export const isUniAppProject = (dir: string): boolean =>
  Boolean(firstOf(dir, ['manifest.json', 'src/manifest.json']) && firstOf(dir, ['pages.json', 'src/pages.json']));

export const projectManifestPath = (dir: string): string | undefined => firstOf(dir, ['manifest.json', 'src/manifest.json']);

export const projectPagesPath = (dir: string): string | undefined => firstOf(dir, ['pages.json', 'src/pages.json']);

export const workspaceManifestPath = (root: string): string | undefined => projectManifestPath(root);

export const workspaceAppFile = (root: string): string | undefined => firstOf(root, ['App.uvue', 'src/App.uvue']);

/** uni-app x has the `"uni-app-x"` key in manifest.json; classic uni-app does not. */
export function projectIsUniappx(manifest: string): boolean {
  if (!fs.existsSync(manifest)) return false;
  return /^\s*"uni-app-x"\s*:/m.test(fs.readFileSync(manifest, 'utf8'));
}

/** 1.8 → 8, 21.0.1 → 21, nothing when java is missing. */
export async function javaMajorVersion(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const result = await runCommand('java', ['-version'], { env, timeoutMs: 20000 });
  const match = /version "([0-9][0-9.]*)"/.exec(result.stderr + result.stdout);
  if (!match) return '';
  const raw = match[1];
  return raw.startsWith('1.') ? raw.split('.')[1] || '' : raw.split('.')[0];
}

/**
 * Classic uni-app offline projects are AGP 8 + Gradle 8, which only understands
 * JDK up to 23: a JDK 25 default makes Gradle blow up on class file version 69.
 */
export async function classicAndroidJavaHome(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const pinned = env.ANDROID_CLASSIC_JAVA_HOME;
  if (pinned && fs.existsSync(path.join(pinned, 'bin', 'java'))) return pinned;
  for (const major of ['21', '17']) {
    const result = await runCommand('/usr/libexec/java_home', ['-v', major], { timeoutMs: 20000 });
    const candidate = result.stdout.trim();
    if (candidate && fs.existsSync(path.join(candidate, 'bin', 'java'))) return candidate;
  }
  return undefined;
}

/** Directory name → project id: lowercase, non-alphanumerics collapsed to `-`. */
export function projectIdFromSourceDir(dir: string): string {
  const base = path
    .basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  if (base) return base;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `uni-app-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Bundle id an existing native project already declares, so re-registering keeps it. */
export function projectBundleIdFromSourceDir(dir: string): string | undefined {
  const gradle = path.join(dir, 'app-android', 'app', 'build.gradle');
  if (fs.existsSync(gradle)) {
    const text = fs.readFileSync(gradle, 'utf8');
    const match = /applicationId\s+["']([^"']+)["']/.exec(text) || /applicationId\s+([^\s"']+)/.exec(text);
    if (match) return match[1];
  }
  const env = path.join(dir, 'scripts', 'ios-package', 'env', 'adhoc.env');
  if (fs.existsSync(env)) {
    const line = fs
      .readFileSync(env, 'utf8')
      .split(/\r?\n/)
      .find((text) => /^\s*BUNDLE_ID\s*=/.test(text));
    if (line) {
      const value = line.slice(line.indexOf('=') + 1).replace(/#.*$/, '').trim().replace(/^"|"$/g, '');
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * HBuilderX 5.26's Android compiler treats any project path containing
 * `node_modules` as a dependency and then cannot resolve its own generated
 * imports. The npm install puts the engine home exactly there, so the workspace
 * has to move out — and HBuilderX must be handed the real path, not a symlink.
 */
export function relocateWorkRoot(env: NodeJS.ProcessEnv, platform = process.platform): string {
  const workRoot = env.WORK_ROOT || '';
  if (!workRoot.includes(`${path.sep}node_modules${path.sep}`)) return workRoot;
  const explicit = env.APP_PACKAGER_CACHE_ROOT;
  let cacheRoot = explicit || '';
  if (!cacheRoot) {
    const pipeline = env.PIPELINE_ROOT || '';
    const cut = pipeline.indexOf(`${path.sep}node_modules${path.sep}`);
    if (cut > 0) cacheRoot = path.join(pipeline.slice(0, cut), '.app-packager');
    else if (platform === 'darwin') cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'app-packager');
    else cacheRoot = path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'app-packager');
  }
  return path.join(cacheRoot, 'workspaces');
}

/** Newest gradle that actually runs, from the wrapper cache. */
export async function findCachedGradle(env: NodeJS.ProcessEnv = process.env, timeoutMs = 20000): Promise<string | undefined> {
  const dists = path.join(env.HOME || os.homedir(), '.gradle', 'wrapper', 'dists');
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === 'gradle' && full.includes(`${path.sep}bin${path.sep}`)) found.push(full);
    }
  };
  walk(dists, 0);
  // sort -V -r: gradle-8.10 before gradle-8.9.
  found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const candidate of found) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    const result = await runCommand(candidate, ['--version'], { env, timeoutMs });
    if (result.code === 0) return candidate;
  }
  return undefined;
}
