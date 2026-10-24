/**
 * `projects.ts` is a port, so the assertions pin the bash engine's behaviour:
 * the quoting it writes, the fields it refuses to build without, and one build
 * per project.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PACKAGE_ENV_OVERRIDE_KEYS,
  acquireBuildLock,
  discoverUniAppProjects,
  initRun,
  loadProject,
  parseEnvFile,
  projectSearchRoots,
  setPackageOverride,
} from '../dist/engine/projects.js';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ap-projects-'));

interface Home {
  home: string;
  source: string;
}

/** A pipeline home with one registered project whose manifest carries the appid. */
const makeHome = (options: { appId?: string; profileFile?: boolean } = {}): Home => {
  const home = fixture();
  const source = path.join(home, 'sources', '安居一');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'manifest.json'),
    `{\n\t"name": "安居一",\n\t"appid": "${options.appId ?? '__UNI__ABC123'}"\n}\n`,
  );
  fs.writeFileSync(path.join(source, 'pages.json'), '{}\n');
  fs.mkdirSync(path.join(home, 'config', 'projects'), { recursive: true });
  const profile = path.join(home, 'signing', 'current', 'anju.mobileprovision');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  if (options.profileFile !== false) fs.writeFileSync(profile, 'profile');
  fs.writeFileSync(
    path.join(home, 'config', 'projects', 'anju.env'),
    [
      "PROJECT_ID='anju'",
      `SOURCE_DIR='${source}'`,
      'APP_NAME=安居一',
      'IOS_ENABLED=true',
      `PROFILE_FILE='${profile}'`,
    ].join('\n') + '\n',
  );
  return { home, source };
};

const loadOptions = (home: string) => ({
  pipelineRoot: home,
  workRoot: path.join(home, 'work'),
  logRoot: path.join(home, 'logs'),
});

test('setPackageOverride accepts allow-listed keys and appends', () => {
  assert.equal(setPackageOverride('APP_NAME=新名字', 'X=1\n'), 'X=1\nAPP_NAME=新名字\n');
  assert.ok(PACKAGE_ENV_OVERRIDE_KEYS.includes('MARKETING_VERSION'));
});

test('setPackageOverride dies on the shapes bash rejects', () => {
  const dieOf = (pair: string) => {
    try {
      setPackageOverride(pair);
    } catch (error) {
      return (error as Error).message;
    }
    return 'no throw';
  };
  assert.match(dieOf('APP_NAME'), /需要 KEY=VALUE/);
  assert.match(dieOf('1BAD=x'), /键名不合法/);
  assert.match(dieOf('PATH_KEY=x'), /不支持的键/);
  assert.match(dieOf('APP_NAME=a\nb'), /不能包含换行/);
});

test('parseEnvFile reads the quoting bash writes', () => {
  const dir = fixture();
  const file = path.join(dir, 'p.env');
  fs.writeFileSync(
    file,
    [
      '# 注释',
      "PROJECT_ID='anju'",
      'SOURCE_DIR="/Users/lw/my dir"',
      'APP_NAME=安居一  # 尾部注释',
      'EMPTY=',
      'export NOPE=1',
      'BAD LINE',
    ].join('\n'),
  );
  assert.deepEqual(parseEnvFile(file), {
    PROJECT_ID: 'anju',
    SOURCE_DIR: '/Users/lw/my dir',
    APP_NAME: '安居一',
    EMPTY: '',
  });
  assert.deepEqual(parseEnvFile(path.join(dir, 'missing.env')), {});
});

test('projectSearchRoots splits PROJECT_SEARCH_ROOTS, else the pipeline parent', () => {
  assert.deepEqual(projectSearchRoots({ PROJECT_SEARCH_ROOTS: '/a:/b' }, '/home'), ['/a', '/b']);
  assert.deepEqual(projectSearchRoots({}, '/Users/lw/dev/app'), ['/Users/lw/dev']);
});

