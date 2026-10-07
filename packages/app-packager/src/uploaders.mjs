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

      return {
        id,
        name,
        enabled,
        available: reason === '',
        platforms: platforms.length > 0 ? platforms : [...ARTIFACT_PLATFORMS],
        script,
        reason,
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
