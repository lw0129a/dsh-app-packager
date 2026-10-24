/**
 * The TypeScript engine reuses the same config files and the same "one
 * HBuilderX build at a time" rule as the bash engine; these checks pin that.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { keepCount, loadSettings, packageDir } from '../dist/engine/settings.js';
import { createSemaphore, runCommand } from '../dist/engine/run.js';

function makeHome(settings: string, local = '') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-engine-'));
  fs.mkdirSync(path.join(home, 'config'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config', 'settings.env'), settings);
  if (local) fs.writeFileSync(path.join(home, 'config', 'settings.local.env'), local);
  return home;
}

test('settings expand $PACKAGE_ROOT in order and let settings.local.env win', () => {
  const home = makeHome(
    ['PACKAGE_ROOT="$PIPELINE_ROOT/packages"', 'PACKAGE_IOS_DIR="$PACKAGE_ROOT/iOS"', 'KEEP_BUILD_COUNT=3'].join('\n'),
    'KEEP_BUILD_COUNT=7\n',
  );
  const settings = loadSettings(home);
  assert.equal(settings.PACKAGE_ROOT, path.join(home, 'packages'));
  assert.equal(settings.PACKAGE_IOS_DIR, path.join(home, 'packages', 'iOS'));
  assert.equal(keepCount(settings, 'KEEP_BUILD_COUNT'), 7);
  assert.equal(packageDir(settings, 'ios'), path.join(home, 'packages', 'iOS'));
});

test('missing settings fall back to engine defaults', () => {
  const home = makeHome('');
  const settings = loadSettings(home);
  assert.equal(packageDir(settings, 'mp-weixin'), path.join(home, 'packages', 'mp-weixin'));
  assert.equal(keepCount(settings, 'KEEP_LOG_COUNT'), 5);
});

test('runCommand captures output and reports a timeout', async () => {
  const ok = await runCommand(process.execPath, ['-e', 'console.log("hello")']);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /hello/);

  const slow = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 });
  assert.equal(slow.timedOut, true);
});

test('semaphore lets exactly one task through at a time', async () => {
  const withSlot = createSemaphore(1);
  let active = 0;
  let peak = 0;
  await Promise.all(
    [0, 1, 2].map(() =>
      withSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }),
    ),
  );
  assert.equal(peak, 1);
});
