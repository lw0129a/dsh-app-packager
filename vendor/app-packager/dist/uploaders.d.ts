/** Artifact platforms an uploader can be offered for. */
export declare const ARTIFACT_PLATFORMS: string[];
/**
 * Every uploader declared in `UPLOAD_PLATFORM_IDS`, with the facts the panel
 * needs to decide whether its checkbox can be ticked:
 *
 * - `available` — enabled, provider script present, provider function declared
 *   (exactly what `set_upload_platforms` filters on);
 * - `platforms` — artifact platforms it accepts, so the panel can grey it out
 *   when the selected build platforms do not intersect;
 * - `reason` — why it is not available, for the hint text.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {Array<{id: string, name: string, enabled: boolean, available: boolean,
 *   platforms: string[], script: string, reason: ''|'disabled'|'script'|'function'}>}
 */
export declare function listUploaders(home: any): {
    id: string;
    name: string;
    enabled: boolean;
    available: boolean;
    platforms: string[];
    script: string;
    reason: string;
    apiKeyVar: string;
    credentialConfigured: boolean;
    userKeyVar: string;
    userKeyConfigured: boolean;
}[];
/** Uploader ids that may be posted to the engine for the given artifact platforms. */
export declare function selectableUploaders(home: any, platforms?: string[]): {
    id: string;
    name: string;
    enabled: boolean;
    available: boolean;
    platforms: string[];
    script: string;
    reason: string;
    apiKeyVar: string;
    credentialConfigured: boolean;
    userKeyVar: string;
    userKeyConfigured: boolean;
}[];
/**
 * Where the official pgyer CLI is installed: inside the engine home, so it
 * travels with the plugin instead of polluting the user's global npm prefix.
 * Mirrors `pgyer_cli_dir()` in engine/lib/uploaders/pgyer.sh.
 */
export declare function pgyerCliDir(home: any): string;
/**
 * Is the pgyer CLI already installed, and which version? Read from the install
 * rather than from upload.env, and report the version the lockfile actually
 * resolved — the engine installs it lazily on the first pgyer upload.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {{package: string, version: string, dir: string, bin: string, installed: boolean}}
 */
export declare function pgyerCliStatus(home: any): {
    package: string;
    version: string;
    dir: string;
    bin: string;
    installed: boolean;
};
/**
 * The installers the engine has already archived, newest first — one entry per
 * `<home>/packages/<platform>/<project>-latest.json`, the same file
 * `upload_latest_artifact()` resolves. The panel uploads these without
 * rebuilding, so it has to show what is actually on disk, including a project
 * whose installer was pruned away (`artifactExists: false`).
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {Array<{platform: string, projectId: string, displayName: string, version: string,
 *   builtAt: string, artifactPath: string, artifactExists: boolean, artifactSize: number,
 *   infoFile: string}>}
 */
export declare function listArtifacts(home: any): any[];
/**
 * Write one uploader credential into `<home>/config/upload.local.env`, the file
 * the engine sources after `upload.env`. Everything else in the file is kept;
 * an empty value removes the entry. The file is user-owned (it is in the home
 * .gitignore) and gets mode 600: it holds an API key.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @param {string} name variable name, e.g. PGYER_API_KEY
 * @param {string} value secret value; '' clears it
 * @returns {{file: string, name: string, configured: boolean}}
 */
export declare function writeUploaderCredential(home: any, name: any, value: any): {
    file: string;
    name: string;
    configured: boolean;
};
