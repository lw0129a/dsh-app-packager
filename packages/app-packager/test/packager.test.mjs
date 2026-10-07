/**
 * Checks for the AppPackager Node half: env parsing, project listing, engine
 * materialization and the doctor report. Everything runs on a throwaway home.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listProjects, parseEnvText } from '../src/projects.mjs';
import { listUploaders, selectableUploaders } from '../src/uploaders.mjs';
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

test('parseEnvText 读得懂 printf %q 写出的 ANSI-C 值（含中文）', () => {
  // `printf '%q'` writes non-ASCII names as ANSI-C escapes; bash 3.2 on macOS
  // mixes raw bytes and escapes, so both shapes must decode to the same text.
  const octal = parseEnvText("APP_NAME=$'\\346\\274\\224\\347\\244\\272\\345\\272\\224\\347\\224\\250'\n");
  assert.equal(octal.APP_NAME, '演示应用');
  assert.equal(parseEnvText("SCHEME=UniAppX\n").SCHEME, 'UniAppX');
});

test('listProjects 还原 %q 写坏的 APP_NAME（半截 UTF-8 字节）', () => {
  const home = tempDir('app-packager-home-');
  const dir = join(home, 'config', 'projects');
  mkdirSync(dir, { recursive: true });
  // Byte-for-byte what macOS bash 3.2 `printf '%q'` produced for 演示应用:
  // raw e6 bc, then \224, then 示 — invalid UTF-8, so a plain utf8 read mangles it.
  const name = Buffer.concat([
    Buffer.from("PROJECT_ID=demo\nAPP_NAME=$'", 'utf8'),
    Buffer.from([0xe6, 0xbc]),
    Buffer.from('\\224', 'utf8'),
    Buffer.from('示', 'utf8'),
    Buffer.from([0xe5, 0xba]),
    Buffer.from('\\224', 'utf8'),
    Buffer.from([0xe7]),
    Buffer.from('\\224', 'utf8'),
    Buffer.from([0xa8]),
    Buffer.from("'\nSOURCE_DIR=", 'utf8'),
    Buffer.from(join(home, 'demo'), 'utf8'),
    Buffer.from('\n', 'utf8'),
  ]);
  writeFileSync(join(dir, 'demo.env'), name);

  const projects = listProjects(home);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].appName, '演示应用');
  rmSync(home, { recursive: true, force: true });
});

test('materialize 复制引擎、二次调用不再复制、保留本地配置', () => {
  const home = tempDir('app-packager-home-');
  const first = materialize(home);
  assert.ok(first.copied > 0);
  assert.equal(first.upToDate, false);
  assert.ok(isMaterialized(home));
  assert.ok(existsSync(engineEntryPath(home)));
  if (process.platform !== 'win32') {
    // pnpm pack 打的 tarball 里 `.command` 是 644，物化时必须补回可执行位（Finder 双击要用）
    assert.ok((statSync(engineEntryPath(home)).mode & 0o111) !== 0, '打包工具.command 应可执行');
  }
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

test('listUploaders 按 config/upload.env 判定可勾选的上传平台', () => {
  const home = tempDir('app-packager-upload-');
  mkdirSync(join(home, 'config'), { recursive: true });
  mkdirSync(join(home, 'lib', 'uploaders'), { recursive: true });
  writeFileSync(join(home, 'lib', 'uploaders', 'pgyer.sh'), 'upload_pgyer_artifact() {\n  :\n}\n');
  writeFileSync(join(home, 'lib', 'uploaders', 'declared_missing.sh'), 'something_else() {\n  :\n}\n');
  writeFileSync(
    join(home, 'config', 'upload.env'),
    [
      'UPLOAD_PLATFORM_IDS="pgyer huawei declared_missing"',
      'UPLOAD_PLATFORM_pgyer_NAME="蒲公英"',
      'UPLOAD_PLATFORM_pgyer_ENABLED=true',
      'UPLOAD_PLATFORM_pgyer_PLATFORMS="ios android harmony"',
      'UPLOAD_PLATFORM_pgyer_SCRIPT=lib/uploaders/pgyer.sh',
      'UPLOAD_PLATFORM_pgyer_FUNCTION=upload_pgyer_artifact',
      'UPLOAD_PLATFORM_huawei_NAME="华为应用市场"',
      'UPLOAD_PLATFORM_huawei_ENABLED=false',
      'UPLOAD_PLATFORM_declared_missing_NAME="没实现"',
      'UPLOAD_PLATFORM_declared_missing_ENABLED=true',
      'UPLOAD_PLATFORM_declared_missing_SCRIPT=lib/uploaders/declared_missing.sh',
      'UPLOAD_PLATFORM_declared_missing_FUNCTION=upload_missing_artifact',
    ].join('\n'),
  );

  const uploaders = listUploaders(home);
  // 带连字符的 id 不能拼成 shell 变量名，直接忽略（引擎侧同样取不到）。
  assert.deepEqual(uploaders.map((item) => item.id), ['pgyer', 'huawei', 'declared_missing']);
  assert.deepEqual(uploaders[0], {
    id: 'pgyer',
    name: '蒲公英',
    enabled: true,
    available: true,
    platforms: ['ios', 'android', 'harmony'],
    script: join(home, 'lib', 'uploaders', 'pgyer.sh'),
    reason: '',
  });
  assert.equal(uploaders[1].available, false);
  assert.equal(uploaders[1].reason, 'disabled', 'ENABLED=false 直接不可用');
  assert.equal(uploaders[2].available, false);
  assert.equal(uploaders[2].reason, 'function', '脚本在但没有声明 FUNCTION 指定的函数');

  // 缺省（ENABLED 未写）与 upload.local.env 覆盖。
  writeFileSync(join(home, 'config', 'upload.local.env'), 'UPLOAD_PLATFORM_huawei_ENABLED=true\nUPLOAD_PLATFORM_huawei_PLATFORMS="android harmony"\nUPLOAD_PLATFORM_huawei_SCRIPT=lib/uploaders/pgyer.sh\nUPLOAD_PLATFORM_huawei_FUNCTION=upload_pgyer_artifact\n');
  const overridden = listUploaders(home).find((item) => item.id === 'huawei');
  assert.equal(overridden.enabled, true);
  assert.equal(overridden.available, true, '本地覆盖可以放行');
  assert.deepEqual(overridden.platforms, ['android', 'harmony']);
  assert.deepEqual(selectableUploaders(home, ['ios']).map((item) => item.id), ['pgyer'], '按产物平台过滤');

  writeFileSync(join(home, 'config', 'upload.local.env'), 'UPLOAD_PLATFORM_IDS="nope"\n');
  rmSync(join(home, 'lib', 'uploaders', 'pgyer.sh'), { force: true });
  // UPLOAD_PLATFORM_IDS 只认 upload.env（本地文件不覆盖它），脚本删掉后 pgyer 不可用。
  assert.equal(listUploaders(home)[0].reason, 'script');
  rmSync(home, { recursive: true, force: true });
});
