/**
 * Ports of the workspace helpers in `engine/lib/common.sh`: strip JSONC so
 * HBuilderX's manifest parser sees plain JSON, and copy the business project
 * into the isolated work tree (the source project is never written to).
 */
import fs from 'node:fs';
import path from 'node:path';
import { EngineError, log } from './common.js';
import { runCommand } from './run.js';
/**
 * Rewrites `manifest.json` in place when it contains comments or trailing
 * commas. Returns whether the file changed; files that still do not parse are
 * left untouched so the downstream step reports the real error.
 */
export function manifestJsoncToJson(manifestPath) {
    if (!fs.existsSync(manifestPath))
        return false;
    const text = fs.readFileSync(manifestPath, 'utf8');
    const out = [];
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            out.push(char);
            if (char === '\\' && i + 1 < text.length) {
                out.push(text[i + 1]);
                i += 1;
            }
            else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            out.push(char);
            continue;
        }
        if (char === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n')
                i += 1;
            i -= 1;
            continue;
        }
        if (char === '/' && text[i + 1] === '*') {
            i += 2;
            while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/'))
                i += 1;
            i += 1;
            continue;
        }
        out.push(char);
    }
    const clean = out.join('').replace(/,(\s*[}\]])/g, '$1');
    try {
        JSON.parse(clean);
    }
    catch {
        return false;
    }
    if (clean === text)
        return false;
    fs.writeFileSync(manifestPath, clean);
    return true;
}
const RSYNC_EXCLUDES = ['/.git', '/node_modules', '/unpackage', '/app-ios', '/build', '.DS_Store'];
async function appendToLog(logFile, stdout) {
    if (!logFile || !stdout)
        return;
    await fs.promises.appendFile(logFile, stdout);
}
/** Rebuilds `<workRoot>/<project>/<project>-build-<platform>` from the source project. */
export async function prepareWorkspace(options) {
    const { sourceDir, workspace, workRoot, logFile } = options;
    if (!fs.existsSync(sourceDir))
        throw new EngineError(`项目目录不存在: ${sourceDir}`);
    const relative = path.relative(workRoot, workspace);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new EngineError(`拒绝操作构建工作区之外的路径: ${workspace}`);
    }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true });
    log(`复制项目到隔离工作区: ${workspace}`);
    const rsync = await runCommand('rsync', ['-a', '--delete', ...RSYNC_EXCLUDES.map((item) => `--exclude=${item}`), `${sourceDir}/`, `${workspace}/`]);
    await appendToLog(logFile, rsync.stdout);
    if (rsync.code !== 0)
        throw new EngineError('复制项目失败');
    if (manifestJsoncToJson(path.join(workspace, 'manifest.json'))) {
        log('manifest.json 已规范化为标准 JSON（去掉 JSONC 注释与尾逗号）');
    }
    // HBuilderX needs the project's own node_modules (postcss/tailwind plug-ins).
    // Copied rather than symlinked so HBuilderX caches never write back into the
    // business project.
    if (fs.existsSync(path.join(sourceDir, 'node_modules'))) {
        log('复制 node_modules 到隔离工作区');
        const copy = await runCommand('rsync', ['-a', `${path.join(sourceDir, 'node_modules')}/`, `${path.join(workspace, 'node_modules')}/`]);
        await appendToLog(logFile, copy.stdout);
        if (copy.code !== 0)
            throw new EngineError('复制 node_modules 失败');
    }
    else if (fs.existsSync(path.join(workspace, 'package-lock.json'))) {
        log('业务项目没有 node_modules，尝试离线 npm ci');
        const npm = await runCommand('npm', ['ci', '--ignore-scripts', '--offline'], { cwd: workspace });
        await appendToLog(logFile, npm.stdout);
        if (npm.code !== 0)
            throw new EngineError('离线 npm ci 失败，请先在业务项目执行 npm ci');
    }
}
