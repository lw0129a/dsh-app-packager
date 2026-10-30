import { type Settings } from './settings.js';
export type BuildInfo = Record<string, any>;
export interface UploadContext {
    settings: Settings;
    infoFile: string;
    info: BuildInfo;
    file: string;
}
export interface UploadResult {
    ok: boolean;
    message?: string;
}
export interface UploadProvider {
    id: string;
    name: string;
    /** 支持哪些产物平台（ios/android/harmony...）。 */
    platforms: string[];
    upload(context: UploadContext): Promise<UploadResult>;
}
/** 把 `pgyer，pgyer;foo bar` 这类输入规整成去重后的 id 列表。 */
export declare function uploadPlatformIds(raw: string | undefined): string[];
export declare function platformField(settings: Settings, id: string, field: string): string;
export declare function platformEnabled(settings: Settings, id: string): boolean;
export declare function provider(id: string): UploadProvider | undefined;
export declare function supports(settings: Settings, id: string, platform: string): boolean;
export declare function selectedPlatforms(settings: Settings): string[];
export declare function enabledPlatforms(settings: Settings): string[];
export declare function setUploadPlatforms(value: string): void;
/** 某个产物平台下、某个项目最近一次的构建信息文件。 */
export declare function latestInfoFile(settings: Settings, platform: 'ios' | 'android' | 'harmony' | 'mp-weixin', projectId: string): string;
export declare function readBuildInfo(file: string): BuildInfo;
/** 平台是否具备上传条件（缺 key 之类的问题由各 provider 自己决定要不要拦）。 */
export declare function available(settings: Settings, id: string): boolean;
/**
 * 构建后自动上传。返回失败数量，调用方（build）只告警不中止。
 */
export declare function runPostBuildUploads(settings: Settings, infoFile: string): Promise<number>;
/** 独立上传：上传最新一次归档的产物。 */
export declare function uploadLatestArtifact(settings: Settings, platform: 'ios' | 'android' | 'harmony', projectId: string, ids?: string[]): Promise<boolean>;
/** 非交互环境（面板）下不允许等待输入。 */
export declare function isInteractive(): boolean;
