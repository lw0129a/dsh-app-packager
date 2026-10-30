export declare const name = "app-packager";
/** Without the tool registry the plugin stays inactive instead of throwing. */
export declare const inject: string[];
/** Optional: only used to validate/complete the bundle patch config. */
declare let Config: any;
export { Config };
/**
 * @param {object} ctx harness context (needs `tools`).
 * @param {object} [rawConfig] bundle patch config.
 */
export declare function apply(ctx: any, rawConfig?: {}): void;
