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
import { listArtifacts, listUploaders, pgyerCliStatus, selectableUploaders, writeUploaderCredential } from '../src/uploaders.mjs';
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
      'UPLOAD_PLATFORM_pgyer_API_KEY_VAR=PGYER_API_KEY',
      'UPLOAD_PLATFORM_pgyer_USER_KEY_VAR=PGYER_USER_KEY',
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
    apiKeyVar: 'PGYER_API_KEY',
    credentialConfigured: false,
    userKeyVar: 'PGYER_USER_KEY',
    userKeyConfigured: false,
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

  // 密钥只回报「配没配」，明文永远不出现在这个结构里。
  writeFileSync(join(home, 'config', 'upload.local.env'), "PGYER_API_KEY='from-local'\nPGYER_USER_KEY='user-local'\n");
  const withKey = listUploaders(home)[0];
  assert.equal(withKey.credentialConfigured, true, 'config/upload.local.env 里配了密钥就算已配置');
  assert.equal(withKey.userKeyConfigured, true, 'User Key 同样只看配没配');
  assert.equal(JSON.stringify(withKey).includes('from-local'), false, '密钥明文不能出现在 listUploaders 结果里');
  assert.equal(JSON.stringify(withKey).includes('user-local'), false, 'User Key 明文也不能出现');

  writeFileSync(join(home, 'config', 'upload.local.env'), 'UPLOAD_PLATFORM_IDS="nope"\n');
  rmSync(join(home, 'lib', 'uploaders', 'pgyer.sh'), { force: true });
  // UPLOAD_PLATFORM_IDS 只认 upload.env（本地文件不覆盖它），脚本删掉后 pgyer 不可用。
  assert.equal(listUploaders(home)[0].reason, 'script');
  rmSync(home, { recursive: true, force: true });
});

test('writeUploaderCredential 写 config/upload.local.env（保留其它行、可清空、mode 600）', () => {
  const home = tempDir('app-packager-cred-');
  mkdirSync(join(home, 'config'), { recursive: true });
  const file = join(home, 'config', 'upload.local.env');
  writeFileSync(file, '# 手写的备注\nUPLOAD_PLATFORM_huawei_ENABLED=true\n', { mode: 0o644 });

  const first = writeUploaderCredential(home, 'PGYER_API_KEY', 'abc123');
  assert.equal(first.configured, true);
  assert.equal(first.name, 'PGYER_API_KEY');
  let text = readFileSync(file, 'utf8');
  assert.match(text, /^# 由面板写入的本机上传配置/m);
  assert.ok(text.includes('UPLOAD_PLATFORM_huawei_ENABLED=true'), '其它行要保留');
  assert.ok(text.includes("PGYER_API_KEY='abc123'"));
  assert.equal(statSync(file).mode & 0o777, 0o600, '放密钥的文件要是 600');

  // 覆盖：同名行只留一条，引号里的单引号要转义。
  writeUploaderCredential(home, 'PGYER_API_KEY', "it's-2");
  text = readFileSync(file, 'utf8');
  assert.equal(text.split('PGYER_API_KEY=').length - 1, 1, '同名行只留一条');
  assert.ok(text.includes(`PGYER_API_KEY='it'\\''s-2'`), "单引号按 POSIX 拼成 '\\''");
  // 普通值必须能原样读回（Node 侧的 env 解析器不做 POSIX 拼接，所以只钉简单值）。
  writeUploaderCredential(home, 'PGYER_API_KEY', 'plain-2');
  assert.equal(parseEnvText(readFileSync(file, 'utf8')).PGYER_API_KEY, 'plain-2');

  // 空值 = 清除。
  const cleared = writeUploaderCredential(home, 'PGYER_API_KEY', '');
  assert.equal(cleared.configured, false);
  assert.equal(readFileSync(file, 'utf8').includes('PGYER_API_KEY'), false);

  assert.throws(() => writeUploaderCredential(home, 'BAD-NAME', 'x'), /非法配置项/);
  rmSync(home, { recursive: true, force: true });
});

test('listArtifacts 列出各平台已归档的安装包，缺文件的也如实标出来', () => {
  const home = tempDir('app-packager-artifacts-');
  const ios = join(home, 'packages', 'iOS');
  const android = join(home, 'packages', 'Android');
  mkdirSync(ios, { recursive: true });
  mkdirSync(android, { recursive: true });
  writeFileSync(join(ios, 'demo-latest.ipa'), 'ipa-bytes');
  writeFileSync(join(ios, 'demo-latest.json'), JSON.stringify({
    project_id: 'demo',
    display_name: '演示项目',
    version: '1.0.0',
    built_at: '2026-10-07T18:24:00+08:00',
    ipa_path: join(ios, 'demo-latest.ipa'),
  }));
  // Android 的包已经没了（-latest.json 还在），要能报出来而不是给一个死链。
  writeFileSync(join(android, 'other-latest.json'), JSON.stringify({
    project_id: 'other',
    version: '2.0.0',
    built_at: '2026-10-07T19:00:00+08:00',
    apk_path: join(android, 'other-latest.apk'),
  }));
  // 半截 JSON 不是产物，直接跳过。
  writeFileSync(join(android, 'broken-latest.json'), '{');

  const artifacts = listArtifacts(home);
  assert.deepEqual(artifacts.map((item) => `${item.platform}:${item.projectId}`), ['android:other', 'ios:demo'], '按打包时间倒序');
  const [other, demo] = artifacts;
  assert.equal(other.artifactExists, false, 'apk 不在就要如实说');
  assert.equal(other.artifactSize, 0);
  assert.equal(other.displayName, 'other', '没有 display_name 时退回项目 ID');
  assert.equal(demo.displayName, '演示项目');
  assert.equal(demo.version, '1.0.0');
  assert.equal(demo.artifactExists, true);
  assert.equal(demo.artifactSize, 'ipa-bytes'.length);
  assert.equal(demo.infoFile, join(ios, 'demo-latest.json'));

  assert.deepEqual(listArtifacts(join(home, 'nowhere')), [], '没有 packages 目录就是空列表');
  rmSync(home, { recursive: true, force: true });
});

test('pgyerCliStatus 报告插件目录里的官方 CLI 安装状态', () => {
  const home = tempDir('app-packager-pgyer-cli-');
  const missing = pgyerCliStatus(home);
  assert.equal(missing.installed, false);
  assert.equal(missing.dir, join(home, 'tools', 'pgyer-cli'));
  assert.equal(missing.package, '@pgyer/cli');

  mkdirSync(join(missing.dir, 'node_modules', '@pgyer', 'cli'), { recursive: true });
  mkdirSync(join(missing.dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(missing.dir, 'package.json'), JSON.stringify({ dependencies: { '@pgyer/cli': '^0.1.5' } }));
  writeFileSync(join(missing.dir, 'node_modules', '@pgyer', 'cli', 'package.json'), JSON.stringify({ version: '0.1.9' }));
  writeFileSync(missing.bin, '#!/bin/sh\n', { mode: 0o755 });

  const installed = pgyerCliStatus(home);
  assert.equal(installed.installed, true);
  assert.equal(installed.package, '@pgyer/cli');
  assert.equal(installed.version, '0.1.9', '版本取实际装到的那份，而不是 upload.env 里声明的');
  rmSync(home, { recursive: true, force: true });
});
