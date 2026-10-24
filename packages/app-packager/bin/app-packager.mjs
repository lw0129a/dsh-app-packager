#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  },
);
