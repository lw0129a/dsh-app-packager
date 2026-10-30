/** PATH lookup without a shell, honouring PATHEXT on Windows. */
export declare function findExecutable(name: any): any;
/**
 * @returns {{kind: 'native'|'git-bash'|'wsl', command: string, argsPrefix: string[],
 *            toShellPath: (p: string) => string|null, hint?: string}}
 */
export declare function resolveShell(): {
    kind: string;
    command: any;
    argsPrefix: any[];
    toShellPath: (p: any) => any;
    hint?: undefined;
} | {
    kind: string;
    command: any;
    argsPrefix: string[];
    toShellPath: (p: any) => string;
    hint: string;
};
export declare function shellAvailable(): {
    available: boolean;
    shell: {
        kind: string;
        command: any;
        argsPrefix: any[];
        toShellPath: (p: any) => any;
        hint?: undefined;
    } | {
        kind: string;
        command: any;
        argsPrefix: string[];
        toShellPath: (p: any) => string;
        hint: string;
    };
    error?: undefined;
} | {
    shell?: undefined;
    available: boolean;
    error: any;
};
/**
 * Arguments that make bash run one engine action.
 *
 * @param {string} [options.script] engine script to run instead of the default
 *   entry (used for the interactive 初始化.command wizard).
 */
export interface EngineCommandOptions {
    searchRoots?: string[];
    shell?: any;
    script?: string;
}
export declare function engineCommand(home: string, args: string[], { searchRoots, shell, script }?: EngineCommandOptions): {
    shell: any;
    command: any;
    args: any[];
    env: {
        PIPELINE_ROOT: any;
        PROJECT_SEARCH_ROOTS: string;
        LANG: string;
    };
    cwd: any;
};
/**
 * Run one engine action.
 *
 * @param {object} options
 * @param {string} options.home
 * @param {string[]} options.args
 * @param {'inherit'|'pipe'} [options.stdio]
 * @param {'inherit'|'ignore'} [options.stdin] `inherit` is required by the
 *   interactive wizard; every non-interactive call must ignore stdin so the
 *   engine's trailing `read` sees EOF instead of hanging a child process.
 * @param {number} [options.timeoutMs]
 * @param {(line: string, stream: 'stdout'|'stderr') => void} [options.onLine]
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onSpawn]
 *   called with the child right after spawn, so a caller can cancel the run.
 * @param {string[]} [options.searchRoots]
 * @param {string} [options.script]
 */
export interface RunEngineOptions extends EngineCommandOptions {
    stdio?: any;
    stdin?: any;
    timeoutMs?: number;
    onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
    onSpawn?: (child: import('node:child_process').ChildProcess) => void;
}
export interface EngineResult {
    code: number;
    signal: string | null;
    stdout: string;
    stderr: string;
    shellKind?: string;
}
export declare function runEngine(home: string, args: string[], { stdio, stdin, timeoutMs, onLine, onSpawn, searchRoots, shell, script }?: RunEngineOptions): Promise<EngineResult>;
