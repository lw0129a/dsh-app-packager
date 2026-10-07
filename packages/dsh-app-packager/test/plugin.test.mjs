/**
 * Checks for the AppPackager host plugin and its harness bundle.
 *
 * The plugin is exercised against a fake harness context (a tool registry that
 * records definitions, plus an optional fake web server that records routes) and
 * a throwaway APP_PACKAGER_HOME, so nothing here touches a real profile or a
 * real build. The browser half is loaded with a stub `react` and a stub module
 * loader, which catches typos in the panel render path. `node --test` from the
 * package dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply, inject, name } from '../index.js';
import { createJobRunner, createPanel, engineArgsFor, engineCommandsFor, mountWebPanel, scopePlatforms, sdkPlatforms, summarizeOutput } from '../web.js';
import { LEGACY_HOME_NAME, homeInPlugin, isNewerVersion, legacyHome, pluginRoot, resolvePluginHome, upgradeBackupDir, withHomePreserved } from '../index.mjs';

/**
 * Mirror cordis service access: reading `ctx.<service>` without declaring it in
 * `inject` throws, and `ctx.get(name)` is the only allowed lookup.
 */
function withServices(ctx, services = {}) {
  for (const name of Object.keys(services)) {
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        throw new Error(`cannot get property "${name}" without inject`);
      },
    });
  }
  ctx.get = (name) => services[name];
  return ctx;
}

/** Capture what the plugin registers instead of mounting a real Harness. */
function harness() {
  const tools = new Map();
  tools.register = (definition) => {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  };
  return { tools, ctx: withServices({ tools }, { webServer: undefined }) };
}

/** Fake harness context that also serves the panel's HTTP routes. */
function webHarness() {
  const { tools, ctx } = harness();
  const routes = new Map();
  const service = {
    register({ path, handler }) {
      routes.set(path, handler);
      return () => routes.delete(path);
    },
  };
  withServices(ctx, { webServer: service });
  return { ctx, routes };
}

