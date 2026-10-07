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
      'engine.shell': 'Shell 桥接',
      'engine.shell.none': '不可用',
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
      platforms: '平台',
      check: '环境检查',
      build: '打包',
      options: '打包选项',
      'options.version': '版本号',
      'options.upload': '上传 pgyer',
      'options.harmonyDebug': 'HarmonyOS debug 包',
      'options.keepWork': '保留构建目录',
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
      'job.dropped': '（日志过长，已省略前 {n} 字符）',
      'job.waiting': '等待输出…',
      'job.problems': '发现 {errors} 项错误、{warnings} 项警告：',
      'job.warnOnly': '发现 {warnings} 项警告：',
      'job.more': '…另有 {n} 行，完整内容见下方日志',
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
      'engine.shell': 'Shell bridge',
      'engine.shell.none': 'unavailable',
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
      platforms: 'Platforms',
      check: 'Env check',
      build: 'Build',
      options: 'Build options',
      'options.version': 'Version',
      'options.upload': 'Upload to pgyer',
      'options.harmonyDebug': 'HarmonyOS debug HAP',
      'options.keepWork': 'Keep work dir',
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
      badge: { fontSize: '11px', padding: '1px 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42))' },
      log: { margin: 0, padding: '8px 10px', maxHeight: '320px', overflow: 'auto', fontSize: '11.5px', lineHeight: 1.45, fontFamily: "var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09))', borderRadius: '6px' },
      error: { border: '1px solid var(--dsw-alias-state-error, rgba(255,96,96,.5))', color: 'var(--dsw-alias-state-error, #ff6b6b)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
      warn: { border: '1px solid var(--dsw-alias-state-warning, rgba(210,153,34,.5))', color: 'var(--dsw-alias-state-warning, #d29922)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
      problemTitle: { fontWeight: 600, marginBottom: '2px' },
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
      const [upload, setUpload] = useState(false);
      const [harmonyDebug, setHarmonyDebug] = useState(false);
      const [keepWork, setKeepWork] = useState(false);
      const [rowPlatform, setRowPlatform] = useState({});
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

      const startJob = (kind, spec) => guard('job', async () => {
        const started = await call('job', {
          method: 'POST',
          body: {
            kind,
            platform: spec.platform,
            project: spec.project || '',
            upload: upload ? 'pgyer' : '',
            noUpload: !upload,
            version,
            harmonyDebug,
            keepWork,
          },
        });
        setJob(started);
        refresh();
      });

      const stopJob = () => guard('job', async () => setJob(await call(`job/kill?id=${encodeURIComponent(job.id)}`, { method: 'POST' })));

      // The host opens the OS folder dialog; a plain cancel is not an error, but a
      // missing picker falls back to typing the path by hand.
      const pickDirectory = () => guard('pick', async () => {
        const picked = await call('pick', { method: 'POST', body: {} });
        if (picked && picked.path) setProjectDir(picked.path);
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

      const button = (label, onClick, options = {}) => h(
        'button',
        { type: 'button', className: `ap-btn${options.primary ? ' ap-btn-primary' : ''}`, disabled: Boolean(options.disabled), onClick },
        label,
      );

      const row = (label, value) => h('div', { style: styles.row }, h('span', { style: styles.rowLabel }, label), h('span', { style: styles.rowValue }, value));

      const checkbox = (label, checked, onChange) => h(
        'label',
        { className: 'ap-check' },
        h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
        label,
      );

      const platformLabel = (key) => (key === 'all' ? t('platform.all') : key === 'harmony' ? 'HarmonyOS' : key === 'ios' ? 'iOS' : 'Android');

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
          t('engine.ready'),
          state.materialized ? t('engine.ready') : t('engine.missing'),
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

      const projects = (state && state.projects) || [];
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
          h('input', {
            className: 'ap-input',
            style: { flex: '1', minWidth: '180px' },
            placeholder: t('projects.dirHint'),
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
          checkbox(t('options.upload'), upload, setUpload),
          checkbox(t('options.harmonyDebug'), harmonyDebug, setHarmonyDebug),
          checkbox(t('options.keepWork'), keepWork, setKeepWork),
          h('input', {
            className: 'ap-input',
            style: { width: '120px' },
            placeholder: t('options.version'),
            value: version,
            onChange: (event) => setVersion(event.target.value),
          }),
        ),
        state && state.projectsError ? h('div', { style: styles.error }, state.projectsError) : null,
        projects.length === 0
          ? h('div', { style: styles.muted }, t('projects.empty'))
          : projects.map((project) => {
              const enabled = project.enabledPlatforms && project.enabledPlatforms.length ? project.enabledPlatforms : ['ios', 'android', 'harmony'];
              const choices = enabled.length > 1 ? ['all'].concat(enabled) : enabled;
              const selected = rowPlatform[project.id] || choices[0];
              return h(
                'div',
                { key: project.id, style: styles.project },
                h('div', { style: styles.head }, h('span', { style: styles.projectName }, project.appName || project.id), project.appName ? h('span', { style: styles.muted }, project.id) : null),
                h('div', { style: styles.muted }, `${project.sourceDir || t('projects.sourceMissing')}${project.sourceDir && !project.sourceDirExists ? ` — ${t('projects.sourceGone')}` : ''}`),
                project.error ? h('div', { style: styles.error }, project.error) : null,
                h(
                  'div',
                  { style: styles.actions },
                  h('span', { style: styles.muted }, t('platforms')),
                  h(PlateformSelect, {
                    value: selected,
                    platforms: choices,
                    onChange: (value) => setRowPlatform({ ...rowPlatform, [project.id]: value }),
                    label: platformLabel,
                  }),
                  button(t('check'), () => startJob('check', { platform: selected, project: project.id }), { disabled: Boolean(busy) || jobRunning }),
                  button(t('build'), () => startJob('build', { platform: selected, project: project.id }), { primary: true, disabled: Boolean(busy) || jobRunning }),
                ),
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
