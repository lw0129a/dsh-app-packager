/**
 * Checks for the AppPackager host plugin.
 *
 * The plugin is exercised against a fake harness context (a tool registry that
 * records definitions) and a throwaway APP_PACKAGER_HOME, so nothing here
 * touches a real profile or a real build. `node --test` from the package dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../index.js';

/** Capture what the plugin registers instead of mounting a real Harness. */
function harness() {
  const tools = new Map();
  tools.register = (definition) => {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  };
  return { tools, ctx: { tools } };
}

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
  for (const definition of tools.values()) {
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.output.schema.type, 'json');
    assert.equal(typeof definition.output.render, 'function');
    assert.equal(typeof definition.execute, 'function');
  }
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