/** Minimal request/response pair for the panel handlers. */
function fakeReq({ method = 'GET', url = '/', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(text) {
      this.body = text;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

/** A spawn stub: records the argv, streams one line, resolves once settled. */
function fakeSpawn(record, { code = 0, hang = false, stdout = 'done\n' } = {}) {
  return (home, args, options) =>
    new Promise((resolve) => {
      record.push({ home, args });
      options.onSpawn?.({ kill: (signal) => record.push({ killed: signal }) });
      // Faithful to runEngine: complete lines stream through onLine *and* the
      // captured stdout is returned, so the runner must not print them twice.
      options.onLine?.('engine line', 'stdout');
      for (const line of String(stdout).split('\n')) if (line) options.onLine?.(line, 'stdout');
      if (hang) return;
      setImmediate(() => resolve({ code, signal: null, stdout, stderr: '' }));
    });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A fake engine home with one configured project and its source tree. */
function fixtureHome() {
  const home = mkdtempSync(join(tmpdir(), 'app-packager-plugin-'));
  mkdirSync(join(home, 'projects', 'demo'), { recursive: true });
  writeFileSync(join(home, 'projects', 'demo', 'manifest.json'), '{"name":"演示应用"}');
  return home;
}

function toolOf(ctx, toolName) {
  const definition = ctx.tools.get(toolName);
  assert.ok(definition, `tool ${toolName} 未注册`);
  return definition;
}

test('plugin 暴露名称、inject 与四个工具', () => {
  const { ctx, tools } = harness();
  apply(ctx);
  assert.equal(name, 'app-packager');
  assert.deepEqual(inject, ['tools']);
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['app_packager_build', 'app_packager_check', 'app_packager_doctor', 'app_packager_list'],
  );
  // The host validates output.schema with assertSupportedJsonSchema before it
  // inserts the tool; a bogus type here (e.g. the `json` shorthand) throws and
  // deactivates the whole plugin entry, so mirror that rule exactly.
  const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
  for (const definition of tools.values()) {
    assert.equal(definition.parameters.type, 'object');
    assert.ok(SCHEMA_TYPES.includes(definition.output.schema.type), `${definition.name} output.schema.type`);
    assert.equal(typeof definition.output.render, 'function');
    assert.equal(typeof definition.execute, 'function');
  }
});

/**
 * Mirror the harness rule that took the whole plugin down: `required` is only
 * supported on object schemas and must be an array of property names — never
 * `required: true` / `required: false` on an individual property.
 */
function requiredKeywordViolations(node, path, violations = []) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => requiredKeywordViolations(entry, `${path}[${index}]`, violations));
    return violations;
  }
  if (!node || typeof node !== 'object') return violations;
  if (Object.hasOwn(node, 'required')) {
    if (node.type !== 'object') {
      violations.push(`${path}.required is only supported on object schemas`);
    } else if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== 'string')) {
      violations.push(`${path}.required must be an array of strings`);
    } else {
      const properties = node.properties && typeof node.properties === 'object' ? node.properties : {};
      for (const key of node.required) {
        if (!Object.hasOwn(properties, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'required') requiredKeywordViolations(value, `${path}.${key}`, violations);
  }
  return violations;
}

test('四个工具的参数 schema 通过 Harness 的 required 子集校验', () => {
  const { ctx, tools } = harness();
  apply(ctx);
  for (const definition of tools.values()) {
    const violations = requiredKeywordViolations(definition.parameters, `${definition.name}.parameters`);
    assert.deepEqual(violations, [], violations.join('; '));
  }
  const build = toolOf(ctx, 'app_packager_build');
  assert.deepEqual(build.parameters.required, ['platform']);
  assert.ok(!Object.hasOwn(build.parameters.properties.platform, 'required'));
  assert.ok(!Object.hasOwn(toolOf(ctx, 'app_packager_check').parameters.properties.platform, 'required'));
});

test('app_packager_list 物化引擎并读出项目', async () => {
  const home = fixtureHome();
  const { ctx } = harness();
  apply(ctx);
  const definition = toolOf(ctx, 'app_packager_list');

  mkdirSync(join(home, 'config', 'projects'), { recursive: true });
  writeFileSync(
    join(home, 'config', 'projects', 'demo.env'),
    `PROJECT_ID=demo\nAPP_NAME=演示应用\nSOURCE_DIR=${join(home, 'projects', 'demo')}\nIOS_ENABLED=true\nANDROID_ENABLED=true\nHARMONY_ENABLED=false\n`,
  );

  const value = await definition.execute({ home });
  assert.equal(value.home, home);
  assert.equal(value.materialized, true, '首次调用应物化引擎');
  assert.equal(value.projects.length, 1);
  assert.equal(value.projects[0].id, 'demo');
  assert.equal(value.projects[0].sourceDirExists, true);
  assert.deepEqual(value.projects[0].enabledPlatforms, ['ios', 'android']);

  const [rendered] = definition.output.render({}, value);
  assert.equal(rendered.type, 'text');
  assert.match(rendered.text, /demo/);

  // Second call reuses the materialized engine instead of recopying it.
  const again = await definition.execute({ home });
  assert.equal(again.materialized, false);

  rmSync(home, { recursive: true, force: true });
});

test('app_packager_doctor 返回结构化检查项', async () => {
  const home = fixtureHome();
  const { ctx } = harness();
  apply(ctx);
  const definition = toolOf(ctx, 'app_packager_doctor');

  const value = await definition.execute({ home, platform: 'android' });
  assert.equal(value.platform, 'android');
  assert.equal(typeof value.ok, 'boolean');
  assert.ok(Array.isArray(value.checks) && value.checks.length > 0);
  assert.ok(value.checks.every((check) => ['ok', 'warn', 'fail'].includes(check.status)));
  assert.equal(value.checks.filter((check) => check.status === 'fail').length, value.failures);

  const [rendered] = definition.output.render({}, value);
  assert.match(rendered.text, /环境检查/);

  rmSync(home, { recursive: true, force: true });
});

test('app_packager_build 拒绝非法平台，且不会启动引擎', async () => {
  const { ctx } = harness();
  apply(ctx);
  const definition = toolOf(ctx, 'app_packager_build');
  await assert.rejects(() => definition.execute({ platform: 'windows' }), /platform 必须是/);
  await assert.rejects(() => definition.execute({}), /platform 必须是/);
});

test('engineArgsFor：check 是引擎子命令，必须排在平台前面', () => {
  assert.deepEqual(engineArgsFor({ platform: 'android', project: 'demo' }, { check: true }), ['check', 'android', 'demo']);
  assert.deepEqual(engineArgsFor({ platform: 'all' }, { check: true }), ['check', 'all']);
  assert.deepEqual(engineArgsFor({ platform: 'ios', project: 'demo', noUpload: true }), ['ios', 'demo', '--no-upload']);
  assert.throws(() => engineArgsFor({ platform: 'windows' }), /platform 必须是/);
});

test('apply 在存在 webServer 时挂上面板路由，缺席时不影响工具', async () => {
  const home = fixtureHome();
  const { ctx, routes } = webHarness();
  apply(ctx, { home });
  assert.deepEqual(
    [...routes.keys()].sort(),
    [
      '/api/app-packager/doctor',
      '/api/app-packager/init',
      '/api/app-packager/job',
      '/api/app-packager/job/kill',
      '/api/app-packager/job/log',
      '/api/app-packager/pick',
      '/api/app-packager/project',
      '/api/app-packager/project/remove',
      '/api/app-packager/state',
    ],
  );
  // Without a web server the plugin still loads (no optional inject in cordis).
  const { ctx: plainCtx } = harness();
  apply(plainCtx, { home });
  assert.equal(plainCtx.tools.size, 4);
  rmSync(home, { recursive: true, force: true });
});

test('webServer 晚到：apply 用 ctx.inject 等它，服务出现后补挂路由', () => {
  const home = fixtureHome();
  const { ctx } = harness();
  const waits = [];
  ctx.inject = (deps, callback) => waits.push({ deps, callback });

  apply(ctx, { home });
  assert.equal(ctx.tools.size, 4, '工具照常注册');
  assert.equal(waits.length, 1);
  assert.deepEqual(waits[0].deps, ['webServer']);

  // The host hands a context with the service injected; routes appear then.
  const routes = new Map();
  const service = {
    register({ path, handler }) {
      routes.set(path, handler);
      return () => routes.delete(path);
    },
  };
  waits[0].callback(withServices({}, { webServer: service }));
  assert.equal(routes.size, 9);
  rmSync(home, { recursive: true, force: true });
});

test('打包契约：exports/client 入口、files 与 bundle id 都指向浏览器侧', () => {
  const dir = new URL('..', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
  assert.equal(pkg.dsh.client.platform, 'web');
  const entry = pkg.exports['./client'];
  const file = typeof entry === 'string' ? entry : entry.default;
  assert.equal(file, './client.js');
  assert.ok(readFileSync(new URL(file, dir), 'utf8').length > 0, 'exports["./client"] 必须存在');
  for (const listed of ['index.js', 'web.js', 'client.js', 'cordis.patch.yml']) {
    assert.ok(pkg.files.includes(listed), `files 必须包含 ${listed}`);
  }
  // The host keys its module table by package name, not by the patch row id.
  assert.match(readFileSync(new URL('client.js', dir), 'utf8'), /__ModuleLoader__\.load\(\{\s*id:\s*'dsh-app-packager'/);
});

test('面板路由：state / init / doctor 走通，非法平台报错且不启动引擎', async () => {
  const home = fixtureHome();
  const { ctx, routes } = webHarness();
  apply(ctx, { home });

  const stateRes = fakeRes();
  await routes.get('/api/app-packager/state')(fakeReq(), stateRes);
  assert.equal(stateRes.statusCode, 200);
  const state = stateRes.json();
  assert.equal(state.home, home);
  assert.equal(state.materialized, false, '未物化时 state 如实报告');
  assert.ok(Array.isArray(state.projects));
  assert.ok(state.shell && typeof state.shell.available === 'boolean');

  const initRes = fakeRes();
  await routes.get('/api/app-packager/init')(fakeReq({ method: 'POST', body: {} }), initRes);
  assert.equal(initRes.statusCode, 200);
  assert.equal(initRes.json().materialized, true);

  const doctorRes = fakeRes();
  await routes.get('/api/app-packager/doctor')(fakeReq({ method: 'POST', body: { platform: 'android' } }), doctorRes);
  assert.equal(doctorRes.statusCode, 200);
  const report = doctorRes.json();
  assert.equal(report.platform, 'android');
  assert.ok(report.checks.length > 0);

  const badRes = fakeRes();
  await routes.get('/api/app-packager/job')(fakeReq({ method: 'POST', body: { kind: 'build', platform: 'windows' } }), badRes);
  assert.equal(badRes.statusCode, 500);
  assert.match(badRes.json().error, /platform 必须是/);

  // /project without a directory must fail before any engine run.
  const noDirRes = fakeRes();
  await routes.get('/api/app-packager/project')(fakeReq({ method: 'POST', body: {} }), noDirRes);
  assert.equal(noDirRes.statusCode, 500);
  assert.match(noDirRes.json().error, /请先选择或输入项目目录/);
  rmSync(home, { recursive: true, force: true });
});

test('面板登记项目：pick 走注入的选择器，project 调引擎 register 子命令', async () => {
  const home = fixtureHome();
  const record = [];
  const picked = [];
  const panel = createPanel({
    config: { home },
    spawn: fakeSpawn(record),
    pick: async (options) => {
      picked.push(options);
      return { path: '/tmp/anjuyi/uni-platform-app' };
    },
  });

  assert.equal((await panel.pickFolder()).path, '/tmp/anjuyi/uni-platform-app');
  assert.equal(picked.length, 1, 'pick 由宿主注入，测试里绝不弹真实对话框');

  await assert.rejects(() => panel.addProject({ dir: '   ' }), /请先选择或输入项目目录/);

  const result = await panel.addProject({ dir: '/tmp/anjuyi/uni-platform-app' });
  assert.deepEqual(record[0].args, ['register', '/tmp/anjuyi/uni-platform-app'], '登记复用引擎的 register 子命令');
  assert.equal(result.code, 0);
  assert.deepEqual(result.dirs, ['/tmp/anjuyi/uni-platform-app']);
  assert.ok(Array.isArray(result.projects));

  // 多选目录：换行或逗号分隔都合成一次 register 调用。
  const multi = await panel.addProject({ dir: '/tmp/a\n/tmp/b, /tmp/c\n\n' });
  assert.deepEqual(record[1].args, ['register', '/tmp/a', '/tmp/b', '/tmp/c']);
  assert.deepEqual(multi.dirs, ['/tmp/a', '/tmp/b', '/tmp/c']);
  rmSync(home, { recursive: true, force: true });
});

test('面板删除项目：只删引擎自己写的 .env，未登记的项目一律拒绝', async () => {
  const home = fixtureHome();
  mkdirSync(join(home, 'config', 'projects'), { recursive: true });
  writeFileSync(join(home, 'config', 'projects', 'demo.env'), 'SOURCE_DIR="/tmp/demo"\n');
  writeFileSync(join(home, 'config', 'projects', 'keep.env'), 'SOURCE_DIR="/tmp/keep"\n');
  const panel = createPanel({ config: { home }, spawn: fakeSpawn([]) });

  assert.throws(() => panel.removeProject({ id: '../../README' }), /未登记的项目/);
  const removed = panel.removeProject({ id: 'demo' });
  assert.equal(removed.id, 'demo');
  assert.deepEqual(removed.projects.map((project) => project.id), ['keep']);
  assert.throws(() => panel.removeProject({ id: 'demo' }), /未登记的项目/, '删过就不再是登记项目');
  assert.ok(readFileSync(join(home, 'config', 'projects', 'keep.env'), 'utf8').includes('/tmp/keep'), '其它项目不受影响');
  rmSync(home, { recursive: true, force: true });
});

test('面板任务：check 传 check 子命令、日志可轮询、运行中可取消', async () => {
  const home = fixtureHome();
  const record = [];
  const panel = createPanel({ config: { home }, spawn: fakeSpawn(record) });
  const started = panel.startJob({ kind: 'check', platform: 'android', project: 'demo' });
  assert.equal(started.running, true);
  assert.deepEqual(record[0].args, ['check', 'android', 'demo']);
  await settle();
  await settle();

  const job = panel.jobLog(started.id);
  assert.equal(job.running, false);
  assert.equal(job.ok, true);
  assert.match(job.output, /engine line/);
  assert.match(job.output, /done/);
  assert.throws(() => panel.jobLog('job-404'), /未知任务/);

  const killed = [];
  const canceller = createPanel({ config: { home }, spawn: fakeSpawn(killed, { hang: true }) });
  const running = canceller.startJob({ kind: 'build', platform: 'ios', skipCheck: true });
  assert.deepEqual(killed[0].args, ['ios', '--all'], 'build 不加 check；不给项目要补 --all，否则引擎 die');
  await canceller.killJob(running.id);
  assert.deepEqual(killed[1], { killed: 'SIGTERM' });
  rmSync(home, { recursive: true, force: true });
});

test('打包前先按同一组项目与平台检查：不通过就不打包', async () => {
  const home = fixtureHome();
  const record = [];
  const spawn = (dir, args, options) =>
    fakeSpawn(record, args[0] === 'check'
      ? { code: 1, stdout: '[FAIL] Profile 不存在: /tmp/demo.mobileprovision\n结果: errors=1 warnings=0\n' }
      : { code: 0 })(dir, args, options);
  const panel = createPanel({ config: { home }, spawn });
  const started = panel.startJob({ kind: 'build', platform: 'ios', project: 'demo' });
  for (let index = 0; index < 4; index += 1) await settle();

  const job = panel.jobLog(started.id);
  assert.deepEqual(record.map((entry) => entry.args), [['check', 'ios', 'demo']], '检查没过，引擎的打包命令一次都没跑');
  assert.equal(job.blockedByCheck, true);
  assert.equal(job.code, 1);
  assert.equal(job.ok, false);
  assert.match(job.output, /打包前环境检查（1 项）/);
  assert.match(job.output, /已停止打包/);
  rmSync(home, { recursive: true, force: true });
});

test('打包前检查通过才继续；skipCheck 直接打包', async () => {
  const home = fixtureHome();
  const record = [];
  const panel = createPanel({ config: { home }, spawn: fakeSpawn(record, { code: 0, stdout: '[OK]   源码目录: /tmp/demo\n' }) });
  const started = panel.startJob({ kind: 'build', platform: 'ios', project: 'demo' });
  for (let index = 0; index < 6; index += 1) await settle();

  const job = panel.jobLog(started.id);
  assert.deepEqual(record.map((entry) => entry.args), [['check', 'ios', 'demo'], ['ios', 'demo']], '先检查、再打包，范围一致');
  assert.equal(job.blockedByCheck, false);
  assert.equal(job.ok, true);
  assert.match(job.output, /环境检查通过，开始打包/);

  record.length = 0;
  const direct = createPanel({ config: { home }, spawn: fakeSpawn(record) });
  direct.startJob({ kind: 'build', platform: 'android', project: 'demo', skipCheck: true });
  for (let index = 0; index < 4; index += 1) await settle();
  assert.deepEqual(record.map((entry) => entry.args), [['android', 'demo']], 'skipCheck 跳过预检');
  rmSync(home, { recursive: true, force: true });
});

test('打包选项：全权限、包型、描述文件与 KEY=VALUE 覆盖', () => {
  assert.deepEqual(
    engineArgsFor({
      platform: 'ios',
      project: 'demo',
      fullPermission: false,
      packageKind: 'adhoc',
      profile: '/p/a.mobileprovision',
      set: 'MARKETING_VERSION=1.2.3\n# 注释\nAPP_NAME=A B',
    }),
    ['ios', 'demo', '--no-full-permission', '--profile', '/p/a.mobileprovision', '--package-kind', 'adhoc', '--set', 'MARKETING_VERSION=1.2.3', '--set', 'APP_NAME=A B'],
    '面板剥掉预设里的引号与注释后再交给引擎，这里原样透传',
  );
  assert.deepEqual(
    engineArgsFor({ platform: 'android', project: 'demo', packageKind: 'appstore', fullPermission: true }, { check: true }),
    ['check', 'android', 'demo', '--full-permission'],
    '非 iOS 不传 --package-kind；check 与 build 带同一套选项',
  );
  assert.deepEqual(engineArgsFor({ platform: 'all', set: ['A=1'] }, { check: true }), ['check', 'all', '--set', 'A=1']);
  assert.deepEqual(engineArgsFor({ platform: 'ios', project: 'demo' }), ['ios', 'demo'], '省略全权限即跟随 settings.env');
  assert.throws(() => engineArgsFor({ platform: 'ios', project: 'demo', set: ['NOPE'] }), /KEY=VALUE/);
  assert.throws(() => engineArgsFor({ platform: 'ios', project: 'demo', packageKind: 'beta' }), /packageKind 必须是/);
});

test('范围参数：单/多平台、全项目/指定项目、上传多平台', () => {
  assert.deepEqual(engineArgsFor({ platform: 'ios', project: 'demo' }), ['ios', 'demo']);
  assert.deepEqual(engineArgsFor({ platform: 'all' }), ['all'], 'all 本身就是全部项目，不加 --all');
  assert.deepEqual(engineArgsFor({ platform: 'harmony', project: 'demo', upload: 'pgyer,huawei', version: '1.2.0', keepWork: true }), [
    'harmony',
    'demo',
    '--upload',
    'pgyer,huawei',
    '--version',
    '1.2.0',
    '--keep-work',
  ]);
  assert.deepEqual(scopePlatforms({ platforms: ['ios', 'android'] }), ['ios', 'android']);
  assert.deepEqual(scopePlatforms({ platforms: ['android', 'ios', 'android'] }), ['android', 'ios'], '去重保持顺序');
  assert.deepEqual(scopePlatforms({ platforms: ['ios', 'all'] }), ['all'], 'all 吞掉其它平台');
  assert.deepEqual(scopePlatforms({ platform: 'ios' }), ['ios'], '兼容单个 platform');
  assert.throws(() => scopePlatforms({ platforms: [] }), /至少选择一个平台/);
  assert.throws(() => scopePlatforms({ platforms: ['windows'] }), /platform 必须是/);

  assert.deepEqual(
    engineCommandsFor({ platforms: ['ios', 'android'], projects: ['a', 'b'], upload: 'pgyer' }, { check: true }),
    [
      ['check', 'ios', 'a'],
      ['check', 'ios', 'b'],
      ['check', 'android', 'a'],
      ['check', 'android', 'b'],
    ],
    '平台 × 项目 一行一条引擎命令',
  );
  assert.deepEqual(engineCommandsFor({ platforms: ['ios', 'android'], noUpload: true }, {}), [
    ['ios', '--all', '--no-upload'],
    ['android', '--all', '--no-upload'],
  ]);
  assert.deepEqual(engineCommandsFor({ platforms: ['all'], projects: ['a'] }, {}), [['all', 'a']]);
});

test('面板任务：多平台 × 全项目拆成多条引擎命令，串行执行并合并日志', async () => {
  const home = fixtureHome();
  const record = [];
  const panel = createPanel({ config: { home }, spawn: fakeSpawn(record) });
  const started = panel.startJob({ kind: 'build', platforms: ['ios', 'android'], projects: [], noUpload: true, skipCheck: true });
  assert.equal(started.running, true);
  assert.equal(started.platform, 'ios,android');
  assert.equal(started.project, '');
  for (let index = 0; index < 8; index += 1) await settle();

  const job = panel.jobLog(started.id);
  assert.equal(job.running, false);
  assert.equal(job.code, 0);
  assert.equal(job.ok, true, '两条都成功才算成功');
  assert.deepEqual(record.map((entry) => entry.args), [
    ['ios', '--all', '--no-upload'],
    ['android', '--all', '--no-upload'],
  ]);
  assert.match(job.output, /▶ 1\/2 {2}ios --all --no-upload/);
  assert.match(job.output, /▶ 2\/2 {2}android --all --no-upload/);
  assert.match(job.output, /done/, '第二条的输出也在同一个任务里');
  rmSync(home, { recursive: true, force: true });
});

test('面板任务：批处理里某一条失败时保留首个失败退出码，其余照跑', async () => {
  const home = fixtureHome();
  const record = [];
  const spawn = (fakeHome, args, options) =>
    fakeSpawn(record, { code: args[0] === 'ios' ? 1 : 0 })(fakeHome, args, options);
  const panel = createPanel({ config: { home }, spawn });
  const started = panel.startJob({ kind: 'build', platforms: ['ios', 'android'], projects: ['demo'], skipCheck: true });
  for (let index = 0; index < 8; index += 1) await settle();

  const job = panel.jobLog(started.id);
  assert.deepEqual(record.map((entry) => entry.args), [['ios', 'demo'], ['android', 'demo']], '失败不中断后续');
  assert.equal(job.code, 1);
  assert.equal(job.ok, false);
  rmSync(home, { recursive: true, force: true });
});

test('面板 state 带出上传平台清单与其可用性', async () => {
  const home = fixtureHome();
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(
    join(home, 'config', 'upload.env'),
    ['UPLOAD_PLATFORM_IDS="pgyer store"', 'UPLOAD_PLATFORM_pgyer_NAME="蒲公英"', 'UPLOAD_PLATFORM_store_ENABLED=false'].join('\n'),
  );
  const panel = createPanel({ config: { home }, spawn: fakeSpawn([]) });
  const state = await panel.state();
  assert.deepEqual(state.uploaders, [
    { id: 'pgyer', name: '蒲公英', enabled: true, available: false, platforms: ['ios', 'android', 'harmony'], reason: 'script' },
    { id: 'store', name: 'store', enabled: false, available: false, platforms: ['ios', 'android', 'harmony'], reason: 'disabled' },
  ]);
  assert.equal(state.uploadersError, '');
  rmSync(home, { recursive: true, force: true });
});

test('面板 state 带出描述文件清单、全权限默认值与引擎的覆盖键白名单', async () => {
  const home = fixtureHome();
  mkdirSync(join(home, 'config'), { recursive: true });
  mkdirSync(join(home, 'lib'), { recursive: true });
  writeFileSync(join(home, 'config', 'settings.env'), 'FULL_PERMISSION_PROFILE="false"\n');
  writeFileSync(join(home, 'lib', 'common.sh'), 'PACKAGE_ENV_OVERRIDE_KEYS="APP_NAME MARKETING_VERSION"\n');
  const profiles = [{ file: '/s/current/a.mobileprovision', kind: 'adhoc', bundleId: 'com.a.b', name: 'A', expired: false }];
  const spawn = (dir, args) => {
    assert.equal(args[0], 'profiles', 'state 只应该向引擎问一次描述文件');
    return Promise.resolve({ code: 0, signal: null, stdout: `${JSON.stringify(profiles)}\n`, stderr: '' });
  };
  const state = await createPanel({ config: { home }, spawn }).state();
  assert.deepEqual(state.profiles, profiles);
  assert.equal(state.profilesError, '');
  assert.deepEqual(state.options, { fullPermission: false });
  assert.deepEqual(state.overrideKeys, ['APP_NAME', 'MARKETING_VERSION'], '面板用引擎自己的白名单过滤预设');
  assert.deepEqual(state.presets, {}, 'fixture 没有 config/projects，也就没有项目预设');
  rmSync(home, { recursive: true, force: true });
});

test('summarizeOutput：把 [FAIL]/[WARN] 提出来，并汇总 结果: 行', () => {
  const engineCheck = [
    '========== CHECK: demo (演示应用) ==========',
    '[OK]   源码目录: /tmp/demo',
    '[FAIL] Profile 不存在: /home/signing/current/demo.mobileprovision',
    '[FAIL] p12 不存在: /home/signing/current/cert.p12',
    '[OK]   Keychain 已保存 p12 密码: demo-p12',
    '结果: errors=2 warnings=0',
    '========== ANDROID CHECK: demo ==========',
    '[WARN] 未配置 release keystore，将沿用项目内签名配置',
    '结果: errors=0 warnings=1',
  ].join('\n');
  const summary = summarizeOutput(engineCheck);
  assert.equal(summary.errorCount, 2, '每个项目的 结果: 行求和');
  assert.equal(summary.warningCount, 1);
  assert.deepEqual(summary.failures, [
    'Profile 不存在: /home/signing/current/demo.mobileprovision',
    'p12 不存在: /home/signing/current/cert.p12',
  ]);
  assert.deepEqual(summary.warnings, ['未配置 release keystore，将沿用项目内签名配置']);

  // 还在跑、没有 结果: 行时用行数兜底。
  assert.deepEqual(summarizeOutput('[FAIL] 打包脚本不存在: /tmp/demo/build.sh\n'), {
    errorCount: 1,
    warningCount: 0,
    failures: ['打包脚本不存在: /tmp/demo/build.sh'],
    warnings: [],
  });
  assert.deepEqual(summarizeOutput(''), { errorCount: 0, warningCount: 0, failures: [], warnings: [] });
});

test('面板任务：引擎报错在任务对象上带出结构化摘要', async () => {
  const home = fixtureHome();
  const record = [];
  const panel = createPanel({
    config: { home },
    spawn: fakeSpawn(record, {
      code: 1,
      stdout: '[FAIL] Profile 不存在: /tmp/demo.mobileprovision\n结果: errors=1 warnings=0\n',
    }),
  });
  const started = panel.startJob({ kind: 'check', platform: 'ios', project: 'demo' });
  await settle();
  await settle();

  const job = panel.jobLog(started.id);
  assert.equal(job.code, 1);
  assert.equal(job.ok, false, '有 [FAIL] 时任务不算成功');
  assert.equal(job.summary.errorCount, 1);
  assert.deepEqual(job.summary.failures, ['Profile 不存在: /tmp/demo.mobileprovision']);
  rmSync(home, { recursive: true, force: true });
});

test('mountWebPanel 在没有 webServer 时返回 null，且不直接读 ctx.webServer', () => {
  const { ctx } = harness();
  assert.equal(mountWebPanel(ctx, {}), null);
  // cordis throws on that property access — the plugin must go through ctx.get.
  assert.throws(() => ctx.webServer, /without inject/);
});

test('client half：注册侧栏行与主面板，并能渲染', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let definition;
  new Function('window', source)({ __ModuleLoader__: { load: (value) => { definition = value; } } });
  assert.equal(definition.id, 'dsh-app-packager');

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: () => ({ current: null }),
  };
  const exported = definition.factory((id) => {
    if (id === 'react') return react;
    throw new Error(`意外的 require：${id}`);
  });
  assert.equal(exported.name, 'dsh-app-packager');
  assert.deepEqual(exported.inject, ['slots', 'locale']);

  const slots = [];
  const dictionaries = [];
  const effects = [];
  const disposed = [];
  const ctx = {
    effect: (fn) => {
      effects.push(fn());
    },
    locale: {
      register: (namespace, dict) => {
        dictionaries.push({ namespace, dict });
        return () => {};
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (slot, register) => {
        register();
        return () => disposed.push(slot);
      },
      register: (options, component) => {
        slots.push({ options, component });
        return () => {};
      },
    },
  };
  exported.apply(ctx);
  assert.deepEqual(slots.map((entry) => entry.options.name), ['sidebar.panellist', 'main']);
  assert.equal(slots[1].options.key, 'app-packager');
  // 侧栏按 id 寻址同名 main 面板：id、order、locale 与实际文案都要对得上，
  // 否则入口要么不排序、要么显示成键名。
  assert.equal(slots[0].options.id, 'app-packager');
  assert.equal(slots[0].options.order, 60);
  assert.equal(slots[0].options.locale, 'app-packager');
  assert.equal(slots[0].options.label(), 'entry.label');
  assert.equal(dictionaries[0].namespace, 'app-packager');
  assert.deepEqual(Object.keys(dictionaries[0].dict.zh).sort(), Object.keys(dictionaries[0].dict.en).sort());
  for (const key of ['entry.label', 'sdk', 'upgrade.run']) {
    assert.ok(dictionaries[0].dict.zh[key], `中文字典缺少 ${key}`);
  }

  // The notice must not depend on the host half sending `summary`: the panel
  // falls back to reading the raw log, so a page refresh alone is enough.
  assert.match(source, /value\.summary \|\| summarizeLog\(value\.output\)/);
  // 打包范围与上传勾选都必须走宿主的 platforms/projects/upload 字段。
  assert.match(source, /platforms: spec\.platforms \|\| \[spec\.platform\]/);
  assert.match(source, /projects: spec\.projects \|\| \(spec\.project \? \[spec\.project\] : \[\]\)/);
  assert.match(source, /uploaders\.filter\(\(item\) => uploads\[item\.id\]\)/);

  // Render with the real dictionaries: a typo in the panel path throws here.
  const zh = dictionaries[0].dict.zh;
  const tree = slots[1].component({ t: (key) => (key in zh ? zh[key] : key) });
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, 'ap-root');
  const flatten = (node, out = []) => {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out);
      return out;
    }
    if (typeof node !== 'object') {
      out.push(String(node));
      return out;
    }
    return flatten(node.children, out);
  };
  const texts = flatten(tree);
  assert.ok(texts.includes(zh.scope), '打包范围区块渲染出来了');
  assert.ok(texts.includes(zh['scope.hint']));
  assert.ok(texts.includes(zh['options.uploaders.none']), 'state 还没到时应提示没有可用上传平台，而不是崩掉');
  const icon = slots[0].component();
  assert.equal(icon.type, 'svg');

  // 卸载要注销两个槽位，否则热重载会留下重复入口。
  effects.at(-1)();
  assert.deepEqual(disposed, ['sidebar.panellist', 'main']);
});

