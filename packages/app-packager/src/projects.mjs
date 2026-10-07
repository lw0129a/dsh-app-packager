/**
 * Read config/projects/*.env the same way the bash engine does, but without a
 * shell: this keeps `app-packager list` (and the DSH tool behind it) working on
 * Windows, where no bash engine is available yet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function expand(value, vars) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const key = braced || bare;
    return Object.hasOwn(vars, key) ? vars[key] : match;
  });
}

/** Parse a bash-style KEY=value file. Values quoted by the engine's `%q` survive. */
export function parseEnvText(text, vars = {}) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\\ /g, ' ');
    }
    value = expand(value, vars);
    out[match[1]] = value;
    vars[match[1]] = value;
  }
  return out;
}

export function parseEnvFile(file, vars = {}) {
  return parseEnvText(fs.readFileSync(file, 'utf8'), vars);
}

/** Engine defaults (lib/common.sh:417, lib/runner.sh:127-151): iOS/HarmonyOS on, Android off. */
function enabled(value, fallback) {
  return value === undefined ? fallback : !/^(false|0|no|off)$/i.test(String(value).trim());
}

export function projectsDir(home) {
  return path.join(home, 'config', 'projects');
}

/** Every configured project, with the local facts a caller needs to act. */
export function listProjects(home) {
  const dir = projectsDir(home);
  if (!fs.existsSync(dir)) return [];
  const vars = { PIPELINE_ROOT: home, HOME: os.homedir(), USER: os.userInfo().username };

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.env') && !name.endsWith('.example'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      let config = {};
      let error = null;
      try {
        config = parseEnvFile(file, vars);
      } catch (cause) {
        error = cause.message;
      }
      const sourceDir = config.SOURCE_DIR || '';
      const platforms = {
        ios: enabled(config.IOS_ENABLED, true),
        android: enabled(config.ANDROID_ENABLED, false),
        harmony: enabled(config.HARMONY_ENABLED, true),
      };
      return {
        id: config.PROJECT_ID || name.replace(/\.env$/, ''),
        file,
        sourceDir,
        sourceDirExists: Boolean(sourceDir) && fs.existsSync(sourceDir),
        appName: config.APP_NAME || '',
        bundleId: config.EXPECTED_BUNDLE_ID || '',
        teamId: config.EXPECTED_TEAM_ID || '',
        profileFile: config.PROFILE_FILE || '',
        platforms,
        enabledPlatforms: Object.keys(platforms).filter((key) => platforms[key]),
        error,
      };
    });
}

export function findProject(home, id) {
  return listProjects(home).find((project) => project.id === id) || null;
}

/** Platform tokens accepted by the engine CLI. */
export const PLATFORMS = ['ios', 'android', 'harmony', 'all'];
