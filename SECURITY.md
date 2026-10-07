# Security policy

## Supported versions

The two published packages move together; only the latest release of each is supported.

| Package | Supported |
| --- | --- |
| `app-packager` | latest |
| `dsh-app-packager` | latest |

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting:

<https://github.com/lw0129a/dsh-app-packager/security/advisories/new>

Include the version, the platform, a reproduction (a command line is usually enough) and what you expected instead. Expect an initial reply within a few days. Once a fix is released the advisory is published with credit unless you prefer otherwise.

## What counts as security-relevant here

This tool drives a local build toolchain and handles signing material, so the following are in scope:

- credentials, tokens or certificates appearing in logs, tool output, error messages or npm tarballs;
- an npm tarball or the materialised engine directory shipping private files (`certificates/`, `sdk/`, `config/projects/*.env`, `*.p12`, `*.mobileprovision`);
- command injection or unsafe quoting when the Node layer builds the bash invocation, or when a project config value reaches a shell;
- path traversal when materialising the engine directory or resolving a project's `SOURCE_DIR`;
- anything that makes `.gitignore` protection of an engine directory ineffective.

## Handling secrets in your own checkout

- The engine directory (default `~/AppPackager`) holds real signing material and per-project configuration. It is materialised with a `.gitignore` that excludes `config/projects/*.env`, `certificates/*`, `*.p12`, `*.mobileprovision`, `*.ipa`, `*.apk` and `*.hap` — keep it.
- This repository must never contain those files; `certificates/` and `sdk/` in Git only carry `README.md` and placeholder scripts.
- Upload credentials (for example a pgyer API key) belong in `config/upload.local.env`, which is git-ignored.
- If you believe a credential was committed, rotate it first, then open an advisory.