test('升级前比版本：registry 不比本机新就不动手', () => {
  assert.equal(isNewerVersion('0.7.0', '0.6.0'), true);
  assert.equal(isNewerVersion('0.6.1', '0.6.0'), true);
  assert.equal(isNewerVersion('0.6.0', '0.6.0'), false, '同版本不算升级');
  assert.equal(isNewerVersion('0.2.1', '0.6.0'), false, 'registry 更旧时不能把本机换回去');
  assert.equal(isNewerVersion('1.0.0-beta.1', '0.6.0'), true, '预发布也按数字段比');
});

test('SDK 平台参数：单个、多个、all 展开与非法值', () => {
  assert.deepEqual(sdkPlatforms({}), ['ios', 'android', 'harmony'], '不指定就是三个平台');
  assert.deepEqual(sdkPlatforms({ platform: 'all' }), ['ios', 'android', 'harmony']);
  assert.deepEqual(sdkPlatforms({ platform: 'ios' }), ['ios']);
  assert.deepEqual(sdkPlatforms({ platforms: ['ios', 'ios', 'harmony'] }), ['ios', 'harmony'], '去重并保持顺序');
  assert.throws(() => sdkPlatforms({ platforms: ['windows'] }), /platforms 只能是/);
});

test('一键配置 SDK：每个平台一次 sdk install，处理已下载只跑 sdk process', async () => {
  const home = fixtureHome();
  const record = [];
  const panel = createPanel({ config: { home }, spawn: fakeSpawn(record) });
  const started = panel.startJob({ kind: 'sdk', platforms: ['ios', 'android'] });
  assert.equal(started.kind, 'sdk');
  assert.equal(started.platform, 'ios,android');
  for (let index = 0; index < 6; index += 1) await settle();
  assert.deepEqual(
    record.map((entry) => entry.args),
    [['sdk', 'install', 'ios', '--yes'], ['sdk', 'install', 'android', '--yes']],
    '每个平台一次非交互安装，面板不弹引擎的交互提示',
  );
  assert.equal(panel.jobLog(started.id).ok, true);

  const processing = [];
  const other = createPanel({ config: { home }, spawn: fakeSpawn(processing) });
  other.startJob({ kind: 'sdk', processOnly: true });
  for (let index = 0; index < 4; index += 1) await settle();
  assert.deepEqual(processing.map((entry) => entry.args), [['sdk', 'process']]);

  const both = [];
  const third = createPanel({ config: { home }, spawn: fakeSpawn(both) });
  third.startJob({ kind: 'sdk', platforms: ['harmony'], process: true });
  for (let index = 0; index < 6; index += 1) await settle();
  assert.deepEqual(
    both.map((entry) => entry.args),
    [['sdk', 'install', 'harmony', '--yes'], ['sdk', 'process']],
    '勾了「同时处理已下载的包」就多跑一次 sdk process',
  );
  rmSync(home, { recursive: true, force: true });
});

