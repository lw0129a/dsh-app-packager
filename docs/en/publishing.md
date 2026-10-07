[English](publishing.md) | [简体中文](../zh-CN/publishing.md)

# Publishing and listing

How the two packages get to npm and how the plugin shows up in the DeepSeek Harness plugin market.

## 1. Pre-release checks

```bash
pnpm install
pnpm test                                      # node --test for both packages
pnpm -r pack --pack-destination /tmp/ap-pack   # inspect the tarballs before publishing
```

Three things to confirm:

1. The `packages/app-packager` tarball contains `engine/` (~46 files, ~124 KB) and both `engine/打包工具.command` and `engine/lib/common.sh` are present.
   Note that **pnpm writes every file in the tarball as 644** (`npm pack` is what preserves 755), so do not rely on the tarball's mode bits: the CLI restores 755 for `.command`/`.sh` when it materialises the engine (`EXECUTABLE` in `src/home.mjs`, unit-tested), so the user's copy is double-clickable.
2. In the `packages/dsh-app-packager` tarball, the `app-packager` dependency has been rewritten from `workspace:^0.2.0` to `^0.2.0` (npm does not understand the workspace protocol; an unrewritten dependency installs nowhere).
3. Both `package.json` `version` fields have been bumped.

Both packages live on the public npm registry with **unscoped names** (`app-packager`, `dsh-app-packager`). Publishing only requires that `npm whoami` is you (`lw0129a`):

```bash
npm login
```

### Preferred: let GitHub Actions publish (trusted publishing, no token, no OTP)

`.github/workflows/publish.yml` is ready: a `v*` tag publishes both packages, or run `gh workflow run publish.yml` from the Actions tab. It uses `id-token: write` so npm identifies this repository through OIDC — **the workflow holds no npm token at all**, which sidesteps both "a bypass token cannot publish directly" and "an OTP is required".

One-time setup (once per package, after the account is restored): npmjs.com → package → **Settings → Trusted Publisher → GitHub Actions**, then `Organization or user = lw0129a`, `Repository = dsh-app-packager`, `Workflow filename = publish.yml` (leave the environment field empty unless the workflow declares one; both sides must match).

The npm CLI can do it instead (npm ≥ 11.5.1; the bundled npm 10.x has no such subcommand, so use `npx --yes npm@11` or npm 11 from Node 20):

```bash
npx --yes npm@11 trust github app-packager     --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish
npx --yes npm@11 trust github dsh-app-packager --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish
```

It first prints `package` / `file` / `repository` / `permissions: publish` for confirmation, then asks for 2FA: npm prints (and tries to open) `https://www.npmjs.com/auth/cli/<id>` — approving there is **the only manual step**; a bypass-2FA granular token cannot make account-level changes. `npm trust list <package>` shows the current configuration (also needs 2FA).

Requirements and traps:

- npm ≥ 11.5.1; the workflow uses `node-version: '24'` (which ships npm 11.x) and **deliberately omits** `setup-node`'s `registry-url` — that writes an `_authToken` placeholder which would stop npm from using OIDC.
- The workflow enforces the order: `app-packager` first, then `dsh-app-packager` (which depends on it).
- Validate with `gh workflow run publish.yml -f dry_run=true` (packs and authenticates, uploads nothing), then run it for real.
- A publish step that ends in `npm error code ENEEDAUTH` almost always means "this package has no trusted publisher yet": npm swallows the failed OIDC token exchange at verbose level and all you see is "you need to be logged in". The workflow now sets `NPM_CONFIG_LOGLEVEL=verbose` on the publish step, so the log also carries `oidc Failed token exchange request with body message: …` — the registry's own words. A dry run goes through the same OIDC exchange (npm exchanges the token before it looks at `dry_run`), so you can tell whether the configuration took effect before publishing for real.
- While the account is temporarily suspended OIDC is refused too (403), so restore the account first.
- The tag and both `package.json` versions must match; the workflow checks that before publishing.

### With 2FA enabled: npm staged publishing

Since July 2026 npm has been restricting bypass-2FA granular tokens: they can no longer perform account/org/package management, and direct publishing is on the removal list ([Restricting npm bypass-2FA granular access tokens](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)). Measured on this account (`lw0129a`, 2FA `auth-and-writes`, 2026-10-07):

