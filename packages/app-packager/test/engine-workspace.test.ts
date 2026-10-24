/** Workspace + SDK helpers: the source project is never touched, the work copy is rebuilt. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSettings } from '../dist/engine/settings.js';
import { manifestJsoncToJson, prepareWorkspace } from '../dist/engine/workspace.js';
import { androidSdkReady, harmonySdkReady, iosSdkReady, iosSdkUniappxReady, sdkSeries } from '../dist/engine/sdk.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ws-'));

test('manifestJsoncToJson strips comments, keeps URLs and trailing-comma JSON valid', () => {
  const dir = temp();
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(
    file,
    '{\n  // 品牌\n  "name": "安居一",\n  /* 兼容 */\n  "url": "https://a.example/b",\n  "keys": ["x", "y",],\n}\n',
  );
  assert.equal(manifestJsoncToJson(file), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    name: '安居一',
    url: 'https://a.example/b',
    keys: ['x', 'y'],
  });
  assert.equal(manifestJsoncToJson(file), false, 'plain JSON is left alone');
});

test('manifestJsoncToJson leaves unparseable JSON for the caller to report', () => {
  const dir = temp();
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, '{ "name": 没有引号 }\n');
  assert.equal(manifestJsoncToJson(file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "name": 没有引号 }\n');
  assert.equal(manifestJsoncToJson(path.join(dir, 'missing.json')), false);
});

test('prepareWorkspace rebuilds the work copy and leaves the source untouched', async () => {
  const home = temp();
  const source = path.join(home, 'sources', 'anju');
  const workRoot = path.join(home, 'work');
  const workspace = path.join(workRoot, 'anju', 'anju-build-ios');
  fs.mkdirSync(path.join(source, '.git'), { recursive: true });
  fs.mkdirSync(path.join(source, 'node_modules', 'dep'), { recursive: true });
  fs.mkdirSync(path.join(source, 'unpackage'), { recursive: true });
  fs.writeFileSync(path.join(source, 'manifest.json'), '{\n  // c\n  "name": "安居一",\n}\n');
  fs.writeFileSync(path.join(source, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(source, 'App.vue'), '<template><view /></template>\n');
  // A stale previous build must disappear.
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'stale.txt'), 'old\n');

  const logFile = path.join(home, 'build.log');
  await prepareWorkspace({ sourceDir: source, workspace, workRoot, logFile });

  assert.equal(fs.existsSync(path.join(workspace, 'stale.txt')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'App.vue')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.git')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'unpackage')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'node_modules', 'dep', 'index.js')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, 'manifest.json'), 'utf8')), { name: '安居一' });
  assert.equal(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8').includes('// c'), true);
});

test('prepareWorkspace refuses a workspace outside the work root', async () => {
  const home = temp();
  const source = path.join(home, 'src');
  fs.mkdirSync(source, { recursive: true });
  await assert.rejects(
    prepareWorkspace({ sourceDir: source, workspace: path.join(home, 'elsewhere'), workRoot: path.join(home, 'work') }),
    /拒绝操作构建工作区之外的路径/,
  );
  await assert.rejects(
    prepareWorkspace({ sourceDir: path.join(home, 'nope'), workspace: path.join(home, 'work', 'x'), workRoot: path.join(home, 'work') }),
    /项目目录不存在/,
  );
});

test('sdkSeries prefers config, falls back to the packaged default', () => {
  assert.equal(sdkSeries({ SDK_SERIES: '5.31' }), '5.31');
  assert.equal(sdkSeries({}), '5.26');
});

test('SDK ready checks look at real artefacts, not the oh-package manifest', () => {
  const home = temp();
  const settings = loadSettings(home, { SDK_SERIES: '5.26' });
  const ios = path.join(home, 'sdk', '5.26', 'iOS');
  assert.equal(iosSdkReady(settings, home), false);
  fs.mkdirSync(path.join(ios, 'UniAppXDemo', 'UniAppXDemo.xcodeproj'), { recursive: true });
  fs.mkdirSync(path.join(ios, 'UniAppXDemo', 'SDK'), { recursive: true });
  assert.equal(iosSdkUniappxReady(settings, home), true);
  assert.equal(iosSdkReady(settings, home), true);

  const android = path.join(home, 'sdk', '5.26', 'Android');
  fs.mkdirSync(path.join(android, 'SDK', 'libs'), { recursive: true });
  assert.equal(androidSdkReady(settings, home), true);

  const harmony = path.join(home, 'sdk', '5.26', 'HarmonyOS');
  fs.mkdirSync(harmony, { recursive: true });
  fs.writeFileSync(path.join(harmony, 'oh-package.json5'), '{}\n');
  assert.equal(harmonySdkReady(settings, home), false);
  fs.mkdirSync(path.join(harmony, 'oh_modules', '@dcloudio', 'uni-app-x-runtime'), { recursive: true });
  assert.equal(harmonySdkReady(settings, home), true);
});
