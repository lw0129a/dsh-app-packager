/**
 * The TS port of the engine helpers has to answer exactly like the bash one,
 * because the two run side by side until the shell is gone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  absoluteDir,
  isUniAppProject,
  manifestMetadata,
  projectBundleIdFromSourceDir,
  projectIdFromSourceDir,
  projectIds,
  projectIsUniappx,
  relocateWorkRoot,
} from '../dist/engine/common.js';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ap-common-'));

test('manifestMetadata reads the fields packaging needs', () => {
  const dir = fixture();
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(
    file,
    `{
  // JSONC comments are allowed in manifest.json
  "name": "安居一",
  "appid": "__UNI__ABC123",
  "versionName": "1.2.3",
  "versionCode": 42,
  "app-plus": { "distribute": { "ios": { "capabilities": { "entitlements": { "associatedDomains": ["applinks:a.example.com"] } } } } }
}
`,
  );
  const meta = manifestMetadata(file);
  assert.equal(meta.name, '安居一');
  assert.equal(meta.appId, '__UNI__ABC123');
  assert.equal(meta.versionName, '1.2.3');
  assert.equal(meta.versionCode, '42');
  assert.deepEqual(meta.associatedDomains, ['applinks:a.example.com']);
});

test('manifestMetadata on a missing file is empty, not a crash', () => {
  const meta = manifestMetadata(path.join(fixture(), 'nope.json'));
  assert.deepEqual(meta, { name: '', appId: '', versionName: '', versionCode: '', associatedDomains: [] });
});

test('project detection wants manifest.json and pages.json, in the root or src/', () => {
  const dir = fixture();
  assert.equal(isUniAppProject(dir), false);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  assert.equal(isUniAppProject(dir), false);
  fs.writeFileSync(path.join(dir, 'pages.json'), '{}');
  assert.equal(isUniAppProject(dir), true);
  fs.rmSync(path.join(dir, 'manifest.json'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'manifest.json'), '{}');
  assert.equal(isUniAppProject(dir), true);
});

test('projectIsUniappx keys off "uni-app-x"', () => {
  const dir = fixture();
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, '{\n\t"name": "x",\n\t"uni-app-x": {}\n}\n');
  assert.equal(projectIsUniappx(file), true);
  fs.writeFileSync(file, '{\n\t"name": "x"\n}\n');
  assert.equal(projectIsUniappx(file), false);
  assert.equal(projectIsUniappx(path.join(dir, 'missing.json')), false);
});

test('projectIdFromSourceDir lowercases and collapses punctuation', () => {
  assert.equal(projectIdFromSourceDir('/tmp/An Juyi  App'), 'an-juyi-app');
  assert.equal(projectIdFromSourceDir('/tmp/a__b'), 'a__b');
  assert.equal(projectIdFromSourceDir('/tmp/--x--'), 'x');
  assert.match(projectIdFromSourceDir('/tmp/中文目录'), /^uni-app-\d{14}$/);
});

test('projectBundleIdFromSourceDir prefers the native gradle project, then adhoc.env', () => {
  const dir = fixture();
  assert.equal(projectBundleIdFromSourceDir(dir), undefined);
  fs.mkdirSync(path.join(dir, 'app-android', 'app'), { recursive: true });
  const gradle = path.join(dir, 'app-android', 'app', 'build.gradle');
  fs.writeFileSync(gradle, 'android {\n  defaultConfig {\n    applicationId "com.szaj.admin.app"\n  }\n}\n');
  assert.equal(projectBundleIdFromSourceDir(dir), 'com.szaj.admin.app');

  const other = fixture();
  fs.mkdirSync(path.join(other, 'scripts', 'ios-package', 'env'), { recursive: true });
  fs.writeFileSync(path.join(other, 'scripts', 'ios-package', 'env', 'adhoc.env'), 'BUNDLE_ID="com.example.ios"  # 注释\n');
  assert.equal(projectBundleIdFromSourceDir(other), 'com.example.ios');
});

test('relocateWorkRoot moves a node_modules workspace out and leaves others alone', () => {
  const env = {
    WORK_ROOT: '/Users/lw/.dsh/profiles/desktop/node_modules/dsh-app-packager/home/work',
    PIPELINE_ROOT: '/Users/lw/.dsh/profiles/desktop/node_modules/dsh-app-packager/home',
    HOME: '/Users/lw',
  };
  assert.equal(relocateWorkRoot(env, 'darwin'), '/Users/lw/.dsh/profiles/desktop/.app-packager/workspaces');

  const plain = { ...env, WORK_ROOT: '/Users/lw/work/app/workspace', PIPELINE_ROOT: '/Users/lw/work/app' };
  assert.equal(relocateWorkRoot(plain, 'darwin'), '/Users/lw/work/app/workspace');

  const outside = { WORK_ROOT: env.WORK_ROOT, PIPELINE_ROOT: env.PIPELINE_ROOT, HOME: '/Users/lw', APP_PACKAGER_CACHE_ROOT: '/tmp/cache' };
  assert.equal(relocateWorkRoot(outside, 'darwin'), '/tmp/cache/workspaces');
});

test('projectIds lists config/projects/*.env sorted, ignoring the example', () => {
  const home = fixture();
  fs.mkdirSync(path.join(home, 'config', 'projects'), { recursive: true });
  for (const name of ['b.env', 'a.env', 'project.env.example']) {
    fs.writeFileSync(path.join(home, 'config', 'projects', name), '');
  }
  assert.deepEqual(projectIds(home), ['a', 'b']);
});

test('absoluteDir resolves symlinks and rejects plain files', () => {
  const dir = fixture();
  assert.equal(absoluteDir(path.join(dir, 'missing')), undefined);
  fs.writeFileSync(path.join(dir, 'file'), '');
  assert.equal(absoluteDir(path.join(dir, 'file')), undefined);
  assert.equal(absoluteDir(dir), fs.realpathSync(dir));
});
