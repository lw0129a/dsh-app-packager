#!/usr/bin/env node
// 守卫：本仓库是打包**插件**，不能带上「要打包的业务项目」的任何配置或凭据。
// 只看到磁盘上的文件还不够——真正会泄漏的是 `git add` 之后被提交进去的东西，
// 所以这里检查的是 git 眼里的文件：默认 `git ls-files`（已跟踪），也可以直接传路径
// （`.githooks/pre-commit` 用它，CI 用 `pnpm test` 跑）。
//
// 用法：
//   node scripts/check-no-local-config.mjs            # 检查所有已跟踪文件
//   node scripts/check-no-local-config.mjs 路径...     # 只检查给定路径
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'packages/app-packager/engine/';

// 这些是配套的说明与示例，故意提交：
const ALLOWED = new Set([
  `${ENGINE}config/projects/project.env.example`,
  `${ENGINE}config/upload.local.env.example`,
  `${ENGINE}config/parallel.local.env.example`,
  `${ENGINE}certificates/README.md`,
  `${ENGINE}certificates/处理证书.command`,
  `${ENGINE}signing/README.md`,
  `${ENGINE}signing/apple/AppleRootCA.cer`,
  `${ENGINE}signing/apple/AppleWWDRCAG3.cer`,
  `${ENGINE}logs/.gitkeep`,
  `${ENGINE}sdk/README.md`,
  `${ENGINE}sdk/处理SDK.command`,
]);

// 密钥、证书、签名材料、安装包：任何位置都不许进仓库。
const SECRET_EXT = /\.(p12|pfx|mobileprovision|provisionprofile|jks|keystore|p7b|p8|pem|key|cer|ipa|apk|hap)$/i;
// 私钥正文（哪怕被贴进 .md 或 .sh 也要拦）。
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** 返回这条路径「为什么不该被提交」；空字符串表示没问题。 */
function reason(path) {
  if (ALLOWED.has(path)) return '';
  if (path.startsWith(`${ENGINE}config/projects/`) && path.endsWith('.env')) return '业务项目的注册配置';
  if (/^packages\/app-packager\/engine\/config\/(settings|init|upload|parallel)\.local\.env$/.test(path)) return '本机私密配置';
  if (path.startsWith(`${ENGINE}signing/current/`)) return '本机签名材料';
  if (path.startsWith(`${ENGINE}certificates/`)) return '证书凭据';
  if (path.startsWith(`${ENGINE}logs/`)) return '打包/上传日志';
  if (path.startsWith(`${ENGINE}tools/`)) return '本机工具（如蒲公英 CLI）';
  if (path.startsWith(`${ENGINE}sdk/`)) return '本机 SDK';
  if (path.startsWith(`${ENGINE}packages/`)) return '打包产物';
  if (SECRET_EXT.test(path)) return '密钥/证书/安装包';
  return '';
}

/** 私钥正文检查：只看小体积文本文件，二进制直接跳过。 */
function hasPrivateKey(path) {
  let stat;
  try {
    stat = statSync(resolve(root, path));
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size > 512 * 1024) return false;
  const bytes = readFileSync(resolve(root, path));
  if (bytes.subarray(0, 8192).includes(0)) return false; // 有 NUL：当二进制
  return PRIVATE_KEY.test(bytes.toString('utf8'));
}

const fromArgs = process.argv.slice(2);
const files = fromArgs.length
  ? fromArgs
  : execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);

const problems = [];
for (const path of files) {
  const why = reason(path);
  if (why) problems.push(`${path}：${why}`);
  else if (path.endsWith('.md') || path.endsWith('.sh') || path.endsWith('.json') || path.endsWith('.mjs') || path.endsWith('.env') || path.endsWith('.example')) {
    if (hasPrivateKey(path)) problems.push(`${path}：正文里有私钥`);
  }
}

if (problems.length) {
  console.error(`guard:check 失败：${problems.length} 个文件不该出现在这个插件仓库里。`);
  for (const line of problems) console.error(`  - ${line}`);
  console.error('');
  console.error('要打包的项目配置留在引擎目录（APP_PACKAGER_HOME），不要提交：');
  console.error('  git rm --cached <路径>     # 从索引里移除（本地文件保留）');
  console.error('  git check-ignore -v <路径> # 确认 .gitignore 已经挡住它');
  process.exit(1);
}

console.log(`guard:check 通过：${files.length} 个文件里没有业务项目配置或密钥。`);
