[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing

Thanks for helping. This project ships a local packaging toolchain, so a wrong change can cost somebody a signed build — the rules below exist to keep that from happening.

## Set up

```bash
git clone https://github.com/lw0129a/dsh-app-packager.git
cd dsh-app-packager
pnpm install          # pnpm is pinned through the packageManager field
pnpm test             # node --test for both packages
```

Node 18 or newer. Node 20 is what `.nvmrc` pins.

## Before you open a PR

```bash
pnpm test             # required
pnpm docs:check       # required when you touched documentation
pnpm -r pack --pack-destination /tmp/ap-pack   # when you touched anything shipped
```

A PR should do one thing, come with a test for any behaviour change, and update the docs it invalidates. The full rule set lives in [AGENTS.md](AGENTS.md) — it is written for coding agents but it is the same contract for humans; the load-bearing parts are:

- **Engine changes update the engine spec in the same commit.** Anything touching scripts, config keys, CLI arguments, directory layout, artefacts, signing or upload rules under `packages/app-packager/engine/` must also update `packages/app-packager/engine/项目介绍.md` (including its changelog and "last updated" date) and bump the engine script version.
- **Project discovery must not regress.** Init still has to auto-discover sibling uni-app x projects (`manifest.json` + `pages.json`, or a `src/` layout) while keeping manual absolute paths working.
- **No runtime dependencies in the CLI.** `packages/app-packager` uses Node built-ins only; `packages/dsh-app-packager` must not import `@deepseek-ai/*` at runtime.
- **Never commit credentials.** Certificates, `*.p12`, provisioning profiles, `signing/current/`, `sdk/` contents, `config/*.local.env` and `config/projects/*.env` stay out of Git.
- **Do not claim iOS support outside macOS**, and do not rewrite the bash engine into Node to fake portability.

## Documentation

Public docs come in pairs, English first:

| English | 中文 |
| --- | --- |
| `README.md` | `README.zh-CN.md` |
| `CONTRIBUTING.md` | `CONTRIBUTING.zh-CN.md` |
| `docs/en/*.md` | `docs/zh-CN/*.md` |
| `packages/*/README.md` | `packages/*/README.zh-CN.md` |

Every user-facing document starts with a language switch line. Change one side, change the other — `pnpm docs:check` fails the build on a missing counterpart. The engine's own `项目介绍.md` stays Chinese; it is the authoritative spec for the bash layer and is bound by the engine's `AGENTS.md`.

## Commits and branches

Conventional Commits, one change per commit:

```
feat: add app_packager_upload_artifacts tool
fix: expand $PIPELINE_ROOT in project env values
docs: translate the Windows notes to English
```

Branch from `main`, keep history linear (rebase rather than merge), and open the PR against `main` using the template.

## Releasing

Maintainers only. Both packages share a version number; the plugin's caret dependency on the CLI is raised when needed. See [docs/en/publishing.md](docs/en/publishing.md). Publishing uses npm staged publishing plus a browser-side 2FA approval, and a marketplace entry lives in a separate catalogue repository.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. For anything security-relevant (credentials leaking into logs, a tarball shipping private files, an unsafe shell invocation), do **not** open a public issue — follow [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
