/** Directory name of the engine home inside the plugin. */
export declare const HOME_DIR_NAME = "home";
/** Where older versions kept the engine home. */
export declare const LEGACY_HOME_NAME = "AppPackager";
/** Sibling of the plugin that holds home while an upgrade runs. */
export declare const UPGRADE_BACKUP_DIR_NAME = ".app-packager-home-backup";
/** Installed package name, so a nested dependency is never mistaken for the plugin. */
export declare const PACKAGE_NAME = "dsh-app-packager";
/** Engine entry script; an engine home always has it (or `.engine-version`). */
export declare const ENGINE_ENTRY_NAME = "\u6253\u5305\u5DE5\u5177.command";
/**
 * The directory the plugin lives in, or null when the code is not the plugin at
 * all (a nested dependency tree, or a file copied somewhere else entirely).
 *
 * `import.meta.url` is the exact answer while the file is loaded as-is: either
 * inside `node_modules/dsh-app-packager`, or in the repository that *is* the
 * plugin package (`name` in its own package.json). The DSH_PROFILE_DIR lookup
 * keeps it working if a host ever loads the plugin from a bundled copy.
 */
export declare function pluginRoot(moduleUrl?: string, env?: NodeJS.ProcessEnv): string;
export declare function legacyHome(): string;
export declare function homeInPlugin(root: any): string;
export declare function upgradeBackupDir(root: any): string;
/**
 * Claim a home that a previous upgrade left stashed next to the plugin.
 *
 * `withHomePreserved` restores on every path it survives, but an install that is
 * killed (SIGKILL, closed shell, failed pnpm) can die between the stash and the
 * restore — and then the new plugin version starts with no home at all. Moving
 * the backup back on the next start turns that into a self-healing case instead
 * of a support ticket. Never overwrites an existing home; a leftover backup next
 * to a live home is reported and kept.
 */
export declare function recoverUpgradeBackup(root: any, onNotice?: (message: string) => void): boolean;
/**
 * Home precedence: explicit config > APP_PACKAGER_HOME > <plugin>/home > ~/AppPackager.
 *
 * The first time <plugin>/home is about to be used, an existing ~/AppPackager
 * is renamed into place so previously downloaded SDKs and registered projects
 * move with it. A rename never copies data: if the two paths live on different
 * volumes the old home is kept and reported instead of being duplicated.
 *
 * The move only ever happens for a directory that really is an engine home
 * (`.engine-version` or the engine entry script) — an unrelated folder that
 * happens to carry the old name is left untouched. `legacy` exists so callers
 * (and tests) can name that directory explicitly instead of relying on $HOME.
 */
export interface ResolveHomeOptions {
    moduleUrl?: string;
    env?: NodeJS.ProcessEnv;
    onNotice?: (message: string) => void;
    legacy?: string;
}
export declare function resolvePluginHome(explicit: any, options?: ResolveHomeOptions): string;
/**
 * Loose `x.y.z` comparison: is `candidate` a newer release than `current`?
 *
 * Used before upgrading from a locally packed tarball: the registry's `latest`
 * can be older than what is installed (a version that has not been published
 * yet), and "upgrading" to it would silently take features away.
 */
export declare function isNewerVersion(candidate: any, current: any): boolean;
/** True only for a directory that is (or was) an engine home, never a lookalike. */
export declare function looksLikeEngineHome(dir: any): boolean;
/**
 * Move home aside, run `upgrade()`, then move home back.
 *
 * Every failure path restores the backups before rethrowing, so a failed
 * upgrade leaves the user with the home they started with.
 */
export declare function withHomePreserved(root: any, upgrade: any): Promise<any>;
