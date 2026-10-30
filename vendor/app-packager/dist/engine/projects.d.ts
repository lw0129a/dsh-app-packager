/** Keys `--set` may override. Path-ish keys the engine derives are deliberately absent. */
export declare const PACKAGE_ENV_OVERRIDE_KEYS: string[];
/** Appends one `KEY=VALUE` to the `--set` list; throws on anything the engine would reject. */
export declare function setPackageOverride(pair: string, previous?: string): string;
/** `KEY=VALUE` lines → map. Handles the `%q` quoting bash writes and `#` comments. */
export declare function parseEnvFile(file: string): Record<string, string>;
export declare function projectSearchRoots(env?: NodeJS.ProcessEnv, pipelineRoot?: string): string[];
/** One level under each search root, uni-app projects only. */
export declare function discoverUniAppProjects(roots: string[], pipelineRoot?: string): string[];
export interface ProjectContext {
    /** Every variable the project env file declares, plus the derived ones below. */
    vars: Record<string, string>;
    projectId: string;
    sourceDir: string;
    displayName: string;
    appId: string;
    workspace: string;
    runId: string;
    runDir: string;
    logFile: string;
    packageEnv: string;
    profilePlist: string;
}
export interface LoadProjectOptions {
    pipelineRoot: string;
    workRoot: string;
    logRoot: string;
    /** `APP_PACKAGER_BUILD_PLATFORM`: suffixes workspace and run id so platforms do not collide. */
    buildPlatform?: string;
    /** `--set` pairs, already validated. */
    overrides?: Record<string, string>;
    /** `APP_PACKAGER_FULL_PERMISSION` / `APP_PAGER_PROFILE_FILE` style CLI overrides. */
    fullPermission?: string;
    profileFile?: string;
}
/**
 * Mirrors `load_project`: read the project env, overlay manifest metadata, apply
 * the `--set` overrides, then derive the run paths. Throws (`die`) on the same
 * missing fields bash refuses, so a broken project fails the same way.
 */
export declare function loadProject(id: string, options: LoadProjectOptions): ProjectContext;
/** `init_run`: the directories every build needs before it starts. */
export declare function initRun(context: ProjectContext, pipelineRoot: string, packageDirs: string[]): string;
export interface BuildLock {
    dir: string;
    release: () => void;
}
/**
 * `acquire_build_lock`: one build per project (per platform) at a time. A lock
 * whose pid is gone is stale and gets taken over, matching the bash engine.
 */
export declare function acquireBuildLock(pipelineRoot: string, projectId: string, buildPlatform?: string): BuildLock;
