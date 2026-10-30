#!/usr/bin/env node
/**
 * Find the `dsh` CLI. Only `/usr/local/bin/dsh` used to be tried, so a Homebrew
 * install, a per-user bin directory or any other PATH layout fell through to
 * `pnpm add` — which is the wrong package manager for a DSH profile and the main
 * way an upgrade ends in a broken profile on someone else's machine.
 */
export declare function findDsh(env?: NodeJS.ProcessEnv): string;
