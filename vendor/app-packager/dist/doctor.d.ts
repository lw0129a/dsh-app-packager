declare const PLATFORM_LABELS: {
    ios: string;
    android: string;
    harmony: string;
    'mp-weixin': string;
};
export declare function runDoctor({ home, platform }: {
    home: string;
    platform?: string;
}): {
    ok: boolean;
    home: string;
    platform: string;
    platformName: any;
    checks: any[];
    failures: number;
    warnings: number;
    projects: {
        id: string;
        enabledPlatforms: string[];
        sourceDir: string;
        sourceDirExists: boolean;
    }[];
};
export { PLATFORM_LABELS };
