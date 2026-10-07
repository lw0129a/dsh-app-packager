/**
 * Checks for the AppPackager Node half: env parsing, project listing, engine
 * materialization and the doctor report. Everything runs on a throwaway home.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listProjects, parseEnvText } from '../src/projects.mjs';
import { HOME_GITIGNORE, engineEntryPath, isMaterialized, materialize, resolveHome } from '../src/home.mjs';
import { runDoctor } from '../src/doctor.mjs';

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('parseEnvText 处理引号、行内空白与变量展开', () => {
  const vars = { PIPELINE_ROOT: '/opt/app' };
  const parsed = parseEnvText(
    [
      '# 注释',
      'PROJECT_ID=demo',
      'APP_NAME="演示 应用"',
      "SCHEME='Release'",
      'SOURCE_DIR=$PIPELINE_ROOT/projects/demo',
      'PROFILE_FILE=${PIPELINE_ROOT}/signing/a.mobileprovision',
      'ESCAPED=a\\ b',
      'export TEAM_ID=ABC123',
    ].join('\n'),
    vars,
  );
  assert.equal(parsed.PROJECT_ID, 'demo');
  assert.equal(parsed.APP_NAME, '演示 应用');
  assert.equal(parsed.SCHEME, 'Release');
  assert.equal(parsed.SOURCE_DIR, '/opt/app/projects/demo');
  assert.equal(parsed.PROFILE_FILE, '/opt/app/signing/a.mobileprovision');
  assert.equal(parsed.ESCAPED, 'a b');
  assert.equal(parsed.TEAM_ID, 'ABC123');
});

test('listProjects 套用引擎的平台默认值（iOS/HarmonyOS 开，Android 关）', () => {
  const home = tempDir('app-packager-home-');
  const source = join(home, 'projects', 'demo');
  mkdirSync(source, { recursive: true });
  const dir = join(home, 'config', 'projects');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'demo.env'), `PROJECT_ID=demo\nAPP_NAME=演示\nSOURCE_DIR=${source}\nANDROID_ENABLED=true\n`);
  writeFileSync(join(dir, 'project.env.example'), 'PROJECT_ID=example\n');
  writeFileSync(join(dir, 'broken.env'), `PROJECT_ID=broken\nSOURCE_DIR=${join(home, 'missing')}\n`);

  const projects = listProjects(home);
  assert.deepEqual(projects.map((project) => project.id), ['broken', 'demo']);
  const demo = projects.find((project) => project.id === 'demo');
  assert.deepEqual(demo.enabledPlatforms, ['ios', 'android', 'harmony']);
  assert.equal(demo.sourceDirExists, true);
  assert.equal(demo.appName, '演示');
  const broken = projects.find((project) => project.id === 'broken');
  assert.equal(broken.sourceDirExists, false);

  rmSync(home, { recursive: true, force: true });
});

test('materialize 复制引擎、二次调用不再复制、保留本地配置', () => {
  const home = tempDir('app-packager-home-');
  const first = materialize(home);
  assert.ok(first.copied > 0);
  assert.equal(first.upToDate, false);
  assert.ok(isMaterialized(home));
  assert.ok(existsSync(engineEntryPath(home)));
  assert.ok(readFileSync(join(home, 'lib', 'common.sh'), 'utf8').includes('PROJECT_SEARCH_ROOTS'));

  // The home gets secret-protecting ignore rules; the packaged engine has no
  // `.gitignore` of its own (npm drops it), so the fallback must list them.
  assert.ok(readFileSync(join(home, '.gitignore'), 'utf8').includes('config/projects/*.env'));
  for (const pattern of ['config/*.local.env', 'certificates/*', 'sdk/*', '*.p12']) {
    assert.ok(HOME_GITIGNORE.includes(pattern), `.gitignore 模板缺少 ${pattern}`);
  }

  // A user-owned file must survive a forced refresh.
  writeFileSync(join(home, 'config', 'settings.local.env'), 'LOCAL_TWEAK=1\n');
  const second = materialize(home, { force: true });
  assert.equal(second.copied, first.copied);
  assert.equal(readFileSync(join(home, 'config', 'settings.local.env'), 'utf8').trim(), 'LOCAL_TWEAK=1');

  const third = materialize(home);
  assert.equal(third.upToDate, true);
  assert.equal(third.copied, 0);

  rmSync(home, { recursive: true, force: true });
});

test('resolveHome 尊重显式目录与 APP_PACKAGER_HOME', () => {
  const previous = process.env.APP_PACKAGER_HOME;
  process.env.APP_PACKAGER_HOME = '/tmp/explicit-home';
  try {
    // resolveHome 会规范化成绝对路径（Windows 上 /tmp/... 变成 D:\tmp\...），所以按平台期望比较
    assert.equal(resolveHome(), resolve('/tmp/explicit-home'));
    assert.equal(resolveHome('/tmp/other'), resolve('/tmp/other'));
  } finally {
    if (previous === undefined) delete process.env.APP_PACKAGER_HOME;
    else process.env.APP_PACKAGER_HOME = previous;
  }
});

test('runDoctor 报告检查项且失败数与状态一致', () => {
  const home = tempDir('app-packager-home-');
  materialize(home);
  const report = runDoctor({ home, platform: 'android' });
  assert.equal(report.platformName, 'Android (APK)');
  assert.ok(report.checks.length > 0);
  assert.equal(report.checks.filter((check) => check.status === 'fail').length, report.failures);
  assert.equal(report.ok, report.failures === 0);
  assert.ok(report.checks.some((check) => check.id === 'node'));
  rmSync(home, { recursive: true, force: true });
});
