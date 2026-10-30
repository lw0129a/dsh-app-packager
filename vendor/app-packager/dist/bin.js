#!/usr/bin/env node
import { main } from './cli.js';
import { EngineError } from './engine/common.js';
main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
}, (error) => {
    // Engine failures are already phrased for the operator; anything else is a bug.
    console.error(error?.name === new EngineError('').name ? `ERROR ${error.message}` : error?.stack || String(error));
    process.exitCode = 1;
});
