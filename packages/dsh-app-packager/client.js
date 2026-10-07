/**
 * AppPackager panel — browser half of the DeepSeek Harness bundle.
 *
 * A plain ModuleLoader bundle (no build step), matching how the host loads
 * plugin client halves: `react` comes from `require`, everything else from the
 * `slots` and `locale` services the bundle injects. It contributes a row to the
 * sidebar's own panel list (`sidebar.panellist`) and its page to the keyed
 * `main` slot, so the shell owns the row box, active highlight and panel switch.
 *
 * All data comes from the host half's same-origin routes under
 * `/api/app-packager`; no engine call happens in the browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-app-packager',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;
    const { useCallback, useEffect, useRef, useState } = react;

    const name = 'dsh-app-packager';
    const inject = ['slots', 'locale'];
    const NS = 'app-packager';
    const PANEL_ID = 'app-packager';
    const PANEL_ORDER = 60;
    const ROUTE = 'api/app-packager';
    const PLATFORMS = ['all', 'ios', 'android', 'harmony'];
    const NOTICE_LINES = 20;

    const zh = {
      'entry.label': '应用打包',
      title: 'AppPackager',
      subtitle: 'uni-app x 打包流水线',
      refresh: '刷新',
      init: '初始化引擎',
      engine: '引擎',
      'engine.home': '引擎目录',
      'engine.version': '引擎版本',
      'engine.ready': '已就绪',
      'engine.missing': '未物化',
      'engine.stale': '目录里是 {home}，需要刷新（点「初始化引擎」或任意操作即可）',
      'engine.status': '引擎状态',
      'engine.shell': 'Shell 桥接',
      'engine.shell.none': '不可用',
      'engine.location': '引擎位置',
      'engine.location.plugin': 'DSH 插件目录内（升级插件时 SDK、证书与项目配置都会保留）',
      'engine.location.other': '不在 DSH 插件目录内',
      sdk: 'SDK 与一键配置',
      'sdk.hint': '按本机 HBuilderX 的版本号推荐同系列 SDK：iOS/Android 从 DCloud 官方直链下载后自动解压归位，HarmonyOS 用 DevEco 的 ohpm 安装 runtime。',
      'sdk.hbuilderx': 'HBuilderX',
      'sdk.hbuilderx.none': '未找到 HBuilderX（/Applications/HBuilderX.app）：装好后再回来，引擎才能判断该下载哪个系列的 SDK。',
      'sdk.series': 'SDK 系列',
      'sdk.root': '下载目录',
      'sdk.ready': '已就绪',
      'sdk.missing': '未安装',
      'sdk.mismatch': '版本不匹配，建议 {series}',
      'sdk.dir': '目录',
      'sdk.page': '官方下载页',
      'sdk.direct': '官方直链',
      'sdk.install': '一键配置',
      'sdk.installAll': '一键配置全部',
      'sdk.process': '处理已下载的 SDK',
      'sdk.archives': 'sdk/ 里已有 {n} 个压缩包，可点「处理已下载的 SDK」解压归位。',
      'sdk.incomplete': '有 {n} 个未完成的下载（.part），删掉后可以重试。',
      'sdk.manual': '自动下载不可用时，可从官方下载页手动下载，放进 sdk/ 再点「处理已下载的 SDK」。',
      'upgrade': '插件升级',
      'upgrade.hint': '升级会先把引擎目录（SDK、证书、项目配置）暂存到插件旁边，装完立即移回，不会丢；升级完成后重启 DeepSeek Harness 生效。',
      'upgrade.run': '升级插件',
      'upgrade.unavailable': '这段代码不在 DSH 插件目录里，无法从面板升级：请在终端执行 dsh plugin --profile <profile> add dsh-app-packager@latest。',
      doctor: '环境检查（Node）',
      'doctor.run': '开始检查',
      'doctor.ok': '结论：当前环境可以打包。',
      'doctor.bad': '结论：{failures} 项失败、{warnings} 项警告。',
      projects: '项目',
      'projects.empty': '未发现项目配置 config/projects/*.env。用下面的「选择目录…」指定一个 uni-app x 项目目录，或把它放进引擎同级目录。',
      'projects.dir': '项目目录',
      'projects.dirHint': 'uni-app x 项目目录，或它的父目录',
      'projects.pick': '选择目录…',
      'projects.add': '添加项目',
      'projects.pickManual': '当前系统没有可用的目录选择器，请手动输入路径。',
      'projects.sourceMissing': '（未配置源码目录）',
      'projects.sourceGone': '源码目录不存在',
      'projects.dirMulti': '可以一次选多个目录，每行一个；添加后逐个登记。',
      'projects.remove': '删除',
      'projects.remove.confirm': '确认删除',
      'projects.remove.cancel': '取消',
      'projects.remove.hint': '只移除登记（引擎目录里的 config/projects/<id>.env），不动项目源码。',
      'projects.multi': '一次可选择多个目录。',
      platforms: '平台',
      check: '环境检查',
      build: '打包',
      options: '打包选项',
      'options.version': '版本号',
      'options.upload': '上传',
      'options.uploaders.none': '没有可用的上传平台：在 config/upload.env 里把对应平台的 ENABLED 设为 true（本地覆盖写 config/upload.local.env）。',
      'options.uploader.disabled': '未启用',
      'options.uploader.unimplemented': '引擎里还没有实现',
      'options.uploader.platforms': '支持 {platforms}',
      'options.harmonyDebug': 'HarmonyOS debug 包',
      'options.keepWork': '保留构建目录',
      'options.harmonyDebug.hint': '生成可侧载的 debug HAP（签名用调试证书），发布包不要勾。',
      'options.keepWork.hint': '保留中间构建目录，构建失败时用来查日志；会让磁盘占用变大。',
      'options.fullPermission': '全量权限',
      'options.fullPermission.hint': '合入全量 Android 权限与 iOS 隐私说明，并在 App 首次启动时申请；不勾则用项目自带的权限清单。',
      'options.kind': 'iOS 包型',
      'options.kind.auto': '跟随签名',
      'options.kind.adhoc': '测试包 Ad Hoc',
      'options.kind.appstore': '正式包 App Store',
      'options.kind.development': '开发包 development',
      'options.kind.enterprise': '企业包 enterprise',
      'options.kind.hint': '正式/测试由 iOS 描述文件类型决定；没有该类型的描述文件时这个选项不可选。',
      'options.kind.missing': '没有 {kind} 类型的描述文件',
      'options.profile': '描述文件',
      'options.profile.auto': '自动（按包型或项目接线）',
      'options.profile.expired': '已过期',
      'options.profiles.none': '签名目录里没有描述文件：把 .mobileprovision 放进 signing/current/，或放到 certificates/iOS/。',
      'options.overrides': '自定义配置项',
      'options.overrides.hint': '每行一个 KEY=VALUE，覆盖打包参数，如 MARKETING_VERSION=1.2.3、APP_NAME=我的应用、EXPORT_METHOD=release-testing；留空表示不改。',
      'options.overrides.preset': '载入项目预设…',
      'options.overrides.presets.none': '该项目没有预设 env 文件。',
      'options.overrides.invalid': '第 {n} 行不是 KEY=VALUE',
      advanced: '高级选项',
      scope: '打包范围',
      'scope.platforms': '平台',
      'scope.projects': '项目',
      'scope.all': '全选',
      'scope.hint': '不勾项目 = 该平台所有项目；平台与项目会组合成多次引擎调用。',
      'scope.nonePicked': '请至少勾选一个平台。',
      job: '任务',
      'job.none': '暂无任务。',
      'job.running': '运行中',
      'job.ok': '成功',
      'job.failed': '失败',
      'job.stopped': '已停止',
      'job.stop': '停止',
      'job.exit': '退出码 {code}',
      'job.kind.check': '环境检查',
      'job.kind.build': '打包',
      'job.kind.sdk': 'SDK 配置',
      'job.kind.upgrade': '插件升级',
      'job.dropped': '（日志过长，已省略前 {n} 字符）',
      'job.waiting': '等待输出…',
      'job.problems': '发现 {errors} 项错误、{warnings} 项警告：',
      'job.warnOnly': '发现 {warnings} 项警告：',
      'job.more': '…另有 {n} 行，完整内容见下方日志',
      'job.blockedByCheck': '打包前环境检查未通过，已停止打包。请先按上面的 [FAIL] 提示处理，再点「打包」。',
      error: '出错了',
      loading: '加载中…',
      'platform.all': '全部',
    };
    const en = {
      'entry.label': 'App packaging',
      title: 'AppPackager',
      subtitle: 'uni-app x packaging pipeline',
      refresh: 'Refresh',
      init: 'Init engine',
      engine: 'Engine',
      'engine.home': 'Engine directory',
      'engine.version': 'Engine version',
      'engine.ready': 'Ready',
      'engine.missing': 'Not materialized',
      'engine.stale': 'the directory holds {home} — needs a refresh (init engine, or any action)',
      'engine.status': 'Engine status',
      'engine.shell': 'Shell bridge',
      'engine.shell.none': 'unavailable',
      'engine.location': 'Engine location',
      'engine.location.plugin': 'inside the DSH plugin directory (SDKs, certificates and project configs survive a plugin upgrade)',
      'engine.location.other': 'not inside a DSH plugin directory',
      sdk: 'SDKs and one-click setup',
      'sdk.hint': 'The SDK series follows the local HBuilderX version: iOS/Android download from the official DCloud links and unpack themselves, HarmonyOS installs the runtime through DevEco’s ohpm.',
      'sdk.hbuilderx': 'HBuilderX',
      'sdk.hbuilderx.none': 'HBuilderX was not found (/Applications/HBuilderX.app). Install it and come back: the engine needs its version to know which SDK series to download.',
      'sdk.series': 'SDK series',
      'sdk.root': 'Download directory',
      'sdk.ready': 'Ready',
      'sdk.missing': 'Not installed',
      'sdk.mismatch': 'Wrong version, {series} expected',
      'sdk.dir': 'Directory',
      'sdk.page': 'Download page',
      'sdk.direct': 'Direct download',
      'sdk.install': 'Set up',
      'sdk.installAll': 'Set up all',
      'sdk.process': 'Process downloaded SDKs',
      'sdk.archives': '{n} archive(s) already in sdk/ — “Process downloaded SDKs” unpacks and files them.',
      'sdk.incomplete': '{n} unfinished download(s) (.part); delete them to retry.',
      'sdk.manual': 'When the automatic download is unavailable, download from the official page, drop the archive into sdk/ and press “Process downloaded SDKs”.',
      'upgrade': 'Plugin upgrade',
      'upgrade.hint': 'The upgrade parks the engine directory (SDKs, certificates, project configs) next to the plugin, installs, then moves it straight back, so nothing is lost. Restart DeepSeek Harness afterwards.',
      'upgrade.run': 'Upgrade plugin',
      'upgrade.unavailable': 'This code is not inside a DSH plugin directory, so the panel cannot upgrade it: run dsh plugin --profile <profile> add dsh-app-packager@latest.',
      doctor: 'Environment check (Node)',
      'doctor.run': 'Run check',
      'doctor.ok': 'This machine can build.',
      'doctor.bad': '{failures} failed, {warnings} warnings.',
      projects: 'Projects',
      'projects.empty': 'No project configs (config/projects/*.env) found. Use “Choose folder…” below to pick a uni-app x project, or put one next to the engine.',
      'projects.dir': 'Project directory',
      'projects.dirHint': 'uni-app x project folder, or its parent folder',
      'projects.pick': 'Choose folder…',
      'projects.add': 'Add project',
      'projects.pickManual': 'This system has no folder picker; type the path instead.',
      'projects.sourceMissing': '(no source directory)',
      'projects.sourceGone': 'source directory missing',
      'projects.dirMulti': 'Pick several folders at once, or put one path per line.',
      'projects.remove': 'Remove',
      'projects.remove.confirm': 'Confirm remove',
      'projects.remove.cancel': 'Cancel',
      'projects.remove.hint': 'Only the registration goes away (config/projects/<id>.env); the project sources are never touched.',
      'projects.multi': 'Several folders can be selected at once.',
      platforms: 'Platforms',
      check: 'Env check',
      build: 'Build',
      options: 'Build options',
      'options.version': 'Version',
      'options.upload': 'Upload',
      'options.uploaders.none': 'No upload target is available: set ENABLED=true for one in config/upload.env (override locally in config/upload.local.env).',
      'options.uploader.disabled': 'disabled',
      'options.uploader.unimplemented': 'not implemented in the engine yet',
      'options.uploader.platforms': 'for {platforms}',
      'options.harmonyDebug': 'HarmonyOS debug HAP',
      'options.keepWork': 'Keep work dir',
      'options.harmonyDebug.hint': 'Builds a debug-signed HAP you can sideload; do not tick it for a release.',
      'options.keepWork.hint': 'Keeps the intermediate build directory for inspecting a failed build; uses more disk.',
      'options.fullPermission': 'Full permissions',
      'options.fullPermission.hint': 'Merges the full Android permission list and iOS privacy strings, and asks for them on first launch; unticked uses the project’s own lists.',
      'options.kind': 'iOS release kind',
      'options.kind.auto': 'Follow signing',
      'options.kind.adhoc': 'Ad Hoc (test)',
      'options.kind.appstore': 'App Store (release)',
      'options.kind.development': 'development',
      'options.kind.enterprise': 'enterprise',
      'options.kind.hint': 'Test or release is decided by the iOS provisioning profile type; a kind without a profile cannot be picked.',
      'options.kind.missing': 'no {kind} profile found',
      'options.profile': 'Profile',
      'options.profile.auto': 'Auto (kind or project wiring)',
      'options.profile.expired': 'expired',
      'options.profiles.none': 'No provisioning profile in the signing directory: put one in signing/current/ or certificates/iOS/.',
      'options.overrides': 'Custom build parameters',
      'options.overrides.hint': 'One KEY=VALUE per line, overriding build parameters such as MARKETING_VERSION=1.2.3 or APP_NAME=MyApp; empty means unchanged.',
      'options.overrides.preset': 'Load project preset…',
      'options.overrides.presets.none': 'This project has no preset env file.',
      'options.overrides.invalid': 'line {n} is not KEY=VALUE',
      advanced: 'Advanced',
      scope: 'Build scope',
      'scope.platforms': 'Platforms',
      'scope.projects': 'Projects',
      'scope.all': 'All',
      'scope.hint': 'No project ticked = every project of that platform; platforms × projects become several engine runs.',
      'scope.nonePicked': 'Tick at least one platform.',
      job: 'Job',
      'job.none': 'No job yet.',
      'job.running': 'running',
      'job.ok': 'succeeded',
      'job.failed': 'failed',
      'job.stopped': 'stopped',
      'job.stop': 'Stop',
      'job.exit': 'exit code {code}',
      'job.kind.check': 'Environment check',
      'job.kind.build': 'Build',
      'job.kind.sdk': 'SDK setup',
      'job.kind.upgrade': 'Plugin upgrade',
      'job.blockedByCheck': 'The pre-build environment check failed, so the build did not start. Fix the [FAIL] items above, then press “Build” again.',
      'job.dropped': '(log truncated, {n} leading characters dropped)',
      'job.waiting': 'Waiting for output…',
      'job.problems': '{errors} error(s), {warnings} warning(s):',
      'job.warnOnly': '{warnings} warning(s):',
      'job.more': '…and {n} more lines; see the full log below',
      error: 'Something went wrong',
      loading: 'Loading…',
      'platform.all': 'All',
    };

    // Colours come from the host's theme tokens, each with the plain-grey fallback we
    // want when a token is missing (older shells, stripped-down profiles).
    const CSS = `
      .ap-root { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 28px; overflow-y: auto; height: 100%; box-sizing: border-box; color: var(--dsw-alias-label-primary, inherit); }
      .ap-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .ap-title { font-size: 16px; font-weight: 600; }
      .ap-muted { color: var(--dsw-alias-label-tertiary, inherit); opacity: .7; font-size: 12px; }
      .ap-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42)); background: transparent; color: inherit; cursor: pointer; }
      .ap-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14)); }
      .ap-btn:disabled { opacity: .45; cursor: default; }
      .ap-btn-primary { border-color: var(--dsw-alias-brand-primary, #4a8cff); color: var(--dsw-alias-brand-primary, #4a8cff); }
      .ap-input { font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); color: inherit; }
      .ap-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
    `;

    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('dsh-app-packager-styles') !== null) return;
      const tag = document.createElement('style');
      tag.id = 'dsh-app-packager-styles';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const styles = {
      head: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '16px', fontWeight: 600 },
      muted: { color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.7, fontSize: '12px' },
      group: { border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' },
      groupHead: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      groupTitle: { fontSize: '13px', fontWeight: 600 },
      row: { display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'baseline' },
      rowLabel: { color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.7, minWidth: '96px' },
      rowValue: { wordBreak: 'break-all', flex: 1 },
      actions: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      project: { borderTop: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.18))', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px' },
      projectName: { fontSize: '13px', fontWeight: 600 },
      check: { display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'baseline' },
      mark: { width: '12px', textAlign: 'center' },
      hint: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.7, marginLeft: '20px' },
      link: { fontSize: '12px', color: 'var(--dsw-alias-label-link, #4c8dff)', textDecoration: 'none' },
      badge: { fontSize: '11px', padding: '1px 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42))' },
      log: { margin: 0, padding: '8px 10px', maxHeight: '320px', overflow: 'auto', fontSize: '11.5px', lineHeight: 1.45, fontFamily: "var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09))', borderRadius: '6px' },
      error: { border: '1px solid var(--dsw-alias-state-error, rgba(255,96,96,.5))', color: 'var(--dsw-alias-state-error, #ff6b6b)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
      warn: { border: '1px solid var(--dsw-alias-state-warning, rgba(210,153,34,.5))', color: 'var(--dsw-alias-state-warning, #d29922)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
      problemTitle: { fontWeight: 600, marginBottom: '2px' },
      advanced: { fontSize: '12px' },
      scope: { border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.24))', borderRadius: '8px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))' },
    };

    /** Same-origin call into the host half; throws the host's error message. */
    async function call(path, options = {}) {
      const body = options.body;
      const response = await fetch(`${ROUTE}/${path}`, {
        method: options.method || 'GET',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
      return payload;
    }

    function mark(status) {
      return status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
    }

    /**
     * iOS release kinds, kept in step with the engine's `--package-kind`. The host
     * validates the value too, so a drift here fails loudly rather than silently.
     */
    const PACKAGE_KINDS = ['adhoc', 'appstore', 'development', 'enterprise'];

    /**
     * Project preset env files quote their values (`APP_NAME="MyApp"`) and carry
     * comments; `--set` wants bare KEY=VALUE. Keys the engine rejects are dropped
     * when it hands us its allow-list.
     */
    function presetLines(text, allow) {
      return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
        .map((line) => {
          const at = line.indexOf('=');
          return `${line.slice(0, at)}=${line.slice(at + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')}`;
        })
        .filter((line) => !allow || allow.includes(line.slice(0, line.indexOf('='))));
    }

    function markColor(status) {
      return status === 'ok' ? '#3fb950' : status === 'warn' ? '#d29922' : '#ff6b6b';
    }

    function PlateformSelect(props) {
      return h(
        'select',
        { className: 'ap-input', value: props.value, onChange: (event) => props.onChange(event.target.value) },
        props.platforms.map((key) => h('option', { key, value: key }, props.label(key))),
      );
    }

    function Panel(props) {
      const t = props.t || ((key) => key);
      const tf = useCallback((key, values) => {
        let text = t(key);
        for (const [name, value] of Object.entries(values || {})) text = text.split(`{${name}}`).join(String(value));
        return text;
      }, [t]);

      const [state, setState] = useState(null);
      const [doctor, setDoctor] = useState(null);
      const [job, setJob] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState('');
      const [platform, setPlatform] = useState('all');
      const [version, setVersion] = useState('');
      const [uploads, setUploads] = useState({});
      const [batchPlatforms, setBatchPlatforms] = useState(['all']);
      const [batchProjects, setBatchProjects] = useState({});
      const [harmonyDebug, setHarmonyDebug] = useState(false);
      const [keepWork, setKeepWork] = useState(false);
      const [fullPermission, setFullPermission] = useState(null);
      const [packageKind, setPackageKind] = useState('');
      const [profileFile, setProfileFile] = useState('');
      const [overrides, setOverrides] = useState('');
      const [pendingRemove, setPendingRemove] = useState('');
      const [projectDir, setProjectDir] = useState('');
      const logRef = useRef(null);

      const guard = useCallback(async (key, work) => {
        setBusy(key);
        setError('');
        try {
          return await work();
        } catch (failure) {
          setError(String((failure && failure.message) || failure));
          return undefined;
        } finally {
          setBusy('');
        }
      }, []);

      const refresh = useCallback(() => guard('state', async () => setState(await call('state'))), [guard]);

      useEffect(() => {
        refresh();
      }, [refresh]);

      const jobId = job && job.id;
      const jobRunning = Boolean(job && job.running);
      useEffect(() => {
        if (!jobId || !jobRunning) return undefined;
        let alive = true;
        const timer = setInterval(async () => {
          try {
            const next = await call(`job/log?id=${encodeURIComponent(jobId)}`);
            if (alive) setJob(next);
          } catch {
            /* keep showing the last log; the host may be restarting */
          }
        }, 1200);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [jobId, jobRunning]);

      const output = job && job.output;
      useEffect(() => {
        const element = logRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      }, [output]);

      const init = () => guard('init', async () => {
        await call('init', { method: 'POST', body: {} });
        await refresh();
      });

      const runDoctor = () => guard('doctor', async () => setDoctor(await call('doctor', { method: 'POST', body: { platform } })));

      // Upload targets are whatever the engine declares in config/upload.env; the
      // ticked ones go to the engine as one comma separated `--upload <a,b>`.
      const uploaders = (state && state.uploaders) || [];
      const uploadArg = () => uploaders.filter((item) => uploads[item.id]).map((item) => item.id).join(',');
      const uploaderNote = (item) => {
        if (!item.enabled) return t('options.uploader.disabled');
        if (!item.available) return t('options.uploader.unimplemented');
        return item.platforms && item.platforms.length
          ? tf('options.uploader.platforms', { platforms: item.platforms.map(onePlatform).join('/') })
          : '';
      };
      // Batch scope: platforms × projects become one engine run each, and no
      // project at all means every project that platform has enabled (`--all`).
      const effectivePlatforms = batchPlatforms.includes('all') ? ['all'] : batchPlatforms;
      const toggleBatchPlatform = (key) => {
        if (key === 'all') return setBatchPlatforms(batchPlatforms.includes('all') ? [] : ['all']);
        const next = batchPlatforms.filter((item) => item !== 'all');
        setBatchPlatforms(next.includes(key) ? next.filter((item) => item !== key) : next.concat(key));
      };
      const pickedProjects = () => projects.filter((project) => batchProjects[project.id] !== false).map((project) => project.id);
      const setAllProjects = (on) => setBatchProjects(Object.fromEntries(projects.map((project) => [project.id, on])));
      const runBatch = (kind) => startJob(kind, { platforms: effectivePlatforms, projects: pickedProjects() });

      const startJob = (kind, spec) => guard('job', async () => {
        const uploaderIds = uploadArg();
        const started = await call('job', {
          method: 'POST',
          body: {
            kind,
            platforms: spec.platforms || [spec.platform],
            projects: spec.projects || (spec.project ? [spec.project] : []),
            upload: uploaderIds,
            noUpload: !uploaderIds,
            version,
            harmonyDebug,
            keepWork,
            fullPermission,
            packageKind,
            profile: profileFile || undefined,
            set: overrides,
          },
        });
        setJob(started);
        refresh();
      });

      const stopJob = () => guard('job', async () => setJob(await call(`job/kill?id=${encodeURIComponent(job.id)}`, { method: 'POST' })));

      // SDK setup and the plugin upgrade ride the same job route as a build, so
      // they stream their log into the one job card below.
      const startSdkJob = (spec) => guard('sdk', async () => {
        setJob(await call('job', { method: 'POST', body: { kind: 'sdk', ...spec } }));
        refresh();
      });
      const upgradePlugin = () => guard('upgrade', async () => {
        setJob(await call('job', { method: 'POST', body: { kind: 'upgrade' } }));
      });

      // The host opens the OS folder dialog; a plain cancel is not an error, but a
      // missing picker falls back to typing the path by hand.
      const pickDirectory = () => guard('pick', async () => {
        const picked = await call('pick', { method: 'POST', body: {} });
        const paths = (picked && (picked.paths || (picked.path ? [picked.path] : []))) || [];
        if (paths.length > 0) setProjectDir(paths.join('\n'));
        else if (picked && !picked.cancelled) setError(`${t('projects.pickManual')}\n${picked.error || ''}`.trim());
      });

      const addProject = () => guard('project', async () => {
        const result = await call('project', { method: 'POST', body: { dir: projectDir } });
        if (result && result.code !== 0) {
          setError(String(result.stdout || result.stderr || '').trim() || t('error'));
          return;
        }
        setProjectDir('');
        await refresh();
      });

      // Deleting is two clicks: the row asks for confirmation first, and only
      // then removes the engine's own config/projects/<id>.env.
      const removeProject = (id) => guard('project', async () => {
        await call('project/remove', { method: 'POST', body: { id } });
        setPendingRemove('');
        await refresh();
      });

      const button = (label, onClick, options = {}) => h(
        'button',
        { type: 'button', className: `ap-btn${options.primary ? ' ap-btn-primary' : ''}`, disabled: Boolean(options.disabled), onClick },
        label,
      );

      const row = (label, value) => h('div', { style: styles.row }, h('span', { style: styles.rowLabel }, label), h('span', { style: styles.rowValue }, value));

      const checkbox = (label, checked, onChange, options = {}) => h(
        'label',
        { className: 'ap-check', style: options.disabled ? { opacity: 0.5 } : undefined, title: options.title || undefined },
        h('input', { type: 'checkbox', checked, disabled: Boolean(options.disabled), onChange: (event) => onChange(event.target.checked) }),
        label,
      );

      const onePlatform = (key) => (key === 'all' ? t('platform.all') : key === 'harmony' ? 'HarmonyOS' : key === 'ios' ? 'iOS' : key === 'android' ? 'Android' : key);

      const platformLabel = (key) => String(key || '').split(',').filter(Boolean).map(onePlatform).join(' + ');

      const jobStatus = (value) => {
        if (!value) return '';
        if (value.running) return t('job.running');
        if (value.error === '已被取消') return t('job.stopped');
        if (value.ok) return t('job.ok');
        return `${t('job.failed')}${value.code === null ? '' : ` · ${tf('job.exit', { code: value.code })}`}`;
      };

      // The engine reports problems as `[FAIL] …` / `[WARN] …` lines buried in a
      // long log; the host half already extracted them, so show them up front
      // instead of making the user scroll the raw output. A host half older
      // than this panel sends no `summary`, so fall back to reading the log
      // here — that way a page refresh is enough, no host restart needed.
      const summarizeLog = (text) => {
        const failures = [];
        const warnings = [];
        for (const line of String(text || '').split('\n')) {
          const match = /^\s*\[(FAIL|WARN)\]\s*(.+?)\s*$/.exec(line);
          if (match) (match[1] === 'FAIL' ? failures : warnings).push(match[2]);
        }
        return { errorCount: failures.length, warningCount: warnings.length, failures, warnings };
      };

      const jobNotice = (value) => {
        const summary = value && (value.summary || summarizeLog(value.output));
        if (!summary || (!summary.errorCount && !summary.warningCount)) return null;
        const block = (box, title, lines) => h(
          'div',
          { style: box },
          h('div', { style: styles.problemTitle }, title),
          lines.slice(0, NOTICE_LINES).map((line, index) => h('div', { key: index }, `• ${line}`)),
          lines.length > NOTICE_LINES ? h('div', { style: styles.muted }, tf('job.more', { n: lines.length - NOTICE_LINES })) : null,
        );
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          summary.errorCount
            ? block(styles.error, tf('job.problems', { errors: summary.errorCount, warnings: summary.warningCount }), summary.failures || [])
            : null,
          summary.warningCount ? block(styles.warn, tf('job.warnOnly', { warnings: summary.warningCount }), summary.warnings || []) : null,
        );
      };

      const header = h(
        'div',
        { style: styles.head },
        h('span', { style: styles.title }, t('title')),
        h('span', { style: styles.muted }, t('subtitle')),
        h('span', { style: { flex: 1 } }),
        state ? h('span', { style: styles.muted }, `${state.engineVersion} · ${state.home}`) : null,
        button(state ? t('refresh') : t('loading'), refresh, { disabled: !state || Boolean(busy) }),
        button(t('init'), init, { disabled: busy === 'init' }),
      );

      const engineCard = !state ? null : h(
        'div',
        { style: styles.group },
        h('div', { style: styles.groupHead }, h('span', { style: styles.groupTitle }, t('engine'))),
        row(t('engine.home'), state.home),
        row(t('engine.version'), state.engineVersion),
        row(
          t('engine.location'),
          state.plugin && state.plugin.root && String(state.home).startsWith(state.plugin.root)
            ? t('engine.location.plugin')
            : t('engine.location.other'),
        ),
        row(
          t('engine.status'),
          !state.materialized
            ? t('engine.missing')
            : state.engineDrift
              ? t('engine.stale', { home: state.homeVersion || '—' })
              : t('engine.ready'),
        ),
        row(
          t('engine.shell'),
          state.shell && state.shell.available
            ? `${state.shell.kind}${state.shell.shell && state.shell.shell.command ? ` · ${state.shell.shell.command}` : ''}`
            : t('engine.shell.none'),
        ),
        state.shell && state.shell.available ? null : h('div', { style: styles.muted }, state.shell && state.shell.error),
      );

      const doctorCard = h(
        'div',
        { style: styles.group },
        h(
          'div',
          { style: styles.groupHead },
          h('span', { style: styles.groupTitle }, t('doctor')),
          h(PlateformSelect, { value: platform, platforms: PLATFORMS, onChange: setPlatform, label: platformLabel }),
          button(t('doctor.run'), runDoctor, { disabled: Boolean(busy) }),
        ),
        doctor
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              doctor.checks.map((check) => h(
                'div',
                { key: check.id, style: styles.check },
                h('span', { style: { ...styles.mark, color: markColor(check.status) } }, mark(check.status)),
                h('span', null, `${check.label}${check.detail ? ` — ${check.detail}` : ''}`),
                check.hint ? h('div', { style: styles.hint }, `→ ${check.hint}`) : null,
              )),
              h('div', { style: styles.muted }, doctor.ok ? t('doctor.ok') : tf('doctor.bad', { failures: doctor.failures, warnings: doctor.warnings })),
            )
          : h('div', { style: styles.muted }, t('loading')),
      );

      // SDK setup: the engine recommends the download entry per platform from the
      // local HBuilderX version, and the same `sdk install` call performs it.
      const sdkCard = !state ? null : h(
        'div',
        { style: styles.group },
        h(
          'div',
          { style: styles.groupHead },
          h('span', { style: styles.groupTitle }, t('sdk')),
          h('span', { style: { flex: 1 } }),
          button(t('sdk.installAll'), () => startSdkJob({ platforms: ['ios', 'android', 'harmony'] }), { disabled: Boolean(busy) || jobRunning }),
          button(t('sdk.process'), () => startSdkJob({ processOnly: true }), { disabled: Boolean(busy) || jobRunning }),
          state.canUpgrade ? button(t('upgrade.run'), upgradePlugin, { disabled: Boolean(busy) || jobRunning }) : null,
        ),
        state.sdkError ? h('div', { style: styles.error }, state.sdkError) : null,
        h('div', { style: styles.muted }, t('sdk.hint')),
        hb && hb.found
          ? h('div', { style: styles.muted }, `${t('sdk.hbuilderx')}: ${hb.version || '?'} · ${t('sdk.series')} ${hb.series || '?'}`)
          : h('div', { style: styles.warn }, t('sdk.hbuilderx.none')),
        sdkInfo ? h('div', { style: styles.muted }, `${t('sdk.root')}: ${sdkInfo.sdkRoot}`) : null,
        sdkList.map((item) => h(
          'div',
          { key: item.id, style: styles.check },
          h('span', { style: { ...styles.mark, color: markColor(sdkMark(item)) } }, mark(sdkMark(item))),
          h('span', null, `${item.label} · ${sdkStateText(item)}`),
          h('span', { style: { flex: 1 } }),
          button(t('sdk.install'), () => startSdkJob({ platforms: [item.id] }), { disabled: Boolean(busy) || jobRunning }),
          h('a', { href: item.page, target: '_blank', rel: 'noreferrer', style: styles.link }, t('sdk.page')),
          item.direct ? h('a', { href: item.direct, target: '_blank', rel: 'noreferrer', style: styles.link }, t('sdk.direct')) : null,
          h('div', { style: styles.hint }, `${t('sdk.dir')}: ${item.dir}`),
        )),
        sdkInfo && sdkInfo.archives && sdkInfo.archives.length
          ? h('div', { style: styles.muted }, tf('sdk.archives', { n: sdkInfo.archives.length }))
          : null,
        sdkInfo && sdkInfo.incompleteDownloads
          ? h('div', { style: styles.warn }, tf('sdk.incomplete', { n: sdkInfo.incompleteDownloads }))
          : null,
        h('div', { style: styles.muted }, t('sdk.manual')),
        h('div', { style: styles.muted }, state.canUpgrade ? t('upgrade.hint') : t('upgrade.unavailable')),
      );

      const projects = (state && state.projects) || [];
      const profiles = (state && state.profiles) || [];
      // SDK setup is driven by the engine's own `sdk status`; the panel only picks
      // labels. `sdkError` is a failed status read, not a missing SDK.
      const sdkInfo = (state && state.sdk) || null;
      const sdkList = (sdkInfo && sdkInfo.platforms) || [];
      const hb = (sdkInfo && sdkInfo.hbuilderx) || null;
      const sdkMark = (item) => (item.state === 'ready' ? 'ok' : item.state === 'mismatch' ? 'warn' : 'fail');
      const sdkStateText = (item) => (item.state === 'ready'
        ? t('sdk.ready')
        : item.state === 'mismatch'
          ? tf('sdk.mismatch', { series: item.series })
          : t('sdk.missing'));
      const profilesNote = (state && state.profilesError) || (profiles.length ? t('options.profile.auto') : t('options.profiles.none'));
      // The engine owns this list; we only filter presets with it.
      const overrideKeys = (state && state.overrideKeys) || null;
      // Until settings.env has loaded, mirror the engine default (full permission on).
      const fullPermissionOn = fullPermission === null ? !state || !state.options || state.options.fullPermission !== false : fullPermission;
      const prettyKind = (kind) => t(`options.kind.${kind}`);
      const scopedProjects = () => {
        const picked = projects.filter((project) => batchProjects[project.id] !== false);
        return picked.length ? picked : projects;
      };
      const kindAvailable = (kind) => {
        const withKind = profiles.filter((profile) => profile.kind === kind);
        if (withKind.length === 0) return false;
        const bundles = scopedProjects().map((project) => project.bundleId).filter(Boolean);
        return bundles.length === 0 || withKind.some((profile) => bundles.includes(profile.bundleId));
      };
      const profileLabel = (profile) =>
        `${profile.name || profile.file} · ${prettyKind(profile.kind)} · ${profile.bundleId}${profile.expired ? ` · ${t('options.profile.expired')}` : ''}`;
      const presetOptions = () => {
        const out = [];
        for (const project of scopedProjects()) {
          const presets = (state && state.presets && state.presets[project.id]) || {};
          for (const name of Object.keys(presets)) out.push({ key: `${project.id}/${name}`, text: presets[name] });
        }
        return out;
      };
      const applyPreset = (key) => {
        const found = presetOptions().find((item) => item.key === key);
        if (found) setOverrides(presetLines(found.text, overrideKeys).join('\n'));
      };
      const projectsCard = h(
        'div',
        { style: styles.group },
        h(
          'div',
          { style: styles.groupHead },
          h('span', { style: styles.groupTitle }, `${t('projects')}（${projects.length}）`),
          button(t('refresh'), refresh, { disabled: !state || Boolean(busy) }),
        ),
        h(
          'div',
          { style: styles.actions },
          h('span', { style: styles.muted }, t('projects.dir')),
          h('textarea', {
            className: 'ap-input',
            style: { flex: '1', minWidth: '180px', minHeight: '38px' },
            placeholder: t('projects.dirMulti'),
            value: projectDir,
            onChange: (event) => setProjectDir(event.target.value),
          }),
          button(t('projects.pick'), pickDirectory, { disabled: Boolean(busy) }),
          button(t('projects.add'), addProject, { primary: true, disabled: Boolean(busy) || !projectDir.trim() }),
        ),
        h(
          'div',
          { style: styles.actions },
          h('span', { style: styles.muted }, t('options')),
          uploaders.length === 0
            ? h('span', { style: styles.muted }, t('options.uploaders.none'))
            : h(
                'span',
                { style: styles.actions },
                h('span', { style: styles.muted }, t('options.upload')),
                uploaders.map((item) => checkbox(
                  `${item.name}${uploaderNote(item) ? ` · ${uploaderNote(item)}` : ''}`,
                  Boolean(uploads[item.id]),
                  (on) => setUploads({ ...uploads, [item.id]: on }),
                  { disabled: !item.available, title: uploaderNote(item) || undefined },
                )),
              ),
          h('input', {
            className: 'ap-input',
            style: { width: '120px' },
            placeholder: t('options.version'),
            value: version,
            onChange: (event) => setVersion(event.target.value),
          }),
          h(
            'select',
            {
              className: 'ap-input',
              style: { width: 'auto' },
              title: t('options.kind.hint'),
              value: packageKind,
              onChange: (event) => setPackageKind(event.target.value),
            },
            h('option', { value: '' }, `${t('options.kind')}：${t('options.kind.auto')}`),
            PACKAGE_KINDS.map((kind) =>
              h('option', { key: kind, value: kind, disabled: !kindAvailable(kind), title: tf('options.kind.missing', { kind: prettyKind(kind) }) }, prettyKind(kind)),
            ),
          ),
          h(
            'select',
            {
              className: 'ap-input',
              style: { width: 'auto', maxWidth: '320px' },
              title: profilesNote,
              value: profileFile,
              onChange: (event) => setProfileFile(event.target.value),
            },
            h('option', { value: '' }, `${t('options.profile')}：${t('options.profile.auto')}`),
            profiles.map((profile) => h('option', { key: profile.file, value: profile.file }, profileLabel(profile))),
          ),
          checkbox(t('options.fullPermission'), fullPermissionOn, setFullPermission, { title: t('options.fullPermission.hint') }),
          h(
            'details',
            { style: styles.advanced },
            h('summary', null, t('advanced')),
            h(
              'div',
              { style: { ...styles.actions, marginTop: '6px' } },
              checkbox(t('options.harmonyDebug'), harmonyDebug, setHarmonyDebug, { title: t('options.harmonyDebug.hint') }),
              checkbox(t('options.keepWork'), keepWork, setKeepWork, { title: t('options.keepWork.hint') }),
            ),
            h(
              'div',
              { style: { marginTop: '6px' } },
              h(
                'div',
                { style: styles.actions },
                h('span', { style: styles.muted }, t('options.overrides')),
                presetOptions().length === 0
                  ? h('span', { style: styles.muted }, t('options.overrides.presets.none'))
                  : h(
                      'select',
                      { className: 'ap-input', style: { width: 'auto' }, value: '', onChange: (event) => applyPreset(event.target.value) },
                      h('option', { value: '' }, t('options.overrides.preset')),
                      presetOptions().map((item) => h('option', { key: item.key, value: item.key }, item.key)),
                    ),
              ),
              h('textarea', {
                className: 'ap-input',
                style: { width: '100%', minHeight: '56px', marginTop: '4px' },
                placeholder: t('options.overrides.hint'),
                value: overrides,
                onChange: (event) => setOverrides(event.target.value),
              }),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.scope },
          h(
            'div',
            { style: styles.actions },
            h('span', { style: styles.groupTitle }, t('scope')),
            h('span', { style: styles.muted }, t('scope.hint')),
          ),
          h(
            'div',
            { style: styles.actions },
            h('span', { style: styles.muted }, t('scope.platforms')),
            ['all', 'ios', 'android', 'harmony'].map((key) => checkbox(
              onePlatform(key),
              batchPlatforms.includes(key),
              () => toggleBatchPlatform(key),
            )),
          ),
          projects.length === 0 ? null : h(
            'div',
            { style: styles.actions },
            h('span', { style: styles.muted }, t('scope.projects')),
            button(t('scope.all'), () => setAllProjects(true), { disabled: Boolean(busy) }),
            projects.map((project) => checkbox(
              project.appName || project.id,
              batchProjects[project.id] !== false,
              (on) => setBatchProjects({ ...batchProjects, [project.id]: on }),
            )),
          ),
          h(
            'div',
            { style: styles.actions },
            button(t('check'), () => runBatch('check'), { disabled: Boolean(busy) || jobRunning || effectivePlatforms.length === 0 }),
            button(t('build'), () => runBatch('build'), { primary: true, disabled: Boolean(busy) || jobRunning || effectivePlatforms.length === 0 }),
            effectivePlatforms.length === 0 ? h('span', { style: styles.muted }, t('scope.nonePicked')) : null,
          ),
        ),
        state && state.projectsError ? h('div', { style: styles.error }, state.projectsError) : null,
        projects.length === 0 ? null : h('div', { style: styles.muted }, t('projects.remove.hint')),
        projects.length === 0
          ? h('div', { style: styles.muted }, t('projects.empty'))
          : projects.map((project) => {
              const enabled = project.enabledPlatforms && project.enabledPlatforms.length ? project.enabledPlatforms : ['ios', 'android', 'harmony'];
              return h(
                'div',
                { key: project.id, style: styles.project },
                h(
                  'div',
                  { style: styles.head },
                  h('span', { style: styles.projectName }, project.appName || project.id),
                  project.appName ? h('span', { style: styles.muted }, project.id) : null,
                  h('span', { style: { flex: 1 } }),
                  pendingRemove === project.id
                    ? h(
                        'span',
                        { style: styles.actions },
                        button(t('projects.remove.confirm'), () => removeProject(project.id), { disabled: Boolean(busy) }),
                        button(t('projects.remove.cancel'), () => setPendingRemove(''), { disabled: Boolean(busy) }),
                      )
                    : button(t('projects.remove'), () => setPendingRemove(project.id), { disabled: Boolean(busy) }),
                ),
                h('div', { style: styles.muted }, `${project.sourceDir || t('projects.sourceMissing')}${project.sourceDir && !project.sourceDirExists ? ` — ${t('projects.sourceGone')}` : ''}`),
                h('div', { style: styles.muted }, `${t('platforms')}: ${enabled.map(platformLabel).join(' / ')}`),
                project.error ? h('div', { style: styles.error }, project.error) : null,
              );
            }),
      );

      const jobCard = h(
        'div',
        { style: styles.group },
        h(
          'div',
          { style: styles.groupHead },
          h('span', { style: styles.groupTitle }, t('job')),
          job ? h('span', { style: styles.muted }, `${t(`job.kind.${job.kind}`)} · ${platformLabel(job.platform)}${job.project ? ` · ${job.project}` : ''}`) : null,
          job ? h('span', { style: styles.badge }, jobStatus(job)) : null,
          h('span', { style: { flex: 1 } }),
          jobRunning ? button(t('job.stop'), stopJob, { disabled: Boolean(busy) }) : null,
        ),
        job && job.blockedByCheck ? h('div', { style: styles.error }, t('job.blockedByCheck')) : null,
        job && job.error && job.error !== '已被取消' ? h('div', { style: styles.error }, job.error) : null,
        jobNotice(job),
        job && job.dropped ? h('div', { style: styles.muted }, tf('job.dropped', { n: job.dropped })) : null,
        job
          ? h('pre', { ref: logRef, style: styles.log }, job.output || t('job.waiting'))
          : h('div', { style: styles.muted }, t('job.none')),
      );

      return h(
        'div',
        { className: 'ap-root' },
        header,
        error ? h('div', { style: styles.error }, `${t('error')}: ${error}`) : null,
        engineCard,
        doctorCard,
        sdkCard,
        projectsCard,
        jobCard,
      );
    }

    function PanelIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21 8.4 12 3.6 3 8.4v7.2l9 4.8 9-4.8z' }),
        h('path', { d: 'M3 8.4l9 4.8 9-4.8' }),
        h('path', { d: 'M12 13.2v7.2' }),
      );
    }

    function apply(ctx) {
      installStyles();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
      const t = ctx.locale.bind(NS);
      const disposers = [];
      disposers.push(
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label'), locale: NS, inject: () => ({ t }) },
          PanelIcon,
        )),
      );
      disposers.push(
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t }) },
          Panel,
        )),
      );
      ctx.effect(() => () => {
        for (const dispose of disposers.splice(0)) dispose && dispose();
      }, `${NS}: panel slots`);
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
