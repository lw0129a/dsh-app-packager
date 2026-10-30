export declare function log(message: string): void;
export declare function warn(message: string): void;
/** The bash engine's `die`, as a throwable: the CLI prints it and exits with 1. */
export declare class EngineError extends Error {
    name: string;
}
export declare function die(message: string): never;
export declare function requireCmd(command: string, env?: NodeJS.ProcessEnv): void;
/** Absolute path of an existing directory, symlinks resolved; undefined when it is not one. */
export declare function absoluteDir(target: string): string | undefined;
export declare function projectIds(home: string): string[];
export interface ManifestMetadata {
    name: string;
    appId: string;
    versionName: string;
    versionCode: string;
    associatedDomains: string[];
}
/** `manifest_metadata`: the handful of fields packaging needs from manifest.json (JSONC). */
export declare function manifestMetadata(file: string): ManifestMetadata;
export declare const isUniAppProject: (dir: string) => boolean;
export declare const projectManifestPath: (dir: string) => string | undefined;
export declare const projectPagesPath: (dir: string) => string | undefined;
export declare const workspaceManifestPath: (root: string) => string | undefined;
export declare const workspaceAppFile: (root: string) => string | undefined;
/** uni-app x has the `"uni-app-x"` key in manifest.json; classic uni-app does not. */
export declare function projectIsUniappx(manifest: string): boolean;
/** 1.8 → 8, 21.0.1 → 21, nothing when java is missing. */
export declare function javaMajorVersion(env?: NodeJS.ProcessEnv): Promise<string>;
/**
 * Classic uni-app offline projects are AGP 8 + Gradle 8, which only understands
 * JDK up to 23: a JDK 25 default makes Gradle blow up on class file version 69.
 */
export declare function classicAndroidJavaHome(env?: NodeJS.ProcessEnv): Promise<string | undefined>;
/** Directory name → project id: lowercase, non-alphanumerics collapsed to `-`. */
export declare function projectIdFromSourceDir(dir: string): string;
/** Bundle id an existing native project already declares, so re-registering keeps it. */
export declare function projectBundleIdFromSourceDir(dir: string): string | undefined;
/**
 * HBuilderX 5.26's Android compiler treats any project path containing
 * `node_modules` as a dependency and then cannot resolve its own generated
 * imports. The npm install puts the engine home exactly there, so the workspace
 * has to move out — and HBuilderX must be handed the real path, not a symlink.
 */
export declare function relocateWorkRoot(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string;
/** Newest gradle that actually runs, from the wrapper cache. */
export declare function findCachedGradle(env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<string | undefined>;
