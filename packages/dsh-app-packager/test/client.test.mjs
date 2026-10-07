/**
 * Contract test for the browser half.
 *
 * `client.js` is a plain ModuleLoader bundle: the shell only shows a sidebar row
 * when the bundle registers one into `sidebar.panellist` (with a matching keyed
 * `main` page). If that registration silently stops happening the panel
 * "disappears" with no error anywhere, so pin the fields here — the host-side
 * tests cannot see any of this.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js');

const react = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial) => [initial, () => {}],
};

/** Execute client.js the way the shell does, and hand back the loaded module. */
async function loadBundle() {
  let loaded = null;
  globalThis.window = { __ModuleLoader__: { load: (mod) => { loaded = mod; } } };
  try {
    await import(`${pathToFileURL(CLIENT).href}?v=${Date.now()}`);
  } finally {
    delete globalThis.window;
  }
  assert.ok(loaded, 'client.js 必须调用 window.__ModuleLoader__.load');
  return loaded;
}

/** Minimal stand-ins for the `slots`, `locale` and `effect` services. */
function panelContext() {
  const entries = [];
  const registered = [];
  const disposed = [];
  const effects = [];
  const dictionaries = {};

  const ctx = {
    effect(fn, label) {
      const off = fn();
      effects.push({ label, off });
    },
    locale: {
      register(ns, dicts) {
        dictionaries[ns] = dicts;
        return () => disposed.push(`locale:${ns}`);
      },
      bind: (ns) => (key, vars) => {
        let text = (dictionaries[ns]?.zh ?? {})[key] ?? key;
        for (const [name, value] of Object.entries(vars ?? {})) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
        return text;
      },
    },
    slots: {
      inject(name, cb) {
        entries.push(name);
        cb();
        return () => disposed.push(`slot:${name}`);
      },
      register(options, component) {
        registered.push({ options, component });
        return () => disposed.push(`entry:${options.id ?? options.key}`);
      },
    },
  };
  return { ctx, entries, registered, disposed, effects, dictionaries };
}

test('client.js 把面板注册到 sidebar.panellist 与 main', async () => {
  const loaded = await loadBundle();
  assert.equal(loaded.id, 'dsh-app-packager');

  const exported = loaded.factory((id) => {
    assert.equal(id, 'react', '只有 react 走 require，其余依赖注入');
    return react;
  });
  assert.equal(exported.name, 'dsh-app-packager');
  assert.deepEqual(exported.inject, ['slots', 'locale']);
  assert.equal(typeof exported.apply, 'function');

  const { ctx, entries, registered, dictionaries } = panelContext();
  exported.apply(ctx);

  assert.deepEqual(entries, ['sidebar.panellist', 'main']);

  const list = registered.find((r) => r.options.name === 'sidebar.panellist');
  assert.ok(list, '必须注册 sidebar.panellist，否则侧栏没有入口');
  assert.equal(list.options.id, 'app-packager');
  assert.equal(list.options.order, 60);
  assert.equal(list.options.locale, 'app-packager');
  assert.equal(typeof list.component, 'function', '侧栏需要图标组件');
  assert.equal(list.options.label(), '应用打包');

  const main = registered.find((r) => r.options.name === 'main');
  assert.ok(main, 'keyed main 页面必须在位，否则选中入口会抛错');
  assert.equal(main.options.key, 'app-packager');
  assert.equal(typeof main.component, 'function');

  // 中英字典键必须一一对应，否则一侧界面会出现键名。
  assert.deepEqual(
    Object.keys(dictionaries['app-packager'].zh).sort(),
    Object.keys(dictionaries['app-packager'].en).sort(),
  );
  for (const key of ['entry.label', 'sdk', 'upgrade.run']) {
    assert.ok(key in dictionaries['app-packager'].zh, `缺少词条 ${key}`);
  }
});

test('卸载时两个槽位都会被注销', async () => {
  const loaded = await loadBundle();
  const exported = loaded.factory(() => react);
  const { ctx, disposed, effects } = panelContext();
  exported.apply(ctx);

  const cleanup = effects.at(-1).off;
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.deepEqual(disposed, ['slot:sidebar.panellist', 'slot:main']);
});