| Attempt | Result |
| --- | --- |
| `pnpm publish` / `npm publish` with the logged-in token in `.npmrc` | `403 … Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.` |
| Direct publish with a granular token that has Bypass 2FA ticked | masked as `404 Not found`; the registry really answers `E_STAGE_REQUIRED`: `this token can only publish to a staging area, and "<pkg>" does not exist yet. Create it first with a direct-capable token, then use 'npm stage publish'.` |
| `npm stage publish` (same bypass token) | **works**, no OTP needed, and it can create brand-new packages (supported since 2026-10-02) |

Conclusion: **upload with `npm stage publish`, then approve as yourself with 2FA**. Approval, however, **cannot be done from the CLI**: `npm stage approve <id>` (tried Node 20/24 × npm 11.21.0/12.2.0, with and without `--otp`, and a raw `POST /-/stage/<id>/approve`) always returns `404 staged version "…" not found`, with `npm-notice: npm tokens that bypass 2FA are being restricted…` — the registry disguises "this credential may not approve" as a 404, and the npm CLI only prompts for an OTP on a 401, so it never asks. Node versions, npm versions and re-login change nothing.

**The working approval entry point is the `Staged Packages` tab on npmjs.com** (a logged-in browser session plus the 2FA prompt on the page); verified by hand. It is also one of the two documented paths in npm's `content/packages-and-modules/securing-your-code/staged-publishing.mdx`.

`npm stage` needs npm ≥ 11 (`npm stage --help` printing output means it is supported). npm 12.2.0 requires Node ≥ 22.22.2, so on Node 20 install 11.x:

```bash
npm i -g --prefix /tmp/ap-npm11 npm@11
/tmp/ap-npm11/bin/npm --version   # expect 11.x
```

## 2. Publishing to npm

