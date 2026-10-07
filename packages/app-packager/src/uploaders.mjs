/**
 * Read the engine's upload registry (config/upload.env + upload.local.env) the
 * way lib/upload.sh does, but without a shell — the GUI panel needs to know
 * which uploaders exist and which ones the user has actually enabled, and on
 * Windows there is no bash to ask.
 *
 * Mirrors upload_platform_enabled() / upload_platform_available() /
 * upload_platform_supports_artifact() in engine/lib/upload.sh.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvFile } from './projects.mjs';

/** Artifact platforms an uploader can be offered for. */
export const ARTIFACT_PLATFORMS = ['ios', 'android', 'harmony'];

function splitList(value) {
  return String(value || '')
    .split(/[\s,;，；]+/)
    .filter(Boolean);
}

function uploaderVars(home) {
  const vars = { PIPELINE_ROOT: home, HOME: os.homedir(), USER: os.userInfo().username };
  const merged = {};
  for (const name of ['upload.env', 'upload.local.env']) {
    const file = path.join(home, 'config', name);
    if (!fs.existsSync(file)) continue;
    Object.assign(merged, parseEnvFile(file, vars));
  }
  return merged;
}

/** `engine/lib/upload.sh:29` treats a missing ENABLED as true and only accepts a literal "true". */
function uploaderEnabled(config, id) {
  const value = config[`UPLOAD_PLATFORM_${id}_ENABLED`];
  return value === undefined ? true : String(value).trim() === 'true';
}

/** The provider function must actually be declared in the provider script (declare -F in the engine). */
function declaresFunction(text, name) {
  if (!name) return false;
  return new RegExp(`(^|\\n)\\s*(function\\s+)?${name}\\s*\\(\\s*\\)`).test(text);
}

/**
 * Every uploader declared in `UPLOAD_PLATFORM_IDS`, with the facts the panel
 * needs to decide whether its checkbox can be ticked:
 *
 * - `available` — enabled, provider script present, provider function declared
 *   (exactly what `set_upload_platforms` filters on);
 * - `platforms` — artifact platforms it accepts, so the panel can grey it out
 *   when the selected build platforms do not intersect;
 * - `reason` — why it is not available, for the hint text.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {Array<{id: string, name: string, enabled: boolean, available: boolean,
 *   platforms: string[], script: string, reason: ''|'disabled'|'script'|'function'}>}
 */
export function listUploaders(home) {
  const config = uploaderVars(home);
  const ids = splitList(config.UPLOAD_PLATFORM_IDS || 'pgyer');
  return ids
    .filter((id) => /^[A-Za-z0-9_]+$/.test(id))
    .map((id) => {
      const enabled = uploaderEnabled(config, id);
      const name = config[`UPLOAD_PLATFORM_${id}_NAME`] || id;
      const platforms = splitList(config[`UPLOAD_PLATFORM_${id}_PLATFORMS`]);
      const declared = config[`UPLOAD_PLATFORM_${id}_SCRIPT`] || `lib/uploaders/${id}.sh`;
      const script = path.isAbsolute(declared) ? declared : path.join(home, declared);
      const func = config[`UPLOAD_PLATFORM_${id}_FUNCTION`] || '';

      let reason = '';
      if (!enabled) reason = 'disabled';
      else if (!fs.existsSync(script)) reason = 'script';
      else {
        let text = '';
        try {
          text = fs.readFileSync(script, 'utf8');
        } catch {
          reason = 'script';
        }
        if (!reason && !declaresFunction(text, func)) reason = 'function';
      }

      // Uploaders that need a secret declare the variable to write it to; the
      // panel renders a credential row for those and only ever learns whether
      // one is configured — never the value itself.
      const apiKeyVar = config[`UPLOAD_PLATFORM_${id}_API_KEY_VAR`] || '';
      // A second, optional secret: pgyer's User Key (`uKey`) only matters for the
      // legacy API 1.0 upload endpoint, but the user may want it stored here.
      const userKeyVar = config[`UPLOAD_PLATFORM_${id}_USER_KEY_VAR`] || '';

      return {
        id,
        name,
        enabled,
        available: reason === '',
        platforms: platforms.length > 0 ? platforms : [...ARTIFACT_PLATFORMS],
        script,
        reason,
        apiKeyVar,
        credentialConfigured: Boolean(apiKeyVar && String(config[apiKeyVar] || '').trim()),
        userKeyVar,
        userKeyConfigured: Boolean(userKeyVar && String(config[userKeyVar] || '').trim()),
      };
    });
}

/** Uploader ids that may be posted to the engine for the given artifact platforms. */
export function selectableUploaders(home, platforms = ARTIFACT_PLATFORMS) {
  const wanted = new Set(splitList(Array.isArray(platforms) ? platforms.join(' ') : platforms));
  return listUploaders(home).filter(
    (uploader) => uploader.available && uploader.platforms.some((platform) => wanted.has(platform)),
  );
}

