/**
 * Child process helpers the engine needs when it shells out to xcodebuild,
 * hvigorw, HBuilderX or rsync: a hard timeout, streamed lines for the log file,
 * and an optional concurrency slot so SDK-dependent steps stay serialised.
 */
import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';

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

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** One process, captured, killed (SIGTERM then SIGKILL) when the deadline passes. */
export function runCommand(command: string, argv: string[], options: RunOptions = {}): Promise<RunResult> {
  const { cwd, env, timeoutMs = 0, stdin, onLine, onSpawn } = options;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, argv, { cwd, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const lines = (chunk: string, stream: 'stdout' | 'stderr') => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line !== '') onLine?.(line, stream);
      }
    };
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      lines(text, 'stdout');
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      lines(text, 'stderr');
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, signal, timedOut, stdout, stderr });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }, timeoutMs);
      timer.unref?.();
    }
  });
}

/** Counting semaphore: the engine allows exactly one HBuilderX-driven build at a time. */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  };
}

export { sleep, type Timer };
