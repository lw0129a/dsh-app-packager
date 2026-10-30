export declare const PACKAGE_ROOT: string;
export declare const ENGINE_SOURCE: string;
export declare const ENGINE_ENTRY = "\u6253\u5305\u5DE5\u5177.command";
export declare const ENGINE_WIZARD = "\u521D\u59CB\u5316.command";
export declare const VERSION_FILE = ".engine-version";
export declare function isUserOwned(relativePath: any): boolean;
export declare function packageVersion(): any;
/**
 * Home precedence: explicit --dir > APP_PACKAGER_HOME > ~/AppPackager.
 * The default sits directly in the user's home so that uni-app x projects kept
 * next to it are still discovered by the engine's sibling scan.
 */
export declare function resolveHome(explicit: any): string;
export declare function engineEntryPath(home: any): string;
export declare function isMaterialized(home: any): boolean;
export declare function materializedVersion(home: any): string;
/**
 * Written into a fresh engine home when the engine ships no `.gitignore` of its
 * own — npm drops that file from the tarball. Keeps a user who versions the
 * engine directory from committing local config, certificates or SDK copies.
 */
export declare const HOME_GITIGNORE = "# AppPackager \u5F15\u64CE\u76EE\u5F55\uFF1A\u672C\u5730\u914D\u7F6E\u3001\u8BC1\u4E66\u3001SDK \u4E0E\u4EA7\u7269\u4E0D\u8FDB Git\n.DS_Store\nconfig/*.local.env\nconfig/init.local.env\nconfig/projects/*.env\n!config/projects/project.env.example\ncertificates/*\n!certificates/README.md\n!certificates/\u5904\u7406\u8BC1\u4E66.command\nsigning/current/\nsdk/*\n!sdk/README.md\n!sdk/\u5904\u7406SDK.command\ntools/*\npackages/\nlogs/*\n!logs/.gitkeep\nworkspaces/\n.tmp/\n*.p12\n*.mobileprovision\n*.ipa\n*.apk\n*.hap\n";
/**
 * Copy the packaged engine into `home`.
 *
 * Scripts, docs and templates are refreshed on every version bump; files the
 * user owns (local config, certificates, sdk, packages, logs, workspaces) are
 * left alone.
 */
export declare function materialize(home: any, { force }?: {
    force?: boolean;
}): {
    copied: number;
    skipped: number;
    version: any;
    upToDate: boolean;
};