test('discoverUniAppProjects looks one level deep and skips noise', () => {
  const root = fixture();
  for (const name of ['good', 'node_modules', '.hidden', '_draft']) fs.mkdirSync(path.join(root, name));
  for (const name of ['good', 'node_modules', '.hidden', '_draft']) {
    fs.writeFileSync(path.join(root, name, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(root, name, 'pages.json'), '{}');
  }
  assert.deepEqual(
    discoverUniAppProjects([root]).map((dir) => path.basename(dir)),
    ['good'],
  );
  assert.deepEqual(discoverUniAppProjects([path.join(root, 'missing')]), []);
});

test('loadProject overlays the manifest, derives the run paths and applies --set', () => {
  const { home } = makeHome();
  const context = loadProject('anju', {
    ...loadOptions(home),
    buildPlatform: 'ios',
    overrides: { APP_NAME: '改名了' },
  });
  assert.equal(context.displayName, '安居一');
  assert.equal(context.appId, '__UNI__ABC123');
  assert.equal(context.vars.APP_NAME, '改名了');
  assert.equal(context.workspace, path.join(home, 'work', 'anju', 'anju-build-ios'));
  assert.match(context.runId, /^\d{8}-\d{6}-ios-\d+$/);
  assert.equal(context.logFile, path.join(home, 'logs', 'anju', context.runId, 'build.log'));
  assert.equal(context.vars.CHANNEL, 'adhoc');
});

/** Runs a snippet in a child process; engine failures surface as `ERROR <message>` + code 1. */
const runScript = (body: string) => {
  try {
    execFileSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(path.join(import.meta.dirname, '..', 'dist', 'engine', 'projects.js'))}).then((m) => { ${body} }).catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; })`],
      { stdio: 'pipe', encoding: 'utf8' },
    );
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? 1, stderr: failure.stderr ?? '' };
  }
};

test('loadProject rejects an unknown project and a project without appid', () => {
  const { home } = makeHome({ appId: '' });
  const unknown = runScript(`m.loadProject('nope', { pipelineRoot: ${JSON.stringify(home)}, workRoot: '/tmp/w', logRoot: '/tmp/l' });`);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /未知项目: nope/);
  const noAppId = runScript(`m.loadProject('anju', { pipelineRoot: ${JSON.stringify(home)}, workRoot: '/tmp/w', logRoot: '/tmp/l' });`);
  assert.equal(noAppId.code, 1);
  assert.match(noAppId.stderr, /manifest\.json 缺少 appid/);
});

test('loadProject refuses a --profile that does not exist', () => {
  const { home } = makeHome();
  assert.throws(
    () => loadProject('anju', { ...loadOptions(home), profileFile: path.join(home, 'nope.mobileprovision') }),
    /指定的描述文件不存在/,
  );
});

test('initRun creates the run tree and a private temp dir', () => {
  const { home } = makeHome();
  const context = loadProject('anju', loadOptions(home));
  const packages = ['iOS', 'Android'].map((name) => path.join(home, 'packages', name));
  const tmpDir = initRun(context, home, packages);
  assert.ok(fs.statSync(context.runDir).isDirectory());
  for (const dir of packages) assert.ok(fs.statSync(dir).isDirectory());
  assert.ok(fs.statSync(path.dirname(context.workspace)).isDirectory());
  assert.ok(fs.statSync(tmpDir).isDirectory());
  assert.equal(path.dirname(tmpDir), path.join(home, '.tmp'));
});

test('acquireBuildLock blocks a live owner and takes over a stale one', () => {
  const { home } = makeHome();
  const lock = acquireBuildLock(home, 'anju');
  assert.equal(fs.readFileSync(path.join(lock.dir, 'pid'), 'utf8').trim(), String(process.pid));
  const blocked = runScript(`m.acquireBuildLock(${JSON.stringify(home)}, 'anju');`);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /正在打包中/);
  lock.release();
  assert.equal(fs.existsSync(lock.dir), false);

  // A pid that is certainly not running counts as stale and is replaced.
  fs.mkdirSync(lock.dir, { recursive: true });
  fs.writeFileSync(path.join(lock.dir, 'pid'), '999999999\n');
  const taken = acquireBuildLock(home, 'anju');
  assert.equal(fs.readFileSync(path.join(taken.dir, 'pid'), 'utf8').trim(), String(process.pid));
  taken.release();
});
