/**
 * Certificate handling, ported from `engine/lib/certificates.sh`.
 *
 * Everything here follows the engine's zero-impact rule: imported files are
 * copied, never moved; overwriting an existing file first archives the old one
 * under `<pipe>/logs/certificate-history/...`; nothing outside
 * `<pipe>/certificates` and `<pipe>/logs` is written.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absoluteDir, log } from './common.js';
export const PLATFORM_LABELS = {
    ios: 'iOS',
    android: 'Android',
    harmony: 'HarmonyOS',
};
const DOCS = {
    ios: 'https://ask.dcloud.net.cn/article/152',
    android: 'https://ask.dcloud.net.cn/article/35777',
    harmony: 'https://doc.dcloud.net.cn/uni-app-x/tutorial/runbuild.html#signing-configs',
};
const root = (settings) => settings.PIPELINE_ROOT || '.';
const logsRoot = (settings) => settings.LOG_ROOT || path.join(root(settings), 'logs');
export function certDirs(settings) {
    const base = path.join(root(settings), 'certificates');
    return { ios: path.join(base, 'iOS'), android: path.join(base, 'Android'), harmony: path.join(base, 'HarmonyOS') };
}
export function platformDir(settings, platform) {
    return certDirs(settings)[platform];
}
function signingDir(settings) {
    return path.join(root(settings), 'signing/current');
}
function listFiles(dir, depth = 4) {
    const out = [];
    const walk = (current, level) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (level < depth)
                    walk(full, level + 1);
            }
            else if (entry.isFile()) {
                out.push(full);
            }
        }
    };
    walk(dir, 1);
    return out.sort();
}
/** bash `directory_has_file_type`: is there a file with this extension directly inside? */
export function directoryHasFileType(dir, extension) {
    return topLevelFiles(dir).some((file) => file.toLowerCase().endsWith(`.${extension.toLowerCase()}`));
}
function topLevelFiles(dir) {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(dir, entry.name));
    }
    catch {
        return [];
    }
}
export function iosReady(settings) {
    const files = [...listFiles(certDirs(settings).ios), ...listFiles(signingDir(settings))].map((file) => file.toLowerCase());
    return files.some((file) => file.endsWith('.p12') || file.endsWith('.pfx')) && files.some((file) => file.endsWith('.mobileprovision'));
}
export function androidReady(settings) {
    const dir = certDirs(settings).android;
    return directoryHasFileType(dir, 'keystore') || directoryHasFileType(dir, 'jks');
}
/** Manifest-declared signing material inside the user's own project also counts. */
function harmonySigningMaterial(settings, sourceDir) {
    const manifest = path.join(sourceDir, 'manifest.json');
    if (!fs.existsSync(manifest))
        return false;
    let data;
    try {
        data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    }
    catch {
        return false;
    }
    const configs = data?.['app-harmony']?.distribute?.signingConfigs ?? {};
    const order = settings.HARMONY_PACKAGE_KIND === 'debug' ? ['default', 'release'] : ['release', 'default'];
    for (const name of order) {
        const config = configs[name];
        if (!config || typeof config !== 'object')
            continue;
        const files = [config.storeFile, config.certpath, config.profile];
        if (files.every((value) => typeof value === 'string' && value && fs.existsSync(value)))
            return true;
    }
    return false;
}
function projectSourceDirs(settings) {
    const dir = path.join(root(settings), 'config/projects');
    let names = [];
    try {
        names = fs.readdirSync(dir).filter((name) => name.endsWith('.env')).sort();
    }
    catch {
        return [];
    }
    const sources = [];
    for (const file of names) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        const match = /^\s*(?:export\s+)?SOURCE_DIR\s*=\s*(.*)$/m.exec(text);
        if (!match)
            continue;
        const value = match[1].trim().replace(/^['"]|['"]$/g, '');
        if (value)
            sources.push(value);
    }
    return sources;
}
export function harmonyReady(settings) {
    const dir = certDirs(settings).harmony;
    for (const p7b of listFiles(dir, 3).filter((file) => file.toLowerCase().endsWith('.p7b'))) {
        const bundleDir = path.dirname(p7b);
        const hasP12 = directoryHasFileType(bundleDir, 'p12') || directoryHasFileType(bundleDir, 'pfx');
        if (hasP12 && directoryHasFileType(bundleDir, 'cer'))
            return true;
    }
    return projectSourceDirs(settings).some((source) => harmonySigningMaterial(settings, source));
}
/** openssl smime turns a .mobileprovision into a plist; plutil extracts fields. */
function plutil(plist, key) {
    const result = spawnSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}
export function iosProfileFields(profileFile) {
    if (!fs.existsSync(profileFile))
        return undefined;
    const plist = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-profile-')), 'profile.plist');
    const decoded = spawnSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', profileFile, '-noverify', '-out', plist], {
        stdio: 'ignore',
    });
    if (decoded.status !== 0)
        return undefined;
    try {
        const appIdentifier = plutil(plist, 'Entitlements.application-identifier');
        if (!appIdentifier)
            return undefined;
        const taskAllow = plutil(plist, 'Entitlements.get-task-allow');
        const provisionsAll = plutil(plist, 'ProvisionsAllDevices');
        let kind;
        if (provisionsAll === 'true')
            kind = 'enterprise';
        else if (plutil(plist, 'ProvisionedDevices'))
            kind = taskAllow === 'true' ? 'development' : 'adhoc';
        else
            kind = 'appstore';
        return {
            name: plutil(plist, 'Name'),
            uuid: plutil(plist, 'UUID'),
            expiry: plutil(plist, 'ExpirationDate'),
            teamId: plutil(plist, 'TeamIdentifier.0'),
            bundleId: appIdentifier.replace(/^[^.]*\./, ''),
            kind,
        };
    }
    finally {
        fs.rmSync(path.dirname(plist), { recursive: true, force: true });
    }
}
export function iosProfileFiles(settings) {
    return [...listFiles(certDirs(settings).ios), ...listFiles(signingDir(settings))]
        .filter((file) => file.toLowerCase().endsWith('.mobileprovision'))
        .sort();
}
export function iosProfileBundleId(profileFile) {
    return iosProfileFields(profileFile)?.bundleId;
}
export function profilesJson(settings) {
    const now = Date.now();
    const rows = [];
    for (const file of iosProfileFiles(settings)) {
        const fields = iosProfileFields(file);
        if (!fields)
            continue;
        const epoch = Date.parse(fields.expiry);
        rows.push({
            file,
            kind: fields.kind,
            bundleId: fields.bundleId,
            teamId: fields.teamId,
            name: fields.name.replace(/\t/g, ' '),
            expiry: fields.expiry,
            uuid: fields.uuid,
            expired: !(Number.isFinite(epoch) && epoch > now),
        });
    }
    return rows;
}
/** Harmony .p7b is a (possibly wrapped) JSON profile: bundle name + type drive the file name. */
export function harmonyProfileMetadata(profileFile) {
    let text;
    try {
        text = fs.readFileSync(profileFile, 'utf8');
    }
    catch {
        return undefined;
    }
    const start = text.indexOf('{');
    if (start < 0)
        return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    const data = JSON.parse(text.slice(start, index + 1));
                    const bundle = data?.['bundle-info']?.['bundle-name'];
                    if (typeof bundle !== 'string' || !bundle)
                        return undefined;
                    return { bundle, type: String(data.type || 'release') };
                }
                catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}
