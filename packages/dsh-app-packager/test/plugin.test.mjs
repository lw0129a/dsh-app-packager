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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../index.js';
import { createPanel, engineArgsFor, mountWebPanel } from '../web.js';

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
function fakeSpawn(record, { code = 0, hang = false } = {}) {
  return (home, args, options) =>
    new Promise((resolve) => {
      record.push({ home, args });
      options.onSpawn?.({ kill: (signal) => record.push({ killed: signal }) });
      options.onLine?.('engine line', 'stdout');
      if (hang) return;
      setImmediate(() => resolve({ code, signal: null, stdout: 'done\n', stderr: '' }));
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
  assert.equal(routes.size, 8);
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
  assert.equal(result.dir, '/tmp/anjuyi/uni-platform-app');
  assert.ok(Array.isArray(result.projects));
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
  const running = canceller.startJob({ kind: 'build', platform: 'ios' });
  assert.deepEqual(killed[0].args, ['ios'], 'build 不加 check');
  await canceller.killJob(running.id);
  assert.deepEqual(killed[1], { killed: 'SIGTERM' });
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
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (namespace, dict) => {
        dictionaries.push({ namespace, dict });
        return () => {};
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (_slot, register) => register(),
      register: (options, component) => {
        slots.push({ options, component });
        return () => {};
      },
    },
  };
  exported.apply(ctx);
  assert.deepEqual(slots.map((entry) => entry.options.name), ['sidebar.panellist', 'main']);
  assert.equal(slots[1].options.key, 'app-packager');
  assert.equal(dictionaries[0].namespace, 'app-packager');
  assert.deepEqual(Object.keys(dictionaries[0].dict.zh).sort(), Object.keys(dictionaries[0].dict.en).sort());

  // Render with the real dictionaries: a typo in the panel path throws here.
  const zh = dictionaries[0].dict.zh;
  const tree = slots[1].component({ t: (key) => (key in zh ? zh[key] : key) });
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.className, 'ap-root');
  const icon = slots[0].component();
  assert.equal(icon.type, 'svg');
});

