/**
 * Read config/projects/*.env the same way the bash engine does, but without a
 * shell: this keeps `app-packager list` (and the DSH tool behind it) working on
 * Windows, where no bash engine is available yet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

const ANSI_C_ESCAPES = { n: 0x0a, t: 0x09, r: 0x0d, a: 0x07, b: 0x08, f: 0x0c, v: 0x0b, e: 0x1b, '\\': 0x5c, "'": 0x27, '"': 0x22, '?': 0x3f, $: 0x24 };

/**
 * Decode an ANSI-C (`$'...'`) escape body, which is how `printf '%q'` writes
 * every value the engine is unsure about — including any name with non-ASCII
 * characters. The body is BYTE oriented (each input character is one byte), so
 * callers hand it `latin1` text; `\346\274\224` is then three bytes of one
 * UTF-8 character and the result decodes back to 演.
 */
function decodeAnsiC(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\') {
      bytes.push(text.charCodeAt(index) & 0xff);
      continue;
    }
    const rest = text.slice(index + 1);
    const octal = /^[0-7]{1,3}/.exec(rest);
    const hex = /^x([0-9a-fA-F]{1,2})/.exec(rest);
    const unicode = /^u([0-9a-fA-F]{1,4})/.exec(rest);
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      index += octal[0].length;
    } else if (hex) {
      bytes.push(parseInt(hex[1], 16));
      index += hex[0].length;
    } else if (unicode) {
      bytes.push(...Buffer.from(String.fromCharCode(parseInt(unicode[1], 16)), 'utf8'));
      index += unicode[0].length;
    } else if (Object.hasOwn(ANSI_C_ESCAPES, rest[0])) {
      bytes.push(ANSI_C_ESCAPES[rest[0]]);
      index += 1;
    } else {
      bytes.push(0x5c);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

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
    if (value.startsWith("$'") && value.endsWith("'") && value.length > 3) {
      value = decodeAnsiC(Buffer.from(value.slice(2, -1), 'utf8').toString('latin1'));
    } else if (
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
  const bytes = fs.readFileSync(file);
  const utf8 = bytes.toString('utf8');
  if (!utf8.includes('\uFFFD')) return parseEnvText(utf8, vars);

  // macOS bash 3.2 `printf '%q'` can leave a partial UTF-8 sequence raw inside a
  // `$'...'` value, so the UTF-8 read above would destroy it. Re-read byte-wise
  // (latin1) and decode those regions per byte, converting the rest back to UTF-8.
  const text = bytes
    .toString('latin1')
    .split(/(\$'(?:[^'\\]|\\.)*')/)
    .map((part) => (part.startsWith("$'") ? decodeAnsiC(part.slice(2, -1)) : Buffer.from(part, 'latin1').toString('utf8')))
    .join('');
  return parseEnvText(text, vars);
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