Pack the real artefacts with `pnpm pack` first (**the plugin must be packed by pnpm**: its dependency is written as `workspace:^0.2.0`, and only pnpm rewrites that to `^0.2.0`; `npm pack` keeps the workspace protocol and installing it into a profile fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`):

```bash
pnpm -r pack --pack-destination /tmp/ap-pack2
ls /tmp/ap-pack2                   # app-packager-*.tgz / dsh-app-packager-*.tgz (plus the private root package)

tar -xzOf /tmp/ap-pack2/dsh-app-packager-0.2.0.tgz package/package.json | grep -A2 '"dependencies"'
# expect "app-packager": "^0.2.0"
```

Optionally install locally once:

```bash
npm install -g --prefix /tmp/ap-prefix /tmp/ap-pack2/app-packager-0.2.0.tgz
/tmp/ap-prefix/bin/app-packager doctor
```

CI's `pack` job already validates "no `workspace:` left in the tarball" and "the engine entry point is present".

Then push both tarballs into the staging area (`stage publish` accepts a tarball path directly):

```bash
NPM=/tmp/ap-npm11/bin/npm          # the system npm 10.x has no stage subcommand

$NPM stage publish /tmp/ap-pack2/app-packager-0.2.0.tgz
$NPM stage publish /tmp/ap-pack2/dsh-app-packager-0.2.0.tgz

$NPM stage list                    # stage ids and status: validating → staged
```

The maintainer then **personally** approves on npmjs.com (a 2FA prompt appears):

1. open <https://www.npmjs.com> (logged in as `lw0129a`);
2. go to the **Staged Packages** tab — one row per pending package showing name, `PUBLIC`, version, shasum and submitter, with **Approve / Reject / Inspect** on the right;
3. click **Approve** on each and enter the 6-digit code; they publish immediately.

```bash
$NPM stage list                    # approved entries disappear
npm view app-packager version      # expect the new version
```

> - A freshly staged entry is `status: validating` (the registry validates the tarball asynchronously); approving/viewing it then may answer `staged version "…" not found` — wait for `staged`.
> - **Do not retry the CLI for approval**: `npm stage approve` is a fixed 404 for this credential kind (see above); `--otp` does not help.
> - **npm recovery codes are not CLI OTPs**: feeding a code from `npm_recovery_codes.txt` to `npm publish --otp=…` makes the registry answer `Your account has been temporarily suspended due to a recent security-sensitive action.` and then `403 Forbidden - PUT …`; after that even `npm stage publish` returns 403 (measured here 2026-10-07; read operations keep working). Recovery codes belong to npmjs.com's account-recovery flow only. Once tripped you can only wait out the suspension or appeal — do not retry.
> - `npm stage download <id>` currently 404s on the registry side, so **check tarballs locally with `pnpm -r pack`** instead of downloading them back.
> - If the local npm cache has bad permissions (`EPERM … _cacache`), add `npm_config_cache=/tmp/ap-npmcache`.
> - A bad release can be removed with `npm unpublish <pkg>@<version>`, but the same name+version is unusable for 24 hours; prefer a new version. Unpublishing a whole package requires a one-time password (`EOTP`) and must be done from a browser session (`npm unpublish <pkg> --force` opens `https://www.npmjs.com/auth/cli/...`), or via package Settings → Delete package.
> - Once a package is out, configure **trusted publishing (OIDC)** in its npm settings so GitHub Actions publishes as the repository, which removes the staging approval step entirely.

## 3. Getting the plugin into the market

The Harness plugin market (dshmarket) **does not take entry PRs** and **does not search what you installed locally**: its search and list have exactly one data source — the curated catalogue [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin). A plugin that only lives in your profile is simply not in that catalogue, which is not a bug.

- The market fetches `https://awesome-dsh-plugin.com/plugins.json` when it opens (`CATALOG_OFFICIAL` in `dshmarket/lib/regions.js`; the China region reads the same file from the npm package `dsh-plugin-catalog`, see `dshmarket/lib/catalog-npm.js`). `DSHM_REGISTRY_URL` can point at a mirror with the same shape.
- `page` / `install` / `stars` / `downloads` / `capabilities` / `added` are generated by their CI; you only author the human fields.

**Publishing to npm is not a prerequisite for listing**: the "npm package (optional)" section of `contributing.md` states that listing is independent of npm. Publishing only buys the download counter and prebuilt install in the market. The entry **must not** contain a hand-written `npm:` key (it is rejected); the mapping is collected from the registry — provided the published package's `repository` field points back at the listed repository (both of ours do).

An entry is one new YAML file in their repository, one file per plugin:

```text
data/plugins/<owner>__<repo>.yml                              # root package
data/plugins/<owner>__<repo>--<subpackage path, / → ->.yml    # monorepo subpackage
```

This project is a monorepo (the root package is the CLI, the plugin is `packages/dsh-app-packager`), so it uses the subpackage form: `url` points into the subdirectory and `name` carries the subpackage after `#`.

```yaml
# data/plugins/lw0129a__dsh-app-packager--packages-dsh-app-packager.yml
url: https://github.com/lw0129a/dsh-app-packager/tree/main/packages/dsh-app-packager
name: lw0129a/dsh-app-packager#dsh-app-packager
category: dev
description:
  en: 'Packaging pipeline for uni-app x projects: drives the HBuilderX CLI to build, sign and upload iOS, Android and HarmonyOS apps from per-project config files, and exposes the engine to the agent as list / doctor / check / build tools.'
  zh: 'uni-app x 项目打包流水线：按项目配置调用 HBuilderX CLI 打出并签名 iOS / Android / HarmonyOS 安装包，并以 list / doctor / check / build 四个工具暴露给 agent。'
```

| Field | Meaning |
| --- | --- |
| `url` | Repository (or subdirectory) URL, used to fetch stars; **must be public** |
| `name` | `<owner>/<repo>`; for a monorepo subpackage `<owner>/<repo>#<subpackage>`, which also decides the file name |
| `category` | One of the values listed in their `contributing.md`; this plugin is a build/packaging flow, so `dev` |
| `description.zh` / `.en` | Bilingual, both must say the same thing; only `en` is required. **A `: ` (colon+space) inside a value must be quoted**, otherwise YAML reads it as a nested key |
| `tarball` | Optional prebuilt tgz from a GitHub Release (for plugins that do not publish to npm) |

### What their CI checks (`scripts/check-submission.mjs`)

1. At most 3 entries per PR.
2. **`dsh.bundle`**: read from the `package.json` the entry points at (root, or a `packages/` · `plugins/` · `apps/` subpackage). Ours lives in `packages/dsh-app-packager/package.json` and declares `dsh.bundle.patch` — satisfied.
3. **`MIN_AGE_DAYS = 1`: the repository must be at least one day old. This failure clears itself** — the checker literally says not to resubmit, push or reopen; `regate.yml` (cron `19 */6 * * *`) re-runs the gate every 6 hours and it turns green on time.
4. The repository must carry the `dsh-plugin` topic.
5. Official `@deepseek-ai/*` packages must be `peerDependencies`, not `dependencies`.
6. A first-time contributor's fork PR needs one maintainer approval before the workflow runs (GitHub `action_required`) — not a problem with the submission itself.

Screenshots are optional: put a `screenshots.json` next to the plugin's `package.json` listing 1–8 image paths; the market detail page shows them, otherwise it extracts from the README.

### Listing history for this project

- 2026-10-07: forked `lw0129a/awesome-dsh-plugin`, branch `add-dsh-app-packager`, opened PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) with just that one entry file. **Do not delete the fork before it merges** — deleting it closes the PR.
- 2026-10-07 (later): PR [#6750](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6750) is still **OPEN** (not merged); the entry carries **no version number**, so later releases need no entry change. Its description was refreshed to the 0.6.0 abilities (HBuilderX version-aware SDK one-click setup with official download links); the new fork commit `94f01a2` is in the PR.
- 2026-10-08: **0.2.0** adds the web GUI panel
so the registry still serves 0.2.0.
 (host half `web.js` with six same-origin routes, browser half `client.js`) and ships the bilingual documentation and repository conventions.
- 2026-10-07 (cont. 3): the **publish** half of ④ is nailed down too: `publish.yml`'s earlier failure was not a workflow mistake — npm exchanges the OIDC token *before* it looks at `dry_run`, swallows a failed exchange at verbose level and leaves only `ENEEDAUTH need auth` in the log. The publish step now sets `NPM_CONFIG_LOGLEVEL=verbose`, so the log also carries the registry's own words, `oidc Failed token exchange request with body message: …`; a dry run (`gh workflow run publish.yml -f dry_run=true`) goes through the same exchange, so "is the trusted publisher configured?" can be answered without publishing for real. Same round: the human-readable `sdk urls` / `sdk text` output no longer reports the HBuilderX version as unknown (engine script version `2026.10.10.4`, commit `0dd4b9d`).
- 2026-10-07 (cont. 2): the npm account is **no longer suspended**: `npm whoami` → `lw0129a`, `npm profile get` works, `npm stage list` returns `No staged packages found.` and `npm trust github …` runs all the way to `Two-factor authentication is required for this operation` — every probe stops only at that one browser 2FA approval (`https://www.npmjs.com/auth/cli/<id>`), with no 403 and no mention of the temporary suspension. `npm trust github app-packager --file publish.yml --repo lw0129a/dsh-app-packager --allow-publish` validated package/file/repository and reported `permissions: publish`. Approve once per package (or use the web form), then run `publish.yml` again to publish 0.6.1.
- 2026-10-07 (cont.): **0.6.1** prepared — it folds in the engine fixes that landed on `main` after 0.6.0: `sdk install` now decides success by whether the platform is really `ready` (it no longer prints `SDK 配置完成` when nothing was installed), a platform that is already `ready` is skipped with an `已就绪，跳过` line so *One-click setup* can be pressed repeatedly without re-downloading the 800 MB-class archive, and the SDK paths persisted in `config/settings.local.env` / `config/init.local.env` are written as `"$PIPELINE_ROOT/..."` so renaming the engine directory as a whole keeps the installed SDKs instead of reporting `missing`. GitHub release `v0.6.1` is out (both offline tgz assets); **npm 0.6.1 still waits for the account to be unsuspended and one trusted publisher per package**, after which running `publish.yml` publishes it. That same day found and fixed one more gap: **the engine copy in `home` never followed a plugin upgrade** — the host only materialized the engine when the home was entirely missing, so a 0.6.0 home kept running its old engine (which is exactly why the engine fixes above could not arrive). Materialization now runs on every call and no-ops while the version matches, and the panel shows `目录里是 X，需要刷新` instead of a blanket *Ready*. Because the assets had to carry that fix, `v0.6.1` and its two assets were cut again at `4c0cdd9` (`dsh-app-packager-0.6.1.tgz` 45318B sha256 `7175ad228c9151a212a13296d952ba6450d9b5409b37d12e15c0d680eeb8e49c`; `app-packager-0.6.1.tgz` unchanged at 144621B sha256 `dbe6450f4c3b64312a4ed91eaca492c42b79257cdb1c3e88b0f3682478d94ed2`); the local `desktop` profile was upgraded in place and its `home` engine refreshed to 0.6.1 (`copied 39`) with SDKs, certificates and projects untouched.
- 2026-10-07: **0.6.0** adds the engine's `sdk status|urls|install|process` subcommands and a panel card that reads the local HBuilderX version (`5.26.2026091802`, series `5.26`) to recommend and one-click configure the offline SDKs for all three platforms; the engine directory now defaults to `<plugin>/home` (an existing `~/AppPackager` is renamed in on first resolve and staged under `<profile>/node_modules/.app-packager-home-backup` during upgrades). GitHub release `v0.6.0` is out with both offline tgz assets; **npm 0.6.0 is not published yet** — the account was temporarily suspended after a recovery code was tried as an OTP (see the warning in section 2). The publish path is now GitHub Actions + trusted publishing (`.github/workflows/publish.yml`, see section 1): once the account is restored and the trusted publisher is configured on npmjs.com, running that workflow publishes 0.6.0. **First real CI run the same day**: the workflow itself was green (npm 11.19.0) and only the publish step failed with `npm error code ENEEDAUTH` (`need auth … requires you to be logged in`) — the workflow carries no token and the registry saw no OIDC exchange, i.e. neither package has a trusted publisher configured yet. Once the account is unsuspended and the trusted publishers are set up on npmjs.com, re-run the workflow (or push the `v0.6.0` tag again) to publish.
- 2026-10-07: both packages were first published **under scoped names** (`@lw0129a/app-packager`, `@lw0129a/dsh-app-packager`) via staged publishing, approved on npmjs.com (0.1.0). They were then **renamed without a scope** to `app-packager` / `dsh-app-packager` (`@lw0129a/` no longer appears in any command) and republished at 0.1.0 the same way. The old `@lw0129a/*` names are deprecated leftovers on the registry; they can be unpublished from a browser-authenticated session or deprecated in favour of the new names.
- 2026-10-07: the local `desktop` profile switched back from "local tarball + `pnpm-workspace.yaml` override" to a registry install, and a fresh temporary profile verified that `dsh plugin --profile <name> add dsh-app-packager` needs no override (`--dump-config` shows the `- id: app-packager` layer).
0.6.0/0.6.1 have been the exception: the registry still only had 0.2.0, so the `desktop` profile has been installed from `file:…/.app-packager-local/dsh-app-packager-0.6.1.tgz` with a `file:` override for `app-packager` in `pnpm-workspace.yaml`; once 0.6.1 is on the registry this should go back to `dsh plugin --profile desktop add dsh-app-packager` and the override line dropped. Note also that the `dsh` CLI refuses to touch the `desktop` profile (`error: profile "desktop" is managed exclusively by the Electron application`); to review the composed config you have to copy the profile (its `package.json`/`cordis.yml`/`cordis.patch.yml`/`pnpm-workspace.yaml`/`pnpm-lock.yaml`, with `node_modules` symlinked back) and run `DSH_HOME=<tmp> dsh --profile <copy> --dump-config`.
- The only red at the time was the repository age (created `2026-10-07T02:50:28Z`, so the 24-hour bar is `2026-10-08T02:50Z`), which clears itself per item 3.
- The market fetches the catalogue when it opens, so after listing just reopen the plugin market; both packages are on npm, so downloads and the one-click install command appear automatically.

## 4. How users install it

Both paths belong in the README:

```bash
# 1) plugin market UI: search AppPackager and install

# 2) command line: add the package to a profile
dsh plugin --profile <profile> add dsh-app-packager
```

`dsh plugin` forwards its arguments to that profile's pnpm (`dsh plugin --profile <name> <pnpm-args...>`), so `add` with a local tarball, `remove` and `update` all work.

The profile must be restarted before the four tools are mounted.

## 5. Versions and repository hygiene

- Both packages share a version number and move together: when the CLI changes the engine or its behaviour, the plugin usually ships a release too (it depends on the CLI with a caret range; raise the floor when needed).
- The repo uses `pnpm -r` and pins pnpm via the `packageManager` field; CI takes the version from there, so bump `package.json` and the lockfile together.
- Open-sourcing notes: `engine/` only contains the original scripts and placeholder directories; private content under `sdk/` and `certificates/`, `*.local.env` and `config/projects/*.env` are all excluded by `.gitignore`. Do not commit them "for completeness".
