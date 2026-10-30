export interface Settings {
    [key: string]: string;
}
export declare function loadSettings(home: string, base?: Settings): Settings;
/** Package directory for a platform, honouring whatever settings.env says. */
export declare function packageDir(settings: Settings, platform: 'ios' | 'android' | 'harmony' | 'mp-weixin'): string;
export declare function keepCount(settings: Settings, key: 'KEEP_BUILD_COUNT' | 'KEEP_LOG_COUNT'): number;