/**
 * Where the official pgyer CLI is installed: inside the engine home, so it
 * travels with the plugin instead of polluting the user's global npm prefix.
 * Mirrors `pgyer_cli_dir()` in engine/lib/uploaders/pgyer.sh.
 */
export function pgyerCliDir(home) {
  return process.env.PGYER_CLI_DIR || path.join(home, 'tools', 'pgyer-cli');
}

/**
 * Is the pgyer CLI already installed, and which version? Read from the install
 * rather than from upload.env, and report the version the lockfile actually
 * resolved — the engine installs it lazily on the first pgyer upload.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {{package: string, version: string, dir: string, bin: string, installed: boolean}}
 */
export function pgyerCliStatus(home) {
  const dir = pgyerCliDir(home);
  const bin = path.join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'pgyer.cmd' : 'pgyer');
  let packageName = '';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    packageName = Object.keys(manifest.dependencies || {})[0] || '';
  } catch {
    /* not installed yet */
  }
  let version = '';
  if (packageName) {
    try {
      version = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', packageName, 'package.json'), 'utf8')).version || '';
    } catch {
      version = '';
    }
  }
  return { package: packageName || '@pgyer/cli', version, dir, bin, installed: fs.existsSync(bin) };
}

/**
 * The installers the engine has already archived, newest first — one entry per
 * `<home>/packages/<platform>/<project>-latest.json`, the same file
 * `upload_latest_artifact()` resolves. The panel uploads these without
 * rebuilding, so it has to show what is actually on disk, including a project
 * whose installer was pruned away (`artifactExists: false`).
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @returns {Array<{platform: string, projectId: string, displayName: string, version: string,
 *   builtAt: string, artifactPath: string, artifactExists: boolean, artifactSize: number,
 *   infoFile: string}>}
 */
export function listArtifacts(home) {
  /** Folder name per platform — the folder, not the JSON, says which platform it is. */
  const folders = [['ios', 'iOS'], ['android', 'Android'], ['harmony', 'HarmonyOS']];
  const out = [];
  for (const [platform, folder] of folders) {
    const dir = path.join(home, 'packages', folder);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // that platform was never built here
    }
    for (const name of names) {
      if (!name.endsWith('-latest.json')) continue;
      const infoFile = path.join(dir, name);
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      } catch {
        continue; // half-written or hand-edited: not worth a row
      }
      const projectId = String(info.project_id || name.replace(/-latest\.json$/, ''));
      const artifactPath = String(info.ipa_path || info.apk_path || info.hap_path || '');
      let artifactSize = 0;
      try {
        artifactSize = fs.statSync(artifactPath).size;
      } catch {
        artifactSize = 0;
      }
      out.push({
        platform,
        projectId,
        displayName: String(info.display_name || projectId),
        version: String(info.version || ''),
        builtAt: String(info.built_at || ''),
        artifactPath,
        artifactExists: artifactSize > 0,
        artifactSize,
        infoFile,
      });
    }
  }
  return out.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

/**
 * Write one uploader credential into `<home>/config/upload.local.env`, the file
 * the engine sources after `upload.env`. Everything else in the file is kept;
 * an empty value removes the entry. The file is user-owned (it is in the home
 * .gitignore) and gets mode 600: it holds an API key.
 *
 * @param {string} home engine home (PIPELINE_ROOT)
 * @param {string} name variable name, e.g. PGYER_API_KEY
 * @param {string} value secret value; '' clears it
 * @returns {{file: string, name: string, configured: boolean}}
 */
export function writeUploaderCredential(home, name, value) {
  const key = String(name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`非法配置项: ${name}`);
  const dir = path.join(home, 'config');
  const file = path.join(dir, 'upload.local.env');
  fs.mkdirSync(dir, { recursive: true });
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    lines = [];
  }

  const trimmed = String(value ?? '').trim();
  const entry = trimmed === '' ? '' : `${key}='${trimmed.replace(/'/g, `'\\''`)}'`;
  const pattern = new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (pattern.test(line)) {
      if (!replaced) {
        replaced = true;
        if (entry) out.push(entry);
      }
      continue;
    }
    out.push(line);
  }
  if (!replaced && entry) out.push(entry);

  let text = out.join('\n').replace(/\n+$/, '');
  if (!text.startsWith('# 由面板写入')) {
    text = `# 由面板写入的本机上传配置（config/*.local.env 不进 Git）\n${text}`;
  }
  fs.writeFileSync(file, `${text.replace(/\n+$/, '')}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort (Windows, foreign filesystems) */
  }
  return { file, name: key, configured: trimmed !== '' };
}
