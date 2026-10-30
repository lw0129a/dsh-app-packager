import type { Settings } from './settings.js';
/**
 * The SDK series HBuilderX is built for: `config/sdk.local.env` wins, then the
 * HBuilderX apps own Info.plist, then the packaged default.
 */
export declare function sdkSeries(settings: Settings, _home?: string): string;
/** `SDK/<series>/iOS` — also honours an explicit `IOS_SDK_DIR`. */
export declare function iosSdkDir(settings: Settings, home: string): string;
export declare function androidSdkDir(settings: Settings, home: string): string;
export declare function harmonySdkDir(settings: Settings, home: string): string;
/** A uni-app x iOS SDK: the Xcode project plus its SDK directory. */
export declare function iosSdkUniappxReady(settings: Settings, home: string): boolean;
/** Any usable iOS offline SDK — uni-app x layout or the classic HBuilder-Hello one. */
export declare function iosSdkReady(settings: Settings, home: string): boolean;
export declare function androidSdkReady(settings: Settings, home: string): boolean;
/**
 * Only real runtime output counts: `oh-package.json5` is a manifest the SDK
 * step writes itself, so trusting it would report a failed ohpm install as
 * ready.
 */
export declare function harmonySdkReady(settings: Settings, home: string): boolean;
