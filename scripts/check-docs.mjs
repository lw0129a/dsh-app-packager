#!/usr/bin/env node
// 检查中英文档成对存在、首行有语言切换行、且文档里的相对链接都指得到文件。
// 用法：pnpm docs:check（CI 里也会跑）。零依赖。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const pairs = [['README.md', 'README.zh-CN.md'], ['CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md']];

for (const dir of ['docs/en', 'docs/zh-CN']) {
  if (!existsSync(join(root, dir))) continue;
  for (const name of readdirSync(join(root, dir)).filter((f) => f.endsWith('.md'))) {
    const other = dir === 'docs/en' ? 'docs/zh-CN' : 'docs/en';
    if (!existsSync(join(root, other, name))) problems.push(`${dir}/${name}: 缺少对应文件 ${other}/${name}`);
  }
}

const packagesDir = join(root, 'packages');
for (const pkg of readdirSync(packagesDir)) {
  if (existsSync(join(packagesDir, pkg, 'README.md'))) pairs.push([`packages/${pkg}/README.md`, `packages/${pkg}/README.zh-CN.md`]);
}

const docs = new Set([...pairs.flat(), ...['docs/en', 'docs/zh-CN'].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => f.endsWith('.md')).map((f) => `${d}/${f}`) : []))]);
docs.add('AGENTS.md');
docs.add('CHANGELOG.md');
docs.add('SECURITY.md');
docs.add('CODE_OF_CONDUCT.md');

const SWITCH = /^\[English\]\((?<en>[^)]+)\)\s*\|\s*(?:\[简体中文\]\((?<zh>[^)]+)\)|简体中文)/;

for (const rel of [...docs].sort()) {
  const file = join(root, rel);
  if (!existsSync(file)) {
    problems.push(`${rel}: 文件不存在`);
    continue;
  }
  const text = readFileSync(file, 'utf8');

  // 语言切换行：成对的文档必须有，且目标文件要存在
  const isPaired = pairs.some(([a, b]) => a === rel || b === rel) || rel.startsWith('docs/');
  const first = text.split('\n', 1)[0].trim();
  const m = SWITCH.exec(first);
  if (isPaired && !m) problems.push(`${rel}: 首行缺少语言切换行（[English](…) | [简体中文](…)）`);
  if (m) {
    for (const target of [m.groups?.en, m.groups?.zh].filter(Boolean)) {
      if (!existsSync(resolve(dirname(file), target))) problems.push(`${rel}: 语言切换行指向的文件不存在 → ${target}`);
    }
  }

  // 相对链接（跳过 http(s)、mailto、锚点、代码块与行内代码里的示例——规范文档常在反引号里写链接语法）
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const link of withoutCode.matchAll(/\]\((?<href>[^)\s]+)\)/g)) {
    const href = link.groups.href;
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = resolve(dirname(file), href.split('#')[0]);
    if (!existsSync(target)) problems.push(`${rel}: 相对链接指向不存在的路径 → ${href}`);
  }
}

if (problems.length) {
  console.error(`docs:check 失败（${problems.length} 项）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`docs:check 通过：${docs.size} 份文档，中英配对与相对链接均正常。`);
