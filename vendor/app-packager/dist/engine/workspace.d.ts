/**
 * Rewrites `manifest.json` in place when it contains comments or trailing
 * commas. Returns whether the file changed; files that still do not parse are
 * left untouched so the downstream step reports the real error.
 */
export declare function manifestJsoncToJson(manifestPath: string): boolean;
export interface WorkspaceOptions {
    sourceDir: string;
    workspace: string;
    workRoot: string;
    /** Build log the rsync/npm output is appended to, like the bash engine. */
    logFile?: string;
}
/** Rebuilds `<workRoot>/<project>/<project>-build-<platform>` from the source project. */
export declare function prepareWorkspace(options: WorkspaceOptions): Promise<void>;