test('面板 state 带出 HBuilderX 版本、SDK 清单与下载目录', async () => {
  const home = fixtureHome();
  const status = {
    hbuilderx: { found: true, app: '/Applications/HBuilderX.app', version: '5.26.2026091802', series: '5.26' },
    sdkRoot: join(home, 'sdk'),
    platforms: [{ id: 'ios', label: 'iOS', series: '5.26', dir: join(home, 'sdk', 'iOS', '5.26'), state: 'ready', ready: true, page: 'https://example.test/ios', direct: 'https://example.test/sdk.zip', package: 'UniAppX-iOS@5.26.zip' }],
    archives: [],
    incompleteDownloads: 0,
  };
  const record = [];
  const spawn = (dir, args, options) =>
    fakeSpawn(record, args[0] === 'sdk'
      ? { code: 0, stdout: `${JSON.stringify(status)}\n` }
      : { code: 0 })(dir, args, options);
  const panel = createPanel({ config: { home }, spawn });
  const state = await panel.state();
  assert.deepEqual(record.filter((entry) => entry.args[0] === 'sdk').map((entry) => entry.args), [['sdk', 'status']]);
  assert.equal(state.sdk.hbuilderx.series, '5.26');
  assert.equal(state.sdk.platforms[0].state, 'ready');
  assert.equal(state.sdkError, '');
  assert.equal(state.plugin.home, home, '显式配置的引擎目录原样带出');
  assert.ok('canUpgrade' in state, '面板要能判断能不能从自己这里升级');
  rmSync(home, { recursive: true, force: true });
});

