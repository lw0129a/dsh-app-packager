/**
 * Child process helpers the engine needs when it shells out to xcodebuild,
 * hvigorw, HBuilderX or rsync: a hard timeout, streamed lines for the log file,
 * and an optional concurrency slot so SDK-dependent steps stay serialised.
 */
import { type ChildProcess } from 'node:child_process';
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    stdin?: string;
    onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
    onSpawn?: (child: ChildProcess) => void;
}
export interface RunResult {
    code: number;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
}
interface Timer {
    cancel: () => void;
}
declare const sleep: (ms: number) => Promise<void>;
/** One process, captured, killed (SIGTERM then SIGKILL) when the deadline passes. */
export declare function runCommand(command: string, argv: string[], options?: RunOptions): Promise<RunResult>;
/** Counting semaphore: the engine allows exactly one HBuilderX-driven build at a time. */
export declare function createSemaphore(limit: number): <T>(task: () => Promise<T>) => Promise<T>;
export { sleep, type Timer };
