/**
 * 上传编排，移植自 `engine/lib/upload.sh`。
 *
 * 约定：
 * - 「构建后自动上传」与「独立上传」是两条入口，失败语义不同（前者不撤销产物，后者要返回状态码）。
 * - 平台清单来自 `UPLOAD_PLATFORM_IDS`，每个平台的开关是 `UPLOAD_PLATFORM_<ID>_ENABLED`。
 * - 上传结果只写进 `build-info.json` 的 `uploads.<provider>`，不改动已归档的安装包。
 */
import fs from 'node:fs';
import path from 'node:path';
import { log, warn } from './common.js';
import { packageDir } from './settings.js';
import { pgyer } from './uploaders/pgyer.js';
const PROVIDERS = { pgyer };
const NONINTERACTIVE = process.env.APP_PACKAGER_NONINTERACTIVE === '1';
/** 把 `pgyer，pgyer;foo bar` 这类输入规整成去重后的 id 列表。 */
export function uploadPlatformIds(raw) {
    const seen = new Set();
    const out = [];
    const text = raw === undefined ? 'pgyer' : raw;
    for (const piece of text.toLowerCase().split(/[^a-z0-9_]+/)) {
        const id = piece.trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
export function platformField(settings, id, field) {
    return settings[`UPLOAD_PLATFORM_${id.toUpperCase()}_${field.toUpperCase()}`] ?? '';
}
export function platformEnabled(settings, id) {
    const value = platformField(settings, id, 'enabled');
    return value === '' ? true : !/^(0|false|no|off)$/i.test(value);
}
export function provider(id) {
    return PROVIDERS[id];
}
export function supports(settings, id, platform) {
    const list = platformField(settings, id, 'platforms');
    if (!list)
        return PROVIDERS[id]?.platforms.includes(platform) ?? false;
    return list.split(/[，,;；\s]+/).map((item) => item.trim().toLowerCase()).includes(platform);
}
export function selectedPlatforms(settings) {
    return uploadPlatformIds(settings.UPLOAD_SELECTED_PLATFORMS);
}
export function enabledPlatforms(settings) {
    return uploadPlatformIds(settings.UPLOAD_PLATFORM_IDS).filter((id) => platformEnabled(settings, id));
}
export function setUploadPlatforms(value) {
    process.env.UPLOAD_SELECTED_PLATFORMS = value;
}
/** 某个产物平台下、某个项目最近一次的构建信息文件。 */
export function latestInfoFile(settings, platform, projectId) {
    return path.join(packageDir(settings, platform), `${projectId}-latest.json`);
}
export function readBuildInfo(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** 平台是否具备上传条件（缺 key 之类的问题由各 provider 自己决定要不要拦）。 */
export function available(settings, id) {
    if (id === 'pgyer')
        return Boolean(settings.PGYER_API_KEY || process.env.PGYER_API_KEY);
    return Boolean(PROVIDERS[id]);
}
function artifactOf(info) {
    return info.ipa_path || info.apk_path || info.hap_path || '';
}
async function uploadOne(settings, id, infoFile) {
    const uploader = PROVIDERS[id];
    if (!uploader)
        return { ok: false, message: `未知的上传平台: ${id}` };
    const info = readBuildInfo(infoFile);
    const platform = String(info.platform || '');
    if (!supports(settings, id, platform))
        return { ok: false, message: `${uploader.name} 不支持产物平台: ${platform}` };
    const file = artifactOf(info);
    return uploader.upload({ settings, infoFile, info, file });
}
/**
 * 构建后自动上传。返回失败数量，调用方（build）只告警不中止。
 */
export async function runPostBuildUploads(settings, infoFile) {
    if (!fs.existsSync(infoFile))
        return 0;
    let failures = 0;
    for (const id of selectedPlatforms(settings)) {
        if (!platformEnabled(settings, id))
            continue;
        const result = await uploadOne(settings, id, infoFile);
        if (!result.ok && result.message)
            warn(result.message);
        if (!result.ok)
            failures += 1;
    }
    return failures;
}
/** 独立上传：上传最新一次归档的产物。 */
export async function uploadLatestArtifact(settings, platform, projectId, ids = selectedPlatforms(settings)) {
    const infoFile = latestInfoFile(settings, platform, projectId);
    if (!fs.existsSync(infoFile)) {
        warn(`找不到 ${projectId} 的 ${platform} 构建信息: ${infoFile}`);
        return false;
    }
    const list = ids.length > 0 ? ids : ['pgyer'];
    let ok = true;
    for (const id of list) {
        const result = await uploadOne(settings, id, infoFile);
        if (!result.ok) {
            ok = false;
            if (result.message)
                warn(result.message);
        }
        else {
            log(`${projectId} 的 ${platform} 产物已上传到 ${PROVIDERS[id]?.name ?? id}`);
        }
    }
    return ok;
}
/** 非交互环境（面板）下不允许等待输入。 */
export function isInteractive() {
    return Boolean(process.stdin.isTTY) && !NONINTERACTIVE;
}