test('sdk status 读不出来时报错字段，不影响其余 state', async () => {
  const home = fixtureHome();
  const record = [];
  const spawn = (dir, args, options) =>
    fakeSpawn(record, args[0] === 'sdk' ? { code: 1, stdout: 'boom\n' } : { code: 0 })(dir, args, options);
  const panel = createPanel({ config: { home }, spawn });
  const state = await panel.state();
  assert.equal(state.sdk, null);
  assert.match(state.sdkError, /boom/);
  rmSync(home, { recursive: true, force: true });
});

test('升级插件：走插件自己的 node 脚本，并用引擎目录暂存的包装器', async () => {
  const root = mkdtempSync(join(tmpdir(), 'app-packager-plugin-root-'));
  const plugin = join(root, 'node_modules', 'dsh-app-packager');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'package.json'), '{}');
  const home = fixtureHome();
  const record = [];
  const nodes = [];
  const nodeSpawn = (script, args, options) => {
    nodes.push({ script, args, cwd: options.cwd });
    options.onLine?.('升级完成', 'stdout');
    return Promise.resolve({ code: 0, signal: null, stdout: '升级完成\n', stderr: '' });
  };
  const panel = createPanel({
    config: { home },
    spawn: fakeSpawn(record),
    nodeSpawn,
    moduleUrl: pathToFileURL(join(plugin, 'web.js')).href,
  });
  const started = panel.startJob({ kind: 'upgrade' });
  assert.equal(started.kind, 'upgrade');
  for (let index = 0; index < 4; index += 1) await settle();
  assert.deepEqual(record, [], '升级不通过引擎跑');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].script, join(plugin, 'upgrade.mjs'));
  assert.equal(nodes[0].cwd, plugin);
  assert.match(panel.jobLog(started.id).output, /升级完成/);

  const outside = createPanel({ config: { home }, spawn: fakeSpawn([]), nodeSpawn, moduleUrl: 'file:///tmp/elsewhere/web.js', env: {} });
  assert.throws(() => outside.startJob({ kind: 'upgrade' }), /无法自动升级/);
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test('升级期间不丢引擎目录：暂存到插件旁边，成功或失败都移回', async () => {
  const root = mkdtempSync(join(tmpdir(), 'app-packager-preserve-'));
  const plugin = join(root, 'node_modules', 'dsh-app-packager');
  mkdirSync(plugin, { recursive: true });
  const home = join(plugin, 'home');
  mkdirSync(join(home, 'sdk'), { recursive: true });
  writeFileSync(join(home, 'sdk', 'marker.txt'), 'ios sdk');

  let visibleDuringUpgrade = null;
  await withHomePreserved(plugin, async () => {
    visibleDuringUpgrade = existsSync(home);
  });
  assert.equal(visibleDuringUpgrade, false, '升级过程中插件目录里没有 home，避免 pnpm 删掉它');
  assert.equal(readFileSync(join(home, 'sdk', 'marker.txt'), 'utf8'), 'ios sdk', '升级完成后原样回来');
  assert.equal(existsSync(upgradeBackupDir(plugin)), false, '暂存目录不留残渣');

  await assert.rejects(withHomePreserved(plugin, async () => { throw new Error('安装失败'); }), /安装失败/);
  assert.equal(readFileSync(join(home, 'sdk', 'marker.txt'), 'utf8'), 'ios sdk', '升级失败也必须还原');
  rmSync(root, { recursive: true, force: true });
});

