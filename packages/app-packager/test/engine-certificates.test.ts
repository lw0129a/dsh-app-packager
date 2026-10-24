import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidReady,
  canonicalCertificateName,
  certStatus,
  clearCertificatePlatform,
  harmonyReady,
  iosReady,
  processCertificates,
  removeCertificateFile,
  timestamp,
} from '../dist/engine/certificates.js';
import type { Settings } from '../dist/engine/settings.js';

function home(): { root: string; settings: Settings } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-certs-'));
  const settings: Settings = {
    PIPELINE_ROOT: root,
    LOG_ROOT: path.join(root, 'logs'),
  };
  return { root, settings };
}

function write(file: string, content = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('timestamp 是 YYYYMMDD-HHMMSS', () => {
  assert.match(timestamp(new Date(2026, 0, 2, 3, 4, 5)), /^20260102-030405$/);
});

test('规范名：iOS p12 / Android keystore / keystore.properties', () => {
  assert.equal(canonicalCertificateName('/tmp/a/signing.p12', 'ios'), 'ios-signing.p12');
  assert.equal(canonicalCertificateName('/tmp/a/release.keystore', 'android'), 'release.keystore');
  assert.equal(canonicalCertificateName('/tmp/a/keystore.properties', 'android'), 'keystore.properties');
});

test('就绪判定：iOS 需要 p12 + mobileprovision', () => {
  const { root, settings } = home();
  assert.equal(iosReady(settings), false);
  write(path.join(root, 'certificates/iOS/signing.p12'));
  assert.equal(iosReady(settings), false);
  write(path.join(root, 'certificates/iOS/app.mobileprovision'));
  assert.equal(iosReady(settings), true);
});

test('就绪判定：HarmonyOS 同目录要 p7b + p12 + cer', () => {
  const { root, settings } = home();
  assert.equal(harmonyReady(settings), false);
  write(path.join(root, 'certificates/HarmonyOS/release.p7b'), '{not json}');
  write(path.join(root, 'certificates/HarmonyOS/release.p12'));
  assert.equal(harmonyReady(settings), false);
  write(path.join(root, 'certificates/HarmonyOS/release.cer'));
  assert.equal(harmonyReady(settings), true);
});

test('导入：keystore 落到 release.keystore，keystore.properties 指向它', () => {
  const { root, settings } = home();
  const source = path.join(root, 'incoming');
  write(path.join(source, 'my-release.keystore'), 'keystore-bytes');
  write(path.join(source, 'keystore.properties'), 'storePassword=123456\nkeyAlias=release\n');
  const result = processCertificates(settings, [source]);
  assert.equal(result.processed, 2, result.success.join('\n') + result.abnormal.join('\n'));
  assert.equal(fs.readFileSync(path.join(root, 'certificates/Android/release.keystore'), 'utf8'), 'keystore-bytes');
  assert.match(fs.readFileSync(path.join(root, 'certificates/Android/keystore.properties'), 'utf8'), /^storeFile=release\.keystore$/m);
  assert.equal(androidReady(settings), true);
});

test('导入只收集、归档不丢：同内容重复导入不覆盖', () => {
  const { root, settings } = home();
  const source = path.join(root, 'incoming');
  write(path.join(source, 'app-release.keystore'), 'same');
  processCertificates(settings, [source]);
  const second = processCertificates(settings, [source]);
  assert.equal(second.processed, 0);
  assert.equal(second.success.length, 1);
  assert.match(second.success[0], /未变化/);
});

test('清理平台：文件进历史归档，目录仍存在', () => {
  const { root, settings } = home();
  write(path.join(root, 'certificates/Android/release.keystore'));
  write(path.join(root, 'certificates/Android/keystore.properties'));
  const { moved, history } = clearCertificatePlatform(settings, 'android');
  assert.equal(moved.length, 2);
  assert.equal(fs.readdirSync(path.join(root, 'certificates/Android')).length, 0);
  assert.equal(fs.readdirSync(history).length, 2);
});

test('清理 iOS 同时归档 signing/current 的签名材料', () => {
  const { root, settings } = home();
  write(path.join(root, 'certificates/iOS/signing.p12'));
  write(path.join(root, 'signing/current/ios-signing.p12'));
  write(path.join(root, 'signing/current/app.mobileprovision'));
  const { moved } = clearCertificatePlatform(settings, 'ios');
  assert.equal(moved.length, 3);
  assert.equal(iosReady(settings), false);
});

test('单条删除：归档并拒绝越界路径', () => {
  const { root, settings } = home();
  write(path.join(root, 'certificates/HarmonyOS/bundles/a/release.p7b'));
  const { moved } = removeCertificateFile(settings, 'harmony', 'bundles/a/release.p7b');
  assert.equal(moved.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'certificates/HarmonyOS/bundles/a/release.p7b')), false);
  assert.throws(() => removeCertificateFile(settings, 'harmony', '../iOS/signing.p12'), /拒绝跳出平台目录/);
  assert.throws(() => removeCertificateFile(settings, 'ios', ''), /拒绝跳出平台目录/);
  assert.throws(() => removeCertificateFile(settings, 'ios', 'missing.p12'), /证书文件不存在/);
});

test('certStatus 输出面板契约字段', () => {
  const { root, settings } = home();
  write(path.join(root, 'certificates/Android/release.keystore'));
  const status = certStatus(settings);
  assert.equal(status.platforms.android.ready, true);
  assert.deepEqual(status.platforms.android.keystores.map((row) => row.rel), ['release.keystore']);
  assert.equal(status.platforms.ios.ready, false);
  assert.match(status.docs.ios, /^https:\/\//);
  assert.ok(status.dirs.signing.endsWith('signing/current'));
});
