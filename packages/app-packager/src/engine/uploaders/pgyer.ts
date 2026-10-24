/**
 * 蒲公英（pgyer）上传器，移植自 `engine/lib/uploaders/pgyer.sh`。
 *
 * - iOS/Android 走官方 CLI（`@pgyer/cli`，首次使用时装进 `tools/pgyer-cli`，不装全局）。
 * - HarmonyOS HAP 走接口：官方 CLI 没有 uploadHarmonyCert 这一步，而蒲公英要求随包带 P12。
 * - 上传失败只写一条失败记录，绝不回滚打包产物。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { log, warn } from '../common.js';
import type { Settings } from '../settings.js';
import type { BuildInfo, UploadProvider, UploadResult } from '../upload.js';

const CLI_PACKAGE = '@pgyer/cli';
const CLI_VERSION = '0.1.5';

const env = process.env;

function setting(settings: Settings, key: string): string {
  return settings[key] ?? env[key] ?? '';
}

/** 非交互（面板/CI）时不要停下来等输入。 */
function interactive(): boolean {
  return Boolean(process.stdin.isTTY) && env.APP_PACKAGER_NONINTERACTIVE !== '1';
}

async function ask(prompt: string, secret: boolean): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    if (secret) {
      process.stderr.write(prompt);
      const onData = (chunk: Buffer): void => {
        process.stderr.write('\n');
        process.stdin.pause();
        resolve(chunk.toString().trim());
      };
      rl.once('line', (line) => resolve(line.trim()));
      process.stdin.once('data', onData);
    } else {
      rl.question(prompt, resolve);
    }
  });
  rl.close();
  return answer;
}

