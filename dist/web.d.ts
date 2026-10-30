import fs from 'node:fs';
export declare const ROUTE_BASE = "/api/app-packager";
export declare const PLATFORM_VALUES: string[];
export declare const SDK_PLATFORM_VALUES: string[];
/**
 * Build the engine CLI argument list: `打包工具.command [check] <平台> [项目] [选项]`.
 *
 * `check` is an engine subcommand, not a flag, so it must come first; passing a
 * bare platform would ask the engine for a full build instead of a check.
 *
 * No project means every project the platform has enabled, which the engine
 * spells `--all` for a single platform (`all` already means every project of
 * every platform); without it `selected_projects` dies on "请指定项目 ID".
 *
 * Build options (iOS release kind, an explicit profile, full permissions, and
 * `KEY=VALUE` overrides) are pass-through: omitting them leaves the engine's own
 * `config/settings.env` and the wired profile in charge.
 *
 * @param {{platform?: string, project?: string, upload?: string, noUpload?: boolean,
 *   version?: string, harmonyDebug?: boolean, keepWork?: boolean, mpWeixinUpload?: boolean, fullPermission?: boolean,
 *   packageKind?: string, profile?: string, set?: string|string[]}} args
 * @param {{check?: boolean}} [options]
 * @returns {string[]}
 */
export interface JobArgs {
    platform?: string;
    action?: string;
    project?: string;
    upload?: string | string[];
    noUpload?: boolean;
    version?: string;
    harmonyDebug?: boolean;
    keepWork?: boolean;
    mpWeixinUpload?: boolean;
    fullPermission?: boolean;
    packageKind?: string;
    profile?: string;
    set?: string | string[];
    [key: string]: any;
}
export declare function engineArgsFor(args?: JobArgs, { check }?: {
    check?: boolean;
}): string[];
export declare const PACKAGE_KINDS: string[];
/**
 * `KEY=VALUE` overrides, from an array or one multi-line textarea value. Blank
 * lines and `#` comments are dropped so a project preset can be pasted as is;
 * a line without a `KEY=` is refused here rather than by a failing engine run.
 *
 * @param {string|string[]} [value]
 * @returns {string[]}
 */
export declare function overrideList(value: any): any[];
/**
 * Platforms an SDK job configures: an explicit list, a single platform, or all
 * of them. `check`/`build` accept the engine's `all`; SDK installs are one
 * engine call per platform, so `all` is expanded here.
 *
 * @param {{platforms?: string[], platform?: string}} [spec]
 * @returns {string[]}
 */
export declare function sdkPlatforms(spec?: any): any[];
/**
 * The platforms a request covers, from `platforms` (a multi-select subset) or
 * the older single `platform`. `all` subsumes the rest, and the engine takes
 * one platform per run, so the panel gets one command per platform.
 *
 * @param {{platform?: string, platforms?: string|string[]}} args
 * @returns {string[]}
 */
export declare function scopePlatforms(args?: any): string[];
/**
 * The project ids a request covers, from `projects` (a multi-select subset) or
 * the older single `project`. Empty means every project the platform enables,
 * which `engineArgsFor` spells `--all`.
 *
 * @param {{project?: string, projects?: string|string[]}} args
 * @returns {string[]}
 */
export declare function scopeProjects(args?: any): string[];
/** One engine run per platform × project: the engine CLI takes exactly one of each. */
export declare function engineCommandsFor(args?: JobArgs, { check }?: {
    check?: boolean;
}): string[][];
/** Where downloads land when the panel's one download-folder field is blank. */
export declare const DEFAULT_DOWNLOAD_DIR: string;
/**
 * Target path of a downloaded installer: the configured folder with `~`
 * expanded, or the OS download folder when blank. One folder serves every
 * platform and project (the panel keeps exactly one setting), and an existing
 * file is never overwritten — downloading the same build twice lands as
 * `name-1.apk` rather than silently replacing it.
 *
 * @param {string} [dir] configured download folder.
 * @param {string} fileName installer file name.
 * @param {(target: string) => boolean} [exists] injectable for tests.
 * @returns {string} absolute destination path.
 */
export declare function downloadDestination(dir: any, fileName: any, exists?: typeof fs.existsSync): string;
/**
 * Ask the host OS for one or more folders. The browser half cannot read the
 * filesystem, so the dialog has to run here; each platform's own picker is used
 * instead of a dependency, and a missing picker only means "type the path
 * yourself". macOS and Linux pick several folders at once; the Windows dialog
 * can only return one, so the panel falls back to repeated picks there.
 *
 * @param {{prompt?: string}} [options]
 * @returns {Promise<{path: string, paths: string[], cancelled?: boolean, error?: string}>}
 */
export interface PickResult {
    path: string;
    paths: string[];
    cancelled?: boolean;
    error?: string;
}
export declare function pickFolder({ prompt }?: {
    prompt?: string;
}): Promise<PickResult>;
/**
 * Turn engine output into the explicit error summary the panel shows above the
 * raw log: the `[FAIL]` / `[WARN]` lines themselves plus their totals. The
 * engine prints one `结果: errors=N warnings=M` per checked project, so those
 * counts are summed; without them the line counts stand in for a run still in
 * flight.
 *
 * @param {string} [text]
 * @returns {{errorCount: number, warningCount: number, failures: string[], warnings: string[]}}
 */
export declare function summarizeOutput(text?: string): {
    errorCount: number;
    warningCount: number;
    failures: any[];
    warnings: any[];
};
/**
 * Run the plugin's own node script (the 升级插件 action) with the same streaming
 * contract as `runEngine`, so the panel shows and cancels it like an engine run.
 */
export interface RunNodeOptions {
    cwd?: string;
    timeoutMs?: number;
    onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
    onSpawn?: (child: any) => void;
}
export declare function runNode(script: string, args?: string[], { cwd, timeoutMs, onLine, onSpawn }?: RunNodeOptions): Promise<any>;
/**
 * In-memory job registry for the panel: at most `limit` runs are kept (the
 * oldest *finished* one is evicted first) and each log is capped at `outputLimit`.
 *
 * @param {{spawn?: typeof runEngine, nodeSpawn?: typeof runNode, limit?: number, outputLimit?: number}} [options]
 */
export interface JobRunnerOptions {
    spawn?: any;
    nodeSpawn?: any;
    limit?: number;
    outputLimit?: number;
}
export declare function createJobRunner({ spawn, nodeSpawn, limit, outputLimit }?: JobRunnerOptions): any;
/**
 * Panel operations, independent of HTTP so they can be unit tested.
 *
 * @param {{config?: object, spawn?: typeof runEngine, limit?: number, outputLimit?: number}} [options]
 */
export interface PanelOptions {
    config?: any;
    spawn?: any;
    nodeSpawn?: any;
    pick?: any;
    limit?: number;
    outputLimit?: number;
    moduleUrl?: string;
    env?: NodeJS.ProcessEnv;
}
export declare function createPanel({ config, spawn, nodeSpawn, pick, limit, outputLimit, moduleUrl, env }?: PanelOptions): any;
export declare function mountWebPanel(ctx: any, config?: any): any;
