"use strict";
/**
 * AppPackager panel — browser half of the DeepSeek Harness bundle.
 *
 * A plain ModuleLoader bundle (compiled by `tsc`, no bundler step), matching how the host loads
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
        const PLATFORMS = ['all', 'ios', 'android', 'harmony', 'mp-weixin'];
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
            'sdk.package': '文件名/包名',
            'sdk.package.ohpm': 'ohpm 包名',
            'section.expand': '展开',
            'section.collapse': '折叠',
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
            'upgrade.closing': '旧版本已关闭，新版本正在后台安装（面板已失效，这是预期的）。装完重启 DeepSeek Harness 生效；安装日志：{{log}}',
            'upgrade.after': '插件已升级：请重启 DeepSeek Harness。别拿刷新页面代替 —— 页面里记的是启动时那份清单给的客户端模块版本号，刷新会去取一个已经不存在的版本（404），侧栏入口反而会消失。',
            cert: '证书',
            'cert.hint': '证书文件夹整个交给引擎：里面的 .mobileprovision / .p12 / .cer / .p7b / .keystore / keystore.properties 会按平台自动归位到 certificates/ 下，同名文件覆盖即更新（旧文件进 logs/certificate-history），来源文件夹不动。',
            'cert.ready': '已就绪',
            'cert.missing': '缺文件',
            'cert.import': '选择证书文件夹…',
            'cert.reimport': '更新证书',
            'cert.clear': '清理',
            'cert.clear.confirm': '确认清理',
            'cert.clear.cancel': '取消',
            'cert.clear.hint': '不会真删：文件挪进 logs/certificate-history/<时间戳>/，需要时手动挪回即可。',
            'cert.file.remove': '删除这个文件',
            'cert.file.confirm': '确认删除',
            'cert.file.cancel': '取消',
            'cert.pickPrompt': '选择存放证书的文件夹（里面的文件会自动按平台归位）',
            'cert.imported': '上次导入的文件夹：{dir}',
            'cert.none': '还没导入过证书。iOS 要 p12 + mobileprovision；HarmonyOS 要 p12 + cer + p7b；Android 要 keystore（不给也能出测试包，但正式包必须配）。',
            'cert.dir': '证书目录',
            'cert.docs': '官方文档',
            'cert.ios.files': 'p12 {p12} 个 · 描述文件 {profiles} 个',
            'cert.android.files': 'keystore {keys} 个 · keystore.properties {properties} 个',
            'cert.harmony.files': 'p12 {p12} 个 · cer {cer} 个 · p7b {p7b} 个',
            'cert.profileLine': '{name} · {kind} · {bundle} · 到期 {expiry}',
            'cert.profileExpired': '已过期',
            doctor: '环境检查（Node）',
            'doctor.run': '开始检查',
            'doctor.ok': '结论：当前环境可以打包。',
            'doctor.bad': '结论：{failures} 项失败、{warnings} 项警告。',
            projects: '项目列表',
            'projects.empty': '未发现项目配置 config/projects/*.env。用下面的「选择目录…」指定项目总文件夹，里面的 uni-app x 项目会全部登记。',
            'projects.dir': '项目总文件夹',
            'projects.dirHint': '放项目的那一层目录（里面的 uni-app x 项目会全部登记）',
            'projects.pick': '选择目录…',
            'projects.add': '添加项目',
            'projects.pickManual': '当前系统没有可用的目录选择器，请手动输入路径。',
            'projects.sourceMissing': '（未配置源码目录）',
            'projects.sourceGone': '源码目录不存在',
            'projects.dirMulti': '填或选项目总文件夹，例如 /Users/you/work/projects',
            'projects.remove': '删除',
            'projects.remove.confirm': '确认删除',
            'projects.remove.cancel': '取消',
            'projects.remove.hint': '只移除登记（config/projects/<id>.env），不动项目源码。',
            'projects.multi': '一次可选择多个目录。',
            platforms: '平台',
            check: '环境检查',
            build: '打包',
            options: '打包选项',
            'options.version': '版本号',
            'options.upload': '上传',
            'options.uploader.disabled': '未启用',
            'options.uploader.unimplemented': '引擎里还没有实现',
            'options.uploader.platforms': '支持 {platforms}',
            'options.cred.label': '{name} API Key',
            'options.cred.userKey.label': '{name} User Key',
            'options.cred.userKey.placeholder.saved': '已配置，填新值可覆盖；清空并保存即撤销',
            'options.cred.userKey.placeholder.empty': '粘贴 User Key（uKey，可留空）',
            'options.cred.userKey.hint': '官方 CLI 与 API 2.0 只需要 API Key；User Key 是蒲公英 API 1.0 上传接口的必填项（uKey），存下来备用，填了会一起送给 CLI 和 HAP 接口。',
            'options.cred.placeholder.saved': '已配置，填新值可覆盖',
            'options.cred.placeholder.empty': '粘贴 API Key',
            'options.cred.save': '保存',
            'options.cred.saved': '已配置',
            'options.cred.unconfigured': '未配置',
            'options.cred.missing': '未配置 API Key，上传会被跳过',
            'options.cred.cli.installed': '官方 CLI {package}{version} 已装在插件目录里',
            'options.cred.cli.missing': '首次上传时自动把官方 CLI 装进插件目录（需要 Node 18+）',
            upload: '上传',
            'options.uploadAfterBuild': '打包后上传',
            'options.uploadAfterBuild.hint': '打包完成后把这次新打出来的安装包按勾选的平台上传；一个都不勾就只打包。失败不影响打包结果。',
            'upload.hint': '上传只送「上一次打包」归档的安装包，不重新打包；没有产物就先打包一次。',
            'upload.empty': '还没有打包好的安装包。先在上面的「打包选项 / 打包范围」里打包一次。',
            'upload.target': '分发平台',
            'upload.target.none': '没有已启用的上传平台，先去 config/upload.env 打开一个。',
            'upload.action': '上传',
            'upload.missing': '安装包已不在',
            'upload.mpUploaded': '已上传微信后台',
            'upload.mpCompiled': '仅编译（未上传）',
            'upload.mpDir': '目录产物，直接在 packages/MPWeixin/ 里查看',
            'upload.builtAt': '打包于 {time}',
            'download.dir': '下载位置',
            'download.pick': '选择文件夹…',
            'download.pickPrompt': '选择安装包的下载目录（所有平台共用这一个文件夹）',
            'download.placeholder': '留空 = {dir}',
            'download.hint': '点「下载」把这个安装包复制到上面的文件夹；同一版本重复下载不会覆盖，会存成 name-1.apk。',
            'download.action': '下载',
            'download.done': '已保存到 {path}',
            'options.mpWeixinUpload': '构建后上传微信公众平台',
            'options.mpWeixinUpload.hint': '同一次 HBuilderX 发布里编译并上传（需要证书目录里的 .key 与后台 IP 白名单）；不勾只编译，产物留在 packages/MPWeixin/。',
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
            'scope.projectOff': '该项目未启用所选平台，勾上后引擎会直接报错',
            'scope.hint': '不勾项目 = 该平台所有项目；平台与项目会组合成多次引擎调用。',
            'scope.nonePicked': '请至少勾选一个平台。',
            job: '任务',
            'job.none': '暂无任务。',
            'job.running': '运行中',
            'job.ok': '成功',
            'job.failed': '失败',
            'job.stopped': '已停止',
            'job.stop': '停止',
            'job.clear': '清除',
            'job.exit': '退出码 {code}',
            'job.kind.check': '环境检查',
            'job.kind.build': '打包',
            'job.kind.upload': '上传',
            'job.kind.sdk': 'SDK 配置',
            'job.kind.upgrade': '插件升级',
            'job.kind.cert': '证书导入',
            'job.dropped': '（日志过长，已省略前 {n} 字符）',
            'job.waiting': '等待输出…',
            'job.progress': '运行中 {time} · 当前：{line}',
            'job.problems': '发现 {errors} 项错误、{warnings} 项警告：',
            'job.warnOnly': '发现 {warnings} 项警告：',
            'job.more': '…另有 {n} 行，完整内容见下方日志',
            'job.blockedByCheck': '打包前环境检查未通过，已停止打包。请先按上面的 [FAIL] 提示处理，再点「打包」。',
            error: '出错了',
            loading: '加载中…',
            'platform.all': '全部',
            'platform.mpWeixin': '微信小程序',
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
            'sdk.package': 'File name',
            'sdk.package.ohpm': 'ohpm package',
            'section.expand': 'Expand',
            'section.collapse': 'Collapse',
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
            'upgrade.closing': 'The old version is shut down and the new one is installing in the background (this panel is dead now, by design). Restart DeepSeek Harness once it finishes; install log: {{log}}',
            'upgrade.after': 'The plugin has been upgraded: restart DeepSeek Harness. Do not reload the page instead — the page still holds the client-module revision from boot, so a reload asks for a revision that no longer exists (404) and the sidebar entry disappears.',
            cert: 'Certificates',
            'cert.hint': 'Hand the whole folder to the engine: the .mobileprovision / .p12 / .cer / .p7b / .keystore / keystore.properties inside are filed under certificates/ by platform, overwriting the same name means “updated” (the old file goes to logs/certificate-history) and the source folder is left alone.',
            'cert.ready': 'Ready',
            'cert.missing': 'Missing files',
            'cert.import': 'Choose certificate folder…',
            'cert.reimport': 'Update certificates',
            'cert.clear': 'Clear',
            'cert.clear.confirm': 'Confirm clear',
            'cert.clear.cancel': 'Cancel',
            'cert.clear.hint': 'Nothing is deleted: files move to logs/certificate-history/<timestamp>/ and can be moved back.',
            'cert.file.remove': 'Delete this file',
            'cert.file.confirm': 'Confirm delete',
            'cert.file.cancel': 'Cancel',
            'cert.pickPrompt': 'Choose the folder that holds your certificates (files are filed by platform automatically)',
            'cert.imported': 'Last imported folder: {dir}',
            'cert.none': 'No certificates imported yet. iOS needs p12 + mobileprovision; HarmonyOS needs p12 + cer + p7b; Android needs a keystore (test packages still build without one, release packages do not).',
            'cert.dir': 'Certificate directory',
            'cert.docs': 'Official docs',
            'cert.ios.files': '{p12} p12 · {profiles} provisioning profile(s)',
            'cert.android.files': '{keys} keystore(s) · {properties} keystore.properties',
            'cert.harmony.files': '{p12} p12 · {cer} cer · {p7b} p7b',
            'cert.profileLine': '{name} · {kind} · {bundle} · expires {expiry}',
            'cert.profileExpired': 'expired',
            doctor: 'Environment check (Node)',
            'doctor.run': 'Run check',
            'doctor.ok': 'This machine can build.',
            'doctor.bad': '{failures} failed, {warnings} warnings.',
            projects: 'Project list',
            'projects.empty': 'No project configs (config/projects/*.env) found. Use “Choose folder…” below to pick the folder that holds your projects; every uni-app x project inside it is registered.',
            'projects.dir': 'Projects folder',
            'projects.dirHint': 'The folder that holds your projects (every uni-app x project inside is registered)',
            'projects.pick': 'Choose folder…',
            'projects.add': 'Add project',
            'projects.pickManual': 'This system has no folder picker; type the path instead.',
            'projects.sourceMissing': '(no source directory)',
            'projects.sourceGone': 'source directory missing',
            'projects.dirMulti': 'Type or pick the folder that holds your projects, e.g. /Users/you/work/projects',
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
            'options.uploader.disabled': 'disabled',
            'options.uploader.unimplemented': 'not implemented in the engine yet',
            'options.uploader.platforms': 'for {platforms}',
            'options.cred.label': '{name} API key',
            'options.cred.userKey.label': '{name} User Key',
            'options.cred.userKey.placeholder.saved': 'Configured — type a new value to replace it, or clear it to remove',
            'options.cred.userKey.placeholder.empty': 'Paste the User Key (uKey, optional)',
            'options.cred.userKey.hint': 'The official CLI and API 2.0 only need the API key. The User Key is the uKey the legacy API 1.0 upload endpoint requires — it is stored for later and, when set, also sent to the CLI and the HAP endpoints.',
            'options.cred.placeholder.saved': 'Configured — type a new value to replace it',
            'options.cred.placeholder.empty': 'Paste the API key',
            'options.cred.save': 'Save',
            'options.cred.saved': 'Configured',
            'options.cred.unconfigured': 'Not set',
            'options.cred.missing': 'No API key configured — the upload is skipped',
            'options.cred.cli.installed': 'Official CLI {package}{version} is installed in the plugin folder',
            'options.cred.cli.missing': 'The official CLI is installed into the plugin folder on the first upload (needs Node 18+)',
            upload: 'Upload',
            'options.uploadAfterBuild': 'Upload after build',
            'options.uploadAfterBuild.hint': 'When the build finishes, upload the installers it just produced to the ticked platforms. Tick none to only build; an upload failure never rolls the build back.',
            'upload.hint': 'Uploading ships the installer archived by the last build — it never rebuilds. No installer yet? Build one first.',
            'upload.empty': 'No installer has been built yet. Run a build from Build options / Build scope above.',
            'upload.target': 'Distribution',
            'upload.target.none': 'No uploader is enabled — turn one on in config/upload.env.',
            'upload.action': 'Upload',
            'upload.missing': 'installer is gone',
            'upload.mpUploaded': 'uploaded to WeChat',
            'upload.mpCompiled': 'compiled only',
            'upload.mpDir': 'a directory — look inside packages/MPWeixin/',
            'upload.builtAt': 'built {time}',
            'download.dir': 'Download folder',
            'download.pick': 'Choose folder…',
            'download.pickPrompt': 'Choose where installers are saved (one folder shared by every platform)',
            'download.placeholder': 'blank = {dir}',
            'download.hint': 'Download copies this installer into that folder; a repeated download of the same build is kept as name-1.apk instead of overwriting.',
            'download.action': 'Download',
            'download.done': 'saved to {path}',
            'options.mpWeixinUpload': 'Upload to WeChat after build',
            'options.mpWeixinUpload.hint': 'One HBuilderX publish call compiles and uploads (needs a .key in the certificate folder and the IP whitelist); unticked only compiles into packages/MPWeixin/.',
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
            'scope.projectOff': 'This project does not enable the picked platform(s); the engine will refuse it',
            'scope.hint': 'No project ticked = every project of that platform; platforms × projects become several engine runs.',
            'scope.nonePicked': 'Tick at least one platform.',
            job: 'Job',
            'job.none': 'No job yet.',
            'job.running': 'running',
            'job.ok': 'succeeded',
            'job.failed': 'failed',
            'job.stopped': 'stopped',
            'job.stop': 'Stop',
            'job.clear': 'Clear',
            'job.exit': 'exit code {code}',
            'job.kind.check': 'Environment check',
            'job.kind.build': 'Build',
            'job.kind.upload': 'Upload',
            'job.kind.sdk': 'SDK setup',
            'job.kind.upgrade': 'Plugin upgrade',
            'job.kind.cert': 'Certificate import',
            'job.blockedByCheck': 'The pre-build environment check failed, so the build did not start. Fix the [FAIL] items above, then press “Build” again.',
            'job.dropped': '(log truncated, {n} leading characters dropped)',
            'job.waiting': 'Waiting for output…',
            'job.progress': 'Running for {time} · now: {line}',
            'job.problems': '{errors} error(s), {warnings} warning(s):',
            'job.warnOnly': '{warnings} warning(s):',
            'job.more': '…and {n} more lines; see the full log below',
            error: 'Something went wrong',
            loading: 'Loading…',
            'platform.all': 'All',
            'platform.mpWeixin': 'WeChat mini program',
        };
        // Colours come from the host's theme tokens, each with the plain-grey fallback we
        // want when a token is missing (older shells, stripped-down profiles).
        // The host owns the box our `main` slot lands in: its height and overflow are
        // not ours to know, so scrolling has two legs — these rules make `.ap-root`
        // scroll whenever the parent chain hands it a definite height, and the
        // measured fallback in `Panel` (see `useEffect` near the root node) flips the
        // nearest clipping ancestor when the chain is broken instead.
        // 设计层：间距/圆角/缓动统一成一组变量，下面各条规则只引用变量，
        // 想整体调密度或手感时改这里一次就够。
        const CSS = `
      .ap-root {
        --ap-gap: 16px;
        --ap-r-sm: 8px;
        --ap-r-md: 10px;
        --ap-r-lg: 14px;
        --ap-ease: cubic-bezier(.22, .68, .28, 1);
        --ap-spring: cubic-bezier(.34, 1.56, .64, 1);
        --ap-fast: .14s var(--ap-ease);
        --ap-mid: .22s var(--ap-ease);
        --ap-shadow: 0 1px 2px rgba(0,0,0,.06), 0 10px 24px -16px rgba(0,0,0,.42);
        --ap-shadow-lift: 0 2px 4px rgba(0,0,0,.07), 0 16px 32px -18px rgba(0,0,0,.5);
        display: flex; flex-direction: column; gap: var(--ap-gap); padding: 0 16px 28px;
        height: 100%; min-height: 0; max-height: 100%; box-sizing: border-box;
        overflow-y: auto; overscroll-behavior: contain;
        font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-primary, inherit);
        font-variant-numeric: tabular-nums;
      }
      .ap-root *, .ap-root *::before, .ap-root *::after { box-sizing: border-box; }
      .ap-root ::selection { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 26%, transparent); }
      .ap-root::-webkit-scrollbar { width: 10px; height: 10px; }
      .ap-root::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l3, rgba(128,128,128,.28)); border: 3px solid transparent; background-clip: content-box; border-radius: 99px; transition: background .2s; }
      .ap-root::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-border-default, rgba(128,128,128,.45)); background-clip: content-box; }

      /* 顶栏：毛玻璃 + 底部渐隐，滚动时把内容压在下面。 */
      .ap-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: 0; z-index: 5; margin: 0 -16px; padding: 13px 16px 11px;
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #1a1a1a) 82%, transparent);
        backdrop-filter: blur(14px) saturate(1.4);
        -webkit-backdrop-filter: blur(14px) saturate(1.4);
        border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.18)); }
      .ap-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; pointer-events: none;
        background: linear-gradient(to bottom, rgba(0,0,0,.10), transparent); }
      .ap-title { font-size: 15px; font-weight: 650; letter-spacing: .2px; white-space: nowrap; }
      .ap-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ap-path { font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* 卡片：挂载时按顺序淡入；悬停只做 1px 抬起，不抢注意力。 */
      @keyframes ap-rise { from { opacity: 0; transform: translateY(6px) scale(.995); } to { opacity: 1; transform: none; } }
      @keyframes ap-breathe { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
      @keyframes ap-pulse-ring { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 4px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
      .ap-card { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 15px 16px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.26)); border-radius: var(--ap-r-lg);
        background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-2, #222) 92%, transparent), var(--dsw-alias-bg-layer-1, #1a1a1a));
        animation: ap-rise .26s var(--ap-ease) both;
        transition: border-color var(--ap-mid), box-shadow var(--ap-mid), transform var(--ap-mid); }
      .ap-root > .ap-card:nth-child(1) { animation-delay: 0s; }
      .ap-root > .ap-card:nth-child(2) { animation-delay: .03s; }
      .ap-root > .ap-card:nth-child(3) { animation-delay: .06s; }
      .ap-root > .ap-card:nth-child(4) { animation-delay: .09s; }
      .ap-root > .ap-card:nth-child(n+5) { animation-delay: .12s; }
      .ap-card > * { animation: ap-rise .26s var(--ap-ease) both; animation-delay: .04s; }
      .ap-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ap-card-title { font-size: 13px; font-weight: 650; margin-right: auto; letter-spacing: .2px; }

      /* 折叠：标题本身是按钮（键盘可收放），右侧操作按钮留在按钮外。 */
      .ap-fold { display: flex; align-items: center; gap: 6px; margin-right: auto; padding: 3px 6px 3px 2px; border: 0; border-radius: var(--ap-r-sm); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
        transition: color var(--ap-fast), background var(--ap-fast); }
      .ap-fold:hover { color: var(--dsw-alias-brand-primary, #4a8cff); }
      .ap-fold:active { transform: translateY(1px); }
      .ap-fold:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a8cff); outline-offset: 2px; }
      .ap-fold-arrow { display: inline-block; font-size: 10px; line-height: 1; color: var(--dsw-alias-label-tertiary, inherit);
        transition: transform .24s var(--ap-spring), color var(--ap-fast); }
      .ap-fold:not(.ap-fold-open) .ap-fold-arrow { transform: rotate(-90deg); }
      .ap-fold:hover .ap-fold-arrow { color: inherit; }

      .ap-row { display: grid; grid-template-columns: minmax(84px, max-content) minmax(0, 1fr); gap: 4px 14px; font-size: 12.5px; align-items: baseline; }
      .ap-row-label { color: var(--dsw-alias-label-tertiary, inherit); }
      .ap-row-value { min-width: 0; overflow-wrap: anywhere; }
      .ap-row-value.ap-mono { font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; }
      .ap-note { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); }
      .ap-muted { color: var(--dsw-alias-label-tertiary, inherit); opacity: .8; font-size: 11.5px; }
      .ap-mark { text-align: center; font-weight: 700; }

      /* 按钮：hover 提亮，按下回落，主按钮带一点品牌色晕。 */
      .ap-btn { font: inherit; font-size: 12px; line-height: 1.4; padding: 4px 11px; border-radius: var(--ap-r-sm); white-space: nowrap;
        border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42)); background: transparent; color: inherit; cursor: pointer;
        transition: background var(--ap-fast), border-color var(--ap-fast), color var(--ap-fast), box-shadow var(--ap-fast), transform .09s var(--ap-ease); }
      .ap-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.16)); border-color: var(--dsw-alias-border-l3, rgba(128,128,128,.5)); }
      .ap-btn:active:not(:disabled) { transform: translateY(1px) scale(.985); }
      .ap-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a8cff); outline-offset: 2px; }
      .ap-btn:disabled { opacity: .45; cursor: default; }
      .ap-btn-primary { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 70%, transparent); color: var(--dsw-alias-brand-primary, #4a8cff);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 13%, transparent); }
      .ap-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 22%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 12%, transparent); }
      .ap-btn-sm { font-size: 11.5px; padding: 2px 8px; }

      .ap-input { font: inherit; font-size: 12px; padding: 4px 9px; border-radius: var(--ap-r-sm);
        border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); color: inherit;
        transition: border-color var(--ap-fast), box-shadow var(--ap-mid), background var(--ap-fast); }
      .ap-input:hover { border-color: var(--dsw-alias-border-l3, rgba(128,128,128,.5)); }
      .ap-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4a8cff);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4a8cff) 20%, transparent); }

      .ap-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; transition: color var(--ap-fast); }
      .ap-check:hover { color: var(--dsw-alias-label-primary, inherit); }
      .ap-check input { accent-color: var(--dsw-alias-brand-primary, #4a8cff); cursor: pointer; }
      .ap-check-row { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 2px 8px; font-size: 12.5px; align-items: start;
        padding: 4px 8px; margin: 0 -8px; border-radius: var(--ap-r-sm); transition: background var(--ap-fast); }
      .ap-check-row:hover { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.1)); }
      .ap-check-hint { grid-column: 2; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); }

      .ap-link { font-size: 12px; white-space: nowrap; color: var(--dsw-alias-label-link, #4c8dff); text-decoration: none; text-underline-offset: 2px;
        transition: color var(--ap-fast), opacity var(--ap-fast); }
      .ap-link:hover { text-decoration: underline; }
      .ap-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a8cff); outline-offset: 2px; border-radius: 4px; }

      /* 状态标签：左侧小圆点，失败时轻微呼吸。 */
      .ap-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 1px 8px; border-radius: 999px; white-space: nowrap;
        border: 1px solid var(--dsw-alias-border-default, rgba(128,128,128,.42)); transition: background var(--ap-fast), border-color var(--ap-fast); }
      .ap-tag::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .85; }
      .ap-tag.ok { color: #3fb950; border-color: rgba(63,185,80,.45); background: rgba(63,185,80,.1); }
      .ap-tag.warn { color: #d29922; border-color: rgba(210,153,34,.45); background: rgba(210,153,34,.1); }
      .ap-tag.fail { color: #ff6b6b; border-color: rgba(255,107,107,.45); background: rgba(255,107,107,.1); }
      .ap-tag.fail::before { animation: ap-breathe 1.6s ease-in-out infinite; }

      .ap-sdk { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.16)); }
      .ap-sdk-first { padding-top: 0; border-top: none; }
      .ap-sdk-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ap-sdk-name { font-size: 12.5px; font-weight: 650; }
      .ap-sdk-detail { display: flex; flex-direction: column; gap: 2px; padding-left: 22px; }
      .ap-kv { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); overflow-wrap: anywhere; }
      .ap-project { display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.16)); }
      .ap-project-name { font-size: 13px; font-weight: 650; }
      .ap-scope { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: var(--ap-r-md);
        border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.24));
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #1a1a1a) 70%, transparent); }

      .ap-log { margin: 0; padding: 10px 12px; max-height: 40vh; overflow: auto; font-size: 11.5px; line-height: 1.55; tab-size: 2;
        font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); white-space: pre-wrap; word-break: break-word;
        background: var(--dsw-alias-bg-base, rgba(128,128,128,.09)); border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.18)); border-radius: var(--ap-r-md); }
      .ap-log::-webkit-scrollbar { width: 10px; height: 10px; }
      .ap-log::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l3, rgba(128,128,128,.28)); border: 3px solid transparent; background-clip: content-box; border-radius: 99px; }

      .ap-box-error { border: 1px solid var(--dsw-alias-state-error, rgba(255,96,96,.5)); color: var(--dsw-alias-state-error, #ff6b6b); border-radius: var(--ap-r-md); padding: 8px 10px; font-size: 12px; white-space: pre-wrap; background: color-mix(in srgb, var(--dsw-alias-state-error, #ff6b6b) 8%, transparent); }
      .ap-box-warn { border: 1px solid var(--dsw-alias-state-warning, rgba(210,153,34,.5)); color: var(--dsw-alias-state-warning, #d29922); border-radius: var(--ap-r-md); padding: 8px 10px; font-size: 12px; white-space: pre-wrap; background: color-mix(in srgb, var(--dsw-alias-state-warning, #d29922) 8%, transparent); }

      /* 悬停抬高只在真有指针的设备上做，触屏点完不会留下「悬停态」。 */
      @media (hover: hover) and (pointer: fine) {
        .ap-card:hover { border-color: var(--dsw-alias-border-l3, rgba(128,128,128,.36)); box-shadow: var(--ap-shadow-lift); transform: translateY(-1px); }
      }
      /* 窄侧栏：标签列收窄，避免值被挤成一列一个字。 */
      @media (max-width: 520px) {
        .ap-root { padding: 0 12px 24px; }
        .ap-head { margin: 0 -12px; padding: 12px 12px 10px; }
        .ap-row { grid-template-columns: minmax(64px, max-content) minmax(0, 1fr); gap: 2px 10px; }
        .ap-card { padding: 13px 14px; }
      }
      /* 系统开了「减少动态效果」就全关，别跟无障碍设置对着干。 */
      @media (prefers-reduced-motion: reduce) {
        .ap-card, .ap-card > *, .ap-tag.fail::before { animation: none !important; }
        .ap-fold-arrow, .ap-btn, .ap-input, .ap-check, .ap-link, .ap-fold, .ap-card { transition: none !important; }
        .ap-card:hover { transform: none; }
      }
    `;
        function installStyles() {
            if (typeof document === 'undefined')
                return;
            if (document.getElementById('dsh-app-packager-styles') !== null)
                return;
            const tag = document.createElement('style');
            tag.id = 'dsh-app-packager-styles';
            tag.textContent = CSS;
            document.head.appendChild(tag);
        }
        // Layout lives in `CSS` (class names), not here: only the values that are
        // dynamic-free but awkward as classes stay as objects.
        const styles = {
            muted: { color: 'var(--dsw-alias-label-tertiary, inherit)', opacity: 0.8, fontSize: '11.5px' },
            actions: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
            error: { border: '1px solid var(--dsw-alias-state-error, rgba(255,96,96,.5))', color: 'var(--dsw-alias-state-error, #ff6b6b)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
            warn: { border: '1px solid var(--dsw-alias-state-warning, rgba(210,153,34,.5))', color: 'var(--dsw-alias-state-warning, #d29922)', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', whiteSpace: 'pre-wrap' },
            problemTitle: { fontWeight: 600, marginBottom: '2px' },
            advanced: { fontSize: '12px' },
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
            if (!response.ok)
                throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            return payload;
        }
        /** Certificate source folders the user picked last time (per browser, best effort). */
        const CERT_DIRS_KEY = 'ap-cert-dirs';
        const readCertDirs = () => {
            try {
                const value = JSON.parse(localStorage.getItem(CERT_DIRS_KEY) || '[]');
                return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
            }
            catch {
                return [];
            }
        };
        /** Download folder for archived installers (per browser, best effort). */
        const DOWNLOAD_DIR_KEY = 'ap-download-dir';
        const readDownloadDir = () => {
            try {
                return localStorage.getItem(DOWNLOAD_DIR_KEY) || '';
            }
            catch {
                return '';
            }
        };
        const rememberDownloadDir = (dir) => {
            try {
                localStorage.setItem(DOWNLOAD_DIR_KEY, dir);
            }
            catch {
                // A private-mode browser without storage only loses the memory.
            }
        };
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
            return h('select', { className: 'ap-input', value: props.value, onChange: (event) => props.onChange(event.target.value) }, props.platforms.map((key) => h('option', { key, value: key }, props.label(key))));
        }
        /**
         * 一个可折叠板块：标题是收放开关，`actions` 里的按钮不算（点刷新不会顺手合上）。
         * 收放状态跟着组件走，面板重渲染（state 刷新、任务日志轮询）不会把用户的收放弄丢。
         */
        function Section(props) {
            const t = props.t || ((key) => key);
            // 所有板块默认收起（只有显式 `open: true` 才展开），面板一进来是一排干净的标题。
            const [open, setOpen] = useState(props.open === true);
            return h('div', { className: props.className || 'ap-card' }, h('div', { className: 'ap-card-head' }, h('button', {
                type: 'button',
                className: `ap-fold${open ? ' ap-fold-open' : ''}`,
                onClick: () => setOpen(!open),
                'aria-expanded': open ? 'true' : 'false',
                title: open ? t('section.collapse') : t('section.expand'),
            }, h('span', { className: 'ap-fold-arrow' }, '▼'), h('span', { className: props.titleClass || 'ap-card-title' }, props.title)), props.actions), open ? props.children : null);
        }
        /** 已经跑了多久：0s / 42s / 3m07s。轮询每 1.2s 触发一次重渲染，这里跟着走。 */
        function clock(ms) {
            const seconds = Math.max(0, Math.round(ms / 1000));
            if (seconds < 60)
                return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
        }
        /** 最后一行非空输出 = 引擎正在干的活，用来在「运行中」旁边显示进度。 */
        function lastLine(output) {
            const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim());
            return lines.length > 0 ? lines[lines.length - 1].trim().slice(0, 90) : '';
        }
        function Panel(props) {
            const t = props.t || ((key) => key);
            const tf = useCallback((key, values) => {
                let text = t(key);
                for (const [name, value] of Object.entries(values || {}))
                    text = text.split(`{${name}}`).join(String(value));
                return text;
            }, [t]);
            const [state, setState] = useState(null);
            const [doctor, setDoctor] = useState(null);
            const [doctorError, setDoctorError] = useState('');
            const [job, setJob] = useState(null);
            const [error, setError] = useState('');
            const [busy, setBusy] = useState('');
            // 升级时宿主会先把旧版本关掉（撤路由）；这里拿到的就是那一刻的凭据：日志路径。
            const [closing, setClosing] = useState(null);
            const [platform, setPlatform] = useState('all');
            const [version, setVersion] = useState('');
            const [uploads, setUploads] = useState({});
            const [uploadSecret, setUploadSecret] = useState({});
            const [batchPlatforms, setBatchPlatforms] = useState(['all']);
            const [batchProjects, setBatchProjects] = useState({});
            const [harmonyDebug, setHarmonyDebug] = useState(false);
            const [keepWork, setKeepWork] = useState(false);
            const [fullPermission, setFullPermission] = useState(null);
            const [packageKind, setPackageKind] = useState('');
            // 微信小程序的上传内联在构建里：勾选才上传，取消只编译。
            const [mpWeixinUpload, setMpWeixinUpload] = useState(true);
            const [profileFile, setProfileFile] = useState('');
            const [overrides, setOverrides] = useState('');
            const [pendingRemove, setPendingRemove] = useState('');
            const [pendingCertClear, setPendingCertClear] = useState('');
            const [pendingCertFile, setPendingCertFile] = useState('');
            const [projectDir, setProjectDir] = useState('');
            const [certSourceDirs, setCertSourceDirs] = useState(() => readCertDirs());
            const [downloadDir, setDownloadDir] = useState(() => readDownloadDir());
            // 产物 key -> 已保存的绝对路径，下载成功后显示在那一行下面。
            const [downloads, setDownloads] = useState({});
            const logRef = useRef(null);
            const rootRef = useRef(null);
            const scrollHost = useRef(null);
            const rememberCertDirs = (dirs) => {
                setCertSourceDirs(dirs);
                try {
                    localStorage.setItem(CERT_DIRS_KEY, JSON.stringify(dirs));
                }
                catch {
                    /* 记不住也不影响用：只是「更新证书」按钮要先自己再选一次 */
                }
            };
            const guard = useCallback(async (key, work) => {
                setBusy(key);
                setError('');
                try {
                    return await work();
                }
                catch (failure) {
                    setError(String((failure && failure.message) || failure));
                    return undefined;
                }
                finally {
                    setBusy('');
                }
            }, []);
            // 旧版本关掉之后，state/job 接口全部 404；再拉只会把「已停用」刷成一屏红字。
            const closingRef = useRef(null);
            const refresh = useCallback(() => {
                if (closingRef.current)
                    return undefined;
                return guard('state', async () => setState(await call('state')));
            }, [guard]);
            useEffect(() => {
                refresh();
            }, [refresh]);
            const jobId = job && job.id;
            const jobRunning = Boolean(job && job.running);
            useEffect(() => {
                if (!jobId || !jobRunning)
                    return undefined;
                let alive = true;
                const timer = setInterval(async () => {
                    if (closingRef.current)
                        return;
                    try {
                        const next = await call(`job/log?id=${encodeURIComponent(jobId)}`);
                        if (alive)
                            setJob(next);
                    }
                    catch {
                        /* keep showing the last log; the host may be restarting */
                    }
                }, 1200);
                return () => {
                    alive = false;
                    clearInterval(timer);
                };
            }, [jobId, jobRunning]);
            // 客户端半边只活在面板组件里，宿主那半边（web.js 的 job runner）活在 DSH 进程里：
            // 切到别的标签再回来时本地 job 是 null，而引擎进程其实还在跑，界面就成了「什么都没有」。
            // 所以每次拿到 state 就从 state.jobs 认领最新的一条（日志、状态标签、停止按钮一起回来）。
            // 本标签自己起的任务优先：state 只在挂载和操作后拉一次，可能比本站的 job 旧。
            const latestJob = state && Array.isArray(state.jobs) ? state.jobs[0] : null;
            useEffect(() => {
                if (!latestJob)
                    return;
                setJob((current) => (current && current.running ? current : latestJob));
            }, [latestJob]);
            const output = job && job.output;
            useEffect(() => {
                const element = logRef.current;
                if (element)
                    element.scrollTop = element.scrollHeight;
            }, [output]);
            // 新任务一出现就把日志滚进视野：打包按钮在列表下方，日志在最底部，
            // 不滚一下用户会以为「点了没反应」。同一条任务只滚一次，免得轮询抖动。
            const seenJob = useRef('');
            useEffect(() => {
                const id = job && job.id;
                if (!id || id === seenJob.current)
                    return;
                seenJob.current = id;
                const element = logRef.current;
                if (element && typeof element.scrollIntoView === 'function')
                    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, [job && job.id]);
            // 宿主的 main 槽位把面板塞进哪个盒子里不归我们管：只要父链中间有一层 auto 高度，
            // `.ap-root { height: 100% }` 就解析成 auto，面板按内容撑高，底部被宿主的
            // overflow: hidden 裁掉、又没处可滚（用户看到的「上下不能滚动」）。
            // 挂载后量一次：自己滚得动就什么都不做；否则往上找最近的裁剪祖先，临时代它滚动，
            // 卸载时原样还原。每次渲染后重跑，等 state 到手、卡片长出来才真正判断得准。
            // ponytail: 只处理最近一层裁剪祖先，壳子里嵌套两层裁剪再加。
            useEffect(() => {
                if (scrollHost.current)
                    return;
                const root = rootRef.current;
                if (!root || typeof window === 'undefined')
                    return;
                if (root.scrollHeight > root.clientHeight + 1)
                    return;
                let node = root.parentElement;
                for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
                    const overflowY = window.getComputedStyle(node).overflowY;
                    if (overflowY === 'visible')
                        continue;
                    if (overflowY !== 'hidden' && overflowY !== 'clip')
                        return;
                    if (node.scrollHeight <= node.clientHeight + 1)
                        continue;
                    scrollHost.current = { node, overflowY: node.style.overflowY, minHeight: node.style.minHeight };
                    node.style.overflowY = 'auto';
                    node.style.minHeight = '0';
                    return;
                }
            });
            useEffect(() => () => {
                const applied = scrollHost.current;
                if (!applied)
                    return;
                scrollHost.current = null;
                applied.node.style.overflowY = applied.overflowY;
                applied.node.style.minHeight = applied.minHeight;
            }, []);
            const init = () => guard('init', async () => {
                await call('init', { method: 'POST', body: {} });
                await refresh();
            });
            // 进面板就把环境检查跑起来，用户不该盯着一句「加载中…」等一个没人发起的检查。
            // 手动点「开始检查」走 guard（占 busy、出错进横幅）；自动这一次不抢 busy，
            // 出错就写在卡片里，按钮还在原处可以重试。换平台会按新平台再检查一次。
            const runDoctor = (options = {}) => {
                const work = async () => {
                    setDoctorError('');
                    try {
                        setDoctor(await call('doctor', { method: 'POST', body: { platform } }));
                    }
                    catch (failure) {
                        setDoctor(null);
                        setDoctorError(String((failure && failure.message) || failure));
                    }
                };
                return options.silent ? work() : guard('doctor', work);
            };
            // 面板一准备好（state 到手）就自动查一次，别让用户对着一句「加载中…」干等；
            // 依赖用 Boolean(state) 这种基本值，免得每次 state 刷新都重跑一遍检查。
            useEffect(() => {
                if (!state)
                    return;
                runDoctor({ silent: true });
            }, [platform, Boolean(state)]);
            // Upload targets are whatever the engine declares in config/upload.env; the
            // ticked ones go to the engine as one comma separated `--upload <a,b>` when
            // building and `--to <a,b>` when re-sending an archived installer. 分发平台
            // 勾选只有一份 state：打包选项里决定「打包后顺手传哪些平台」，上传卡片里
            // 决定「单独上传时送给哪些平台」。
            const uploaders = (state && state.uploaders) || [];
            // Installers the engine already archived (`<home>/packages/<平台>/*-latest.json`).
            const artifacts = (state && state.artifacts) || [];
            const artifactKey = (item) => `${item.platform}-${item.projectId}`;
            const uploadTargets = () => uploaders.filter((item) => item.available && uploads[item.id] !== false).map((item) => item.id).join(',');
            const uploaderNote = (item) => {
                if (!item.enabled)
                    return t('options.uploader.disabled');
                if (!item.available)
                    return t('options.uploader.unimplemented');
                return item.platforms && item.platforms.length
                    ? tf('options.uploader.platforms', { platforms: item.platforms.map(onePlatform).join('/') })
                    : '';
            };
            const uploaderPicker = (label) => h('div', { style: styles.actions, key: `pick-${label}` }, h('span', { style: styles.muted }, t(label)), uploaders.length === 0
                ? h('span', { style: styles.muted }, t('upload.target.none'))
                : uploaders.map((item) => checkbox(`${item.name}${uploaderNote(item) ? ` · ${uploaderNote(item)}` : ''}`, item.available && uploads[item.id] !== false, (on) => setUploads({ ...uploads, [item.id]: on }), { disabled: !item.available, title: uploaderNote(item) || undefined })));
            // Uploaders that need a secret (pgyer's API key) get one row each: the
            // engine reads it from config/upload.local.env, and the panel only ever
            // learns whether one is set — the value never travels back to the browser.
            const credentialNote = (item) => {
                const notes = [];
                const cli = state && state.pgyerCli;
                if (item.id === 'pgyer' && cli) {
                    notes.push(cli.installed
                        ? tf('options.cred.cli.installed', { package: cli.package, version: cli.version ? ` v${cli.version}` : '' })
                        : t('options.cred.cli.missing'));
                }
                if (!item.credentialConfigured)
                    notes.push(t('options.cred.missing'));
                return notes.join(' · ');
            };
            // One row per secret: `apiKey` (required) and `userKey` (optional, pgyer's
            // API 1.0 uKey). Only the field the user typed into is written, so saving
            // one never clears the other.
            const credentialRow = (item, field) => {
                const slot = `${item.id}:${field}`;
                const configured = field === 'userKey' ? item.userKeyConfigured : item.credentialConfigured;
                // API Key 的词典键没有字段前缀（`options.cred.label`），User Key 才有。
                const keys = field === 'userKey'
                    ? { label: 'options.cred.userKey.label', saved: 'options.cred.userKey.placeholder.saved', empty: 'options.cred.userKey.placeholder.empty' }
                    : { label: 'options.cred.label', saved: 'options.cred.placeholder.saved', empty: 'options.cred.placeholder.empty' };
                return h('div', { className: 'ap-row', key: `cred-${slot}` }, h('span', { className: 'ap-row-label' }, tf(keys.label, { name: item.name })), h('div', { className: 'ap-row-value' }, h('div', { style: styles.actions }, h('input', {
                    className: 'ap-input',
                    type: 'password',
                    style: { flex: '1', minWidth: '220px' },
                    placeholder: t(configured ? keys.saved : keys.empty),
                    value: uploadSecret[slot] || '',
                    onChange: (event) => setUploadSecret({ ...uploadSecret, [slot]: event.target.value }),
                    onKeyDown: (event) => {
                        if (event.key === 'Enter')
                            saveCredential(item, field);
                    },
                }), button(t('options.cred.save'), () => saveCredential(item, field), { disabled: Boolean(busy), small: true }), h('span', { className: configured ? 'ap-tag ok' : 'ap-tag warn' }, t(configured ? 'options.cred.saved' : 'options.cred.unconfigured'))), h('div', { className: 'ap-note' }, field === 'userKey' ? t('options.cred.userKey.hint') : credentialNote(item))));
            };
            const saveCredential = (item, field = 'apiKey') => guard(`cred:${item.id}`, async () => {
                const slot = `${item.id}:${field}`;
                const payload = await call('upload/credential', {
                    method: 'POST',
                    body: field === 'userKey'
                        ? { provider: item.id, userKey: uploadSecret[slot] || '' }
                        : { provider: item.id, apiKey: uploadSecret[slot] || '' },
                });
                setUploadSecret({ ...uploadSecret, [slot]: '' });
                setState((current) => (current ? { ...current, uploaders: payload.uploaders } : current));
            });
            // Batch scope: platforms × projects become one engine run each, and no
            // project at all means every project that platform has enabled (`--all`).
            const effectivePlatforms = batchPlatforms.includes('all') ? ['all'] : batchPlatforms;
            const toggleBatchPlatform = (key) => {
                if (key === 'all')
                    return setBatchPlatforms(batchPlatforms.includes('all') ? [] : ['all']);
                const next = batchPlatforms.filter((item) => item !== 'all');
                setBatchPlatforms(next.includes(key) ? next.filter((item) => item !== key) : next.concat(key));
            };
            // 勾选框只对「所选平台启用」的项目生效：没启用的项目交给引擎只会被
            // `未启用 X 打包` 拒掉，一次批量里死一个项目会连带整批都打不了包。
            const projectEnabled = (project) => {
                const enabled = (project.enabledPlatforms || []).filter((key) => key !== 'all');
                return effectivePlatforms.some((key) => (key === 'all' ? enabled.length > 0 : enabled.includes(key)));
            };
            // 默认勾选跟着平台走（不启用的项目默认不打勾，免得一个项目拖死整批），
            // 但用户显式勾上的照发：缺工程时由引擎如实报错，面板不替用户做决定。
            const projectPicked = (project) => (batchProjects[project.id] === undefined
                ? projectEnabled(project)
                : batchProjects[project.id] === true);
            const pickedProjects = () => projects.filter(projectPicked).map((project) => project.id);
            const setAllProjects = (on) => setBatchProjects(Object.fromEntries(projects.map((project) => [project.id, on])));
            const runBatch = (kind) => startJob(kind, { platforms: effectivePlatforms, projects: pickedProjects() });
            // 打包与上传是两条流程：打包时勾了分发平台就打包完顺手传（引擎侧上传失败不影响
            // 打包结果），一个都没勾就明确 noUpload；上传卡片只送已归档的产物（`--to`）。
            const startJob = (kind, spec) => guard('job', async () => {
                const body = {
                    kind,
                    platforms: spec.platforms || [spec.platform],
                    projects: spec.projects || (spec.project ? [spec.project] : []),
                };
                const targets = uploadTargets();
                if (kind === 'upload') {
                    body.upload = spec.targets || targets;
                }
                else {
                    if (targets)
                        body.upload = targets;
                    else
                        body.noUpload = true;
                    body.version = version;
                    body.harmonyDebug = harmonyDebug;
                    body.keepWork = keepWork;
                    body.fullPermission = fullPermission;
                    body.packageKind = packageKind;
                    body.mpWeixinUpload = mpWeixinUpload;
                    body.profile = profileFile || undefined;
                    body.set = overrides;
                }
                setJob(await call('job', { method: 'POST', body }));
                refresh();
            });
            const startUpload = (item) => startJob('upload', { platforms: [item.platform], projects: [item.projectId], targets: uploadTargets() });
            const stopJob = () => guard('job', async () => setJob(await call(`job/kill?id=${encodeURIComponent(job.id)}`, { method: 'POST' })));
            // 清除 = 让宿主把已结束的任务从列表里删掉，本站跟着回到「暂无任务」。
            const clearJob = () => guard('job', async () => {
                await call('job/clear', { method: 'POST' });
                setJob(null);
            });
            // SDK setup and the plugin upgrade ride the same job route as a build, so
            // they stream their log into the one job card below.
            const startSdkJob = (spec) => guard('sdk', async () => {
                setJob(await call('job', { method: 'POST', body: { kind: 'sdk', ...spec } }));
                refresh();
            });
            // 宿主收到升级请求后先把旧版本关掉（停任务 + 撤路由），再把安装甩到后台，
            // 所以这次回包不是 job 而是「已关闭」：面板从此只显示日志路径，等重启。
            const upgradePlugin = () => guard('upgrade', async () => {
                const answer = await call('job', { method: 'POST', body: { kind: 'upgrade' } });
                if (answer && answer.closing) {
                    closingRef.current = answer;
                    setClosing(answer);
                    setJob(null);
                    return;
                }
                setJob(answer);
            });
            // Certificate import rides the same job route: the whole folder goes to the
            // engine's cert-import, which tells platforms apart by file extension, so the
            // panel never sorts files itself. The last folder is remembered so “update
            // certificates” is one click after a renewal.
            const pickCertDirs = () => guard('cert', async () => {
                const picked = await call('pick', { method: 'POST', body: { prompt: t('cert.pickPrompt') } });
                const paths = (picked && (picked.paths || (picked.path ? [picked.path] : []))) || [];
                if (paths.length === 0) {
                    if (picked && !picked.cancelled)
                        setError(`${t('projects.pickManual')}\n${picked.error || ''}`.trim());
                    return;
                }
                rememberCertDirs(paths);
                setJob(await call('job', { method: 'POST', body: { kind: 'cert', dirs: paths } }));
                refresh();
            });
            const updateCertificates = () => {
                const dirs = certSourceDirs;
                return guard('cert', async () => {
                    setJob(await call('job', { method: 'POST', body: { kind: 'cert', dirs } }));
                    refresh();
                });
            };
            const clearCertificates = (platform) => guard('cert', async () => {
                setPendingCertClear('');
                setJob(await call('job', { method: 'POST', body: { kind: 'cert', clear: platform } }));
                refresh();
            });
            // 平台下的每个证书文件一行，删除走引擎 cert-remove（归档到 certificate-history）。
            const certFileRows = (platform, value, pending, setPending, remove, disabled) => {
                const groups = [value.p12, value.profiles, value.keystores, value.properties, value.cer, value.p7b];
                const files = [];
                for (const group of groups) {
                    for (const entry of group || []) {
                        if (entry && entry.rel && !files.some((item) => item.rel === entry.rel))
                            files.push(entry);
                    }
                }
                if (files.length === 0)
                    return null;
                return files.map((entry) => {
                    const key = `${platform}:${entry.rel}`;
                    return h('div', { key, className: 'ap-kv', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, h('span', { style: { flex: '1', wordBreak: 'break-all' } }, entry.rel), pending === key
                        ? [
                            button(t('cert.file.confirm'), () => remove(platform, entry.rel), { disabled }),
                            button(t('cert.file.cancel'), () => setPending(''), { disabled: Boolean(busy) }),
                        ]
                        : button(t('cert.file.remove'), () => setPending(key), { disabled }));
                });
            };
            // 单文件删除和整平台清理走同一套归档规则，区别只在范围。
            const removeCertificateFile = (platform, rel) => guard('cert', async () => {
                setPendingCertFile('');
                setJob(await call('job', { method: 'POST', body: { kind: 'cert', platform, remove: rel } }));
                refresh();
            });
            // The host opens the OS folder dialog; a plain cancel is not an error, but a
            // missing picker falls back to typing the path by hand. Several folders are
            // joined into the one field (the engine splits on comma), so a folder holding
            // every project is normally the only thing worth picking.
            const pickDirectory = () => guard('pick', async () => {
                const picked = await call('pick', { method: 'POST', body: {} });
                const paths = (picked && (picked.paths || (picked.path ? [picked.path] : []))) || [];
                if (paths.length > 0)
                    setProjectDir(paths.join(', '));
                else if (picked && !picked.cancelled)
                    setError(`${t('projects.pickManual')}\n${picked.error || ''}`.trim());
            });
            // 已打完的包直接复制到统一配置的下载目录：浏览器写不了任意路径，所以拷贝
            // 在宿主做，面板只发「哪个产物 + 哪个目录」。同一个包重复下载不覆盖。
            const downloadArtifact = (item) => guard('download', async () => {
                const result = await call('download', {
                    method: 'POST',
                    body: { platform: item.platform, project: item.projectId, dir: downloadDir.trim() },
                });
                setDownloads({ ...downloads, [artifactKey(item)]: result.saved });
            });
            const pickDownloadDir = () => guard('download', async () => {
                const picked = await call('pick', { method: 'POST', body: { prompt: t('download.pickPrompt') } });
                const paths = (picked && (picked.paths || (picked.path ? [picked.path] : []))) || [];
                if (paths.length > 0) {
                    setDownloadDir(paths[0]);
                    rememberDownloadDir(paths[0]);
                }
                else if (picked && !picked.cancelled)
                    setError(`${t('projects.pickManual')}\n${picked.error || ''}`.trim());
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
            const button = (label, onClick, options = {}) => h('button', {
                type: 'button',
                className: `ap-btn${options.primary ? ' ap-btn-primary' : ''}${options.small ? ' ap-btn-sm' : ''}`,
                disabled: Boolean(options.disabled),
                onClick,
            }, label);
            // Label/value pairs are a two-column grid, so long paths wrap inside the
            // value column instead of shoving the label around.
            const row = (label, value, options = {}) => h('div', { className: 'ap-row' }, h('span', { className: 'ap-row-label' }, label), h('span', { className: `ap-row-value${options.mono ? ' ap-mono' : ''}`, title: options.title || undefined }, value));
            const checkbox = (label, checked, onChange, options = {}) => h('label', { className: 'ap-check', style: options.disabled ? { opacity: 0.5 } : undefined, title: options.title || undefined }, h('input', { type: 'checkbox', checked, disabled: Boolean(options.disabled), onChange: (event) => onChange(event.target.checked) }), label);
            const onePlatform = (key) => (key === 'all' ? t('platform.all') : key === 'harmony' ? 'HarmonyOS' : key === 'ios' ? 'iOS' : key === 'android' ? 'Android' : key === 'mp-weixin' ? t('platform.mpWeixin') : key);
            const platformLabel = (key) => String(key || '').split(',').filter(Boolean).map(onePlatform).join(' + ');
            const jobStatus = (value) => {
                if (!value)
                    return '';
                if (value.running)
                    return t('job.running');
                if (value.error === '已被取消')
                    return t('job.stopped');
                if (value.ok)
                    return t('job.ok');
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
                    if (match)
                        (match[1] === 'FAIL' ? failures : warnings).push(match[2]);
                }
                return { errorCount: failures.length, warningCount: warnings.length, failures, warnings };
            };
            const jobNotice = (value) => {
                const summary = value && (value.summary || summarizeLog(value.output));
                if (!summary || (!summary.errorCount && !summary.warningCount))
                    return null;
                const block = (box, title, lines) => h('div', { style: box }, h('div', { style: styles.problemTitle }, title), lines.slice(0, NOTICE_LINES).map((line, index) => h('div', { key: index }, `• ${line}`)), lines.length > NOTICE_LINES ? h('div', { style: styles.muted }, tf('job.more', { n: lines.length - NOTICE_LINES })) : null);
                return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, summary.errorCount
                    ? block(styles.error, tf('job.problems', { errors: summary.errorCount, warnings: summary.warningCount }), summary.failures || [])
                    : null, summary.warningCount ? block(styles.warn, tf('job.warnOnly', { warnings: summary.warningCount }), summary.warnings || []) : null);
            };
            const header = h('div', { className: 'ap-head' }, h('span', { className: 'ap-title' }, t('title')), h('span', { className: 'ap-sub' }, t('subtitle')), state ? h('span', { className: 'ap-path', title: state.home }, `${state.engineVersion} · ${state.home}`) : null, button(state ? t('refresh') : t('loading'), refresh, { disabled: !state || Boolean(busy) }), button(t('init'), init, { disabled: busy === 'init' }));
            const engineCard = !state ? null : h(Section, { t, title: t('engine') }, row(t('engine.home'), state.home, { mono: true, title: state.home }), row(t('engine.version'), state.engineVersion), row(t('engine.location'), state.plugin && state.plugin.root && String(state.home).startsWith(state.plugin.root)
                ? t('engine.location.plugin')
                : t('engine.location.other')), row(t('engine.status'), !state.materialized
                ? t('engine.missing')
                : state.engineDrift
                    ? t('engine.stale', { home: state.homeVersion || '—' })
                    : t('engine.ready')), row(t('engine.shell'), 
            // 宿主半给的形状是 `{available, shell: {kind, command}}`；以前这里读的是
            // 外层的 `kind`，界面上就出现了「undefined · /bin/bash」。
            state.shell && state.shell.available && state.shell.shell
                ? `${state.shell.shell.kind}${state.shell.shell.command ? ` · ${state.shell.shell.command}` : ''}`
                : t('engine.shell.none'), { mono: true }), state.shell && state.shell.available ? null : h('div', { className: 'ap-note' }, state.shell && state.shell.error));
            const doctorCard = h(Section, {
                t,
                title: t('doctor'),
                actions: h('div', { style: styles.actions }, h(PlateformSelect, { value: platform, platforms: PLATFORMS, onChange: setPlatform, label: platformLabel }), button(t('doctor.run'), runDoctor, { disabled: Boolean(busy) })),
            }, doctor
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, doctor.checks.map((check) => h('div', { key: check.id, className: 'ap-check-row' }, h('span', { className: 'ap-mark', style: { color: markColor(check.status) } }, mark(check.status)), h('span', null, `${check.label}${check.detail ? ` — ${check.detail}` : ''}`), check.hint ? h('div', { className: 'ap-check-hint' }, `→ ${check.hint}`) : null)), h('div', { className: 'ap-muted' }, doctor.ok ? t('doctor.ok') : tf('doctor.bad', { failures: doctor.failures, warnings: doctor.warnings })))
                : h('div', { className: 'ap-muted' }, doctorError || t('loading')));
            // SDK setup: the engine recommends the download entry per platform from the
            // local HBuilderX version, and the same `sdk install` call performs it.
            // 这些派生值必须在使用它们的卡片之前声明：卡片是立刻求值的 const，
            // 放到后面就是 TDZ（`Cannot access 'hb' before initialization`），
            // state 一到就整块面板崩成白屏。
            const sdkInfo = (state && state.sdk) || null;
            const sdkList = (sdkInfo && sdkInfo.platforms) || [];
            const hb = (sdkInfo && sdkInfo.hbuilderx) || null;
            const sdkMark = (item) => (item.state === 'ready' ? 'ok' : item.state === 'mismatch' ? 'warn' : 'fail');
            const sdkStateText = (item) => (item.state === 'ready'
                ? t('sdk.ready')
                : item.state === 'mismatch'
                    ? tf('sdk.mismatch', { series: item.series })
                    : t('sdk.missing'));
            const sdkCard = !state ? null : h(Section, {
                t,
                title: t('sdk'),
                actions: h('div', { style: styles.actions }, button(t('sdk.installAll'), () => startSdkJob({ platforms: ['ios', 'android', 'harmony'] }), { disabled: Boolean(busy) || jobRunning }), button(t('sdk.process'), () => startSdkJob({ processOnly: true }), { disabled: Boolean(busy) || jobRunning }), state.canUpgrade ? button(t('upgrade.run'), upgradePlugin, { disabled: Boolean(busy) || jobRunning }) : null),
            }, state.sdkError ? h('div', { className: 'ap-box-error' }, state.sdkError) : null, h('div', { className: 'ap-note' }, t('sdk.hint')), hb && hb.found
                ? row(t('sdk.hbuilderx'), `${hb.version || '?'} · ${t('sdk.series')} ${hb.series || '?'}`, { mono: true })
                : h('div', { className: 'ap-box-warn' }, t('sdk.hbuilderx.none')), sdkInfo ? row(t('sdk.root'), sdkInfo.sdkRoot, { mono: true, title: sdkInfo.sdkRoot }) : null, 
            // 每个平台一块：头一行是状态 + 操作，长包名/目录折在下面，别把按钮挤成竖排。
            sdkList.map((item, index) => h('div', { key: item.id, className: `ap-sdk${index === 0 ? ' ap-sdk-first' : ''}` }, h('div', { className: 'ap-sdk-head' }, h('span', { className: 'ap-mark', style: { color: markColor(sdkMark(item)) } }, mark(sdkMark(item))), h('span', { className: 'ap-sdk-name' }, item.label), h('span', { className: `ap-tag ${sdkMark(item)}` }, sdkStateText(item)), button(t('sdk.install'), () => startSdkJob({ platforms: [item.id] }), { disabled: Boolean(busy) || jobRunning, small: true }), h('a', { href: item.page, target: '_blank', rel: 'noreferrer', className: 'ap-link' }, t('sdk.page')), item.direct ? h('a', { href: item.direct, target: '_blank', rel: 'noreferrer', className: 'ap-link' }, t('sdk.direct')) : null), h('div', { className: 'ap-sdk-detail' }, 
            // 手动下载时要照着找哪个包：Android 的文件名带构建号，HarmonyOS 的「包名」是 ohpm 包
            // （npm 上查不到，标签单独写），与 `sdk urls` 打印的是同一个 package 字段。
            item.package ? h('div', { className: 'ap-kv' }, `${t(item.id === 'harmony' ? 'sdk.package.ohpm' : 'sdk.package')}: ${item.package}`) : null, h('div', { className: 'ap-kv' }, `${t('sdk.dir')}: ${item.dir}`)))), sdkInfo && sdkInfo.archives && sdkInfo.archives.length
                ? h('div', { className: 'ap-note' }, tf('sdk.archives', { n: sdkInfo.archives.length }))
                : null, sdkInfo && sdkInfo.incompleteDownloads
                ? h('div', { className: 'ap-box-warn' }, tf('sdk.incomplete', { n: sdkInfo.incompleteDownloads }))
                : null, h('div', { className: 'ap-note' }, t('sdk.manual')), h('div', { className: 'ap-note' }, state.canUpgrade ? t('upgrade.hint') : t('upgrade.unavailable')));
            // 证书板块：三平台状态直接来自引擎 cert-status（与打包前 check 用的是同一批
            // 判定函数），所以面板不会出现「面板说就绪、打包却报缺证书」。
            const certs = (state && state.certificates) || null;
            const certPlatforms = certs ? certs.platforms : null;
            const certDirs = certs ? certs.dirs : null;
            const certNames = { ios: 'iOS', android: 'Android', harmony: 'HarmonyOS' };
            const certCounts = (id, value) => (id === 'ios'
                ? tf('cert.ios.files', { p12: value.p12.length, profiles: value.profiles.length })
                : id === 'android'
                    ? tf('cert.android.files', { keys: value.keystores.length, properties: value.properties.length })
                    : tf('cert.harmony.files', { p12: value.p12.length, cer: value.cer.length, p7b: value.p7b.length }));
            const certHasFiles = (id, value) => (id === 'ios'
                ? value.p12.length + value.profiles.length > 0
                : id === 'android'
                    ? value.keystores.length + value.properties.length > 0
                    : value.p12.length + value.cer.length + value.p7b.length > 0);
            const certCard = !state ? null : h(Section, {
                t,
                title: t('cert'),
                actions: h('div', { style: styles.actions }, button(t('cert.import'), pickCertDirs, { disabled: Boolean(busy) || jobRunning }), button(t('cert.reimport'), updateCertificates, { disabled: Boolean(busy) || jobRunning || certSourceDirs.length === 0 })),
            }, state.certificatesError ? h('div', { className: 'ap-box-error' }, state.certificatesError) : null, h('div', { className: 'ap-note' }, t('cert.hint')), pendingCertClear || pendingCertFile ? h('div', { className: 'ap-note' }, t('cert.clear.hint')) : null, certPlatforms
                ? ['ios', 'android', 'harmony'].map((id) => {
                    const value = certPlatforms[id];
                    return h('div', { key: id, className: 'ap-sdk' }, h('div', { className: 'ap-sdk-head' }, h('span', { className: 'ap-mark', style: { color: markColor(value.ready ? 'ok' : 'fail') } }, mark(value.ready ? 'ok' : 'fail')), h('span', { className: 'ap-sdk-name' }, certNames[id]), h('span', { className: `ap-tag ${value.ready ? 'ok' : 'fail'}` }, value.ready ? t('cert.ready') : t('cert.missing')), h('a', { href: certs.docs[id], target: '_blank', rel: 'noreferrer', className: 'ap-link' }, t('cert.docs')), certHasFiles(id, value)
                        ? h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: '6px' } }, pendingCertClear === id
                            ? [
                                button(t('cert.clear.confirm'), () => clearCertificates(id), { disabled: Boolean(busy) || jobRunning }),
                                button(t('cert.clear.cancel'), () => setPendingCertClear(''), { disabled: Boolean(busy) }),
                            ]
                            : button(t('cert.clear'), () => setPendingCertClear(id), { disabled: Boolean(busy) || jobRunning }))
                        : null), h('div', { className: 'ap-sdk-detail' }, h('div', { className: 'ap-kv' }, certCounts(id, value)), certFileRows(id, value, pendingCertFile, (key) => setPendingCertFile(key), removeCertificateFile, Boolean(busy) || jobRunning), 
                    // iOS 的描述文件把 bundle id 与到期日摆出来：这两个值决定能不能对上项目，
                    // 也是证书过期时唯一看得见的信号（引擎 profiles 子命令解析出来的）。
                    id === 'ios'
                        ? value.details.map((profile) => h('div', { key: profile.file, className: 'ap-kv' }, `${tf('cert.profileLine', {
                            name: profile.name || profile.file,
                            kind: profile.kind,
                            bundle: profile.bundleId,
                            expiry: profile.expiry,
                        })}${profile.expired ? ` · ${t('cert.profileExpired')}` : ''}`))
                        : null));
                })
                : null, certDirs ? row(t('cert.dir'), certDirs.ios.replace(/[\\/][^\\/]*$/, ''), { mono: true }) : null, certSourceDirs.length
                ? h('div', { className: 'ap-note' }, tf('cert.imported', { dir: certSourceDirs.join(', ') }))
                : h('div', { className: 'ap-note' }, t('cert.none')));
            const projects = (state && state.projects) || [];
            const profiles = (state && state.profiles) || [];
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
                if (withKind.length === 0)
                    return false;
                const bundles = scopedProjects().map((project) => project.bundleId).filter(Boolean);
                return bundles.length === 0 || withKind.some((profile) => bundles.includes(profile.bundleId));
            };
            const profileLabel = (profile) => `${profile.name || profile.file} · ${prettyKind(profile.kind)} · ${profile.bundleId}${profile.expired ? ` · ${t('options.profile.expired')}` : ''}`;
            const presetOptions = () => {
                const out = [];
                for (const project of scopedProjects()) {
                    const presets = (state && state.presets && state.presets[project.id]) || {};
                    for (const name of Object.keys(presets))
                        out.push({ key: `${project.id}/${name}`, text: presets[name] });
                }
                return out;
            };
            const applyPreset = (key) => {
                const found = presetOptions().find((item) => item.key === key);
                if (found)
                    setOverrides(presetLines(found.text, overrideKeys).join('\n'));
            };
            const projectsCard = h(Section, {
                t,
                title: `${t('projects')}（${projects.length}）`,
                actions: h('div', { style: styles.actions }, button(t('refresh'), refresh, { disabled: !state || Boolean(busy) })),
            }, h('div', { style: styles.actions }, h('span', { style: styles.muted }, t('projects.dir')), h('input', {
                className: 'ap-input',
                style: { flex: '1', minWidth: '220px' },
                placeholder: t('projects.dirMulti'),
                title: t('projects.dirHint'),
                value: projectDir,
                onChange: (event) => setProjectDir(event.target.value),
            }), button(t('projects.pick'), pickDirectory, { disabled: Boolean(busy) }), button(t('projects.add'), addProject, { primary: true, disabled: Boolean(busy) || !projectDir.trim() })), state && state.projectsError ? h('div', { style: styles.error }, state.projectsError) : null, projects.length === 0 ? null : h('div', { style: styles.muted }, t('projects.remove.hint')), projects.length === 0
                ? h('div', { style: styles.muted }, t('projects.empty'))
                : projects.map((project) => {
                    const enabled = project.enabledPlatforms && project.enabledPlatforms.length ? project.enabledPlatforms : ['ios', 'android', 'harmony'];
                    return h('div', { key: project.id, className: 'ap-project' }, h('div', { className: 'ap-card-head' }, h('span', { className: 'ap-project-name' }, project.appName || project.id), project.appName ? h('span', { className: 'ap-muted' }, project.id) : null, h('span', { style: { flex: 1 } }), pendingRemove === project.id
                        ? h('span', { style: styles.actions }, button(t('projects.remove.confirm'), () => removeProject(project.id), { disabled: Boolean(busy) }), button(t('projects.remove.cancel'), () => setPendingRemove(''), { disabled: Boolean(busy) }))
                        : button(t('projects.remove'), () => setPendingRemove(project.id), { disabled: Boolean(busy) })), h('div', { className: 'ap-note' }, `${project.sourceDir || t('projects.sourceMissing')}${project.sourceDir && !project.sourceDirExists ? ` — ${t('projects.sourceGone')}` : ''}`), h('div', { className: 'ap-note' }, `${t('platforms')}: ${enabled.map(platformLabel).join(' / ')}`), project.error ? h('div', { className: 'ap-box-error' }, project.error) : null);
                }));
            // 打包选项只放打包本身的东西：上传目标与密钥都在下面的「上传」板块。
            // 打包选项与打包范围是同一件事的两半（怎么打 / 打哪些），合成一张卡片：
            // 上半是参数，下半是范围与「环境检查 / 打包」按钮。范围仍旧框成一块，视觉上分得清。
            const optionsCard = h(Section, { t, title: `${t('options')} · ${t('scope')}` }, h('div', { style: styles.actions }, h('input', {
                className: 'ap-input',
                style: { width: '120px' },
                placeholder: t('options.version'),
                value: version,
                onChange: (event) => setVersion(event.target.value),
            }), h('select', {
                className: 'ap-input',
                style: { width: 'auto' },
                title: t('options.kind.hint'),
                value: packageKind,
                onChange: (event) => setPackageKind(event.target.value),
            }, h('option', { value: '' }, `${t('options.kind')}：${t('options.kind.auto')}`), PACKAGE_KINDS.map((kind) => h('option', { key: kind, value: kind, disabled: !kindAvailable(kind), title: tf('options.kind.missing', { kind: prettyKind(kind) }) }, prettyKind(kind)))), h('select', {
                className: 'ap-input',
                style: { width: 'auto', maxWidth: '320px' },
                title: profilesNote,
                value: profileFile,
                onChange: (event) => setProfileFile(event.target.value),
            }, h('option', { value: '' }, `${t('options.profile')}：${t('options.profile.auto')}`), profiles.map((profile) => h('option', { key: profile.file, value: profile.file }, profileLabel(profile)))), checkbox(t('options.fullPermission'), fullPermissionOn, setFullPermission, { title: t('options.fullPermission.hint') }), 
            // 小程序上传内联在构建里，只有选中 mp-weixin 时才出现这个开关。
            batchPlatforms.includes('mp-weixin')
                ? checkbox(t('options.mpWeixinUpload'), mpWeixinUpload, setMpWeixinUpload, { title: t('options.mpWeixinUpload.hint') })
                : null, h('details', { style: styles.advanced }, h('summary', null, t('advanced')), h('div', { style: { ...styles.actions, marginTop: '6px' } }, checkbox(t('options.harmonyDebug'), harmonyDebug, setHarmonyDebug, { title: t('options.harmonyDebug.hint') }), checkbox(t('options.keepWork'), keepWork, setKeepWork, { title: t('options.keepWork.hint') })), h('div', { style: { marginTop: '6px' } }, h('div', { style: styles.actions }, h('span', { style: styles.muted }, t('options.overrides')), presetOptions().length === 0
                ? h('span', { style: styles.muted }, t('options.overrides.presets.none'))
                : h('select', { className: 'ap-input', style: { width: 'auto' }, value: '', onChange: (event) => applyPreset(event.target.value) }, h('option', { value: '' }, t('options.overrides.preset')), presetOptions().map((item) => h('option', { key: item.key, value: item.key }, item.key)))), h('textarea', {
                className: 'ap-input',
                style: { width: '100%', minHeight: '56px', marginTop: '4px' },
                placeholder: t('options.overrides.hint'),
                value: overrides,
                onChange: (event) => setOverrides(event.target.value),
            })))), h('div', { style: { marginTop: '6px' } }, uploaderPicker('options.uploadAfterBuild'), h('div', { className: 'ap-note' }, t('options.uploadAfterBuild.hint'))), h('div', { className: 'ap-scope', style: { marginTop: '10px' } }, h('div', { style: styles.actions }, h('span', { style: styles.muted }, t('scope.platforms')), ['all', 'ios', 'android', 'harmony', 'mp-weixin'].map((key) => checkbox(onePlatform(key), batchPlatforms.includes(key), () => toggleBatchPlatform(key)))), projects.length === 0 ? null : h('div', { style: styles.actions }, h('span', { style: styles.muted }, t('scope.projects')), button(t('scope.all'), () => setAllProjects(true), { disabled: Boolean(busy) }), projects.map((project) => checkbox(project.appName || project.id, projectPicked(project), (on) => setBatchProjects({ ...batchProjects, [project.id]: on }), projectEnabled(project) ? {} : { title: t('scope.projectOff') }))), h('div', { style: styles.actions }, button(t('check'), () => runBatch('check'), { disabled: Boolean(busy) || jobRunning || effectivePlatforms.length === 0 }), button(t('build'), () => runBatch('build'), { primary: true, disabled: Boolean(busy) || jobRunning || effectivePlatforms.length === 0 }), effectivePlatforms.length === 0 ? h('span', { style: styles.muted }, t('scope.nonePicked')) : null), h('div', { className: 'ap-note' }, t('scope.hint'))));
            // 上传是独立流程：这里列出引擎已归档的安装包（packages/<平台>/*-latest.json），
            // 一行一个产物、一键单独上传，不会重新打包。
            const fileSize = (bytes) => (bytes >= 1024 * 1024
                ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
                : `${Math.max(1, Math.round(bytes / 1024))} KB`);
            const uploadCard = h(Section, { t, title: `${t('upload')} · ${t('download.action')}`, actions: h('span', { style: styles.muted }, t('upload.hint')) }, artifacts.length === 0
                ? h('div', { className: 'ap-note' }, t('upload.empty'))
                : h('div', null, artifacts.map((item) => h('div', { className: 'ap-row', key: `artifact-${item.platform}-${item.projectId}` }, h('span', { className: 'ap-row-label' }, onePlatform(item.platform)), h('div', { className: 'ap-row-value' }, h('div', { style: styles.actions }, h('span', { className: 'ap-project-name' }, `${item.displayName}${item.version ? ` ${item.version}` : ''}`), item.isDirectory && !item.artifactExists
                    ? h('span', { className: 'ap-tag warn' }, t('upload.missing'))
                    : item.isDirectory
                        ? h('span', { className: 'ap-tag' }, item.uploaded ? t('upload.mpUploaded') : t('upload.mpCompiled'))
                        : item.artifactExists
                            ? h('span', { className: 'ap-muted' }, fileSize(item.artifactSize))
                            : h('span', { className: 'ap-tag warn' }, t('upload.missing')), item.builtAt ? h('span', { className: 'ap-muted' }, tf('upload.builtAt', { time: item.builtAt })) : null, 
                // 小程序是目录、也没有独立的上传器：上传已在构建里完成，
                // 这两个按钮对它没有意义，所以只展示状态和路径。
                item.isDirectory
                    ? null
                    : button(t('download.action'), () => downloadArtifact(item), {
                        small: true,
                        disabled: Boolean(busy) || jobRunning || !item.artifactExists,
                    }), item.isDirectory
                    ? null
                    : button(t('upload.action'), () => startUpload(item), {
                        primary: true,
                        small: true,
                        disabled: Boolean(busy) || jobRunning || !item.artifactExists || uploadTargets() === '',
                    })), h('div', { className: 'ap-note' }, item.artifactPath), item.isDirectory ? h('div', { className: 'ap-note' }, t('upload.mpDir')) : null, downloads[artifactKey(item)]
                    ? h('div', { className: 'ap-note' }, tf('download.done', { path: downloads[artifactKey(item)] }))
                    : null)))), h('div', { style: styles.actions }, h('span', { style: styles.muted }, t('download.dir')), h('input', {
                className: 'ap-input',
                style: { flex: '1', minWidth: '220px' },
                placeholder: tf('download.placeholder', { dir: (state && state.downloadDir) || '' }),
                value: downloadDir,
                onChange: (event) => {
                    setDownloadDir(event.target.value);
                    rememberDownloadDir(event.target.value);
                },
            }), button(t('download.pick'), pickDownloadDir, { disabled: Boolean(busy) })), h('div', { className: 'ap-note' }, t('download.hint')), uploaderPicker('upload.target'), uploaders.filter((item) => item.apiKeyVar).map((item) => credentialRow(item, 'apiKey')), uploaders.filter((item) => item.userKeyVar).map((item) => credentialRow(item, 'userKey')));
            const jobCard = h(Section, {
                t,
                title: t('job'),
                actions: h('div', { style: styles.actions }, job ? h('span', { className: 'ap-muted' }, `${t(`job.kind.${job.kind}`)} · ${platformLabel(job.platform)}${job.project ? ` · ${job.project}` : ''}`) : null, job ? h('span', { className: `ap-tag ${job.running ? 'warn' : job.ok ? 'ok' : 'fail'}` }, jobStatus(job)) : null, jobRunning ? button(t('job.stop'), stopJob, { disabled: Boolean(busy) }) : null, job && !jobRunning ? button(t('job.clear'), clearJob, { disabled: Boolean(busy), small: true }) : null),
            }, job && job.blockedByCheck ? h('div', { style: styles.error }, t('job.blockedByCheck')) : null, jobRunning
                ? h('div', { className: 'ap-note' }, tf('job.progress', {
                    time: job.startedAt ? clock(Date.now() - job.startedAt) : '0s',
                    line: lastLine(job.output) || t('job.waiting'),
                }))
                : null, job && job.error && job.error !== '已被取消' ? h('div', { style: styles.error }, job.error) : null, 
            // 升级换掉的正是宿主里那个插件条目。DSH 的客户端模块是按 rev 取的，而页面里
            // 存的 rev 来自启动时那份清单：升级后刷新页面，浏览器会拿着旧 rev 去要模块，
            // 服务端只会 404（实测：旧 rev → 404，当前 rev → 200），客户端这一半加载失败，
            // 侧栏入口就消失了 —— 只有重启 DSH 才会重新出清单。所以这里只提示重启，
            // 不给「刷新页面」按钮。
            job && job.kind === 'upgrade' && !job.running && job.ok
                ? h('div', { style: styles.warn }, t('upgrade.after'))
                : null, jobNotice(job), job && job.dropped ? h('div', { className: 'ap-note' }, tf('job.dropped', { n: job.dropped })) : null, job
                ? h('pre', { ref: logRef, className: 'ap-log' }, job.output || t('job.waiting'))
                : h('div', { className: 'ap-note' }, t('job.none')));
            return h('div', { className: 'ap-root', ref: rootRef }, header, error ? h('div', { style: styles.error }, `${t('error')}: ${error}`) : null, closing ? h('div', { style: styles.warn }, tf('upgrade.closing', { log: closing.log || '' })) : null, engineCard, doctorCard, sdkCard, certCard, projectsCard, optionsCard, uploadCard, jobCard);
        }
        function PanelIcon() {
            return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, 
            // 和应用图标同一个剪影：等距包裹。18px 下顶面镶箭头会糊成一团，只留顶面淡填充，
            // 让它读作「一个包裹」而不是普通方块；线宽 1.7 与侧栏其它行一致。
            h('path', { d: 'M12 2.8 20.8 7.6 12 12.4 3.2 7.6Z', fill: 'currentColor', fillOpacity: 0.1, stroke: 'none' }), h('path', { d: 'M12 2.8 20.8 7.6v8.8L12 21.2 3.2 16.4V7.6Z' }), h('path', { d: 'M3.2 7.6 12 12.4l8.8-4.8' }), h('path', { d: 'M12 12.4v8.8' }));
        }
        function apply(ctx) {
            installStyles();
            ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
            const t = ctx.locale.bind(NS);
            const disposers = [];
            disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label'), locale: NS, inject: () => ({ t }) }, PanelIcon)));
            disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t }) }, Panel)));
            ctx.effect(() => () => {
                for (const dispose of disposers.splice(0))
                    dispose && dispose();
            }, `${NS}: panel slots`);
        }
        exports.name = name;
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
    },
});
