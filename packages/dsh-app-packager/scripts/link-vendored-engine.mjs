#!/usr/bin/env node
/**
 * The plugin is published as ONE package: the engine is copied into
 * `vendor/app-packager` by scripts/vendor-engine.mjs. Source code still says
 * `import ... from 'app-packager'` (that is how TypeScript resolves the types
 * through the workspace link), so the emitted JS is fixed up here to point at
 * the vendored copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(path.dirname(here), 'dist');
// 只改模块说明符，别碰 `export const name = 'app-packager'` 这种字符串。
const from = /(\bfrom\s*)(['"])app-packager\2/g;
const dynamic = /\bimport\(\s*(['"])app-packager\1\s*\)/g;
const target = "'../vendor/app-packager/dist/index.js'";

let rewritten = 0;
for (const file of fs.readdirSync(dist).filter((name) => name.endsWith('.js'))) {
  const pathname = path.join(dist, file);
  const source = fs.readFileSync(pathname, 'utf8');
  const next = source.replace(from, `$1${target}`).replace(dynamic, `import(${target})`);
  if (next === source) continue;
  fs.writeFileSync(pathname, next);
  rewritten += 1;
}
console.log(`rewrote app-packager imports in ${rewritten} file(s)`);
