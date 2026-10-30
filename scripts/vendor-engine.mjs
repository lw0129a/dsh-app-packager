#!/usr/bin/env node
/**
 * Copy the engine package (packages/app-packager) into this package as
 * `vendor/app-packager`, so the plugin ships as ONE npm package instead of
 * depending on a second published package.
 *
 * Only the published parts are copied: dist/ (JS + .d.ts) and engine/ (bash).
 * The copy is generated, never edited — see .gitignore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(here);
const source = path.resolve(pluginRoot, 'packages', 'app-packager');
const target = path.join(pluginRoot, 'vendor', 'app-packager');

for (const part of ['dist', 'engine']) {
  const from = path.join(source, part);
  // 引擎包没构建过时 tsc 会报模块找不到，早一点说清楚。
  if (!fs.existsSync(from)) {
    console.error(`缺少 ${from}：先在 packages/app-packager 跑一次 pnpm build。`);
    process.exit(1);
  }
}

fs.rmSync(path.join(pluginRoot, 'vendor'), { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const part of ['dist', 'engine']) {
  fs.cpSync(path.join(source, part), path.join(target, part), { recursive: true });
}

const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
// 只留运行时需要的字段：脚本、devDependencies、repository 在插件包里没有意义，
// 留着还会让人以为能在这里 `pnpm build`。
const trimmed = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  license: manifest.license,
  type: manifest.type,
  bin: manifest.bin,
  exports: manifest.exports,
  types: manifest.types,
  engines: manifest.engines,
};
fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`);

console.log(`vendored ${manifest.name}@${manifest.version} → ${path.relative(pluginRoot, target)}`);