test('引擎主目录：显式配置 > 环境变量 > 插件目录内；旧目录一次性搬进来', () => {
  // 这个用例会真的 rename 一个旧主目录，而 resolvePluginHome 的 legacy 默认值来自真实
  // $HOME：所以每次调用都必须显式传 legacy，并且在这里守住「真实的 ~/AppPackager 没被动过」。
  const realLegacy = legacyHome();
  const realLegacyExisted = existsSync(realLegacy);

  const root = mkdtempSync(join(tmpdir(), 'app-packager-home-'));
  const profile = join(root, 'profile');
  const plugin = join(profile, 'node_modules', 'dsh-app-packager');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'package.json'), '{}');
  const moduleUrl = pathToFileURL(join(plugin, 'web.js')).href;
  const env = { DSH_PROFILE_DIR: profile };
  const home = homeInPlugin(plugin);
  assert.equal(pluginRoot(moduleUrl, env), plugin);
  assert.equal(pluginRoot(moduleUrl, { DSH_PROFILE_DIR: join(root, 'nothing') }), plugin, '能按 import.meta.url 定位就不看环境变量');
  assert.equal(resolvePluginHome('/tmp/given', { moduleUrl, env }), '/tmp/given');
  assert.equal(resolvePluginHome('', { moduleUrl, env: { ...env, APP_PACKAGER_HOME: '/tmp/from-env' } }), '/tmp/from-env');
  // 没有旧目录可搬时，位置就是插件目录内的 home（legacy 指一个不存在的路径）。
  assert.equal(resolvePluginHome('', { moduleUrl, env, legacy: join(root, 'no-home', LEGACY_HOME_NAME) }), home);

  // 旧版把引擎目录放在 ~/AppPackager；第一次解析就 rename 进插件目录，不复制数据。
  // legacy 必须显式传入：默认值来自真实 $HOME，测试绝不能碰用户自己的 ~/AppPackager。
  const legacy = join(root, 'fake-home', LEGACY_HOME_NAME);
  mkdirSync(join(legacy, 'sdk'), { recursive: true });
  writeFileSync(join(legacy, 'sdk', 'marker.txt'), 'android sdk');
  writeFileSync(join(legacy, '.engine-version'), '0.5.0');

  // 同名但不是引擎目录的目录绝不能被搬走。
  const lookalike = join(root, 'lookalike');
  mkdirSync(lookalike, { recursive: true });
  assert.equal(resolvePluginHome('', { moduleUrl, env, legacy: lookalike }), home);
  assert.equal(existsSync(lookalike), true, '不是引擎目录就原样留着');
  assert.equal(existsSync(home), false, '也不顺手创建插件目录内的 home');

  const notices = [];
  assert.equal(resolvePluginHome('', { moduleUrl, env, legacy, onNotice: (text) => notices.push(text) }), home);
  assert.equal(readFileSync(join(home, 'sdk', 'marker.txt'), 'utf8'), 'android sdk');
  assert.equal(existsSync(legacy), false, '迁移是 rename，旧目录不再留着');
  assert.match(notices.join(''), /迁移到插件目录内/);
  assert.equal(resolvePluginHome('', { moduleUrl, env, legacy }), home, '已经在插件目录内就直接用');
  assert.equal(existsSync(realLegacy), realLegacyExisted, '这个用例绝不能碰真实的 ~/AppPackager');
  rmSync(root, { recursive: true, force: true });
});
