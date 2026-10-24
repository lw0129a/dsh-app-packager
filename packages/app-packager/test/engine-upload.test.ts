// @ts-nocheck
/** 上传层的纯逻辑自检：平台清单解析、开关、产物平台匹配、失败记录。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  uploadPlatformIds,
  platformEnabled,
  platformField,
  supports,
  latestInfoFile,
  enabledPlatforms,
  runPostBuildUploads,
  uploadLatestArtifact,
} from '../dist/engine/upload.js';
import { pgyer } from '../dist/engine/uploaders/pgyer.js';

test('uploadPlatformIds 支持中英文分隔符并去重', () => {
  assert.deepEqual(uploadPlatformIds('pgyer，PGYER; foo  bar'), ['pgyer', 'foo', 'bar']);
  assert.deepEqual(uploadPlatformIds(undefined), ['pgyer']);
  assert.deepEqual(uploadPlatformIds(''), []);
  assert.deepEqual(uploadPlatformIds('pgyer、my-upload!'), ['pgyer', 'my', 'upload']);
});

test('平台开关默认开，显式 false 才关', () => {
  assert.equal(platformEnabled({}, 'pgyer'), true);
  assert.equal(platformEnabled({ UPLOAD_PLATFORM_PGYER_ENABLED: 'false' }, 'pgyer'), false);
  assert.equal(platformEnabled({ UPLOAD_PLATFORM_PGYER_ENABLED: '0' }, 'pgyer'), false);
  assert.deepEqual(enabledPlatforms({ UPLOAD_PLATFORM_IDS: 'pgyer,foo', UPLOAD_PLATFORM_FOO_ENABLED: 'off' }), ['pgyer']);
});

test('supports 默认取 provider 声明，可被 UPLOAD_PLATFORM_<ID>_PLATFORMS 覆盖', () => {
  assert.equal(supports({}, 'pgyer', 'harmony'), true);
  assert.equal(supports({}, 'pgyer', 'mp-weixin'), false);
  assert.equal(supports({ UPLOAD_PLATFORM_PGYER_PLATFORMS: 'ios, android' }, 'pgyer', 'harmony'), false);
  assert.equal(platformField({ UPLOAD_PLATFORM_PGYER_ENABLED: 'true' }, 'pgyer', 'enabled'), 'true');
});

test('latestInfoFile 落在平台产物目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-upload-'));
  const settings = { PACKAGE_IOS_DIR: dir, PIPELINE_ROOT: dir };
  assert.equal(latestInfoFile(settings, 'ios', 'demo'), path.join(dir, 'demo-latest.json'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pgyer 缺安装包时返回失败并说明原因', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-upload-'));
  const infoFile = path.join(dir, 'info.json');
  fs.writeFileSync(infoFile, JSON.stringify({ platform: 'ios', project_id: 'demo', ipa_path: path.join(dir, 'missing.ipa') }));
  const result = await pgyer.upload({ settings: {}, infoFile, info: JSON.parse(fs.readFileSync(infoFile, 'utf8')), file: path.join(dir, 'missing.ipa') });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /安装包不存在/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPostBuildUploads 对未知平台只计数不抛错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-upload-'));
  const infoFile = path.join(dir, 'info.json');
  fs.writeFileSync(infoFile, JSON.stringify({ platform: 'ios', project_id: 'demo', ipa_path: 'x.ipa' }));
  const failures = await runPostBuildUploads({ UPLOAD_SELECTED_PLATFORMS: 'nope' }, infoFile);
  assert.equal(failures, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uploadLatestArtifact 缺少构建信息时返回 false', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-upload-'));
  const ok = await uploadLatestArtifact({ PACKAGE_IOS_DIR: dir, PIPELINE_ROOT: dir }, 'ios', 'demo');
  assert.equal(ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
