/** 平台名到引擎产物目录的映射（`build all` 时逐个拉）。 */
export declare const PLATFORM_DIRS: {
    ios: string;
    android: string;
    harmony: string;
};
/** `user@host`、`user@host:2222`、`ssh://user@host:2222` 都能解析。 */
export interface RemoteTarget {
    user: string;
    host: string;
    port?: number;
    spec: string;
}
export declare function parseRemoteTarget(value: string): RemoteTarget;
/**
 * 远程引擎命令。`~` 开头写成 `"$HOME/…"` 让远端 shell 自己展开，
 * 其余路径原样单引号包住。
 */
export declare function remoteEngineCommand(home: string, args: string[]): string;
export declare function sshArgv(target: RemoteTarget, remoteCommand: string, { key, allowPassword }?: {
    key?: string;
    allowPassword?: boolean;
}): string[];
export declare function scpArgv(target: RemoteTarget, remotePath: string, localPath: string, { key, recursive }?: {
    key?: string;
    recursive?: boolean;
}): string[];
/** spawn 一个外部命令，等到退出；`code` 为整数，被信号杀掉按 1 处理。 */
export interface RunCommandOptions {
    stdio?: any;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
export declare function runCommand(command: string, argv: string[], { stdio, timeoutMs, env }?: RunCommandOptions): Promise<number>;
/** 在远程机器上跑一次引擎命令，返回退出码。 */
export interface RunRemoteOptions {
    target: RemoteTarget;
    key?: string;
    home?: string;
    args?: string[];
    timeoutMs?: number;
    stdio?: any;
    env?: NodeJS.ProcessEnv;
    allowPassword?: boolean;
}
export declare function runRemote({ target, key, home, args, timeoutMs, stdio, env, allowPassword }: RunRemoteOptions): Promise<number>;
/**
 * 把远程 `packages/<平台>/` 拉回本地同名目录。
 * 返回第一个失败的退出码，全成功返回 0。
 */
export interface PullArtifactsOptions {
    target: RemoteTarget;
    key?: string;
    remoteHome?: string;
    localHome: string;
    platform: string;
}
export declare function pullArtifacts({ target, key, remoteHome, localHome, platform }: PullArtifactsOptions): Promise<number>;
