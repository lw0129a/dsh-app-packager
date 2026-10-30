/** Parse a bash-style KEY=value file. Values quoted by the engine's `%q` survive. */
export declare function parseEnvText(text: string, vars?: Record<string, string>): Record<string, string>;
export declare function parseEnvFile(file: string, vars?: Record<string, string>): Record<string, string>;
export declare function projectsDir(home: any): string;
/** Every configured project, with the local facts a caller needs to act. */
export declare function listProjects(home: any): {
    id: string;
    file: string;
    sourceDir: string;
    sourceDirExists: boolean;
    appName: string;
    bundleId: string;
    teamId: string;
    profileFile: string;
    platforms: {
        ios: any;
        android: any;
        harmony: any;
        'mp-weixin': any;
    };
    enabledPlatforms: string[];
    error: any;
}[];
export declare function findProject(home: any, id: any): {
    id: string;
    file: string;
    sourceDir: string;
    sourceDirExists: boolean;
    appName: string;
    bundleId: string;
    teamId: string;
    profileFile: string;
    platforms: {
        ios: any;
        android: any;
        harmony: any;
        'mp-weixin': any;
    };
    enabledPlatforms: string[];
    error: any;
};
/** Platform tokens accepted by the engine CLI. */
export declare const PLATFORMS: string[];