function keychainRead(service: string): string {
  const result = spawnSync('security', ['find-generic-password', '-s', service, '-a', env.USER ?? '', '-w'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function keychainWrite(service: string, value: string): boolean {
  const result = spawnSync('security', ['add-generic-password', '-U', '-s', service, '-a', env.USER ?? '', '-w', value], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

async function apiKey(settings: Settings): Promise<string> {
  const direct = setting(settings, 'PGYER_API_KEY');
  if (direct) return direct;
  const stored = keychainRead(setting(settings, 'PGYER_API_KEY_SERVICE') || 'app-packager-pgyer');
  if (stored) return stored;
  if (!interactive()) return '';
  const typed = await ask('未找到蒲公英 API Key。请输入（不会回显；直接回车跳过上传）: ', true);
  if (!typed) return '';
  const save = (await ask('是否保存到 macOS Keychain？[Y/n]: ', false)).toLowerCase();
  if (save !== 'n' && save !== 'no') {
    if (keychainWrite(setting(settings, 'PGYER_API_KEY_SERVICE') || 'app-packager-pgyer', typed)) {
      log('蒲公英 API Key 已保存到 Keychain。');
    } else {
      warn('蒲公英 API Key 保存失败，本次仍继续上传。');
    }
  }
  return typed;
}

async function harmonyP12Password(settings: Settings): Promise<string> {
  for (const key of ['PGYER_HARMONY_P12_PASSWORD', 'HARMONY_P12_PASSWORD']) {
    const value = setting(settings, key);
    if (value) return value;
  }
  const stored =
    keychainRead(setting(settings, 'PGYER_HARMONY_P12_PASSWORD_SERVICE') || 'app-packager-pgyer-harmony-p12') ||
    keychainRead(setting(settings, 'HARMONY_P12_PASSWORD_SERVICE') || 'anjuyi-harmony-p12');
  if (stored) return stored;
  if (!interactive()) return '';
  const typed = await ask('上传 HarmonyOS HAP 需要 P12 密码。请输入（不会回显；直接回车跳过上传）: ', true);
  if (!typed) return '';
  const save = (await ask('是否保存到 macOS Keychain？[Y/n]: ', false)).toLowerCase();
  if (save !== 'n' && save !== 'no') {
    const service = setting(settings, 'PGYER_HARMONY_P12_PASSWORD_SERVICE') || 'app-packager-pgyer-harmony-p12';
    if (keychainWrite(service, typed)) log('HarmonyOS P12 密码已保存到 Keychain。');
    else warn('HarmonyOS P12 密码保存失败，本次仍继续上传。');
  }
  return typed;
}

function description(settings: Settings, fallback: string): string {
  return setting(settings, 'PGYER_UPDATE_DESCRIPTION') || setting(settings, 'PGYER_BUILD_UPDATE_DESCRIPTION') || fallback;
}

function cliDir(settings: Settings): string {
  return setting(settings, 'PGYER_CLI_DIR') || path.join(settings.PIPELINE_ROOT ?? '.', 'tools/pgyer-cli');
}

function cliPath(settings: Settings): string {
  return path.join(cliDir(settings), 'node_modules/.bin/pgyer');
}

function cliEnsure(settings: Settings): boolean {
  if (fs.existsSync(cliPath(settings))) return true;
  const pkg = setting(settings, 'PGYER_CLI_PACKAGE') || CLI_PACKAGE;
  const version = setting(settings, 'PGYER_CLI_VERSION') || CLI_VERSION;
  const dir = cliDir(settings);
  fs.mkdirSync(dir, { recursive: true });
  log(`首次使用蒲公英上传：安装官方 CLI ${pkg}@${version} 到 ${dir}`);
  const installed = spawnSync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error', `${pkg}@${version}`], {
    stdio: 'inherit',
  });
  if (installed.status !== 0) {
    warn(`蒲公英官方 CLI 安装失败。可手动执行: npm install --prefix "${dir}" ${pkg}@${version}`);
    return false;
  }
  if (!fs.existsSync(cliPath(settings))) {
    warn(`蒲公英官方 CLI 安装后仍缺少可执行文件: ${cliPath(settings)}`);
    return false;
  }
  log(`蒲公英官方 CLI 已就绪: ${cliPath(settings)}`);
  return true;
}

function cliErrorMessage(logFile: string): string {
  let text = '';
  try {
    text = fs.readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
  const fromJson = (raw: string): string => {
    try {
      const parsed = JSON.parse(raw);
      const error = parsed.error || parsed;
      return typeof error.message === 'string' ? error.message : '';
    } catch {
      return '';
    }
  };
  let message = fromJson(text.trim());
  if (!message) {
    for (const line of text.split('\n').reverse()) {
      message = fromJson(line.trim());
      if (message) break;
    }
  }
  return message || text.trim().split('\n').filter(Boolean).pop() || '';
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function uploadDir(settings: Settings): string {
  const dir = path.join(settings.UPLOAD_DIR || path.join(settings.PIPELINE_ROOT ?? '.', 'uploads'), 'pgyer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file: string, payload: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeFailure(infoFile: string, resultFile: string, message: string): void {
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as BuildInfo;
  writeJson(resultFile, {
    status: 'failed',
    provider: 'pgyer',
    project_id: info.project_id || '',
    platform: info.platform || '',
    version: info.version || '',
    file_path: info.ipa_path || info.apk_path || info.hap_path || '',
    error: message,
    updated_at: new Date().toISOString(),
  });
}

function record(infoFile: string, status: 'success' | 'failed', resultFile: string, errorMessage = ''): void {
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as BuildInfo & { uploads?: Record<string, unknown> };
  let detail: Record<string, unknown> = { provider: 'pgyer', status, updated_at: new Date().toISOString() };
  if (status === 'success' && fs.existsSync(resultFile)) {
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const data = result.data || result;
    detail = {
      ...detail,
      build_key: data.buildKey || data.build_key || result.build_key || '',
      shortcut_url: data.buildShortcutUrl || data.shortcut_url || result.shortcut_url || '',
      qr_code_url: data.buildQRCodeURL || result.qr_code_url || result.shortcut_url || '',
      install_password: data.buildPassword || result.install_password || '',
    };
  } else if (errorMessage) {
    detail.error = errorMessage;
  }
  info.uploads = info.uploads && typeof info.uploads === 'object' ? info.uploads : {};
  info.uploads.pgyer = detail;
  writeJson(infoFile, info);
}

async function uploadWithCli(settings: Settings, infoFile: string, platform: string, projectId: string, version: string, file: string): Promise<boolean> {
  const key = await apiKey(settings);
  if (!key) {
    warn(
      `蒲公英上传跳过：未配置 API Key。可在面板「打包选项 → 蒲公英」里填写，或设置 PGYER_API_KEY，或保存到 Keychain service ${setting(settings, 'PGYER_API_KEY_SERVICE') || 'app-packager-pgyer'}`,
    );
    return false;
  }
  if (!cliEnsure(settings)) return false;

  const current = stamp();
  const dir = uploadDir(settings);
  const resultFile = path.join(dir, `${current}-${projectId}-${platform}.json`);
  const cliOut = path.join(dir, `${current}-${projectId}-${platform}.cli.json`);
  const cliLog = path.join(dir, `${current}-${projectId}-${platform}.cli.log`);
  const summary = description(settings, `${projectId} ${version} ${platform} ${settings.BUILD_STARTED_AT ?? ''}`);

  const args = [
    'upload',
    file,
    '--json',
    '--timeout',
    setting(settings, 'PGYER_UPLOAD_TIMEOUT_SECONDS') || '600',
    '--poll-interval',
    setting(settings, 'PGYER_POLL_INTERVAL_SECONDS') || '4',
  ];
  if (summary) args.push('--build-update-description', summary);
  const buildPassword = setting(settings, 'PGYER_BUILD_PASSWORD');
  if (buildPassword) args.push('--password-env');

  log(`上传到蒲公英（官方 CLI）: ${path.basename(file)}`);
  const out = fs.openSync(cliOut, 'w');
  const err = fs.openSync(cliLog, 'w');
  const run = spawnSync(cliPath(settings), args, {
    stdio: ['ignore', out, err],
    env: { ...env, PGYER_API_KEY: key, PGYER_USER_KEY: setting(settings, 'PGYER_USER_KEY'), ...(buildPassword ? { PGYER_INSTALL_PASSWORD: buildPassword } : {}) },
  });
  fs.closeSync(out);
  fs.closeSync(err);

  if (run.status !== 0) {
    const message = cliErrorMessage(cliLog) || `官方 CLI 退出失败，详见: ${cliLog}`;
    writeFailure(infoFile, resultFile, message);
    record(infoFile, 'failed', resultFile, message);
    warn(`蒲公英上传失败: ${message}`);
    return false;
  }

  let cli: any = {};
  try {
    cli = JSON.parse(fs.readFileSync(cliOut, 'utf8'));
  } catch (error) {
    cli = { success: false, error: `CLI 输出不是有效 JSON: ${(error as Error).message}` };
  }
  if (cli.success !== true) {
    writeJson(resultFile, { ...cli, status: 'failed', platform });
    record(infoFile, 'failed', resultFile, '蒲公英官方 CLI 返回失败，详见: ' + resultFile);
    warn(`蒲公英官方 CLI 返回失败，详见: ${resultFile}`);
    return false;
  }

  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as BuildInfo;
  const shortcut = cli.shortcut || '';
  writeJson(resultFile, {
    status: 'success',
    provider: 'pgyer',
    project_id: info.project_id || '',
    platform: info.platform || '',
    version: info.version || '',
    file_path: info.ipa_path || info.apk_path || '',
    build_key: cli.buildKey || '',
    shortcut_url: shortcut,
    qr_code_url: shortcut ? `https://www.pgyer.com/app/qrcode/${shortcut}` : '',
    install_password: '',
    cli: { package: CLI_PACKAGE, command: 'upload', path: cliPath(settings) },
    response: cli,
    uploaded_at: current,
  });
  record(infoFile, 'success', resultFile);
  log(`蒲公英上传成功${shortcut ? `: ${shortcut}` : ''}`);
  return true;
}

async function uploadHarmony(settings: Settings, infoFile: string, projectId: string, version: string, hap: string): Promise<boolean> {
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as BuildInfo;
  const p12 = info.harmony_p12_path ?? '';
  const dir = uploadDir(settings);
  const current = stamp();
  const resultFile = path.join(dir, `${current}-${projectId}-harmony.json`);
  const fail = (message: string): boolean => {
    writeFailure(infoFile, resultFile, message);
    record(infoFile, 'failed', resultFile, message);
    warn(message);
    return false;
  };

  if (!p12 || !fs.existsSync(p12)) return fail(`蒲公英 HAP 上传失败：构建信息缺少可用的 HarmonyOS P12: ${p12}`);
  if (info.harmony_profile_type === 'debug') return fail('蒲公英 HAP 上传失败：当前是 Debug Profile。蒲公英要求 release + internaltesting Profile');
  if (info.harmony_profile_distribution && info.harmony_profile_distribution !== 'internaltesting') {
    return fail(`蒲公英 HAP 上传失败：当前 P7B 分发类型为 ${info.harmony_profile_distribution}，必须是 internaltesting`);
  }
  if (typeof info.harmony_profile_device_count === 'number' && info.harmony_profile_device_count === 0) {
    return fail('蒲公英 HAP 上传失败：当前 P7B 不包含测试设备 UDID');
  }

  const key = await apiKey(settings);
  if (!key) return fail('蒲公英 HAP 上传跳过：未配置 API Key');
  const userKey = setting(settings, 'PGYER_USER_KEY');
  const password = await harmonyP12Password(settings);
  if (!password) {
    return fail(
      `蒲公英 HAP 上传跳过：未配置 HarmonyOS P12 密码。可设置 PGYER_HARMONY_P12_PASSWORD，或保存到 Keychain service ${setting(settings, 'PGYER_HARMONY_P12_PASSWORD_SERVICE') || 'app-packager-pgyer-harmony-p12'}`,
    );
  }

  const timeoutMs = Number(setting(settings, 'PGYER_UPLOAD_TIMEOUT_SECONDS') || '600') * 1000;
  const summary = description(settings, `${projectId} ${version} harmony ${settings.BUILD_STARTED_AT ?? ''}`);

  const tokenForm = new FormData();
  tokenForm.append('_api_key', key);
  tokenForm.append('buildType', 'hap');
  if (summary) tokenForm.append('buildUpdateDescription', summary);
  if (userKey) tokenForm.append('_u_key', userKey);
  const installType = setting(settings, 'PGYER_BUILD_INSTALL_TYPE');
  if (installType) tokenForm.append('buildInstallType', installType);
  const buildPassword = setting(settings, 'PGYER_BUILD_PASSWORD');
  if (buildPassword) tokenForm.append('buildPassword', buildPassword);

  log(`获取蒲公英 HAP 上传凭证: ${path.basename(hap)}`);
  let token: any;
  try {
    const response = await fetch(setting(settings, 'PGYER_GET_COS_TOKEN_URL') || 'https://www.pgyer.com/apiv2/app/getCOSToken', {
      method: 'POST',
      body: tokenForm,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const code = response.status;
    if (code < 200 || code >= 300) return fail(`获取上传凭证失败: HTTP ${code}`);
    token = JSON.parse(await response.text());
  } catch (error) {
    return fail(`获取上传凭证失败: ${(error as Error).message}`);
  }
  const data = token?.data ?? {};
  const params = data.params ?? {};
  const buildKey = String(data.key ?? '');
  const endpoint = String(data.endpoint ?? '');
  const signature = String(params.signature ?? '');
  const cosToken = String(params['x-cos-security-token'] ?? '');
  if (Number(token?.code) !== 0 || !buildKey || !endpoint || !signature || !cosToken) {
    return fail(`获取上传凭证失败，详见蒲公英响应（code=${token?.code}）`);
  }

  log(`上传 HarmonyOS HAP: ${path.basename(hap)}`);
  const uploadForm = new FormData();
  uploadForm.append('key', buildKey);
  uploadForm.append('signature', signature);
  uploadForm.append('x-cos-security-token', cosToken);
  uploadForm.append('x-cos-meta-file-name', path.basename(hap));
  uploadForm.append('file', await blobOf(hap), path.basename(hap));
  try {
    const response = await fetch(endpoint, { method: 'POST', body: uploadForm, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status < 200 || response.status >= 300) return fail(`HAP 文件上传失败: HTTP ${response.status}`);
  } catch (error) {
    return fail(`HAP 文件上传失败: ${(error as Error).message}`);
  }

  log('上传蒲公英 HarmonyOS P12 证书');
  const certForm = new FormData();
  certForm.append('_api_key', key);
  certForm.append('password', password);
  certForm.append('buildKey', buildKey);
  if (userKey) certForm.append('_u_key', userKey);
  certForm.append('file', await blobOf(p12), path.basename(p12));
  try {
    const response = await fetch(setting(settings, 'PGYER_HARMONY_CERT_UPLOAD_URL') || 'https://upload.pgyer.com/apiv2/app/uploadHarmonyCert', {
      method: 'POST',
      body: certForm,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status < 200 || response.status >= 300) return fail(`P12 证书上传失败: HTTP ${response.status}`);
    const parsed = JSON.parse(await response.text());
    if (Number(parsed.code) !== 0) return fail('P12 证书上传失败，详见蒲公英响应');
  } catch (error) {
    return fail(`P12 证书上传失败: ${(error as Error).message}`);
  }

  const deadline = Date.now() + Number(setting(settings, 'PGYER_POLL_TIMEOUT_SECONDS') || '300') * 1000;
  let poll: any;
  for (;;) {
    const query = new URLSearchParams({ _api_key: key, buildKey });
    if (userKey) query.set('_u_key', userKey);
    const base = setting(settings, 'PGYER_BUILD_INFO_URL') || 'https://www.pgyer.com/apiv2/app/buildInfo';
    try {
      const response = await fetch(`${base}?${query.toString()}`, { signal: AbortSignal.timeout(60000) });
      if (response.status < 200 || response.status >= 300) return fail(`查询发布状态失败: HTTP ${response.status}`);
      poll = JSON.parse(await response.text());
    } catch (error) {
      return fail(`查询发布状态失败: ${(error as Error).message}`);
    }
    const code = Number(poll?.code);
    if (code === 0) break;
    if (code !== 1247) return fail(`蒲公英 HAP 发布失败: ${poll?.message || `code=${code}`}`);
    if (Date.now() >= deadline) return fail('蒲公英 HAP 发布超时');
    await new Promise((resolve) => setTimeout(resolve, Number(setting(settings, 'PGYER_POLL_INTERVAL_SECONDS') || '3') * 1000));
  }

  const last = poll?.data ?? {};
  writeJson(resultFile, {
    status: 'success',
    provider: 'pgyer',
    project_id: info.project_id || '',
    platform: 'harmony',
    version: info.version || '',
    file_path: hap,
    p12_path: p12,
    build_key: last.buildKey || buildKey,
    shortcut_url: last.buildShortcutUrl || '',
    qr_code_url: last.buildQRCodeURL || '',
    install_password: last.buildPassword || '',
    response: poll,
    uploaded_at: current,
  });
  record(infoFile, 'success', resultFile);
  log(`蒲公英 HarmonyOS 上传成功${last.buildShortcutUrl ? `: ${last.buildShortcutUrl}` : ''}`);
  return true;
}

async function blobOf(file: string): Promise<Blob> {
  const { openAsBlob } = await import('node:fs');
  return openAsBlob(file);
}

export const pgyer: UploadProvider = {
  id: 'pgyer',
  name: '蒲公英',
  platforms: ['ios', 'android', 'harmony'],
  async upload({ settings, infoFile, info, file }): Promise<UploadResult> {
    if (!fs.existsSync(infoFile)) return { ok: false, message: `蒲公英上传失败：构建信息不存在: ${infoFile}` };
    if (!file || !fs.existsSync(file)) return { ok: false, message: `蒲公英上传失败：安装包不存在: ${file}` };
    const projectId = info.project_id || '';
    const version = info.version || '';
    if (info.platform === 'harmony') {
      log('蒲公英 HAP 走接口上传：官方 CLI 没有证书上传步骤（uploadHarmonyCert），蒲公英要求随包上传 P12');
      return { ok: await uploadHarmony(settings, infoFile, projectId, version, file) };
    }
    if (info.platform === 'ios' || info.platform === 'android') {
      return { ok: await uploadWithCli(settings, infoFile, info.platform, projectId, version, file) };
    }
    return { ok: false, message: `蒲公英上传失败：不支持的产物平台: ${info.platform}` };
  },
};
