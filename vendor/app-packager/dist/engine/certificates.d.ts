import type { Settings } from './settings.js';
export type CertPlatform = 'ios' | 'android' | 'harmony';
export declare const PLATFORM_LABELS: Record<CertPlatform, string>;
declare const DOCS: {
    ios: string;
    android: string;
    harmony: string;
};
export interface CertFileRow {
    path: string;
    name: string;
    rel: string;
    mtime: number;
}
export interface ProfileRow {
    file: string;
    kind: string;
    bundleId: string;
    teamId: string;
    name: string;
    expiry: string;
    uuid: string;
    expired: boolean;
}
export interface CertStatus {
    dirs: {
        ios: string;
        android: string;
        harmony: string;
        signing: string;
    };
    platforms: {
        ios: {
            ready: boolean;
            p12: CertFileRow[];
            profiles: CertFileRow[];
            details: ProfileRow[];
        };
        android: {
            ready: boolean;
            keystores: CertFileRow[];
            properties: CertFileRow[];
        };
        harmony: {
            ready: boolean;
            p12: CertFileRow[];
            cer: CertFileRow[];
            p7b: CertFileRow[];
        };
    };
    docs: typeof DOCS;
}
export interface ImportResult {
    success: string[];
    abnormal: string[];
    failure: string[];
    unreadable: string[];
    processed: number;
    historyRun: string;
}
export declare function certDirs(settings: Settings): Record<CertPlatform, string>;
export declare function platformDir(settings: Settings, platform: CertPlatform): string;
/** bash `directory_has_file_type`: is there a file with this extension directly inside? */
export declare function directoryHasFileType(dir: string, extension: string): boolean;
export declare function iosReady(settings: Settings): boolean;
export declare function androidReady(settings: Settings): boolean;
export declare function harmonyReady(settings: Settings): boolean;
export interface IosProfileFields {
    name: string;
    uuid: string;
    expiry: string;
    teamId: string;
    bundleId: string;
    kind: 'enterprise' | 'development' | 'adhoc' | 'appstore';
}
export declare function iosProfileFields(profileFile: string): IosProfileFields | undefined;
export declare function iosProfileFiles(settings: Settings): string[];
export declare function iosProfileBundleId(profileFile: string): string | undefined;
export declare function profilesJson(settings: Settings): ProfileRow[];
/** Harmony .p7b is a (possibly wrapped) JSON profile: bundle name + type drive the file name. */
export declare function harmonyProfileMetadata(profileFile: string): {
    bundle: string;
    type: string;
} | undefined;
export declare function canonicalCertificateName(file: string, platform: CertPlatform): string | undefined;
export declare function processCertificates(settings: Settings, sources?: string[]): ImportResult;
/** 不是 rm：把文件挪进 logs/certificate-history/<时间戳>/<平台>，随时能手动挪回。 */
export declare function clearCertificatePlatform(settings: Settings, platform: CertPlatform): {
    history: string;
    moved: string[];
};
/** 单条删除同样走归档；`rel` 相对平台目录，拒绝 `..` 与绝对路径。 */
export declare function removeCertificateFile(settings: Settings, platform: CertPlatform, rel: string): {
    history: string;
    moved: string[];
};
export declare function certStatus(settings: Settings): CertStatus;
export declare function showCertificateStatus(settings: Settings): boolean;
export declare function printImportResult(result: ImportResult): void;
/** `YYYYMMDD-HHMMSS`, the archive folder name the bash engine uses. */
export declare function timestamp(date?: Date): string;
export {};