export function canonicalCertificateName(file, platform) {
    const base = path.basename(file).toLowerCase();
    if (platform === 'ios') {
        if (base.endsWith('.mobileprovision')) {
            const bundle = iosProfileBundleId(file);
            return bundle ? `${bundle}.mobileprovision` : undefined;
        }
        if (base.endsWith('.p12'))
            return 'ios-signing.p12';
        if (base.endsWith('.pfx'))
            return 'ios-signing.pfx';
        return undefined;
    }
    if (platform === 'android') {
        if (base.endsWith('.keystore'))
            return 'release.keystore';
        if (base.endsWith('.jks'))
            return 'release.jks';
        if (base === 'keystore.properties')
            return 'keystore.properties';
        return undefined;
    }
    if (base.endsWith('.p7b')) {
        const metadata = harmonyProfileMetadata(file);
        return metadata ? `${metadata.bundle}.${metadata.type}.p7b` : undefined;
    }
    if (base.endsWith('.p12'))
        return 'release.p12';
    if (base.endsWith('.pfx'))
        return 'release.pfx';
    if (base.endsWith('.cer'))
        return /dev|debug/.test(base) ? 'dev.cer' : 'release.cer';
    return undefined;
}
function findIdenticalFile(dir, sourceFile) {
    const sourceName = path.basename(sourceFile);
    const source = fs.readFileSync(sourceFile);
    for (const candidate of listFiles(dir)) {
        if (path.basename(candidate) !== sourceName)
            continue;
        try {
            if (fs.readFileSync(candidate).equals(source))
                return candidate;
        }
        catch {
            /* unreadable candidate: keep looking */
        }
    }
    return undefined;
}
function snapshotHasFileType(snapshot, targetDir, extension) {
    return snapshot.some((file) => path.dirname(file) === targetDir && file.toLowerCase().endsWith(`.${extension}`));
}
function copyAtomically(sourceFile, targetFile) {
    const staged = `${targetFile}.tmp.${process.pid}.${Date.now()}`;
    try {
        fs.copyFileSync(sourceFile, staged);
        fs.renameSync(staged, targetFile);
        return true;
    }
    catch {
        fs.rmSync(staged, { force: true });
        return false;
    }
}
function normalizeKeystoreProperties(file, keystoreName) {
    const text = fs.readFileSync(file, 'utf8');
    const next = /^\s*storeFile\s*[:=]/m.test(text)
        ? text.replace(/^\s*storeFile\s*[:=].*$/m, `storeFile=${keystoreName}`)
        : `storeFile=${keystoreName}\n${text}`;
    fs.writeFileSync(file, next, 'utf8');
}
const IMPORT_SUFFIXES = ['.mobileprovision', '.keystore', '.jks', '.p7b', '.p12', '.pfx', '.cer', 'keystore.properties'];
function looksImportable(file) {
    const lower = path.basename(file).toLowerCase();
    return IMPORT_SUFFIXES.some((suffix) => (suffix.startsWith('keystore') ? lower === suffix : lower.endsWith(suffix)));
}
export function processCertificates(settings, sources = []) {
    const dirs = certDirs(settings);
    for (const dir of [...Object.values(dirs), path.join(logsRoot(settings), 'certificate-history')])
        fs.mkdirSync(dir, { recursive: true });
    const historyRun = path.join(logsRoot(settings), 'certificate-history', timestamp());
    const result = { success: [], abnormal: [], failure: [], unreadable: [], processed: 0, historyRun };
    const seen = new Set();
    const certRoot = path.join(root(settings), 'certificates');
    const incoming = sources.length > 0 ? sources : [certRoot];
    const processFile = (file, snapshot) => {
        if (!fs.existsSync(file))
            return;
        let readable = true;
        try {
            fs.accessSync(file, fs.constants.R_OK);
        }
        catch {
            readable = false;
        }
        if (!readable) {
            result.unreadable.push(file);
            return;
        }
        const base = path.basename(file).toLowerCase();
        const sourceDir = path.dirname(file);
        const hasP7b = snapshotHasFileType(snapshot, sourceDir, 'p7b');
        const hasProfile = snapshotHasFileType(snapshot, sourceDir, 'mobileprovision');
        let platform;
        if (base.endsWith('.mobileprovision'))
            platform = 'ios';
        else if (base.endsWith('.keystore') || base.endsWith('.jks') || base === 'keystore.properties')
            platform = 'android';
        else if (base.endsWith('.p7b'))
            platform = 'harmony';
        else if (base.endsWith('.p12') || base.endsWith('.pfx')) {
            if (findIdenticalFile(dirs.ios, file))
                platform = 'ios';
            else if (findIdenticalFile(dirs.harmony, file))
                platform = 'harmony';
            else if (/harmony|ohos/.test(base))
                platform = 'harmony';
            else if (/ios|apple|distribution|development/.test(base))
                platform = 'ios';
            else if (/release|debug/.test(base))
                platform = hasP7b ? 'harmony' : 'ios';
            else if (hasP7b && !hasProfile)
                platform = 'harmony';
            else if (hasProfile && !hasP7b)
                platform = 'ios';
            else {
                result.abnormal.push(`p12 平台不明确: ${file}`);
                return;
            }
        }
        else if (base.endsWith('.cer')) {
            if (/harmony|ohos/.test(base))
                platform = 'harmony';
            else if (hasP7b)
                platform = 'harmony';
            else {
                result.abnormal.push(`cer 平台不明确: ${file}`);
                return;
            }
        }
        else {
            return;
        }
        if (platform === 'android' && base === 'keystore.properties') {
            const keystoreName = directoryHasFileType(sourceDir, 'jks')
                ? 'release.jks'
                : directoryHasFileType(sourceDir, 'keystore')
                    ? 'release.keystore'
                    : 'release.keystore';
            normalizeKeystoreProperties(file, keystoreName);
        }
        const targetName = canonicalCertificateName(file, platform);
        if (!targetName) {
            result.abnormal.push(`无法解析证书元数据: ${file}`);
            return;
        }
        const target = path.join(dirs[platform], targetName);
        let action = '新增';
        if (fs.existsSync(target)) {
            try {
                if (fs.readFileSync(file).equals(fs.readFileSync(target))) {
                    result.success.push(`未变化（来源保留）: ${file} -> ${target}`);
                    return;
                }
            }
            catch {
                /* fall through to the overwrite path */
            }
            if (seen.has(target)) {
                result.abnormal.push(`同一批次存在多个不同内容的候选文件: ${target}`);
                return;
            }
            seen.add(target);
            const historyDir = path.join(historyRun, platform);
            fs.mkdirSync(historyDir, { recursive: true });
            let historyFile = path.join(historyDir, path.basename(target));
            if (fs.existsSync(historyFile))
                historyFile = path.join(historyDir, `${timestamp()}-${path.basename(target)}`);
            fs.renameSync(target, historyFile);
            action = '更新';
        }
        else {
            if (seen.has(target)) {
                result.abnormal.push(`同一批次存在多个不同内容的候选文件: ${target}`);
                return;
            }
            seen.add(target);
        }
        if (!copyAtomically(file, target)) {
            result.failure.push(`复制失败，来源保留: ${file}`);
            return;
        }
        result.success.push(`${action}（来源保留）: ${file} -> ${target}`);
        result.processed += 1;
    };
    for (const source of incoming) {
        const resolved = absoluteDir(source);
        if (!resolved) {
            result.abnormal.push(`证书目录不存在: ${source}`);
            continue;
        }
        if (Object.values(dirs).includes(resolved))
            continue;
        const snapshot = listFiles(resolved).filter(looksImportable);
        for (const file of snapshot) {
            if (/^certificates[\\/](iOS|Android|HarmonyOS)[\\/]/.test(path.relative(root(settings), file)))
                continue;
            processFile(file, snapshot);
        }
    }
    // Source folders inside the certificate root are scratch space: drop them.
    for (const source of incoming) {
        const resolved = absoluteDir(source);
        if (!resolved)
            continue;
        if (resolved === certRoot || Object.values(dirs).includes(resolved))
            continue;
        if (resolved.startsWith(`${certRoot}${path.sep}`))
            fs.rmSync(resolved, { recursive: true, force: true });
    }
    if (!iosReady(settings))
        result.abnormal.push('iOS 证书不完整');
    if (!androidReady(settings))
        result.abnormal.push('未配置 Android release keystore，将沿用项目内测试签名');
    if (!harmonyReady(settings))
        result.abnormal.push('HarmonyOS 证书不完整');
    return result;
}
/** 不是 rm：把文件挪进 logs/certificate-history/<时间戳>/<平台>，随时能手动挪回。 */
export function clearCertificatePlatform(settings, platform) {
    const dirs = certDirs(settings);
    const historyDir = path.join(logsRoot(settings), 'certificate-history', timestamp(), platform);
    fs.mkdirSync(historyDir, { recursive: true });
    const moved = [];
    const move = (file) => {
        const target = path.join(historyDir, path.basename(file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(file, target);
        moved.push(target);
    };
    for (const file of listFiles(dirs[platform]))
        move(file);
    if (platform === 'ios') {
        for (const file of listFiles(signingDir(settings), 2)) {
            const lower = file.toLowerCase();
            if (lower.endsWith('.p12') || lower.endsWith('.pfx') || lower.endsWith('.mobileprovision'))
                move(file);
        }
    }
    fs.mkdirSync(dirs[platform], { recursive: true });
    return { history: historyDir, moved };
}
/** 单条删除同样走归档；`rel` 相对平台目录，拒绝 `..` 与绝对路径。 */
export function removeCertificateFile(settings, platform, rel) {
    if (!rel || rel.startsWith('/') || rel.includes('..')) {
        throw new Error(`cert-remove 拒绝跳出平台目录: ${rel}`);
    }
    const dir = certDirs(settings)[platform];
    const source = path.join(dir, rel);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
        throw new Error(`证书文件不存在: ${rel}`);
    }
    const historyDir = path.join(logsRoot(settings), 'certificate-history', timestamp(), platform);
    const target = path.join(historyDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    return { history: historyDir, moved: [target] };
}
function rowsOf(dir, extensions) {
    if (!fs.existsSync(dir))
        return [];
    const wanted = new Set(extensions);
    return listFiles(dir)
        .filter((file) => wanted.has(path.extname(file).toLowerCase()))
        .map((file) => {
        const stat = fs.statSync(file);
        return {
            path: file,
            name: path.basename(file),
            rel: path.relative(dir, file),
            mtime: Math.floor(stat.mtimeMs / 1000),
        };
    });
}
export function certStatus(settings) {
    const dirs = certDirs(settings);
    const signing = signingDir(settings);
    const keystoreProperties = rowsOf(dirs.android, ['.properties']).filter((row) => row.name === 'keystore.properties');
    return {
        dirs: { ...dirs, signing },
        platforms: {
            ios: {
                ready: iosReady(settings),
                p12: [...rowsOf(dirs.ios, ['.p12', '.pfx']), ...rowsOf(signing, ['.p12', '.pfx'])],
                profiles: [...rowsOf(dirs.ios, ['.mobileprovision']), ...rowsOf(signing, ['.mobileprovision'])],
                details: profilesJson(settings),
            },
            android: {
                ready: androidReady(settings),
                keystores: rowsOf(dirs.android, ['.keystore', '.jks']),
                properties: keystoreProperties,
            },
            harmony: {
                ready: harmonyReady(settings),
                p12: rowsOf(dirs.harmony, ['.p12', '.pfx']),
                cer: rowsOf(dirs.harmony, ['.cer']),
                p7b: rowsOf(dirs.harmony, ['.p7b']),
            },
        },
        docs: DOCS,
    };
}
export function showCertificateStatus(settings) {
    let missing = false;
    if (!iosReady(settings)) {
        warn(`iOS 证书不完整（需要 p12 + mobileprovision）`);
        log(`         UniApp 官方文档: ${DOCS.ios}`);
        missing = true;
    }
    if (!androidReady(settings)) {
        warn(`未配置 Android release keystore，将沿用项目内测试签名`);
        log(`         UniApp 官方文档: ${DOCS.android}`);
        missing = true;
    }
    if (!harmonyReady(settings)) {
        warn(`HarmonyOS 证书不完整（需要 p12 + cer + p7b）`);
        log(`         UniApp 官方文档: ${DOCS.harmony}`);
        missing = true;
    }
    if (!missing)
        log('[证书状态] 正常');
    return !missing;
}
export function printImportResult(result) {
    const section = (title, rows) => {
        log(`${title}（${rows.length}）`);
        for (const row of rows)
            log(`  ${row}`);
    };
    section('成功', result.success);
    section('异常', result.abnormal);
    section('失败', result.failure);
    section('无法读取', result.unreadable);
}
function warn(message) {
    log(`[警告] ${message}`);
}
/** `YYYYMMDD-HHMMSS`, the archive folder name the bash engine uses. */
export function timestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
