/**
 * dsh-plugin-git — session header actions and an overlay Git workbench.
 * The UI uses host theme tokens and optional host syntax highlighting.
 * Repository access goes through the host RPC; destructive actions require confirmation.
 */
window.__ModuleLoader__.load({
  id: '@happyqu/dsh-plugin-git',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var ReactMod = require('react')
    // Interop: React's CJS export carries createElement directly, an ESM
    // namespace puts it on .default.
    var React = ReactMod && ReactMod.createElement ? ReactMod : ReactMod.default
    var ReactDOM = require('react-dom')
    var h = React.createElement
    var Fragment = React.Fragment

    /**
     * DSH's own syntax highlighter, for the file preview.
     *
     * `@deepseek-ai/dsh-client-ui-primitives` is part of the shell's frozen
     * platform module table and exposes `useCodeHighlighter` — a Shiki core
     * instance whose `css-variables` theme reads the `--shiki-*` custom
     * properties the theme package defines. Delegating to it means the Git
     * panel colours code exactly like the rest of the app (light and dark), and
     * inherits every grammar DSH ships instead of a hand-rolled subset.
     *
     * The require is deliberately best-effort. A profile whose composition
     * lacks the primitives package must still render files — as plain text —
     * rather than fail to activate at all.
     */
    var codePrimitives = null
    try {
      codePrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (error) {
      codePrimitives = null
    }

    /** Endpoint name and channel, matching the Host registration. */
    var RPC_ENDPOINT = 'git'
    var RPC_CHANNEL = '/api'

    /** Dictionary namespace owned by this plugin. */
    var NS = 'gitPlugin'

    /* ------------------------------------------------------------------ *
     * Dictionaries
     * ------------------------------------------------------------------ */

    var zh = {
      'panel.title': 'Git',
      'sidebar.label': 'Git 工作台',
      'tab.changes': '改动',
      'tab.history': '历史',
      'tab.graph': '提交图',
      'tab.compare': '比较',
      'tab.settings': '设置',
      // The activity bar's sidebar headers. Separate from the tab labels because
      // a switcher needs a one-word name while a panel header reads better as a
      // phrase ("提交历史" over a list of commits).
      'sidebar.changes': '改动',
      'sidebar.history': '提交历史',
      'sidebar.graph': '提交图',
      'sidebar.compare': '比较',
      'sidebar.output': '输出',
      'sidebar.settings': '设置',
      'state.noCommitSelected': '从左侧选择一个提交查看它的改动。',
      'graph.lanesLabel': '泳道',
      'graph.tips': '分支 / 标签',
      'label.commits': '提交数',
      'compare.pickHint': '点下面的分支或标签，把它填进「基准」。',
      'compare.idleHint': '选好两个引用后点「比较」，差异会显示在这里。',
      'compare.back': '返回',
      'compare.from': '基准分支或提交',
      'compare.to': '目标分支或提交',
      'compare.swap': '交换比较方向',
      'compare.commits': '两端独有的提交（最多 100 条）',
      'output.filterAll': '全部命令',
      'output.filterFailed': '仅失败',
      'output.noFailures': '没有失败的命令。',
      'settings.general': '常规',
      'settings.ai': 'AI 助手',
      'settings.diagnostics': '诊断',
      'tree.branches': '分支',
      'tree.tags': '标签',
      'tree.remotes': '远端',
      'tree.stashes': '储藏',
      'tab.stashes': '储藏',
      'sidebar.stashes': '储藏',
      'list.searchFiles': '搜索文件',
      'list.searchStashes': '搜索储藏说明或分支',
      'list.noMatches': '没有匹配项',
      'diff.fileList': '文件列表',
      'diff.fileTree': '目录树',
      'diff.copyPath': '复制文件路径',
      'diff.copied': '已复制',
      'diff.copyFailed': '复制失败，请重试',
      'stash.applyHint': '恢复改动，保留储藏记录',
      'stash.popHint': '恢复成功后移除储藏记录',
      'stash.dropHint': '永久删除这条储藏',
      'stash.applyShort': '应用',
      'stash.popShort': '应用并删除',
      'stash.dropShort': '删除',
      'stash.retry': '重试',
      'stash.noEligible': '当前只有未跟踪文件，请勾选包含未跟踪文件',
      'stash.create': '储藏当前改动',
      'stash.includeUntracked': '包含未跟踪文件',
      'stash.select': '选择一条储藏查看改动',
      'stash.view': '查看储藏',
      'stash.created': '已储藏改动',
      'stash.loadFailed': '加载储藏失败：{message}',
      'stash.dropConfirm': '确认删除 {ref}「{message}」？删除后无法恢复。',
      'stash.applyConfirm': '确认应用 {ref}「{message}」？改动将恢复到工作区，储藏记录会保留；如有冲突，需要手动解决。',
      'history.loadFailed': '加载提交历史失败：{message}',
      'history.detailFailed': '加载提交失败：{message}',
      'stash.popConfirm': '确认应用并删除 {ref}「{message}」？改动将恢复到工作区，成功后删除储藏记录；如有冲突，记录会保留。',
      'stash.allFiles': '全部文件',
      'stash.applied': '已应用储藏，记录已保留',
      'stash.popped': '已应用并删除储藏',
      'stash.deleted': '已删除储藏',
      'tree.commits': '提交记录',
      'tree.repositories': '仓库',
      'state.noStashes': '没有储藏记录',
      'tree.worktrees': '工作树',
      'tree.contributors': '贡献者',
      'tree.changes': '更改',
      'tree.files': '文件',
      'action.compareWith': '与当前工作区比较',
      'action.openRepo': '打开仓库…',
      'action.closeRepo': '关闭仓库',
      'action.copyPath': '复制路径',
      'action.revealInFolder': '在文件管理器中显示',
      'meta.lastFetched': '最近 Fetch：{time}',
      'meta.neverFetched': '尚未 Fetch',
      'meta.commits': '{count} 个提交',
      'meta.user': '身份：{name}',
      'window.open': '打开 Git 窗口',
      'window.close': '关闭窗口',
      'window.focus': '切换简易/完整窗口',
      'window.simple': '简易窗口',
      'window.full': '完整窗口',
      'window.staged': '{count} 已暂存',
      'commit.pushAfter': '提交后推送到远端',
      'commit.pullBeforePush': '推送前先拉取（同步）',
      'window.unstaged': '{count} 未暂存',
      'window.minimize': '最小化',
      'window.maximize': '放大 Git 窗口',
      'window.restore': '还原 Git 窗口',
      'window.fileMaximize': '最大化文件窗口',
      'window.fileRestore': '还原文件窗口',
      'window.dragHint': '按住标题栏可拖动窗口',
      'window.resizeHint': '拖动此处调整窗口大小',
      'action.refresh': '刷新',
      'action.sync': '同步',
      'action.stage': '暂存',
      'action.unstage': '取消暂存',
      'action.commit': '提交',
      'action.generateMessage': 'AI 生成提交信息',
      'commit.generateShort': 'AI 生成',
      'action.fetch': 'Fetch',
      'action.pull': 'Pull',
      'action.push': 'Push',
      'action.clone': 'Clone',
      'action.checkout': 'Checkout',
      'action.newBranch': '新建分支',
      'action.switchBranch': '切换分支',
      'label.startPoint': '起点',
      'label.startPointHead': 'HEAD（当前提交）',
      'state.noBranches': '没有可用的分支',
      'confirm.switchBranch': '切换到 {name}？未提交的改动可能丢失。',
      'confirm.remoteBranchExists': '本地已有 {name}，直接切换过去？',
      'action.renameBranch': '重命名当前分支',
      'action.deleteBranch': '删除分支',
      'action.merge': '合并到当前分支',
      'merge.open': '合并…',
      'merge.pick': '选择要合入的分支',
      'merge.search': '搜索本地或远端分支…',
      'merge.direction': '将 {source} 合入 {target}',
      'merge.incoming': '来源分支独有的提交',
      'merge.outgoing': '当前分支独有的提交',
      'merge.moreCommits': '仅显示前 20 条',
      'merge.noCommits': '没有独有的提交',
      'merge.already': '来源分支没有需要合入的提交。',
      'merge.loading': '正在检查两个分支…',
      'merge.fetching': '正在获取所选远端分支的最新提交…',
      'merge.remoteFlow': '预览使用本地保存的远端记录，可手动获取最新提交。',
      'merge.fetchLatest': '获取最新提交',
      'merge.dirty': '先提交或储藏这 {count} 个未提交文件，再合并。',
      'merge.openChanges': '查看未提交改动',
      'merge.stash': '储藏改动',
      'merge.confirm': '确认合并',
      'action.stashPush': '储藏改动',
      'action.stashPop': '应用并删除',
      'action.stashApply': '应用储藏',
      'action.stashDrop': '删除储藏',
      'action.newTag': '新建标签',
      'action.deleteTag': '删除标签',
      'action.addRemote': '添加/修改远端',
      'action.removeRemote': '删除远端',
      'action.commitStaged': '提交已暂存的改动',
      'action.commitAndPush': '提交并推送',
      'action.commitAndSync': '提交并同步',
      'action.undoCommit': '撤销上次提交（保留改动）',
      'action.stageAll': '全部暂存',
      'action.unstageAll': '全部取消暂存',
      'action.discardAll': '丢弃全部改动',
      'action.discardUnstaged': '放弃所有未暂存的更改',
      'action.viewStagedChanges': '查看已暂存的更改',
      'action.viewChanges': '查看更改',
      'action.stashStaged': '储藏已暂存的更改',
      'action.stashUnstaged': '储藏未暂存的更改',
      'confirm.discardUnstaged': '确认放弃所有未暂存的更改？已暂存的内容会保留，此操作不可恢复。',
      'action.discard': '丢弃改动',
      'action.cleanUntracked': '清理未跟踪文件',
      'action.showOutput': '查看 Git 输出',
      'action.clearOutput': '清空输出',
      'action.createBranchHere': '在此处新建分支',
      'action.checkoutThis': '切换到此处',
      'action.tagHere': '在此处打标签',
      'action.cherryPick': 'Cherry-pick 此提交',
      'action.resetSoft': '回退到此提交（保留改动）',
      'action.resetHard': '强制回退到此提交（丢弃改动）',
      'action.explain': 'AI 解释这次改动',
      'action.blameAll': '计算整文件 blame',
      'action.blameRange': '只算可视区间',
      'action.openFile': '查看文件',
      'action.copySha': '复制 sha',
      'action.viewCommit': '查看提交改动',
      'action.viewBefore': '提交前',
      'action.viewAfter': '提交后',
      'action.details': '详情',
      'action.createFrom': '从此处创建分支',
      'action.deleteRemoteBranch': '删除远端分支',
      'action.publish': '发布分支',
      'action.loadMore': '加载更多',
      'action.cancel': '取消',
      'action.close': '关闭',
      'action.apply': '应用',
      'action.save': '保存',
      'action.test': '测试 git 路径',
      'action.ok': '确定',
      'tab.output': '输出',
      'menu.actions': '更多操作',
      'confirm.discard': '确认丢弃 {path} 的改动？此操作不可恢复。',
      'confirm.discardAll': '确认丢弃全部未提交的改动？此操作不可恢复。',
      'confirm.clean': '确认删除全部未跟踪文件？此操作不可恢复。',
      'confirm.noRemotes': '没有可删除的远端。',
      'confirm.force': '该操作会丢弃未提交的改动，确认继续？',
      'confirm.deleteBranch': '确认删除分支 {name}？',
      'confirm.dropStash': '确认删除该储藏？此操作不可恢复。',
      'confirm.resetHard': '强制回退会永久丢弃 {count} 个提交之后的改动，确认继续？',
      'confirm.push': '确认推送到远端？',
      'confirm.undoCommit': '确认撤销上一次提交？改动会保留在工作区。',
      'label.branch': '分支',
      'label.local': '本地',
      'label.remote': '远端',
      'error.branchName': '请填写分支名',
      'label.commit': '提交',
      'label.author': '作者',
      'label.date': '时间',
      'label.parents': '父提交',
      'label.files': '改动文件',
      'label.message': '提交信息',
      'label.line': '行',
      'label.includeUnstaged': '包含未暂存的改动',
      'label.similarity': '重命名检测阈值（%）',
      'label.blameChunk': 'blame 分块行数',
      'label.historyLimit': '文件历史条数上限',
      'label.aiEnabled': '启用 AI 功能',
      'settings.aiPrivacy': '主动使用 AI 时，会将所选改动和文件路径发送给配置的模型服务。启用前请检查敏感内容；自动脱敏不能识别所有秘密。',
      'label.gitPath': 'git 可执行文件路径',
      'label.aiProvider': 'AI provider（留空跟随默认模型）',
      'label.aiModel': 'AI model（留空跟随默认模型）',
      'label.defaultRepo': '默认仓库路径',
      'label.writeTools': '向模型开放写操作工具（危险）',
      'chips.branch': '当前分支，点击切换或创建',
      'chips.changes': '{count} 个文件未提交',
      'chips.clean': '没有未提交的改动',
      'chips.ahead': '领先 {count}',
      'chips.behind': '落后 {count}',
      'chips.notRepo': '当前会话目录不是 Git 仓库',
      'chips.init': '初始化仓库',
      // ---- action-outcome banner ----
      'notice.details': '查看详情',
      'notice.hideDetails': '收起详情',
      // Plain-language explanations for the failures whose FIX is knowable.
      // git's own wording is written for a terminal; these say what to do.
      'failure.nonFastForward': '远端有你还未拉取的提交。先拉取（合并或变基），再推送。',
      'failure.actionPull': '拉取',
      'failure.noUpstream': '这个分支还没有对应的远端分支。推送一次即可建立跟踪。',
      'failure.actionPublish': '推送并建立跟踪',
      'failure.auth': '远端拒绝了这次认证。检查凭据（token / SSH key）后重试。',
      'failure.network': '连不上远端。检查网络或代理设置后重试。',
      'failure.diverged': '本地和远端各自都有新提交，无法快进。选择合并或变基后重试。',
      'failure.actionReconcile': '选择合并或变基',
      'failure.conflict': '产生了冲突。解决冲突文件后提交即可完成。',
      'failure.nothingToCommit': '没有可提交的改动。',
      'failure.noMatch': '没有匹配到任何路径。',
      'failure.localChanges': '本地改动会被覆盖。先提交或储藏，再重试。',
      'picker.placeholder': '选择分支或标签以切换',
      'picker.create': '新建分支…',
      'picker.createFrom': '从…创建分支',
      'picker.detached': '切换到游离 HEAD…',
      'picker.branches': '本地分支',
      'picker.current': '当前分支',
      'picker.remotes': '远端分支',
      'picker.tags': '标签',
      'picker.noMatch': '没有匹配的分支',
      'combo.noMatch': '没有匹配项',
      // The stateful primary action: what the user should do NEXT, given the
      // repository's actual state, instead of a fixed set of buttons that make
      // them work it out.
      'next.inSync': '已同步',
      'next.publish': '发布分支',
      'next.resolve': '解决冲突',
      'next.diverged': '需要选择',
      'next.more': '更多 Git 操作',
      'next.hint.inSync': '与远端一致，无需操作',
      'next.hint.pull': '落后远端 {count} 个提交，拉取即可快进',
      'next.hint.push': '领先远端 {count} 个提交',
      'next.hint.publish': '这个分支在远端还没有，推送并建立跟踪',
      'next.hint.resolve': '正在{kind}，有冲突待解决',
      'next.hint.diverged': '与远端分叉，拉取时需要选择合并或变基',
      'sync.fetch': '↻ 拉取远端状态（Fetch）',
      'sync.pullMerge': '⇉ 拉取并合并（可能产生合并提交）',
      'sync.pullRebase': '⤴ 拉取并变基（保持线性历史）',
      'sync.pushLease': '⇡ 强制推送（带租约，覆盖远端）',
      'commit.smartHint': '先暂存文件列表中的全部改动，再提交',
      'commit.requiredMessage': '请先输入提交信息',
      'commit.inProgress': '提交中…',
      'commit.all': '暂存并提交全部',
      'commit.stagedHint': '仅提交已暂存的改动，保留未暂存内容',
      'sync.pushing': '正在推送',
      'sync.pulling': '正在拉取',
      'sync.fetching': '正在获取',
      'sync.target': '目标：{target}',
      'publish.remote': '选择发布到的远端',
      'publish.noRemote': '尚未配置远端，请先为仓库配置远端后再发布',
      'remote.configure': '配置远端',
      'remote.address': '仓库地址',
      'remote.github': '已有 GitHub 账户',
      'remote.account': '账户',
      'remote.repository': '远程仓库',
      'remote.name': '远端名称',
      'remote.save': '保存远端',
      'remote.savePush': '保存并推送',
      'remote.hint': '粘贴 HTTPS 或 SSH 仓库地址，支持 GitHub、GitLab 和自建 Git。',
      'remote.authHint': '认证使用本机已有 Git 凭据或 SSH 密钥。',
      'remote.noAccounts': '未找到可用的 GitHub CLI 或 Git 凭据管理器账户，可直接填写仓库地址。',
      'remote.noRepos': '该账户下暂无可推送的仓库，可继续加载或直接填写地址。',
      'remote.invalid': '请填写合法的远端名称及不包含密码或令牌的仓库地址。',
      'remote.exists': '该远端名称已存在，请换一个名称。',
      'remote.pushBranch': '推送分支',
      'remote.newRepository': '新建 GitHub 仓库',
      'remote.existingRepository': '使用已有仓库',
      'remote.repositoryName': '仓库名称',
      'remote.private': '发布到 GitHub 私有仓库',
      'remote.public': '发布到 GitHub 公开仓库',
      'remote.privateLabel': '私有仓库',
      'remote.publicLabel': '公开仓库',
      'remote.publish': '发布到 GitHub',
      'action.switch': '切换分支',
      'state.readFailed': '读取失败',
      'action.retryRead': '重试读取仓库状态',
      'action.continueOp': '继续',
      'action.abortOp': '中止',
      'confirm.abortOp': '确认中止{kind}？已解决的冲突会丢失，提交本身不受影响。',
      'op.merge': '合并',
      'op.rebase': '变基',
      'op.cherry-pick': '拣选',
      'op.revert': '还原',
      'op.am': '应用补丁',
      'op.merging': '正在合并',
      'op.rebasing': '正在变基（{step}/{total}）',
      'op.cherryPicking': '正在拣选提交',
      'op.reverting': '正在还原提交',
      'op.aming': '正在应用补丁',
      'action.pullMerge': '合并远端改动',
      'action.pullRebase': '变基到远端',
      'action.pushForceLease': '强制推送（带租约）',
      'action.failed': '操作未完成',
      'confirm.pullDiverged': '本地与远端已分叉，需要选择拉取方式。',
      'confirm.pushForceLease': '确认强制推送（--force-with-lease）？远端上别人推送的、你还没拉取的提交会被覆盖；lease 会在检测到这种情况时拒绝。',
      'choice.mergeHint': '保留两边的提交，生成一个合并提交',
      'choice.rebaseHint': '把你的提交接到远端之后，历史呈一条直线（会改写本地未推送的提交）',
      'commit.title': '更改',
      'commit.placeholderMessage': '提交信息（Ctrl+Enter 提交）',
      'commit.stagedSection': '已暂存',
      'commit.unstagedSection': '未暂存',
      'commit.stageAll': '全部暂存',
      'commit.nothing': '没有未提交的改动',
      'commit.openFull': '打开完整窗口',
      'placeholder.commit': '提交信息…',
      'placeholder.search': '搜索提交信息、作者或路径…',
      'placeholder.gitPath': '例如 C:\\Program Files\\Git\\cmd\\git.exe',
      'placeholder.path': '输入路径…',
      'state.loading': '加载中…',
      'state.busy': 'git 正在运行…',
      'state.noRepo': '当前目录尚未初始化，可创建 Git 仓库开始管理改动。',
      'state.repoSetup': '开始使用 Git',
      'action.initRepository': '初始化仓库',
      'action.viewFile': '文件内容',
      'action.viewDiff': '查看差异',
      'action.wrap': '自动换行',
      'action.nowrap': '关闭自动换行',
      'action.previousFile': '上一个文件',
      'action.nextFile': '下一个文件',
      'state.diffEmpty': '没有可显示的差异（可能是新增文件或内容未变）',
      'action.openChanges': '查看改动',
      'action.openFile': '打开文件',
      'action.openHead': '打开 HEAD 版本',
      'action.fileHistory': '查看该文件的提交历史',
      'action.stashFile': '储藏此文件改动',
      'action.ignoreFile': '添加到 .gitignore',
      'action.copyPatch': '复制改动补丁',
      'state.noGit': '未找到 git。请在设置里填写 git 可执行文件的完整路径。',
      'state.noChanges': '工作区干净，没有改动。',
      'error.remoteLoad': '远端读取失败：{message}',
      'error.hostOutdated': 'Git 插件 Host 版本过旧，无法读取远端。请重启 DeepSeek Harness。',
      'state.fileMissing': '当前工作区中没有这个文件。',
      'state.fileBinary': '二进制文件无法预览。',
      'state.previewLines': '预览 {shown} / {total} 行',
      'action.moreCode': '显示更多代码行',
      'state.fileTooLarge': '文件过大，无法预览。',
      'state.noCommits': '没有提交。',
      'state.noBlame': '选择左侧一个文件以查看逐行归属。',
      'state.selectCommit': '在历史或提交图中选择一个提交。',
      'state.emptyDiff': '没有差异。',
      'state.blameTruncated': '文件较大，已按区间计算 blame。',
      'state.aiUnavailable': 'AI 不可用',
      'error.load': '加载失败：{message}',
      'error.action': '操作失败：{message}',
      'error.needsConfirm': '该操作需要确认',
      'count.files': '{count} 个文件',
      'count.lines': '+{added} −{deleted}',
      'graph.lanes': '{count} 条泳道',
      'blame.author': '作者',
      'blame.lines': '{count} 行',
      'settings.saved': '已保存',
      'settings.gitFound': '已找到 git：{path}',
      'settings.gitMissing': '未找到 git',
      'settings.version': '版本：{version}',
      'settings.cache': '缓存',
      'settings.features': '能力',
      'settings.repo': '仓库',
      'settings.noRepo': '还没有打开任何仓库',
    }

    var en = {
      'panel.title': 'Git',
      'sidebar.label': 'Git workbench',
      'tab.changes': 'Changes',
      'tab.history': 'History',
      'tab.graph': 'Graph',
      'tab.compare': 'Compare',
      'tab.settings': 'Settings',
      'sidebar.changes': 'Changes',
      'sidebar.history': 'Commit History',
      'sidebar.graph': 'Commit Graph',
      'sidebar.compare': 'Compare',
      'sidebar.output': 'Output',
      'sidebar.settings': 'Settings',
      'state.noCommitSelected': 'Select a commit on the left to see its changes.',
      'graph.lanesLabel': 'Lanes',
      'graph.tips': 'Branches / tags',
      'label.commits': 'Commits',
      'compare.pickHint': 'Pick a branch or tag below to fill in the base ref.',
      'compare.idleHint': 'Choose two refs and press Compare; the differences appear here.',
      'compare.back': 'Back',
      'compare.from': 'Base branch or commit',
      'compare.to': 'Target branch or commit',
      'compare.swap': 'Swap comparison direction',
      'compare.commits': 'Commits unique to either side (up to 100)',
      'output.filterAll': 'All commands',
      'output.filterFailed': 'Failures only',
      'output.noFailures': 'No command has failed.',
      'settings.general': 'General',
      'settings.ai': 'AI assistant',
      'settings.diagnostics': 'Diagnostics',
      'tree.branches': 'Branches',
      'tree.tags': 'Tags',
      'tree.remotes': 'Remotes',
      'tree.stashes': 'Stashes',
      'tab.stashes': 'Stashes',
      'sidebar.stashes': 'Stashes',
      'list.searchFiles': 'Search files',
      'list.searchStashes': 'Search stash messages or branches',
      'list.noMatches': 'No matches',
      'diff.fileList': 'File list',
      'diff.fileTree': 'Directory tree',
      'diff.copyPath': 'Copy file path',
      'diff.copied': 'Copied',
      'diff.copyFailed': 'Could not copy. Try again.',
      'stash.applyHint': 'Restore changes and keep this stash',
      'stash.popHint': 'Remove the stash after restoring successfully',
      'stash.dropHint': 'Permanently delete this stash',
      'stash.applyShort': 'Apply',
      'stash.popShort': 'Apply & drop',
      'stash.dropShort': 'Delete',
      'stash.retry': 'Retry',
      'stash.noEligible': 'Only untracked files are present. Select Include untracked files.',
      'stash.create': 'Stash current changes',
      'stash.includeUntracked': 'Include untracked files',
      'stash.select': 'Select a stash to review its changes',
      'stash.view': 'View stashes',
      'stash.created': 'Changes stashed',
      'stash.loadFailed': 'Could not load stashes: {message}',
      'stash.dropConfirm': 'Delete {ref} "{message}"? This cannot be undone.',
      'stash.applyConfirm': 'Apply {ref} "{message}"? Changes will be restored to your working tree and the stash will be kept. Any conflicts must be resolved manually.',
      'history.loadFailed': 'Failed to load history: {message}',
      'history.detailFailed': 'Failed to load commit: {message}',
      'stash.popConfirm': 'Apply and drop {ref} "{message}"? Changes will be restored to your working tree and the stash will be removed on success. Conflicts will keep the stash.',
      'stash.allFiles': 'All files',
      'stash.applied': 'Stash applied and kept',
      'stash.popped': 'Stash applied and removed',
      'stash.deleted': 'Stash deleted',
      'tree.commits': 'Commits',
      'tree.repositories': 'Repositories',
      'state.noStashes': 'No stashes could be found.',
      'tree.worktrees': 'Worktrees',
      'tree.contributors': 'Contributors',
      'tree.changes': 'Changes',
      'tree.files': 'Files',
      'action.compareWith': 'Compare with working tree',
      'action.openRepo': 'Open repository…',
      'action.closeRepo': 'Close repository',
      'action.copyPath': 'Copy path',
      'action.revealInFolder': 'Reveal in file manager',
      'meta.lastFetched': 'Last fetched: {time}',
      'meta.neverFetched': 'Never fetched',
      'meta.commits': '{count} commits',
      'meta.user': 'Identity: {name}',
      'window.open': 'Open the Git window',
      'window.close': 'Close window',
      'window.focus': 'Toggle simple/full window',
      'window.simple': 'Simple window',
      'window.full': 'Full window',
      'window.staged': '{count} staged',
      'commit.pushAfter': 'Push after committing',
      'commit.pullBeforePush': 'Pull before pushing (sync)',
      'window.unstaged': '{count} unstaged',
      'window.minimize': 'Minimize',
      'window.maximize': 'Enlarge the Git window',
      'window.restore': 'Restore the Git window',
      'window.fileMaximize': 'Maximize file window',
      'window.fileRestore': 'Restore file window',
      'window.dragHint': 'Drag the title bar to move the window',
      'window.resizeHint': 'Drag to resize the window',
      'action.refresh': 'Refresh',
      'action.sync': 'Sync',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.commit': 'Commit',
      'action.generateMessage': 'AI commit message',
      'commit.generateShort': 'Generate',
      'action.fetch': 'Fetch',
      'action.pull': 'Pull',
      'action.push': 'Push',
      'action.clone': 'Clone',
      'action.checkout': 'Checkout',
      'action.newBranch': 'New branch',
      'action.switchBranch': 'Switch branch',
      'label.startPoint': 'Start point',
      'label.startPointHead': 'HEAD (current commit)',
      'state.noBranches': 'No branches available',
      'confirm.switchBranch': 'Switch to {name}? Uncommitted changes may be lost.',
      'confirm.remoteBranchExists': 'Local branch {name} already exists. Switch to it?',
      'action.renameBranch': 'Rename current branch',
      'action.deleteBranch': 'Delete branch',
      'action.merge': 'Merge into current',
      'merge.open': 'Merge…',
      'merge.pick': 'Choose a branch to merge',
      'merge.search': 'Search local or remote branches…',
      'merge.direction': 'Merge {source} into {target}',
      'merge.incoming': 'Commits only on the source',
      'merge.outgoing': 'Commits only on the current branch',
      'merge.moreCommits': 'Showing the first 20 only',
      'merge.noCommits': 'No unique commits',
      'merge.already': 'The source has no commits to merge.',
      'merge.loading': 'Checking both branches…',
      'merge.fetching': 'Fetching the selected remote branch…',
      'merge.remoteFlow': 'Preview uses locally saved remote refs. Fetch manually to update.',
      'merge.fetchLatest': 'Fetch latest commits',
      'merge.dirty': 'Commit or stash these {count} uncommitted files before merging.',
      'merge.openChanges': 'Review uncommitted changes',
      'merge.stash': 'Stash changes',
      'merge.confirm': 'Merge branch',
      'action.stashPush': 'Stash changes',
      'action.stashPop': 'Apply and drop',
      'action.stashApply': 'Apply stash',
      'action.stashDrop': 'Drop stash',
      'action.newTag': 'New tag',
      'action.deleteTag': 'Delete tag',
      'action.addRemote': 'Add/edit remote',
      'action.removeRemote': 'Remove remote',
      'action.commitStaged': 'Commit staged',
      'action.commitAndPush': 'Commit & Push',
      'action.commitAndSync': 'Commit & Sync',
      'action.undoCommit': 'Undo last commit (keep changes)',
      'action.stageAll': 'Stage all',
      'action.unstageAll': 'Unstage all',
      'action.discardAll': 'Discard all changes',
      'action.discardUnstaged': 'Discard all unstaged changes',
      'action.viewStagedChanges': 'View staged changes',
      'action.viewChanges': 'View changes',
      'action.stashStaged': 'Stash staged changes',
      'action.stashUnstaged': 'Stash unstaged changes',
      'confirm.discardUnstaged': 'Discard all unstaged changes? Staged changes stay intact. This cannot be undone.',
      'action.discard': 'Discard changes',
      'action.cleanUntracked': 'Clean untracked files',
      'action.showOutput': 'Show Git Output',
      'action.clearOutput': 'Clear output',
      'action.createBranchHere': 'Create branch here',
      'action.checkoutThis': 'Checkout this',
      'action.tagHere': 'Tag this',
      'action.cherryPick': 'Cherry-pick this commit',
      'action.resetSoft': 'Reset here (keep changes)',
      'action.resetHard': 'Hard reset here (discard changes)',
      'action.explain': 'AI explain',
      'action.blameAll': 'Blame whole file',
      'action.blameRange': 'Blame visible range',
      'action.openFile': 'View file',
      'action.copySha': 'Copy sha',
      'action.viewCommit': 'View commit changes',
      'action.viewBefore': 'Before commit',
      'action.viewAfter': 'After commit',
      'action.details': 'Details',
      'action.createFrom': 'Create branch from here',
      'action.deleteRemoteBranch': 'Delete remote branch',
      'action.publish': 'Publish branch',
      'action.loadMore': 'Load more',
      'action.cancel': 'Cancel',
      'action.close': 'Close',
      'action.apply': 'Apply',
      'action.save': 'Save',
      'action.test': 'Test git path',
      'action.ok': 'OK',
      'tab.output': 'Output',
      'menu.actions': 'More actions',
      'confirm.discard': 'Discard changes in {path}? This cannot be undone.',
      'confirm.discardAll': 'Discard ALL uncommitted changes? This cannot be undone.',
      'confirm.clean': 'Delete all untracked files? This cannot be undone.',
      'confirm.noRemotes': 'There is no remote to remove.',
      'confirm.force': 'This discards uncommitted work. Continue?',
      'confirm.deleteBranch': 'Delete branch {name}?',
      'confirm.dropStash': 'Drop this stash? This cannot be undone.',
      'confirm.resetHard': 'A hard reset permanently discards work after {count}. Continue?',
      'confirm.push': 'Push to the remote?',
      'confirm.undoCommit': 'Undo the last commit? Its changes stay in the working tree.',
      'label.branch': 'Branch',
      'label.local': 'Local',
      'label.remote': 'Remote',
      'error.branchName': 'Enter a branch name',
      'label.commit': 'Commit',
      'label.author': 'Author',
      'label.date': 'Date',
      'label.parents': 'Parents',
      'label.files': 'Files',
      'label.message': 'Message',
      'label.line': 'Line',
      'label.includeUnstaged': 'Include unstaged changes',
      'label.similarity': 'Rename detection threshold (%)',
      'label.blameChunk': 'Blame chunk size (lines)',
      'label.historyLimit': 'File history limit',
      'label.aiEnabled': 'Enable AI features',
      'settings.aiPrivacy': 'AI actions send selected changes and file paths to the configured model service. Review sensitive content before enabling; automatic redaction cannot detect every secret.',
      'label.gitPath': 'git executable path',
      'label.aiProvider': 'AI provider (empty follows the default model)',
      'label.aiModel': 'AI model (empty follows the default model)',
      'label.defaultRepo': 'Default repository path',
      'label.writeTools': 'Expose write tools to the model (dangerous)',
      'chips.branch': 'Current branch — click to switch or create',
      'chips.changes': '{count} uncommitted file(s)',
      'chips.clean': 'No uncommitted changes',
      'chips.ahead': '{count} ahead',
      'chips.behind': '{count} behind',
      'chips.notRepo': 'The session directory is not a Git repository',
      'chips.init': 'Initialize repository',
      'notice.details': 'Details',
      'notice.hideDetails': 'Hide details',
      'failure.nonFastForward': 'The remote has commits you have not fetched. Pull (merge or rebase), then push again.',
      'failure.actionPull': 'Pull',
      'failure.noUpstream': 'This branch has no upstream yet. Pushing once sets it up.',
      'failure.actionPublish': 'Push and set upstream',
      'failure.auth': 'The remote rejected the credentials. Check your token or SSH key, then retry.',
      'failure.network': 'Could not reach the remote. Check your network or proxy settings, then retry.',
      'failure.diverged': 'Local and remote both have new commits, so this cannot fast-forward. Choose merge or rebase, then retry.',
      'failure.actionReconcile': 'Choose merge or rebase',
      'failure.conflict': 'There are conflicts. Resolve the conflicted files and commit to finish.',
      'failure.nothingToCommit': 'There is nothing to commit.',
      'failure.noMatch': 'No path matched.',
      'failure.localChanges': 'Your local changes would be overwritten. Commit or stash them first.',
      'picker.placeholder': 'Select a branch or tag to checkout',
      'picker.create': 'Create new branch…',
      'picker.createFrom': 'Create new branch from…',
      'picker.detached': 'Checkout detached…',
      'picker.branches': 'branches',
      'picker.current': 'current',
      'picker.remotes': 'remote branches',
      'picker.tags': 'tags',
      'picker.noMatch': 'No matching branch',
      'combo.noMatch': 'No matching item',
      'next.inSync': 'In sync',
      'next.publish': 'Publish branch',
      'next.resolve': 'Resolve conflicts',
      'next.diverged': 'Choose action',
      'next.more': 'More Git actions',
      'next.hint.inSync': 'Up to date with the remote',
      'next.hint.pull': '{count} commit(s) behind — pull to fast-forward',
      'next.hint.push': '{count} commit(s) ahead of the remote',
      'next.hint.publish': 'This branch is not on the remote yet; push and track it',
      'next.hint.resolve': '{kind} in progress with conflicts to resolve',
      'next.hint.diverged': 'Diverged from the remote — pulling needs a merge or rebase',
      'sync.fetch': '↻ Fetch (check the remote without merging)',
      'sync.pullMerge': '⇉ Pull with merge (may create a merge commit)',
      'sync.pullRebase': '⤴ Pull with rebase (keeps history linear)',
      'sync.pushLease': '⇡ Force push (with lease, overwrites the remote)',
      'commit.smartHint': 'Stage every listed change, then commit',
      'commit.requiredMessage': 'Enter a commit message first',
      'commit.inProgress': 'Committing…',
      'commit.all': 'Stage and commit all',
      'commit.stagedHint': 'Commit staged changes only; keep unstaged edits',
      'sync.pushing': 'Pushing',
      'sync.pulling': 'Pulling',
      'sync.fetching': 'Fetching',
      'sync.target': 'Target: {target}',
      'publish.remote': 'Choose a remote to publish to',
      'publish.noRemote': 'No remote configured. Configure a remote for this repository before publishing.',
      'remote.configure': 'Configure remote',
      'remote.address': 'Repository URL',
      'remote.github': 'Existing GitHub account',
      'remote.account': 'Account',
      'remote.repository': 'Remote repository',
      'remote.name': 'Remote name',
      'remote.save': 'Save remote',
      'remote.savePush': 'Save and push',
      'remote.hint': 'Paste an HTTPS or SSH repository URL for GitHub, GitLab or a self-hosted Git server.',
      'remote.authHint': 'Authentication uses existing local Git credentials or SSH keys.',
      'remote.noAccounts': 'No available GitHub CLI or Git Credential Manager accounts found. You can paste a repository URL.',
      'remote.noRepos': 'No writable repositories on this page. Load more or paste a URL.',
      'remote.invalid': 'Enter a valid remote name and repository URL without passwords or tokens.',
      'remote.exists': 'This remote name already exists. Choose another name.',
      'remote.pushBranch': 'Branch to push',
      'remote.newRepository': 'New GitHub repository',
      'remote.existingRepository': 'Use existing repository',
      'remote.repositoryName': 'Repository name',
      'remote.private': 'Publish to a private GitHub repository',
      'remote.public': 'Publish to a public GitHub repository',
      'remote.privateLabel': 'Private repository',
      'remote.publicLabel': 'Public repository',
      'remote.publish': 'Publish to GitHub',
      'action.switch': 'Switch branch',
      'state.readFailed': 'Read failed',
      'action.retryRead': 'Retry reading repository status',
      'action.continueOp': 'Continue',
      'action.abortOp': 'Abort',
      'confirm.abortOp': 'Abort the {kind}? Conflict resolutions are lost; commits are not.',
      'op.merge': 'merge',
      'op.rebase': 'rebase',
      'op.cherry-pick': 'cherry-pick',
      'op.revert': 'revert',
      'op.am': 'patch application',
      'op.merging': 'Merging',
      'op.rebasing': 'Rebasing ({step}/{total})',
      'op.cherryPicking': 'Cherry-picking',
      'op.reverting': 'Reverting',
      'op.aming': 'Applying patch',
      'action.pullMerge': 'Merge the remote changes',
      'action.pullRebase': 'Rebase onto the remote',
      'action.pushForceLease': 'Force push (with lease)',
      'action.failed': 'The operation did not complete',
      'confirm.pullDiverged': 'Your branch and the remote have diverged. Choose how to pull.',
      'confirm.pushForceLease': 'Force push (--force-with-lease)? This overwrites commits on the remote that you have not fetched; the lease refuses if someone else pushed in the meantime.',
      'choice.mergeHint': 'Keep both sides and create a merge commit',
      'choice.rebaseHint': 'Replay your commits on top of the remote, keeping a linear history (rewrites your unpushed commits)',
      'commit.title': 'Changes',
      'commit.placeholderMessage': 'Commit message (Ctrl+Enter to commit)',
      'commit.stagedSection': 'Staged',
      'commit.unstagedSection': 'Unstaged',
      'commit.stageAll': 'Stage all',
      'commit.nothing': 'No uncommitted changes',
      'commit.openFull': 'Open full window',
      'placeholder.commit': 'Commit message…',
      'placeholder.search': 'Search message, author, or path…',
      'placeholder.gitPath': 'e.g. C:\\Program Files\\Git\\cmd\\git.exe',
      'placeholder.path': 'Enter a path…',
      'state.loading': 'Loading…',
      'state.busy': 'git is running…',
      'state.noRepo': 'Initialize this directory as a Git repository to start tracking changes.',
      'state.repoSetup': 'Get started with Git',
      'action.initRepository': 'Initialize Repository',
      'action.viewFile': 'File',
      'action.viewDiff': 'Diff',
      'action.wrap': 'Wrap lines',
      'action.nowrap': 'No wrap',
      'action.previousFile': 'Previous file',
      'action.nextFile': 'Next file',
      'state.diffEmpty': 'No diff to show (new file, or contents unchanged)',
      'action.openChanges': 'Open Changes',
      'action.openFile': 'Open File',
      'action.openHead': 'Open File (HEAD)',
      'action.fileHistory': 'View file commit history',
      'action.stashFile': 'Stash File Changes',
      'action.ignoreFile': 'Add to .gitignore',
      'action.copyPatch': 'Copy Changes (Patch)',
      'state.noGit': 'git was not found. Set the full path to the git executable in settings.',
      'state.noChanges': 'The working tree is clean.',
      'error.remoteLoad': 'Could not load remotes: {message}',
      'error.hostOutdated': 'The Git plugin Host is outdated. Restart DeepSeek Harness to load remotes.',
      'state.fileMissing': 'This file is not in the working tree.',
      'state.fileBinary': 'Binary files cannot be previewed.',
      'state.previewLines': 'Previewing {shown} of {total} lines',
      'action.moreCode': 'Show more code lines',
      'state.fileTooLarge': 'This file is too large to preview.',
      'state.noCommits': 'No commits.',
      'state.noBlame': 'Pick a file on the left to see per-line attribution.',
      'state.selectCommit': 'Pick a commit in History or Graph.',
      'state.emptyDiff': 'No differences.',
      'state.blameTruncated': 'Large file: blame was computed for a range.',
      'state.aiUnavailable': 'AI unavailable',
      'error.load': 'Load failed: {message}',
      'error.action': 'Action failed: {message}',
      'error.needsConfirm': 'This action needs confirmation',
      'count.files': '{count} files',
      'count.lines': '+{added} −{deleted}',
      'graph.lanes': '{count} lanes',
      'blame.author': 'Author',
      'blame.lines': '{count} lines',
      'settings.saved': 'Saved',
      'settings.gitFound': 'git found: {path}',
      'settings.gitMissing': 'git not found',
      'settings.version': 'Version: {version}',
      'settings.cache': 'Cache',
      'settings.features': 'Capabilities',
      'settings.repo': 'Repository',
      'settings.noRepo': 'No repository opened yet',
    }

    /* ------------------------------------------------------------------ *
     * Styles — theme tokens only, light and dark both resolve through them
     * ------------------------------------------------------------------ */

    var workbenchWords = {
      branches: ['分支', 'Branches'], local: ['本地', 'Local'], remote: ['远程', 'Remote'], tags: ['标签', 'Tags'],
      search: ['搜索分支…', 'Search branches…'], current: ['当前', 'Current'], all: ['全部分支', 'All branches'], selected: ['选中分支', 'Selected branch'],
      showRemote: ['显示远程', 'Show remotes'], date: ['日期顺序', 'Date order'], topo: ['拓扑顺序', 'Ancestor order'],
      currentScope: ['当前分支', 'Current branch'], viewing: ['正在查看', 'Viewing'], maximum: ['已达到 2000 条上限，请缩小分支范围', '2000 commit limit reached; select a branch'],
      returnHead: ['返回当前分支的提交记录（HEAD）', 'Return to current branch history (HEAD)'],
      checkout: ['切换分支', 'Switch branch'], createBranch: ['新建分支', 'Create branch'], merge: ['合并到当前分支', 'Merge into current branch'],
      renameBranch: ['重命名分支', 'Rename branch'], deleteBranch: ['删除分支', 'Delete branch'], push: ['推送分支', 'Push branch'],
      pull: ['拉取分支', 'Pull branch'],
      pullNeedsUpstream: ['请先设置上游分支', 'Set an upstream branch first'], fetchLocal: ['获取上游更新（Fetch）', 'Fetch upstream updates'],
      pullStrategy: ['拉取方式', 'Pull strategy'], pullFf: ['仅快进', 'Fast-forward only'], pullMerge: ['合并', 'Merge'], pullRebase: ['变基', 'Rebase'],
      pullOtherBranch: ['直接快进更新此分支，当前分支和本地改动会保留；已分叉时请先切换再合并或变基。', 'Fast-forward this branch while keeping the current branch and local changes; switch first to merge or rebase diverged history.'],
      checkoutBlocked: ['本地改动阻碍切换，请先提交或储藏后重试', 'Local changes prevent switching; commit or stash them, then retry'],
      createTag: ['创建标签', 'Create tag'], tagName: ['标签名称', 'Tag name'], tagMessage: ['标签说明（可选）', 'Tag message (optional)'],
      tagHint: ['填写说明会创建附注标签，留空则创建轻量标签。', 'A message creates an annotated tag; leave it empty for a lightweight tag.'],
      invalidTagName: ['标签名称不合法', 'Invalid tag name'], tagNameConflict: ['标签已存在，或名称与已有标签路径冲突', 'Tag already exists or conflicts with an existing tag path'],
      tagTarget: ['标签指向', 'Tag target'],
      fetchBranch: ['获取该远程分支的更新', 'Fetch this remote branch'], outgoing: ['查看当前分支独有的提交', 'View commits unique to current branch'],
      fetchPrune: ['获取并清理', 'Fetch and prune'], fetchPruneHint: ['获取此远端的更新，并清理服务器已删除分支的本地跟踪记录', 'Fetch this remote and prune tracking refs for branches deleted on the server'],
      pruneRemote: ['清理失效分支', 'Prune stale branches'], pruneRemoteHint: ['获取该远端并清理服务器已删除分支的跟踪引用，保留本地分支', 'Fetch this remote and prune deleted tracking refs; keep local branches'],
      remotePruned: ['已更新 {name} 并清理失效分支', 'Updated {name} and pruned stale branches'],
      branchFilter: ['分支筛选', 'Branch filter'], allBranches: ['全部分支', 'All branches'], mergedBranches: ['已合并到当前分支', 'Merged into current branch'],
      unmergedBranches: ['未合并到当前分支', 'Not merged into current branch'], mergedUnknown: ['暂时无法判断合并状态，请刷新或更新 Host', 'Merge state is unavailable; refresh or update the Host'],
      addWorktree: ['在新工作树打开分支', 'Open branch in a new worktree'], worktreeDirectory: ['新工作树目录（绝对路径）', 'New worktree directory (absolute path)'],
      worktreeNewBranch: ['创建新分支', 'Create a new branch'], worktreeOccupied: ['此分支已被工作树占用，需要创建新分支。', 'This branch is in use by a worktree; create a new branch.'],
      worktreeHint: ['在独立目录检出此分支，创建成功后在 Git 窗口中打开。', 'Check out this branch in a separate directory and open it in the Git window.'],
      worktreePathRequired: ['请输入新工作树的绝对路径', 'Enter an absolute path for the new worktree'],
      worktreeUnsupported: ['当前 Git 不支持工作树', 'This Git version does not support worktrees'],
      setUpstream: ['设置或取消上游', 'Set or unset upstream'], history: ['查看提交记录', 'View branch history'],
      compare: ['与当前分支比较', 'Compare with current branch'], incoming: ['查看该分支独有的提交', 'View commits unique to this branch'],
      copy: ['复制完整名称', 'Copy full name'], favorite: ['收藏或取消收藏', 'Toggle favorite'], favorites: ['收藏', 'Favorites'],
      locate: ['定位当前分支', 'Locate current branch'], reflog: ['本地操作记录', 'Local operation history'], recovery: ['查看恢复选项', 'Recovery options'],
      reflogHint: ['查看本地操作记录（reflog），找回误操作前的提交', 'View local operation history (reflog) to recover earlier commits'],
      reflogDescription: ['记录本地切换分支、提交、重置等操作。可从记录中的提交创建恢复分支，帮助找回误操作前的提交。', 'Records local checkouts, commits and resets. Create a recovery branch from an entry to recover commits from before an accidental operation.'],
      refreshBranches: ['刷新分支列表和提交图', 'Refresh branches and commit graph'],
      undoCommit: ['撤销上次提交，保留改动', 'Undo last commit, keep changes'], resetTo: ['重置当前分支到此提交', 'Reset current branch here'],
      revert: ['撤销此提交的改动，生成新提交', 'Revert this commit'], cherryPick: ['挑选提交到当前分支', 'Cherry-pick into current branch'],
      rebase: ['将当前分支变基到此分支', 'Rebase current branch onto this branch'], commit: ['修改上次提交', 'Amend last commit'],
      restoreRevision: ['将此文件恢复为该版本', 'Restore this file from this revision'], name: ['分支名称', 'Branch name'],
      start: ['起点', 'Start point'], switchAfter: ['创建后切换', 'Switch after creation'], track: ['跟踪该远程分支', 'Track this remote branch'],
      noUpstream: ['不设置上游', 'No upstream'], upstream: ['上游分支', 'Upstream branch'], target: ['目标', 'Target'],
      source: ['来源', 'Source'], stash: ['先储藏本地改动，包含未跟踪文件', 'Stash local changes, including untracked files'],
      backup: ['创建备份分支，保留当前位置', 'Create a backup branch at the current position'],
      soft: ['保留文件与暂存状态 Soft', 'Keep files and index — Soft'], mixed: ['保留文件，重置暂存区 Mixed', 'Keep files, reset index — Mixed'],
      hard: ['文件也恢复到目标版本 Hard', 'Restore files to target — Hard'], force: ['强制删除未合并分支', 'Force delete unmerged branch'],
      understand: ['我理解本地未提交内容可能丢失', 'I understand uncommitted content may be lost'],
      noFf: ['始终创建合并提交', 'Always create a merge commit'], noCommit: ['仅应用改动，稍后提交', 'Apply changes without committing'],
      parent: ['基准父提交', 'Mainline parent'], message: ['提交说明', 'Commit message'],
      dirty: ['本地改动', 'Local changes'], cleanFirst: ['请先提交或勾选储藏本地改动', 'Commit or choose to stash local changes first'],
      lost: ['当前分支将不再包含的提交', 'Commits no longer reachable from this branch'],
      published: ['该提交存在于已获取的远程记录中；请优先使用 Revert', 'This commit is present in fetched remote history; prefer Revert'],
      unknown: ['发布状态依据最近获取的引用，未发现不等于确定未发布', 'Publication state uses fetched refs; absence does not prove unpublished'],
      occupied: ['分支已被其他工作树占用', 'Branch is checked out in another worktree'],
      emptyRemote: ['尚无分支，获取后查看', 'No branches yet; fetch to view'],
      noSelection: ['请选择分支查看提交记录', 'Select a branch to view commits'],
      preview: ['查看差异预览', 'Preview changes'], remoteDelete: ['此操作删除服务器上的分支，本地同名分支会保留', 'Deletes the server branch and keeps any local branch'],
      noAutoPush: ['只修改本地分支，不会自动推送', 'Changes only the local branch; does not push'],
      rootUndo: ['首次提交没有上一提交，无法撤销', 'The first commit has no parent to undo to'],
      busyOperation: ['请先继续或中止正在进行的操作', 'Continue or abort the operation in progress first'],
      fetch: ['获取远端', 'Fetch remotes'], prune: ['清理已失效的远程跟踪引用', 'Prune stale remote-tracking refs'],
      fetched: ['最近获取', 'Last fetch'], branchExists: ['同名本地分支已存在，请选择已有分支或使用其他名称', 'A local branch already exists; switch to it or choose another name'],
      beforeBranch: ['操作前分支位置', 'Previous branch position'], protectedStash: ['本地改动已储藏', 'Local changes protected in stash'],
      conflict: ['出现冲突，请在改动标签解决后继续或中止', 'Resolve conflicts in Changes, then continue or abort'],
      recoverBranch: ['从此位置创建恢复分支', 'Create recovery branch here'], details: ['提交详情', 'Commit details'],
      replay: ['将重放当前分支的这些提交', 'These current-branch commits will be replayed'],
      amendNotice: ['会把暂存改动加入最新提交，并生成新的 SHA', 'Adds staged changes to the latest commit and creates a new SHA'],
      revertMergeNotice: ['撤销合并会影响以后再次合并时纳入的改动，请核对基准父提交', 'Reverting a merge affects changes included in future merges; review the mainline parent'],
      savedChanges: ['查看已保护的本地改动', 'View protected local changes'],
      existingBranch: ['切换已有本地分支', 'Switch to an existing local branch'],
      originalMessage: ['使用原提交信息', 'Use original commit message'],
      detachedNotice: ['检出标签会进入游离 HEAD；继续修改前请创建本地分支', 'Checking out a tag detaches HEAD; create a local branch before further work'],
      invalidName: ['分支名称不合法', 'Invalid branch name'], nameConflict: ['分支名称与已有分支路径冲突', 'Branch name conflicts with an existing branch path'],
      sourceChanges: ['预览来源分支的改动', 'Preview source-branch changes'],
    }
    Object.keys(workbenchWords).forEach(function (key) { zh['wb.' + key] = workbenchWords[key][0]; en['wb.' + key] = workbenchWords[key][1] })
    var changelistWords = {
      title: ['改动列表', 'Changelists'], default: ['默认', 'Default'], staging: ['Git 暂存区', 'Git staging area'],
      create: ['新建改动列表', 'New changelist'], name: ['列表名称', 'List name'],
      active: ['设为活动列表', 'Set active'], activeHint: ['新改动归入此列表', 'New changes go into this list'],
      rename: ['重命名', 'Rename'], description: ['编辑说明', 'Edit description'],
      move: ['移动到列表', 'Move to changelist'], target: ['目标列表', 'Target list'],
      delete: ['删除列表', 'Delete changelist'], deleteHint: ['改动会移入目标列表，文件内容保留', 'Changes move to the target list; file contents are preserved'],
      select: ['加入本次提交', 'Include in commit'], exclude: ['从本次提交排除', 'Exclude from commit'],
      scope: ['提交此列表', 'Commit this changelist'], selected: ['已选 {count} 个文件', '{count} files selected'],
      untracked: ['未跟踪文件', 'Untracked files'], conflicts: ['冲突文件', 'Conflicted files'],
      fullFile: ['提交勾选的文件或代码块；其他改动和暂存内容保留', 'Commit checked files or chunks; preserve other changes and staged content'],
      noSelection: ['请勾选需要提交的文件', 'Select files to commit'],
      empty: ['暂无改动', 'No changes'], saving: ['正在保存列表…', 'Saving changelist…'], search: ['搜索文件…', 'Search files…'],
      split: ['按代码块管理', 'Manage by chunks'], whole: ['按完整文件管理', 'Manage whole file'], chunk: ['修改块 {number}', 'Change {number}'],
      assign: ['请选择所属列表', 'Choose a changelist'], reassign: ['改动已变化，需要重新分配', 'Changes have changed; reassign them'],
      stash: ['储藏此列表', 'Stash this changelist'], stashConfirm: ['储藏“{name}”的改动？其他列表的改动和暂存内容会保留。', 'Stash changes in “{name}”? Other changelists and staged changes will be preserved.'],
      restoreIndex: ['恢复暂存状态', 'Restore staged state'],
      switchMode: ['切换改动管理方式', 'Switch change management mode'],
      tree: ['按目录分组', 'Group by directory'], flat: ['平铺文件', 'Flat file list'],
    }
    Object.keys(changelistWords).forEach(function (key) { zh['cl.' + key] = changelistWords[key][0]; en['cl.' + key] = changelistWords[key][1] })

    var STYLES = [
      'body{--dshgit-success-text:color-mix(in srgb,var(--dsw-alias-file-diff-added-marker,var(--dsw-alias-state-success-primary)) 75%,var(--dsw-alias-label-primary));--dshgit-warning-text:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-label-primary))}',
      '.dshgit-cl-toolbar{display:flex;gap:4px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-cl-modebar{gap:8px;justify-content:space-between}',
      '.dshgit-sidebar-head>.dshgit-cl-modebar{flex:1;min-width:0;padding:0;border:0}',
      '.dshgit-sidebar-head>.dshgit-iconbtn{width:28px;height:28px}',
      '.dshgit-cl-mode{display:inline-flex;align-items:center;gap:6px;min-width:0;height:28px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}',
      '.dshgit-cl-mode:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary)}',
      '.dshgit-cl-modebar>.dshgit-iconbtn{width:28px;height:28px;box-sizing:border-box;padding:0;border-radius:4px}',
      '.dshgit-cl-modebar svg{flex:none;width:16px;height:16px}',
      '.dshgit-cl-mode:focus-visible,.dshgit-cl-modebar>.dshgit-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshgit-cl-group{margin:4px 8px 10px;min-width:0}',
      '.dshgit-cl-pane{flex:1;min-height:100%;min-width:0;box-sizing:border-box;padding-bottom:12px}',
      '.dshgit-cl-head{display:flex;align-items:center;gap:6px;min-height:34px;padding:3px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);box-sizing:border-box}',
      '.dshgit-cl-head>.dshgit-iconbtn{width:24px;height:24px;padding:0;flex:none;display:inline-flex;align-items:center;justify-content:center}',
      '.dshgit-cl-head[data-active="true"] .dshgit-name{font-weight:600}',
      '.dshgit-cl-head .dshgit-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-cl-toggle{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:4px 0}',
      '.dshgit-cl-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:3px}',
      '.dshgit-cl-count{flex:none;min-width:16px;text-align:center;font-size:var(--dshgit-font-small);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-cl-search{display:flex;align-items:center;gap:8px;padding:8px 10px 4px}.dshgit-cl-search>.dshgit-input{flex:1;min-width:0;width:100%;box-sizing:border-box}',
      '.dshgit-cl-layout{display:flex;gap:2px;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px}',
      '.dshgit-cl-layout>.dshgit-iconbtn{width:26px;height:26px;border-radius:3px}',
      '.dshgit-cl-layout>.dshgit-iconbtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary)}',
      '.dshgit-cl-active{color:var(--dsw-alias-brand-primary);font-size:var(--dshgit-font-micro)}',
      '.dshgit-cl-more{display:none}.dshgit-cl-head:hover .dshgit-cl-more,.dshgit-cl-head:focus-within .dshgit-cl-more{display:inline-flex}',
      '.dshgit-cl-checkbox{flex:none;margin:0 2px 0 0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.dshgit-cl-error{padding:8px 10px;color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-cl-viewport{position:relative;overflow:auto;max-height:360px;contain:layout;margin:4px 0 0 18px;border-left:1px solid var(--dsw-alias-border-l1);scrollbar-gutter:stable}',
      // The row's gap matches the group header's (6px), so the file's leading
      // label lands in the same column as the header's label — the same column the
      // header's NAME occupies. With an 8px gap the icon sat 2px right of it, which
      // kept the list looking almost aligned even once the checkboxes matched.
      '.dshgit-cl-viewport .dshgit-change{margin-left:6px;padding-left:11px;gap:6px;border-radius:4px}',
      '.dshgit-cl-viewport .dshgit-change .dshgit-filedir{font-size:var(--dshgit-font-small);opacity:.75}',
      '.dshgit-cl-directory{display:flex;align-items:center;gap:8px;margin-left:6px;padding-right:7px;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-cl-directory-name{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-cl-directory-name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-cl-directory-name>svg{flex:none}',
      '.dshgit-cl-directory-name:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:4px}',
      '.dshgit-branch-tools,.dshgit-graph-tools{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-wrap:wrap;flex:none}',
      '.dshgit-branch-toolbar{gap:2px}',
      '.dshgit-branch-toolbar>.dshgit-iconbtn{width:24px;height:24px;box-sizing:border-box;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center}',
      '.dshgit-branch-toolbar>.dshgit-iconbtn>svg{width:16px;height:16px;flex:none}',
      '.dshgit-branch-tree{padding:4px 8px}',
      '.dshgit-branch-folder{min-width:0}',
      '.dshgit-branch-children{padding-left:16px;min-width:0}',
      '.dshgit-branch-folder>summary{display:flex;align-items:center;gap:6px;min-height:32px;padding:4px;box-sizing:border-box;list-style:none;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-branch-folder>summary::-webkit-details-marker{display:none}',
      '.dshgit-branch-folder>summary .dshgit-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-remote-actions{display:none;margin-left:auto;flex:none}',
      '.dshgit-branch-folder>summary:hover .dshgit-remote-actions,.dshgit-branch-folder>summary:focus-within .dshgit-remote-actions,.dshgit-remote-actions[data-busy="true"]{display:flex}',
      '@media(hover:none){.dshgit-remote-actions{display:flex}}',
      '.dshgit-remote-actions>.dshgit-iconbtn{width:24px;height:24px;padding:0}',
      '.dshgit-branch-caret{display:flex;flex:none;width:12px;align-items:center;justify-content:center}',
      '.dshgit-branch-folder[open]>summary .dshgit-branch-caret{transform:rotate(90deg)}',
      '.dshgit-branch-item{display:flex;align-items:center;gap:4px;min-width:0;min-height:32px;padding-right:2px;box-sizing:border-box;border-radius:4px}',
      '.dshgit-branch-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}',
      '.dshgit-branch-item[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
      '.dshgit-branch-select{display:flex;align-items:center;gap:6px;flex:1;min-width:0;min-height:32px;padding:4px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-branch-select .dshgit-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-branch-select>svg,.dshgit-branch-select>.dshgit-tipdot{flex:none}',
      '.dshgit-branch-tracking{flex:none;white-space:nowrap}',
      '.dshgit-branch-upstream{flex:0 2 auto;min-width:0;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-branch-actions{display:none;flex:none;align-items:center;gap:2px}',
      '.dshgit-branch-actions .dshgit-iconbtn{width:24px;height:24px;box-sizing:border-box;padding:0;border-radius:4px;display:flex;align-items:center;justify-content:center}',
      '.dshgit-branch-actions .dshgit-iconbtn>svg{width:16px;height:16px;flex:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}',
      '.dshgit-branch-actions .dshgit-iconbtn:hover:enabled{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
      '.dshgit-branch-actions .dshgit-iconbtn:disabled{opacity:.35;cursor:default;background:transparent}',
      '.dshgit-branch-actions .dshgit-iconbtn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.dshgit-branch-actions .dshgit-spinner{width:12px;height:12px;flex:none}',
      '.dshgit-branch-item:hover .dshgit-branch-actions,.dshgit-branch-item:focus-within .dshgit-branch-actions,.dshgit-branch-item[data-busy="true"] .dshgit-branch-actions{display:flex}',
      '@media(hover:none){.dshgit-branch-actions{display:flex}}',
      '.dshgit-graph-workbench{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.dshgit-graph-scroll{flex:1;min-height:0;overflow:auto}',
      '.dshgit-graph-record{display:flex;align-items:center;min-width:0;height:32px}',
      '.dshgit-graph-record[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
      '.dshgit-graph-select{display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:32px;padding:0 8px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-graph-select .dshgit-subject{flex:1;min-width:80px}',
      '.dshgit-graph-tip{padding:1px 5px;border-radius:3px;font-size:var(--dshgit-font-small);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));white-space:nowrap}',
      '.dshgit-graph-tip[data-kind="remote"]{border-left:2px solid var(--dsw-alias-state-success-primary,#3b9b65)}',
      '.dshgit-graph-tip[data-kind="local"]{border-left:2px solid var(--dsw-alias-brand-primary)}',
      '.dshgit-graph-tip[data-kind="tag"]{border-left:2px solid var(--dsw-alias-state-warn-primary,#bd923f)}',
      '.dshgit-graph-refs{max-height:min(360px,50vh);overflow:auto}',
      '.dshgit-graph-refs .dshgit-menuitem{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-graph-detail{display:flex;flex-direction:column;min-height:160px;overflow:hidden;flex:none}',
      '.dshgit-graph-detail>.dshgit-stash-details{flex:1;min-height:0}',
      '.dshgit-graph-divider{height:8px;flex:none;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent;cursor:row-resize;touch-action:none;padding:0}',
      '.dshgit-workbench-dialog{width:min(640px,100%);max-height:calc(100vh - 48px);overflow:auto}',
      '.dshgit-workbench-fields{display:flex;flex-direction:column;gap:10px}',
      '.dshgit-workbench-field{display:flex;flex-direction:column;gap:6px;margin:12px 0}',
      '.dshgit-workbench-dialog .dshgit-check{display:flex;align-items:center;gap:8px;margin:10px 0}',
      '.dshgit-workbench-dialog .dshgit-dialogactions{flex-wrap:wrap}',
      '.dshgit-workbench-dialog .dshgit-dialogactions .dshgit-btn{white-space:normal}',
      '.dshgit-workbench-dialog.dshgit-createbranch-dialog{width:min(440px,100%);padding:20px;gap:14px;font-size:var(--dshgit-font-body)}',
      '.dshgit-createbranch-dialog .dshgit-workbench-field{margin:0;gap:6px;min-width:0}',
      '.dshgit-createbranch-dialog .dshgit-workbench-field>span{font-size:var(--dshgit-font-small);line-height:1.5}',
      '.dshgit-createbranch-dialog .dshgit-workbench-field>.dshgit-name{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-createbranch-dialog .dshgit-check{margin:0;gap:8px;font-size:var(--dshgit-font-small);line-height:1.5}',
      '.dshgit-createbranch-dialog .dshgit-check input{margin:0;width:14px;height:14px;flex:none;accent-color:var(--dsw-alias-brand-primary)}',
      '.dshgit-createbranch-dialog .dshgit-dialogactions{margin-top:2px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);gap:8px}',
      '.dshgit-workbench-dialog input:not([type=checkbox]),.dshgit-workbench-dialog textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px;font:inherit}',
      '.dshgit-workbench-preview{padding:10px 0;margin:8px 0;line-height:1.7}',
      '.dshgit-recovery-record{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-workbench-preview{max-height:240px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-workbench-recovery{padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '@media(max-width:760px){.dshgit-graph-author,.dshgit-graph-time{display:none}.dshgit-graph-detail{height:auto!important;flex:1}.dshgit-graph-workbench:has(.dshgit-graph-detail)>.dshgit-graph-scroll{display:none}}',
      // The type ramp, derived from DSH's own content font size.
      //
      // DSH's Settings → Font size writes `--dsh-content-font-size` (12–17px,
      // default 14) onto `body`, and the shipped UI sizes its conversation
      // surfaces from it. Declaring the ramp on `body` means every plugin
      // surface inherits it — including the portalled popovers, the file viewer
      // and the confirm bar, which are appended to `body` rather than nested in
      // the window they came from.
      //
      // The offsets follow the host's size preference with readable minimums.
      'body{--dshgit-font-base:var(--dsh-content-font-size, 14px);' +
        '--dshgit-font-micro:max(10px, calc(var(--dshgit-font-base) - 4px));' +
        '--dshgit-font-meta:max(11px, calc(var(--dshgit-font-base) - 3px));' +
        '--dshgit-font-small:max(12px, calc(var(--dshgit-font-base) - 2px));' +
        '--dshgit-font-body:max(12px, calc(var(--dshgit-font-base) - 1px));' +
        '--dshgit-font-lead:max(13px, calc(var(--dshgit-font-base) - 1px));' +
        '--dshgit-font-title:max(13px, var(--dshgit-font-base));' +
        '--dshgit-font-glyph:calc(var(--dshgit-font-base) + 2px);' +
        '--dshgit-font-glyph-lg:calc(var(--dshgit-font-base) + 3px)}',
      '.dshgit{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dshgit-font-lead)}',
      // ---- workbench shell ----
      // A large CENTRED window, not a full-viewport one. It opened filling the
      // viewport and the first thing anyone said was "the window is too big":
      // a tool window should sit over the conversation, not replace it. 1180×780
      // keeps the four regions (title bar / activity bar / sidebar + editor /
      // status bar) distinguishable on a 1440×900 screen while leaving the
      // session visible around it; both dimensions shrink with the viewport.
      //
      // The fill is OPAQUE, unlike the floating menu material it borrows its
      // elevation from. `--dsw-menu-surface-fill` is ~45% alpha and is designed
      // to be read through a 40px backdrop blur at menu size; at this size that
      // much transparency turns the conversation behind it into visible noise
      // under 11px status text, and the blur cannot be relied on (it is
      // unavailable on some GPU paths). An opaque raised layer keeps the dense
      // small text legible in both themes.
      '.dshgit-workbench{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1150;display:flex;flex-direction:column;width:min(1180px,94vw);height:min(780px,88vh);pointer-events:auto;overflow:hidden;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.28));isolation:isolate}',
      // The hairline stroke the shipped elevations use, drawn as an inset ring so
      // it survives the translucent fill.
      '.dshgit-workbench::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
      // Leave the host title bar accessible; this only expands the plugin surface.
      '.dshgit-workbench[data-maximized="true"]{left:12px;right:12px;top:56px;bottom:12px;transform:none;width:auto;height:auto}',
      '.dshgit-workbench:not([data-maximized="true"]){max-width:calc(100vw - 24px);max-height:calc(100vh - 72px)}',
      '.dshgit-titlebar[data-draggable="true"]{cursor:grab;touch-action:none;user-select:none}',
      // Title and status strips are opaque too: they sit directly over whatever
      // is behind the panel's rounded corners.
      '.dshgit-titlebar,.dshgit-statusbar{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}',
      // The title bar is identity + actions only. Everything merely informational
      // moved to the status bar, which is what let this row stop wrapping.
      '.dshgit-titlebar{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:0 8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-titlebar>*{position:relative;z-index:2}',
      '.dshgit-brand{display:flex;align-items:center;gap:6px;flex:none;font-weight:600;font-size:var(--dshgit-font-title)}',
      // Repository identity: the full path, allowed to shrink with an ellipsis.
      // It keeps `flex:0 1 auto` so it yields space before the sync controls do —
      // the controls are actions, the path is a label.
      '.dshgit-crumbs{display:flex;align-items:center;min-width:0;flex:0 1 auto;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-body)}',
      '.dshgit-crumb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dshgit-crumb-sep{opacity:.55;flex:none}',
      '.dshgit-crumb-strong{color:var(--dsw-alias-label-primary);flex:none;font-weight:600}',
      '.dshgit-spacer{flex:1;min-width:0}',
      '.dshgit-tools{display:flex;align-items:center;gap:4px;flex:none}',
      // Window controls. 26px hit area with a 15px glyph, per the 44px touch
      // guidance scaled down for a pointer-only desktop surface.
      '.dshgit-winbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:var(--dshgit-font-lead);line-height:1;flex:none}',
      '.dshgit-winbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
      '.dshgit-winbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshgit-title-tools,.dshgit-window-controls{display:flex;align-items:center;gap:2px;flex:none}',
      '.dshgit-window-controls{border-left:1px solid var(--dsw-alias-border-l1);padding-left:8px}',
      '.dshgit-titlebar .dshgit-winbtn{width:28px;height:28px;box-sizing:border-box}',
      '.dshgit-titlebar .dshgit-winbtn>svg{width:16px;height:16px;flex:none}',
      '.dshgit-titlebar .dshgit-spinner{width:16px;height:16px;box-sizing:border-box;flex:none}',
      '.dshgit-titlebar .dshgit-winbtn:disabled{opacity:.4;cursor:default}',
      '.dshgit-window-controls .dshgit-window-close:hover{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.dshgit-body{display:flex;flex:1;min-height:0}',
      // ---- activity bar ----
      '.dshgit-activitybar{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none;width:48px;padding:6px 0;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-activity-item{position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color .15s ease, background-color .15s ease}',
      '.dshgit-activity-item:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
      // The active marker is a left accent bar plus the label colour. `aria-pressed`
      // drives it so the visual state cannot drift from the announced state.
      //
      // The bar is offset by exactly the item's own gutter (-4px), which puts it
      // flush against the rail's left edge — i.e. the panel's edge, where VS Code
      // draws it. A larger negative offset would paint OUTSIDE the workbench and
      // be silently cut off by its `overflow:hidden`, which is how this marker was
      // invisible the first time it was written.
      //
      // The bar uses the accent fill (not `brand-primary`, which is a label
      // token) so it reads as the app's accent colour in both themes.
      '.dshgit-activity-item[aria-pressed="true"]{color:var(--dsw-alias-label-primary)}',
      '.dshgit-activity-item[aria-pressed="true"]::before{content:"";position:absolute;left:-4px;top:8px;bottom:8px;width:2px;border-radius:0 2px 2px 0;background:var(--dsw-alias-state-business-primary)}',
      '.dshgit-activity-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      // The badge is an ACCENT FILL, so it uses the accent fill token paired with
      // `label-primary-foreground` — the same pairing DSH's own primary button
      // uses for text on an accent surface. `--dsw-alias-brand-primary` is NOT a
      // fill: it is a label colour (near-white in dark, near-black in light), so
      // using it as a background produced an invisible white-on-white badge.
      '.dshgit-activity-badge{position:absolute;right:2px;bottom:2px;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);font-size:var(--dshgit-font-micro);line-height:15px;text-align:center;font-weight:600}',
      // ---- sidebar ----
      '.dshgit-sidebar{display:flex;flex-direction:column;flex:none;width:272px;min-width:180px;max-width:420px;border-right:1px solid var(--dsw-alias-border-l1);overflow:hidden}',
      '.dshgit-changes-list{padding:0 8px 8px}',
      '.dshgit-changes-list .dshgit-changegroup + .dshgit-changegroup{margin-top:12px}',
      '.dshgit-changes-list .dshgit-changegroupbar{background:transparent;padding:3px 0}',
      '.dshgit-group-primary{opacity:1}',
      '.dshgit-changegroupbar .dshgit-group-primary .dshgit-iconbtn{width:auto;padding:2px 4px;font-size:var(--dshgit-font-small);white-space:nowrap}',
      '.dshgit-sidebar-composer{flex:none;max-height:50%;overflow:auto;padding:10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-sidebar-composer .dshgit-card{padding:0;margin:0;border:0;background:transparent}',
      '.dshgit-sidebar-composer .dshgit-textarea{height:72px;min-height:52px;resize:vertical}',
      '.dshgit-sidebar-composer .dshgit-commit-split{margin-top:0}',
      '.dshgit-changes-list .dshgit-change:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshgit-stash-list{display:flex;flex-direction:column;gap:4px;padding:4px 8px}',
      '.dshgit-stash-row{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:9px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-stash-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
      '.dshgit-stash-item:has(.dshgit-stash-row[aria-pressed="true"]){background:var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.24));box-shadow:inset 2px 0 var(--dsw-alias-brand-primary)}',
      '.dshgit-stash-row .dshgit-name{width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshgit-stash-details{height:100%;min-height:0;display:flex;flex-direction:column}',
      '.dshgit-stash-details > .dshgit-card{flex:none;margin-bottom:0}',
      '.dshgit-stash-detailbody{display:flex;flex:1;min-height:0}',
      '.dshgit-stash-filenav{width:220px;min-width:0;flex:none;display:flex;flex-direction:column;padding:8px;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-stash-filelist{flex:1;min-height:0;overflow:auto;margin-top:8px}',
      '.dshgit-stash-diff{flex:1;min-width:0;overflow:auto}',
      '.dshgit-filediff{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;overflow:hidden;margin:10px}',
      '.dshgit-filediff-head{display:flex;align-items:center;gap:8px;padding:9px 12px;min-height:42px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08))}',
      '.dshgit-diff-pathcopy{display:flex;align-items:center;gap:5px;flex:1;min-width:0}',
      '.dshgit-diff-pathcopy .dshgit-previewpath{flex:none;min-width:0;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.dshgit-diffstats{display:inline-flex;align-items:center;gap:7px;flex:none;font-size:var(--dshgit-font-small);white-space:nowrap}',
      '.dshgit-diff-added{color:var(--dshgit-success-text)}',
      '.dshgit-diff-deleted{color:var(--dsw-alias-state-error-primary, #d24b40)}',
      '.dshgit-stash-preview{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}',
      '.dshgit-stash-previewtools{display:flex;align-items:center;gap:10px;padding:6px 10px;flex:none}',
      '.dshgit-fileview-switch{display:flex;gap:4px;padding:6px 0;flex:none}',
      '.dshgit-fileview-switch .dshgit-iconbtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
      // The list/tree toggle rides ON the search row, the way every other file
      // list in this plugin arranges it (`.dshgit-cl-search`). On a row of its own
      // it was two small icons alone across the full column width with the list
      // starting underneath — a toolbar that looked detached from what it governs.
      // The row carries no padding of its own: the file column already pads.
      '.dshgit-stash-searchrow{display:flex;align-items:center;gap:8px}',
      '.dshgit-stash-searchrow>.dshgit-input{flex:1;min-width:0}',
      '.dshgit-stash-searchrow .dshgit-fileview-switch{padding:0}',
      '.dshgit-filefolder{padding-left:9px;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-filefolder > summary{padding:6px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-stash-filelist .dshgit-diffstats{margin-left:auto;font-size:var(--dshgit-font-small)}',
      '.dshgit-list-more{display:block;margin:8px auto}',
      '.dshgit-changes-list > .dshgit-input{margin:6px 0}',
      '@media(max-width:760px){.dshgit-stash-detailbody{flex-direction:column}.dshgit-stash-filenav{width:auto;max-height:180px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}}',
      '.dshgit-stash-item{display:flex;flex-direction:column;align-items:stretch;min-width:0;border-radius:4px;overflow:hidden}',
      '.dshgit-stash-item .dshgit-stash-row{width:100%;min-width:0;border-radius:0;padding:8px 10px 4px}',
      '.dshgit-stash-footer{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;padding:0 8px 6px 10px}',
      '.dshgit-stash-meta{flex:1 1 90px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dshgit-font-small);text-align:left;cursor:pointer}',
      '.dshgit-stash-row-actions{display:flex;flex:none;align-items:center;gap:4px;margin-left:auto;opacity:0;pointer-events:none}',
      '.dshgit-stash-item:hover .dshgit-stash-row-actions,.dshgit-stash-item:focus-within .dshgit-stash-row-actions,.dshgit-stash-row-actions:has([aria-busy="true"]){opacity:1;pointer-events:auto}',
      '@media(hover:none){.dshgit-stash-row-actions{opacity:1;pointer-events:auto}}',
      '.dshgit-stash-row-action{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshgit-stash-row-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
      '.dshgit-stash-row-action svg,.dshgit-stash-row-action .dshgit-spinner{flex:none}',
      '.dshgit-stash-row-action[data-stash-action="drop"]:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-stash-row-action:disabled{opacity:.45;cursor:default}',
      '.dshgit-stash-row-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshgit-stash-row .dshgit-muted{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-sidebar-head{display:flex;align-items:center;gap:6px;flex:none;padding:7px 10px;font-size:var(--dshgit-font-small);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-sidebar-body{flex:1;min-height:0;overflow:auto}',
      '.dshgit-sidebar-search{padding:8px 10px 4px}',
      '.dshgit-branch-search{display:flex;align-items:center;gap:6px}',
      '.dshgit-branch-search>.dshgit-input{flex:1;min-width:0}',
      '.dshgit-branch-search .dshgit-iconbtn{width:28px;height:28px;padding:0;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center}',
      '.dshgit-branch-filter-active>.dshgit-iconbtn{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-brand-primary)}',
      '.dshgit-sidebar-hint{padding:8px 10px;font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-history-scope{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dshgit-history-scope>.dshgit-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-history-scope>.dshgit-iconbtn{flex:none;width:28px;height:28px;padding:0}',
      '.dshgit-sidebar-actions{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      // A sidebar row that is a real control (not a div with a click handler):
      // keyboard reachable for free, and announced as a button.
      '.dshgit-rowbtn{width:100%;border:0;background:transparent;color:inherit;font-family:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
      '.dshgit-visibility-options{display:flex;flex-direction:column;gap:8px;margin-top:10px}',
      '.dshgit-visibility-option{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-visibility-option:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}',
      '.dshgit-visibility-option[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary,#007acc);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#007acc) 12%,transparent)}',
      '.dshgit-visibility-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#007acc);outline-offset:2px}',
      '.dshgit-visibility-option:disabled{opacity:.55;cursor:default}',
      '.dshgit-visibility-radio{display:grid;place-items:center;flex:none;width:16px;height:16px;box-sizing:border-box;border:2px solid var(--dsw-alias-label-tertiary,#888);border-radius:50%}',
      '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-radio{border-color:var(--dsw-alias-brand-primary,#007acc)}',
      '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary,#007acc)}',
      '.dshgit-visibility-label{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dshgit-visibility-label>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-visibility-title{font-weight:600}',
      '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-title{color:var(--dsw-alias-brand-primary,#007acc)}',
      '.dshgit-filterchip{display:flex;align-items:center;gap:6px;margin:0 10px 6px;padding:3px 4px 3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16));font-size:var(--dshgit-font-small)}',
      '.dshgit-kvrow{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:var(--dshgit-font-body)}',
      '.dshgit-tipdot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary)}',
      '.dshgit-loglist{display:flex;flex-direction:column}',
      // ---- settings ----
      '.dshgit-settings-group{margin-bottom:18px}',
      '.dshgit-settings-grouphead{font-size:var(--dshgit-font-small);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:0 0 8px}',
      // A module with nothing to list drops the sidebar entirely rather than
      // showing an empty column: an empty 272px gutter reads as a failed load.
      '.dshgit-sidebar[data-empty="true"]{display:none}',
      // ---- editor ----
      '.dshgit-editor{display:flex;flex-direction:column;flex:1;min-width:0;overflow:hidden}',
      '.dshgit-editor-head{display:flex;align-items:center;gap:8px;flex:none;min-height:34px;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-editor-body{flex:1;min-height:0;overflow:auto}',
      // ---- status bar ----
      '.dshgit-statusbar{display:flex;align-items:center;gap:12px;flex:none;height:24px;padding:0 10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden}',
      '.dshgit-statusbar>*{flex:none}',
      '.dshgit-statusitem{display:inline-flex;align-items:center;gap:4px}',
      '.dshgit-statusbranch{color:var(--dsw-alias-label-secondary)}',
      '.dshgit-pane{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.dshgit-left{width:290px;max-width:36%;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto}',
      '.dshgit-center{flex:1;overflow:auto}',
      '.dshgit-right{width:min(320px,32%);flex:none;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto}',
      '.dshgit-treechildren{margin-left:12px;border-left:1px solid var(--dsw-alias-border-l1);padding-left:5px}',
      '.dshgit-repotree>.dshgit-sectionbar{font-size:var(--dshgit-font-lead)}',
      '.dshgit-repotree .dshgit-section{padding:5px 2px 5px 8px;border-bottom:0}',
      '.dshgit-treerow{display:flex;align-items:center;gap:5px;min-height:27px;min-width:0;padding:2px 4px;border-radius:4px;cursor:pointer}',
      '.dshgit-treerow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
      '.dshgit-treerow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.2))}',
      '.dshgit-treerow .dshgit-name{font-size:var(--dshgit-font-body)}',
      '.dshgit-treeactions{display:flex;gap:1px;flex:none;opacity:0}',
      '.dshgit-treerow:hover .dshgit-treeactions,.dshgit-treerow:focus-within .dshgit-treeactions{opacity:1}',
      '.dshgit-commitfiles{display:flex;gap:10px;min-height:0}',
      '.dshgit-commitfiles-nav{width:220px;max-width:32%;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto}',
      '.dshgit-commitfiles-main{flex:1;min-width:0;overflow:auto}',
      '.dshgit-section{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-sectionbar{display:flex;align-items:center;gap:4px}',
      '.dshgit-sectionbar .dshgit-sectionhead{flex:1;min-width:0}',
      '.dshgit-sectionactions{display:flex;align-items:center;gap:2px;flex:none}',
      '.dshgit-sectionbar .dshgit-iconbtn{width:24px;height:24px;font-size:var(--dshgit-font-glyph-lg)}',
      '.dshgit-sectionbar .dshgit-iconbtn:disabled{opacity:.35;cursor:default}',
      '.dshgit-changes-section .dshgit-sectionbar{padding:3px 5px;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18))}',
      '.dshgit-changes-section .dshgit-sectionhead{font-size:var(--dshgit-font-lead);text-transform:none;letter-spacing:0;color:var(--dsw-alias-label-primary)}',
      '.dshgit-sectionbar .dshgit-sectioncount{margin-left:2px}',
      '.dshgit-changegroup{min-width:0}',
      '.dshgit-changegroupbar{display:flex;align-items:center;gap:3px;min-height:28px;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14))}',
      '.dshgit-changegrouphead{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:2px 3px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
      '.dshgit-changegrouphead .dshgit-caret{width:14px;flex:none}',
      '.dshgit-changegrouphead span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-changegroupactions{display:flex;align-items:center;gap:1px;opacity:0;flex:none}',
      '.dshgit-changegroupbar:hover .dshgit-changegroupactions,.dshgit-changegroupbar:focus-within .dshgit-changegroupactions{opacity:1}',
      '.dshgit-changegroupbar .dshgit-iconbtn{width:25px;height:25px}',
      '.dshgit-changegroupbar .dshgit-sectioncount{margin-left:2px;flex:none}',
      '.dshgit-commitlists .dshgit-changegroup{margin-top:5px}',
      '.dshgit-subgroup{padding:7px 6px 3px;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-small);font-weight:600}',
      '.dshgit-remoteurl{padding:0 6px 3px;font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-sectionhead{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:var(--dshgit-font-small);text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);padding:4px 2px;background:0 0;border:none;font-family:inherit;width:100%;text-align:left}',
      '.dshgit-sectionhead:hover{color:var(--dsw-alias-label-secondary)}',
      '.dshgit-sectioncount{margin-left:auto;min-width:18px;padding:1px 6px;border-radius:999px;text-align:center;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.22));color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
      '.dshgit-caret{width:10px;display:inline-block;font-size:var(--dshgit-font-micro);opacity:.7}',
      '.dshgit-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;cursor:pointer;min-width:0}',
      '.dshgit-row:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
      '.dshgit-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
      '.dshgit-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-muted{color:var(--dsw-alias-label-secondary)}',
      '.dshgit-dim{color:var(--dsw-alias-label-secondary)}',
      '.dshgit-add{color:var(--dshgit-success-text)}',
      '.dshgit-del{color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-badge{font-size:var(--dshgit-font-meta);padding:0 4px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);flex:none}',
      '.dshgit-status{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small);width:20px;flex:none;text-align:center}',
      '.dshgit-change{position:relative;min-height:28px;gap:8px;padding:2px 7px}',
      '.dshgit-change[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(0,120,215,.25))}',
      '.dshgit-fileicon{width:17px;height:17px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;font-size:var(--dshgit-font-micro);font-weight:700;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshgit-fileicon{background:var(--dshgit-file-bg,var(--dsw-alias-bg-layer-2));color:var(--dshgit-file-fg,var(--dsw-alias-label-primary));font-family:Arial,sans-serif;line-height:1}',
      '.dshgit-fileicon[data-long="true"]{font-size:calc(var(--dshgit-font-micro) * .8);letter-spacing:-.3px}',
      '.dshgit-fileicon>svg{width:17px;height:17px;display:block}',
      '.dshgit-filelabel{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}',
      '.dshgit-filename{overflow:hidden;text-overflow:ellipsis;flex:none;max-width:70%;font-size:var(--dshgit-font-body);line-height:1.45}',
      '.dshgit-filedir{overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
      '.dshgit-change .dshgit-status{margin-left:auto;color:var(--dshgit-success-text);font-weight:600}',
      '.dshgit-change[data-status="D"] .dshgit-status,.dshgit-change[data-status="!"] .dshgit-status{color:var(--dsw-alias-state-error-primary)}',
      // Reveal on hover or focus. `opacity`, not `display:none`: an element with
      // `display:none` cannot receive focus, so `:focus-within` could never be
      // satisfied by these buttons and Tab skipped them entirely. They are
      // absolutely positioned, so hiding them this way costs no layout.
      '.dshgit-change-actions{position:absolute;right:30px;top:50%;transform:translateY(-50%);opacity:0;pointer-events:none;display:flex;align-items:center;gap:2px;padding:1px 2px;border-radius:4px;background:var(--dsw-alias-bg-layer-2, var(--dsw-menu-surface-fill));box-shadow:var(--dsw-elevation-prominent, 0 2px 8px rgba(0,0,0,.2))}',
      '.dshgit-change:hover .dshgit-change-actions,.dshgit-change:focus-within .dshgit-change-actions{opacity:1;pointer-events:auto}',
      '.dshgit-change-action{font:inherit;font-size:var(--dshgit-font-glyph);line-height:calc(var(--dshgit-font-base) + 6px);width:22px;height:22px;padding:0;border:none;border-radius:3px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dshgit-change-action:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.18))}',
      '.dshgit-change-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      // Partially staged rows are flagged so the reason they appear twice is
      // visible without hovering.
      '.dshgit-partial .dshgit-status{color:var(--dshgit-warning-text);font-weight:600}',
      '.dshgit-iconbtn:focus-visible,.dshgit-btn:focus-visible,.dshgit-menuitem:focus-visible,.dshgit-rowbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #007acc);outline-offset:2px}',
      '@media(pointer:coarse){.dshgit-iconbtn,.dshgit-branch-actions .dshgit-iconbtn,.dshgit-branch-toolbar>.dshgit-iconbtn{min-width:32px;min-height:32px}}',
      '.dshgit-btn{font:inherit;font-size:var(--dshgit-font-body);padding:3px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:inherit;cursor:pointer;white-space:nowrap}',
      '.dshgit-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshgit-btn:disabled{opacity:.45;cursor:default}',
      // A toggle (`aria-pressed`) has to look different when it is on, or the
      // only feedback is the tooltip — which is invisible on touch and easy to
      // miss with a mouse. Brand colour + a filled tint reads as "on" at a
      // glance without relying on hover.
      '.dshgit-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)}',
      '.dshgit-btn[aria-pressed="true"]:hover{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)}',
      '.dshgit-btn-primary{border-color:var(--dsw-alias-state-business-primary);color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 90%,var(--dsw-alias-label-primary))}',
      '.dshgit-btn-primary:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}',
      '.dshgit-commit-actions{display:flex;flex-direction:column;gap:8px}',
      '.dshgit-commit-checks{display:flex;flex-direction:column;gap:6px}',
      '.dshgit-commit-check{display:flex;align-items:center;gap:7px;font-size:var(--dshgit-font-small);cursor:pointer}',
      '.dshgit-commit-check[data-disabled="true"]{opacity:.45;cursor:default}',
      '.dshgit-commit-check input{flex:none;margin:0;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary, #007acc)}',
      // The commit control is one joined split button: the label runs the action,
      // the chevron holds the alternate remote steps. Both halves use the host's
      // blue button fill and hover tokens, with theme-aware foreground colours.
      '.dshgit-commit-split{position:relative;display:inline-flex;align-items:stretch;width:auto;max-width:100%;min-width:0}',
      '.dshgit-commit-primary{display:flex;align-items:center;justify-content:center;gap:6px;flex:0 1 auto;min-width:0;min-height:28px;padding:4px 12px;border:0;border-radius:6px 0 0 6px;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground);font-size:var(--dshgit-font-body);font-weight:500;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
      '.dshgit-commit-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary)}',
      // Without a menu the label owns both corners, or the flat right edge reads
      // as a rendering bug.
      '.dshgit-commit-split[data-has-menu="false"] .dshgit-commit-primary{border-radius:6px}',
      '.dshgit-btn.dshgit-commit-primary:disabled{opacity:1;cursor:default}',
      '.dshgit-commit-primary svg{flex:none}',
      '.dshgit-commit-menu-root{position:relative;display:block!important;flex:none;width:28px}',
      // The seam follows the button foreground, including dark-on-light buttons.
      '.dshgit-commit-arrow{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:28px;padding:0;border:0;border-left:1px solid color-mix(in srgb,var(--dsw-alias-label-primary-foreground) 32%,transparent);border-radius:0 6px 6px 0;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground);cursor:pointer}',
      '.dshgit-commit-arrow:hover:not(:disabled),.dshgit-commit-arrow[aria-expanded="true"]{background:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary)}',
      '.dshgit-commit-arrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      // ---- unavailable split button ----
      // The two halves are one control, so an unavailable state must grey BOTH.
      // Keyed off the container rather than each `:disabled` so a future change to
      // one half cannot leave the other looking live — which is exactly how the
      // chevron ended up saturated blue beside a greyed-out label. The seam is
      // dropped too, since there is no fill left for it to divide.
      //
      // The fill is a translucent TINT, not `bg-layer-2`: that layer is opaque and
      // equals the panel it sits on (white on white in the light theme), so the
      // button dissolved into the background and only its text remained. The tint
      // darkens or lightens whatever is behind it and is therefore visible on every
      // surface, and the ring gives the shape an edge so it still reads as a
      // control. The ring is a pseudo-element OVERLAY rather than a per-half
      // border: a border would add 2px to each half's box and shift the layout,
      // and two per-half rings would double up along the seam.
      '.dshgit-commit-split[data-disabled="true"] .dshgit-commit-primary,.dshgit-commit-split[data-disabled="true"] .dshgit-commit-arrow{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);cursor:default}',
      // The seam STAYS: it is what tells the user the chevron is a separate hit
      // area, and that is still true when the control is unavailable. It cannot
      // keep the enabled rule's white, though — that was tuned for the blue fill
      // and is invisible on a pale tint in the light theme — so it switches to the
      // theme's own border colour, which adapts to whatever it is drawn over.
      '.dshgit-commit-split[data-disabled="true"] .dshgit-commit-arrow{border-left-color:var(--dsw-alias-border-l3)}',
      '.dshgit-commit-split[data-disabled="true"]::after{content:"";position:absolute;inset:0;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);pointer-events:none}',
      '.dshgit-commit-arrow:disabled{opacity:1;cursor:default}',
      '.dshgit-menu.dshgit-commit-options{min-width:190px;z-index:1410}',
      '.dshgit-commit-validation{color:var(--dsw-alias-state-error-primary);font-size:var(--dshgit-font-small)}',
      '.dshgit-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
      '.dshgit-input,.dshgit-textarea{font:inherit;font-size:var(--dshgit-font-body);padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;outline:none;width:100%;box-sizing:border-box}',
      '.dshgit-input:focus,.dshgit-textarea:focus{border-color:var(--dsw-alias-border-l2)}',
      '.dshgit-input:focus-visible,.dshgit-textarea:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:var(--dsw-alias-state-business-primary)}',
      '.dshgit-input::placeholder,.dshgit-textarea::placeholder,.dshgit-pickerinput::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}',
      // ---- filterable combobox ----
      // The list is portalled to `body`, not nested: the workbench header sits in
      // a shell with `overflow:hidden` and a `backdrop-filter`, and a fixed
      // descendant of either is clipped or re-attached to that box. Portalling
      // sidesteps both, and it lets the list escape the dialog's own bounds.
      '.dshgit-combolist{position:fixed;z-index:1450;max-height:min(300px,46vh);overflow-y:auto;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3));box-sizing:border-box}',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-combolist{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-combooption{display:flex;align-items:center;gap:6px;width:100%;padding:5px 7px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
      // The highlighted row needs a visible state even without hover: the pointer
      // sits still while the arrow keys move the selection.
      '.dshgit-combooption[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
      '.dshgit-combooptioncurrent{font-weight:600}',
      '.dshgit-combocheck{flex:none;width:12px;color:var(--dsw-alias-brand-primary)}',
      '.dshgit-combolabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-combogroup{padding:5px 7px 2px;font-size:var(--dshgit-font-meta);letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-comboempty{padding:8px 7px;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-comboinput{cursor:text}',
      '.dshgit-comboinput::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}',
      '.dshgit-commit-composer{box-sizing:border-box;gap:6px;padding:10px;border-radius:6px}',
      '.dshgit-commit-composer .dshgit-textarea{height:60px;min-height:52px;max-height:180px;padding:7px 9px;font-family:inherit;resize:vertical}',
      // Scope text on the left, commit action on the right, ONE line. `baseline`
      // would misalign a bordered control against plain text, so the row centres.
      '.dshgit-commit-meta{display:flex;align-items:center;gap:8px;min-width:0}',
      // The scope text yields to the button rather than pushing it onto a second
      // line: a wrapped row leaves the button stranded at the right of an empty
      // line under left-aligned text, which is what "not neat" looked like. It
      // ellipsizes instead, so the row keeps its shape at any sidebar width.
      '.dshgit-commit-meta>.dshgit-muted{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);line-height:1.5}',
      // `margin-left:auto` pins the action to the right edge, so the row reads as
      // "what + do it" and the button lines up with the panel's other right-hand
      // controls instead of floating in the middle of the row.
      '.dshgit-commit-meta>.dshgit-commit-actions{flex:0 0 auto;min-width:0;margin-left:auto}',
      // The message box is the field; the AI trigger is pinned to ITS top-right
      // corner rather than sitting in a row underneath. Below the box it read as
      // a second action competing with Commit, and it cost a whole row of height
      // in a sidebar that is already the shortest thing on screen. Inside the
      // corner it is unambiguously "fills this box".
      '.dshgit-commit-field{position:relative;display:flex;min-width:0}',
      // Reserve the glyph's lane so a long first line never runs underneath it.
      '.dshgit-commit-field[data-ai="true"] .dshgit-textarea{padding-right:34px}',
      '.dshgit-commit-ai{position:absolute;top:6px;right:6px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dshgit-font-body);line-height:1;cursor:pointer}',
      '.dshgit-commit-ai:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary)}',
      '.dshgit-commit-ai:disabled{opacity:.45;cursor:default}',
      '.dshgit-commit-ai:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshgit-commit-composer .dshgit-commit-actions{flex-direction:row;align-items:center;flex-wrap:wrap;gap:6px 10px}',
      // The popover is a wide panel, so its commit button is an ordinary primary
      // action: right-aligned with a comfortable basis. It deliberately does NOT
      // reuse the sidebar's tuning — that exists to fit a 272px column.
      '.dshgit-commit-composer .dshgit-commit-split{flex:0 1 auto;width:auto;max-width:100%;margin-left:auto}',
      '.dshgit-commit-composer .dshgit-commit-primary{flex:0 1 auto;min-width:0;padding:4px 16px}',
      // ---- sidebar-sized commit row ----
      // A measured 150px basis gives the button the presence of a primary action
      // at normal widths, while `flex-shrink:1` + `min-width:0` lets it give room
      // back to the scope text. A hard `min-width` is what breaks here: it stops
      // the button shrinking, so a long label ("12345 files selected") plus a
      // narrow sidebar pushes the chevron off the right edge where it cannot be
      // clicked at all. The label ellipsizes, so the row always fits instead.
      // The scope text yields first: it is the secondary information and it has a
      // tooltip, so capping it at half the row guarantees the action keeps its
      // room. The button gets NO hard `min-width` — any floor large enough to keep
      // the label legible is also large enough to push the chevron off the edge of
      // the narrowest sidebar, where it cannot be clicked at all. Its width comes
      // from the 150px basis, which is what actually sets its size in practice.
      '.dshgit-sidebar-composer .dshgit-commit-meta>.dshgit-muted{flex:0 1 auto;max-width:50%}',
      '.dshgit-sidebar-composer .dshgit-commit-actions{flex:0 1 auto;min-width:0}',
      '.dshgit-sidebar-composer .dshgit-commit-split{flex:0 1 150px;min-width:0}',
      '.dshgit-sidebar-composer .dshgit-commit-primary{box-sizing:border-box;min-width:0;padding:4px 12px;line-height:18px}',
      '.dshgit-sidebar-composer .dshgit-commit-composer .dshgit-textarea{height:60px}',
      '.dshgit-empty{padding:20px 14px;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-body);line-height:1.7}',
      '.dshgit-setup{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
      '.dshgit-setup-card{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin:auto;color:var(--dsw-alias-label-primary)}',
      '.dshgit-setup-icon{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshgit-setup-title{font-size:var(--dshgit-font-title);font-weight:600;line-height:1.5}',
      '.dshgit-setup-hint{font-size:var(--dshgit-font-body);line-height:1.7;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-setup-path{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:var(--dshgit-font-small);line-height:1.6;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-setup-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}',
      '.dshgit-setup-actions .dshgit-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 12px;box-sizing:border-box}',
      '.dshgit-setup-error{font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dshgit-err{color:var(--dsw-alias-state-error-primary);font-size:var(--dshgit-font-body);padding:6px 10px;line-height:1.6}',
      '.dshgit-preview-more{position:sticky;left:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
      '.dshgit-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body);line-height:1.55;white-space:pre;overflow-x:auto}',
      '.dshgit-coderow{display:flex;min-width:max-content}',
      // Word wrap. `min-width:max-content` on the row is what makes the code
      // pane scroll horizontally instead of wrapping; turning it off (and letting
      // the text break) is the whole feature. The gutter stays aligned because
      // the number is its own column either way.
      '.dshgit-code[data-wrap="true"]{white-space:pre-wrap;overflow-x:hidden}',
      '.dshgit-code[data-wrap="true"] .dshgit-coderow{min-width:0}',
      '.dshgit-code[data-wrap="true"] .dshgit-codetext{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}',
      '.dshgit-gutter{flex:none;width:48px;text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary);user-select:none;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-blamecol{flex:none;width:230px;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-right:1px solid var(--dsw-alias-border-l1);user-select:none}',
      '.dshgit-codetext{flex:1;padding-left:10px;padding-right:16px}',
      '.dshgit-previewhead{display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0;flex-wrap:nowrap}',
      '.dshgit-card.dshgit-previewhead{flex-direction:row}',
      '.dshgit-previewpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.dshgit-previewactions{display:flex;align-items:center;gap:6px;flex:none}',
      // Code colouring comes from Shiki's `css-variables` theme, which reads the
      // `--shiki-token-*` custom properties the DSH theme package defines. There
      // is deliberately no palette here: a second one would drift from the rest
      // of the app and would not follow light/dark.
      '.dshgit-coderow[data-hover="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))}',
      '.dshgit-diffrow{display:flex;min-width:max-content;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body);line-height:1.55}',
      '.dshgit-diffrow[data-kind="add"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}',
      '.dshgit-diffrow[data-kind="del"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}',
      '.dshgit-diffrow[data-kind="hunk"]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08))}',
      // Two independently aligned number columns. Right-aligning each within its
      // own fixed box is what keeps the old-line numbers in the old column and
      // the new-line numbers in the new one on every row kind — including a
      // deletion, where the new column is empty.
      '.dshgit-diffgutter{flex:none;display:flex;gap:6px;padding-right:10px;color:var(--dsw-alias-label-tertiary);user-select:none}',
      '.dshgit-diffnum{flex:none;width:36px;text-align:right;font-variant-numeric:tabular-nums}',
      '.dshgit-diffmarker{flex:none;width:18px;text-align:center;font-weight:700;user-select:none}',
      '.dshgit-diffrow[data-kind="add"] .dshgit-diffmarker{color:var(--dshgit-success-text)}',
      '.dshgit-diffrow[data-kind="del"] .dshgit-diffmarker{color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-hunkhead{padding:6px 10px;font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-history-heading{display:flex;align-items:flex-start;gap:12px;min-width:0}',
      '.dshgit-history-subject{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600;font-size:var(--dshgit-font-title);line-height:1.5}',
      '.dshgit-history-heading>.dshgit-iconbtn{flex:none;width:28px;height:28px;padding:0}',
      '.dshgit-history-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small);line-height:1.6;overflow-wrap:anywhere}',
      '.dshgit-history-details>.dshgit-card{margin:0;padding:12px 16px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;gap:6px;max-height:35%;overflow:auto}',
      '.dshgit-history-details .dshgit-stash-filenav{box-sizing:border-box;width:clamp(150px,28%,240px);padding:12px;overflow:hidden}',
      '.dshgit-history-details .dshgit-sidebar-head{padding:0 0 8px}',
      '.dshgit-history-details .dshgit-filediff{margin:12px}',
      '.dshgit-history-filetools{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06))}',
      '.dshgit-history-viewmodes,.dshgit-history-fileactions{display:flex;align-items:center;gap:4px}',
      '.dshgit-history-fileactions{border-left:1px solid var(--dsw-alias-border-l1);padding-left:12px}',
      '.dshgit-history-details .dshgit-iconbtn{box-sizing:border-box;flex:none;width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center}',
      '.dshgit-history-viewmodes .dshgit-iconbtn[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary,#3989e9)}',
      '@media(max-width:760px){.dshgit-history-details .dshgit-stash-filenav{width:100%;max-height:180px}.dshgit-history-details .dshgit-filediff{margin:8px}}',
      '@media(pointer:coarse){.dshgit-history-details .dshgit-iconbtn{width:32px;height:32px}}',
      '.dshgit-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin:8px 10px;display:flex;flex-direction:column;gap:5px}',
      '.dshgit-graphrow{display:flex;align-items:center;gap:8px;padding:2px 8px;cursor:pointer;border-radius:4px;white-space:nowrap}',
      '.dshgit-graphrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
      '.dshgit-graphrow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
      '.dshgit-lanes{flex:none;display:flex;align-items:center}',
      '.dshgit-dot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 3px}',
      '.dshgit-commitrow{display:flex;flex-direction:column;gap:2px;padding:5px 8px;cursor:pointer;border-radius:5px;min-width:0}',
      '.dshgit-commitrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
      '.dshgit-commitrow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
      'button.dshgit-commitrow{width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left}',
      'button.dshgit-commitrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshgit-history-list{padding:4px 8px}',
      '.dshgit-history-list .dshgit-subject{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;overflow-wrap:anywhere}',
      '.dshgit-history-list .dshgit-meta{flex-wrap:nowrap;overflow:hidden}',
      '.dshgit-history-list .dshgit-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-meta{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary);display:flex;gap:8px;flex-wrap:wrap}',
      '.dshgit-spinner{display:inline-block;box-sizing:border-box;flex:0 0 12px;width:12px;height:12px;aspect-ratio:1;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:dshgit-spin .7s linear infinite;vertical-align:-1px}',
      '@keyframes dshgit-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.dshgit-spinner{animation:none}.dshgit-activity-item,.dshgit-winbtn,.dshgit-treerow,.dshgit-row{transition:none}}',
      '.dshgit-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:1200;max-width:min(680px,90vw);padding:10px 16px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,.3));font-size:var(--dshgit-font-lead);pointer-events:none}',
      '.dshgit-split{display:flex;gap:8px;align-items:center}',
      '.dshgit-split>*{flex:1;min-width:0}',
      '.dshgit-checkrow{display:flex;align-items:center;gap:7px;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-secondary);padding:3px 0}',
      '.dshgit-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
      '.dshgit-fieldlabel{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary)}',
      '.dshgit-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:var(--dshgit-font-body)}',
      '.dshgit-kv dt{color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-kv dd{margin:0;word-break:break-all}',
      '.dshgit-icon{display:inline-flex;align-items:center;justify-content:center}',
      '.dshgit-scroll{overflow:auto;min-height:0}',
      // Dropdown menu: opaque surface, theme-token colors, above the panes.
      '.dshgit-menu{z-index:1200;min-width:180px;max-width:280px;padding:4px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,.35));display:flex;flex-direction:column;gap:1px}',
      '.dshgit-menuitem{font:inherit;font-size:var(--dshgit-font-body);text-align:left;padding:5px 9px;border-radius:5px;border:none;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshgit-menuitem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
      '.dshgit-menuitem:disabled{opacity:.45;cursor:default}',
      '.dshgit-menudanger{color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-menusep{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1)}',
      '.dshgit-contextmenu{position:fixed;z-index:2000;display:flex;flex-direction:column;box-sizing:border-box;width:min(360px,calc(100vw - 8px));max-height:80vh;overflow-y:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter,none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.35));pointer-events:auto}',
      '.dshgit-contextmenu>.dshgit-menuitem{display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;width:100%;min-width:0;padding:7px 9px;white-space:normal}',
      '.dshgit-contextmenu>.dshgit-menuitem>span{min-width:0;overflow-wrap:anywhere}',
      '.dshgit-menucommand{flex:none;font-family:var(--dshgit-font-mono,monospace);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary);white-space:nowrap}',

      // ---- header chips ----
      // The chips live in the session header's utilities cluster, which is a
      // row of the session's own controls. They are deliberately the same height
      // and radius as those controls so the row reads as one strip rather than
      // a plugin bolted on.
      '.dshgit-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));font-size:var(--dshgit-font-small);font-family:inherit;line-height:1;white-space:nowrap;max-width:180px}',
      '.dshgit-chipaction{cursor:pointer}',
      '.dshgit-chipaction:hover,.dshgit-chipaction[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
      '.dshgit-chipname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
      // A dirty working tree is the one chip state worth colouring: it is the
      // fact that changes what the user should do next.
      '.dshgit-chipdirty{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshgit-chipdirty svg{color:var(--dsw-alias-state-warn-primary, currentColor)}',
      '.dshgit-chipmuted{color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-small)}',
      '.dshgit-chipbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));font-size:var(--dshgit-font-body);font-family:inherit;cursor:pointer}',
      '.dshgit-chipbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
      '.dshgit-chipbtn:disabled{opacity:.45;cursor:default}',
      '.dshgit-chipnotice{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);color:var(--dsw-alias-state-error-primary)}',
      // ---- action-outcome banner ----
      // Anchored to the chip row it belongs to, but taken OUT of flow so a long
      // message can never push the chips around (which the old inline span did).
      // It is a card, not a toast: an error stays until dismissed, because a
      // failure the user never read is one they will hit again.
      '.dshgit-chipcluster{position:relative;display:flex;align-items:center;gap:4px}',
      '.dshgit-notice{position:absolute;top:calc(100% + 6px);right:0;z-index:1300;display:flex;align-items:flex-start;gap:8px;width:max-content;max-width:min(420px,80vw);padding:9px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.28));font-size:var(--dshgit-font-small);line-height:1.5;text-align:left}',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-notice{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-noticeicon{flex:none;display:inline-flex;margin-top:1px;color:var(--dsw-alias-label-secondary)}',
      // Tone drives BOTH the colour and the icon, so a success cannot be painted
      // like a failure (the old span was unconditionally red).
      '.dshgit-notice[data-tone="success"] .dshgit-noticeicon{color:var(--dsw-alias-state-success-primary)}',
      '.dshgit-notice[data-tone="error"] .dshgit-noticeicon{color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-noticebody{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.dshgit-noticetext{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dshgit-noticehint{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      // The raw git text, only shown on demand: monospace, scrollable, bounded.
      '.dshgit-noticedetail{margin:2px 0 0;padding:6px 8px;max-height:160px;overflow:auto;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-meta);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      // Buttons pin to the TOP of the banner, not its vertical centre: with the
      // raw text expanded the banner grows tall, and centred buttons would drift
      // down away from the summary they act on.
      '.dshgit-noticebtn{flex:none;align-self:flex-start;margin-top:1px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary, inherit);font:inherit;font-size:var(--dshgit-font-meta);cursor:pointer;white-space:nowrap}',
      '.dshgit-noticebtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
      '.dshgit-noticebtn:focus-visible,.dshgit-noticeclose:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshgit-noticebtn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshgit-noticeclose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dshgit-noticeclose:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16));color:var(--dsw-alias-label-primary)}',
      // Remote action follows the branch's tracking state. The separate changes
      // and merge chips own their respective flows.
      '.dshgit-chipnext{font-weight:600}',
      '.dshgit-chipaction:disabled{cursor:default;opacity:.55}',
      '.dshgit-chipaction:focus-visible,.dshgit-pickrow:focus-visible,.dshgit-pickinline:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dshgit-chipname{min-width:0}',
      // The counts are the amount, the label is the verb. Tinting them apart lets
      // one chip read as a sentence ("Pull ↓2") without a second control.
      '.dshgit-chipcounts{display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;opacity:.75;margin-left:1px}',
      '.dshgit-next-ahead,.dshgit-next-behind{color:var(--dsw-alias-brand-primary)}',
      '.dshgit-next-ahead:hover:not(:disabled),.dshgit-next-behind:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)}',
      // A blocked state (conflicts, diverged) must not look like an ordinary
      // suggestion: it is the only thing standing between the user and a stuck
      // repository, so it is coloured as a warning.
      '.dshgit-next-warn{color:var(--dshgit-warning-text)}',
      '.dshgit-next-warn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-error-primary)) 14%, transparent)}',
      // In sync is a status. The adjacent chevron owns the alternate actions.
      '.dshgit-next-clean{color:var(--dsw-alias-label-tertiary)}',
      '.dshgit-chipmore{padding:0 4px;min-width:20px;justify-content:center}',
      '@media(max-width:620px){.dshgit-chip[data-chip="branch"]{max-width:100px;min-width:0}.dshgit-chip[data-chip="merge"]{padding:0 4px}.dshgit-chipcluster{gap:2px}}',
      // The force-with-lease row is the one destructive entry in the sync menu;
      // it must not sit visually level with the safe ones.
      '.dshgit-pickdanger{color:var(--dsw-alias-state-error-primary)}',
      '.dshgit-pickdanger:hover{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}',
      '.dshgit-mergehead{font-size:var(--dshgit-font-body);font-weight:600;overflow-wrap:anywhere}',
      '.dshgit-merge-remote{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-merge-remote>.dshgit-muted{flex:1 1 200px;font-size:var(--dshgit-font-small);line-height:1.5}',
      '.dshgit-merge-remote>.dshgit-btn{flex:none;display:inline-flex;align-items:center;gap:6px;margin-left:auto}',
      '.dshgit-mergecolumns{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}',
      '.dshgit-mergecolumn{min-width:0;max-height:220px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}',
      '.dshgit-mergecolumn h3{margin:0 0 5px;font-size:var(--dshgit-font-small)}',
      '.dshgit-mergecommit{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);padding:2px 0}',
      '@media(max-width:620px){.dshgit-mergecolumns{grid-template-columns:1fr}}',

      // ---- in-progress operation panel ----
      // Bottom-left rather than centred: it must not cover the changes list the
      // user is working through, and it is not a question that blocks the app.
      '.dshgit-oppanel{position:fixed;left:16px;bottom:16px;z-index:1405;width:min(420px,92vw);display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-warn-primary, var(--dsw-alias-border-l1));background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-oppanel{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-ophead{display:flex;align-items:center;gap:8px}',
      '.dshgit-opbadge{flex:none;color:var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-error-primary));font-size:var(--dshgit-font-title)}',
      '.dshgit-optitle{flex:1;min-width:0;font-weight:600;font-size:var(--dshgit-font-body)}',
      '.dshgit-opactions{display:flex;gap:8px;justify-content:flex-end}',

      // ---- choice dialog ----
      '.dshgit-choice{display:flex;flex-direction:column;gap:2px;width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshgit-choice:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));border-color:var(--dsw-alias-brand-primary)}',
      '.dshgit-choicelabel{font-size:var(--dshgit-font-body);font-weight:600}',
      '.dshgit-choicehint{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary)}',

      // ---- popovers ----
      // A scrim rather than a document listener: a click anywhere outside closes
      // the panel without racing React's own event handling, and it gives the
      // popover a click target that is unambiguous.
      '.dshgit-scrim{position:fixed;inset:0;z-index:1400}',
      '.dshgit-popover{position:fixed;z-index:1401;max-height:min(560px,80vh);display:flex;flex-direction:column;overflow:hidden;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
      '.dshgit-popover[data-popover="commit"]{overflow:hidden}',
      '.dshgit-popover[data-popover="branch"],.dshgit-popover[data-popover="merge"]{box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:8px}',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-popover{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-confirmbar{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:1402;width:min(460px,92vw);padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
      '.dshgit-confirmbar-centered{top:50%;transform:translate(-50%,-50%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box}',
      '.dshgit-confirm-scrim{background:rgba(0,0,0,.28);pointer-events:auto}',
      '.dshgit-confirmbar-centered .dshgit-hint{overflow-wrap:anywhere;white-space:pre-wrap;margin:10px 0 16px}',
      '.dshgit-confirmbar-centered .dshgit-headline{justify-content:flex-end}',

      // ---- branch picker ----
      '.dshgit-picker{display:flex;flex-direction:column;min-height:0}',
      '.dshgit-pickerinput{flex:none;margin:8px;padding:7px 9px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:var(--dshgit-font-body);font-family:inherit}',
      '.dshgit-pickerinput:focus{outline:none;border-color:var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))}',
      '.dshgit-pickactions{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-picklist{flex:1;min-height:0;overflow-y:auto;padding:2px 0 6px}',
      // Flat sibling group headings scroll with their rows. Pinning every heading
      // at top:0 stacks them on top of each other as the list scrolls.
      '.dshgit-pickgroup{position:static;padding:12px 10px 4px;font-size:var(--dshgit-font-meta);font-weight:500;line-height:1.5;color:var(--dsw-alias-label-tertiary);background:transparent;display:flex;align-items:center;gap:8px}',
      '.dshgit-pickgroup:first-child{padding-top:6px}',
      // Rows are separated by a hairline only — no band, no card. A full border on
      // all ~50 rows turned the list into a grid; a translucent hairline gives the
      // same "which lines belong together" cue at a fraction of the ink.
      '.dshgit-pickrow{display:flex;flex-direction:column;gap:2px;width:100%;padding:6px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
      '.dshgit-pickrow:last-child{border-bottom:0}',
      '.dshgit-popover[data-popover="branch"] .dshgit-pickrow,.dshgit-popover[data-popover="merge"] .dshgit-pickrow{border-bottom:0;padding:7px 10px}',
      '.dshgit-pickrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14))}',
      // The current branch is a state, not an ordinary row, but it is marked with
      // the accent bar plus a restrained tint rather than a filled band: at full
      // hover strength it competed with the rows the user is trying to pick.
      '.dshgit-pickrowcurrent{font-weight:600;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary);cursor:default}',
      '.dshgit-pickrowtop{display:flex;align-items:baseline;gap:0;min-width:0}',
      '.dshgit-pickname{font-size:var(--dshgit-font-body);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshgit-pickdate{margin-left:auto;flex:none;padding-left:8px;font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-tertiary)}',
      // The metadata line is deliberately lighter and indented to the same column
      // as the name, so it reads as subordinate detail rather than a second name.
      '.dshgit-pickmeta{font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // A remote ref shows its remote as a muted prefix INSIDE the name line, so
      // `origin/feature/x` beside a local `feature/x` is distinguishable at a
      // glance. It is inline rather than a separate chip: as a chip it sat at its
      // own gap and read as two unrelated fields instead of one ref.
      '.dshgit-pickremote{flex:none;font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.dshgit-pickinline{padding:1px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary, inherit);font-size:var(--dshgit-font-meta);font-family:inherit;cursor:pointer}',
      '.dshgit-pickinline:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
      '.dshgit-pickfoot{flex:none;display:flex;align-items:center;gap:6px;padding:5px 8px;border-top:1px solid var(--dsw-alias-border-l1)}',

      // ---- commit panel ----
      '.dshgit-commitpanel{display:flex;flex-direction:column;min-height:0}',
      '.dshgit-cl-commitpanel{max-height:min(560px,80vh);overflow:hidden}',
      '.dshgit-cl-commitpanel>.dshgit-card,.dshgit-cl-commitpanel>.dshgit-commitbox{flex:none;max-height:45vh;overflow:auto}',
      '.dshgit-cl-commitpanel>.dshgit-cl-search,.dshgit-cl-commitpanel>.dshgit-cl-error,.dshgit-cl-commitpanel>.dshgit-pickfoot{flex:none}',
      '.dshgit-cl-commitpanel>.dshgit-commitlists{overscroll-behavior:contain;scrollbar-gutter:stable}',
      '.dshgit-commitbox{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshgit-commitlists{flex:1;min-height:0;overflow-y:auto;padding-bottom:4px}',
      '.dshgit-pickfile{min-height:26px;padding:2px 8px}',

      // ---- file viewer ----
      // A modal window, not a popover: it is for reading, so it needs the room
      // and it must survive the commit popover closing behind it. It is centred
      // and resizable like the workbench window, and it reuses that surface
      // material so the two dialogs read as the same family.
      '.dshgit-fileviewer{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1500;display:flex;flex-direction:column;width:min(980px,92vw);height:min(680px,86vh);pointer-events:auto;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3));isolation:isolate;overflow:hidden}',
      '.dshgit-fileviewer::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-fileviewer{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-fileviewerhead{display:flex;align-items:center;gap:8px;flex:none;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.dshgit-fileviewerpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body)}',
      '.dshgit-fileviewerbody{flex:1;min-height:0;overflow:auto}',
      '.dshgit-fileviewerfoot{flex:none;display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary)}',
      // The scrim sits under the dialog and above everything else, so a click
      // outside closes the viewer without a document listener racing React.
      '.dshgit-viewerscrim{position:fixed;inset:0;z-index:1499;background:rgba(0,0,0,.28)}',
      // Diff rows inside the viewer wrap their content, but the line-number
      // gutter must never wrap away from its line.
      '.dshgit-fileviewer .dshgit-diffrow{min-width:0}',

      // ---- floating window ----
      // Surface material copied from the shipped theme rather than invented:
      // DSH defines `--dsw-menu-surface-fill` (#f8f9fa94 light / #43454a73 dark)
      // and `--dsw-menu-backdrop-filter: blur(40px) saturate(150%)` for exactly
      // this kind of translucent panel. An opaque gray would ignore the theme
      // and sit wrong against every background, which is what a hand-rolled
      // surface always does.
      //
      // The overlay layer is click-through by design, so the window opts back
      // into pointer events. Nothing here covers the frame: a Git tool window
      // must not make the rest of the app unusable.
      '.dshgit-float{position:fixed;right:16px;bottom:16px;z-index:1150;display:flex;flex-direction:column;width:min(420px,94vw);max-height:min(640px,88vh);pointer-events:auto;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.16));isolation:isolate;overflow:hidden}',
      // The hairline stroke the shipped elevations use, drawn as an inset ring so
      // it survives the translucent fill.
      '.dshgit-float::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
      '.dshgit-floatfull{left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);width:min(1180px,94vw);height:min(780px,90vh);max-height:90vh}',
      // The resize grip. A native `resize:both` handle is a ~14px corner triangle
      // drawn by the browser *under* our own border-radius and stroke ring, so it
      // reads as a rendering artifact rather than a control. An explicit grip can
      // be themed, given a hit area bigger than its paint, and — the reason it
      // exists at all — routed through the same pointer-capture path as the drag,
      // so a resize keeps tracking when the pointer leaves the window.
      '.dshgit-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;z-index:3;cursor:nwse-resize;touch-action:none;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 3px 3px 0;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);opacity:.55}',
      '.dshgit-resize:hover,.dshgit-resize:focus-visible{opacity:1;color:var(--dsw-alias-label-primary)}',
      '.dshgit-floathead{display:flex;align-items:center;gap:8px;padding:7px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;user-select:none}',
      // The workspace name in the title bar: muted, one line, clipped with an
      // ellipsis because a deep path must not push the window controls out.
      '.dshgit-floatworkspace{min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))}',
      // `grabbing` during the gesture is the only feedback that the drag took.
      '.dshgit-floathead:active{cursor:grabbing}',
      '.dshgit-floatfull .dshgit-floathead{cursor:default}',
      '.dshgit-floatbody{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden}',
      // The window's own controls must sit above the stroke ring.
      '.dshgit-floathead>*{position:relative;z-index:2}',
      // If backdrop-filter is unavailable the translucent fill would let the
      // conversation show through the window, which reads as a rendering bug.
      // Fall back to the opaque raised-surface token instead.
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-float{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
      '.dshgit-headline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--dshgit-font-body)}',
      '.dshgit-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:5px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.dshgit-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16));color:var(--dsw-alias-label-primary)}',
      '.dshgit-iconbtn:disabled{opacity:.4;cursor:default}',
      '.dshgit-hint{font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.dshgit-pill{position:fixed;right:16px;bottom:16px;z-index:1150;pointer-events:auto;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #1e1e1e));box-shadow:var(--dsw-shadow-lv2, 0 6px 20px rgba(0,0,0,.3));font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dshgit-pill:hover{border-color:var(--dsw-alias-label-secondary)}',
      // A tiny dot marking "the window is open", sized for an icon-only button.
      '.dshgit-dotbadge{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary);align-self:flex-start;margin-left:-10px;margin-top:1px}',
      // Toolbar cluster: sync buttons sit together and stay on one line.
      '.dshgit-tools{display:flex;align-items:center;gap:4px;flex:none}',
      '.dshgit-aheadbehind{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
      // Output view rows.
      '.dshgit-logrow{border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 10px;display:flex;flex-direction:column;gap:3px}',
      '.dshgit-loghead{display:flex;gap:8px;align-items:center;font-size:var(--dshgit-font-body);flex-wrap:wrap}',
      '.dshgit-logcmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}',
      '.dshgit-logout{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small);line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);margin:0;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l1)}',
      '.dshgit-logerr{color:var(--dsw-alias-state-error-primary)}',
      // A modal dialog for small forms (clone, new branch, new tag).
      '.dshgit-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1300;display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dshgit-dialog{background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-lg,16px);padding:16px;box-sizing:border-box;width:min(480px,100%);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px;box-shadow:var(--dsw-elevation-prominent, 0 12px 48px rgba(0,0,0,.4))}',
      // Dialogs use the same opaque surface as the workbench, including over a scrim.
      '.dshgit-dialog,.dshgit-popover,.dshgit-confirmbar,.dshgit-fileviewer{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));backdrop-filter:none;-webkit-backdrop-filter:none}',
      '.dshgit-dialog.dshgit-dialog-compact{width:min(360px,calc(100vw - 32px));box-sizing:border-box}',
      '.dshgit-dialogtitle{font-weight:600;font-size:var(--dshgit-font-title)}',
      '.dshgit-workbench,.dshgit-popover,.dshgit-menu,.dshgit-contextmenu,.dshgit-combolist,.dshgit-fileviewer,.dshgit-confirmbar,.dshgit-toast{color:var(--dsw-alias-label-primary)}',
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.dshgit-menu,.dshgit-contextmenu,.dshgit-dialog,.dshgit-toast,.dshgit-confirmbar{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}}',
      '.dshgit-dialogactions{display:flex;gap:8px;justify-content:flex-end}',
      '.dshgit-bar+.dshgit-bar{border-top:none}',
    ].join('\n')

    var stylesInjected = false

    /** Inject this plugin's stylesheet once. */
    function installStyles() {
      if (stylesInjected) return function () {}
      stylesInjected = true
      var el = document.createElement('style')
      el.dataset.plugin = 'dsh-plugin-git'
      el.textContent = STYLES
      document.head.appendChild(el)
      return function () {
        el.remove()
        stylesInjected = false
      }
    }

    /* ------------------------------------------------------------------ *
     * Icons (local artwork; the primitives package must not be imported)
     * ------------------------------------------------------------------ */

    /** Shared <svg> wrapper. */
    function svg(props, children) {
      return h(
        'svg',
        {
          width: props.size,
          height: props.size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          className: props.className,
        },
        children,
      )
    }

    /** A branch glyph for the sidebar. */
    function IconGit(props) {
      var size = props.size === undefined ? 16 : props.size
      return svg({ size: size, className: props.className }, [
        h('circle', { key: 'a', cx: '4.5', cy: '3.5', r: '1.8', stroke: 'currentColor' }),
        h('circle', { key: 'b', cx: '4.5', cy: '12.5', r: '1.8', stroke: 'currentColor' }),
        h('circle', { key: 'c', cx: '11.5', cy: '7', r: '1.8', stroke: 'currentColor' }),
        h('path', { key: 'd', d: 'M4.5 5.3v5.4', stroke: 'currentColor' }),
        h('path', { key: 'e', d: 'M4.5 9.8c0-3 7-1.6 7-4.6', stroke: 'currentColor' }),
      ])
    }

    /** Chevron used by collapsible sections. */
    function IconChevron(props) {
      return svg({ size: props.size === undefined ? 10 : props.size }, h('path', {
        d: props.open === true ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5',
        stroke: 'currentColor',
      }))
    }

    function IconChangeAction(props) {
      var path = {
        open: 'M5 2H3v12h9v-2M6 1h6l3 3v7M12 1v3h3M6 10l4-4m-3 0h3v3',
        viewGroup: 'M3 3H1v12h10v-2M5 1h7l3 3v9H5zM12 1v3h3M10 6v5m-2.5-2.5h5',
        stash: 'M8 1v9m0 0 3-3m-3 3L5 7M2 10v4h12v-4',
        unstage: 'M2 8h12',
        discard: 'M5 5H2V2m0 3c1.4-2 3.3-3 5.5-3a6 6 0 1 1-5.4 8.5',
        stage: 'M8 2v12M2 8h12',
        refresh: 'M13 5V2m0 3h-3M13 5a5.5 5.5 0 1 0 .5 5',
        diff: 'M3 1h7l3 3v11H3zM10 1v3h3M5 7h5M5 11h5M7.5 9v4',
        before: 'M3 1h7l3 3v11H3zM10 1v3h3M10 9H5m0 0 2-2M5 9l2 2',
        after: 'M3 1h7l3 3v11H3zM10 1v3h3M5 9h5m0 0-2-2m2 2-2 2',
        // Undo-last-commit: an arrow swinging back left over a line, the mark
        // for "take the last step back" — a reset, not a discard.
        undo: 'M3 6h7a3.5 3.5 0 1 1 0 7H6M3 6l3-3M3 6l3 3',
        // Clean: a broom sweeping, for "remove the untracked leftovers".
        clean: 'M10.5 1.5l4 4L8 12l-2.5.5.5-2.5zM4 10l-2.5 4',
      }[props.kind]
      return svg({ size: props.size === undefined ? 17 : props.size }, h('path', {
        d: path, stroke: 'currentColor', strokeWidth: '1.5',
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * One VS Code style primary action with a separate options chevron.
     *
     * The chevron is a real menu, not a toggle: it replaces the two checkboxes
     * that used to sit above the button, which cost a row of height and made the
     * commit scope look like a form to fill in. Choosing an item runs it
     * directly, so there is no armed mode left behind for a later click on the
     * pill to stumble into.
     *
     * `disabled` and `pending` are SEPARATE because they answer different
     * questions. `disabled` means "this control is not usable right now", which is
     * true while an unrelated write is in flight — ticking a file writes the
     * changelist metadata, and committing mid-write would send a stale scope
     * version. `pending` means "the action THIS control performs is running", and
     * only that earns a spinner. Merging the two made every checkbox tick spin the
     * commit button, claiming a commit that was not happening.
     */
    function CommitActions(props) {
      // The two halves are ONE control, so they enable and disable together. When
      // the pill greyed out but the chevron stayed saturated the pair read as
      // broken: a dead label beside a live-looking button.
      var unavailable = props.disabled === true || props.pending === true
      return h('div', { className: 'dshgit-commit-actions' }, [
        h('div', { key: 'main', className: 'dshgit-commit-split',
          'data-has-menu': props.options.length > 0 ? 'true' : 'false',
          'data-disabled': unavailable ? 'true' : 'false',
        }, [
          h('button', {
            key: 'primary', type: 'button', className: 'dshgit-btn dshgit-btn-primary dshgit-commit-primary',
            disabled: props.disabled, 'aria-busy': props.pending === true,
            'aria-keyshortcuts': props.shortcut ? 'Control+Enter Meta+Enter' : undefined,
            title: props.hint, onClick: props.onPrimary,
          }, [props.pending ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
            h('span', { key: 'label' }, props.label)]),
          props.options.length === 0 ? null : h(Menu, {
            key: 'options', t: props.t, rootClass: 'dshgit-commit-menu-root',
            triggerClass: 'dshgit-commit-arrow', align: 'right', disabled: unavailable,
            label: h(IconChevron, { open: true, size: 15 }),
            title: props.t('menu.actions'), items: props.options, portal: true,
            menuClass: 'dshgit-commit-options',
          }),
        ]),
      ])
    }

    /** The same hover toolbar in the compact and full change lists. */
    function ChangeRowActions(props) {
      var t = props.t
      var staged = props.section === 'staged'
      var button = function (key, label, kind, run) {
        return h('button', {
          key: key, type: 'button', className: 'dshgit-change-action',
          'data-file-action': key, title: label, 'aria-label': label,
          disabled: key !== 'open' && props.busy === true,
          onClick: function (event) { event.stopPropagation(); run() },
        }, h(IconChangeAction, { kind: kind }))
      }
      return h('span', { className: 'dshgit-change-actions' }, [
        props.simple ? null : button('open', t('action.openFile'), 'open', props.onOpen),
        staged || props.simple ? null : button('discard', t('action.discard'), 'discard', props.onDiscard),
        button(staged ? 'unstage' : 'stage',
          t(staged ? 'action.unstage' : 'action.stage'),
          staged ? 'unstage' : 'stage', props.onToggleStage),
      ])
    }

    /** VS Code style SCM group header shared by the compact and full lists. */
    function ChangeGroup(props) {
      var state = React.useState(true)
      var open = state[0]
      var setOpen = state[1]
      return h('div', { className: 'dshgit-changegroup', 'data-change-group': props.kind }, [
        h('div', { key: 'bar', className: 'dshgit-changegroupbar' }, [
          h('button', { key: 'head', type: 'button', className: 'dshgit-changegrouphead',
            'aria-expanded': open, onClick: function () { setOpen(!open) },
          }, [
            h('span', { key: 'caret', className: 'dshgit-caret' }, h(IconChevron, { open: open, size: 13 })),
            h('span', { key: 'title' }, props.title),
          ]),
          h('span', { key: 'actions', className: 'dshgit-changegroupactions' + (props.simple ? ' dshgit-group-primary' : '') }, props.actions.map(function (action) {
            return h('button', { key: action.key, type: 'button', className: 'dshgit-iconbtn',
              'data-group-action': action.key, title: action.label, 'aria-label': action.key === 'more' ? props.t('menu.actions') : action.label,
              'aria-haspopup': action.key === 'more' ? 'menu' : undefined,
              disabled: props.busy === true && action.key !== 'view',
              onClick: action.run,
            }, action.text ? action.label : h(IconChangeAction, { kind: action.icon }))
          })),
          h('span', { key: 'count', className: 'dshgit-sectioncount' }, String(props.count)),
        ]),
        open ? h('div', { key: 'body', className: 'dshgit-changegroupbody' }, props.children) : null,
      ])
    }

    /** The two diagonal strokes of a resize grip, the familiar corner mark. */
    function IconResize(props) {
      return svg({ size: 10 }, [
        h('path', { key: 'a', d: 'M14 6L6 14', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M14 11L11 14', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
      ])
    }

    /** A branch glyph for the header's branch chip. */
    function IconBranch(props) {
      return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '4', cy: '3', r: '1.6', stroke: 'currentColor' }),
        h('circle', { key: 'b', cx: '4', cy: '13', r: '1.6', stroke: 'currentColor' }),
        h('circle', { key: 'c', cx: '12', cy: '6', r: '1.6', stroke: 'currentColor' }),
        h('path', { key: 'd', d: 'M4 4.6v6.8', stroke: 'currentColor' }),
        h('path', { key: 'e', d: 'M4 8.4c0-2.4 8-1.2 8-3.6', stroke: 'currentColor' }),
      ])
    }

    /**
     * The "changes" glyph: a pencil over a line, as a diff/edits mark.
     *
     * Deliberately not the same artwork as {@link IconGit}: the two chips sit
     * side by side, and two identical icons would be unreadable at 12px.
     */
    function IconFileList(props) {
      return svg(props, h('path', { d: 'M5 3h9M5 8h9M5 13h9M1 3h1M1 8h1M1 13h1',
        stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }))
    }
    function IconPlus(props) {
      return svg(props, h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }))
    }
    function IconFolder(props) {
      return svg(props, h('path', { d: 'M1.5 4h5l1.5 2h6.5v7h-13zM1.5 4V2.5h5L8 4h5v2', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }))
    }
    function IconFileTree(props) {
      return svg(props, h('path', { d: 'M2 2h4v3H2zM9 7h5v3H9zM9 12h5v3H9zM4 5v8.5h5M4 8.5h5',
        stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }))
    }

    function IconStashApply(props) {
      return svg(props, h('path', { d: 'M8 2v8M5 7l3 3 3-3M5 9H3l-1 4v1h12v-1l-1-4h-2',
        stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconStashPop(props) {
      return svg(props, h('path', { d: 'M8 10V2M5 5l3-3 3 3M5 9H3l-1 4v1h12v-1l-1-4h-2',
        stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconTrash(props) {
      return svg(props, h('path', { d: 'M3 4h10M6 4V2h4v2M4 4l.7 10h6.6L12 4M6.5 7v4M9.5 7v4',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function IconSweep(props) {
      return svg(props, h('path', { d: 'M12.5 1.5 7.5 7M5.5 6.5l4 3-2.5 5H1.5l1.5-5 2.5-3ZM4 10l-1 4.5M6 11l-.5 3.5M10.5 13.5h3M12 10.5h2.5',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function IconMore(props) {
      return svg(props, [3, 8, 13].map(function (y) {
        return h('circle', { key: y, cx: props.horizontal ? y : 8, cy: props.horizontal ? 8 : y, r: 1.4, fill: 'currentColor' })
      }))
    }

    function IconCopyPath(props) {
      return svg(props, [
        h('rect', { key: 'front', x: 5, y: 5, width: 9, height: 9, rx: 1.3, stroke: 'currentColor', strokeWidth: '1.4' }),
        h('path', { key: 'back', d: 'M10 3V2H2v8h1', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round', strokeLinecap: 'round' }),
      ])
    }

    function IconStash(props) {
      return svg(props, [
        h('path', { key: 'box', d: 'M2 5h12v9H2zM1 2h14v3H1zM6 8h4', fill: 'none',
          stroke: 'currentColor', strokeWidth: '1.6', strokeLinejoin: 'round', strokeLinecap: 'round' }),
      ])
    }

    function IconChanges(props) {
      return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
        h('path', { key: 'a', d: 'M9.5 2.5l3 3L6 12H3V9z', stroke: 'currentColor', strokeLinejoin: 'round' }),
        h('path', { key: 'b', d: 'M2 15h12', stroke: 'currentColor', strokeLinecap: 'round' }),
      ])
    }

    /**
     * The activity bar's icons.
     *
     * One glyph per module, drawn on the same 16×16 grid and with the same
     * `currentColor` stroke as the rest of the panel's artwork. The activity bar
     * is the only module switcher, so an unreadable icon there costs the user the
     * ability to navigate — these are deliberately simple silhouettes rather than
     * detailed marks that dissolve at 18px.
     *
     * Each takes an optional `size`, defaulting to 18 (the activity bar's size),
     * so a status-bar use can ask for 12 without a second component.
     */

    /** History: a clock face, the universal "past" mark. */
    function IconHistory(props) {
      return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '8', cy: '8', r: '6.2', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M8 4.4V8l2.6 1.6', stroke: 'currentColor', strokeLinecap: 'round' }),
      ])
    }

    /** Commit graph: three nodes on a lane, the shape a graph column makes. */
    function IconGraph(props) {
      return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '4', cy: '3.4', r: '1.7', stroke: 'currentColor' }),
        h('circle', { key: 'b', cx: '4', cy: '12.6', r: '1.7', stroke: 'currentColor' }),
        h('circle', { key: 'c', cx: '12', cy: '8', r: '1.7', stroke: 'currentColor' }),
        h('path', { key: 'd', d: 'M4 5.1v5.8', stroke: 'currentColor' }),
        h('path', { key: 'e', d: 'M5.7 8h4.6', stroke: 'currentColor' }),
      ])
    }

    /** Compare: two columns with an arrow crossing between them. */
    function IconCompare(props) {
      return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
        h('path', { key: 'a', d: 'M2.5 4.5h6M2.5 11.5h6', stroke: 'currentColor', strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M13.5 4.5h-2M13.5 11.5h-2', stroke: 'currentColor', strokeLinecap: 'round' }),
        h('path', {
          key: 'c', d: 'M9.5 8h4m0 0-1.6-1.6M13.5 8l-1.6 1.6',
          stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      ])
    }

    /** Output: a terminal prompt. */
    function IconOutput(props) {
      return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
        h('rect', { key: 'a', x: '1.8', y: '2.8', width: '12.4', height: '10.4', rx: '1.6', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M4.6 6.4l2 1.8-2 1.8', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { key: 'c', d: 'M8.4 10.4h3.2', stroke: 'currentColor', strokeLinecap: 'round' }),
      ])
    }

    /** Settings: a gear. */
    function IconSettings(props) {
      return svg({ size: props.size === undefined ? 18 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '8', cy: '8', r: '2.2', stroke: 'currentColor' }),
        h('path', {
          key: 'b',
          d: 'M8 1.6l1 1.7 2-.3.5 2 1.8.9-1 1.8 1 1.8-1.8.9-.5 2-2-.3-1 1.7-1-1.7-2 .3-.5-2-1.8-.9 1-1.8-1-1.8 1.8-.9.5-2 2 .3z',
          stroke: 'currentColor', strokeLinejoin: 'round',
        }),
      ])
    }

    /** Refresh: a circular arrow, for the title bar's reload control. */
    function IconRefresh(props) {
      return svg({ size: props.size === undefined ? 15 : props.size, className: props.className }, [
        h('path', { key: 'a', d: 'M13.4 8a5.4 5.4 0 1 1-1.6-3.8', stroke: 'currentColor', strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M13.6 2.2V5h-2.8', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    /** Fetch: a cloud with a downward arrow, i.e. "bring the remote's state in". */
    function IconFetch(props) {
      return svg({ size: props.size === undefined ? 15 : props.size, className: props.className }, [
        h('path', {
          key: 'a', d: 'M5 12.4h6.4a2.7 2.7 0 0 0 .3-5.4 3.5 3.5 0 0 0-6.7-.7A2.5 2.5 0 0 0 5 12.4z',
          stroke: 'currentColor', strokeLinejoin: 'round',
        }),
      ])
    }

    /** Branch sync actions share a ref marker; fetch uses a dotted arrow. */
    function IconBranchSync(props) {
      var push = props.kind === 'push'
      return svg({ size: props.size === undefined ? 16 : props.size }, [
        h('path', { key: 'line', d: 'M1.5 12.5h4.25m4.5 0h4.25', stroke: 'currentColor', strokeLinecap: 'round' }),
        h('circle', { key: 'ref', cx: 8, cy: 12.5, r: 2.25, stroke: 'currentColor' }),
        h('path', { key: 'shaft', d: push ? 'M8 8.5V1.5' : 'M8 1.5v7', stroke: 'currentColor', strokeLinecap: 'round', strokeDasharray: props.kind === 'fetch' ? '1 2' : undefined }),
        h('path', { key: 'arrow', d: push ? 'M4.75 4.75 8 1.5l3.25 3.25' : 'M4.75 5.25 8 8.5l3.25-3.25', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    function IconBranchAction(props) {
      if (props.kind === 'checkout') return svg({ size: props.size || 16 }, h('path', {
        d: 'M5 3H4a3.5 3.5 0 0 0 0 7h9M10 7l3 3-3 3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
      return svg({ size: props.size || 16 }, [
        h('circle', { key: 'start', cx: 3, cy: 2, r: 1.4, stroke: 'currentColor' }),
        h('circle', { key: 'end', cx: 3, cy: 13, r: 1.4, stroke: 'currentColor' }),
        h('circle', { key: 'branch', cx: 11, cy: 2, r: 1.4, stroke: 'currentColor' }),
        h('path', { key: 'line', d: 'M3 3.4v8.2M11 3.4v1.4c0 2.2-8 2-8 5', stroke: 'currentColor' }),
        h('circle', { key: 'new', cx: 11, cy: 11, r: 3.5, stroke: 'currentColor' }),
        h('path', { key: 'plus', d: 'M11 9v4m-2-2h4', stroke: 'currentColor', strokeLinecap: 'round' }),
      ])
    }

    /** A tick in a circle: the outcome banner's success tone. */
    function IconCheck(props) {
      return svg({ size: props.size === undefined ? 14 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '8', cy: '8', r: '6.4', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M5.2 8.3l2 2 3.6-4', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    /** A filled exclamation mark: the outcome banner's error tone. */
    function IconAlert(props) {
      return svg({ size: props.size === undefined ? 14 : props.size, className: props.className }, [
        h('circle', { key: 'a', cx: '8', cy: '8', r: '6.4', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M8 4.6v4.2', stroke: 'currentColor', strokeLinecap: 'round' }),
        h('circle', { key: 'c', cx: '8', cy: '11.3', r: '.85', fill: 'currentColor' }),
      ])
    }

    /** An x, for dismissing an outcome banner. */
    function IconClose(props) {
      return svg({ size: props.size === undefined ? 12 : props.size, className: props.className }, [
        h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeLinecap: 'round' }),
      ])
    }

    /**
     * Turn a raw write outcome into something worth showing a human.
     *
     * The Host hands back git's own words, which are written for a terminal:
     * they lead with the URL, repeat "error: failed to push some refs", and bury
     * the one actionable sentence at the end. Dumping that into a 220px chip was
     * unreadable AND unhelpful — the reader had to parse git's prose to find out
     * what to do.
     *
     * This maps the few failures whose FIX is knowable to a plain-language line
     * plus, where the plugin can do it, the action that resolves it. Anything it
     * does not recognise falls through to the raw text, so an unknown failure is
     * still reported rather than swallowed.
     *
     * @param text - the raw message (stderr, or a thrown error's message).
     * @param method - the write method that failed.
     * @param t - the translator.
     * @returns `{ text, hint, action }`; `action` is `{ id, label }` or null.
     */
    function explainFailure(text, method, t) {
      var raw = String(text === undefined || text === null ? '' : text)
      var lower = raw.toLowerCase()

      // The remote has commits we do not: the only correct fix is to integrate
      // them first. Offering "Pull" turns a dead end into one click.
      if (lower.indexOf('non-fast-forward') !== -1 || lower.indexOf('fetch first') !== -1 ||
          lower.indexOf('updates were rejected') !== -1) {
        return {
          text: raw,
          hint: t('failure.nonFastForward'),
          action: { id: 'pull', label: t('failure.actionPull') },
        }
      }
      // No upstream configured: publishing is the fix.
      if (lower.indexOf('has no upstream branch') !== -1 || lower.indexOf('no upstream') !== -1) {
        return {
          text: raw,
          hint: t('failure.noUpstream'),
          action: { id: 'publish', label: t('failure.actionPublish') },
        }
      }
      // Authentication and connectivity are the user's to fix; say which it is
      // instead of showing a wall of hints.
      if (lower.indexOf('authentication failed') !== -1 || lower.indexOf('permission denied') !== -1 ||
          lower.indexOf('could not read username') !== -1 || lower.indexOf('invalid username or password') !== -1) {
        return { text: raw, hint: t('failure.auth'), action: null }
      }
      if (lower.indexOf('could not resolve host') !== -1 || lower.indexOf('unable to access') !== -1 ||
          lower.indexOf('connection timed out') !== -1 || lower.indexOf('network is unreachable') !== -1) {
        return { text: raw, hint: t('failure.network'), action: null }
      }
      if (lower.indexOf('diverged') !== -1 || lower.indexOf('not possible to fast-forward') !== -1) {
        return {
          text: raw,
          hint: t('failure.diverged'),
          action: { id: 'reconcile', label: t('failure.actionReconcile') },
        }
      }
      // A conflict is a state, not a failure: the merge went in and now needs
      // resolving, so point at the files rather than repeating git's advice.
      if (lower.indexOf('conflict') !== -1 || lower.indexOf('merge conflict') !== -1) {
        return { text: raw, hint: t('failure.conflict'), action: null }
      }
      if (lower.indexOf('nothing to commit') !== -1) {
        return { text: raw, hint: t('failure.nothingToCommit'), action: null }
      }
      if (lower.indexOf('pathspec') !== -1 && lower.indexOf('did not match') !== -1) {
        return { text: raw, hint: t('failure.noMatch'), action: null }
      }
      if (lower.indexOf('would be overwritten') !== -1 || lower.indexOf('local changes') !== -1) {
        return { text: raw, hint: t('failure.localChanges'), action: null }
      }
      return { text: raw, hint: null, action: null }
    }

    /**
     * Condense a multi-line git message into one readable line.
     *
     * Git's first line is usually the URL or a repeated `error:` prefix, while
     * the LAST line is the one that says what went wrong. `hint:` lines are
     * dropped entirely — they are advice for a terminal, and the banner either
     * supplies better advice or shows the raw text in full on demand.
     *
     * @param text - the raw message.
     * @returns a single line, at most ~160 characters.
     */
    function firstMeaningfulLine(text) {
      var lines = String(text === undefined || text === null ? '' : text)
        .split(/\r?\n/)
        .map(function (line) { return line.trim() })
        .filter(function (line) { return line !== '' && line.indexOf('hint:') !== 0 })
      if (lines.length === 0) return ''
      // Prefer the last line that reads as a sentence about the failure; fall
      // back to the first non-empty line.
      var best = lines[lines.length - 1]
      for (var i = lines.length - 1; i >= 0; i--) {
        if (/^(error|fatal|remote|!|\s*!)/i.test(lines[i]) || lines[i].length > 24) { best = lines[i]; break }
      }
      return best.length > 160 ? best.slice(0, 157) + '…' : best
    }

    /* ------------------------------------------------------------------ *
     * Utilities
     * ------------------------------------------------------------------ */

    /**
     * Attach the current session identity to a repository request.
     *
     * The Host cannot work out which conversation the panel is rendering: an
     * HTTP request carries no Agent initiator boundary, and the workspace
     * registry lists every workspace, not the active one. So the id travels with
     * the request and the Host prefers it over its own inference.
     *
     * An explicit `root`/`path` is left alone — a caller that named a repository
     * meant it — and the id is only added when one is actually known.
     *
     * @param payload - the caller's payload.
     * @returns the payload with `sessionId`, when there is one to add.
     */
    function withSession(payload) {
      var body = payload === undefined || payload === null ? {} : payload
      if (body.root !== undefined || body.path !== undefined) return body
      if (body.sessionId !== undefined) return body
      var sessionId = getWindowState().sessionId
      if (typeof sessionId !== 'string' || sessionId === '') return body
      return Object.assign({}, body, { sessionId: sessionId })
    }

    /**
     * Attach an EXPLICIT session identity to a repository request.
     *
     * {@link withSession} answers "which conversation is on screen?" from the
     * window store, and only the header cluster can publish that — from an
     * effect. React commits a child's passive effects BEFORE its parent's, so
     * the chips, being a child of that cluster, would still read the previous
     * id at the moment they reload for a switch. The request then resolves
     * against the conversation the user just left, and nothing re-runs it
     * afterwards: the header stays one session behind.
     *
     * A component that already knows its own id states it instead of asking a
     * store that has not caught up yet.
     *
     * @param payload - the caller's payload.
     * @param sessionId - the id the calling component was rendered for.
     * @returns the payload with `sessionId`, when there is one to add.
     */
    function withExplicitSession(payload, sessionId) {
      var body = payload === undefined || payload === null ? {} : payload
      if (body.root !== undefined || body.path !== undefined) return body
      if (body.sessionId !== undefined) return body
      if (typeof sessionId !== 'string' || sessionId === '') return body
      return Object.assign({}, body, { sessionId: sessionId })
    }

    /**
     * Call one Host method over Connection RPC.
     *
     * @param connection - the Connection service.
     * @param method - the RPC method name.
     * @param payload - its payload.
     * @param signal - cancellation.
     * @returns the unwrapped value.
     */
    function callRpc(connection, method, payload, signal) {
      return connection.rpc
        .call(RPC_CHANNEL, RPC_ENDPOINT, { method: method, payload: withSession(payload) }, signal)
        .then(function (result) {
          if (result && result.ok === true) return result.value
          var error = (result && result.error) || {}
          var wrapped = new Error(error.message || 'git 调用失败')
          wrapped.code = error.code
          wrapped.details = error.details
          throw wrapped
        })
    }

    /** Format an epoch-seconds timestamp as a compact local string. */
    function formatTime(seconds) {
      if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
      try {
        return new Date(seconds * 1000).toLocaleString()
      } catch (error) {
        return ''
      }
    }

    /** Format an epoch-seconds timestamp as a short relative string. */
    function formatRelative(seconds) {
      if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
      var diff = Date.now() / 1000 - seconds
      if (diff < 60) return '刚刚'
      if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
      if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
      if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前'
      if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + ' 个月前'
      return Math.floor(diff / (86400 * 365)) + ' 年前'
    }

    /** The single-letter status code git shows for a changed file. */
    function statusLetter(file) {
      if (file.kind === 'untracked') return 'U'
      if (file.kind === 'unmerged') return '!'
      if (file.kind === 'renamed') return 'R'
      if (file.index !== '.' && file.index !== ' ' && file.index !== '?') return file.index
      if (file.worktree !== '.' && file.worktree !== ' ') return file.worktree
      return 'M'
    }

    /**
     * Whether the file has changes STAGED for the next commit.
     *
     * Read from `index`, not from the `staged` boolean, because for a file git
     * reports as `MM` those are different facts: it has staged changes AND further
     * unstaged edits. Collapsing that to one boolean can only put the file in one
     * list, and whichever list it lands in, the other half of its changes is
     * invisible — so the user commits without having seen part of the diff.
     *
     * @param file - one status entry.
     * @returns whether it belongs in the staged section.
     */
    function isStaged(file) {
      if (file.kind === 'untracked' || file.kind === 'ignored') return false
      // A conflict is not "staged": it cannot be committed until it is resolved,
      // so listing it as staged invites a commit git will refuse.
      if (file.kind === 'unmerged') return false
      return file.index !== '.' && file.index !== ' ' && file.index !== '?'
    }

    /**
     * Whether the file has changes NOT staged, including partially staged ones.
     *
     * A partially staged file belongs in BOTH sections: that is what shows the
     * user there is more to add before committing.
     *
     * @param file - one status entry.
     * @returns whether it belongs in the unstaged section.
     */
    function isUnstaged(file) {
      if (file.kind === 'unmerged') return true
      if (file.kind === 'untracked') return true
      return file.worktree !== '.' && file.worktree !== ' '
    }

    /**
     * Whether the file's changes are split across the index and the worktree.
     * @param file - one status entry.
     * @returns whether it is partially staged.
     */
    function isPartial(file) {
      return isStaged(file) && isUnstaged(file)
    }

    /**
     * The floor and ceiling a resize may not cross.
     *
     * Below the minimum the header's own controls wrap and the body becomes a
     * sliver; above the maximum the dialog covers the app it is a tool for. Both
     * bounds are derived from the viewport so a small screen is never given a
     * dialog it cannot fit.
     *
     * @returns `{ minWidth, minHeight, maxWidth, maxHeight }`.
     */
    function resizeBounds() {
      var viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
      var viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
      // A header plus one readable row is the smallest useful box.
      return {
        minWidth: Math.min(420, viewportWidth - 16),
        minHeight: Math.min(320, viewportHeight - 16),
        maxWidth: Math.max(160, viewportWidth - 16),
        maxHeight: Math.max(120, viewportHeight - 16),
      }
    }

    /**
     * Begin a resize from a dialog's corner grip.
     *
     * Shared by the workbench window and the file viewer: both are centred
     * dialogs, so growing one moves its right edge by the full pointer delta and
     * it stays centred — no left/top pinning is needed.
     *
     * @param event - the pointer-down event.
     * @param ref - the dialog's node ref.
     */
    function beginResize(event, ref) {
      if (event.button !== undefined && event.button !== 0) return
      var node = ref === null || ref === undefined ? null : ref.current
      if (node === null || node === undefined) return
      var rect = typeof node.getBoundingClientRect === 'function'
        ? node.getBoundingClientRect()
        : { width: 0, height: 0 }
      var bounds = resizeBounds()
      windowState.resize = {
        pointerId: event.pointerId,
        node: node,
        startX: event.clientX,
        startY: event.clientY,
        // Measured once at gesture start, so each frame is computed from an
        // absolute origin. Accumulating per-frame deltas drifts.
        startWidth: rect.width || node.offsetWidth || bounds.minWidth,
        startHeight: rect.height || node.offsetHeight || bounds.minHeight,
        bounds: bounds,
      }
      if (typeof node.setPointerCapture === 'function' && event.pointerId !== undefined) {
        try {
          node.setPointerCapture(event.pointerId)
        } catch (error) {
          // Capture is a nicety; the listeners still work without it.
        }
      }
      event.preventDefault()
      event.stopPropagation()
    }

    /**
     * Track a resize in progress.
     *
     * @param event - the pointer-move event.
     */
    function moveResize(event) {
      var resize = windowState.resize
      if (resize === null || resize === undefined) return
      if (resize.pointerId !== undefined && event.pointerId !== undefined &&
          resize.pointerId !== event.pointerId) return
      var node = resize.node
      if (node === null || node === undefined) return
      var bounds = resize.bounds
      var width = Math.max(bounds.minWidth,
        Math.min(resize.startWidth + (event.clientX - resize.startX), bounds.maxWidth))
      var height = Math.max(bounds.minHeight,
        Math.min(resize.startHeight + (event.clientY - resize.startY), bounds.maxHeight))
      node.style.width = width + 'px'
      node.style.height = height + 'px'
      // The stylesheet's `max-height` was sized for the default box, so it
      // would silently clamp a deliberately taller dialog.
      node.style.maxHeight = 'none'
      resize.lastWidth = width
      resize.lastHeight = height
    }

    /**
     * Finish a resize, reporting the size the user chose.
     *
     * @param event - the pointer-up event, if any.
     * @param onCommit - called with `{ width, height }` when the gesture moved.
     */
    function endResizeWith(event, onCommit) {
      var resize = windowState.resize
      if (resize === null || resize === undefined) return
      if (event && resize.pointerId !== undefined && event.pointerId !== undefined &&
          resize.pointerId !== event.pointerId) return
      windowState.resize = null
      if (resize.lastWidth !== undefined && resize.lastHeight !== undefined) {
        onCommit({ width: resize.lastWidth, height: resize.lastHeight })
      }
      var node = resize.node
      if (node !== null && node !== undefined &&
          typeof node.releasePointerCapture === 'function' && resize.pointerId !== undefined) {
        try {
          node.releasePointerCapture(resize.pointerId)
        } catch (error) {
          // Already released; nothing to do.
        }
      }
    }

    /** Basename of a slash-separated path. */
    function baseName(path) {
      var parts = String(path || '').split('/')
      return parts[parts.length - 1] || path
    }

    /**
     * The directory part of a path, for grouping repositories.
     *
     * Handles both separators because repository roots arrive as native Windows
     * paths (`D:/demo/repo` after normalisation, but a raw `D:\demo\repo` is
     * possible) while a POSIX path uses `/` only.
     *
     * @param path - the path.
     * @returns the parent directory, or `''` when there is none.
     */
    function dirName(path) {
      var text = String(path || '')
      var cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
      return cut <= 0 ? '' : text.slice(0, cut)
    }

    /**
     * The local branch name a remote-tracking ref implies.
     *
     * `origin/feature/login` → `feature/login`: strip only the REMOTE prefix, not
     * everything up to the last slash. A naive `baseName` would produce `login`,
     * silently creating a differently-named branch than the one on the remote —
     * and `git checkout -b login origin/feature/login` would then push to a
     * brand-new `login`, which is a real way to lose track of a branch.
     *
     * @param ref - a remote-tracking ref, e.g. `origin/feature/login`.
     * @returns the short name, e.g. `feature/login`.
     */
    function shortBranchName(ref) {
      var value = String(ref || '')
      var slash = value.indexOf('/')
      return slash === -1 ? value : value.slice(slash + 1)
    }

    // Shared by changes, commit history, comparisons and stash file lists.
    var FILE_ICONS = {
      js: ['JS', '#f7d64a', '#332b00'], ts: ['TS', '#3178c6', '#fff'],
      jsx: ['jsx', '#202a35', '#61dafb'], tsx: ['tsx', '#213b55', '#61dafb'],
      php: ['php', '#777bb3', '#fff'], go: ['GO', '#00add8', '#002d38'],
      java: ['java', '#f89820', '#382000'], css: ['CSS', '#2965f1', '#fff'],
      scss: ['S', '#cc6699', '#fff'], less: ['LESS', '#294e80', '#fff'],
      vue: ['V', 'transparent', '#41b883'], svelte: ['S', '#ff3e00', '#fff'],
      html: ['<>', '#e44d26', '#fff'], json: ['{}', '#e8ba42', '#302200'],
      md: ['M↓', '#36a8e8', '#072336'], yaml: ['Y', '#df6868', '#350b0b'],
      python: ['PY', '#3776ab', '#ffe873'], ruby: ['Rb', '#b52b32', '#fff'],
      rust: ['RS', '#ce9178', '#302016'], c: ['C', '#659ad2', '#fff'],
      cpp: ['C++', '#00599c', '#fff'], cs: ['C#', '#68217a', '#fff'],
      kotlin: ['Kt', '#a97bff', '#24163a'], swift: ['Sw', '#f05138', '#fff'],
      dart: ['D', '#0175c2', '#fff'], shell: ['$_', '#4eaa25', '#102900'],
      powershell: ['>_', '#2671be', '#fff'], sql: ['SQL', '#e5b04c', '#342500'],
      xml: ['</>', '#e49b49', '#342000'], config: ['⚙', '#687c96', '#fff'],
      git: ['git', '#f05032', '#fff'], docker: ['D', '#2496ed', '#fff'],
      image: ['▧', '#a78bda', '#24183b'], archive: ['ZIP', '#ba965c', '#2c210f'],
      text: ['≡', '#8795a6', '#172331'], file: ['•', null, null],
    }
    var FILE_EXTENSIONS = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
      php: 'php', phtml: 'php', go: 'go', java: 'java', class: 'java', jar: 'java',
      css: 'css', scss: 'scss', sass: 'scss', less: 'less', vue: 'vue', svelte: 'svelte',
      html: 'html', htm: 'html', json: 'json', jsonc: 'json', json5: 'json',
      md: 'md', mdx: 'md', markdown: 'md', yml: 'yaml', yaml: 'yaml',
      py: 'python', pyw: 'python', rb: 'ruby', rs: 'rust', c: 'c', h: 'c',
      cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'cs', kt: 'kotlin', kts: 'kotlin',
      swift: 'swift', dart: 'dart', sh: 'shell', bash: 'shell', zsh: 'shell',
      ps1: 'powershell', psm1: 'powershell', bat: 'shell', cmd: 'shell', sql: 'sql',
      xml: 'xml', svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
      webp: 'image', ico: 'image', avif: 'image', zip: 'archive', gz: 'archive',
      tar: 'archive', rar: 'archive', '7z': 'archive', txt: 'text', log: 'text',
      ini: 'config', conf: 'config', cfg: 'config', toml: 'config', properties: 'config',
    }

    function fileIcon(name) {
      var lower = name.toLowerCase()
      var extension = lower.includes('.') ? lower.split('.').pop() : ''
      var kind = /^dockerfile(?:\.|$)/.test(lower) || lower === '.dockerignore' ? 'docker'
        : /^\.git(?:ignore|attributes|modules|keep)$/.test(lower) ? 'git'
          : /^\.env(?:\.|$)/.test(lower) ? 'config'
            : lower === 'go.mod' || lower === 'go.sum' ? 'go'
              : Object.prototype.hasOwnProperty.call(FILE_EXTENSIONS, extension) ? FILE_EXTENSIONS[extension] : 'file'
      var icon = FILE_ICONS[kind]
      var artwork = icon[0]
      if (kind === 'vue') {
        artwork = h('svg', { viewBox: '0 0 24 24', fill: 'none' }, [
          h('path', { key: 'outer', d: 'M1 3h5l6 10 6-10h5L12 22Z', fill: '#41b883' }),
          h('path', { key: 'inner', d: 'M6 3h4l2 3 2-3h4l-6 10Z', fill: '#35495e' }),
        ])
      } else if (kind === 'java') {
        artwork = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, [
          h('path', { key: 'steam', d: 'M12 2c-5 4 5 4 0 8M16 4c-3 2 2 3 0 5' }),
          h('path', { key: 'cup', d: 'M5 12h12v4a6 6 0 0 1-12 0ZM17 12h2a2 2 0 0 1 0 4h-2M4 22h15' }),
        ])
      }
      return h('span', {
        key: 'icon', className: 'dshgit-fileicon', 'data-kind': kind,
        'data-long': icon[0].length > 2 ? 'true' : undefined, 'aria-hidden': 'true',
        style: { '--dshgit-file-bg': icon[1] || undefined, '--dshgit-file-fg': icon[2] || undefined },
      }, artwork)
    }

    /** A compact file icon and split path, as in the Source Control list. */
    function changeFileLabel(path) {
      var name = baseName(path)
      var directory = String(path || '').slice(0, Math.max(0, String(path || '').length - name.length)).replace(/\/$/, '')
      return [
        fileIcon(name),
        h('span', { key: 'label', className: 'dshgit-filelabel' }, [
          h('span', { key: 'name', className: 'dshgit-filename' }, name),
          directory ? h('span', { key: 'dir', className: 'dshgit-filedir' }, directory) : null,
        ]),
      ]
    }

    /** Stable lane hue, adjusted against the host foreground for either theme. */
    var LANE_COLORS = ['#6ea8fe', '#7ee787', '#ffa657', '#d2a8ff', '#79c0ff', '#ff7b72', '#a5d6ff', '#f2cc60']
    function laneColor(lane) {
      return 'color-mix(in srgb, var(--dsw-alias-label-primary) 35%, ' + LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length] + ')'
    }

    /* ------------------------------------------------------------------ *
     * Small presentational pieces
     * ------------------------------------------------------------------ */

    /** A collapsible section with a header row. */
    function Section(props) {
      var openState = React.useState(props.initialOpen !== false)
      var open = openState[0]
      var setOpen = openState[1]
      return h('div', { className: 'dshgit-section' + (props.className ? ' ' + props.className : '') }, [
        h('div', { key: 'bar', className: 'dshgit-sectionbar' }, [
        h(
          'button',
          {
            key: 'head',
            type: 'button',
            className: 'dshgit-sectionhead',
            onClick: function () { setOpen(!open) },
            'aria-expanded': open,
          },
          [
            h('span', { key: 'c', className: 'dshgit-caret' }, h(IconChevron, { open: open })),
            h('span', { key: 't' }, props.title),
          ],
        ),
        props.actions || null,
        props.count === undefined
          ? null
          : h('span', { key: 'n', className: 'dshgit-sectioncount' }, props.count),
        ]),
        open ? h('div', { key: 'body' }, props.children) : null,
      ])
    }

    /** One ref's history is fetched only after the user expands it. */
    function RefHistory(props) {
      var openState = React.useState(props.initialOpen === true)
      var open = openState[0]
      var setOpen = openState[1]
      var itemsState = React.useState([])
      var items = itemsState[0]
      var setItems = itemsState[1]
      var loadingState = React.useState(false)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var moreState = React.useState(true)
      var more = moreState[0]
      var setMore = moreState[1]
      var t = props.t

      var load = function (skip) {
        if (loading) return
        setLoading(true)
        props.run('commits', { root: props.repo.root, ref: props.refName, limit: 20, skip: skip }, { silentError: true })
          .then(function (value) {
            var next = value.commits || []
            setItems(skip === 0 ? next : items.concat(next))
            setMore(next.length === 20)
          })
          .catch(function () { setMore(false) })
          .finally(function () { setLoading(false) })
      }
      React.useEffect(function () {
        if (open && items.length === 0 && more) load(0)
      }, [open, props.repo.root, props.refName])
      React.useEffect(function () {
        if (props.refreshToken === 0) return
        setMore(true)
        if (open) load(0)
        else setItems([])
      }, [props.refreshToken])

      return h('div', { className: 'dshgit-treeitem' }, [
        h('div', {
          key: 'row', className: 'dshgit-treerow',
          'data-ref': props.refName,
          data: props.data,
          onClick: function () { setOpen(!open) },
          onContextMenu: props.onContextMenu,
        }, [
          h('span', { key: 'caret', className: 'dshgit-caret' }, h(IconChevron, { open: open })),
          h('span', { key: 'name', className: 'dshgit-name', title: props.refName }, props.label),
          props.badge ? h('span', { key: 'badge', className: 'dshgit-muted' }, props.badge) : null,
          props.actions ? h('span', { key: 'actions', className: 'dshgit-treeactions' }, props.actions) : null,
        ]),
        open ? h('div', { key: 'children', className: 'dshgit-treechildren' }, [
          items.map(function (commit) {
            return h(TreeCommit, {
              key: commit.sha, commit: commit, repo: props.repo, run: props.run,
              selection: props.selection, onOpenCommit: props.onOpenCommit,
              onOpenRevisionFile: props.onOpenRevisionFile, t: t,
            })
          }),
          loading ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading')) : null,
          more && items.length > 0 ? h('button', {
            key: 'more', type: 'button', className: 'dshgit-btn',
            onClick: function () { load(items.length) },
          }, t('action.loadMore')) : null,
          !loading && items.length === 0 && !more
            ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits')) : null,
        ]) : null,
      ])
    }

    function TreeCommit(props) {
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var detailState = React.useState(null)
      var detail = detailState[0]
      var setDetail = detailState[1]
      var commit = props.commit
      React.useEffect(function () {
        if (!open || detail !== null) return
        props.run('commit', { root: props.repo.root, sha: commit.sha }, { silentError: true })
          .then(setDetail).catch(function () { setDetail({ files: [] }) })
      }, [open, props.repo.root, commit.sha])
      var selected = props.selection !== null && props.selection.sha === commit.sha
      return h('div', { className: 'dshgit-treeitem' }, [
        h('div', { key: 'row', className: 'dshgit-treerow', 'data-selected': selected,
          onClick: function () { props.onOpenCommit(commit.sha) },
        }, [
          h('button', { key: 'toggle', type: 'button', className: 'dshgit-iconbtn',
            'aria-label': props.t('label.files'), onClick: function (event) { event.stopPropagation(); setOpen(!open) },
          }, h(IconChevron, { open: open })),
          h('span', { key: 'subject', className: 'dshgit-name', title: commit.subject }, commit.subject),
          h('span', { key: 'date', className: 'dshgit-muted' }, formatRelative(commit.authorDate)),
        ]),
        open ? h('div', { key: 'files', className: 'dshgit-treechildren' },
          detail === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
            : (detail.files || []).map(function (file) {
              return h('div', { key: file.path, className: 'dshgit-treerow',
                onClick: function () { props.onOpenRevisionFile(commit.sha, file.path, file.from) },
              }, [
                h('span', { key: 'status', className: 'dshgit-status' }, file.status || 'M'),
                h('span', { key: 'path', className: 'dshgit-name', title: file.path }, file.path),
              ])
            })) : null,
      ])
    }

    function StashTreeItem(props) {
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var diffState = React.useState(null)
      var stashDiff = diffState[0]
      var setStashDiff = diffState[1]
      React.useEffect(function () {
        if (!open || stashDiff !== null) return
        props.run('stashDiff', { root: props.repo.root, ref: props.stash.ref }, { silentError: true })
          .then(setStashDiff).catch(function () { setStashDiff({ files: [] }) })
      }, [open, props.repo.root, props.stash.ref])
      var stash = props.stash
      var t = props.t
      var apply = function (pop) {
        props.onWrite('stashApply', { ref: stash.ref, pop: pop }, { after: props.afterWrite })
      }
      return h('div', { className: 'dshgit-treeitem' }, [
        h('div', { key: 'row', className: 'dshgit-treerow',
          onClick: function () { props.onOpenStash(stash) },
          onContextMenu: function (event) { props.showMenu(event, [
            { id: 'view', label: t('action.openChanges'), run: function () { props.onOpenStash(stash) } },
            { id: 'apply', label: t('action.stashApply'), run: function () { apply(false) } },
            { id: 'pop', label: t('action.stashPop'), run: function () { apply(true) } },
            { id: 'drop', label: t('action.stashDrop'), danger: true, run: function () {
              props.requestConfirm(t('confirm.dropStash'), function () {
                props.onWrite('stashDrop', { ref: stash.ref }, { confirm: true, after: props.afterWrite })
              })
            } },
          ]) },
        }, [
          h('button', { key: 'toggle', type: 'button', className: 'dshgit-iconbtn',
            'aria-label': t('label.files'), onClick: function (event) { event.stopPropagation(); setOpen(!open) },
          }, h(IconChevron, { open: open })),
          h('span', { key: 'name', className: 'dshgit-name', title: stash.message }, stash.message),
          h('span', { key: 'date', className: 'dshgit-muted' }, formatRelative(stash.date)),
          h('span', { key: 'actions', className: 'dshgit-treeactions' }, [
            h('button', { key: 'apply', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.stashApply'), onClick: function (event) { event.stopPropagation(); apply(false) },
            }, '↓'),
            h('button', { key: 'pop', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.stashPop'), onClick: function (event) { event.stopPropagation(); apply(true) },
            }, '↧'),
          ]),
        ]),
        open ? h('div', { key: 'files', className: 'dshgit-treechildren' },
          stashDiff === null ? h('div', { className: 'dshgit-empty' }, t('state.loading'))
            : (stashDiff.files || []).map(function (file) {
              return h('div', { key: file.path, className: 'dshgit-treerow',
                onClick: function () { props.onOpenStash(stash, file.path) },
              }, [
                h('span', { key: 'status', className: 'dshgit-status' }, file.status || 'M'),
                h('span', { key: 'path', className: 'dshgit-name', title: file.path }, file.path),
              ])
            })) : null,
      ])
    }

    /**
     * A small dropdown menu.
     *
     * Normally positioned under its trigger. The commit split button portals
     * its menu so the workbench sidebar and compact popover cannot clip it.
     * Outside click and Escape close it.
     */
    function Menu(props) {
      var t = props.t
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var rootRef = React.useRef(null)
      var menuRef = React.useRef(null)
      var rectState = React.useState(null)
      var menuRect = rectState[0]
      var setMenuRect = rectState[1]
      useCloseOnWindowHide(rootRef, setOpen)

      React.useEffect(
        function () {
          if (!open) return undefined
          var close = function (event) {
            if (rootRef.current !== null && rootRef.current.contains(event.target)) return
            if (menuRef.current !== null && menuRef.current.contains(event.target)) return
            setOpen(false)
          }
          var onKey = function (event) {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('mousedown', close)
          document.addEventListener('keydown', onKey)
          return function () {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', onKey)
          }
        },
        [open],
      )

      var items = props.items || []
      var portalled = props.portal === true && menuRect !== null
      var menuNode = open ? h('div', {
        key: 'menu', ref: menuRef,
        className: 'dshgit-menu' + (props.menuClass ? ' ' + props.menuClass : ''), role: 'menu',
        style: portalled
          ? { position: 'fixed', top: menuRect.bottom + 4 + 'px',
              right: Math.max(8, window.innerWidth - menuRect.right) + 'px' }
          : { position: 'absolute', top: 'calc(100% + 4px)',
              left: props.align === 'right' ? undefined : 0,
              right: props.align === 'right' ? 0 : undefined },
      }, items.map(function (item, index) {
        if (item === null || item === undefined) return null
        if (item.separator === true) return h('div', { key: 'sep' + index, className: 'dshgit-menusep' })
        return h('button', {
          key: item.id ?? index, type: 'button', role: 'menuitem',
          className: 'dshgit-menuitem' + (item.danger === true ? ' dshgit-menudanger' : ''),
          disabled: item.disabled === true, title: item.hint,
          onClick: function () { setOpen(false); item.run() },
        }, item.label)
      })) : null
      return h('span', { ref: rootRef,
        className: props.rootClass,
        style: { position: 'relative', display: 'inline-block' },
      }, [
        h(
          'button',
          {
            key: 'trigger',
            type: 'button',
            // The trigger is a button so the whole label is a real click target,
            // but its class is the caller's: the compact branch switcher reuses
            // the badge's own look instead of growing a second, differently
            // styled control beside it.
            className: props.triggerClass === undefined ? 'dshgit-btn' : props.triggerClass,
            disabled: props.disabled === true,
            onClick: function (event) {
              if (typeof props.onOpen === 'function') props.onOpen()
              if (!open && props.portal === true && rootRef.current?.getBoundingClientRect) {
                var rect = rootRef.current.getBoundingClientRect()
                setMenuRect({ bottom: rect.bottom, right: rect.right })
              }
              setOpen(!open)
              event.stopPropagation()
            },
            title: props.title,
            'aria-label': props.title,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
          },
          props.label,
        ),
        portalled && open ? ReactDOM.createPortal(menuNode, document.body) : menuNode,
      ])
    }

    /** Native right-click menu, portaled so pane scrolling cannot clip it. */
    function FileContextMenu(props) {
      var menu = props.menu
      var rootRef = React.useRef(null)
      React.useEffect(function () {
        if (menu === null) return undefined
        var outside = function (event) {
          if (rootRef.current?.contains?.(event.target)) return
          props.onClose()
        }
        var key = function (event) { if (event.key === 'Escape') props.onClose() }
        document.addEventListener('mousedown', outside)
        document.addEventListener('keydown', key)
        return function () {
          document.removeEventListener('mousedown', outside)
          document.removeEventListener('keydown', key)
        }
      }, [menu])
      if (menu === null) return null
      var width = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
      var height = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
      var menuWidth = Math.min(menu.compact ? 180 : 360, width - 8)
      var x = Math.max(4, Math.min(menu.x, width - menuWidth - 4))
      var menuHeight = menu.items.reduce(function (total, item) { return total + (item.separator ? 9 : 34) }, 12)
      var y = Math.max(4, Math.min(menu.y, height - Math.min(menuHeight, height * .8) - 4))
      return ReactDOM.createPortal(h('div', {
        ref: rootRef, className: 'dshgit-contextmenu', role: 'menu',
        style: { left: x + 'px', top: y + 'px', width: menuWidth + 'px', maxHeight: Math.min(height * .8, height - y - 4) + 'px' },
        onContextMenu: function (event) { event.preventDefault() },
      }, menu.items.map(function (item, index) {
        if (item.separator) return h('div', { key: 'sep' + index, className: 'dshgit-menusep' })
        return h('button', {
          key: item.id, type: 'button', role: 'menuitem',
          className: 'dshgit-menuitem' + (item.danger ? ' dshgit-menudanger' : ''),
          disabled: item.disabled === true, title: [item.hint, item.command].filter(Boolean).join('\n') || undefined,
          onClick: function () { props.onClose(); item.run() },
        }, [h('span', { key: 'label' }, item.label), item.command ? h('code', { key: 'command', className: 'dshgit-menucommand' }, item.command) : null])
      })), document.body)
    }

    /**
     * The plugin's own git output — the `Show Git Output` view.
     *
     * Shows the argv, exit code and duration for every git command the plugin
     * ran, with stderr kept separate so a rejected push is readable. Values are
     * already credential-masked by the Host's command log.
     */
    /**
     * The output module's editor: the command log itself.
     *
     * Split out of {@link OutputView} so the module can render as sidebar +
     * editor like every other module. The entries are owned by the caller now,
     * because the sidebar shows their count and would otherwise fetch the same
     * list a second time.
     *
     * @param props - `{ t, entries, filter }`.
     */
    function OutputList(props) {
      var t = props.t
      if (props.entries === null) {
        return h('div', { className: 'dshgit-empty' }, t('state.loading'))
      }
      var entries = props.filter === 'failed'
        ? props.entries.filter(function (entry) { return entry.code !== 0 })
        : props.entries
      if (entries.length === 0) {
        return h('div', { className: 'dshgit-empty' },
          props.filter === 'failed' ? t('output.noFailures') : t('state.noChanges'))
      }
      return h('div', { className: 'dshgit-loglist' }, entries.map(function (entry) {
        return h('div', { key: entry.id, className: 'dshgit-logrow' }, [
          h('div', { key: 'head', className: 'dshgit-loghead' }, [
            h('span', {
              key: 'code',
              className: entry.code === 0 ? 'dshgit-add' : 'dshgit-logerr',
            }, entry.code === 0 ? '✓ 0' : '✗ ' + String(entry.code)),
            h('span', { key: 'cmd', className: 'dshgit-logcmd' }, entry.command),
            h('span', { key: 'meta', className: 'dshgit-muted' },
              formatTime(Math.floor(entry.at / 1000)) +
              (entry.durationMs === null ? '' : ' · ' + entry.durationMs + 'ms')),
          ]),
          entry.error !== null && entry.error !== undefined
            ? h('pre', { key: 'err', className: 'dshgit-logout dshgit-logerr' }, entry.error)
            : null,
          entry.stderr !== '' && entry.code !== 0
            ? h('pre', { key: 'stderr', className: 'dshgit-logout dshgit-logerr' }, entry.stderr)
            : null,
          entry.stdout !== ''
            ? h('pre', { key: 'stdout', className: 'dshgit-logout' },
                entry.stdout.length > 800 ? entry.stdout.slice(0, 800) + '…' : entry.stdout)
            : null,
        ])
      }))
    }

    function OutputView(props) {
      var t = props.t
      var entriesState = React.useState(null)
      var entries = entriesState[0]
      var setEntries = entriesState[1]

      var load = React.useCallback(
        function () {
          return props.run('gitOutput', { limit: 200 }, { silentError: true })
            .then(function (value) { setEntries(value.entries || []) })
            .catch(function () { setEntries([]) })
        },
        [props.run],
      )

      React.useEffect(function () { load() }, [load])

      return h(Fragment, null, [
        h('div', { key: 'bar', className: 'dshgit-card', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
          h('span', { key: 'n', className: 'dshgit-muted' },
            entries === null ? t('state.loading') : String(entries.length) + ' 条命令'),
          h('span', { key: 'spacer', style: { flex: '1' } }),
          h('button', { key: 'reload', type: 'button', className: 'dshgit-btn', onClick: load }, t('action.refresh')),
          h('button', {
            key: 'clear',
            type: 'button',
            className: 'dshgit-btn',
            onClick: function () {
              props.run('clearGitOutput', {}, { silentError: true })
                .then(function () { setEntries([]) })
                .catch(function () {})
            },
          }, t('action.clearOutput')),
        ]),
        h(OutputList, { key: 'list', entries: entries, filter: 'all', t: t }),
      ])
    }

    /**
     * Normalize one dialog option.
     *
     * Options are plain strings in most dialogs. A `{ value, label, group }`
     * object is also accepted so a list can be split into `<optgroup>` sections —
     * the branch picker needs "local" and "remote" separated, and a flat list of
     * twenty refs with no grouping is exactly where a user picks the wrong one.
     *
     * @param option - a string or an option object.
     * @returns `{ value, label, group }`.
     */
    function dialogOption(option) {
      if (typeof option === 'string') return { value: option, label: option, group: '' }
      return {
        value: option.value,
        label: option.label === undefined ? String(option.value) : option.label,
        group: option.group === undefined ? '' : option.group,
      }
    }

    /**
     * Group normalized options, preserving first-seen order.
     *
     * Shared by the native `<select>` renderer and the filterable combobox, so a
     * list cannot group one way in a dialog and another way in a picker.
     *
     * @param options - the raw option list.
     * @returns `[{ name, items }]`; `name` is `''` for ungrouped options.
     */
    function groupOptions(options) {
      var normalized = options.map(dialogOption)
      var groups = []
      for (var i = 0; i < normalized.length; i++) {
        var group = normalized[i].group
        var bucket = null
        for (var g = 0; g < groups.length; g++) if (groups[g].name === group) bucket = groups[g]
        if (bucket === null) {
          bucket = { name: group, items: [] }
          groups.push(bucket)
        }
        bucket.items.push(normalized[i])
      }
      return groups
    }

    /**
     * A filterable select.
     *
     * A native `<select>` cannot be searched. Its popup list is drawn by the OS,
     * so there is nowhere to type, and `<datalist>` matches only from the start
     * of the value and cannot be styled or grouped. Picking one ref out of a long
     * branch list is exactly where a filter earns its keep, so this is a real
     * combobox.
     *
     * Interaction model, matching the editors people already use:
     *   - focusing empties the box and opens the list, with the current selection
     *     kept as the placeholder so context is never lost;
     *   - typing filters on the label, the value and the group name;
     *   - arrows move the highlight, Enter picks it, Escape closes without
     *     changing the value;
     *   - clicking away restores the selection label.
     *
     * @param props - `{ value, options, placeholder, onChange, t, autoFocus,
     *   className, style, listWidth }`.
     */
    function ComboBox(props) {
      var t = props.t
      var options = (props.options || []).map(dialogOption)
      var current = null
      for (var ci = 0; ci < options.length; ci++) {
        if (options[ci].value === props.value) current = options[ci]
      }

      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var activeState = React.useState(0)
      var active = activeState[0]
      var setActive = activeState[1]
      var inputRef = React.useRef(null)
      useCloseOnWindowHide(inputRef, setOpen)

      // Filter on everything the row shows, plus its group: a user looking for
      // "the remote one called login" can type either part.
      var needle = query.trim().toLowerCase()
      var filtered = options.filter(function (item) {
        if (needle === '') return true
        return item.label.toLowerCase().indexOf(needle) !== -1 ||
          String(item.value).toLowerCase().indexOf(needle) !== -1 ||
          (item.group || '').toLowerCase().indexOf(needle) !== -1
      })
      var groups = groupOptions(filtered)
      var flat = []
      for (var fi = 0; fi < groups.length; fi++) flat = flat.concat(groups[fi].items)
      // Clamp the highlight: the list shrinks under it as the user types, so the
      // stored index can point past the end.
      var activeIndex = flat.length === 0 ? -1 : Math.max(0, Math.min(active, flat.length - 1))

      /** Commit a choice and collapse. */
      var pick = function (value) {
        setOpen(false)
        setQuery('')
        setActive(0)
        props.onChange(value)
      }

      /** Collapse without choosing, restoring the selection label. */
      var dismiss = function () {
        setOpen(false)
        setQuery('')
        setActive(0)
      }

      var rect = inputRef.current !== null && inputRef.current !== undefined &&
        typeof inputRef.current.getBoundingClientRect === 'function'
        ? inputRef.current.getBoundingClientRect()
        : null

      var list = null
      if (open && rect !== null) {
        var rows = []
        var index = 0
        /** One selectable row; `myIndex` is its position in the flattened list. */
        var makeRow = function (item, myIndex) {
          var isCurrent = item.value === props.value
          return h('button', {
            key: 'o:' + item.value,
            type: 'button',
            role: 'option',
            'aria-selected': isCurrent,
            'data-value': item.value,
            'data-active': myIndex === activeIndex ? 'true' : 'false',
            className: 'dshgit-combooption' + (isCurrent ? ' dshgit-combooptioncurrent' : ''),
            ref: myIndex === activeIndex
              // Keep the highlighted row in view during arrow navigation. A
              // function ref: the test harness ignores those, and browsers only
              // need it to exist.
              ? function (node) {
                  if (node !== null && typeof node.scrollIntoView === 'function') {
                    node.scrollIntoView({ block: 'nearest' })
                  }
                }
              : undefined,
            // Keep focus in the input so the list does not close before the click
            // lands, and so typing can continue seamlessly.
            onMouseDown: function (event) { event.preventDefault() },
            onMouseEnter: function () { setActive(myIndex) },
            onClick: function () { pick(item.value) },
          }, [
            h('span', { key: 'c', className: 'dshgit-combocheck' }, isCurrent ? '✓' : ''),
            h('span', { key: 'l', className: 'dshgit-combolabel', title: item.label }, item.label),
          ])
        }
        for (var hi = 0; hi < groups.length; hi++) {
          var entry = groups[hi]
          if (entry.name !== '') {
            rows.push(h('div', { key: 'g:' + entry.name, className: 'dshgit-combogroup' }, entry.name))
          }
          for (var ii = 0; ii < entry.items.length; ii++) {
            rows.push(makeRow(entry.items[ii], index++))
          }
        }
        if (flat.length === 0) {
          rows.push(h('div', { key: 'none', className: 'dshgit-comboempty' }, t('combo.noMatch')))
        }
        var listWidth = props.listWidth === undefined ? rect.width : props.listWidth
        list = ReactDOM.createPortal(h('div', {
          key: 'list',
          className: 'dshgit-combolist',
          role: 'listbox',
          'data-combo-list': props.value,
          onMouseDown: function (event) { event.preventDefault() },
          style: { left: rect.left + 'px', top: rect.bottom + 4 + 'px', width: listWidth + 'px' },
        }, rows), document.body)
      }

      return h(Fragment, null, [
        h('input', {
          key: 'input',
          ref: inputRef,
          className: 'dshgit-input dshgit-comboinput' + (props.className === undefined ? '' : ' ' + props.className),
          style: props.style,
          type: 'text',
          role: 'combobox',
          autoComplete: 'off',
          spellCheck: false,
          autoFocus: props.autoFocus === true,
          disabled: props.disabled === true,
          'aria-label': props.label || props.placeholder,
          'aria-expanded': open,
          'aria-autocomplete': 'list',
          'data-combo': props.value,
          // While open the box holds the FILTER; while closed it shows the
          // selection, so the control still reads as a select at rest.
          value: open ? query : (current === null ? '' : current.label),
          placeholder: open && current !== null ? current.label : props.placeholder,
          onFocus: function () { setOpen(true); setQuery(''); setActive(0) },
          onChange: function (event) {
            setOpen(true)
            setQuery(event.currentTarget.value)
            setActive(0)
          },
          onBlur: dismiss,
          onKeyDown: function (event) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) { setOpen(true); return }
              if (flat.length === 0) return
              var step = event.key === 'ArrowDown' ? 1 : -1
              var next = activeIndex + step
              if (next < 0) next = flat.length - 1
              if (next >= flat.length) next = 0
              setActive(next)
              return
            }
            if (event.key === 'Enter') {
              if (open && activeIndex >= 0 && flat[activeIndex] !== undefined) {
                event.preventDefault()
                pick(flat[activeIndex].value)
              }
              return
            }
            if (event.key === 'Escape') {
              if (!open) return
              event.preventDefault()
              // Stopping here matters: the surrounding dialog also closes on
              // Escape, and dismissing a list must not throw away the whole form.
              event.stopPropagation()
              dismiss()
              return
            }
            if (event.key === 'Tab' && open) dismiss()
          },
        }),
        list,
      ])
    }

    /** Keyboard focus stays inside a modal until it closes. */
    function useDialogFocus(panelRef, onClose, options) {
      var closeRef = React.useRef(onClose)
      closeRef.current = onClose
      React.useEffect(function () {
        var opts = options || {}
        var opener = opts.opener || document.activeElement
        var panel = panelRef.current
        if (panel && !panel.contains?.(document.activeElement)) {
          var first = opts.cancelFirst ? panel.querySelector?.('button:last-child')
            : panel.querySelector?.('input:not(:disabled),textarea:not(:disabled)') || panel.querySelector?.('button:not(:disabled)')
          if (first) first.focus?.()
          else panel.focus?.()
        }
        var key = function (event) {
          if (event.defaultPrevented || (event.target && panel && !panel.contains?.(event.target))) return
          if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
          if (event.key !== 'Tab') return
          var controls = Array.from(panel?.querySelectorAll?.('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])
          if (controls.length === 0) { event.preventDefault(); panel?.focus?.(); return }
          var first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus?.() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus?.() }
        }
        document.addEventListener('keydown', key)
        return function () {
          document.removeEventListener('keydown', key)
          // A newly opened dialog may already own focus. Do not steal it while
          // cleaning up the dialog that launched it.
          var current = document.activeElement
          if (opener?.isConnected !== false && (!current || current === document.body || current.isConnected === false || panel?.contains?.(current))) opener?.focus?.()
        }
      }, [])
    }

    /** A small form dialog: clone, new branch, new tag, add/remove remote. */
    /** Add a remote and optionally continue the original first push. */
    function RemoteConfigDialog(props) {
      var t = props.t, dialogRef = React.useRef(null), pending = React.useRef(false)
      var mounted = React.useRef(true), repositoryRetry = React.useState(0)
      React.useEffect(function () { return function () { mounted.current = false } }, [])
      var source = React.useState('url'), name = React.useState('origin'), url = React.useState('')
      var sourceTouched = React.useRef(false)
      var githubMode = React.useState('new'), repositoryName = React.useState(baseName(props.repo.root.replace(/\\/g, '/')).replace(/[^a-z\d_.-]/gi, '-'))
      var visibility = React.useState('private'), created = React.useRef(null), createdState = React.useState(false)
      var accounts = React.useState(null), account = React.useState(''), repositories = React.useState([])
      var page = React.useState(1), more = React.useState(false), repoLoading = React.useState(false), repoError = React.useState(null)
      var busy = React.useState(false), error = React.useState(null), saved = React.useState(false)
      var close = function () { if (!pending.current) props.onClose() }
      var chooseSource = function (kind) { sourceTouched.current = true; source[1](kind); if (kind === 'url') created.current = null }
      useDialogFocus(dialogRef, close)
      React.useEffect(function () {
        var active = true
        props.run('hostingAccounts', { root: props.repo.root }, { silentError: true })
          .then(function (value) { if (active) { accounts[1](value.accounts || []); account[1](value.accounts?.[0]?.id || ''); if (props.initialPush && value.accounts?.length && !sourceTouched.current) source[1]('github') } })
          .catch(function () { if (active) accounts[1]([]) })
        return function () { active = false }
      }, [props.repo.root])
      React.useEffect(function () {
        if (source[0] !== 'github' || githubMode[0] !== 'existing' || !account[0]) return
        var active = true
        repoLoading[1](true); repoError[1](null)
        props.run('hostingRepositories', { root: props.repo.root, account: account[0], page: page[0] }, { silentError: true })
          .then(function (value) {
            if (!active) return
            repositories[1](function (rows) { return page[0] === 1 ? value.repositories || [] : rows.concat(value.repositories || []).filter(function (row, index, all) { return all.findIndex(function (other) { return other.url === row.url }) === index }) })
            more[1](value.hasMore === true)
          }).catch(function (failure) { if (active) repoError[1](failure.message) })
          .finally(function () { if (active) repoLoading[1](false) })
        return function () { active = false }
      }, [props.repo.root, source[0], githubMode[0], account[0], page[0], repositoryRetry[0]])
      var creating = source[0] === 'github' && githubMode[0] === 'new' && !createdState[0]
      var valid = !!name[0].trim() && (creating ? !!account[0] && /^[a-z\d_.-]{1,100}$/i.test(repositoryName[0].trim()) && !/^\.+$/.test(repositoryName[0].trim()) : !!url[0].trim())
      var save = async function (push) {
        if (pending.current || !valid) return
        var remoteName = name[0].trim(), address = url[0].trim()
        if (!saved[0] && (props.remotes || []).some(function (remote) { return remote.name === remoteName })) { error[1](t('remote.exists')); return }
        if (remoteName.startsWith('-') || /[\s\0]/.test(remoteName) || address.startsWith('-') || /[\0\r\n]/.test(address)) { error[1](t('remote.invalid')); return }
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) {
          try { if (new URL(address).password) { error[1](t('remote.invalid')); return } }
          catch (_) { error[1](t('remote.invalid')); return }
        }
        pending.current = true; busy[1](true); error[1](null)
        try {
          if (creating && !created.current) {
            var result = await props.onWrite('createHostingRepository', { root: props.repo.root, account: account[0],
              name: repositoryName[0].trim(), private: visibility[0] !== 'public', remoteName: remoteName, branch: push ? props.branch : undefined })
            if (!result || !mounted.current) return
            created.current = result.repository; createdState[1](true); url[1](result.repository.url)
          }
          if (created.current) address = created.current.url
          if (!saved[0]) {
            var added = await props.onWrite('addRemote', { root: props.repo.root, name: remoteName, url: address, addOnly: true })
            if (!added || !mounted.current) return
            saved[1](true); props.onSaved()
          }
          if (push) {
            var pushed = await props.onWrite('push', { root: props.repo.root, remote: remoteName, sourceBranch: props.branch,
              targetBranch: props.branch, setUpstream: true, hostingAccount: source[0] === 'github' ? account[0] : undefined })
            if (!pushed || !mounted.current) return
            props.onSaved()
          }
          props.onClose()
        } catch (failure) { if (mounted.current) error[1](failure.message) }
        finally { pending.current = false; if (mounted.current) busy[1](false) }
      }
      var field = function (key, label, state) { return h('label', { key: key, className: 'dshgit-field' }, [
        h('span', { key: 'label', className: 'dshgit-fieldlabel' }, label),
        h('input', { key: 'input', className: 'dshgit-input', 'data-remote-field': key, value: state[0], disabled: busy[0] || saved[0],
          autoFocus: key === 'url', placeholder: key === 'url' ? 'https://host/owner/repository.git' : 'origin',
          onChange: function (event) { sourceTouched.current = true; state[1](event.currentTarget.value); error[1](null) } }),
      ]) }
      return h('div', { className: 'dshgit-modal', onClick: close }, h('form', {
        className: 'dshgit-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('remote.configure'), ref: dialogRef, tabIndex: -1,
        style: { width: 'min(560px, 100%)' }, 'data-remote-dialog': props.repo.root,
        onClick: function (event) { event.stopPropagation() }, onSubmit: function (event) { event.preventDefault(); save(props.initialPush && !!props.branch) },
      }, [
        h('h3', { key: 'title' }, t('remote.configure')),
        h('div', { key: 'sources', className: 'dshgit-tools' }, ['url', 'github'].map(function (kind) { return h('button', {
          key: kind, type: 'button', className: 'dshgit-btn', 'aria-pressed': source[0] === kind, 'data-remote-source': kind,
          disabled: busy[0] || saved[0] || createdState[0], onClick: function () { chooseSource(kind) },
        }, t(kind === 'url' ? 'remote.address' : 'remote.github')) })),
        source[0] === 'github' ? accounts[0] === null ? h('div', { key: 'accounts-loading', role: 'status' }, t('state.loading'))
          : !accounts[0].length ? h('div', { key: 'no-accounts', className: 'dshgit-muted' }, t('remote.noAccounts'))
            : h('fieldset', { key: 'github', className: 'dshgit-field', disabled: busy[0] || saved[0] || createdState[0], style: { border: 0, padding: 0, margin: 0 } }, [
                accounts[0].length > 1 ? h(ComboBox, { key: 'account', value: account[0], t: t, options: accounts[0].map(function (entry) {
                  return { value: entry.id, label: entry.login + ' · ' + entry.host + ' · ' + (entry.source === 'gh' ? 'GitHub CLI' : 'Git Credential Manager') }
                }), onChange: function (value) { account[1](value); page[1](1); repositories[1]([]); url[1]('') } })
                  : h('div', { key: 'account', className: 'dshgit-muted' }, accounts[0][0].login + ' · ' + accounts[0][0].host),
                h('div', { key: 'mode', className: 'dshgit-tools' }, ['new', 'existing'].map(function (mode) { return h('button', {
                  key: mode, type: 'button', className: 'dshgit-btn', 'data-github-mode': mode, 'aria-pressed': githubMode[0] === mode,
                  onClick: function () { githubMode[1](mode); url[1]('') },
                }, t(mode === 'new' ? 'remote.newRepository' : 'remote.existingRepository')) })),
                githubMode[0] === 'new' ? h('div', { key: 'name', className: 'dshgit-field' }, [
                  h('span', { key: 'label', className: 'dshgit-fieldlabel' }, t('remote.repositoryName')),
                  h('input', { key: 'input', className: 'dshgit-input', 'data-remote-field': 'repositoryName', value: repositoryName[0],
                    'aria-label': t('remote.repositoryName'),
                    onChange: function (event) { repositoryName[1](event.currentTarget.value) } }),
                  h('div', { key: 'visibility', role: 'radiogroup', className: 'dshgit-visibility-options', 'aria-label': t('remote.repository') }, ['private', 'public'].map(function (kind) {
                    var login = (accounts[0] || []).find(function (entry) { return entry.id === account[0] })?.login || ''
                    return h('button', { key: kind, type: 'button', className: 'dshgit-visibility-option', role: 'radio', tabIndex: visibility[0] === kind ? 0 : -1,
                      'aria-checked': visibility[0] === kind, 'data-selected': visibility[0] === kind, 'data-remote-visibility': kind,
                      onClick: function () { visibility[1](kind) },
                      onKeyDown: function (event) {
                        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) < 0) return
                        event.preventDefault()
                        var next = kind === 'private' ? 'public' : 'private'
                        visibility[1](next)
                        event.currentTarget.parentNode?.querySelector?.('[data-remote-visibility="' + next + '"]')?.focus?.()
                      },
                    }, [
                      h('span', { key: 'radio', className: 'dshgit-visibility-radio', 'aria-hidden': true }),
                      h('span', { key: 'label', className: 'dshgit-visibility-label' }, [
                        h('span', { key: 'title', className: 'dshgit-visibility-title' }, t('remote.' + kind + 'Label')),
                        h('span', { key: 'path', className: 'dshgit-muted', title: login + '/' + repositoryName[0] }, login + '/' + repositoryName[0]),
                      ]),
                    ])
                  })),
                ]) : h('div', { key: 'existing' }, [
                  h('span', { key: 'repo-label', className: 'dshgit-fieldlabel' }, t('remote.repository')),
                  h(ComboBox, { key: 'repository', value: url[0], t: t, options: repositories[0].map(function (entry) { return { value: entry.url, label: entry.name } }), onChange: url[1] }),
                repoLoading[0] ? h('div', { key: 'loading', role: 'status' }, t('state.loading')) : null,
                repoError[0] ? h('div', { key: 'error', role: 'alert' }, repoError[0]) : null,
                !repoLoading[0] && !repoError[0] && !repositories[0].length ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('remote.noRepos')) : null,
                more[0] || repoError[0] ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn', disabled: repoLoading[0],
                  onClick: function () { if (repoError[0]) repositoryRetry[1](repositoryRetry[0] + 1); else page[1](page[0] + 1) },
                }, t(repoError[0] ? 'stash.retry' : 'action.loadMore')) : null,
                ]),
              ]) : null,
        !creating ? field('url', t('remote.address'), url) : null,
        source[0] === 'url' ? h('div', { key: 'hint', className: 'dshgit-muted' }, t('remote.hint')) : null,
        creating ? h('details', { key: 'advanced' }, [h('summary', { key: 'label' }, t('remote.name') + ': ' + name[0]), field('name', t('remote.name'), name)]) : field('name', t('remote.name'), name),
        !creating && props.branch ? h('div', { key: 'branch', className: 'dshgit-muted' }, t('remote.pushBranch') + ': ' + props.branch) : null,
        source[0] === 'url' ? h('div', { key: 'auth', className: 'dshgit-muted' }, t('remote.authHint')) : null,
        error[0] ? h('div', { key: 'error', role: 'alert' }, error[0]) : null,
        h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
          h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busy[0], onClick: close }, t(saved[0] ? 'action.close' : 'action.cancel')),
          !saved[0] && !creating ? h('button', { key: 'save', type: 'button', className: 'dshgit-btn' + (!props.initialPush ? ' dshgit-btn-primary' : ''),
            'data-remote-action': 'save', disabled: busy[0] || !valid, onClick: function () { save(false) },
          }, busy[0] ? t('state.loading') : t('remote.save')) : null,
          props.branch ? h('button', { key: 'push', type: 'button', className: 'dshgit-btn' + (props.initialPush || saved[0] ? ' dshgit-btn-primary' : ''),
            'data-remote-action': 'push', disabled: busy[0] || !valid, onClick: function () { save(true) },
          }, busy[0] ? h('span', { className: 'dshgit-spinner' }) : t(saved[0] ? 'action.push' : creating ? 'remote.publish' : 'remote.savePush')) : null,
        ]),
      ]))
    }

    function PromptDialog(props) {
      var t = props.t
      var saving = React.useState(false), saveError = React.useState(null), savingRef = React.useRef(false)
      var spec = props.spec
      var dialogRef = React.useRef(null)
      useDialogFocus(dialogRef, props.onClose, { opener: props.opener })
      var valuesState = React.useState(function () {
        var initial = {}
        for (var i = 0; i < (spec.fields || []).length; i++) {
          var field = spec.fields[i]
          initial[field.key] = field.initial !== undefined ? field.initial : field.value !== undefined ? field.value : field.options !== undefined && field.options.length > 0
            ? dialogOption(field.options[0]).value
            : (field.initial === undefined ? '' : field.initial)
        }
        return initial
      })
      var values = valuesState[0]
      var setValues = valuesState[1]
      var submitValues = function () {
        if (savingRef.current) return
        if (!spec.awaitSubmit) { props.onClose(); spec.submit(values); return }
        savingRef.current = true; saving[1](true); saveError[1](null)
        Promise.resolve().then(function () { return spec.submit(values) }).then(props.onClose)
          .catch(function (error) { saveError[1](error.message) })
          .finally(function () { savingRef.current = false; saving[1](false) })
      }

      /**
       * Apply one field change, plus whatever it derives.
       *
       * A field may declare `derive(value, values)`, returning a patch of other
       * fields. That is what lets "start point = origin/feature/login" fill in
       * the branch name without the user retyping it — the single most error
       * prone step in creating a tracking branch by hand.
       *
       * @param key - the changed field.
       * @param value - its new value.
       */
      var setField = function (key, value) {
        setValues(function (current) {
          var next = Object.assign({}, current)
          next[key] = value
          var field = null
          for (var i = 0; i < (spec.fields || []).length; i++) {
            if (spec.fields[i].key === key) field = spec.fields[i]
          }
          if (field !== null && typeof field.derive === 'function') {
            var patch = field.derive(value, next)
            if (patch !== null && patch !== undefined) Object.assign(next, patch)
          }
          return next
        })
      }

      var fields = (spec.fields || []).map(function (field) {
        if (field.type === 'checkbox') return h('label', { key: field.key, className: 'dshgit-commit-check' }, [
          h('input', { key: 'input', type: 'checkbox', checked: values[field.key] === true,
            onChange: function (event) { setField(field.key, event.currentTarget.checked) },
          }), h('span', { key: 'label' }, field.label),
        ])

        if (field.options !== undefined) {
          if (field.type === 'select') return h('div', { key: field.key, className: 'dshgit-field' }, [
            h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
            h('select', { key: 'i', className: 'dshgit-input', value: values[field.key], 'aria-label': field.label,
              disabled: saving[0] || !field.options.length,
              onChange: function (event) { setField(field.key, event.currentTarget.value) },
            }, field.options.map(function (option) { var item = dialogOption(option); return h('option', { key: item.value, value: item.value }, item.label) })),
          ])
          return h('div', { key: field.key, className: 'dshgit-field' }, [
            h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
            // A filterable combobox, not a native <select>: the start-point list
            // is every local branch, every remote branch and every tag, which is
            // exactly the list a user needs to type into.
            h(ComboBox, {
              key: 'i',
              t: t,
              value: values[field.key],
              options: field.options,
              placeholder: field.placeholder,
              onChange: function (value) { setField(field.key, value) },
            }),
          ])
        }
        return h('div', { key: field.key, className: 'dshgit-field' }, [
          h('span', { key: 'l', className: 'dshgit-fieldlabel' }, field.label),
          h('input', {
            key: 'i',
            className: 'dshgit-input',
            value: values[field.key],
            placeholder: field.placeholder,
            autoFocus: (spec.fields || [])[0]?.key === field.key,
            onChange: function (event) { setField(field.key, event.currentTarget.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter') {
                event.preventDefault(); submitValues()
              }
            },
          }),
        ])
      })

      var actions = (spec.actions || []).map(function (action) {
        return h(
          'button',
          {
            key: action.label,
            type: 'button',
            className: 'dshgit-btn' + (action.danger === true ? ' dshgit-btn-danger' : ''),
            onClick: function () {
              props.onClose()
              action.run()
            },
          },
          action.label,
        )
      })

      if (spec.actions === undefined) {
        actions.push(
          h('button', {
            key: 'ok',
            type: 'button',
            className: 'dshgit-btn dshgit-btn-primary',
            disabled: saving[0], onClick: submitValues,
          }, t('action.ok')),
        )
      }
      actions.push(
        h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: saving[0], onClick: props.onClose }, t('action.cancel')),
      )

      return h('div', { className: 'dshgit-modal', onClick: function () { if (!savingRef.current) props.onClose() } }, [
        h('div', {
          key: 'dialog',
          ref: dialogRef,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': true,
          'aria-label': spec.title,
          className: 'dshgit-dialog' + (spec.compact ? ' dshgit-dialog-compact' : ''),
          onClick: function (event) { event.stopPropagation() },
        }, [
          h('div', { key: 'title', className: 'dshgit-dialogtitle' }, spec.title),
        ].concat(fields).concat([
          saveError[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-cl-error' }, saveError[0]) : null,
          h('div', { key: 'actions', className: 'dshgit-dialogactions' }, actions),
        ])),
      ])
    }

    /** A transient banner used for action outcomes. */
    function Toast(props) {
      React.useEffect(
        function () {
          var timer = setTimeout(props.onDone, props.action ? 8000 : 3600)
          return function () { clearTimeout(timer) }
        },
        [props.seq],
      )
      return h('div', { className: 'dshgit-toast', role: 'status', style: props.action ? { pointerEvents: 'auto' } : undefined }, [
        props.busy === true ? h('span', { key: 's', className: 'dshgit-spinner' }) : null,
        h('span', { key: 't' }, props.text),
        props.action ? h('button', { key: 'action', type: 'button', className: 'dshgit-btn', style: { marginLeft: '8px' },
          onClick: function () { props.onDone(); props.action.run() },
        }, props.action.label) : null,
      ])
    }

    /**
     * The outcome of a Git action, shown next to the chips that started it.
     *
     * Replaces a bare `<span>` that printed the raw message in error-red at a
     * fixed 220px. That had five problems, all of them visible in one screenshot:
     *
     *   1. It printed git's raw stderr, which leads with the URL and repeats
     *      `error: failed to push some refs` — the sentence that says what to DO
     *      was last, and clipped.
     *   2. 220px + `text-overflow: ellipsis` cut the reason off mid-word.
     *   3. It was ALWAYS red, so a successful push read as a failure.
     *   4. It sat inline in the chip row, so a long message squeezed the chips.
     *   5. It had no icon, no dismissal, and no way to see the full text.
     *
     * This banner instead: a tone (success/error) that drives colour AND icon, a
     * one-line summary, an optional plain-language hint plus the action that
     * resolves it, a dismiss control, and the full raw text on demand.
     *
     * It renders into the chip row but is absolutely positioned below it, so it
     * can never push the chips around. Success auto-dismisses; an error does not,
     * because a failure the user did not read is a failure they will hit again.
     *
     * @param props - `{ outcome, onDismiss, onAction, onDetails, t }`.
     */
    function ChipNotice(props) {
      var t = props.t
      var outcome = props.outcome
      var failed = outcome.tone === 'error'
      var summary = outcome.summary
      // The full text is only worth a disclosure when it says MORE than the
      // summary already did — otherwise the toggle would expand to a repeat.
      var hasDetail = typeof outcome.detail === 'string' && outcome.detail.trim() !== '' &&
        outcome.detail.trim() !== summary

      return h('div', {
        className: 'dshgit-notice',
        'data-tone': outcome.tone,
        'data-notice': outcome.id,
        role: failed ? 'alert' : 'status',
        // Errors interrupt a screen reader immediately; successes wait their turn.
        'aria-live': failed ? 'assertive' : 'polite',
      }, [
        h('span', { key: 'i', className: 'dshgit-noticeicon', 'aria-hidden': 'true' },
          failed ? h(IconAlert, { size: 14 }) : h(IconCheck, { size: 14 })),
        h('div', { key: 'body', className: 'dshgit-noticebody' }, [
          h('div', { key: 'text', className: 'dshgit-noticetext', title: outcome.detail || summary }, summary),
          hasDetail && props.detailsOpen === true
            ? h('pre', { key: 'detail', className: 'dshgit-noticedetail' }, outcome.detail)
            : null,
        ]),
        hasDetail
          ? h('button', {
              key: 'details',
              type: 'button',
              className: 'dshgit-noticebtn',
              title: t('notice.details'),
              'aria-label': t('notice.details'),
              'aria-expanded': props.detailsOpen === true,
              onClick: props.onDetails,
            }, props.detailsOpen === true ? t('notice.hideDetails') : t('notice.details'))
          : null,
        // The fix, when the plugin knows it. This is the whole point of
        // classifying the failure: a dead end becomes one click.
        outcome.action === null || outcome.action === undefined
          ? null
          : h('button', {
              key: 'action',
              type: 'button',
              className: 'dshgit-noticebtn dshgit-noticebtn-primary',
              onClick: function () { props.onAction(outcome.action) },
            }, outcome.action.label),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'dshgit-noticeclose',
          title: t('action.close'),
          'aria-label': t('action.close'),
          onClick: props.onDismiss,
        }, h(IconClose, { size: 12 })),
      ])
    }

    /**
     * A small cache of highlight results, keyed by grammar + exact text.
     *
     * Tokenisation is the expensive part of rendering a code surface and it is
     * pure: the same text and grammar always produce the same tokens. Switching
     * between "文件内容" and "查看差异" unmounts one view and mounts the other,
     * so without a cache that lives OUTSIDE the components each toggle
     * re-tokenised from scratch — which is what made the toggle feel slow.
     *
     * An `undefined` result is deliberately NOT cached: it means the grammar is
     * still loading, and `useCodeHighlighter` re-renders once it arrives, at which
     * point the pass must run again. Caching that first `undefined` would pin the
     * view to plain text forever.
     *
     * Bounded, so a long session cannot retain every file it has ever shown.
     */
    var highlightCache = new Map()
    var HIGHLIGHT_CACHE_MAX = 24

    /**
     * Highlight `text`, reusing a cached result when there is one.
     *
     * @param highlight - the host tokenizer for the chosen grammar.
     * @param language - the grammar id, part of the cache key.
     * @param text - the exact text to tokenise.
     * @returns the tokens, or undefined when the grammar is not ready.
     */
    function highlightCached(highlight, language, text) {
      var key = String(language) + '\u0000' + text
      var cached = highlightCache.get(key)
      if (cached !== undefined) {
        // Refresh recency: Map preserves insertion order, so re-inserting makes
        // the first key the least recently used.
        highlightCache.delete(key)
        highlightCache.set(key, cached)
        return cached
      }
      var value = highlight(text)
      if (value !== undefined && value !== null) {
        if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
          highlightCache.delete(highlightCache.keys().next().value)
        }
        highlightCache.set(key, value)
      }
      return value
    }

    /** An inline monospace diff body for one file's hunks. */
    /**
     * Render a diff with syntax highlighting.
     *
     * A diff cannot be highlighted as one block. A hunk interleaves the old and
     * new file, and each side is its own contiguous program, so Shiki is handed
     * each side as a block and the tokens are handed back to that side's rows —
     * the same split DSH's own diff review uses. Highlighting the interleaved
     * lines as one text would mis-lex the moment a hunk boundary falls inside a
     * string or a comment.
     *
     * `path` selects the grammar; without it (or without the host highlighter)
     * this degrades to the plain text it used to render.
     */
    function DiffBody(props) {
      // Called before ANY early return: React identifies hooks by call order, so a
      // hook placed after the empty-diff branch would change the order between
      // renders and corrupt this component's state.
      var highlight = (codePrimitives !== null && typeof codePrimitives.useCodeHighlighter === 'function')
        ? codePrimitives.useCodeHighlighter(grammarForFile(props.path))
        : function () { return undefined }
      var hunks = props.hunks || []
      var language = grammarForFile(props.path)
      // Memoised because highlighting is the expensive part and these rows
      // re-render on hover and on the wrap toggle. `highlightCached` is what makes
      // toggling back to this diff cheap: the component is remounted by the
      // switch, so without a cache outside it every toggle re-tokenised the file.
      var sides = React.useMemo(function () {
        if (hunks.length === 0) return null
        var lines = 0
        for (var i = 0; i < hunks.length; i++) lines += hunks[i].lines.length
        // A very large diff stays plain text rather than blocking the render.
        if (lines > 5000) return null
        return hunks.map(function (hunk) {
          var oldText = [], newText = []
          for (var i = 0; i < hunk.lines.length; i++) {
            var line = hunk.lines[i], marker = line.charAt(0), body = line.slice(1)
            if (marker !== '+') oldText.push(body)
            if (marker !== '-') newText.push(body)
          }
          return {
            old: highlightCached(highlight, language, oldText.join('\n')),
            new: highlightCached(highlight, language, newText.join('\n')),
          }
        })
      }, [hunks, highlight, language])
      if (hunks.length === 0) {
        return h('div', { className: 'dshgit-empty' }, props.emptyText)
      }
      var rows = []
      var key = 0
      for (var hi = 0; hi < hunks.length; hi++) {
        var hunk = hunks[hi]
        var side = sides === null ? null : sides[hi]
        // Each side advances independently: a context line belongs to both, an
        // addition only to the new file, a deletion only to the old one.
        var oldIndex = 0
        var newIndex = 0
        rows.push(
          h('div', { key: 'h' + key++, className: 'dshgit-hunkhead' },
            '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'),
        )
        var oldLine = hunk.oldStart
        var newLine = hunk.newStart
        for (var li = 0; li < hunk.lines.length; li++) {
          var line = hunk.lines[li]
          var marker = line.charAt(0)
          var kind = marker === '+' ? 'add' : marker === '-' ? 'del' : 'ctx'
          var left = kind === 'add' ? '' : String(oldLine)
          var right = kind === 'del' ? '' : String(newLine)
          if (kind !== 'add') oldLine++
          if (kind !== 'del') newLine++
          var lineTokens
          if (side !== null) {
            if (kind === 'add') { lineTokens = side.new === undefined ? undefined : side.new[newIndex]; newIndex++ }
            else if (kind === 'del') { lineTokens = side.old === undefined ? undefined : side.old[oldIndex]; oldIndex++ }
            else { lineTokens = side.new === undefined ? undefined : side.new[newIndex]; oldIndex++; newIndex++ }
          }
          rows.push(
            h('div', { key: 'l' + key++, className: 'dshgit-diffrow', 'data-kind': kind }, [
              // Two fixed columns, not one right-aligned string. Padding a single
              // right-aligned string makes the OLD number drift right on a
              // deletion (the new column is blank, so the padding it would have
              // occupied moves the number over) — the old number then sits under
              // the new-number column instead of its own.
              h('span', { key: 'g', className: 'dshgit-diffgutter' }, [
                h('span', { key: 'o', className: 'dshgit-diffnum' }, left),
                h('span', { key: 'n', className: 'dshgit-diffnum' }, right),
              ]),
              h('span', { key: 'm', className: 'dshgit-diffmarker', 'aria-label': kind === 'add' ? 'added' : kind === 'del' ? 'removed' : undefined },
                kind === 'add' ? '+' : kind === 'del' ? '-' : ''),
              h('span', { key: 't', className: 'dshgit-codetext' }, renderTokens(lineTokens, line.slice(1))),
            ]),
          )
        }
      }
      // `data-wrap` is what the word-wrap CSS keys off; the viewer sets it.
      return h('div', { className: 'dshgit-code', 'data-wrap': props.wrap === true ? 'true' : 'false' }, rows)
    }

    /**
     * Map a file path to a Shiki grammar id.
     *
     * Delegated to DSH's `languageForPath`, which owns the one extension →
     * grammar table the whole app shares. Returns undefined for an unknown
     * suffix, which is the signal to render plain text.
     *
     * @param path - the file path.
     * @returns a grammar id, or undefined.
     */
    function grammarForFile(path) {
      if (codePrimitives === null || typeof codePrimitives.languageForPath !== 'function') return undefined
      try {
        return codePrimitives.languageForPath(path)
      } catch (error) {
        return undefined
      }
    }

    /**
     * Render one highlighted line's tokens.
     *
     * Shiki hands back `{ text, style }` per token with the colour already
     * resolved from the theme's CSS variables, so this only has to turn them
     * into spans — no palette of our own, and light/dark follow the app.
     *
     * @param tokens - one line's tokens, or undefined for plain text.
     * @param fallback - the raw line, used when there is nothing to highlight.
     * @returns a React child.
     */
    function renderTokens(tokens, fallback) {
      if (tokens === undefined || tokens === null) return fallback
      if (tokens.length === 0) return fallback
      return tokens.map(function (token, index) {
        // An empty token contributes nothing but a key; skip it so the DOM is
        // not padded with empty spans on every line.
        if (token.text === '') return null
        return h('span', { key: index, style: token.style }, token.text)
      })
    }

    /** Show the actual working-tree file with line numbers. */
    function FilePreview(props) {
      var blob = props.blob
      var t = props.t
      // The highlighter hook must be called on EVERY render, before any early
      // return: React identifies hooks by call order, so calling it after the
      // loading/binary/truncated branches would change the order between
      // renders and corrupt the component's state.
      //
      // `codePrimitives` is a module constant, so the chosen hook identity is
      // stable for the life of the component — the branch cannot flip.
      var highlight = (codePrimitives !== null && typeof codePrimitives.useCodeHighlighter === 'function')
        ? codePrimitives.useCodeHighlighter(grammarForFile(props.path))
        : function () { return undefined }

      var page = React.useState({ blob: blob, limit: 2000 })
      var limit = page[0].blob === blob ? page[0].limit : 2000
      var prepared = React.useMemo(function () {
        var text = String(blob?.text || '').replace(/\n$/, '')
        var lines = text.split(/\r?\n/)
        return { text: text, lines: lines }
      }, [blob])
      // Highlight only the lines actually on screen. The preview already pages at
      // 2000 lines, and Shiki's cost scales with the text it is handed, so
      // bounding the pass to the rendered slice is what keeps a large file
      // highlighted. A whole-file size cap did the opposite: `lib/client.js` is
      // ~430KB, so it silently fell back to plain text — the user was looking
      // straight at a file that simply refused to highlight.
      //
      // The remaining ceiling guards a pathological single-line blob, not ordinary
      // source, so it is measured against the slice rather than the file.
      var visible = React.useMemo(function () {
        return prepared.lines.slice(0, limit).join('\n')
      }, [prepared, limit])
      var language = grammarForFile(props.path)
      // Cached: toggling to the diff and back must not re-tokenise the file.
      var highlighted = React.useMemo(function () {
        return visible.length <= 200000 ? highlightCached(highlight, language, visible) : undefined
      }, [visible, highlight, language])
      if (blob === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))
      if (blob.exists !== true) return h('div', { className: 'dshgit-empty' }, t('state.fileMissing'))
      if (blob.binary === true) return h('div', { className: 'dshgit-empty' }, t('state.fileBinary'))
      if (blob.truncated === true) return h('div', { className: 'dshgit-empty' }, t('state.fileTooLarge'))
      var lines = prepared.lines
      // `data-wrap` is what the word-wrap CSS keys off; the viewer sets it.
      return h('div', {
        className: 'dshgit-code',
        'data-file-preview': 'true',
        'data-wrap': props.wrap === true ? 'true' : 'false',
      }, lines.slice(0, limit).map(function (line, index) {
        // Shiki's own line array: a trailing empty line is dropped so the
        // gutter matches the tokens rather than running one row long.
        var tokens = highlighted === undefined || highlighted === null ? undefined : highlighted[index]
        return h('div', { key: index, className: 'dshgit-coderow' }, [
          h('span', { key: 'n', className: 'dshgit-gutter' }, String(index + 1)),
          h('span', { key: 't', className: 'dshgit-codetext' }, renderTokens(tokens, line === '' ? ' ' : line)),
        ])
      }).concat(lines.length > limit ? [
        h('div', { key: 'more', className: 'dshgit-preview-more' }, [
          h('span', { key: 'count' }, t('state.previewLines', { shown: limit, total: lines.length })),
          h('button', { key: 'button', type: 'button', className: 'dshgit-btn', onClick: function () { page[1]({ blob: blob, limit: limit + 2000 }) } }, t('action.moreCode')),
        ]),
      ] : []))
    }

    /* ------------------------------------------------------------------ *
     * The panel
     * ------------------------------------------------------------------ */

    /** Tabs this panel offers. */
    var TABS = ['changes', 'stashes', 'history', 'graph', 'compare', 'output', 'settings']

    /**
     * The workbench's modules, in activity-bar order.
     *
     * This replaced a flat list of tab names. Each module now owns three facts
     * the old tab row could not express: the icon that identifies it in the
     * activity bar, the label its sidebar header shows, and — via
     * {@link moduleHasSidebar} — whether it even has a sidebar, which is what
     * keeps a module with nothing to list from rendering an empty column.
     */
    var MODULES = [
      { id: 'changes', icon: IconChanges, labelKey: 'tab.changes', sidebarKey: 'sidebar.changes' },
      { id: 'stashes', icon: IconStash, labelKey: 'tab.stashes', sidebarKey: 'sidebar.stashes' },
      { id: 'history', icon: IconHistory, labelKey: 'tab.history', sidebarKey: 'sidebar.history' },
      { id: 'graph', icon: IconGraph, labelKey: 'tab.graph', sidebarKey: 'sidebar.graph' },
      { id: 'output', icon: IconOutput, labelKey: 'tab.output', sidebarKey: 'sidebar.output' },
      { id: 'settings', icon: IconSettings, labelKey: 'tab.settings', sidebarKey: 'sidebar.settings' },
    ]

    /** Look up one module's definition by id. */
    function moduleById(id) {
      if (id === 'compare') return { id: 'compare', labelKey: 'tab.compare', sidebarKey: 'label.files' }
      for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]
      return MODULES[0]
    }

    /**
     * The activity bar: the workbench's only module switcher.
     *
     * Modelled on VS Code's, so the muscle memory transfers. An icon column is
     * used instead of a text tab row for one reason that matters here: the old
     * row shared a line with Fetch/Pull/Push and six dropdown menus, so at any
     * narrow width it wrapped and the whole top bar lost its structure. A fixed
     * 48px column cannot be squeezed by the controls next to it.
     *
     * The active item is marked by a left accent bar AND `aria-pressed`, so the
     * visual state and the state assistive technology reads are the same value
     * and cannot disagree.
     *
     * @param props - `{ t, active, changes, onSelect }`.
     */
    function ActivityBar(props) {
      var t = props.t
      return h('nav', {
        className: 'dshgit-activitybar',
        role: 'tablist',
        'aria-label': t('panel.title'),
      }, MODULES.map(function (module) {
        var Icon = module.icon
        var active = props.active === module.id
        // Only "changes" carries a count: it is the one module whose contents the
        // user is expected to act on. A badge on History or Settings would be noise.
        var badge = module.id === 'changes' && props.changes > 0 ? props.changes : null
        return h('button', {
          key: module.id,
          type: 'button',
          className: 'dshgit-activity-item',
          role: 'tab',
          'aria-selected': active,
          'aria-pressed': active,
          'data-module': module.id,
          title: t(module.labelKey),
          'aria-label': t(module.labelKey),
          onClick: function () { props.onSelect(module.id) },
        }, [
          h(Icon, { key: 'i', size: 18 }),
          badge === null ? null : h('span', {
            key: 'b', className: 'dshgit-activity-badge', 'aria-hidden': 'true',
          }, String(badge)),
        ])
      }))
    }

    /**
     * The status bar: repository facts that are always true and never actionable.
     *
     * Branch, divergence, commit count, last fetch and the configured user used
     * to sit in the title bar, where they competed with the sync buttons for one
     * row and wrapped first. Moved to the bottom they cost nothing, stay
     * permanently readable, and leave the title bar to identity and actions —
     * the same split VS Code makes.
     *
     * `aria-live="polite"` because these values change after a fetch or a commit,
     * and a screen-reader user gets no other signal that they did.
     *
     * @param props - `{ t, status, repoMeta, tracking, busy, gitVersion }`.
     */
    function StatusBar(props) {
      var t = props.t
      var branch = props.status !== null && props.status.branch !== null ? props.status.branch : null
      var parts = []
      if (branch !== null) {
        parts.push(h('span', { key: 'b', className: 'dshgit-statusitem' }, [
          h(IconBranch, { key: 'i', size: 12 }),
          h('span', { key: 'n', className: 'dshgit-statusbranch' }, branch.head || '?'),
        ]))
        if (branch.ahead > 0 || branch.behind > 0) {
          parts.push(h('span', { key: 'ab', className: 'dshgit-statusitem' },
            '↑' + (branch.ahead || 0) + ' ↓' + (branch.behind || 0)))
        }
      }
      if (props.repoMeta !== null && props.repoMeta !== undefined) {
        if (props.repoMeta.commitCount !== null) {
          parts.push(h('span', { key: 'c' }, t('meta.commits', { count: props.repoMeta.commitCount })))
        }
        parts.push(h('span', { key: 'f' }, props.repoMeta.lastFetchedAt === null
          ? t('meta.neverFetched')
          : t('meta.lastFetched', { time: formatRelative(Math.floor(props.repoMeta.lastFetchedAt / 1000)) })))
        if (props.repoMeta.userName !== null) {
          parts.push(h('span', { key: 'u' }, props.repoMeta.userName))
        }
      }
      parts.push(h('span', { key: 'spacer', className: 'dshgit-spacer' }))
      if (props.busy === true) parts.push(h('span', { key: 'busy', className: 'dshgit-spinner' }))
      if (props.gitVersion !== null && props.gitVersion !== undefined) {
        parts.push(h('span', { key: 'v' }, props.gitVersion))
      }
      return h('div', {
        className: 'dshgit-statusbar', role: 'status', 'aria-live': 'polite',
      }, parts)
    }

    /**
     * A tiny shared store for the floating window's presentation.
     *
     * The window is opened from `sidebar.footer.action` but rendered in
     * `shell.overlay` — two different slots, so they cannot share React state.
     * A module-level store with subscriptions bridges them without either half
     * needing to reach into the other's tree.
     */
    var windowState = {
      mode: 'closed',
      tab: 'changes',
      historyPath: '',
      /** `{ ref }` handed to the Compare tab when a "compare with" action asks. */
      compareWith: '',
      /**
       * The session the window was opened from.
       *
       * The launcher lives in a session-scoped slot and knows its `sessionId`,
       * but the window renders in the frame-wide `shell.overlay` slot, which is
       * root-scoped and receives no session binding at all. This store is the
       * bridge: the panel sends the id with every repository call, so the Host
       * opens the repository of the conversation the user is actually looking at
       * instead of guessing from the workspace registry's first entry.
       */
      sessionId: '',
      /**
       * The repository root the header chips resolved.
       *
       * The chips and the workbench window are separate components with no
       * shared ancestor, and the window's own title needs the repository name.
       * Like `sessionId`, the fact travels through this store.
       */
      workspace: '',
      /** Incremented after a commit so the header and workbench reload together. */
      refreshToken: 0,
      /**
       * Explicit size for the workbench window, or `null` while its default
       * applies. The window is a centred dialog, so this is size only — there is
       * no position to remember.
       */
      size: null,
      /** Plugin window position; null uses the centered default. */
      position: null,
      /** Where the resize started, captured on pointer-down. */
      resize: null,
      /** Whether the minimized pill is showing instead of the window. */
      minimized: false,
      /** Plugin-only expansion; the normal size is retained for restoration. */
      maximized: false,
      listeners: new Set(),
    }

    /**
     * Update the window state and notify subscribers.
     * @param patch - partial state.
     */
    function setWindowState(patch) {
      windowState = Object.assign({}, windowState, patch)
      for (const listener of [...windowState.listeners]) listener()
    }

    /**
     * Subscribe to window-state changes.
     * @param listener - called on every change.
     * @returns an unsubscribe function.
     */
    function subscribeWindow(listener) {
      windowState.listeners.add(listener)
      return function () { windowState.listeners.delete(listener) }
    }

    /** Read the current window state. */
    function getWindowState() {
      return windowState
    }

    /** Close portalled dropdowns when their owning workbench is hidden. */
    function useCloseOnWindowHide(ref, setOpen) {
      React.useEffect(function () {
        return subscribeWindow(function () {
          var state = getWindowState()
          if ((state.mode === 'closed' || state.minimized) && ref.current?.closest?.('.dshgit-workbench')) setOpen(false)
        })
      }, [setOpen])
    }

    // Share the setting between the workbench and header commit forms.
    var pluginConfig = null
    var pluginConfigRead = null
    var pluginConfigListeners = new Set()
    function publishPluginConfig(config) {
      pluginConfig = config
      pluginConfigListeners.forEach(function (listener) { listener(config) })
    }
    function usePluginConfig(run) {
      var state = React.useState(pluginConfig)
      React.useEffect(function () {
        var active = true
        pluginConfigListeners.add(state[1])
        if (pluginConfig !== null) state[1](pluginConfig)
        else {
          if (!pluginConfigRead) pluginConfigRead = run('config', {}, { silent: true, silentError: true })
            .then(function (config) { publishPluginConfig(config); return config })
            .finally(function () { pluginConfigRead = null })
          pluginConfigRead.then(function (config) { if (active) state[1](config) }).catch(function () {})
        }
        return function () { active = false; pluginConfigListeners.delete(state[1]) }
      }, [run])
      return state[0]
    }

    /**
     * Render the Git workbench.
     *
     * @param props - slot props (`connection` is injected by the registration).
     * @returns the panel element tree.
     */
    function GitApp(props) {
      var connection = props.connection
      var t = props.t

      var tabState = React.useState(props.focusTab === undefined ? 'changes' : props.focusTab)
      var tab = tabState[0]
      var setTab = tabState[1]
      var historyPathState = React.useState(props.focusPath || '')
      var historyPath = historyPathState[0]
      var setHistoryPath = historyPathState[1]
      var contextState = React.useState(null)
      var contextMenu = contextState[0]
      var setContextMenu = contextState[1]

      // The settings module's sub-navigation, lifted here so the sidebar (which
      // renders the nav) and the editor (which renders the section) share it.
      var settingsSectionState = React.useState('general')
      var settingsSection = settingsSectionState[0]
      var setSettingsSection = settingsSectionState[1]

      // The output module's command log is fetched once by GitApp rather than by
      // the view, because the sidebar shows the count and the editor shows the
      // rows — two components that would otherwise fetch the same list twice.
      var outputEntriesState = React.useState(null)
      var outputEntries = outputEntriesState[0]
      var setOutputEntries = outputEntriesState[1]
      var outputFilterState = React.useState('all')
      var outputFilter = outputFilterState[0]
      var setOutputFilter = outputFilterState[1]

      // The window can hand the panel a tab to focus (e.g. "show me the full
      // history") and a ref to preload into Compare.
      React.useEffect(
        function () {
          if (props.focusTab !== undefined && props.focusTab !== '') setTab(props.focusTab)
        },
        [props.focusTab],
      )
      React.useEffect(function () {
        if (props.focusPath) setHistoryPath(props.focusPath)
      }, [props.focusPath])

      var repoState = React.useState(null)
      var repo = repoState[0]
      var setRepo = repoState[1]
      var workbenchContextRef = React.useRef(null)
      workbenchContextRef.current = String(props.sessionId || '') + ':' + (repo?.root || '')
      var discoveryState = React.useState(true)
      var discovering = discoveryState[0]
      var setDiscovering = discoveryState[1]

      var reposState = React.useState([])
      var knownRepos = reposState[0]
      var setKnownRepos = reposState[1]

      var initState = React.useState(false)
      var canInitialize = initState[0]
      var setCanInitialize = initState[1]
      var directoryState = React.useState(null)
      var directory = directoryState[0]
      var setDirectory = directoryState[1]

      var gitPathState = React.useState(null)
      var gitPath = gitPathState[0]
      var setGitPath = gitPathState[1]

      // Whether git itself is missing, as opposed to "a repository read failed".
      // Conflating the two made a failed `git status` render the "git not found"
      // banner and hide the real message behind it.
      var gitMissingState = React.useState(false)
      var gitMissing = gitMissingState[0]
      var setGitMissing = gitMissingState[1]

      var statusState = React.useState(null)
      var status = statusState[0]
      var setStatus = statusState[1]

      var refsState = React.useState(null)
      var refs = refsState[0]
      var setRefs = refsState[1]

      var stashesState = React.useState(null)
      var stashes = stashesState[0]
      var setStashes = stashesState[1]
      var stashErrorState = React.useState(null)
      var stashError = stashErrorState[0]
      var setStashError = stashErrorState[1]
      var selectedStashState = React.useState(null)
      var selectedStashId = selectedStashState[0]
      var setSelectedStashId = selectedStashState[1]
      var stashRepoRef = React.useRef(null)
      var stashActionState = React.useState(null)
      var stashAction = stashActionState[0]
      var setStashAction = stashActionState[1]

      var worktreesState = React.useState([])
      var worktrees = worktreesState[0]
      var setWorktrees = worktreesState[1]

      // Configured remotes, which exist independently of fetched branches.
      var remotesState = React.useState([])
      var remoteList = remotesState[0]
      var setRemotes = remotesState[1]

      var contributorsState = React.useState([])
      var contributors = contributorsState[0]
      var setContributors = contributorsState[1]

      var trackingState = React.useState(null)
      var tracking = trackingState[0]
      var setTracking = trackingState[1]

      var metaState = React.useState(null)
      var repoMeta = metaState[0]
      var setRepoMeta = metaState[1]

      // Ref a "Compare with …" action asked the Compare tab to preload.
      var compareWithState = React.useState(props.compareWith || 'HEAD')
      var compareWith = compareWithState[0]
      var setCompareWith = compareWithState[1]
      var compareToState = React.useState('HEAD'), compareTo = compareToState[0]
      var compareRetry = React.useState(0), compareData = React.useState(null), compareError = React.useState(null)
      var compareHistory = React.useState(null), comparePath = React.useState(null)
      var compareReturn = React.useRef('graph')
      var openComparison = function (ref) {
        if (tab !== 'compare') compareReturn.current = tab
        setCompareWith(ref); compareToState[1]('HEAD'); setTab('compare')
      }
      React.useEffect(function () {
        if (tab !== 'compare' || !repo || !compareWith) return
        var active = true
        var comparisonKey = JSON.stringify([repo.root, compareWith, compareTo, compareRetry[0]])
        compareData[1](null); compareError[1](null); compareHistory[1](null); comparePath[1](null)
        run('compareFiles', { root: repo.root, from: compareWith, to: compareTo }, { silentError: true })
          .then(function (value) {
            if (!active) return
            compareData[1](Object.assign({}, value, { requestKey: comparisonKey })); comparePath[1](value.files?.[0]?.path || null)
            run('compareCommits', { root: repo.root, left: value.from, right: value.to }, { silentError: true })
              .then(function (history) { if (active) compareHistory[1](history) })
              .catch(function (failure) { if (active) compareHistory[1]({ error: failure.message }) })
          }).catch(function (failure) { if (active) compareError[1](failure.message) })
        return function () { active = false }
      }, [tab, repo?.root, compareWith, compareTo, compareRetry[0]])

      var commitsState = React.useState([])
      var commits = commitsState[0]
      var setCommits = commitsState[1]
      var historyRefState = React.useState('HEAD')
      var historyRef = historyRefState[0]
      var setHistoryRef = historyRefState[1]
      var historyLimitState = React.useState(60)
      var historyLimit = historyLimitState[0]
      var setHistoryLimit = historyLimitState[1]
      var historyLoadingState = React.useState(false), historyErrorState = React.useState(null), historyRetryState = React.useState(0)

      var graphState = React.useState(null)
      var graph = graphState[0]
      var setGraph = graphState[1]
      var graphConfigState = React.useState({ scope: 'all', selected: '', showRemote: true, ordering: 'date', limit: 200, refresh: 0 })
      var graphConfig = graphConfigState[0], setGraphConfig = graphConfigState[1]
      var graphLoadingState = React.useState(false), graphErrorState = React.useState(null)
      var workbenchRequestState = React.useState(null), workbenchRequest = workbenchRequestState[0]
      var branchSyncState = React.useState(null)
      var recoveryState = React.useState([]), reflogOpenState = React.useState(false)

      var selectionState = React.useState(null)
      var selection = selectionState[0]
      var setSelection = selectionState[1]

      var diffState = React.useState(null)
      var diff = diffState[0]
      var setDiff = diffState[1]

      var commitState = React.useState(null)
      var commitDetail = commitState[0]
      var setCommitDetail = commitState[1]

      var fileState = React.useState(null)
      var fileView = fileState[0]
      var setFileView = fileState[1]
      var fileDisplayState = React.useState('diff')
      var fileDisplay = fileDisplayState[0]
      var setFileDisplay = fileDisplayState[1]
      var fileRequestRef = React.useRef(0)
      var revisionSideState = React.useState('after')
      var revisionSide = revisionSideState[0]
      var setRevisionSide = revisionSideState[1]
      var treeRefreshState = React.useState(0)
      var treeRefresh = treeRefreshState[0]
      var setTreeRefresh = treeRefreshState[1]

      var blameState = React.useState(null)
      var blameData = blameState[0]
      var setBlameData = blameState[1]

      var busyState = React.useState(0)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var pendingWriteRef = React.useRef(false)
      var writeMethodState = React.useState(null)
      var writeMethod = writeMethodState[0]
      var setWriteMethod = writeMethodState[1]

      var errorState = React.useState(null)
      var error = errorState[0]
      var setError = errorState[1]

      var toastState = React.useState(null)
      var toast = toastState[0]
      var setToast = toastState[1]

      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]

      var confirmState = React.useState(null)
      var confirmRequest = confirmState[0]
      var setConfirmRequest = confirmState[1]

      // A small text/form dialog: clone, new branch, new tag, add remote. Inline
      // rather than window.prompt because several of these need more than one
      // field, and a native prompt cannot be styled or validated.
      var promptState = React.useState(null)
      var promptRequest = promptState[0]
      var setPromptRequest = promptState[1]
      var remoteRequest = React.useState(null)
      React.useEffect(function () { remoteRequest[1](null) }, [repo?.root])

      var messageState = React.useState('')
      var commitMessage = messageState[0]
      var setCommitMessage = messageState[1]

      var aiState = React.useState(null)
      var aiNotice = aiState[0]
      var setAiNotice = aiState[1]

      var versionRef = React.useRef(0)

      /** Run an RPC call with busy tracking and uniform error surfacing. */
      var run = React.useCallback(
        function (method, payload, options) {
          var opts = options || {}
          versionRef.current += 1
          var token = versionRef.current
          if (opts.silent !== true) setBusy(function (n) { return n + 1 })
          // Like the chips, the panel states the session it is rendering rather
          // than reading it back from the store: the store is what this
          // component is rendered FROM, so trusting it is circular during the
          // render that follows a conversation switch.
          return callRpc(connection, method, withExplicitSession(payload, props.sessionId), undefined)
            .then(function (value) {
              if (opts.silent !== true) setBusy(function (n) { return Math.max(0, n - 1) })
              return value
            })
            .catch(function (failure) {
              if (opts.silent !== true) setBusy(function (n) { return Math.max(0, n - 1) })
              if (opts.silentError !== true) {
                setError(t('error.load', { message: failure.message }))
              }
              throw failure
            })
        },
        [connection, t, props.sessionId],
      )

      var changelistModel = useChangelists(repo, status, run)
      if (changelistModel.mode === 'lists') {
        commitMessage = changelistModel.message
        setCommitMessage = changelistModel.setMessage
      }

      /** Refresh repository discovery plus everything derived from the repo. */
      var refresh = React.useCallback(
        function (options) {
          var opts = options || {}
          // `session: true` means "resolve from the session again", i.e. do not
          // name the repository we already had. Without it, switching
          // conversations would keep re-requesting the previous session's root.
          var payload = repo === null || opts.session === true ? {} : { path: repo.root }
          return run('repos', payload, { silentError: true })
            .then(function (result) {
              if (result.config) publishPluginConfig(result.config)
              setGitPath(result.gitPath || null)
              setGitMissing(false)
              setKnownRepos(result.repos || [])
              setCanInitialize(result.canInitialize === true)
              setDirectory(result.directory || null)
              var next = null
              if (repo !== null) {
                for (var i = 0; i < (result.repos || []).length; i++) {
                  if (result.repos[i].root === repo.root) next = result.repos[i]
                }
              }
              if (next === null && (result.repos || []).length > 0) next = result.repos[0]
              setRepo(next)
              // The title bar lives on GitWindow, a different component with no
              // shared ancestor, so the resolved repository travels through the
              // window store — the same bridge that carries `sessionId` the
              // other way. Published here, where discovery answers, so every
              // mode and every re-resolve keeps it current.
              setWindowState({ workspace: next !== null ? next.root : (result.directory || '') })
              setDiscovering(false)
              if (next === null) return null
              return loadRepo(next, opts)
            })
            .catch(function (failure) {
              // `repos` failing means the Host could not resolve git at all;
              // that is a state with its own screen, not an error banner.
              setGitPath(null)
              setGitMissing(true)
              setKnownRepos([])
              setCanInitialize(false)
              setDirectory(null)
              setRepo(null)
              setDiscovering(false)
              setError(failure.message)
              return null
            })
        },
        [run, repo],
      )
      var lastRefreshToken = React.useRef(props.refreshToken)
      React.useEffect(function () {
        if (props.active === false) return
        if (props.refreshToken === lastRefreshToken.current) return
        lastRefreshToken.current = props.refreshToken
        hiddenSinceRef.current = null
        if (repo === null) refresh({ force: true })
        else {
          // A completed operation reloads the opened repository, not the
          // conversation directory, which may not be a Git repository.
          loadRepo(repo, { force: true })
          setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
          historyRetryState[1](function (value) { return value + 1 })
        }
      }, [props.refreshToken, props.active])

      /** Load status, refs, stashes and worktrees for one repository. */
      var loadRepo = React.useCallback(
        function (target, options) {
          var opts = options || {}
          var root = target.root
          var storedRecovery = readWorkbenchStorage('recovery:' + root, null)
          if (Array.isArray(storedRecovery)) recoveryState[1](storedRecovery)
          if (stashRepoRef.current !== root) {
            pendingWriteRef.current = false; setWriteMethod(null)
            setToast(null); setContextMenu(null)
            workbenchRequestState[1](null); branchSyncState[1](null); reflogOpenState[1](false); setGraph(null)
            setGraphConfig({ scope: 'all', selected: '', showRemote: true, ordering: 'date', limit: 200, refresh: 0 })
            recoveryState[1](readWorkbenchStorage('recovery:' + root, []))
            fileRequestRef.current++; setSelection(null); setCommitDetail(null); setDiff(null); setCommits([])
            stashRepoRef.current = root; setStashes(null); setStashError(null); setSelectedStashId(null)
          }
          // A failed status is reported and then swallowed: it must not reject
          // the `repos` promise chain, or a broken repository would render as
          // "git is not installed" — the wrong screen entirely.
          var statusStep = run('status', { root: root, force: opts.force === true }, { silent: opts.background === true })
            .then(function (value) {
              if (stashRepoRef.current !== root) return null
              setStatus(value)
              return Promise.all([
                run('refs', { root: root, force: opts.force === true }, { silent: true, silentError: true }).catch(function () { return null }),
                run('stashes', { root: root }, { silent: true, silentError: true }).then(function (value) {
                  if (stashRepoRef.current === root) setStashError(null); return value
                }).catch(function (failure) { if (stashRepoRef.current === root) setStashError(failure.message); return null }),
                run('worktrees', { root: root }, { silent: true, silentError: true }).catch(function () { return [] }),
                run('remotes', { root: root }, { silent: true, silentError: true }).catch(function (failure) {
                  setError(failure.code === 'git/unknown-method'
                    ? t('error.hostOutdated')
                    : t('error.remoteLoad', { message: failure.message }))
                  return []
                }),
              ])
            })
            .then(function (loaded) {
              if (!loaded || stashRepoRef.current !== root) return
              setRefs(loaded[0])
              if (stashRepoRef.current === root) setStashes(loaded[1])
              setWorktrees(loaded[2] || [])
              setRemotes(loaded[3] || [])
              // These three are informational: a failure degrades the header,
              // never the panel.
              run('branchTracking', { root: root }, { silent: true, silentError: true })
                .then(function (value) { if (stashRepoRef.current === root) setTracking(value) }).catch(function () { if (stashRepoRef.current === root) setTracking(null) })
              if (opts.lightweight === true) return
              run('repoMeta', { root: root }, { silent: true, silentError: true })
                .then(function (value) { if (stashRepoRef.current === root) setRepoMeta(value) }).catch(function () { if (stashRepoRef.current === root) setRepoMeta(null) })
              run('contributors', { root: root, limit: 50 }, { silent: true, silentError: true })
                .then(function (value) { if (stashRepoRef.current === root) setContributors(value) }).catch(function () { if (stashRepoRef.current === root) setContributors([]) })
            })
            .catch(function (failure) {
              if (stashRepoRef.current !== root) return
              setError(t('error.load', { message: failure.message }))
            })
          return statusStep
        },
        [run, t],
      )

      // Resume from retained UI immediately; only older data needs a background read.
      var hiddenSinceRef = React.useRef(null)
      React.useEffect(function () {
        if (props.active === false) {
          hiddenSinceRef.current = Date.now()
          setContextMenu(null)
          return
        }
        var hiddenSince = hiddenSinceRef.current
        hiddenSinceRef.current = null
        if (hiddenSince === null || Date.now() - hiddenSince < 15000) return
        if (repo === null) refresh({ force: true })
        else {
          loadRepo(repo, { force: true, background: true, lightweight: true })
          historyRetryState[1](function (value) { return value + 1 })
        }
      }, [props.active])

      // First load.
      React.useEffect(
        function () {
          refresh({ force: true })
        },
        [],
      )

      // Follow the session the window is showing.
      //
      // Switching conversations does not remount this component — the overlay
      // renders one persistent window — so without this the panel would keep
      // displaying the previous session's repository, which is worse than
      // opening the wrong one: the header would say one thing and the file list
      // another. The repository is dropped first so discovery re-resolves from
      // the session (no `root`) rather than from the stale one.
      var lastSessionRef = React.useRef(props.sessionId)
      React.useEffect(
        function () {
          if (props.sessionId === undefined) return
          if (lastSessionRef.current === props.sessionId) return
          lastSessionRef.current = props.sessionId
          setRepo(null)
          setStatus(null)
          setSelection(null)
          setDiff(null)
          setError(null)
          refresh({ force: true, session: true })
        },
        [props.sessionId],
      )

      /** Load commit history for the current search box. */
      React.useEffect(
        function () {
          if (repo === null) return
          if (tab !== 'history' && tab !== 'compare') return
          var active = true
          historyLoadingState[1](true); historyErrorState[1](null)
          var payload = { root: repo.root, limit: historyLimit, ref: historyRef }
          if (query.trim() !== '') payload.grep = query.trim()
          if (historyPath !== '') payload.path = historyPath
          run('commits', payload, { silentError: true })
            .then(function (value) { if (active) setCommits(value.commits || []) })
            .catch(function (failure) { if (active) { setCommits([]); historyErrorState[1](failure.message) } })
            .finally(function () { if (active) historyLoadingState[1](false) })
          return function () { active = false }
        },
        [tab, repo, query, historyPath, historyRef, historyLimit, historyRetryState[0]],
      )

      /** Load the commit graph when its tab is visible. */
      React.useEffect(
        function () {
          if (repo === null || tab !== 'graph') return
          var active = true, target = graphConfig.scope === 'current' ? 'HEAD' : graphConfig.selected
          graphLoadingState[1](true); graphErrorState[1](null)
          run('commitGraph', { root: repo.root, limit: graphConfig.limit, all: graphConfig.scope === 'all',
            refs: graphConfig.scope !== 'all' && target ? [target] : undefined,
            showRemote: graphConfig.showRemote, ordering: graphConfig.ordering }, { silentError: true })
            .then(function (value) {
              if (!active) return
              setGraph(value)
              if (graphConfig.scope === 'selected' && (value.rows || []).length) setSelection(function (previous) {
                return previous?.kind === 'commit' && value.rows.some(function (row) { return row.sha === previous.sha }) ? previous : { kind: 'commit', sha: value.rows[0].sha }
              })
            }).catch(function (failure) { if (active) graphErrorState[1](failure.message) })
            .finally(function () { if (active) graphLoadingState[1](false) })
          return function () { active = false }
        },
        [tab, repo, graphConfig, refs],
      )

      /**
       * Load the command log for the output module.
       *
       * Fetched here rather than in the view because the sidebar and the editor
       * both read it — the sidebar counts the entries, the editor lists them —
       * and two components fetching the same list would double every request.
       */
      var loadOutput = React.useCallback(
        function () {
          return run('gitOutput', { limit: 200 }, { silentError: true })
            .then(function (value) { setOutputEntries(value.entries || []) })
            .catch(function () { setOutputEntries([]) })
        },
        [run],
      )
      React.useEffect(
        function () {
          if (tab !== 'output' || outputEntries !== null) return
          loadOutput()
        },
        [tab, outputEntries, loadOutput],
      )

      /** Empty the Host's command log and the local copy together. */
      var clearOutput = React.useCallback(
        function () {
          run('clearGitOutput', {}, { silentError: true })
            .then(function () { setOutputEntries([]) })
            .catch(function () {})
        },
        [run],
      )

      // Each group previews its own side of the index/worktree boundary.
      var openChangedFile = React.useCallback(
        function (file, display, section) {
          if (repo === null) return
          section = section || (isUnstaged(file) ? 'unstaged' : 'staged')
          setSelection({ kind: 'file', path: file.path, file: file, section: section,
            rev: display === 'head' ? 'HEAD' : null })
          setFileDisplay(display === 'head' || display === 'content' || file.kind === 'untracked' ? 'content' : 'diff')
          setCommitDetail(null)
          setFileView(null)
          setDiff(null)
          setBlameData(null)
          var requestId = ++fileRequestRef.current
          var payload = { root: repo.root, path: file.path, staged: section === 'staged' }
          run(section === 'working' ? 'changelistDiff' : 'diff', section === 'working' ? { root: repo.root, paths: [file.path] } : payload, { silentError: true })
            .then(function (value) { if (fileRequestRef.current === requestId) setDiff(value) })
            .catch(function () { if (fileRequestRef.current === requestId) setDiff({ text: '', files: [], hunks: [] }) })
          run('fileContent', { root: repo.root, path: file.path,
            rev: display === 'head' ? 'HEAD' : section === 'staged' ? 'INDEX' : undefined }, { silentError: true })
            .then(function (value) { if (fileRequestRef.current === requestId) setFileView(value) })
            .catch(function () { if (fileRequestRef.current === requestId) setFileView({ exists: false }) })
        },
        [repo, run],
      )

      // Preserve the selected file across staging, discarding and refreshes.
      React.useEffect(function () {
        if (repo === null || status === null || tab !== 'changes') return
        var files = status.files || []
        var current = selection && selection.kind === 'file' && files.find(function (file) { return file.path === selection.path })
        if (!current) {
          var next = files.find(isUnstaged) || files[0]
          if (next) openChangedFile(next, 'diff')
          else if (selection !== null) {
            fileRequestRef.current++
            setSelection(null); setDiff(null); setFileView(null); setBlameData(null)
          }
          return
        }
        var section = selection.section === 'working' && changelistModel.mode === 'lists' ? 'working'
          : selection.section === 'staged' && isStaged(current) ? 'staged'
          : selection.section === 'unstaged' && isUnstaged(current) ? 'unstaged'
          : isUnstaged(current) ? 'unstaged' : 'staged'
        if (current !== selection.file || section !== selection.section) {
          openChangedFile(current, selection.rev === 'HEAD' ? 'head' : fileDisplay, section)
        }
      }, [repo, status, selection, tab, fileDisplay, openChangedFile])

      /** Open a commit: metadata plus its full diff. */
      var openCommit = React.useCallback(
        function (sha) {
          if (repo === null || typeof sha !== 'string') return
          setSelection({ kind: 'commit', sha: sha })
          setDiff(null)
          setCommitDetail(null)
          var requestId = ++fileRequestRef.current
          if (tab === 'history' || tab === 'graph') return
          run('commit', { root: repo.root, sha: sha }, { silentError: true })
            .then(function (value) { if (fileRequestRef.current === requestId) setCommitDetail(value) })
            .catch(function () { if (fileRequestRef.current === requestId) setCommitDetail(null) })
          run('diff', { root: repo.root, commit: sha, from: sha + '^', to: sha }, { silentError: true })
            .then(function (value) { if (fileRequestRef.current === requestId) setDiff(value) })
            .catch(function () { if (fileRequestRef.current === requestId) setDiff({ text: '', files: [], hunks: [] }) })
        },
        [repo, run, tab],
      )

      var openRevisionFile = React.useCallback(function (sha, path, oldPath) {
        if (repo === null) return
        fileRequestRef.current++
        setSelection({ kind: 'revisionFile', sha: sha, path: path, oldPath: oldPath || path })
        setTab('history')
        setFileDisplay('diff')
        setRevisionSide('after')
        setFileView(null)
        setDiff(null)
      }, [repo])

      var viewRevisionSide = function (side) {
        if (repo === null || selection === null || selection.kind !== 'revisionFile') return
        var requestId = ++fileRequestRef.current
        setRevisionSide(side)
        setFileDisplay('content')
        setFileView(null)
        run('fileContent', {
          root: repo.root,
          path: side === 'before' ? selection.oldPath : selection.path,
          rev: selection.sha + (side === 'before' ? '^' : ''),
        }, { silentError: true })
          .then(function (value) { if (fileRequestRef.current === requestId) setFileView(value) })
          .catch(function () { if (fileRequestRef.current === requestId) setFileView({ exists: false }) })
      }

      var openStash = React.useCallback(function (stash) {
        setSelectedStashId(stash.sha || stash.ref)
        setTab('stashes')
      }, [])
      React.useEffect(function () {
        if (tab !== 'stashes' || stashes === null) return
        if (!stashes.some(function (stash) { return (stash.sha || stash.ref) === selectedStashId })) {
          setSelectedStashId(stashes.length > 0 ? stashes[0].sha || stashes[0].ref : null)
        }
      }, [tab, stashes, selectedStashId])

      var showRefHistory = function (refName) {
        fileRequestRef.current++
        setHistoryRef(refName || 'HEAD')
        setHistoryPath('')
        setHistoryLimit(60)
        setQuery('')
        setSelection(null)
        setCommitDetail(null); setDiff(null); setFileView(null)
        setTab('history')
      }

      /**
       * Clone into a directory, then discover the new repository.
       *
       * Lives here rather than in the sidebar because it changes WHICH
       * repositories exist — the same registry `refresh()` reads — and the
       * sidebar should not own registry mutations.
       */
      var cloneRepo = React.useCallback(
        function (payload) {
          run('clone', payload, { silentError: true })
            .then(function (value) {
              setToast({ seq: Date.now(), text: value.message || t('action.clone') })
              refresh({ force: true })
            })
            .catch(function (failure) {
              setError(t('error.action', { message: failure.message }))
            })
        },
        [run, refresh, t],
      )

      /** Perform a write, asking for confirmation when the Host requires it. */
      var performWrite = React.useCallback(
        function (method, payload, options) {
          var opts = options || {}
          var body = Object.assign({}, payload)
          if (repo !== null) body.root = repo.root
          if (pendingWriteRef.current) return Promise.resolve(null)
          if (method === 'push' && !body.remote && !body.tags && body.forceWithLease !== true && !status?.branch?.upstream) body.setUpstream = true
          if (method === 'push' && body.setUpstream === true && !body.remote) {
            if (remoteList.length === 0) { remoteRequest[1]({ id: Date.now(), push: true, branch: body.sourceBranch || body.branch || status?.branch?.head }); return Promise.resolve(null) }
            if (remoteList.length > 1) {
              setPromptRequest({ title: t('publish.remote'),
                fields: [{ key: 'remote', label: t('label.remote'), options: remoteList.map(function (remote) { return { value: remote.name, label: remote.name } }) }],
                submit: function (values) { performWrite(method, Object.assign({}, body, { remote: values.remote, branch: status?.branch?.head }), opts) },
              })
              return Promise.resolve(null)
            }
            body.remote = remoteList[0].name
            body.branch = status?.branch?.head
          }
          // Older Hosts also gate ordinary pushes; the Push click authorizes
          // this fast-forward-only operation. Forced pushes still ask first.
          if (method === 'push' && body.forceWithLease !== true) body.confirm = true
          var send = function (confirmed) {
            if (pendingWriteRef.current) return Promise.resolve(null)
            pendingWriteRef.current = true
            setWriteMethod(method)
            var finalBody = Object.assign({}, body)
            if (confirmed === true) finalBody.confirm = true
            return run('write.' + method, finalBody, { silentError: true })
              .then(function (value) {
                pendingWriteRef.current = false
                setWriteMethod(null)
                setToast({ seq: Date.now(), text: opts.successText || (method === 'stashPush' ? t('stash.created') : value.message || t('action.apply')),
                  action: method === 'stashPush' ? { label: t('stash.view'), run: function () { setTab('stashes') } } : undefined })
                if (opts.after !== undefined) opts.after()
                return value
              })
              .catch(function (failure) {
                pendingWriteRef.current = false
                setWriteMethod(null)
                if (failure.code === 'git/needs-confirmation') {
                  setConfirmRequest({
                    message: failure.message,
                    onConfirm: function () { send(true).catch(function () {}) },
                  })
                  return null
                }
                if (!opts.propagate) setError(t('error.action', { message: failure.message }))
                if (opts.onError) opts.onError(failure)
                if (opts.propagate) throw failure
                return null
              })
          }
          return send(opts.confirm === true)
        },
        [repo, run, t, remoteList, status],
      )

      /** Reload the repository after a mutation. */
      var afterWrite = React.useCallback(
        function () {
          if (repo === null) return
          setTreeRefresh(function (value) { return value + 1 })
          loadRepo(repo, { force: true })
          if (tab === 'graph') {
            setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
          }
          if (tab === 'history') {
            historyRetryState[1](function (value) { return value + 1 })
          }
        },
        [repo, loadRepo, run, tab, historyRef, historyLimit],
      )

      var createStash = function () {
        if (busy > 0 || status === null || (status.files || []).length === 0) return
        setPromptRequest({ title: t('stash.create'), fields: [
          { key: 'message', label: t('label.message'), placeholder: '' },
          { key: 'includeUntracked', type: 'checkbox', label: t('stash.includeUntracked'), initial: (status.files || []).every(function (file) { return file.kind === 'untracked' }) },
        ], submit: function (values) {
          if (!values.includeUntracked && (status.files || []).every(function (file) { return file.kind === 'untracked' })) {
            setError(t('stash.noEligible')); return
          }
          performWrite('stashPush', { message: values.message, includeUntracked: values.includeUntracked === true }, { after: afterWrite })
        } })
      }
      var executeApplyStash = function (stash, pop, restoreIndex) {
        if (pendingWriteRef.current) return
        setStashAction({ id: stash.sha || stash.ref, action: pop ? 'pop' : 'apply' })
        performWrite('stashApply', { ref: stash.ref, expectedSha: stash.sha, pop: pop, restoreIndex: restoreIndex }, {
          successText: changelistModel.data?.stashLists?.[stash.sha]?.kind === 'changelist' && restoreIndex !== false ? undefined : t(pop ? 'stash.popped' : 'stash.applied'), after: afterWrite,
          onError: function () {
            afterWrite()
            run('status', { root: repo.root, force: true }, { silent: true, silentError: true }).then(function (value) {
              if ((value.files || []).some(function (file) { return file.kind === 'unmerged' })) {
                setStatus(value); setSelection(null); setTab('changes')
              }
            }).catch(function () {})
          },
        }).finally(function () { setStashAction(null) })
      }
      var applyStash = function (stash, pop) {
        if (pendingWriteRef.current) return
        setConfirmRequest({ title: t(pop ? 'action.stashPop' : 'action.stashApply'),
          label: t(pop ? 'action.stashPop' : 'action.stashApply'), danger: false,
          message: t(pop ? 'stash.popConfirm' : 'stash.applyConfirm', { ref: stash.ref, message: stash.message || stash.ref }),
          option: { label: t('cl.restoreIndex'), checked: changelistModel.data?.stashLists?.[stash.sha]?.kind === 'changelist' },
          onConfirm: function (restoreIndex) { executeApplyStash(stash, pop, restoreIndex) },
        })
      }
      var dropStash = function (stash) {
        setConfirmRequest({ title: t('action.stashDrop'), label: t('action.stashDrop'), danger: true,
          message: t('stash.dropConfirm', { ref: stash.ref, message: stash.message || stash.ref }),
          onConfirm: function () {
            if (pendingWriteRef.current) return
            setStashAction({ id: stash.sha || stash.ref, action: 'drop' })
            performWrite('stashDrop', { ref: stash.ref, expectedSha: stash.sha },
              { confirm: true, successText: t('stash.deleted'), after: afterWrite, onError: afterWrite }).finally(function () { setStashAction(null) })
          },
        })
      }

      /* -------------------------- rendering -------------------------- */
      var openWorkbench = function (action, subject, extras) {
        if (pendingWriteRef.current) return
        if (action === 'push' && remoteList.length === 0) { remoteRequest[1]({ id: Date.now(), push: true, branch: subject?.name || status?.branch?.head }); return }
        var localBranch = /^refs\/heads\//.test(subject?.ref || ''), remoteBranch = /^refs\/remotes\//.test(subject?.ref || '')
        if (action === 'checkout' && localBranch) {
          if (subject.head || subject.ref === 'refs/heads/' + status?.branch?.head) return
          if (subject.occupied) { setError(t('wb.occupied')); return }
          var checkoutContext = workbenchContextRef.current
          var refreshCheckout = function () {
            if (workbenchContextRef.current !== checkoutContext) return
            afterWrite()
            var token = getWindowState().refreshToken + 1
            lastRefreshToken.current = token
            setWindowState({ refreshToken: token })
          }
          branchSyncState[1](subject.ref)
          performWrite('checkout', { ref: subject.ref, localBranch: true }, {
            confirm: true, successText: t('wb.checkout') + ' · ' + t('action.ok'), after: refreshCheckout,
            onError: function (failure) {
              if (workbenchContextRef.current !== checkoutContext) return
              if (/would be overwritten|commit your changes or stash/i.test(failure.message || '')) setError(t('wb.checkoutBlocked'))
              refreshCheckout()
            },
          }).finally(function () { if (workbenchContextRef.current === checkoutContext) branchSyncState[1](null) })
          return
        }
        if ((action === 'pull' && localBranch) || (action === 'fetch' && (localBranch || remoteBranch || extras?.remote))) {
          var parameters, successLabel
          if (localBranch) {
            var upstream = workbenchUpstream(subject)
            if (!/^refs\/remotes\//.test(upstream)) { setError(t('wb.pullNeedsUpstream')); return }
            parameters = { name: subject.ref.slice(11), upstream: upstream, ffOnly: action === 'pull' }
            successLabel = t(action === 'fetch' ? 'wb.fetchLocal' : 'wb.pull')
          } else {
            var configuredRemote = remoteList.filter(function (remote) { return subject?.ref?.startsWith('refs/remotes/' + remote.name + '/') }).sort(function (a, b) { return b.name.length - a.name.length })[0]
            var remoteName = subject?.remoteName || configuredRemote?.name || extras?.remote || (remoteBranch ? subject.ref.slice(13).split('/')[0] : '')
            parameters = { remote: remoteName, prune: extras?.prune === true }
            if (remoteBranch && !parameters.prune) parameters.branch = subject.ref.slice(14 + remoteName.length)
            successLabel = t(parameters.prune ? 'wb.fetchPrune' : remoteBranch ? 'wb.fetchBranch' : 'wb.fetch')
          }
          var context = workbenchContextRef.current
          var refreshBranchSync = function () {
            if (workbenchContextRef.current !== context) return
            afterWrite(); setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
          }
          branchSyncState[1](subject?.ref || (extras?.remote ? 'remote:' + extras.remote : null))
          performWrite(action, parameters, {
            successText: successLabel + ' · ' + t('action.ok'),
            after: function () {
              if (workbenchContextRef.current !== context) return
              writeWorkbenchStorage('fetch:' + repo.root, Date.now()); refreshBranchSync()
            },
            onError: refreshBranchSync,
          }).finally(function () { if (workbenchContextRef.current === context) branchSyncState[1](null) })
          return
        }
        workbenchRequestState[1]({ action: action, subject: subject || null, extras: extras || {}, id: Date.now() })
      }
      var executeWorkbench = function (payload) {
        if (pendingWriteRef.current) return Promise.reject(new Error(t('state.loading')))
        var context = workbenchContextRef.current
        var active = function () { return workbenchContextRef.current === context }
        pendingWriteRef.current = true; setWriteMethod(payload.action)
        return run('write.workbenchAction', Object.assign({}, payload, { root: repo.root, confirm: true }), { silentError: true })
          .then(function (value) {
            if (!active()) return value
            if (value.recovery && (value.recovery.backup || value.recovery.stash || ['resetTo', 'undoCommit'].includes(value.recovery.kind))) {
              recoveryState[1](function (current) { var next = [Object.assign({ at: Date.now() }, value.recovery)].concat(current).slice(0, 20)
                writeWorkbenchStorage('recovery:' + repo.root, next); return next })
            }
            if (payload.action === 'undoCommit') {
              if (!commitMessage.trim()) setCommitMessage(payload.parameters?.originalMessage || '')
              setTab('changes')
            }
            if (payload.action === 'revert' && payload.parameters?.noCommit) setTab('changes')
            if (payload.action === 'cherryPick' && payload.parameters?.noCommit) setTab('changes')
            if (payload.action === 'restoreRevision') setTab('changes')
            if (payload.action === 'fetch') writeWorkbenchStorage('fetch:' + repo.root, Date.now())
            if (payload.action === 'renameBranch') {
              setGraphConfig(function (current) { return Object.assign({}, current, {
                selected: current.selected === 'refs/heads/' + payload.parameters.from ? 'refs/heads/' + payload.parameters.to : current.selected }) })
              writeWorkbenchStorage('favorites:' + repo.root, readWorkbenchStorage('favorites:' + repo.root, []).map(function (ref) {
                return ref === 'refs/heads/' + payload.parameters.from ? 'refs/heads/' + payload.parameters.to : ref
              }))
            }
            if (payload.action === 'deleteBranch') {
              var removedRef = payload.parameters.remote ? 'refs/remotes/' + payload.parameters.remoteName + '/' + payload.parameters.name : 'refs/heads/' + payload.parameters.name
              setGraphConfig(function (current) { return current.selected === removedRef ? Object.assign({}, current, { selected: '', scope: 'all' }) : current })
              writeWorkbenchStorage('favorites:' + repo.root, readWorkbenchStorage('favorites:' + repo.root, []).filter(function (ref) { return ref !== removedRef }))
            }
            setToast({ seq: Date.now(), text: t('wb.' + payload.action) + ' · ' + t('action.ok'),
              action: payload.action === 'undoCommit' && commitMessage.trim() ? { label: t('wb.originalMessage'), run: function () { setCommitMessage(payload.parameters?.originalMessage || '') } } : null })
            return value
          }).catch(function (failure) {
            if (!active()) throw failure
            if (failure.details?.recovery) recoveryState[1](function (current) { var next = [Object.assign({ at: Date.now() }, failure.details.recovery)].concat(current).slice(0, 20)
              writeWorkbenchStorage('recovery:' + repo.root, next); return next })
            return run('status', { root: repo.root, force: true }, { silent: true, silentError: true }).then(function (value) {
              if (!active()) throw failure
              setStatus(value)
              if (value.operation || (value.files || []).some(function (file) { return file.kind === 'unmerged' })) {
                workbenchRequestState[1](null); setTab('changes'); setSelection(null); setError(t('wb.conflict'))
              }
              throw failure
            })
          }).finally(function () {
            if (!active()) return
            pendingWriteRef.current = false; setWriteMethod(null); afterWrite()
            setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
          })
      }
      var branchApi = {
        t: t, busy: busy > 0 || !!status?.operation, current: status?.branch?.head,
        worktreesSupported: repo?.features?.['git:worktrees'] !== false,
        workflow: openWorkbench,
        history: function (branch, direction) {
          showRefHistory(direction === 'outgoing' ? branch.ref + '..HEAD' : direction ? 'HEAD..' + branch.ref : branch.ref); setQuery('')
        },
        compare: function (branch) { openComparison(branch.ref) },
        copy: function (text) { navigator.clipboard.writeText(text).then(function () { setToast({ seq: Date.now(), text: t('diff.copied') }) }).catch(function () { setError(t('diff.copyFailed')) }) },
      }
      var openBranchMenu = function (event, branch) {
        event.preventDefault(); event.stopPropagation?.()
        var rect = event.currentTarget?.getBoundingClientRect?.()
        setContextMenu({ x: rect?.left || event.clientX || 0, y: rect?.bottom || event.clientY || 0,
          items: branch.folder && branch.remoteName ? [{ id: 'pruneRemote', label: t('wb.pruneRemote'), command: 'fetch', hint: t('wb.pruneRemoteHint'), disabled: branchApi.busy,
            run: function () { performWrite('fetch', { remote: branch.remoteName, prune: true }, { after: afterWrite, successText: t('wb.remotePruned', { name: branch.remoteName }) }) } }]
            : branch.folder ? [{ id: 'new', label: t('wb.createBranch'), command: 'branch / checkout', disabled: branchApi.busy,
            run: function () { openWorkbench('createBranch', null, { prefix: branch.prefix }) } }]
            : workbenchBranchItems(branch, Object.assign({}, branchApi, { favorite: function () {
              var key = 'favorites:' + repo.root, value = readWorkbenchStorage(key, [])
              value = value.includes(branch.ref) ? value.filter(function (ref) { return ref !== branch.ref }) : value.concat(branch.ref)
              writeWorkbenchStorage(key, value); setGraphConfig(function (config) { return Object.assign({}, config) })
            } })) })
      }
      var openCommitMenu = function (event, sha) {
        event.preventDefault(); event.stopPropagation?.()
        var rect = event.currentTarget?.getBoundingClientRect?.()
        var api = { t: t, workflow: openWorkbench, copy: branchApi.copy, busy: branchApi.busy, detached: !!status?.branch?.detached,
          head: status?.branch?.oid, compare: function () { openComparison(sha) } }
        var context = workbenchContextRef.current
        setContextMenu({ sha: sha, x: rect?.left || event.clientX || 0, y: rect?.bottom || event.clientY || 0,
          items: workbenchCommitItems(sha, api) })
        run('commit', { root: repo.root, sha: sha }, { silent: true, silentError: true }).then(function (commit) {
          if (context !== workbenchContextRef.current) return
          api.commit = commit
          setContextMenu(function (current) { return current?.sha === sha ? Object.assign({}, current, { items: workbenchCommitItems(sha, api) }) : current })
        }).catch(function () {})
      }

      var showFileHistory = function (path, ref) {
        fileRequestRef.current++
        setHistoryPath(path); setHistoryRef(ref || 'HEAD'); setHistoryLimit(60); setQuery('')
        setSelection(null); setCommitDetail(null); setDiff(null); setFileView(null)
        historyRetryState[1](function (value) { return value + 1 }); setTab('history')
      }
      var showHistoryFileMenu = function (event, file, ref) {
        event.preventDefault(); event.stopPropagation?.()
        setContextMenu({ x: event.clientX || 0, y: event.clientY || 0, items: [
          { id: 'history', label: t('action.fileHistory'), command: 'log', disabled: file.kind === 'untracked',
            run: function () { showFileHistory(file.path, ref) } },
          { id: 'copy-path', label: t('action.copyPath'), run: function () { branchApi.copy(file.path) } },
        ] })
      }
      var showFileMenu = function (event, file, section) {
        var extras = Array.isArray(section) ? section : []
        if (extras.length) section = 'working'
        event.preventDefault()
        event.stopPropagation?.()
        var staged = section ? section === 'staged' : !isUnstaged(file)
        section = section || (staged ? 'staged' : 'unstaged')
        var items = [
          { id: 'changes', label: t('action.openChanges'), run: function () { openChangedFile(file, 'diff', section); setTab('changes') } },
          { id: 'file', label: t('action.openFile'), run: function () { openChangedFile(file, 'content', section); setTab('changes') } },
          { id: 'head', label: t('action.openHead'), disabled: file.kind === 'untracked',
            run: function () { openChangedFile(file, 'head', section); setTab('changes') } },
          { separator: true },
          { id: 'history', label: t('action.fileHistory'), disabled: file.kind === 'untracked',
            run: function () { showFileHistory(file.path) } },
          { separator: true },
          { id: 'stage', disabled: busy > 0, label: staged ? t('action.unstage') : t('action.stage'),
            run: function () { performWrite(staged ? 'unstage' : 'stage', { paths: [file.path] }, { after: afterWrite }) } },
          { id: 'discard', label: t('action.discard'), danger: true, disabled: busy > 0 || staged,
            run: function () { setDiscardTarget(file, {
              t: t, requestConfirm: function (message, onConfirm) { setConfirmRequest({ message: message, onConfirm: onConfirm }) },
              onWrite: performWrite, afterWrite: afterWrite,
            }) } },
          { id: 'stash', label: t('action.stashFile'), disabled: busy > 0,
            run: function () { performWrite('stashPush', {
              paths: [file.path], includeUntracked: file.kind === 'untracked',
            }, { after: afterWrite }) } },
          { id: 'ignore', label: t('action.ignoreFile'), disabled: busy > 0 || file.kind !== 'untracked',
            run: function () { performWrite('ignorePath', { path: file.path }, { after: afterWrite }) } },
          { separator: true },
          { id: 'copy-patch', label: t('action.copyPatch'), disabled: file.kind === 'untracked',
            run: function () {
              run('diff', { root: repo.root, staged: staged, path: file.path }, { silentError: true })
                .then(function (value) { return navigator.clipboard.writeText(value.text || '') })
                .catch(function (failure) { setError(t('error.action', { message: failure.message })) })
            } },
          { id: 'copy-path', label: t('action.copyPath'),
            run: function () { navigator.clipboard.writeText(file.path).catch(function () {}) } },
        ]
        var commands = {
          changes: file.kind === 'untracked' ? null : 'diff',
          file: staged ? 'show' : null, head: 'show', history: 'log',
          stage: staged ? 'reset' : 'add',
          discard: file.kind === 'untracked' ? 'clean' : 'restore',
          stash: 'stash push', 'copy-patch': 'diff',
        }
        items.forEach(function (item) { if (!item.separator) item.command = commands[item.id] })
        if (extras.length) items = extras.concat([{ separator: true }], items.filter(function (item) { return item.id !== 'stage' }))
        setContextMenu({ x: event.clientX || 0, y: event.clientY || 0, items: items })
      }

      var header = h('div', { className: 'dshgit-titlebar', key: 'bar',
        'data-draggable': !!props.onDragStart && !props.maximized,
        onPointerDown: props.onDragStart,
      }, [
        h('span', { key: 'brand', className: 'dshgit-brand' }, [
          h(IconGit, { key: 'i', size: 16 }),
          h('span', { key: 't' }, t('panel.title')),
        ]),
        // Repository identity as a breadcrumb. The switcher replaces the plain
        // path when there is more than one repository, because choosing between
        // them is then a real task rather than a label.
        knownRepos.length > 1 && repo !== null
          ? h(ComboBox, {
              key: 'repo',
              t: t,
              // The repository list is a list of PATHS: filtering by a path
              // fragment is how you find the right one once a profile has a
              // dozen checkouts, and a native select cannot be typed into.
              className: 'dshgit-repo-combo',
              style: { width: 'auto', maxWidth: '280px' },
              value: repo.root,
              placeholder: baseName(repo.root),
              // Show the basename (that is what identifies a checkout) but filter
              // on the full path as well, so either form finds it.
              options: knownRepos.map(function (entry) {
                return { value: entry.root, label: baseName(entry.root), group: dirName(entry.root) }
              }),
              onChange: function (value) {
                var chosen = null
                for (var i = 0; i < knownRepos.length; i++) {
                  if (knownRepos[i].root === value) chosen = knownRepos[i]
                }
                if (chosen !== null) {
                  setRepo(chosen)
                  setStatus(null)
                  loadRepo(chosen, { force: true })
                }
              },
            })
          : repo !== null
            ? h('span', { key: 'root', className: 'dshgit-crumbs', title: repo.root }, [
                // The whole path stays in the text (so it is still selectable and
                // searchable), but CSS lets it shrink with an ellipsis before it
                // can push the sync controls off the row.
                h('span', { key: 'n', className: 'dshgit-crumb-name' }, repo.root),
              ])
            : null,
        // Branch stays in the title bar: it is the identity of what this
        // workbench is showing, like the repository it sits beside. Divergence
        // does NOT — that is sync state, and it belongs with the other sync facts
        // in the status bar. Showing it in both places was duplication that made
        // the title bar noisier for no extra information.
        status !== null && status.branch !== null
          ? h('span', { key: 'branch', className: 'dshgit-crumb-strong' }, status.branch.head || '?')
          : null,
        h('span', { key: 'spacer', className: 'dshgit-spacer' }),
        // Remote actions. Grouped and always visible so the common loop
        // (fetch → review → commit → push) needs no menu hunting.
        repo !== null
          ? h('div', { key: 'tools', className: 'dshgit-title-tools', role: 'group', 'aria-label': 'Git' }, [
              h('button', {
                key: 'fetch', type: 'button', className: 'dshgit-winbtn', title: t('action.fetch'),
                disabled: busy > 0, 'aria-busy': writeMethod === 'fetch',
                'aria-label': t('action.fetch'),
                onClick: function () {
                  performWrite('fetch', { prune: true }, { after: afterWrite })
                },
              }, writeMethod === 'fetch' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'fetch', size: 16 })),
              h('button', {
                key: 'pull', type: 'button', className: 'dshgit-winbtn', title: t('action.pull'), 'aria-label': t('action.pull'),
                disabled: busy > 0, 'aria-busy': writeMethod === 'pull',
                onClick: function () { performWrite('pull', {}, { after: afterWrite }) },
              }, writeMethod === 'pull' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'pull', size: 16 })),
              h('button', {
                key: 'push', type: 'button', className: 'dshgit-winbtn', title: t('action.push'), 'aria-label': t('action.push'),
                disabled: busy > 0, 'aria-busy': writeMethod === 'push',
                onClick: function () { performWrite('push', {}, { after: afterWrite }) },
              }, writeMethod === 'push' ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconBranchSync, { kind: 'push', size: 16 })),
              h('button', { key: 'refresh', type: 'button', className: 'dshgit-winbtn', disabled: busy > 0,
                onClick: function () { refresh({ force: true }) }, title: t('action.refresh'), 'aria-label': t('action.refresh'),
              }, h(IconRefresh, { size: 16 })),
            ])
          : null,
        // Window controls. They live on this row (not in a separate window
        // header) because the title bar is already the window's identity strip —
        // a second header above it would be a strip of pure chrome.
        props.onMinimize || props.onMaximize || props.onClose ? h('div', { key: 'window', className: 'dshgit-window-controls', role: 'group', 'aria-label': t('panel.title') }, [
        props.onMinimize === undefined ? null : h('button', {
          key: 'min', type: 'button', className: 'dshgit-winbtn',
          title: t('window.minimize'), 'aria-label': t('window.minimize'),
          onClick: props.onMinimize,
        }, svg({ size: 16 }, h('path', { d: 'M3 8h10', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
        props.onMaximize === undefined ? null : h('button', {
          key: 'max', type: 'button', className: 'dshgit-winbtn',
          title: t(props.maximized ? 'window.restore' : 'window.maximize'),
          'aria-label': t(props.maximized ? 'window.restore' : 'window.maximize'),
          'aria-pressed': props.maximized === true,
          onClick: props.onMaximize,
        }, svg({ size: 16 }, props.maximized
          ? h('path', { d: 'M5 5V3h8v8h-2M3 5h8v8H3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' })
          : h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }))),
        props.onClose === undefined ? null : h('button', {
          key: 'close', type: 'button', className: 'dshgit-winbtn dshgit-window-close',
          title: t('window.close'), 'aria-label': t('window.close'),
          onClick: props.onClose,
        }, h(IconClose, { size: 16 })),
        ]) : null,
      ])

      // Repository facts that are always true and never actionable, parked at the
      // bottom where they cannot push the actions off the title bar.
      var statusbar = h(StatusBar, {
        key: 'status',
        t: t,
        status: status,
        repoMeta: repoMeta,
        busy: busy > 0,
        // The resolved git executable is the one fact that explains a broken
        // repository read, so it belongs somewhere always visible.
        gitVersion: gitPath,
      })

      // Settings remain accessible before a repository or Git is available.
      if (repo === null && tab !== 'settings') {
        return h('div', { className: 'dshgit' }, [
          header,
          h('div', { key: 'body', className: 'dshgit-setup' },
            h('div', { className: 'dshgit-setup-card' }, [
              h('div', { key: 'icon', className: 'dshgit-setup-icon', 'aria-hidden': true }, h(IconGit, { size: 28 })),
              h('div', { key: 'title', className: 'dshgit-setup-title' }, t('state.repoSetup')),
              h('div', { key: 'hint', className: 'dshgit-setup-hint', role: discovering ? 'status' : undefined },
                t(discovering ? 'state.loading' : gitMissing ? 'state.noGit' : 'state.noRepo')),
              directory !== null ? h('div', { key: 'path', className: 'dshgit-setup-path', title: directory }, directory) : null,
              error !== null ? h('div', { key: 'error', className: 'dshgit-setup-error', role: 'alert' }, error) : null,
              h('div', { key: 'actions', className: 'dshgit-setup-actions' }, [
                !discovering && !gitMissing && canInitialize ? h('button', {
                  key: 'init', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
                  disabled: busy > 0, title: 'git init', 'data-repo-action': 'init',
                  onClick: function () {
                    if (busy > 0) return
                    setError(null)
                    run('initRepository', {}).then(function () { refresh({ force: true }) }).catch(function () {})
                  },
                }, [busy > 0 ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
                  h('span', { key: 'label' }, t('action.initRepository'))]) : null,
                h('button', { key: 'settings', type: 'button', className: 'dshgit-btn',
                  'data-repo-action': 'settings', onClick: function () { setTab('settings') },
                }, t('tab.settings')),
              ]),
            ])),
          statusbar,
        ])
      }

      /* -------------------------- layout -------------------------- */

      // Every module renders through ONE skeleton — activity bar, sidebar,
      // editor — so the spatial model never changes when the user switches.
      // Previously only "changes" had a sidebar and the other five modules were
      // full-width single-column panels, which meant re-learning where things
      // were on every switch.
      var sidebar = null
      var editor = null
      var editorHead = null

      if (tab === 'settings') {
        sidebar = h(SettingsNav, {
          key: 'nav',
          section: settingsSection,
          onSelect: setSettingsSection,
          t: t,
        })
        editor = h(SettingsTab, {
          key: 'settings',
          run: run,
          gitPath: gitPath,
          repo: repo,
          section: settingsSection,
          onChanged: function () { refresh({ force: true }) },
          onToast: function (text) { setToast({ seq: Date.now(), text: text }) },
          t: t,
        })
      } else if (tab === 'stashes') {
        var selectedStash = (stashes || []).find(function (stash) { return (stash.sha || stash.ref) === selectedStashId }) || null
        sidebar = h(StashesSidebar, { stashes: stashes, error: stashError, selected: selectedStashId,
          canCreate: status !== null && (status.files || []).length > 0, busy: busy > 0,
          onCreate: createStash, onSelect: openStash, onRetry: afterWrite,
          onApply: applyStash, onDrop: dropStash, busyAction: stashAction, t: t })
        editor = h(StashDetails, { key: repo.root + ':' + (selectedStash === null ? 'empty' : selectedStash.sha || selectedStash.ref),
          stash: selectedStash, repo: repo, run: run, busy: busy > 0, onFileMenu: showHistoryFileMenu, t: t,
        })
      } else if (tab === 'compare') {
        var comparison = compareData[0]?.requestKey === JSON.stringify([repo.root, compareWith, compareTo, compareRetry[0]]) ? compareData[0] : null
        sidebar = h(CompareSidebar, {
          key: compareWith + ':' + compareTo,
          files: comparison?.files || [], loading: !comparison && !compareError[0], error: compareError[0],
          selected: comparePath[0], onSelect: comparePath[1], t: t,
          onFileMenu: function (event, file) { showHistoryFileMenu(event, file, comparison?.to || compareTo) },
        })
        editor = h(CompareTab, {
          key: repo.root + ':' + compareWith + ':' + compareTo + ':' + compareRetry[0],
          repo: repo, run: run, from: compareWith, to: compareTo,
          data: comparison, error: compareError[0], history: compareHistory[0], selected: comparePath[0],
          onCompare: function (from, to) { setCompareWith(from); compareToState[1](to); compareRetry[1](function (value) { return value + 1 }) },
          onBack: function () { setTab(compareReturn.current) },
          onFileMenu: showHistoryFileMenu,
          refs: [].concat(refs?.branches || [], refs?.remotes || [], refs?.tags || []),
          t: t,
        })
      } else if (tab === 'output') {
        sidebar = h(OutputSidebar, {
          key: 'nav',
          entries: outputEntries,
          filter: outputFilter,
          onFilter: setOutputFilter,
          onRefresh: loadOutput,
          onClear: clearOutput,
          t: t,
        })
        editor = h(OutputList, {
          key: 'output',
          entries: outputEntries,
          filter: outputFilter,
          t: t,
        })
      } else if (tab === 'graph') {
        sidebar = h(WorkbenchBranchSidebar, { key: repo.root, root: repo.root, refs: refs, remotes: remoteList,
          status: status, worktrees: worktrees, selected: graphConfig.selected, busy: branchApi.busy,
          busyRef: branchSyncState[0] || workbenchRequest?.subject?.ref, busyAction: writeMethod, t: t,
          onSelect: function (branch) { setGraphConfig(function (value) { return Object.assign({}, value, { selected: branch.ref, scope: 'selected', limit: 200 }) }) },
          onWorkflow: openWorkbench, onMenu: openBranchMenu,
          refreshing: graphLoadingState[0], onRefresh: function () {
            var context = workbenchContextRef.current
            return loadRepo(repo, { force: true }).then(function () {
              if (workbenchContextRef.current !== context) return
              setGraphConfig(function (value) { return Object.assign({}, value, { refresh: value.refresh + 1 }) })
            })
          },
          onFetch: function (remote, prune) { openWorkbench('fetch', null, { remote: remote, prune: prune === true }) },
          onReflog: function () { reflogOpenState[1](true) },
        })
        editor = h(WorkbenchGraph, { key: 'graph', graph: graph, refs: refs, config: graphConfig, loading: graphLoadingState[0], error: graphErrorState[0],
          onConfig: function (patch) { setGraphConfig(function (value) { return Object.assign({}, value, patch) }) },
          selection: selection, onOpenCommit: openCommit, onMenu: openCommitMenu,
          onCloseDetail: function () { setSelection(null) }, repo: repo, run: run,
          onFileMenu: showHistoryFileMenu,
          onFileRestore: function (sha, path) { openWorkbench('restoreRevision', { sha: sha, path: path }) },
          recovery: recoveryState[0][0], onRecovery: function () { reflogOpenState[1](true) }, t: t })
      } else if (tab === 'history') {
        sidebar = h(HistorySidebar, {
          key: 'nav',
          commits: commits,
          selection: selection,
          query: query,
          setQuery: function (value) { setHistoryLimit(60); setQuery(value) },
          historyPath: historyPath,
          historyRef: historyRef,
          onResetHistory: function () { showRefHistory('HEAD') },
          hasMore: commits.length >= historyLimit,
          loading: historyLoadingState[0], error: historyErrorState[0],
          onRetry: function () { historyRetryState[1](historyRetryState[0] + 1) },
          onLoadMore: function () { setHistoryLimit(historyLimit + 60) },
          clearHistoryPath: function () { setHistoryLimit(60); setHistoryPath('') },
          onOpenCommit: openCommit,
          onMenu: openCommitMenu,
          t: t,
        })
        // Selecting a commit replaces the editor's content, so the diff for what
        // was just clicked appears where the click happened.
        editor = selection !== null && (selection.kind === 'commit' || selection.kind === 'revisionFile')
          ? h(HistoryCommitDetails, { key: repo.root + ':' + selection.sha, sha: selection.sha,
              initialPath: selection.kind === 'revisionFile' ? selection.path : historyPath,
              repo: repo, run: run, onMenu: openCommitMenu, onFileMenu: showHistoryFileMenu,
              onFileRestore: function (sha, path) { openWorkbench('restoreRevision', { sha: sha, path: path }) }, t: t })
          : h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommitSelected'))
      } else {
        // changes: the file list is the sidebar, the diff is the editor.
        sidebar = h(changelistModel.mode === 'lists' ? ChangelistPane : LeftPane, {
          key: 'nav',
          changelists: changelistModel,
          hideToolbar: true,
          prompt: function (spec) { setPromptRequest({ title: spec.title, fields: spec.fields, compact: spec.compact, submit: spec.onSubmit, awaitSubmit: true }) },
          fileMenu: showFileMenu,
          status: status,
          busy: busy > 0,
          selection: selection,
          onOpenFile: openChangedFile,
          onFileContextMenu: showFileMenu,
          showMenu: function (event, items, options) {
            event.preventDefault(); event.stopPropagation?.()
            var rect = event.type === 'contextmenu' ? null : event.currentTarget?.getBoundingClientRect?.()
            setContextMenu({ x: rect ? rect.left : event.clientX || 0, y: rect ? rect.bottom : event.clientY || 0, items: items, compact: options?.compact === true })
          },
          onWrite: performWrite,
          afterWrite: afterWrite,
          requestConfirm: function (message, onConfirm) {
            setConfirmRequest({ message: message, onConfirm: onConfirm })
          },
          t: t,
        })
        editor = h(CenterPane, {
          key: 'center',
          changelists: changelistModel,
          tab: tab,
          repo: repo,
          status: status,
          tracking: tracking,
          diff: diff,
          fileView: fileView,
          fileDisplay: fileDisplay,
          setFileDisplay: setFileDisplay,
          revisionSide: revisionSide,
          viewRevisionSide: viewRevisionSide,
          onOpenRevisionFile: openRevisionFile,
          onFileMenu: function (event, file) {
            if (selection?.kind === 'file') showFileMenu(event, selection.file, selection.section)
            else showHistoryFileMenu(event, file, selection?.sha)
          },
          commitDetail: commitDetail,
          selection: selection,
          commits: commits,
          graph: graph,
          query: query,
          setQuery: setQuery,
          historyPath: historyPath,
          historyRef: historyRef,
          onResetHistory: function () { showRefHistory('HEAD') },
          historyLimit: historyLimit,
          loadMoreHistory: function () { setHistoryLimit(historyLimit + 60) },
          clearHistoryPath: function () { setHistoryPath('') },
          onOpenCommit: openCommit,
          onOpenFile: openChangedFile,
          clearSelection: function () { setSelection(null) },
          commitMessage: commitMessage,
          setCommitMessage: setCommitMessage,
          busy: busy > 0,
          busyMethod: writeMethod,
          onWrite: performWrite,
          afterWrite: afterWrite,
          aiNotice: aiNotice,
          setAiNotice: setAiNotice,
          run: run,
          t: t,
        })
      }

      // The module's own definition supplies its sidebar header. A module whose
      // sidebar has nothing to say hides the column instead of showing an empty
      // gutter, which reads as a failed load.
      var moduleDef = moduleById(tab)
      var hasSidebar = tab !== 'graph' || graph !== null

      var body = h('div', { key: 'body', className: 'dshgit-body' }, [
        h(ActivityBar, {
          key: 'activity',
          t: t,
          active: tab === 'compare' ? compareReturn.current : tab,
          changes: status === null ? 0 : (status.files || []).length,
          onSelect: setTab,
        }),
        hasSidebar
          ? h('div', { key: 'sidebar', className: 'dshgit-sidebar' }, [
              h('div', { key: 'h', className: 'dshgit-sidebar-head' }, [
                tab === 'changes' ? h(ChangelistModeToolbar, { key: 'title', changelists: changelistModel, label: t(moduleDef.sidebarKey), t: t,
                  busy: busy > 0 || changelistModel.loading,
                  showMenu: function (event, items) { var rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom, items: items }) },
                  onCreate: changelistModel.mode === 'lists' ? function () { setPromptRequest({ title: t('cl.create'), compact: true, fields: [
                    { key: 'name', label: t('cl.name'), value: '' }, { key: 'makeActive', label: t('cl.active'), type: 'checkbox', value: false },
                  ], awaitSubmit: true, submit: function (values) { return changelistModel.mutate({ action: 'create', name: values.name, makeActive: values.makeActive }) } }) } : undefined,
                }) : h('span', { key: 'title', style: { flex: 1 } }, t(moduleDef.sidebarKey)),
                tab === 'changes' ? h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn',
                  title: t('menu.actions'), 'aria-label': t('menu.actions'), 'aria-haspopup': 'menu',
                  onClick: function (event) {
                    var rect = event.currentTarget.getBoundingClientRect()
                    setContextMenu({ x: rect.left, y: rect.bottom, items: [
                      { id: 'undo', label: t('action.undoCommit'), disabled: busy > 0,
                        run: function () { openWorkbench('undoCommit', { sha: status?.branch?.oid }) } },
                    ] })
                  },
                }, h(IconMore, { size: 16 })) : null,
              ]),
              h('div', { key: 'b', className: 'dshgit-sidebar-body' }, sidebar),
              tab === 'changes' && repo !== null ? h('div', { key: 'composer', className: 'dshgit-sidebar-composer' },
                h(CommitComposer, { message: commitMessage, setMessage: setCommitMessage,
                  changelists: changelistModel,
                  busy: busy > 0, busyMethod: writeMethod, status: status, tracking: tracking,
                  onWrite: performWrite, afterWrite: afterWrite, run: run, repo: repo,
                  aiNotice: aiNotice, setAiNotice: setAiNotice, sidebar: true, t: t })) : null,
            ])
          : null,
        h('div', { key: 'editor', className: 'dshgit-editor' }, [
          editorHead,
          h('div', { key: 'body', className: 'dshgit-editor-body' }, editor),
        ]),
      ])

      var overlay = []
      if (error !== null) {        overlay.push(
          h('div', { key: 'err', className: 'dshgit-err' }, [
            h('span', { key: 'm' }, error),
            h(
              'button',
              {
                key: 'x',
                type: 'button',
                className: 'dshgit-btn',
                style: { marginLeft: '8px' },
                onClick: function () { setError(null) },
              },
              t('action.close'),
            ),
          ]),
        )
      }
      if (toast !== null) {
        overlay.push(h(Toast, { key: 'toast', seq: toast.seq, text: toast.text, action: toast.action, busy: busy > 0, onDone: function () { setToast(null) } }))
      }
      if (confirmRequest !== null) {
        overlay.push(h(ConfirmBar, {
          key: 'confirm', centered: true, t: t,
          request: Object.assign({}, confirmRequest, { onConfirm: function (option) {
            var action = confirmRequest.onConfirm
            setConfirmRequest(null)
            action(option)
          } }),
          onCancel: function () { setConfirmRequest(null) },
        }))
      }

      if (promptRequest !== null) {
        overlay.push(h(PromptDialog, {
          key: 'prompt',
          spec: promptRequest,
          t: t,
          onClose: function () { setPromptRequest(null) },
        }))
      }

      if (remoteRequest[0] && repo) overlay.push(h(RemoteConfigDialog, {
        key: repo.root + ':' + remoteRequest[0].id, repo: repo, run: run, t: t, remotes: remoteList,
        initialPush: remoteRequest[0].push, branch: remoteRequest[0].branch || status?.branch?.head,
        onWrite: function (method, payload) { return performWrite(method, payload, { propagate: true }) },
        onSaved: function () { afterWrite(); setWindowState({ refreshToken: getWindowState().refreshToken + 1 }) },
        onClose: function () { remoteRequest[1](null) },
      }))

      if (workbenchRequest !== null && repo !== null) overlay.push(h(WorkbenchDialog, {
        key: workbenchRequest.id, request: workbenchRequest, repo: repo, status: status, refs: refs, worktrees: worktrees,
        run: run, execute: executeWorkbench, t: t,
        onWorktreeOpen: function (directory) {
          var target = Object.assign({}, repo, { root: directory.replace(/\\/g, '/').replace(/\/$/, '') })
          setKnownRepos(function (value) { return value.some(function (entry) { return entry.root === target.root }) ? value : value.concat(target) })
          setRepo(target); setStatus(null); loadRepo(target, { force: true })
        },
        onClose: function () { if (!pendingWriteRef.current) workbenchRequestState[1](null) },
      }))
      if (reflogOpenState[0] && repo !== null) overlay.push(h(WorkbenchRecovery, {
        key: 'recovery', repo: repo, run: run, recovery: recoveryState[0], t: t,
        onClose: function () { reflogOpenState[1](false) },
        onWorkflow: function (action, subject, extras) { reflogOpenState[1](false); openWorkbench(action, subject, extras) },
        onStash: function (sha) { reflogOpenState[1](false); setSelectedStashId(sha); setTab('stashes') },
      }))

      overlay.push(h(FileContextMenu, { key: 'context', menu: contextMenu, onClose: function () { setContextMenu(null) } }))

      return h(Fragment, null, [h('div', { key: 'root', className: 'dshgit' }, [header, body, statusbar])].concat(props.active === false ? [] : overlay))
    }
    var changelistListeners = new Set()
    var changelistReads = new Map()
    var changelistLayouts = new Map()
    function changelistLayout(root, fallback) {
      if (changelistLayouts.has(root)) return changelistLayouts.get(root)
      var saved = readWorkbenchStorage('file-layout:' + root)
      return saved === 'tree' || saved === 'flat' ? saved : fallback || 'tree'
    }
    // Pending metadata edits affect the view immediately. The persisted version
    // stays separate so queued requests and scoped commits still validate it.
    function previewChangelist(data, operation) {
      if (!data) return data
      var next = Object.assign({}, data), action = operation.action
      if (action === 'mode') next.mode = operation.mode
      if (action === 'layout') next.fileLayout = operation.layout
      if (action === 'expand' || action === 'active') {
        next.lists = data.lists.map(function (list) { return list.id === operation.id && action === 'expand' ? Object.assign({}, list, { expanded: operation.expanded }) : list })
      }
      if (action === 'select' || action === 'scope' || action === 'active' || action === 'selectChunk') {
        var paths = new Set(operation.paths || []), selected = new Set(data.selected)
        if (action === 'scope' || action === 'active') {
          next.draftList = operation.id
          if (action === 'active') next.active = operation.id
          selected = new Set(action === 'scope' ? operation.paths : Object.keys(data.assignments).filter(function (path) { return data.assignments[path] === operation.id }))
        } else if (action === 'select') paths.forEach(function (path) { operation.checked ? selected.add(path) : selected.delete(path) })
        next.chunks = Object.assign({}, data.chunks)
        Object.keys(data.chunks || {}).forEach(function (path) {
          var record = data.chunks[path]
          if ((action === 'select' && !paths.has(path)) || (action === 'selectChunk' && operation.path !== path)) return
          next.chunks[path] = Object.assign({}, record, { parts: record.parts.map(function (part) {
            var checked = part.selected
            if (action === 'active' || action === 'scope') checked = part.list === operation.id
            else if (action === 'select' && (!operation.id || part.list === operation.id)) checked = operation.checked === true && !!part.list
            else if (action === 'selectChunk' && part.id === operation.chunk) checked = operation.checked === true && !!part.list
            return checked === part.selected ? part : Object.assign({}, part, { selected: checked })
          }) })
          if (!record.invalid && next.chunks[path].parts.some(function (part) { return part.selected })) selected.add(path)
          else selected.delete(path)
        })
        next.selected = Array.from(selected)
      }
      if (action === 'move' || action === 'moveChunk') {
        next.assignments = Object.assign({}, data.assignments)
        next.chunks = Object.assign({}, data.chunks)
        ;(action === 'move' ? operation.paths || [] : [operation.path]).forEach(function (path) {
          var record = data.chunks?.[path]
          if (record && (operation.from || action === 'moveChunk')) {
            next.chunks[path] = Object.assign({}, record, { parts: record.parts.map(function (part) {
              return (action === 'moveChunk' ? part.id === operation.chunk : part.list === operation.from) ? Object.assign({}, part, { list: operation.id }) : part
            }) })
          } else { next.assignments[path] = operation.id; delete next.chunks[path] }
        })
      }
      return next
    }
    /** Shared worktree metadata for the workbench and header commit popover. */
    function useChangelists(repo, status, call) {
      var root = repo?.root || ''
      var valueState = React.useState(null), errorState = React.useState(null), pendingState = React.useState(0)
      var draftState = React.useState({}), retryState = React.useState(0)
      var optimisticState = React.useState([])
      var layoutState = React.useState(0)
      var reference = React.useRef({ root: root, data: null, queue: Promise.resolve(), alive: true, drafts: {}, timer: null })
      var api = React.useRef(call); api.current = call
      if (reference.current.root !== root) {
        clearTimeout(reference.current.timer)
        reference.current.alive = false
        reference.current = { root: root, data: null, queue: Promise.resolve(), alive: true, drafts: {}, timer: null }
      }
      var context = reference.current
      var accept = function (data) {
        if (!context.alive || reference.current !== context) return
        if (context.data && data.version <= context.data.version) return
        context.data = data; valueState[1]({ root: root, data: data })
      }
      var refresh = function () {
        if (!root) return Promise.resolve()
        var read = changelistReads.get(root)
        if (!read) {
          read = api.current('changelists', { root: root }, { silent: true, silentError: true }).finally(function () {
            if (changelistReads.get(root) === read) changelistReads.delete(root)
          })
          changelistReads.set(root, read)
        }
        return read.then(function (data) {
          accept(data); changelistListeners.forEach(function (listener) { listener(root, context, data) })
        })
      }
      React.useEffect(function () {
        if (!root || !status) return
        var active = true
        refresh().then(function () { if (active) errorState[1](null) })
          .catch(function (error) { if (active) errorState[1](error.message) })
        return function () { active = false }
      }, [root, status, retryState[0]])
      var mutate = function (operation) {
        if (!root || !context.data) return Promise.reject(new Error('改动列表尚未加载'))
        // File layout is a client preference. Never send a new metadata action
        // to a Host that may still have the previous module loaded.
        if (operation.action === 'layout') {
          if (operation.layout !== 'tree' && operation.layout !== 'flat') return Promise.reject(new Error('无效的文件布局'))
          changelistLayouts.set(root, operation.layout); writeWorkbenchStorage('file-layout:' + root, operation.layout)
          layoutState[1](function (value) { return value + 1 }); errorState[1](null)
          changelistListeners.forEach(function (listener) { listener(root, context, null, operation.layout) })
          return Promise.resolve(Object.assign({}, context.data, { fileLayout: operation.layout }))
        }
        var edit = { context: context, operation: operation }
        if (['expand', 'select', 'scope', 'active', 'selectChunk', 'move', 'moveChunk', 'mode', 'layout'].includes(operation.action)) optimisticState[1](function (edits) { return edits.concat(edit) })
        if (operation.action !== 'draft') pendingState[1](function (value) { return value + 1 })
        var task = context.queue.catch(function () {}).then(function () {
          if (!context.alive) return
          return api.current('updateChangelist', Object.assign({ root: root, version: context.data.version }, operation),
            { silent: true, silentError: true }).then(function (data) {
              if (operation.action === 'draft' && context.drafts[operation.id] === operation.text) delete context.drafts[operation.id]
              if (!context.alive || reference.current !== context) return data
              accept(data); errorState[1](null)
              changelistListeners.forEach(function (listener) { listener(root, context, data) })
              return data
            })
        }).catch(function (error) {
          if (context.alive && reference.current === context) {
            errorState[1](error.message); refresh().catch(function () {})
          }
          throw error
        }).finally(function () {
          if (context.alive && reference.current === context) optimisticState[1](function (edits) { return edits.filter(function (entry) { return entry !== edit }) })
          if (operation.action !== 'draft' && context.alive && reference.current === context) pendingState[1](function (value) { return Math.max(0, value - 1) })
        })
        context.queue = task
        return task
      }
      React.useEffect(function () {
        context.alive = true
        pendingState[1](0); errorState[1](null)
        var listener = function (changedRoot, origin, data, layout) {
          if (changedRoot !== root || origin === context) return
          if (layout) layoutState[1](function (value) { return value + 1 })
          else if (data) accept(data)
        }
        changelistListeners.add(listener)
        return function () {
          clearTimeout(context.timer); context.alive = false; changelistListeners.delete(listener)
          var invoke = api.current, drafts = Object.assign({}, context.drafts)
          // Closing a popover or switching repositories must not lose the last
          // keystrokes that have not reached the debounce timer yet.
          context.queue.catch(function () {}).then(async function () {
            var latest = context.data
            if (!latest || !root) return
            for (var id of Object.keys(drafts)) {
              if (latest.lists.some(function (list) { return list.id === id && list.draft !== drafts[id] })) {
                latest = await invoke('updateChangelist', { root: root, version: latest.version, action: 'draft', id: id, text: drafts[id] }, { silent: true, silentError: true })
              }
            }
          }).catch(function () {})
        }
      }, [root])
      var persisted = valueState[0]?.root === root ? valueState[0].data : null
      var data = React.useMemo(function () {
        var value = optimisticState[0].reduce(function (value, edit) { return edit.context === context ? previewChangelist(value, edit.operation) : value }, persisted)
        return value ? Object.assign({}, value, { fileLayout: changelistLayout(root, value.fileLayout) }) : null
      }, [persisted, optimisticState[0], context, layoutState[0]])
      var current = data?.lists.find(function (list) { return list.id === (data.draftList || data.active) })
      var message = current ? Object.prototype.hasOwnProperty.call(context.drafts, current.id) ? context.drafts[current.id] : current.draft : ''
      var saveDraft = function (id, text) {
        clearTimeout(context.timer)
        return mutate({ action: 'draft', id: id, text: text })
      }
      var setMessage = function (text) {
        if (!current) return
        context.drafts[current.id] = text
        draftState[1](Object.assign({}, context.drafts))
        clearTimeout(context.timer)
        var id = current.id
        context.timer = setTimeout(function () { saveDraft(id, text).catch(function () {}) }, 400)
      }
      // The commit SCOPE, derived from one place. `pathsFor` exists so the commit
      // can recompute the scope from the data its `flush()` just returned instead
      // of trusting the `paths` captured at render time: a selection write that is
      // still in flight (or that failed) makes the captured value stale, and
      // committing that stale scope would include a file the user did not select.
      var pathsFor = function (target) {
        var valid = new Set((status?.files || []).filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }))
        return (target?.selected || []).filter(function (path) { return valid.has(path) })
      }
      return { data: data, mode: data?.mode || 'lists', loading: !data, error: errorState[0], pending: pendingState[0] > 0,
        message: message, setMessage: setMessage, mutate: mutate, retry: function () { retryState[1](function (value) { return value + 1 }) },
        flush: function () { return current ? saveDraft(current.id, message) : Promise.reject(new Error('改动列表尚未加载')) },
        pathsFor: pathsFor,
        paths: React.useMemo(function () { return pathsFor(data) }, [data, status]),
      }
    }

    function changelistHasFile(data, id, path) {
      var record = data.chunks?.[path]
      return record ? record.parts.some(function (part) { return part.list === id || (!part.list && data.assignments[path] === id) })
        : data.assignments[path] === id
    }
    function changelistSelection(data, id, files) {
      var checked = [], mixed = [], included = new Set(data.selected)
      files.forEach(function (file) {
        var record = data.chunks?.[file.path]
        if (!record) { if (included.has(file.path)) checked.push(file.path); return }
        var parts = record.parts.filter(function (part) { return part.list === id || (!part.list && data.assignments[file.path] === id) })
        var selected = parts.filter(function (part) { return part.selected }).length
        if (!record.invalid && selected === parts.length && parts.length) checked.push(file.path)
        else if (selected) mixed.push(file.path)
      })
      return { checked: checked, mixed: mixed }
    }

    function ChangelistCheckbox(props) {
      var input = React.useRef(null)
      React.useEffect(function () { if (input.current) input.current.indeterminate = props.mixed === true }, [props.mixed])
      return h('input', { ref: input, type: 'checkbox', className: 'dshgit-cl-checkbox', checked: props.checked,
        disabled: props.disabled, 'aria-label': props.label,
        onClick: function (event) { event.stopPropagation() }, onChange: props.onChange })
    }

    function changelistFileTree(files) {
      var root = { children: new Map(), files: [], members: [], path: '' }
      files.forEach(function (file) {
        var segments = file.path.split('/'), node = root, path = ''
        segments.slice(0, -1).forEach(function (name) {
          path = path ? path + '/' + name : name
          if (!node.children.has(name)) node.children.set(name, { name: name, path: path, children: new Map(), files: [], members: [] })
          node = node.children.get(name); node.members.push(file)
        })
        node.files.push(file)
      })
      return root
    }

    /** Flatten only open directories, then virtualize folders and files together. */
    function ChangelistFiles(props) {
      var scroll = React.useState(0), height = 34, windowSize = 16
      var collapsed = React.useState({})
      var tree = React.useMemo(function () { return props.layout === 'flat' ? null : changelistFileTree(props.files) }, [props.files, props.layout])
      var rows = React.useMemo(function () {
        if (props.layout === 'flat') return props.files.slice().sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }) }).map(function (file) { return { file: file, depth: 0 } })
        var result = []
        var walk = function (node, depth) {
          Array.from(node.children.values()).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }) }).forEach(function (folder) {
            var name = folder.name
            // Compact a chain such as src/features/payments into one folder row.
            while (!folder.files.length && folder.children.size === 1) { folder = folder.children.values().next().value; name += '/' + folder.name }
            var open = !!props.filterKey || !collapsed[0][folder.path]
            result.push({ folder: folder, name: name, depth: depth, open: open })
            if (open) walk(folder, depth + 1)
          })
          node.files.slice().sort(function (a, b) { return baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true }) }).forEach(function (file) { result.push({ file: file, depth: depth }) })
        }
        walk(tree, 0); return result
      }, [tree, collapsed[0], props.filterKey, props.files, props.layout])
      var viewport = React.useRef(null)
      React.useEffect(function () { scroll[1](0); if (viewport.current) viewport.current.scrollTop = 0 }, [props.listId, props.filterKey, props.layout])
      var checkedPaths = new Set(props.checked || []), mixedPaths = new Set(props.mixed || []), multiPaths = new Set(props.multi || [])
      var start = Math.max(0, Math.floor(scroll[0] / height) - 2)
      start = Math.min(start, Math.max(0, rows.length - windowSize))
      var end = Math.min(rows.length, start + windowSize)
      // The leading offset puts each row's checkbox in the SAME column as the
      // group header's. That is not automatic: the header spends 6px padding + a
      // 24px chevron + a 6px gap before its checkbox, while a row is already
      // indented by the viewport's margin, its own margin and the guide border —
      // measured, the row landed 3px left of the header's checkbox, which reads as
      // a list that is almost-but-not-quite aligned. 11px closes exactly that gap.
      var indentBase = 11
      var indentStep = 16
      return h('div', { ref: viewport, className: 'dshgit-cl-viewport', onScroll: function (event) { var offset = Math.floor(event.currentTarget.scrollTop / height) * height; scroll[1](function (current) { return current === offset ? current : offset }) } },
        h('div', { style: { height: rows.length * height + 'px', position: 'relative' } },
          h('div', { style: { position: 'absolute', top: start * height + 'px', left: 0, right: 0 } }, rows.slice(start, end).map(function (row) {
            var style = { height: height + 'px', minHeight: height + 'px', boxSizing: 'border-box', paddingLeft: indentBase + row.depth * indentStep + 'px' }
            if (row.folder) {
              var folder = row.folder, count = folder.members.filter(function (file) { return checkedPaths.has(file.path) }).length
              var mixed = folder.members.some(function (file) { return mixedPaths.has(file.path) }) || (count > 0 && count < folder.members.length)
              return h('div', { key: 'directory:' + folder.path, className: 'dshgit-cl-directory', style: style }, [
                props.onCheck ? h(ChangelistCheckbox, { key: 'check', label: folder.path, checked: count === folder.members.length, mixed: mixed, disabled: props.busy || folder.members.every(function (file) { return file.kind === 'unmerged' }),
                  onChange: function (event) { props.onCheck(folder.members.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }), event.currentTarget.checked) } }) : null,
                h('button', { key: 'folder', type: 'button', className: 'dshgit-cl-directory-name', title: folder.path, 'aria-expanded': row.open,
                  onClick: function () { collapsed[1](function (current) { return Object.assign({}, current, { [folder.path]: row.open }) }) },
                }, [h(IconChevron, { key: 'arrow', size: 12, open: row.open }), h(IconFolder, { key: 'icon', size: 16 }), h('span', { key: 'name' }, row.name)]),
                h('span', { key: 'count', className: 'dshgit-cl-count' }, folder.members.length),
              ])
            }
            var file = row.file
            if (props.renderFile) return props.renderFile(file, style)
            return h('div', { key: 'file:' + file.path, className: 'dshgit-row dshgit-change', style: style,
              'data-selected': multiPaths.has(file.path) || props.selection?.path === file.path, tabIndex: 0,
              draggable: !props.busy,
              onDragStart: function (event) { event.dataTransfer.setData('application/x-dshgit-paths', JSON.stringify({ paths: props.multi.includes(file.path) ? props.multi : [file.path], from: props.listId })) },
              onClick: function (event) { props.onSelect(file, event, rows.filter(function (entry) { return entry.file }).map(function (entry) { return entry.file.path })) },
              onKeyDown: function (event) { if (event.target === event.currentTarget && event.key === 'Enter') props.onOpenFile(file) },
              onContextMenu: function (event) { props.onMenu(event, file) }, title: file.path,
            }, [h(ChangelistCheckbox, { key: 'check', label: file.path, checked: checkedPaths.has(file.path), mixed: mixedPaths.has(file.path), disabled: props.busy || file.kind === 'unmerged',
              onChange: function (event) { props.onCheck([file.path], event.currentTarget.checked) } })].concat(changeFileLabel(props.layout === 'flat' ? file.path : baseName(file.path)), [
              h('span', { key: 'status', className: 'dshgit-status' }, statusLetter(file)),
            ]))
          }))))
    }

    function ChangelistLayoutSwitch(props) {
      var model = props.changelists, layout = model.data?.fileLayout || 'tree'
      return h('div', { className: 'dshgit-cl-layout', role: 'group', 'aria-label': props.t('cl.tree') + ' / ' + props.t('cl.flat') }, ['tree', 'flat'].map(function (value) {
        return h('button', { key: value, type: 'button', className: 'dshgit-iconbtn', title: props.t('cl.' + value), 'aria-label': props.t('cl.' + value), 'aria-pressed': layout === value,
          disabled: props.busy || model.loading, onClick: function () { if (layout !== value) model.mutate({ action: 'layout', layout: value }).catch(function () {}) },
        }, h(value === 'tree' ? IconFileTree : IconFileList, { size: 16 }))
      }))
    }

    function ChangelistModeToolbar(props) {
      var model = props.changelists, t = props.t
      return h('div', { className: 'dshgit-cl-toolbar dshgit-cl-modebar' }, [
        h('button', { key: 'mode', type: 'button', className: 'dshgit-cl-mode', title: t('cl.switchMode') + ' · ' + t(model.mode === 'lists' ? 'cl.title' : 'cl.staging'),
          'aria-label': t('cl.switchMode'), 'aria-haspopup': 'menu', disabled: props.busy || model.loading,
          onClick: function (event) { props.showMenu(event, ['lists', 'staging'].map(function (mode) { return {
            id: mode, label: t(mode === 'lists' ? 'cl.title' : 'cl.staging'), disabled: model.mode === mode,
            run: function () { model.mutate({ action: 'mode', mode: mode }).catch(function () {}) },
          } })) },
        }, [h('span', { key: 'label' }, props.label || t(model.mode === 'lists' ? 'cl.title' : 'cl.staging')), h(IconChevron, { key: 'arrow', open: true, size: 16 })]),
        props.onCreate ? h('button', { key: 'new', type: 'button', className: 'dshgit-iconbtn', disabled: props.busy,
          title: t('cl.create'), 'aria-label': t('cl.create'), onClick: props.onCreate }, h(IconPlus, { size: 16 })) : null,
      ])
    }

    function ChangelistPane(props) {
      var model = props.changelists, data = model.data, t = props.t
      var search = React.useState(''), multi = React.useState([]), anchor = React.useRef(null), hover = React.useRef(null)
      var folded = React.useState({})
      React.useEffect(function () { return function () { clearTimeout(hover.current) } }, [])
      var busy = props.busy
      var act = function (operation) { model.mutate(operation).catch(function () {}) }
      if (!data) return h('div', { className: 'dshgit-empty' }, model.error ? [model.error, h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))] : t('state.loading'))
      var files = props.status?.files || [], query = search[0].trim().toLowerCase()
      var create = function (paths, from) { props.prompt({ title: t('cl.create'), compact: true, fields: [
        { key: 'name', label: t('cl.name'), value: '' }, { key: 'makeActive', label: t('cl.active'), type: 'checkbox', value: false },
      ], submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'create', name: values.name, makeActive: values.makeActive, paths: paths, from: from }) } }) }
      var targetPrompt = function (paths, from) {
        var targets = data.lists.filter(function (list) { return list.id !== from })
        if (!targets.length) return
        props.prompt({ title: t('cl.move'), fields: [
        { key: 'id', type: 'select', label: t('cl.target'), value: targets.some(function (list) { return list.id === data.active }) ? data.active : targets[0].id,
          options: targets.map(function (list) { return { value: list.id, label: list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name } }) },
      ], submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'move', id: values.id, paths: paths, from: from }) } }) }
      var fileMenu = function (event, file, from) {
        var paths = multi[0].includes(file.path) ? multi[0].filter(function (path) { return files.some(function (entry) { return entry.path === path }) }) : [file.path]
        props.fileMenu(event, file, [
          { id: 'move', label: t('cl.move'), disabled: busy || !data.lists.some(function (list) { return list.id !== from }), run: function () { targetPrompt(paths, from) } },
          { id: 'new-list', label: t('cl.create'), disabled: busy, run: function () { create(paths, from) } },
          { id: 'include', label: t(model.paths.includes(file.path) ? 'cl.exclude' : 'cl.select'), disabled: busy || file.kind === 'unmerged',
            run: function () { act({ action: 'select', paths: paths, checked: !model.paths.includes(file.path) }) } },
        ])
      }
      var group = function (list, entries, special) {
        var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().includes(query) })
        if (query && !matched.length) return null
        var choice = changelistSelection(data, list.id, matched), checked = choice.checked.length
        var open = !!query || (special ? !folded[0][list.id] : list.expanded !== false)
        var toggle = function () { if (special) folded[1](function (current) { return Object.assign({}, current, { [list.id]: open }) }); else act({ action: 'expand', id: list.id, expanded: !open }) }
        var label = special ? t(special) : list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name
        var menu = function (event) {
          var items = [
            { id: 'active', label: t('cl.active'), disabled: busy || data.active === list.id, run: function () { act({ action: 'active', id: list.id }) } },
            { id: 'scope', label: t('cl.scope'), disabled: busy || !entries.length, run: function () { act({ action: 'scope', id: list.id, paths: entries.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }) }) } },
            { id: 'stash', label: t('cl.stash'), command: 'stash', disabled: busy || model.pending || !entries.length || !!props.status?.operation, run: function () {
              props.requestConfirm(t('cl.stashConfirm', { name: list.name }), function () { props.onWrite('stashChangelist', { id: list.id, changelistVersion: data.version }, { after: props.afterWrite }) })
            } },
            { id: 'rename', label: t('cl.rename'), disabled: busy, run: function () { props.prompt({ title: t('cl.rename'), fields: [{ key: 'name', label: t('cl.name'), value: list.name }],
              submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'rename', id: list.id, name: values.name }) } }) } },
            { id: 'description', label: t('cl.description'), disabled: busy, run: function () { props.prompt({ title: t('cl.description'), fields: [{ key: 'text', label: t('cl.description'), value: list.description }],
              submit: t('action.ok'), onSubmit: function (values) { return model.mutate({ action: 'description', id: list.id, text: values.text }) } }) } },
            { id: 'move', label: t('cl.move'), disabled: busy || !entries.length || data.lists.length < 2, run: function () { targetPrompt(entries.map(function (file) { return file.path }), list.id) } },
            { id: 'delete', label: t('cl.delete'), disabled: busy || data.lists.length === 1, run: function () {
              var targets = data.lists.filter(function (entry) { return entry.id !== list.id })
              props.prompt({ title: t('cl.delete'), fields: [{ key: 'target', type: 'select', label: t('cl.deleteHint'), value: targets[0].id, options: targets.map(function (entry) { return { value: entry.id, label: entry.name } }) }],
                submit: t('cl.delete'), onSubmit: function (values) { return model.mutate({ action: 'delete', id: list.id, target: values.target }) } })
            } },
          ]
          props.showMenu(event, items)
        }
        return h('div', { key: list.id, className: 'dshgit-cl-group' }, [
          h('div', { key: 'head', className: 'dshgit-cl-head', 'data-active': data.active === list.id,
            onContextMenu: !special ? menu : undefined,
            onDragEnter: !special ? function () { clearTimeout(hover.current); if (!busy && !open) hover.current = setTimeout(function () { act({ action: 'expand', id: list.id, expanded: true }) }, 500) } : undefined,
            onDragOver: !special ? function (event) { event.preventDefault(); event.currentTarget.style.outline = '1px solid var(--dsw-alias-brand-primary)' } : undefined,
            onDragLeave: function (event) { clearTimeout(hover.current); event.currentTarget.style.outline = '' },
            onDrop: !special ? function (event) { clearTimeout(hover.current); event.preventDefault(); event.currentTarget.style.outline = ''; if (busy) return;
              try { var transfer = JSON.parse(event.dataTransfer.getData('application/x-dshgit-paths')); act({ action: 'move', id: list.id, paths: Array.isArray(transfer) ? transfer : transfer.paths, from: transfer.from }) } catch (error) {} } : undefined,
          }, [
            h('button', { key: 'fold', type: 'button', className: 'dshgit-iconbtn', 'aria-label': label, 'aria-expanded': !!open,
              onClick: toggle, disabled: busy }, h(IconChevron, { open: !!open, size: 12 })),
            special === 'cl.conflicts' ? null : h(ChangelistCheckbox, { key: 'check', label: label, checked: !!matched.length && checked === matched.length, mixed: choice.mixed.length > 0 || (checked > 0 && checked < matched.length), disabled: busy || !matched.length,
              onChange: function (event) { act({ action: 'select', id: special ? undefined : list.id, paths: matched.map(function (file) { return file.path }), checked: event.currentTarget.checked }) } }),
            h('button', { key: 'name', type: 'button', className: 'dshgit-name dshgit-cl-toggle', title: list.description || label, 'aria-expanded': !!open, disabled: busy, onClick: toggle }, label),
            data.active === list.id ? h('span', { key: 'active', className: 'dshgit-cl-active', title: t('cl.activeHint'), 'aria-label': t('cl.activeHint') }, '●') : null,
            h('span', { key: 'count', className: 'dshgit-cl-count' }, query ? matched.length + '/' + entries.length : entries.length),
            !special ? h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn dshgit-cl-more', title: t('menu.actions'), 'aria-label': t('menu.actions'), onClick: menu }, h(IconMore, { size: 14 })) : null,
          ]),
          open ? h(ChangelistFiles, { key: 'files', listId: special ? undefined : list.id, layout: data.fileLayout || 'tree', filterKey: query, files: matched, busy: busy, checked: choice.checked, mixed: choice.mixed, multi: multi[0], selection: props.selection,
            onMenu: function (event, file) { fileMenu(event, file, special ? undefined : list.id) }, onCheck: function (paths, checked) { act({ action: 'select', id: special ? undefined : list.id, paths: paths, checked: checked }) },
            onOpenFile: function (file) { props.onOpenFile(file, 'diff', 'working') },
            onSelect: function (file, event, visiblePaths) {
              if (event.shiftKey && anchor.current) {
                var ordered = visiblePaths || matched.map(function (entry) { return entry.path }), start = ordered.indexOf(anchor.current), end = ordered.indexOf(file.path)
                if (start >= 0 && end >= 0) multi[1](ordered.slice(Math.min(start, end), Math.max(start, end) + 1))
              } else if (event.ctrlKey || event.metaKey) multi[1](multi[0].includes(file.path) ? multi[0].filter(function (path) { return path !== file.path }) : multi[0].concat(file.path))
              else { multi[1]([file.path]); props.onOpenFile(file, 'diff', 'working') }
              anchor.current = file.path
            },
          }) : null,
        ])
      }
      return h('div', { className: 'dshgit-cl-pane', onContextMenu: function (event) {
        if (event.defaultPrevented || event.target?.closest?.('.dshgit-cl-head,.dshgit-row,input,button,select,.dshgit-cl-error')) return
        props.showMenu(event, [{ id: 'new-list', label: t('cl.create'), disabled: busy, run: function () { create() } }], { compact: true })
      } }, [
        props.hideToolbar ? null : h(ChangelistModeToolbar, { key: 'tools', changelists: model, t: t, busy: busy, showMenu: props.showMenu, onCreate: function () { create() } }),
        model.error ? h('div', { key: 'error', className: 'dshgit-cl-error', role: 'alert' }, [model.error, h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))]) : null,
        h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('cl.search'), 'aria-label': t('cl.search'), onChange: function (event) { search[1](event.currentTarget.value) } }), h(ChangelistLayoutSwitch, { key: 'layout', changelists: model, t: t, busy: busy })]),
        files.some(function (file) { return file.kind === 'unmerged' }) ? group({ id: 'conflicts', expanded: true }, files.filter(function (file) { return file.kind === 'unmerged' }), 'cl.conflicts') : null,
        data.lists.map(function (list) { return group(list, files.filter(function (file) { return file.kind !== 'unmerged' && changelistHasFile(data, list.id, file.path) })) }),
        files.some(function (file) { return !data.assignments[file.path] && file.kind !== 'unmerged' }) ? group({ id: 'untracked', expanded: true }, files.filter(function (file) { return !data.assignments[file.path] && file.kind !== 'unmerged' }), 'cl.untracked') : null,
        query && !files.some(function (file) { return file.path.toLowerCase().includes(query) }) ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('list.noMatches')) : null,
      ])
    }

    /* ------------------------------------------------------------------ *
     * Changes sidebar: staged and unstaged files
     * ------------------------------------------------------------------ */

    /** Render the current working tree and its file actions. */
    function LeftPane(props) {
      var t = props.t
      var searchState = React.useState('')
      var query = searchState[0].trim().toLowerCase()
      var layout = props.changelists?.data?.fileLayout || 'tree'
      var files = props.status === null ? [] : props.status.files || []
      var staged = files.filter(isStaged)
      var unstaged = files.filter(isUnstaged)
      var confirmWrite = function (message, method, payload) {
        props.requestConfirm(t(message), function () {
          props.onWrite(method, payload, { confirm: true, after: props.afterWrite })
        })
      }
      var fileRow = function (file, section, style) {
        var selected = props.selection !== null && props.selection.kind === 'file' &&
          props.selection.path === file.path && props.selection.section === section
        var open = function () { props.onOpenFile(file, 'diff', section) }
        return h('div', {
          key: section + ':' + file.path,
          className: 'dshgit-row dshgit-change' + (isPartial(file) ? ' dshgit-partial' : ''),
          style: style,
          'data-selected': selected, 'data-status': statusLetter(file),
          tabIndex: 0, role: 'button', 'aria-pressed': selected,
          onClick: open,
          onKeyDown: function (event) {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
          },
          onContextMenu: function (event) { props.onFileContextMenu(event, file, section) },
          title: file.originalPath ? file.originalPath + ' → ' + file.path : file.path,
        }, changeFileLabel(layout === 'flat' ? file.path : baseName(file.path)).concat([
          h(ChangeRowActions, {
            key: 'actions', t: t, section: section, busy: props.busy, simple: true,
            onToggleStage: function () {
              props.onWrite(section === 'staged' ? 'unstage' : 'stage',
                { paths: [file.path] }, { after: props.afterWrite })
            },
          }),
          h('span', { key: 'status', className: 'dshgit-status' }, statusLetter(file)),
        ]))
      }
      var group = function (section, entries) {
        if (entries.length === 0) return null
        var isIndex = section === 'staged'
        var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 })
        if (matched.length === 0) return null
        return h(ChangeGroup, {
          key: section, kind: section, title: t(isIndex ? 'commit.stagedSection' : 'commit.unstagedSection'),
          count: query ? matched.length + '/' + entries.length : entries.length, busy: props.busy, simple: true, t: t,
          actions: [
            { key: isIndex ? 'unstage' : 'stage', text: true,
              label: t(isIndex ? 'action.unstageAll' : 'action.stageAll'), run: function () {
                props.onWrite(isIndex ? 'unstage' : 'stage', {}, { after: props.afterWrite })
              } },
            { key: 'more', text: true, label: '···', run: function (event) {
              var items = [{ id: 'stash', label: t(isIndex ? 'action.stashStaged' : 'action.stashUnstaged'),
                disabled: props.busy, run: function () {
                  props.onWrite('stashPush', isIndex ? { stagedOnly: true } : {
                    keepIndex: true, includeUntracked: entries.some(function (file) { return file.kind === 'untracked' }),
                  }, { after: props.afterWrite })
                } }]
              if (!isIndex) {
                items.push({ id: 'discard', label: t('action.discardUnstaged'), danger: true, disabled: props.busy,
                  run: function () { confirmWrite('confirm.discardUnstaged', 'discardAll', {}) } })
                if (entries.some(function (file) { return file.kind === 'untracked' })) {
                  items.push({ id: 'clean', label: t('action.cleanUntracked'), danger: true, disabled: props.busy,
                    run: function () { confirmWrite('confirm.clean', 'clean', { directories: true }) } })
                }
              }
              props.showMenu(event, items)
            } },
          ],
        }, h(ChangelistFiles, { files: matched, listId: section, layout: layout, filterKey: query, busy: props.busy,
          renderFile: function (file, style) { return fileRow(file, section, style) },
        }))
      }
      return h('div', { className: 'dshgit-changes-list' }, [
        props.changelists && !props.hideToolbar ? h(ChangelistModeToolbar, { key: 'lists-mode', changelists: props.changelists, t: t, busy: props.busy, showMenu: props.showMenu }) : null,
      ].concat(files.length === 0
        ? [h('div', { className: 'dshgit-empty' }, t(props.status === null ? 'state.loading' : 'state.noChanges'))]
        : [h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input',
          placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'), value: searchState[0],
          onChange: function (event) { searchState[1](event.currentTarget.value) },
        }), props.changelists ? h(ChangelistLayoutSwitch, { key: 'layout', changelists: props.changelists, t: t, busy: props.busy }) : null]), group('unstaged', unstaged), group('staged', staged),
          query && !files.some(function (file) { return file.path.toLowerCase().indexOf(query) !== -1 })
            ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('list.noMatches')) : null]))
    }

    function fileDiffStats(file) {
      if (typeof file.added === 'number' && typeof file.deleted === 'number') return { added: file.added, deleted: file.deleted }
      if (!Array.isArray(file.hunks)) return null
      var added = 0, deleted = 0
      file.hunks.forEach(function (hunk) { (hunk.lines || []).forEach(function (line) {
        if (line.charAt(0) === '+') added++
        else if (line.charAt(0) === '-') deleted++
      }) })
      return { added: added, deleted: deleted }
    }
    function DiffStats(props) {
      var counts = fileDiffStats(props.file)
      return counts === null ? null : h('span', { className: 'dshgit-diffstats' }, [
        h('span', { key: 'added', className: 'dshgit-diff-added' }, '+' + counts.added),
        h('span', { key: 'deleted', className: 'dshgit-diff-deleted' }, '−' + counts.deleted),
      ])
    }

    /** File header with an adjacent copy icon and line counts. */
    function FileDiffCard(props) {
      var copyState = React.useState(null)
      var file = props.file, t = props.t
      return h('div', { className: 'dshgit-filediff', 'data-diff-file': file.path }, [
        h('div', { key: 'head', className: 'dshgit-filediff-head',
          onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, file) } : undefined,
        }, [
          h('span', { key: 'pathcopy', className: 'dshgit-diff-pathcopy' }, [
            h('span', { key: 'path', className: 'dshgit-previewpath', title: file.path }, file.path),
            h('button', { key: 'copy', type: 'button', className: 'dshgit-iconbtn',
              'data-diff-action': 'copy', title: t('diff.copyPath'), 'aria-label': t('diff.copyPath'),
              onClick: function () { Promise.resolve().then(function () { return navigator.clipboard.writeText(file.path) })
                .then(function () { copyState[1]('diff.copied') }).catch(function () { copyState[1]('diff.copyFailed') }) },
            }, h(IconCopyPath, { size: 16 })),
          ]),
          copyState[0] ? h('span', { key: 'copy-result', role: 'status', className: 'dshgit-muted' }, t(copyState[0])) : null,
          h(DiffStats, { key: 'stats', file: file }),
        ]),
        props.tools || null,
        h('div', { key: 'body', className: 'dshgit-filediff-body' }, props.children || [
          file.from ? h('div', { key: 'from', className: 'dshgit-muted' }, '← ' + file.from) : null,
          h(DiffBody, { key: 'diff', path: file.path, hunks: file.hunks, emptyText: file.binary ? t('state.fileBinary') : t('state.emptyDiff') }),
        ]),
      ])
    }

    /** Load only the selected file, ignoring results after selection changes. */
    function LazyStashFile(props) {
      var valueState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
      React.useEffect(function () {
        var active = true
        errorState[1](null)
        props.loadFile(props.file).then(function (value) { if (active) valueState[1](value) })
          .catch(function (failure) { if (active) errorState[1](failure.message) })
        return function () { active = false }
      }, [props.file.path, props.loadFile, retryState[0]])
      var patch = (valueState[0]?.files || []).find(function (file) { return file.path === props.file.path })
      return h(FileDiffCard, { file: Object.assign({}, props.file, patch || {}), onFileMenu: props.onFileMenu, t: props.t },
        errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
          h('span', { key: 'error' }, errorState[0]),
          h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () {
            props.clearFile(props.file.path); retryState[1](retryState[0] + 1)
          } }, props.t('stash.retry')),
        ]) : valueState[0] === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
          : h(DiffBody, { path: props.file.path, hunks: patch?.hunks || [], emptyText: props.file.binary ? props.t('state.fileBinary') : props.t('state.emptyDiff') }))
    }

    function StashFileNavigation(props) {
      var modeState = React.useState('tree')
      var row = function (file) {
        return h('button', { key: file.path, type: 'button', className: 'dshgit-row dshgit-rowbtn',
          'data-stash-file': file.path, 'data-selected': props.selected === file.path, 'aria-pressed': props.selected === file.path,
          title: file.path, onClick: function () { props.onSelect(file.path) },
          onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, file) } : undefined,
        }, changeFileLabel(modeState[0] === 'tree' ? file.path.split('/').pop() : file.path).concat([
          h(DiffStats, { key: 'stats', file: file }),
        ]))
      }
      var tree = { children: {}, files: [] }
      props.files.forEach(function (file) {
        var parts = file.path.split('/'), current = tree
        parts.slice(0, -1).forEach(function (name) {
          if (!current.children[name]) current.children[name] = { children: {}, files: [] }
          current = current.children[name]
        })
        current.files.push(file)
      })
      var folder = function (node) {
        return Object.keys(node.children).sort().map(function (name) {
          return h('details', { key: name, open: true, className: 'dshgit-filefolder' }, [
            h('summary', { key: 'name' }, name),
            h('div', { key: 'children' }, folder(node.children[name])),
          ])
        }).concat(node.files.map(row))
      }
      // The toggle is built once and placed either beside the caller's search box
      // (the normal case) or alone, so the two arrangements cannot drift apart.
      var toggle = h('div', { key: 'switch', className: 'dshgit-fileview-switch' }, ['list', 'tree'].map(function (mode) {
        return h('button', { key: mode, type: 'button', className: 'dshgit-iconbtn', 'data-file-view': mode,
          'aria-pressed': modeState[0] === mode, title: props.t(mode === 'tree' ? 'diff.fileTree' : 'diff.fileList'),
          'aria-label': props.t(mode === 'tree' ? 'diff.fileTree' : 'diff.fileList'), onClick: function () { modeState[1](mode) },
        }, mode === 'tree' ? h(IconFileTree, { size: 16 }) : h(IconFileList, { size: 16 }))
      }))
      return h(Fragment, null, [
        props.search === undefined
          ? toggle
          : h('div', { key: 'searchrow', className: 'dshgit-stash-searchrow' }, [props.search, toggle]),
        h('div', { key: 'files', className: 'dshgit-stash-filelist' }, modeState[0] === 'tree' ? folder(tree) : props.files.map(row)),
      ])
    }

    /** The stash list is separate from the working tree and commit history. */
    function StashesSidebar(props) {
      var t = props.t
      var searchState = React.useState('')
      var limitState = React.useState(100)
      var query = searchState[0].trim().toLowerCase()
      var matched = (props.stashes || []).filter(function (stash) { return !query ||
        (stash.ref + ' ' + stash.message).toLowerCase().indexOf(query) !== -1 })
      return h(Fragment, null, [
        h('div', { key: 'create', className: 'dshgit-sidebar-search' },
          h('button', { type: 'button', className: 'dshgit-btn', disabled: props.busy || !props.canCreate,
            onClick: props.onCreate,
          }, t('stash.create'))),
        h('div', { key: 'search', className: 'dshgit-sidebar-search' }, h('input', { type: 'search', className: 'dshgit-input',
          'aria-label': t('list.searchStashes'), placeholder: t('list.searchStashes'), value: searchState[0],
          onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
        })),
        props.error ? h('div', { key: 'error', className: 'dshgit-sidebar-hint', role: 'alert' }, [
          h('div', { key: 'message' }, t('stash.loadFailed', { message: props.error })),
          h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', disabled: props.busy,
            onClick: props.onRetry,
          }, t('stash.retry')),
        ]) : props.stashes === null ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
          : props.stashes.length === 0 ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noStashes'))
          : h('div', { key: 'list', className: 'dshgit-stash-list' }, matched.slice(0, limitState[0]).map(function (stash) {
              var branch = /^(?:WIP on|On) (.+?):/.exec(stash.message || '')
              var description = branch ? stash.message.slice(branch[0].length).trim() : stash.message
              return h('div', { key: stash.sha || stash.ref, className: 'dshgit-stash-item' }, [
                h('button', { key: 'select', type: 'button', className: 'dshgit-stash-row',
                  'data-stash-ref': stash.ref, 'aria-pressed': props.selected === (stash.sha || stash.ref),
                  title: stash.message + '\n' + stash.ref + ' · ' + formatTime(stash.date), onClick: function () { props.onSelect(stash) },
                }, [
                  h('span', { key: 'message', className: 'dshgit-name' }, description || stash.message || stash.ref),
                ]),
                h('div', { key: 'footer', className: 'dshgit-stash-footer' }, [
                h('button', { key: 'meta', type: 'button', className: 'dshgit-stash-meta', tabIndex: -1,
                  title: stash.ref + (branch ? ' · ' + branch[1] : '') + '\n' + formatTime(stash.date),
                  onClick: function () { props.onSelect(stash) },
                }, (branch ? branch[1] + ' · ' : '') + formatRelative(stash.date)),
                h('div', { key: 'actions', className: 'dshgit-stash-row-actions', role: 'group',
                  'aria-label': t('menu.actions') + ' · ' + stash.ref,
                }, ['apply', 'pop', 'drop'].map(function (action) {
                  var loading = props.busyAction?.id === (stash.sha || stash.ref) && props.busyAction.action === action
                  var label = t(action === 'apply' ? 'action.stashApply' : action === 'pop' ? 'action.stashPop' : 'action.stashDrop')
                  var hint = t(action === 'apply' ? 'stash.applyHint' : action === 'pop' ? 'stash.popHint' : 'stash.dropHint')
                  var Icon = action === 'apply' ? IconStashApply : action === 'pop' ? IconStashPop : IconTrash
                  return h('button', { key: action, type: 'button', className: 'dshgit-stash-row-action',
                    'data-stash-action': action, 'data-stash-target': stash.sha || stash.ref,
                    disabled: props.busy, 'aria-busy': loading, title: label + '\n' + hint, 'aria-label': label,
                    onClick: function () { if (action === 'drop') props.onDrop(stash); else props.onApply(stash, action === 'pop') },
                  }, loading ? h('span', { key: 'spinner', className: 'dshgit-spinner', 'aria-hidden': true }) : h(Icon, { size: 16, 'aria-hidden': true }))
                })),
                ]),
              ])
            }).concat(matched.length > limitState[0] ? [h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
              onClick: function () { limitState[1](limitState[0] + 100) },
            }, t('action.loadMore') + ' (' + limitState[0] + '/' + matched.length + ')')] : [])),
        props.stashes !== null && props.stashes.length > 0 && matched.length === 0
          ? h('div', { key: 'no-matches', className: 'dshgit-empty' }, t('list.noMatches')) : null,
      ])
    }

    /** Review all saved files, including untracked files, before restoring them. */
    function StashDetails(props) {
      var t = props.t
      var filesState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
      var searchState = React.useState(''), limitState = React.useState(100), pathState = React.useState(null)
      var bucketRef = React.useRef(null)
      React.useEffect(function () {
        if (props.stash === null) return
        var active = true
        var bucket = { cache: new Map(), queue: [], active: 0, closed: false, legacy: null, fallback: null }
        bucketRef.current = bucket
        filesState[1](null); errorState[1](null)
        props.run('stashDiff', { root: props.repo.root, ref: props.stash.ref, expectedSha: props.stash.sha, summaryOnly: true },
          { silent: true, silentError: true }).then(function (value) {
            if (!active) return
            if (typeof value.text === 'string' || Array.isArray(value.hunks)) bucket.legacy = value
            var files = value.files || []
            filesState[1](files)
            pathState[1](function (current) { return files.some(function (file) { return file.path === current }) ? current : files[0]?.path || null })
          }).catch(function (failure) { if (active) errorState[1](failure.message) })
        return function () {
          active = false; bucket.closed = true
          bucket.queue.splice(0).forEach(function (job) { job.reject(new Error('Cancelled')) })
        }
      }, [props.repo.root, props.stash?.sha, props.stash?.ref, retryState[0], props.run])
      var loadFile = React.useCallback(function (file) {
        var bucket = bucketRef.current
        if (!bucket || bucket.closed) return Promise.reject(new Error('Cancelled'))
        if (bucket.cache.has(file.path)) return bucket.cache.get(file.path)
        var payload = { root: props.repo.root, ref: props.stash.ref, expectedSha: props.stash.sha }
        var read = function () {
          if (bucket.legacy) return Promise.resolve(bucket.legacy)
          if (bucket.fallback) return bucket.fallback
          return props.run('stashDiff', Object.assign({ path: file.path, originalPath: file.from || undefined }, payload), { silent: true, silentError: true })
            .catch(function (failure) {
              if (!/Too many revisions specified/i.test(failure.message || '')) throw failure
              if (!bucket.fallback) bucket.fallback = props.run('stashDiff', payload, { silent: true, silentError: true })
                .then(function (value) { bucket.legacy = value; return value })
                .catch(function (error) { bucket.fallback = null; throw error })
              return bucket.fallback
            })
        }
        var pump = function () {
          while (!bucket.closed && bucket.active < 3 && bucket.queue.length) {
            var job = bucket.queue.shift()
            bucket.active++
            Promise.resolve().then(job.read).then(job.resolve, job.reject).finally(function () {
              bucket.active--
              while (bucket.cache.size > 64) bucket.cache.delete(bucket.cache.keys().next().value)
              pump()
            })
          }
        }
        var promise = new Promise(function (resolve, reject) { bucket.queue.push({ read: read, resolve: resolve, reject: reject }) })
        bucket.cache.set(file.path, promise); pump()
        return promise
      }, [props.repo.root, props.stash?.sha, props.stash?.ref, props.run, filesState[0]])
      if (props.stash === null) return h('div', { className: 'dshgit-empty' }, t('stash.select'))
      var files = filesState[0] || [], query = searchState[0].trim().toLowerCase()
      var matched = files.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 })
      var visible = matched.slice(0, limitState[0])
      var totals = { added: 0, deleted: 0 }, known = true
      files.forEach(function (file) { var stats = fileDiffStats(file)
        if (stats) { totals.added += stats.added; totals.deleted += stats.deleted }
        else if (!file.binary) known = false
      })
      var selectedFile = files.find(function (file) { return file.path === pathState[0] }) || null
      var select = function (path) { pathState[1](path) }
      return h('div', { className: 'dshgit-stash-details' }, [
        h('div', { key: 'header', className: 'dshgit-card' }, [
          h('div', { key: 'title', className: 'dshgit-name' }, props.stash.ref + ' · ' + props.stash.message),
          h('div', { key: 'date', className: 'dshgit-muted' }, formatTime(props.stash.date)),
        ]),
        h('div', { key: 'body', className: 'dshgit-stash-detailbody' }, [
          h('div', { key: 'nav', className: 'dshgit-stash-filenav' }, [
            h('div', { key: 'count', className: 'dshgit-sidebar-head' }, t('stash.allFiles') + ' (' + files.length + ')'),
            h(StashFileNavigation, { key: 'navigation', files: visible, selected: pathState[0], onSelect: select, onFileMenu: props.onFileMenu, t: t,
              search: h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: searchState[0],
                placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'),
                onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
              }) }),
            matched.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
              onClick: function () { limitState[1](limitState[0] + 100) },
            }, t('action.loadMore') + ' (' + visible.length + '/' + matched.length + ')') : null,
          ]),
          h('div', { key: 'preview', className: 'dshgit-stash-preview' }, [
            h('div', { key: 'tools', className: 'dshgit-stash-previewtools' }, [
              h('span', { key: 'count', className: 'dshgit-muted', style: { marginRight: 'auto' } }, t('stash.allFiles') + ' (' + files.length + ')'),
              known && files.length ? h(DiffStats, { key: 'stats', file: totals }) : null,
            ]),
            h('div', { key: 'diffs', className: 'dshgit-stash-diff' },
              errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
                h('span', { key: 'message' }, t('stash.loadFailed', { message: errorState[0] })),
                h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, t('stash.retry')),
              ]) : filesState[0] === null ? h('div', { className: 'dshgit-empty' }, t('state.loading'))
                : selectedFile === null ? h('div', { className: 'dshgit-empty' }, t(files.length ? 'stash.select' : 'state.emptyDiff'))
                  : h(LazyStashFile, { key: selectedFile.path, file: selectedFile, loadFile: loadFile, onFileMenu: props.onFileMenu,
                    clearFile: function (path) { bucketRef.current?.cache.delete(path) }, t: t,
                  })),
          ]),
        ]),
      ])
    }

    /** Ask before a destructive discard, showing exactly which path. */
    function setDiscardTarget(file, props) {
      // The message names the path and the untracked case, because "discard
      // changes?" with no filename is how people lose work — and undoing an
      // untracked file is impossible, unlike a tracked one restored from git.
      var message = props.t('confirm.discard', { path: file.path })
      if (file.kind === 'untracked') message += '（未跟踪的新文件，删除后无法恢复）'
      props.requestConfirm(message, function () {
        props.onWrite('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, {
          after: props.afterWrite,
          confirm: true,
        })
      })
    }

    /* ------------------------------------------------------------------ *
     * The header chips, the workbench window, and the launcher
     * ------------------------------------------------------------------ */

    /**
     * One header chip that opens a popover.
     *
     * The popover is portaled to `document.body` rather than positioned inside
     * the chip: the session header is a flex row inside a clipping, scrolling
     * shell, and an absolutely positioned panel inside it gets cut off or
     * scrolls away. The portal is the same mechanism the file browser already
     * uses, and it is what lets the panel be wider than the chip.
     *
     * @param props - `{ label, title, tone, active, anchor, onOpen, onClose, children, t }`.
     */
    function ChipPopover(props) {
      var panelRef = React.useRef(null)
      var sizeState = React.useState(0)
      var setSize = sizeState[1]
      useDialogFocus(panelRef, props.onClose, { opener: props.opener })
      React.useEffect(function () {
        var resize = function () { setSize(function (n) { return n + 1 }) }
        window.addEventListener?.('resize', resize)
        return function () {
          window.removeEventListener?.('resize', resize)
        }
      }, [])
      var anchor = props.opener?.isConnected !== false && props.opener?.getBoundingClientRect
        ? props.opener.getBoundingClientRect() : props.anchor
      if (anchor === null || anchor === undefined) return null
      var width = props.width === undefined ? 380 : props.width
      var viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
      var viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 900
      width = Math.min(width, Math.max(0, viewportWidth - 16))
      // Right-align to the chip and keep the panel on screen: the chip cluster
      // sits at the right edge, so a left-aligned panel would run off it.
      var left = Math.max(8, Math.min(anchor.right - width, viewportWidth - width - 8))
      var top = Math.max(8, Math.min(anchor.bottom + 6, viewportHeight - 80))
      return ReactDOM.createPortal(
        h(Fragment, null, [
          // A full-viewport catcher, so a click anywhere outside closes the
          // popover without a document-level listener racing React's own events.
          h('div', {
            key: 'scrim',
            className: 'dshgit-scrim',
            onClick: props.onClose,
            onContextMenu: function (event) { event.preventDefault(); props.onClose() },
          }),
          h('div', {
            key: 'panel',
            ref: panelRef,
            tabIndex: -1,
            className: 'dshgit-popover',
            role: 'dialog',
            'aria-label': props.title,
            'data-popover': props.kind,
            style: { left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: Math.max(0, Math.min(560, viewportHeight - top - 8)) + 'px', boxSizing: 'border-box', overflow: 'hidden' },
          }, props.children),
        ]),
        document.body,
      )
    }

    /**
     * The session-header Git status chips.
     *
     * Everyday actions in a stable order: branch, changes, merge, remote action,
     * and a small menu for alternate pull/push forms.
     *
     * This is a session-scoped slot, so it is also the only place that knows
     * `sessionId` — which is why the whole cluster lives here and publishes the
     * id into the window store for the root-scoped overlay.
     *
     * @param props - `{ connection, sessionId, t }`.
     */
    function GitStatusChips(props) {
      var t = props.t
      var connection = props.connection

      var repoState = React.useState(null)
      var repo = repoState[0]
      var setRepo = repoState[1]
      var statusState = React.useState(null)
      var status = statusState[0]
      var setStatus = statusState[1]
      var refsState = React.useState(null)
      var refs = refsState[0]
      var setRefs = refsState[1]
      var trackingState = React.useState(null)
      var tracking = trackingState[0]
      var setTracking = trackingState[1]
      var readyState = React.useState(false)
      var ready = readyState[0]
      var setReady = readyState[1]
      var readErrorState = React.useState(null)
      var readError = readErrorState[0]
      var setReadError = readErrorState[1]
      var refreshingState = React.useState(false)
      var refreshing = refreshingState[0]
      var setRefreshing = refreshingState[1]
      var missingState = React.useState(false)
      var gitMissing = missingState[0]
      var setGitMissing = missingState[1]
      var canInitState = React.useState(false)
      var canInit = canInitState[0]
      var setCanInit = canInitState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var busyMethodState = React.useState(null)
      var busyMethod = busyMethodState[0]
      var setBusyMethod = busyMethodState[1]
      var writeRef = React.useRef(false)
      var contextRef = React.useRef(props.sessionId)
      var contextEpochRef = React.useRef(0)
      if (contextRef.current !== props.sessionId) contextEpochRef.current++
      contextRef.current = props.sessionId
      var refreshRef = React.useRef(null)
      var refreshQueuedRef = React.useRef(false)
      var refreshLatestRef = React.useRef(null)
      /**
       * The last action's outcome, or null.
       *
       * `{ id, tone, summary, hint, detail, action }`. `id` is a sequence number
       * so the auto-dismiss effect restarts on every new outcome instead of
       * inheriting the previous one's timer.
       */
      var noticeState = React.useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]
      // Whether the raw git text is expanded in the banner.
      var noticeOpenState = React.useState(false)
      var noticeOpen = noticeOpenState[0]
      var setNoticeOpen = noticeOpenState[1]

      /** Show a successful outcome: one line, auto-dismissed. */
      var succeed = React.useCallback(function (summary, detail) {
        setNotice({ id: Date.now(), tone: 'success', summary: summary, hint: null, detail: detail || null, action: null })
        setNoticeOpen(false)
      }, [])

      /**
       * Show a failure: a plain-language line, the fix when it is knowable, and
       * git's own words kept behind a disclosure.
       *
       * The SUMMARY is the plugin's own explanation when it recognises the
       * failure, and git's most useful line otherwise. It must never be both —
       * showing `error: failed to push some refs` above "the remote has commits
       * you have not fetched" says the same thing twice in two vocabularies and
       * buries the actionable half.
       */
      var fail = React.useCallback(function (message, method) {
        var explained = explainFailure(message, method, t)
        var fallback = firstMeaningfulLine(explained.text)
        setNotice({
          id: Date.now(),
          tone: 'error',
          summary: explained.hint === null ? fallback : explained.hint,
          hint: null,
          detail: explained.text,
          action: explained.action,
        })
        setNoticeOpen(false)
      }, [t])

      /**
       * Auto-dismiss a SUCCESS, but never an error.
       *
       * A success is confirmation of something the user just watched happen, so
       * it can fade. An error is information they have not acted on yet, and a
       * failure that vanishes unread is one they will simply hit again — so an
       * error stays until dismissed. Keyed on `notice.id` so each new outcome
       * gets its own timer rather than inheriting the previous one's.
       */
      React.useEffect(
        function () {
          if (notice === null || notice.tone !== 'success') return undefined
          var timer = setTimeout(function () { setNotice(null) }, 4200)
          return function () { clearTimeout(timer) }
        },
        [notice === null ? null : notice.id],
      )
      // Which popover is open, and the chip's measured box to anchor it to.
      var popoverState = React.useState(null)
      var popover = popoverState[0]
      var setPopover = popoverState[1]
      var anchorState = React.useState(null)
      var anchor = anchorState[0]
      var setAnchor = anchorState[1]
      var openerRef = React.useRef(null)
      // Whether the in-progress-operation panel is expanded. It is not a popover
      // because it must stay visible while the user reads the conflicted files,
      // and an outside click must not dismiss the way out of a stuck state.
      var opOpenState = React.useState(false)
      var opOpen = opOpenState[0]
      var setOpOpen = opOpenState[1]
      // The merge-vs-rebase question, shown only when a fast-forward pull refused.
      var pullChoiceState = React.useState(false)
      var pullChoice = pullChoiceState[0]
      var setPullChoice = pullChoiceState[1]
      // The commit box's own state, so it survives a popover close/reopen.
      var messageState = React.useState('')
      var message = messageState[0]
      var setMessage = messageState[1]
      var messageLatestRef = React.useRef(message)
      messageLatestRef.current = message
      var aiBusyState = React.useState(false)
      var aiBusy = aiBusyState[0]
      var setAiBusy = aiBusyState[1]
      var aiRequestRef = React.useRef(0)
      var aiRunningRef = React.useRef(false)
      var aiState = React.useState(null)
      var aiNotice = aiState[0]
      var setAiNotice = aiState[1]
      var pickerQueryState = React.useState('')
      var pickerQuery = pickerQueryState[0]
      var setPickerQuery = pickerQueryState[1]
      var confirmState = React.useState(null)
      var confirmRequest = confirmState[0]
      var setConfirmRequest = confirmState[1]
      var promptState = React.useState(null)
      var promptRequest = promptState[0]
      var setPromptRequest = promptState[1]
      var headerWorkbenchState = React.useState(null)
      var remoteRequest = React.useState(null)
      React.useEffect(function () { remoteRequest[1](null) }, [repo?.root, props.sessionId])
      // The file viewer: which path is open, or null when it is closed. It is
      // deliberately OUTSIDE the popover that launched it — reading a file means
      // the popover may close behind it, and the viewer must survive that.
      var viewerState = React.useState(null)
      var viewerPath = viewerState[0]
      var setViewerPath = viewerState[1]
      var mergeSourceState = React.useState(null)
      var mergeSource = mergeSourceState[0]
      var setMergeSource = mergeSourceState[1]
      var mergePreviewState = React.useState(null)
      var mergePreview = mergePreviewState[0]
      var setMergePreview = mergePreviewState[1]
      var mergeErrorState = React.useState(null)
      var mergeError = mergeErrorState[0]
      var setMergeError = mergeErrorState[1]
      var mergeTargetState = React.useState(null), mergeTarget = mergeTargetState[0]
      var mergeFetchState = React.useState(false), mergeRetryState = React.useState(0)
      var setMergeFetchState = mergeFetchState[1]
      var mergeReviewRequestRef = React.useRef(0)

      /** One RPC call, unwrapped, with errors surfaced in the popover. */
      var call = React.useCallback(function (method, payload) {
        // The chips know the session they were rendered for as a PROP, so they
        // state it instead of letting `callRpc` read the window store. The store
        // is published by the parent cluster from an effect, and React runs this
        // component's effects first — reading it here would target the session
        // the user just left.
        return callRpc(connection, method, withExplicitSession(payload, props.sessionId), undefined)
      }, [connection, props.sessionId])

      var headerChangelists = useChangelists(repo, status, call)

      React.useEffect(function () {
        if (mergeSource === null || repo === null) return
        var active = true
        var request = ++mergeReviewRequestRef.current
        setMergePreview(null)
        setMergeError(null)
        var target = mergeTarget || mergeSource
        setMergeFetchState(false)
        Promise.all([
          call('commits', { root: repo.root, ref: 'HEAD..' + target, limit: 20 }),
          call('commits', { root: repo.root, ref: target + '..HEAD', limit: 20 }),
        ]).then(function (values) {
          if (!active || request !== mergeReviewRequestRef.current) return
          setMergePreview({ incoming: values[0].commits || [], outgoing: values[1].commits || [] })
        }).catch(function (failure) {
          if (active && request === mergeReviewRequestRef.current) setMergeError(failure.message)
        })
        return function () { active = false; mergeReviewRequestRef.current++ }
      }, [call, repo === null ? null : repo.root, mergeSource, mergeTarget, mergeRetryState[0]])

      /**
       * Load discovery, status, refs and tracking.
       *
       * @param options - `{ force }` bypasses the Host's caches; `session`
       *   re-resolves from the session instead of naming the current repository,
       *   which is what makes a conversation switch actually switch.
       */
      var refresh = React.useCallback(function (options) {
        var opts = options || {}
        var epoch = contextEpochRef.current
        if (refreshRef.current !== null && refreshRef.current.epoch === epoch) {
          if (opts.force) refreshQueuedRef.current = true
          return refreshRef.current.promise
        }
        var active = function () { return contextEpochRef.current === epoch }
        var request = { epoch: epoch, promise: null }
        refreshRef.current = request
        setRefreshing(true)
        request.promise = call('repos', repo !== null && opts.session !== true ? { path: repo.root } : {})
          .then(function (result) {
            if (!active()) return null
            setGitMissing(false)
            setReady(true)
            var list = result.repos || []
            setCanInit(result.canInitialize === true)
            if (list.length === 0) {
              setReadError(null)
              setRepo(null)
              setStatus(null)
              setRefs(null)
              setTracking(null)
              setWindowState({ workspace: result.directory || '' })
              return null
            }
            var next = list[0]
            if (repo !== null && opts.session !== true) {
              for (var i = 0; i < list.length; i++) if (list[i].root === repo.root) next = list[i]
            }
            setRepo(next)
            setWindowState({ workspace: next.root })
            return Promise.all([
              // A failed status read becomes a retry action in this toolbar,
              // rather than a second error banner beside the full window.
              call('status', { root: next.root, force: opts.force === true })
                .then(function (value) { if (active()) { setStatus(value); setReadError(null) } })
                .catch(function (failure) { if (active()) { setStatus(null); setReadError({ scope: 'status', message: failure.message }) } }),
              call('refs', { root: next.root, force: opts.force === true }).catch(function () { return null })
                .then(function (value) { if (active()) setRefs(value) }),
              call('branchTracking', { root: next.root }).catch(function () { return null })
                .then(function (value) { if (active()) setTracking(value) }),
            ])
          })
          .catch(function (failure) {
            if (!active()) return
            setGitMissing(failure.code === 'git/not-found')
            setReadError({ scope: 'repos', message: failure.message })
            setReady(true)
            setRepo(null)
            setStatus(null)
            setRefs(null)
            setTracking(null)
          })
          .finally(function () {
            if (refreshRef.current !== request) return
            refreshRef.current = null
            if (refreshQueuedRef.current && active()) {
              refreshQueuedRef.current = false
              return refreshLatestRef.current({ force: true })
            }
            if (active()) setRefreshing(false)
          })
        return request.promise
      }, [call, repo])
      refreshLatestRef.current = refresh
      React.useEffect(function () {
        var update = function () {
          if (document.visibilityState !== 'hidden') refreshLatestRef.current({ force: true })
        }
        window.addEventListener?.('focus', update)
        document.addEventListener('visibilitychange', update)
        return function () {
          window.removeEventListener?.('focus', update)
          document.removeEventListener('visibilitychange', update)
        }
      }, [])
      var lastRefreshToken = React.useRef(props.refreshToken)
      React.useEffect(function () {
        if (props.refreshToken === lastRefreshToken.current) return
        lastRefreshToken.current = props.refreshToken
        refresh({ force: true })
      }, [props.refreshToken])

      // First load, and again whenever the conversation changes: the chips show
      // THIS conversation's repository.
      var lastSessionRef = React.useRef(props.sessionId)
      React.useEffect(function () {
        refresh({ force: true })
      }, [])
      React.useEffect(function () {
        if (lastSessionRef.current === props.sessionId) return
        lastSessionRef.current = props.sessionId
        writeRef.current = false
        setBusy(false)
        setBusyMethod(null)
        aiRequestRef.current++
        aiRunningRef.current = false
        setAiBusy(false)
        refreshQueuedRef.current = false
        setReady(false)
        setReadError(null)
        setRepo(null)
        setStatus(null)
        setRefs(null)
        setTracking(null)
        setPopover(null)
        setConfirmRequest(null)
        setPromptRequest(null)
        headerWorkbenchState[1](null)
        setMergeSource(null)
        setMessage('')
        setNotice(null)
        setAiNotice(null)
        refresh({ force: true, session: true })
      }, [props.sessionId])

      /**
       * Whether a failed write is really "your branch diverged".
       *
       * Deliberately NOT a match on git's wording. The plugin already knows the
       * divergence from `status` (`ahead > 0 && behind > 0`), which is the same
       * fact git is reporting — reading it from state is stable across locales
       * and git versions, while `fatal: Not possible to fast-forward` is not.
       *
       * `--ff-only` is the only call that passes `onReject`, and it can only fail
       * this way when the branch has both local and remote commits.
       *
       * @param failure - the rejected error.
       * @returns whether to ask the merge-or-rebase question.
       */
      var looksDiverged = function (failure) {
        if (failure === null || failure === undefined) return false
        if (ahead > 0 && behind > 0) return true
        // Fallback for a state that changed between the status read and the pull
        // (another window committed): the phrase is stable because the exec layer
        // forces `LC_ALL=C`.
        return /not possible to fast-forward/i.test(String(failure.message || ''))
      }

      /**
       * React to a legitimate refusal.
       * @param kind - the follow-up to run.
       */
      var handleReject = function (kind) {
        if (kind === 'diverged') setPullChoice(true)
      }

      /**
       * Run a write, asking for confirmation when the Host demands one.
       *
       * @param method - the write method (without the `write.` prefix).
       * @param payload - its payload.
       * @param options - `{ confirm, after, onReject }`. `onReject` names a
       *   follow-up to run instead of showing an error, for the cases where a
       *   refusal is a legitimate answer rather than a failure — a refused
       *   fast-forward means the branch diverged, which is a question to ask, not
       *   an error to report.
       */
      var write = function (method, payload, options) {
        var opts = options || {}
        if (writeRef.current) return Promise.resolve(null)
        var body = Object.assign({}, payload)
        if (repo !== null) body.root = repo.root
        var epoch = contextEpochRef.current
        var active = function () { return contextEpochRef.current === epoch }
        var actionOpener = document.activeElement
        if (method === 'push' && !body.remote && !body.tags && body.forceWithLease !== true && !status?.branch?.upstream) body.setUpstream = true
        if (method === 'push' && body.setUpstream === true && !body.remote) {
          writeRef.current = true
          setBusy(true)
          setBusyMethod('push')
          return call('remotes', { root: body.root }).then(function (value) {
            if (!active()) return null
            writeRef.current = false
            setBusy(false)
            setBusyMethod(null)
            var remotes = Array.isArray(value) ? value : (value.remotes || [])
            if (remotes.length === 0) { closePopover(); remoteRequest[1]({ id: Date.now(), push: true, branch: body.sourceBranch || body.branch || status?.branch?.head }); return null }
            var publish = function (remote) {
              return write(method, Object.assign({}, body, { remote: remote, branch: status?.branch?.head }), opts)
            }
            if (remotes.length === 1) return publish(remotes[0].name)
            setPromptRequest({
              title: t('publish.remote'),
              fields: [{ key: 'remote', label: t('label.remote'), options: remotes.map(function (remote) { return { value: remote.name, label: remote.name } }) }],
              submit: function (values) { if (values.remote) publish(values.remote) },
            })
            return null
          }).catch(function (failure) {
            if (active()) { writeRef.current = false; setBusy(false); setBusyMethod(null); fail(failure.message, 'push') }
            return null
          })
        }
        // Avoid the obsolete history-rewrite prompt for ordinary pushes on
        // older Hosts, while keeping force-with-lease behind confirmation.
        if (method === 'push' && body.forceWithLease !== true) body.confirm = true
        if (opts.confirm === true) body.confirm = true
        writeRef.current = true
        setBusyMethod(method)
        setBusy(true)
        // A write usually names its `root`, in which case the session id is
        // irrelevant. When it does not — an init in a directory with no
        // repository yet — the explicit id still has to beat the stale store.
        return callRpc(connection, 'write.' + method, withExplicitSession(body, props.sessionId), undefined)
          .then(function (value) {
            if (!active()) return null
            // Success is a success: it gets the success tone, not the error red
            // the old single-purpose span painted everything with.
            succeed(value.message || t('action.ok'), value.stderr || null)
            if (value.recovery && repo && (value.recovery.backup || value.recovery.stash)) {
              writeWorkbenchStorage('recovery:' + repo.root, [Object.assign({ at: Date.now() }, value.recovery)].concat(readWorkbenchStorage('recovery:' + repo.root, [])).slice(0, 20))
              setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
            }
            if (method === 'fetch' && repo) writeWorkbenchStorage('fetch:' + repo.root, Date.now())
            if (opts.after !== undefined) {
              writeRef.current = false
              setBusy(false)
              setBusyMethod(null)
              opts.after()
            } else return refresh({ force: true }).then(function () {
              if (active()) { writeRef.current = false; setBusy(false); setBusyMethod(null) }
              return value
            })
            return value
          })
          .catch(function (failure) {
            if (!active()) return null
            writeRef.current = false
            setBusy(false)
            setBusyMethod(null)
            if (failure.code === 'git/needs-confirmation') {
              setConfirmRequest({
                message: failure.message,
                opener: actionOpener,
                label: method === 'push' ? t('action.pushForceLease') : method === 'checkout' ? t('action.switch') : t('action.apply'),
                onConfirm: function () {
                  setConfirmRequest(null)
                  write(method, payload, Object.assign({}, opts, { confirm: true }))
                },
              })
              return null
            }
            // A refused fast-forward is git answering a question, not failing:
            // the branch diverged, so ask which way to reconcile instead of
            // showing "Not possible to fast-forward" as an error.
            if (opts.onReject !== undefined && looksDiverged(failure)) {
              refresh({ force: true })
              handleReject(opts.onReject)
              return null
            }
            if (!opts.propagate) fail(failure.message, method)
            if (failure.details?.recovery && repo) {
              writeWorkbenchStorage('recovery:' + repo.root, [Object.assign({ at: Date.now() }, failure.details.recovery)].concat(readWorkbenchStorage('recovery:' + repo.root, [])).slice(0, 20))
              setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
            }
            if (method === 'merge') {
              setOpOpen(true)
              refresh({ force: true })
            }
            if (opts.propagate) { refresh({ force: true }); throw failure }
            return null
          })
      }

      /**
       * Open a popover, measuring the chip so the panel can anchor to it.
       *
       * @param kind - `'branch'` or `'commit'`.
       * @param event - the click event, whose target is the chip.
       */
      var openPopover = function (kind, event) {
        var node = event && event.currentTarget
        openerRef.current = node || document.activeElement
        var rect = node && typeof node.getBoundingClientRect === 'function'
          ? node.getBoundingClientRect()
          : { right: 420, bottom: 40 }
        setAnchor({ right: rect.right, bottom: rect.bottom })
        setPopover(popover === kind ? null : kind)
        if (notice?.tone === 'success') setNotice(null)
        setPickerQuery('')
        refresh({ force: true })
      }

      var closePopover = function () {
        setPopover(null)
        setConfirmRequest(null)
        // Deliberately NOT clearing the notice here. A write started from inside
        // a popover (a failed commit) must stay readable after that popover
        // closes; wiping it on close would hide the failure the user just hit.
      }

      /**
       * Switch to a local branch, after the destructive-change confirmation.
       *
       * `checkout` is destructive on the Host because it can discard uncommitted
       * work, so it always comes back as `needs-confirmation`; asking first is
       * where the user sees what is about to happen.
       *
       * @param name - the local branch.
       */
      var openHeaderWorkbench = function (action, subject) {
        closePopover()
        headerWorkbenchState[1]({ action: action, subject: subject, id: Date.now() })
      }
      var switchBranch = function (name) {
        closePopover()
        if (name === status?.branch?.head) return
        write('checkout', { ref: 'refs/heads/' + name, localBranch: true }, { confirm: true, after: function () {
          refresh({ force: true })
          var token = getWindowState().refreshToken + 1
          lastRefreshToken.current = token
          setWindowState({ refreshToken: token })
        } })
      }
      var chooseRemoteBranch = function (name) {
        var branch = (refs?.remotes || []).find(function (item) { return item.name === name })
        openHeaderWorkbench('checkout', branch || { name: name, ref: 'refs/remotes/' + name })
      }
      var openNewBranchDialog = function (from) {
        openHeaderWorkbench('createBranch', from && from !== 'HEAD' ? { ref: from } : null)
      }

      /** Ask the model for a commit message for the current staged changes. */
      var generateMessage = function () {
        if (aiRunningRef.current || writeRef.current) return
        aiRunningRef.current = true
        setAiBusy(true)
        var requestId = ++aiRequestRef.current
        var draft = messageLatestRef.current
        call('ai.commitMessage', { root: repo.root })
          .then(function (value) {
            if (requestId !== aiRequestRef.current) return
            if (value.available === false) { setAiNotice(value.message); return }
            if (value.empty === true) { setAiNotice(value.reason || t('commit.nothing')); return }
            if (messageLatestRef.current === draft) setMessage(value.message)
            setAiNotice(null)
          })
          .catch(function (failure) { if (requestId === aiRequestRef.current) setAiNotice(failure.message) })
          .finally(function () {
            if (requestId !== aiRequestRef.current) return
            aiRunningRef.current = false
            setAiBusy(false)
          })
      }

      /**
       * Continue an optional remote action only after the commit succeeds.
       *
       * The popover closes HERE, not when the button was pressed: the commit can
       * still fail (a pre-commit hook, a rejected sign-off, an empty tree), and
       * closing on the click would hide the error along with the panel that
       * reported it. Reaching this callback means the commit really landed, and
       * the change list it was built from is now empty — leaving it open would
       * show a stale list of files that are already committed.
       *
       * The follow-up push/pull keeps running after the close and reports
       * through the outcome banner, which lives outside the popover.
       */
      var afterCommit = function (mode) {
        aiRequestRef.current++
        aiRunningRef.current = false
        setAiBusy(false)
        setMessage('')
        closePopover()
        refresh({ force: true })
        setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
        if (mode === 'push') {
          write('push', status?.branch?.upstream ? {} : { setUpstream: true })
        } else if (mode === 'sync') {
          write('pull', { ffOnly: true }, { after: function () { write('push', {}) } })
        }
      }

      /** Respect the user's staged selection; stage all only when none is staged. */
      var commit = function (mode) {
        // These are pre-flight refusals the plugin itself decided, not git
        // failures: no raw output to disclose, no remote fix to offer.
        var refuse = function (summary) {
          setNotice({ id: Date.now(), tone: 'error', summary: summary, hint: null, detail: null, action: null })
          setNoticeOpen(false)
        }
        if (message.trim() === '') { refuse(t('commit.requiredMessage')); return }
        if (status === null) return
        var changed = status.files || []
        if (changed.length === 0) { refuse(t('commit.nothing')); return }
        if (changed.some(isStaged)) {
          write('commit', { message: message }, { after: function () { afterCommit(mode) } })
        } else stageAllAndCommit(mode)
      }

      /**
       * Stage everything, then commit the visible change list.
       *
       * Sequenced through the `after` callback rather than Promise chaining: the
       * write helper already owns busy state, notices and refresh, and the commit
       * must only run if the stage actually succeeded. Committing a partially
       * staged tree after a failed stage-all would record the wrong subset.
       */
      var stageAllAndCommit = function (mode) {
        if (message.trim() === '') return
        write('stage', {}, {
          after: function () {
            write('commit', { message: message }, {
              after: function () { afterCommit(mode) },
            })
          },
        })
      }

      // --- chip values -----------------------------------------------------

      var files = status === null ? [] : (status.files || [])
      var branchName = status !== null && status.branch !== null ? status.branch.head : null
      var ahead = tracking !== null && tracking !== undefined ? tracking.ahead : (status?.branch?.ahead || 0)
      var behind = tracking !== null && tracking !== undefined ? tracking.behind : (status?.branch?.behind || 0)
      var upstream = status !== null && status.branch !== null ? status.branch.upstream : null
      var operation = status !== null && status.operation !== undefined ? status.operation : null
      var detached = status !== null && status.branch !== null && status.branch.detached === true

      // Git missing entirely: the chips would be meaningless, so say so once.
      if (gitMissing) {
        return h('span', { className: 'dshgit-chip dshgit-chipmuted', title: t('state.noGit') },
          t('state.noGit'))
      }
      if (!ready) {
        return h('span', { className: 'dshgit-chip dshgit-chipmuted' }, t('state.loading'))
      }
      if (repo === null) {
        if (readError !== null && !gitMissing) return h('button', {
          type: 'button', className: 'dshgit-chip dshgit-chipaction dshgit-next-warn',
          title: readError.message + '\n' + t('action.retryRead'),
          'aria-label': t('action.retryRead'), 'aria-busy': refreshing,
          disabled: refreshing,
          onClick: function () { refresh({ force: true }) },
        }, [t('state.readFailed'), refreshing ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null])
        return canInit
          ? h('button', {
              type: 'button',
              className: 'dshgit-chip dshgit-chipaction',
              'data-chip': 'init',
              title: t('chips.notRepo'),
              onClick: function () {
                if (writeRef.current) return
                var epoch = contextEpochRef.current
                writeRef.current = true
                setBusy(true)
                call('initRepository', {})
                  .then(function () { if (epoch === contextEpochRef.current) { writeRef.current = false; setBusy(false); refresh({ force: true }) } })
                  .catch(function (failure) { if (epoch === contextEpochRef.current) { writeRef.current = false; setBusy(false); fail(failure.message, 'initRepository') } })
              },
              disabled: busy,
            }, t('chips.init'))
          : h('span', { className: 'dshgit-chip dshgit-chipmuted', title: t('chips.notRepo') },
              t('chips.notRepo'))
      }

      /**
       * What to do about SYNC, derived from the repository's real state.
       *
       * The changes chip owns the commit flow, so this action always describes
       * the remote even while the working tree has edits.
       *
       * So this answers one question — "what does the remote need?" — and it
       * carries the counts itself rather than leaving them to a separate chip. The
       * arrows ARE the state and the label IS the verb, so splitting them across
       * two controls printed the same number twice within 40px.
       *
       * Precedence is deliberate. An unfinished merge outranks everything (nothing
       * else can proceed); publishing outranks a plain push because a plain push
       * cannot succeed without an upstream.
       *
       * @returns `{ id, label, counts, hint, tone, disabled }`.
       */
      var nextAction = (function () {
        if (readError !== null) return { id: 'retry', label: t('state.readFailed'), counts: '', hint: readError.message + '\n' + t('action.retryRead'), tone: 'warn', disabled: false }
        if (status === null) return { id: 'unavailable', label: t('state.loading'), counts: '', hint: t('window.open'), tone: 'clean', disabled: true }
        if (operation !== null) {
          var kindKey = operation.kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + operation.kind
          return {
            id: 'resolve',
            label: t('next.resolve'),
            counts: '',
            hint: t('next.hint.resolve', { kind: t(kindKey) }),
            tone: 'warn',
            disabled: false,
          }
        }
        // No upstream: a plain push cannot work, so offer the one that can.
        // A detached HEAD has no branch to publish, so it falls through to the
        // sync state rather than offering an action that must fail.
        if (upstream === null && !detached) {
          return {
            id: 'publish',
            label: t('next.publish'),
            counts: '',
            hint: t('next.hint.publish'),
            tone: 'ahead',
            disabled: branchName === null,
          }
        }
        // Both counts, because when a branch has diverged BOTH numbers are the
        // reason the pull needs a decision.
        if (ahead > 0 && behind > 0) {
          return {
            id: 'diverged',
            label: t('next.diverged'),
            counts: '↑' + ahead + ' ↓' + behind,
            hint: t('next.hint.diverged'),
            tone: 'warn',
            disabled: false,
          }
        }
        if (behind > 0) {
          return { id: 'pull', label: t('action.pull'), counts: '↓' + behind, hint: t('next.hint.pull', { count: behind }), tone: 'behind', disabled: false }
        }
        if (ahead > 0) {
          return { id: 'push', label: t('action.push'), counts: '↑' + ahead, hint: t('next.hint.push', { count: ahead }), tone: 'ahead', disabled: false }
        }
        return { id: 'fetch', label: t('action.fetch'), counts: '', hint: t('sync.fetch'), tone: 'clean', disabled: false }
      })()

      /**
       * Run the primary action.
       *
       * Pull is `--ff-only` by default: it is the only form that cannot surprise
       * the user with a merge commit they did not ask for. When it cannot
       * fast-forward the branch has diverged, and the choice between merging and
       * rebasing is a real decision — so it is asked rather than guessed.
       */
      var runNext = function (event) {
        if (event?.currentTarget) openerRef.current = event.currentTarget
        if (nextAction.id === 'retry') { refresh({ force: true }); return }
        if (nextAction.id === 'resolve') { setOpOpen(true); return }
        if (nextAction.id === 'publish') {
          write('push', { setUpstream: true })
          return
        }
        if (nextAction.id === 'pull') {
          write('pull', { ffOnly: true }, {
            // A refused fast-forward is not an error to shout about; it is the
            // signal to ask which way the user wants to reconcile.
            onReject: 'diverged',
          })
          return
        }
        if (nextAction.id === 'push') { write('push', {}); return }
        if (nextAction.id === 'diverged') { setPullChoice(true) }
        if (nextAction.id === 'fetch') { write('fetch', { prune: true }) }
      }

      var syncBusy = busy && (busyMethod === 'push' || busyMethod === 'pull' || busyMethod === 'fetch')
      var retryBusy = refreshing && nextAction.id === 'retry'

      return h(Fragment, null, [
        // Branch chip → branch picker.
        h('button', {
          key: 'branch',
          type: 'button',
          className: 'dshgit-chip dshgit-chipaction',
          'data-chip': 'branch',
          title: repo.root + '\n' + (branchName || 'HEAD'),
          'aria-haspopup': 'dialog',
          'aria-expanded': popover === 'branch',
          onClick: function (event) { openPopover('branch', event) },
        }, [
          h(IconBranch, { key: 'i', size: 12 }),
          h('span', { key: 'n', className: 'dshgit-chipname' }, branchName === null ? 'HEAD' : branchName),
          busy && (busyMethod === 'checkout' || busyMethod === 'createBranch') ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
        ]),

        // One stable entry for reviewing, staging and committing changes.
        h('button', {
          key: 'changes',
          type: 'button',
          className: 'dshgit-chip dshgit-chipaction' + (files.length > 0 ? ' dshgit-chipdirty' : ' dshgit-chipmuted'),
          'data-chip': 'changes',
          title: files.length === 0 ? t('chips.clean') : t('chips.changes', { count: files.length }),
          'aria-haspopup': 'dialog',
          'aria-expanded': popover === 'commit',
          onClick: function (event) { openPopover('commit', event) },
        }, [
          h(IconChanges, { key: 'i', size: 12 }),
          h('span', { key: 'n' }, String(files.length)),
          busy && !syncBusy && busyMethod !== 'checkout' && busyMethod !== 'createBranch' && busyMethod !== 'merge' && popover !== 'commit' ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
        ]),

        // A merge always names a source and targets the branch shown on the left.
        // An unfinished operation takes over this slot with its recovery action.
        h('button', {
          key: 'merge', type: 'button',
          className: 'dshgit-chip dshgit-chipaction' + (operation !== null ? ' dshgit-next-warn' : ''),
          'data-chip': 'merge',
          title: operation !== null ? t('next.resolve') : t('merge.pick'),
          'aria-haspopup': operation === null ? 'dialog' : undefined,
          'aria-expanded': operation === null ? popover === 'merge' : undefined,
          disabled: busy || (operation === null && (branchName === null || detached)),
          onClick: function (event) {
            if (operation !== null) setOpOpen(true)
            else openPopover('merge', event)
          },
        }, [operation !== null ? t('next.resolve') : t('merge.open'), busy && busyMethod === 'merge' ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true }) : null]),

        // The primary remote action describes the cached tracking state. Alternate
        // commands stay available through the adjacent chevron in every state.
        operation === null ? h('button', {
          key: 'next', type: 'button',
          className: 'dshgit-chip dshgit-chipaction dshgit-chipnext dshgit-next-' + nextAction.tone,
          'data-chip': 'next',
          'data-next': nextAction.id,
          title: nextAction.hint + (upstream ? '\n' + t('sync.target', { target: upstream }) : ''),
          'aria-busy': syncBusy || retryBusy,
          disabled: busy || retryBusy || nextAction.disabled,
          onClick: runNext,
        }, [
          h('span', { key: 'n', className: 'dshgit-chipname' }, syncBusy ? t(busyMethod === 'push' ? 'sync.pushing' : busyMethod === 'pull' ? 'sync.pulling' : 'sync.fetching') : nextAction.label),
          syncBusy || retryBusy || nextAction.counts !== ''
            ? h('span', { key: 'c', className: 'dshgit-chipcounts' }, syncBusy || retryBusy ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : nextAction.counts)
            : null,
        ]) : null,
        h('button', {
          key: 'sync-menu', type: 'button',
          className: 'dshgit-chip dshgit-chipaction dshgit-chipmore',
          'data-chip': 'sync-menu',
          title: t('next.more'),
          'aria-label': t('next.more'),
          'aria-haspopup': 'dialog',
          'aria-expanded': popover === 'sync',
          disabled: busy || operation !== null,
          onClick: function (event) { openPopover('sync', event) },
        }, h(IconChevron, { size: 9 })),

        popover === 'branch'
          ? h(ChipPopover, {
              key: 'branchpop',
              opener: openerRef.current,
              kind: 'branch',
              title: t('action.switchBranch'),
              anchor: anchor,
              width: 520,
              onClose: closePopover,
            }, h(BranchPicker, {
              t: t,
              busy: busy,
              refs: refs,
              current: branchName,
              query: pickerQuery,
              setQuery: setPickerQuery,
              onSwitch: switchBranch,
              onRemote: chooseRemoteBranch,
              onTag: function (tag) { openHeaderWorkbench('checkout', tag) },
              onNew: openNewBranchDialog,
              onFetch: function () { write('fetch', {}, { after: function () { refresh({ force: true }) } }) },
            }))
          : null,

        popover === 'merge'
          ? h(ChipPopover, {
              key: 'mergepop', kind: 'merge', title: t('merge.pick'),
              opener: openerRef.current,
              anchor: anchor, width: 520, onClose: closePopover,
            }, h(BranchPicker, {
              mode: 'merge', t: t, refs: refs, current: branchName,
              busy: busy,
              query: pickerQuery, setQuery: setPickerQuery,
              onMerge: function (source, ref) {
                closePopover()
                setMergePreview(null)
                setMergeError(null)
                mergeTargetState[1](ref || source)
                setMergeSource(source)
              },
            }))
          : null,

        popover === 'commit'
          ? h(ChipPopover, {
              key: 'commitpop',
              opener: openerRef.current,
              kind: 'commit',
              title: t('commit.title'),
              anchor: anchor,
              width: 460,
              onClose: closePopover,
            }, h(headerChangelists.mode === 'lists' ? ChangelistCommitPanel : CommitPanel, {
              changelists: headerChangelists, run: call, tracking: tracking, setAiNotice: setAiNotice,
              afterWrite: function () { closePopover(); refresh({ force: true }) },
              t: t,
              repo: repo,
              status: status,
              message: headerChangelists.mode === 'lists' ? headerChangelists.message : message,
              setMessage: headerChangelists.mode === 'lists' ? headerChangelists.setMessage : function (value) { messageLatestRef.current = value; setMessage(value) },
              busy: busy,
              aiBusy: aiBusy,
              busyMethod: busyMethod,
              aiNotice: aiNotice,
              onGenerate: generateMessage,
              onCommit: function () { commit('commit') },
              onCommitPush: function () { commit('push') },
              onCommitSync: function () { commit('sync') },
              syncAction: files.length === 0 && (nextAction.id === 'push' || nextAction.id === 'publish')
                ? { label: nextAction.id === 'push' ? t('action.sync') : nextAction.label, run: runNext }
                : null,
              onWrite: write,
              onOpenFull: function () {
                closePopover()
                setWindowState({ mode: 'full', tab: 'changes' })
              },
              requestConfirm: function (message, onConfirm, label) { if (!writeRef.current) setConfirmRequest({ message: message, onConfirm: onConfirm, label: label, opener: document.activeElement }) },
              // Opening a file closes the popover: the viewer is a modal that
              // covers the chips anyway, and leaving a popover open behind it
              // would put two surfaces on screen for one action.
              onOpenFile: function (next) { closePopover(); setViewerPath(next) },
            }))
          : null,

        // Alternate sync forms are available from the chevron in every state.
        popover === 'sync'
          ? h(ChipPopover, {
              key: 'syncpop',
              opener: openerRef.current,
              kind: 'sync',
              title: t('next.more'),
              anchor: anchor,
              width: 340,
              onClose: closePopover,
            }, h('div', { className: 'dshgit-picker' }, [
              h('div', { key: 'list', className: 'dshgit-picklist' }, [
                h('button', {
                  key: 'fetch', type: 'button', className: 'dshgit-pickrow',
                  'data-sync': 'fetch',
                  onClick: function () { closePopover(); write('fetch', { prune: true }) },
                }, t('sync.fetch')),
                h('div', { key: 'sep1', className: 'dshgit-menusep' }),
                h('button', {
                  key: 'pullmerge', type: 'button', className: 'dshgit-pickrow',
                  'data-sync': 'pull-merge',
                  onClick: function () { closePopover(); write('pull', {}) },
                }, t('sync.pullMerge')),
                h('button', {
                  key: 'pullrebase', type: 'button', className: 'dshgit-pickrow',
                  'data-sync': 'pull-rebase',
                  onClick: function () { closePopover(); write('pull', { rebase: true }) },
                }, t('sync.pullRebase')),
                h('div', { key: 'sep2', className: 'dshgit-menusep' }),
                h('button', {
                  key: 'pushlease', type: 'button', className: 'dshgit-pickrow dshgit-pickdanger',
                  'data-sync': 'push-lease',
                  onClick: function () { closePopover(); write('push', { forceWithLease: true }) },
                }, t('sync.pushLease')),
              ]),
            ]))
          : null,

        // The in-progress operation, with its way out. This is a panel rather than
        // a popover on purpose: a popover closes on the first outside click, and
        // the way out of a conflicted merge must not vanish while the user reads
        // the conflicted files.
        operation !== null && opOpen
          ? h(OperationPanel, {
              key: 'oppanel',
              t: t,
              operation: operation,
              busy: busy,
              onContinue: function () { write('continueOperation', { kind: operation.kind }) },
              onAbort: function () {
                var label = t(operation.kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + operation.kind)
                setConfirmRequest({
                  message: t('confirm.abortOp', { kind: label }),
                  label: t('action.abortOp'),
                  onConfirm: function () {
                    setConfirmRequest(null)
                    setOpOpen(false)
                    write('abortOperation', { kind: operation.kind }, { confirm: true })
                  },
                })
              },
              onClose: function () { setOpOpen(false) },
            })
          : null,

        // The merge-or-rebase question, asked only when a fast-forward pull
        // refused. Guessing here is what creates surprise merge commits.
        pullChoice
          ? h(ChoiceDialog, {
              key: 'pullchoice',
              opener: openerRef.current,
              title: t('confirm.pullDiverged'),
              t: t,
              choices: [
                {
                  label: t('action.pullMerge'),
                  // The hints must say what each choice DOES to history: that is
                  // the entire reason the question is being asked. Repeating the
                  // dialog title here would waste the one place that can explain
                  // the difference.
                  hint: t('choice.mergeHint'),
                  run: function () { setPullChoice(false); write('pull', {}) },
                },
                {
                  label: t('action.pullRebase'),
                  hint: t('choice.rebaseHint'),
                  run: function () { setPullChoice(false); write('pull', { rebase: true }) },
                },
              ],
              onClose: function () { setPullChoice(false) },
            })
          : null,
        mergeSource !== null && branchName !== null
          ? h(MergeReviewDialog, {
              key: 'merge-review', t: t,
              opener: openerRef.current,
              source: mergeSource, target: branchName,
              preview: mergePreview, error: mergeError,
              fetching: mergeFetchState[0], remote: /^refs\/remotes\//.test(mergeTarget || ''),
              onFetch: function () {
                if (writeRef.current || mergeFetchState[0] || !/^refs\/remotes\//.test(mergeTarget || '')) return
                var target = mergeTarget, request = ++mergeReviewRequestRef.current, epoch = contextEpochRef.current
                var active = function () { return request === mergeReviewRequestRef.current && epoch === contextEpochRef.current }
                var record = (refs?.remotes || []).find(function (branch) { return branch.ref === target })
                var remoteName = record?.remoteName || target.slice(13).split('/')[0]
                setMergeFetchState(true); setMergePreview(null); setMergeError(null)
                write('fetch', { remote: remoteName, branch: target.slice(14 + remoteName.length) }, { propagate: true }).then(function (result) {
                  if (!active()) return
                  if (!result || result.ok === false) throw new Error(result?.message || t('action.failed'))
                  mergeRetryState[1](function (value) { return value + 1 })
                }).catch(function (failure) { if (active()) setMergeError(failure.message) })
                  .finally(function () { if (active()) setMergeFetchState(false) })
              },
              onRetry: function () { mergeRetryState[1](function (value) { return value + 1 }) },
              dirty: files.length, busy: busy,
              onClose: function () { setMergeSource(null) },
              onChanges: function () {
                setMergeSource(null)
                closePopover()
                setWindowState({ mode: 'full', tab: 'changes', minimized: false, sessionId: props.sessionId })
              },
              onStash: function () { write('stashPush', { includeUntracked: true }) },
              onMerge: function () {
                if (files.length > 0 || mergePreview === null || mergePreview.incoming.length === 0) return
                var source = mergeTarget || mergeSource
                setMergeSource(null)
                write('merge', { ref: source })
              },
            })
          : null,
        // The file viewer. Portalled to the body so it escapes the header's own
        // stacking/clipping context, and rendered OUTSIDE the popover so it
        // survives the popover closing.
        viewerPath !== null && repo !== null
          ? h(FileViewer, {
              key: 'viewer',
              connection: props.connection,
              repo: repo,
              path: viewerPath,
              // The viewer needs the file's kind to pick a sensible first view:
              // an untracked file has no patch, so it opens as its contents.
              kind: (function () {
                for (var vi = 0; vi < files.length; vi++) if (files[vi].path === viewerPath) return files[vi].kind
                return null
              })(),
              staged: (function () {
                for (var si = 0; si < files.length; si++) if (files[si].path === viewerPath) return files[si].staged === true
                return false
              })(),
              files: files.map(function (file) { return file.path }),
              t: t,
              onNavigate: function (next) { setViewerPath(next) },
              onClose: function () { setViewerPath(null) },
              onStage: function (target) { write('stage', { paths: [target] }) },
            })
          : null,

        notice !== null
          ? h(ChipNotice, {
              key: 'notice',
              outcome: notice,
              detailsOpen: noticeOpen,
              t: t,
              onDismiss: function () { setNotice(null); setNoticeOpen(false) },
              onDetails: function () { setNoticeOpen(!noticeOpen) },
              // The banner's own fix button. `pull`/`publish`/`reconcile` are the
              // three the classifier can offer, and each maps to something the
              // chips already know how to do.
              onAction: function (action) {
                setNotice(null)
                setNoticeOpen(false)
                if (action.id === 'pull') { write('pull', { ffOnly: true }, { onReject: 'diverged' }); return }
                if (action.id === 'publish') { write('push', { setUpstream: true }); return }
                if (action.id === 'reconcile') { setPullChoice(true) }
              },
            })
          : null,

        confirmRequest !== null
          ? h(ConfirmBar, {
              key: 'confirm',
              opener: confirmRequest.opener || openerRef.current,
              t: t,
              request: confirmRequest,
              onCancel: function () { setConfirmRequest(null) },
            })
          : null,

        promptRequest !== null
          ? h(PromptDialog, {
              key: 'prompt',
              opener: openerRef.current,
              spec: promptRequest,
              t: t,
              onClose: function () { setPromptRequest(null) },
            })
          : null,
        headerWorkbenchState[0] && repo ? h(WorkbenchDialog, {
          key: headerWorkbenchState[0].id, request: headerWorkbenchState[0], repo: repo, status: status, refs: refs, run: call, t: t,
          execute: function (payload) { return write('workbenchAction', payload, { confirm: true, propagate: true }) },
          onClose: function () { if (!writeRef.current) headerWorkbenchState[1](null) },
        }) : null,
        remoteRequest[0] && repo ? h(RemoteConfigDialog, {
          key: repo.root + ':' + remoteRequest[0].id, repo: repo, run: call, t: t, initialPush: remoteRequest[0].push, branch: remoteRequest[0].branch,
          onWrite: function (method, payload) { return write(method, payload, { propagate: true }) },
          onSaved: function () { refresh({ force: true }); setWindowState({ refreshToken: getWindowState().refreshToken + 1 }) },
          onClose: function () { remoteRequest[1](null) },
        }) : null,
      ])
    }

    /** Review the exact merge direction and each side's unique commits. */
    function MergeReviewDialog(props) {
      var t = props.t
      var panelRef = React.useRef(null)
      useDialogFocus(panelRef, props.onClose, { opener: props.opener })
      var preview = props.preview
      var alreadyMerged = preview !== null && props.error === null && preview.incoming.length === 0
      var needsChanges = props.dirty > 0 && !alreadyMerged
      var column = function (key, title, commits) {
        return h('div', { key: key, className: 'dshgit-mergecolumn' }, [
          h('h3', { key: 'title' }, title),
          commits.length === 0
            ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('merge.noCommits'))
            : commits.map(function (commit) {
                return h('div', { key: commit.sha, className: 'dshgit-mergecommit', title: commit.subject },
                  String(commit.shortSha || commit.sha.slice(0, 7)) + ' · ' + commit.subject)
              }),
          commits.length >= 20
            ? h('div', { key: 'more', className: 'dshgit-muted' }, t('merge.moreCommits'))
            : null,
        ])
      }
      return h('div', { className: 'dshgit-modal', onClick: props.onClose },
        h('div', {
          className: 'dshgit-dialog', role: 'dialog', 'data-merge-review': props.source,
          ref: panelRef, tabIndex: -1, 'aria-modal': true, 'aria-label': t('merge.direction', { source: props.source, target: props.target }),
          style: { width: 'min(620px, 100%)', maxHeight: '85vh', overflowY: 'auto' },
          onClick: function (event) { event.stopPropagation() },
        }, [
          h('div', { key: 'direction', className: 'dshgit-mergehead' },
            t('merge.direction', { source: props.source, target: props.target })),
          props.remote ? h('div', { key: 'flow', className: 'dshgit-merge-remote' }, [
            h('span', { key: 'hint', className: 'dshgit-muted' }, t('merge.remoteFlow')),
            h('button', { key: 'fetch', type: 'button', className: 'dshgit-btn', 'data-merge-fetch': props.source,
              disabled: props.busy || props.fetching, 'aria-busy': props.fetching === true, title: 'git fetch', onClick: props.onFetch }, [
                props.fetching ? h('span', { key: 'spinner', className: 'dshgit-spinner', 'aria-hidden': true }) : null,
                h('span', { key: 'label' }, t('merge.fetchLatest')),
                h('span', { key: 'command', className: 'dshgit-menucommand', 'aria-hidden': true }, 'fetch'),
              ]),
          ]) : null,
          preview === null
            ? props.error === null ? h('div', { key: 'loading', className: 'dshgit-muted', role: 'status' }, t(props.fetching ? 'merge.fetching' : 'merge.loading')) : null
            : h('div', { key: 'columns', className: 'dshgit-mergecolumns' }, [
                column('incoming', t('merge.incoming'), preview.incoming),
                column('outgoing', t('merge.outgoing'), preview.outgoing),
              ]),
          props.error !== null
            ? h('div', { key: 'error', className: 'dshgit-chipnotice' }, props.error)
            : null,
          alreadyMerged
            ? h('div', { key: 'already', className: 'dshgit-hint' }, t('merge.already'))
            : props.dirty > 0
            ? h('div', { key: 'dirty', className: 'dshgit-hint' },
                t('merge.dirty', { count: props.dirty }))
            : null,
          h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
            props.error !== null && props.onRetry && !props.remote ? h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', disabled: props.busy,
              onClick: props.onRetry }, t('stash.retry')) : null,
            needsChanges
              ? h('button', { key: 'changes', type: 'button', className: 'dshgit-btn',
                  'data-merge-changes': props.source, disabled: props.busy, onClick: props.onChanges }, t('merge.openChanges'))
              : null,
            needsChanges
              ? h('button', { key: 'stash', type: 'button', className: 'dshgit-btn',
                  disabled: props.busy, onClick: props.onStash }, t('merge.stash'))
              : null,
            h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn',
              onClick: props.onClose }, t('action.cancel')),
            h('button', { key: 'merge', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
              'data-merge-confirm': props.source,
              disabled: props.busy || props.dirty > 0 || preview === null ||
                preview.incoming.length === 0 || props.error !== null,
              onClick: props.onMerge }, t('merge.confirm')),
          ]),
        ]))
    }

    /**
     * The branch picker: a filter box over grouped local / remote / tag refs.
     *
     * Modelled on VS Code's quick pick because that is the interaction people
     * already know: type to filter, arrows and Enter to pick, and each row
     * carries enough metadata (relative time, author, sha, subject) to tell two
     * similarly-named branches apart without checking them out.
     *
     * @param props - `{ t, refs, current, query, setQuery, onSwitch, onRemote, onNew, onFetch }`.
     */
    function BranchPicker(props) {
      var t = props.t
      var listRef = React.useRef(null)
      var query = props.query.toLowerCase()
      var refs = props.refs

      /**
       * One row: name (with its remote as a chip when it has one), relative date,
       * then author · sha · subject.
       *
       * A remote ref keeps its full name — it IS the identity — but its remote is
       * split out into a chip so `origin/feature/x` and a local `feature/x` are
       * told apart by shape rather than by re-reading a prefix.
       */
      var row = function (item, key, onPick, extra) {
        var remote = extra && extra.remote ? String(item.name).split('/')[0] : null
        var display = remote === null ? item.name : String(item.name).slice(remote.length + 1)
        return h('button', {
          key: key,
          type: 'button',
          className: 'dshgit-pickrow' + (extra && extra.current === true ? ' dshgit-pickrowcurrent' : ''),
          'data-ref': item.name,
          disabled: props.busy === true || extra?.current === true,
          title: item.name,
          onClick: onPick,
        }, [
          h('span', { key: 'top', className: 'dshgit-pickrowtop' }, [
            // The remote keeps its trailing slash so the two spans concatenate back
            // into the real ref — `origin/` + `feature/x`. Dropping the separator
            // rendered `originfeature/x`, which is not a branch that exists.
            remote === null ? null : h('span', { key: 'r', className: 'dshgit-pickremote' }, remote + '/'),
            h('span', { key: 'n', className: 'dshgit-pickname' }, display),
            item.committerDate !== null && item.committerDate !== undefined
              ? h('span', { key: 'd', className: 'dshgit-pickdate' }, formatRelative(item.committerDate))
              : null,
          ]),
          extra?.current === true ? null : h('span', { key: 'meta', className: 'dshgit-pickmeta' },
            (item.author === null || item.author === undefined ? '' : item.author + ' · ') +
            (item.sha === undefined ? '' : String(item.sha).slice(0, 7)) +
            (item.subject === undefined || item.subject === '' ? '' : ' · ' + item.subject)),
        ])
      }

      var match = function (item) {
        return query === '' || String(item.name).toLowerCase().indexOf(query) !== -1
      }

      var locals = refs === null ? [] : (refs.branches || []).filter(function (branch) {
        return branch.head !== true && match(branch)
      })
      var remotes = refs === null ? [] : (refs.remotes || []).filter(function (branch) {
        // `origin/HEAD` is a symbolic pointer, not a checkout target.
        return !/\/HEAD$/.test(branch.ref) && match(branch)
      })
      var tags = props.mode === 'merge' || refs === null ? [] : (refs.tags || []).filter(match)
      var nothing = locals.length === 0 && remotes.length === 0 && tags.length === 0

      return h('div', { className: 'dshgit-picker' }, [
        h('input', {
          key: 'q',
          className: 'dshgit-pickerinput',
          value: props.query,
          placeholder: t(props.mode === 'merge' ? 'merge.search' : 'picker.placeholder'),
          autoFocus: true,
          onChange: function (event) { props.setQuery(event.currentTarget.value) },
          onKeyDown: function (event) {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return
            var rows = Array.from(listRef.current?.querySelectorAll?.('button:not(:disabled)') || [])
            if (rows.length === 0) return
            event.preventDefault()
            var selected = event.key === 'ArrowUp' ? rows[rows.length - 1] : rows[0]
            if (event.key === 'Enter') selected.click?.()
            else selected.focus?.()
          },
        }),
        // The one creation action VS Code puts above the list, so it is reachable
        // without scrolling past every branch. Fetch deliberately does NOT appear
        // here: it does nothing to the branch you are choosing, it sits in the
        // title bar's own Fetch control, and offering two ways to reach the same
        // network write from a picker invites a mis-click — and after a fetch the
        // list would rebuild under the pointer anyway.
        props.mode === 'merge' ? null : h('div', { key: 'actions', className: 'dshgit-pickactions' }, [
          h('button', { key: 'new', type: 'button', className: 'dshgit-pickrow',
            disabled: props.busy === true,
            onClick: function () { props.onNew('HEAD') },
          }, '+ ' + t('picker.create')),
        ]),
        h('div', { key: 'list', className: 'dshgit-picklist', ref: listRef,
          onKeyDown: function (event) {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            var rows = Array.from(listRef.current?.querySelectorAll?.('button:not(:disabled)') || [])
            if (rows.length === 0) return
            event.preventDefault()
            var index = rows.indexOf(document.activeElement)
            rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus?.()
          },
        }, [
          // The current branch gets its own labelled section. Pinned above the
          // list it looked like a stray row floating under the search box, with no
          // relationship to the groups below it.
          props.mode !== 'merge' && props.current !== null && props.current !== undefined && query === ''
            ? h('div', { key: 'cb', className: 'dshgit-pickgroup' }, t('picker.current'))
            : null,
          props.mode !== 'merge' && props.current !== null && props.current !== undefined && query === ''
            ? row({ name: props.current, sha: undefined, subject: undefined, committerDate: undefined, author: undefined },
                'current', function () {}, { current: true })
            : null,
          locals.length > 0
            ? h('div', { key: 'lb', className: 'dshgit-pickgroup' }, t('picker.branches'))
            : null,
        ].concat(locals.map(function (branch) {
          return row(branch, 'l:' + branch.ref, function () {
            if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
            else props.onSwitch(branch.name)
          })
        })).concat(remotes.length > 0
          ? [h('div', { key: 'rb', className: 'dshgit-pickgroup' }, t('picker.remotes'))]
          : []).concat(remotes.map(function (branch) {
            return row(branch, 'r:' + branch.ref, function () {
              if (props.mode === 'merge') props.onMerge(branch.name, branch.ref)
              else props.onRemote(branch.name)
            }, { remote: true })
          })).concat(tags.length > 0
            ? [h('div', { key: 'tb', className: 'dshgit-pickgroup' }, t('picker.tags'))]
            : []).concat(tags.map(function (tag) {
              return row(tag, 't:' + tag.ref, function () { if (props.onTag) props.onTag(tag); else props.onSwitch(tag.name) })
            })).concat(nothing
              ? [h('div', { key: 'none', className: 'dshgit-empty' }, t('picker.noMatch'))]
              : [])),
      ])
    }

    /**
     * The file viewer: one changed file, as its diff or its full contents.
     *
     * A modal window rather than a popover. Reading a file needs room, wants to
     * be resizable, and must outlive the commit popover that opened it — a
     * popover closes on the first outside click, which is exactly what clicking a
     * file row would otherwise cause.
     *
     * It fetches on its own: the commit popover holds a file LIST, not file
     * bodies, so sending the diff/content for every changed file up front would
     * be wasted work on a large working tree.
     *
     * @param props - `{ repo, path, kind, files, onNavigate, onClose, onStage,
     *   connection, t }`.
     */
    function FileViewer(props) {
      var t = props.t
      var path = props.path
      var bodyRef = React.useRef(null)
      var requestRef = React.useRef(0)

      /** Whether this file has no patch to show. */
      var untracked = props.kind === 'untracked' || props.kind === 'added'

      // `diff` shows the patch; `content` shows the file itself.
      //
      // A brand-new file has no patch (there is nothing to diff against), so it
      // opens as its contents — a "no diff" panel for a file the user just
      // created would look broken rather than empty.
      var defaultMode = untracked ? 'content' : 'diff'
      // The mode is remembered per FILE. The component instance survives
      // navigation (so wrap/size persist), which means storing a bare mode would
      // carry one file's manual toggle onto the next. Keying by path makes a
      // stale mode apply to nothing, without an extra effect or a wasted fetch.
      var modeKey = path + (untracked ? ':u' : ':t')
      var modeState = React.useState({ key: modeKey, mode: defaultMode })
      var mode = modeState[0].key === modeKey ? modeState[0].mode : defaultMode
      var setMode = function (next) { modeState[1]({ key: modeKey, mode: next }) }
      var wrapState = React.useState(false)
      var wrap = wrapState[0]
      var setWrap = wrapState[1]
      // Size is per-viewer and starts at the stylesheet default; `null` means
      // "let the CSS decide", which is what keeps it responsive until the user
      // actually drags the grip.
      var sizeState = React.useState(null)
      var size = sizeState[0]
      var setSize = sizeState[1]
      var diffState = React.useState(null)
      var diff = diffState[0]
      var setDiff = diffState[1]
      var blobState = React.useState(null)
      var blob = blobState[0]
      var setBlob = blobState[1]
      var failureState = React.useState(null)
      var failure = failureState[0]
      var setFailure = failureState[1]

      var root = props.repo === null ? null : props.repo.root

      // Load whichever representation is showing. Re-runs when the file OR the
      // mode changes, so switching to Diff does not need its own click handler.
      React.useEffect(
        function () {
          if (root === null) return
          var requestId = ++requestRef.current
          setFailure(null)
          if (mode === 'diff') {
            setDiff(null)
            // `to: 'HEAD'` is the working tree against the last commit. The
            // response carries per-file hunks, so the wanted file is picked out
            // by path rather than re-running git with a pathspec.
            callRpc(props.connection, 'diff', { root: root, to: 'HEAD', path: path }, undefined)
              .then(function (value) {
                if (requestRef.current !== requestId) return
                setDiff(value)
              })
              .catch(function (error) {
                if (requestRef.current !== requestId) return
                setDiff({ files: [], hunks: [], text: '' })
                setFailure(error.message)
              })
          } else {
            setBlob(null)
            callRpc(props.connection, 'fileContent', { root: root, path: path }, undefined)
              .then(function (value) {
                if (requestRef.current !== requestId) return
                setBlob(value)
              })
              .catch(function (error) {
                if (requestRef.current !== requestId) return
                setBlob({ exists: false })
                setFailure(error.message)
              })
          }
        },
        [root, path, mode],
      )

      // Escape closes the viewer. Nothing else listens: the viewer is the top
      // surface while it is open.
      React.useEffect(
        function () {
          var onKey = function (event) {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            props.onClose()
          }
          document.addEventListener('keydown', onKey, true)
          return function () { document.removeEventListener('keydown', onKey, true) }
        },
        [props.onClose],
      )

      // Where the current file sits in the changed-file list, so the footer can
      // page through them. -1 when the list does not contain it (a stale path).
      var order = props.files || []
      var index = order.indexOf(path)
      var previous = index > 0 ? order[index - 1] : null
      var next = index >= 0 && index < order.length - 1 ? order[index + 1] : null

      /**
       * Begin a resize of this viewer.
       *
       * @param event - the pointer-down event.
       */
      var startResize = function (event) {
        beginResize(event, bodyRef, false)
      }

      /** Commit one resize gesture's dimensions into this viewer's own size. */
      var endResize = function (event) {
        endResizeWith(event, setSize)
      }

      // `null` until the user actually drags the grip, which is what lets the
      // stylesheet's responsive default hold until then.
      var style = size === null
        ? null
        : { width: size.width + 'px', height: size.height + 'px', maxHeight: 'none' }

      var files = props.files || []
      var diffFiles = diff === null ? [] : (diff.files || [])
      var shown = diffFiles.filter(function (file) { return file.path === path })
      var hunks = shown.length > 0 ? shown[0].hunks : (diff === null ? [] : diff.hunks)

      var body = null
      if (failure !== null) {
        body = h('div', { className: 'dshgit-err', style: { padding: '12px 14px' } }, failure)
      } else if (mode === 'content') {
        body = h(FilePreview, { blob: blob, path: path, wrap: wrap, t: t })
      } else if (diff === null) {
        body = h('div', { className: 'dshgit-empty' }, t('state.loading'))
      } else if (hunks === undefined || hunks === null || hunks.length === 0) {
        body = h('div', { className: 'dshgit-empty' }, t('state.diffEmpty'))
      } else {
        body = h(DiffBody, { path: path, hunks: hunks, wrap: wrap, emptyText: t('state.diffEmpty') })
      }

      return ReactDOM.createPortal(h(Fragment, null, [
        h('div', { key: 'scrim', className: 'dshgit-viewerscrim', onClick: props.onClose }),
        h('div', {
          key: 'viewer',
          ref: bodyRef,
          className: 'dshgit-fileviewer',
          role: 'dialog',
          'aria-label': path,
          'data-file-viewer': path,
          'data-wrap': wrap === true ? 'true' : 'false',
          style: style,
          onPointerMove: moveResize,
          onPointerUp: endResize,
          onPointerCancel: endResize,
          onLostPointerCapture: endResize,
        }, [
          h('div', { key: 'head', className: 'dshgit-fileviewerhead' }, [
            h(IconChanges, { key: 'i', size: 14 }),
            h('span', { key: 'p', className: 'dshgit-fileviewerpath', title: path }, path),
            h('button', {
              key: 'mode', type: 'button', className: 'dshgit-btn',
              onClick: function () { setMode(mode === 'diff' ? 'content' : 'diff') },
            }, mode === 'diff' ? t('action.viewFile') : t('action.viewDiff')),
            h('button', {
              key: 'wrap', type: 'button', className: 'dshgit-btn',
              // The pressed look keys off `aria-pressed` rather than a separate
              // class, so the visible state and the accessible state are one
              // value and cannot drift apart.
              'aria-pressed': wrap === true,
              title: wrap ? t('action.nowrap') : t('action.wrap'),
              onClick: function () { setWrap(!wrap) },
            }, wrap ? t('action.nowrap') : t('action.wrap')),
            h('button', {
              key: 'x', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.close'), 'aria-label': t('action.close'),
              onClick: props.onClose,
            }, '✕'),
          ]),
          h('div', { key: 'body', className: 'dshgit-fileviewerbody' }, body),
          h('div', { key: 'foot', className: 'dshgit-fileviewerfoot' }, [
            h('button', {
              key: 'prev', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.previousFile'), 'aria-label': t('action.previousFile'),
              disabled: previous === null,
              onClick: function () { if (previous !== null) props.onNavigate(previous) },
            }, '‹'),
            h('span', { key: 'pos' }, index >= 0 ? (index + 1) + ' / ' + files.length : ''),
            h('button', {
              key: 'next', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.nextFile'), 'aria-label': t('action.nextFile'),
              disabled: next === null,
              onClick: function () { if (next !== null) props.onNavigate(next) },
            }, '›'),
            h('span', { key: 'spacer', style: { flex: '1' } }),
            // Staging is offered whenever it would DO something. It deliberately
            // does not depend on which view is loaded: `blob` only exists in
            // content mode, so keying off it would hide the action in diff mode —
            // exactly where someone reading a patch decides to stage it.
            props.staged !== true
              ? h('button', {
                  key: 'stage', type: 'button', className: 'dshgit-pickinline',
                  onClick: function () { props.onStage(path) },
                }, t('action.stage'))
              : null,
            // The grip starts its own gesture; without it the dialog would be
            // fixed at its default size and long lines would be unreadable.
            h('button', {
              key: 'resize', type: 'button', className: 'dshgit-resize',
              title: t('window.resizeHint'), 'aria-label': t('window.resizeHint'),
              onPointerDown: startResize,
            }, h(IconResize, {})),
          ]),
        ]),
      ]), document.body)
    }

    /**
     * The commit panel: staged and unstaged lists with per-file actions, plus the
     * message box.
     *
     * The staged section defines the commit scope; when empty, the primary
     * action explicitly offers to stage and commit all changes.
     *
     * @param props - the panel's state and callbacks.
     */
    function ChangelistCommitPanel(props) {
      var model = props.changelists, data = model.data, t = props.t
      var search = React.useState(''), untrackedOpen = React.useState(true)
      var query = search[0].trim().toLowerCase()
      var files = props.status?.files || []
      var groups = data ? data.lists.map(function (list) { return { id: list.id, name: list.id === 'default' && list.name === '默认' ? t('cl.default') : list.name, expanded: list.expanded !== false, files: files.filter(function (file) { return changelistHasFile(data, list.id, file.path) }) } }) : []
      var unassigned = files.filter(function (file) { return !data?.assignments[file.path] })
      if (unassigned.length) groups.push({ id: 'untracked', name: t('cl.untracked'), expanded: untrackedOpen[0], files: unassigned })
      var visible = groups.filter(function (group) { return group.files.length }).map(function (group) {
        return Object.assign({}, group, { matched: group.files.filter(function (file) { return !query || group.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query) }) })
      }).filter(function (group) { return group.matched.length })
      return h('div', { className: 'dshgit-commitpanel dshgit-cl-commitpanel' }, [
        h(CommitComposer, Object.assign({}, props, { key: 'composer' })),
        model.error ? h('div', { key: 'error', role: 'alert', className: 'dshgit-cl-error' }, [model.error,
          h('button', { key: 'retry', className: 'dshgit-btn', onClick: model.retry }, t('action.retryRead'))]) : null,
        h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('cl.search'), 'aria-label': t('cl.search'), onChange: function (event) { search[1](event.currentTarget.value) } }), h(ChangelistLayoutSwitch, { key: 'layout', changelists: model, t: t, busy: props.busy })]),
        h('div', { key: 'lists', className: 'dshgit-commitlists' }, !data ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading')) : !visible.length ? h('div', { className: 'dshgit-empty' }, t(query ? 'list.noMatches' : 'commit.nothing')) : visible.map(function (group) {
          var choice = changelistSelection(data, group.id, group.matched), checked = choice.checked.length
          var open = !!query || group.expanded
          var toggle = function () { if (group.id === 'untracked') untrackedOpen[1](!open); else model.mutate({ action: 'expand', id: group.id, expanded: !open }).catch(function () {}) }
          return h('div', { key: group.id, className: 'dshgit-cl-group' }, [h('div', { key: 'head', className: 'dshgit-cl-head' }, [
            h('button', { key: 'fold', type: 'button', className: 'dshgit-iconbtn', 'aria-label': group.name, 'aria-expanded': open, disabled: props.busy, onClick: toggle }, h(IconChevron, { size: 16, open: open })),
            h(ChangelistCheckbox, { key: 'check', label: group.name, checked: checked === group.matched.length, mixed: choice.mixed.length > 0 || (checked > 0 && checked < group.matched.length),
              disabled: props.busy, onChange: function (event) { model.mutate({ action: 'select', id: group.id === 'untracked' ? undefined : group.id, paths: group.matched.filter(function (file) { return file.kind !== 'unmerged' }).map(function (file) { return file.path }), checked: event.currentTarget.checked }).catch(function () {}) } }),
            h('button', { key: 'label', type: 'button', className: 'dshgit-name dshgit-cl-toggle', disabled: props.busy, 'aria-expanded': open, onClick: toggle, title: group.name }, group.name),
            data.active === group.id ? h('span', { key: 'active', className: 'dshgit-cl-active', title: t('cl.activeHint') }, '●') : null,
            h('span', { key: 'count', className: 'dshgit-cl-count' }, query ? group.matched.length + '/' + group.files.length : group.files.length),
          ]), open ? h(ChangelistFiles, { key: 'files', listId: group.id, layout: data.fileLayout || 'tree', filterKey: query, files: group.matched, checked: choice.checked, mixed: choice.mixed, multi: [], busy: props.busy,
            onCheck: function (paths, checked) { model.mutate({ action: 'select', id: group.id === 'untracked' ? undefined : group.id, paths: paths, checked: checked }).catch(function () {}) }, onOpenFile: function (file) { props.onOpenFile(file.path) }, onSelect: function (file) { props.onOpenFile(file.path) },
            onMenu: function (event) { event.preventDefault(); props.onOpenFull() },
          }) : null])
        })),
        h('div', { key: 'foot', className: 'dshgit-pickfoot' }, [
          h('button', { key: 'full', type: 'button', className: 'dshgit-pickinline', onClick: props.onOpenFull }, t('commit.openFull')),
        ]),
      ])
    }

    function CommitPanel(props) {
      var config = usePluginConfig(props.run)
      var aiEnabled = config !== null && config.aiEnabled !== false
      var t = props.t
      var search = React.useState(''), query = search[0].trim().toLowerCase()
      var layout = props.changelists?.data?.fileLayout || 'tree'
      var validationState = React.useState(null)
      var validation = validationState[0]
      var setValidation = validationState[1]
      var messageRef = React.useRef(null)
      var files = props.status === null ? [] : (props.status.files || [])
      var staged = files.filter(isStaged)
      var unstaged = files.filter(isUnstaged)
      var commitLabel = t(staged.length > 0 || files.length === 0 ? 'action.commit' : 'commit.all')
      var progressKey = { push: 'sync.pushing', pull: 'sync.pulling', fetch: 'sync.fetching', commit: 'commit.inProgress', stage: 'commit.inProgress' }[props.busyMethod] || 'state.loading'
      var submit = function (action) {
        if (props.busy === true || files.length === 0) return
        if (props.message.trim() === '') {
          setValidation(t('commit.requiredMessage'))
          messageRef.current?.focus?.()
          return
        }
        setValidation(null)
        action()
      }

      /** A file row, with actions that appear on hover or keyboard focus. */
      var row = function (file, section, style) {
        var partial = isPartial(file)
        return h('div', {
          // A partially staged file is in both lists, so the key must include
          // which list this instance belongs to or React would see duplicates.
          key: (section === 'staged' ? 's:' : 'u:') + file.path,
          className: 'dshgit-row dshgit-change dshgit-pickfile' + (partial ? ' dshgit-partial' : ''),
          style: style,
          'data-status': statusLetter(file),
          'data-partial': partial === true ? 'true' : 'false',
          title: file.path,
          // Clicking the row opens the file — the popover's own content is a
          // list, and a list with no way into the file is a dead end.
          onClick: function () { props.onOpenFile(file.path) },
        }, changeFileLabel(layout === 'flat' ? file.path : baseName(file.path)).concat([
          h(ChangeRowActions, {
            key: 'actions', t: t, section: section, busy: props.busy,
            onOpen: function () { props.onOpenFile(file.path) },
            onDiscard: function () {
              var text = t('confirm.discard', { path: file.path })
              if (file.kind === 'untracked') text += '（未跟踪的新文件，删除后无法恢复）'
              props.requestConfirm(text, function () {
                props.onWrite('discardPath', { path: file.path, untracked: file.kind === 'untracked' }, { confirm: true })
              }, t('action.discard'))
            },
            onToggleStage: function () {
              props.onWrite(section === 'staged' ? 'unstage' : 'stage', { paths: [file.path] })
            },
          }),
          h('span', { key: 'st', className: 'dshgit-status' }, statusLetter(file)),
        ]))
      }

      var fileList = function (entries, section) {
        var matched = entries.filter(function (file) { return !query || file.path.toLowerCase().includes(query) })
        return h(ChangelistFiles, { files: matched, listId: section, layout: layout, filterKey: query, busy: props.busy,
          renderFile: function (file, style) { return row(file, section, style) },
        })
      }
      return h('div', { className: 'dshgit-commitpanel dshgit-cl-commitpanel' }, [
        h('div', { key: 'msg', className: 'dshgit-commitbox dshgit-commit-composer' }, [
          h('div', { key: 'field', className: 'dshgit-commit-field', 'data-ai': aiEnabled }, [
            h('textarea', {
              key: 'ta',
              ref: messageRef,
              className: 'dshgit-textarea',
              style: { minHeight: '56px' },
              value: props.message,
              autoFocus: true,
              readOnly: props.busy === true,
              placeholder: t('commit.placeholderMessage'),
              onChange: function (event) { props.setMessage(event.currentTarget.value); setValidation(null) },
              onKeyDown: function (event) {
                if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault(); event.stopPropagation?.()
                  if (!event.repeat) submit(props.onCommit)
                }
              },
            }),
            aiEnabled ? h('button', { key: 'ai', type: 'button', className: 'dshgit-commit-ai',
              disabled: props.aiBusy || props.busy,
              'aria-busy': props.aiBusy === true,
              'aria-label': t('action.generateMessage'),
              title: t('action.generateMessage'), onClick: props.onGenerate,
            }, props.aiBusy ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true })
              : h('span', { key: 'icon', 'aria-hidden': true }, '✨')) : null,
          ]),
          // Scope and action on one row, matching the sidebar composer.
          h('div', { key: 'row', className: 'dshgit-commit-meta' }, [
            h('span', { key: 'scope', className: 'dshgit-muted' }, t('window.staged', { count: staged.length })),
            h(CommitActions, {
              key: 'commit', t: t, shortcut: props.syncAction === null, pending: props.busy === true,
              label: props.busy ? t(progressKey) : props.syncAction === null ? commitLabel : props.syncAction.label,
              disabled: props.busy || (props.syncAction === null && files.length === 0),
              hint: props.syncAction === null ? t(staged.length > 0 ? 'commit.stagedHint' : 'commit.smartHint') : undefined,
              onPrimary: props.syncAction === null
                ? function () { submit(props.onCommit) } : props.syncAction.run,
              options: props.syncAction !== null ? [] : [
                { id: 'commit', label: t('action.commit'),
                  disabled: props.busy || files.length === 0, run: function () { submit(props.onCommit) } },
                { separator: true },
                { id: 'push', label: t('action.commitAndPush'),
                  disabled: props.busy || files.length === 0 || props.status?.branch?.detached === true,
                  run: function () { submit(props.onCommitPush) } },
                { id: 'sync', label: t('action.commitAndSync'),
                  disabled: props.busy || files.length === 0 || !props.status?.branch?.upstream,
                  run: function () { submit(props.onCommitSync) } },
              ],
            }),
          ]),
          validation !== null
            ? h('div', { key: 'validation', className: 'dshgit-commit-validation', role: 'alert' }, validation)
            : null,
          props.aiNotice !== null && props.aiNotice !== undefined
            ? h('div', { key: 'ai', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
                t('state.aiUnavailable') + '：' + props.aiNotice)
            : null,
        ]),

        h('div', { key: 'search', className: 'dshgit-cl-search' }, [h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'), onChange: function (event) { search[1](event.currentTarget.value) } }), props.changelists ? h(ChangelistLayoutSwitch, { key: 'layout', changelists: props.changelists, t: t, busy: props.busy }) : null]),
        files.length === 0
          ? h('div', { key: 'none', className: 'dshgit-empty' }, t('commit.nothing'))
          : h('div', { key: 'lists', className: 'dshgit-commitlists' }, [
              staged.length > 0
                ? h(ChangeGroup, { key: 'staged', kind: 'staged', title: t('commit.stagedSection'),
                  busy: props.busy,
                  count: staged.length, actions: [
                    { key: 'stash', icon: 'stash', label: t('action.stashStaged'), run: function () {
                      props.onWrite('stashPush', { stagedOnly: true })
                    } },
                    { key: 'view', icon: 'viewGroup', label: t('action.viewStagedChanges'), run: props.onOpenFull },
                    { key: 'unstage', icon: 'unstage', label: t('action.unstageAll'), run: function () {
                      props.onWrite('unstage', {})
                    } },
                  ],
                }, fileList(staged, 'staged'))
                : null,
              unstaged.length > 0
                ? h(ChangeGroup, { key: 'unstaged', kind: 'unstaged', title: t('commit.unstagedSection'),
                  busy: props.busy,
                  count: unstaged.length, actions: [
                    { key: 'stash', icon: 'stash', label: t('action.stashUnstaged'), run: function () {
                      props.onWrite('stashPush', { keepIndex: true,
                        includeUntracked: unstaged.some(function (file) { return file.kind === 'untracked' }),
                      })
                    } },
                    { key: 'view', icon: 'viewGroup', label: t('action.viewChanges'), run: props.onOpenFull },
                    { key: 'discard', icon: 'discard', label: t('action.discardUnstaged'), run: function () {
                      props.requestConfirm(t('confirm.discardUnstaged'), function () {
                        props.onWrite('discardAll', {}, { confirm: true })
                      }, t('action.discard'))
                    } },
                    { key: 'stage', icon: 'stage', label: t('action.stageAll'), run: function () {
                      props.onWrite('stage', {})
                    } },
                  ],
                }, fileList(unstaged, 'unstaged'))
                : null,
            ]),

        h('div', { key: 'foot', className: 'dshgit-pickfoot' }, [
          h('button', { key: 'full', type: 'button', className: 'dshgit-pickinline', onClick: props.onOpenFull }, t('commit.openFull')),
        ]),
      ])
    }

    /**
     * A confirmation bar for a destructive write.
     *
     * The chip cluster has no room for an inline bar, so this floats under the
     * header — the same place the popovers open, for the same reason.
     *
     * @param props - `{ t, request, onCancel }`.
     */
    function ConfirmBar(props) {
      var option = React.useState(props.request.option?.checked === true)
      var panelRef = React.useRef(null)
      useDialogFocus(panelRef, props.onCancel, { opener: props.opener, cancelFirst: true })
      return ReactDOM.createPortal(
        h('div', { className: 'dshgit-scrim' + (props.centered ? ' dshgit-confirm-scrim' : ''), onClick: props.onCancel }, [
          h('div', {
            key: 'bar',
            ref: panelRef,
            tabIndex: -1,
            className: 'dshgit-confirmbar' + (props.centered ? ' dshgit-confirmbar-centered' : ''),
            role: 'alertdialog',
            'aria-modal': true,
            'aria-label': props.request.title || props.request.message,
            onClick: function (event) { event.stopPropagation() },
          }, [
            props.request.title ? h('strong', { key: 'title' }, props.request.title) : null,
            h('div', { key: 'm', className: 'dshgit-hint' }, props.request.message),
            props.request.option ? h('label', { key: 'option', className: 'dshgit-commit-check' }, [
              h('input', { key: 'check', type: 'checkbox', checked: option[0], onChange: function (event) { option[1](event.currentTarget.checked) } }), props.request.option.label,
            ]) : null,
            h('div', { key: 'a', className: 'dshgit-headline' }, [
              h('button', { key: 'ok', type: 'button', className: 'dshgit-btn ' + (props.request.danger === false ? 'dshgit-btn-primary' : 'dshgit-btn-danger'),
                onClick: function () { props.request.onConfirm(props.request.option ? option[0] : undefined) },
              }, props.request.label || props.t('action.apply')),
              h('button', { key: 'no', type: 'button', className: 'dshgit-btn',
                onClick: props.onCancel,
              }, props.t('action.cancel')),
            ]),
          ]),
        ]),
        document.body,
      )
    }

    /**
     * A small modal that asks the user to pick one of N named actions.
     *
     * Used where the two options are genuinely different outcomes rather than
     * variations of one — merging and rebasing produce different history, so the
     * plugin asks instead of picking a default on the user's behalf.
     *
     * @param props - `{ t, title, choices, onClose }`, where each choice is
     *   `{ label, hint, run }`.
     */
    function ChoiceDialog(props) {
      var panelRef = React.useRef(null)
      useDialogFocus(panelRef, props.onClose, { opener: props.opener })
      return h('div', { className: 'dshgit-modal', onClick: props.onClose }, [
        h('div', {
          key: 'dialog',
          className: 'dshgit-dialog',
          role: 'dialog',
          'data-choice-dialog': props.title,
          ref: panelRef, tabIndex: -1, 'aria-modal': true, 'aria-label': props.title,
          onClick: function (event) { event.stopPropagation() },
        }, [
          h('div', { key: 'title', className: 'dshgit-dialogtitle' }, props.title),
        ].concat(props.choices.map(function (choice, index) {
          return h('button', {
            key: 'c' + index,
            type: 'button',
            className: 'dshgit-choice',
            onClick: function () { props.onClose(); choice.run() },
          }, [
            h('span', { key: 'l', className: 'dshgit-choicelabel' }, choice.label),
            choice.hint === undefined ? null : h('span', { key: 'h', className: 'dshgit-choicehint' }, choice.hint),
          ])
        })).concat([
          h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
            h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', onClick: props.onClose },
              props.t('action.cancel')),
          ]),
        ])),
      ])
    }

    /**
     * The in-progress multi-step operation, with its way out.
     *
     * A conflicted merge/rebase/cherry-pick leaves the repository in a state where
     * most other actions fail, and `git status` looks like an ordinary dirty tree.
     * Without this panel the user is stuck with no visible exit — the worst place
     * to strand someone — so it names the operation, points at the conflicted
     * files, and offers continue/abort.
     *
     * It is a fixed panel, not a popover: a popover closes on the first outside
     * click, and the way out must not disappear while the user edits files.
     *
     * @param props - `{ t, operation, busy, onContinue, onAbort, onClose }`.
     */
    function OperationPanel(props) {
      var t = props.t
      var operation = props.operation
      var kind = operation.kind
      var labelKey = kind === 'cherry-pick' ? 'op.cherry-pick' : 'op.' + kind
      // A rebase knows its position; the others are one-shot. Showing "1/3" only
      // when it is real avoids implying a step count that does not exist.
      var title = kind === 'rebase' && operation.step !== null && operation.total !== null
        ? t('op.rebasing', { step: operation.step, total: operation.total })
        : kind === 'merge' ? t('op.merging')
          : kind === 'cherry-pick' ? t('op.cherryPicking')
            : kind === 'revert' ? t('op.reverting')
              : t('op.aming')

      return ReactDOM.createPortal(
        h('div', {
          key: 'panel',
          className: 'dshgit-oppanel',
          role: 'alertdialog',
          'data-operation': kind,
        }, [
          h('div', { key: 'head', className: 'dshgit-ophead' }, [
            h('span', { key: 'w', className: 'dshgit-opbadge' }, '⚠'),
            h('span', { key: 't', className: 'dshgit-optitle' }, title),
            h('button', {
              key: 'x', type: 'button', className: 'dshgit-iconbtn',
              title: t('action.close'), 'aria-label': t('action.close'),
              onClick: props.onClose,
            }, '✕'),
          ]),
          h('div', { key: 'hint', className: 'dshgit-hint' }, t('next.hint.resolve', { kind: t(labelKey) })),
          operation.noCommit ? h('div', { key: 'noCommit', className: 'dshgit-hint' }, t('wb.noCommit')) : null,
          h('div', { key: 'actions', className: 'dshgit-opactions' }, [
            h('button', {
              key: 'cont', type: 'button', className: 'dshgit-btn dshgit-btn-primary',
              disabled: props.busy, 'data-op-action': 'continue',
              onClick: props.onContinue,
            }, t('action.continueOp')),
            h('button', {
              key: 'abort', type: 'button', className: 'dshgit-btn dshgit-btn-danger',
              disabled: props.busy, 'data-op-action': 'abort',
              onClick: props.onAbort,
            }, t('action.abortOp')),
          ]),
        ]),
        document.body,
      )
    }

    /**
     * The session-header Git cluster: branch chip, changes chip, sync controls,
     * and the workbench launcher.
     *
     * This is the front door. It replaces the old compact "simple window"
     * entirely: the everyday facts (which branch, how much is uncommitted, am I
     * ahead or behind) live here as always-visible chips, and each chip opens a
     * popover for the actions that need more room. The workbench window stays as
     * the deep surface — blame, file history, commit graph, compare, output.
     *
     * Being chips rather than a second window is what makes the design simpler
     * AND more capable: the facts are visible without opening anything, so there
     * is no mode to remember and nothing to dismiss.
     *
     * @param props - `{ connection, sessionId, t }` from the session-scoped slot.
     */
    function HeaderGitCluster(props) {
      var t = props.t
      var stateHook = React.useState(getWindowState())
      var state = stateHook[0]
      var setState = stateHook[1]

      React.useEffect(
        function () {
          return subscribeWindow(function () { setState(getWindowState()) })
        },
        [],
      )

      // This cluster is the only place that knows which session is on screen
      // (`sessionId` arrives on the session-scoped slot props), and the window
      // itself renders in a root-scoped slot that never gets one. Publishing it
      // here is what makes "open Git" mean THIS conversation's repository.
      React.useEffect(
        function () {
          if (typeof props.sessionId !== 'string' || props.sessionId === '') return
          if (getWindowState().sessionId === props.sessionId) return
          setWindowState({ sessionId: props.sessionId })
        },
        [props.sessionId],
      )

      var open = state.mode !== 'closed'
      var minimized = open && state.minimized === true

      return h(Fragment, null, [
        // One positioned cluster, so the outcome banner can hang BELOW the chips
        // as an absolutely positioned card. Every other child here is either a
        // `position:fixed` overlay (popovers, dialogs, the viewer) or a plain
        // button, so a relative wrapper changes no existing layout.
        h('div', { key: 'cluster', className: 'dshgit-chipcluster' }, [
          h(GitStatusChips, {
            key: 'chips',
            connection: props.connection,
            // The chips re-resolve when the conversation changes, so they need the
            // id themselves — publishing it to the window store only tells the
            // RPC layer WHICH session to send, not that the answer went stale.
            sessionId: props.sessionId,
            refreshToken: state.refreshToken,
            t: t,
          }),
        ]),
        h('button', {
          key: 'launcher',
          type: 'button',
          className: 'dshgit-iconbtn',
          style: { width: '28px', height: '28px', padding: 0, gap: '6px' },
          title: minimized ? t('window.restore') : open ? t('window.focus') : t('window.open'),
          'aria-label': t('window.open'),
          'aria-pressed': open,
          onClick: function () {
            // Restore first: a minimized window must come back before anything
            // else, or the click would act on something invisible.
            if (minimized) {
              setWindowState({ minimized: false })
              return
            }
            // Clicking while open closes it rather than toggling a size: there
            // is only one window now, so the toggle has nothing to toggle.
            setWindowState({ mode: open ? 'closed' : 'full', minimized: false })
          },
        }, [
          h(IconGit, { key: 'i', size: 16 }),
          open ? h('span', { key: 'd', className: 'dshgit-dotbadge', 'aria-hidden': 'true' }) : null,
        ]),
      ])
    }

    /**
     * The Git workbench window, rendered into the frame-wide overlay slot.
     *
     * A centred, resizable dialog. It was previously a two-mode window whose
     * compact half duplicated the header chips; now the chips are the everyday
     * surface and this is the deep one.
     */
    function GitWindow(props) {
      var t = props.t
      var stateHook = React.useState(getWindowState())
      var state = stateHook[0]
      var setState = stateHook[1]

      // The window node itself, so resize math measures the element directly
      // instead of walking up from the header. `parentElement` happens to work
      // in a browser but couples the logic to the DOM's shape, and it silently
      // breaks wherever the header is not a direct child.
      var windowRef = React.useRef(null)
      var dragRef = React.useRef(null)
      var viewportState = React.useState(0)
      React.useEffect(function () {
        var update = function () { viewportState[1](function (value) { return value + 1 }) }
        window.addEventListener('resize', update)
        return function () { window.removeEventListener('resize', update) }
      }, [])

      var clampPosition = function (x, y) {
        var rect = windowRef.current?.dataset.maximized === 'true' ? null : windowRef.current?.getBoundingClientRect()
        var width = Math.min(rect?.width || state.size?.width || Math.min(1180, window.innerWidth * .94), window.innerWidth - 24)
        var height = Math.min(rect?.height || state.size?.height || Math.min(780, window.innerHeight * .88), window.innerHeight - 72)
        return { x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
          y: Math.max(56, Math.min(y, window.innerHeight - height - 12)) }
      }
      var startDrag = function (event) {
        if (state.maximized || event.button !== 0 || event.target.closest('button,input,select,textarea,a,[role="button"]')) return
        var node = windowRef.current, rect = node.getBoundingClientRect()
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
        node.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
      }
      var movePointer = function (event) {
        var drag = dragRef.current
        if (!drag) { moveResize(event); return }
        if (drag.pointerId !== event.pointerId) return
        var position = clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
        drag.position = position
        Object.assign(windowRef.current.style, { left: position.x + 'px', top: position.y + 'px', transform: 'none' })
      }
      var finishPointer = function (event) {
        var drag = dragRef.current
        if (!drag) { endResize(event); return }
        if (drag.pointerId !== event.pointerId) return
        dragRef.current = null
        if (drag.position) setWindowState({ position: drag.position })
        if (windowRef.current.hasPointerCapture(event.pointerId)) windowRef.current.releasePointerCapture(event.pointerId)
      }

      React.useEffect(
        function () {
          return subscribeWindow(function () { setState(getWindowState()) })
        },
        [],
      )

      // Escape minimizes, then closes, so a single keypress never discards the
      // user's context outright.
      React.useEffect(
        function () {
          if (state.mode === 'closed' || state.minimized === true) return undefined
          var onKey = function (event) {
            if (event.key !== 'Escape') return
            setWindowState({ minimized: true })
          }
          document.addEventListener('keydown', onKey)
          return function () { document.removeEventListener('keydown', onKey) }
        },
        [state.mode, state.minimized],
      )

      // The resize gesture is shared with the file viewer: both are centred
      // dialogs, so `beginResize`/`moveResize`/`endResizeWith` live at module
      // level and only the commit callback differs here.
      var startResize = function (event) {
        beginResize(event, windowRef)
        if (state.position && windowState.resize) {
          var bounds = windowState.resize.bounds, rect = windowRef.current.getBoundingClientRect()
          bounds.maxWidth = Math.min(bounds.maxWidth, window.innerWidth - rect.left - 12)
          bounds.maxHeight = Math.min(bounds.maxHeight, window.innerHeight - rect.top - 12)
          bounds.minWidth = Math.min(bounds.minWidth, bounds.maxWidth)
          bounds.minHeight = Math.min(bounds.minHeight, bounds.maxHeight)
        }
      }
      var endResize = function (event) {
        endResizeWith(event, function (next) { setWindowState({ size: next }) })
      }
      var visible = state.mode !== 'closed' && state.minimized !== true
      var mountedRef = React.useRef(false)
      var cachedSessionRef = React.useRef(state.sessionId)
      if (visible) cachedSessionRef.current = state.sessionId
      if (visible) mountedRef.current = true
      if (!mountedRef.current) return null

      // Keep one workbench mounted after the first open, including when minimized.
      var pill = state.mode !== 'closed' && state.minimized === true ? h('button', {
        key: 'pill', type: 'button', className: 'dshgit-pill',
        title: t('window.restore'), 'aria-label': t('window.restore'),
        onClick: function () { setWindowState({ minimized: false }) },
      }, [
        h(IconGit, { key: 'i', size: 15 }),
        h('span', { key: 'l' }, t('panel.title')),
        state.workspace ? h('span', { key: 'ws', className: 'dshgit-muted', title: state.workspace }, baseName(state.workspace)) : null,
      ]) : null

      // An explicit size, applied only after the user has actually resized:
      // until then the stylesheet's centred default (1180×780) stays in charge.
      var saved = state.size === null || state.size === undefined ? null : state.size
      var style = state.maximized || saved === null
        ? undefined
        : {
            width: saved.width + 'px',
            height: saved.height + 'px',
          }
      if (!state.maximized && state.position) {
        var position = clampPosition(state.position.x, state.position.y)
        style = Object.assign({}, style, { left: position.x + 'px', top: position.y + 'px', transform: 'none' })
      }

      var workbench = h(
        'div',
        {
          key: 'workbench',
          ref: windowRef,
          className: 'dshgit-workbench',
          role: 'dialog',
          'aria-label': t('panel.title'),
          'data-mode': state.mode,
          'data-maximized': state.maximized === true ? 'true' : 'false',
          'data-resized': saved === null ? 'false' : 'true',
          style: Object.assign({}, style, visible ? {} : { display: 'none' }),
          'aria-hidden': !visible,
          // Pointer capture is held by this node, so release and movement events
          // must be handled here even after the pointer leaves the grip.
          onPointerMove: movePointer,
          onPointerUp: finishPointer,
          onPointerCancel: finishPointer,
          onLostPointerCapture: finishPointer,
        },
        [
          h(
            'div',
            { key: 'body', className: 'dshgit-floatbody' },
            h(GitApp, { key: cachedSessionRef.current || '', active: visible, connection: props.connection, t: t, focusTab: state.tab,
              focusPath: state.historyPath, compareWith: state.compareWith,
              sessionId: cachedSessionRef.current,
              refreshToken: state.refreshToken,
              // The window chrome (minimize/close) is rendered by GitApp's title
              // bar so it sits on the same row as the repository identity, which
              // is what a workbench window looks like. The callbacks travel down
              // as props because the window state store lives up here.
              onMinimize: function () { setWindowState({ minimized: true }) },
              onDragStart: startDrag,
              maximized: state.maximized === true,
              onMaximize: function () { setWindowState({ maximized: !state.maximized }) },
              onClose: function () { setWindowState({ mode: 'closed', minimized: false }) },
            }),
          ),
          // A real control rather than the browser's native `resize` corner: it
          // is themeable, its hit area is larger than its paint, and it starts a
          // pointer-captured gesture.
          state.maximized ? null : h('button', {
            key: 'resize', type: 'button', className: 'dshgit-resize',
            title: t('window.resizeHint'), 'aria-label': t('window.resizeHint'),
            onPointerDown: startResize,
          }, h(IconResize, {})),
        ],
      )
      return h(Fragment, null, [workbench, pill])
    }

    /* ------------------------------------------------------------------ *
     * Center pane: diff, history, graph, compare
     * ------------------------------------------------------------------ */

    /** Render the main content area for the active tab. */
    function ChangelistDiffPanel(props) {
      var model = props.changelists, t = props.t, file = props.selection.file
      var patch = props.diff?.files?.find(function (entry) { return entry.path === file.path })
      var record = model.data?.chunks?.[file.path], parts = record?.parts || []
      var act = function (operation) { model.mutate(Object.assign({ path: file.path }, operation)).catch(function () {}) }
      if (!props.diff) return h('div', { className: 'dshgit-empty' }, t('state.loading'))
      return h(FileDiffCard, { file: Object.assign({}, file, patch || {}), t: t, onFileMenu: props.onFileMenu }, [
        h('div', { key: 'tools', className: 'dshgit-cl-toolbar' }, [
          h('button', { key: 'split', className: 'dshgit-rowbtn', disabled: props.busy || model.pending || model.loading || file.binary || file.kind === 'untracked' || file.kind === 'unmerged' || !!file.originalPath,
            onClick: function () { act(record ? { action: 'move', id: model.data.assignments[file.path] || model.data.active, paths: [file.path] } : { action: 'split' }) } }, t(record ? 'cl.whole' : 'cl.split')),
          parts.some(function (part) { return !part.list }) || record?.invalid ? h('span', { key: 'review', className: 'dshgit-muted' }, t('cl.reassign')) : null,
        ]),
        model.error ? h('div', { key: 'error', className: 'dshgit-cl-error', role: 'alert' }, model.error) : null,
        record && !record.invalid && parts.length === patch?.hunks?.length ? patch.hunks.map(function (hunk, index) {
          var part = parts[index]
          return h('div', { key: part.id }, [
            h('div', { key: 'bar', className: 'dshgit-cl-toolbar' }, [
              h(ChangelistCheckbox, { key: 'check', label: t('cl.chunk', { number: index + 1 }), checked: part.selected,
                disabled: props.busy || model.pending || !part.list, onChange: function (event) { act({ action: 'selectChunk', chunk: part.id, checked: event.currentTarget.checked }) } }),
              h('span', { key: 'label', className: 'dshgit-muted' }, t('cl.chunk', { number: index + 1 })),
              h('div', { key: 'list', style: { width: '180px', marginLeft: 'auto', minWidth: 0 } }, h(ComboBox, {
                t: t, value: part.list || '', placeholder: t('cl.assign'), disabled: props.busy || model.pending,
                options: model.data.lists.map(function (list) { return { value: list.id, label: list.name } }),
                onChange: function (id) { if (!props.busy && !model.pending) act({ action: 'moveChunk', chunk: part.id, id: id }) },
              })),
            ]), h(DiffBody, { key: 'diff', path: file.path, hunks: [hunk], emptyText: t('state.emptyDiff') }),
          ])
        }) : h(DiffBody, { key: 'diff', path: file.path, hunks: patch?.hunks || props.diff.hunks, emptyText: file.binary ? t('state.fileBinary') : t('state.emptyDiff') }),
      ])
    }

    function CenterPane(props) {
      var t = props.t

      if (props.selection?.kind === 'file' && props.selection.section === 'working' && props.fileDisplay === 'diff') return h(ChangelistDiffPanel, props)

      if (props.selection !== null && props.selection.kind === 'stash') {
        var stashFiles = props.diff?.files || []
        return h(Fragment, null, [
          h('div', { key: 'head', className: 'dshgit-card' },
            props.selection.ref + ' · ' + props.selection.message),
          props.diff === null ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
            : stashFiles.length === 0 ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff'))
              : stashFiles.filter(function (file) {
                return props.selection.path === null || props.selection.path === file.path
              }).map(function (file) {
                return h('div', { key: file.path }, [
                  h('div', { key: 'name', className: 'dshgit-card' }, file.path),
                  h(DiffBody, { key: 'diff', path: file.path, hunks: file.hunks, emptyText: t('state.emptyDiff') }),
                ])
              }),
        ])
      }

      if (props.selection !== null && props.selection.kind === 'revisionFile') {
        var revision = props.selection
        var revisionDiff = (props.diff?.files || []).find(function (file) { return file.path === revision.path })
        return h(Fragment, null, [
          h('div', { key: 'head', className: 'dshgit-card dshgit-previewhead' }, [
            h('button', { key: 'back', type: 'button', className: 'dshgit-btn',
              onClick: function () { props.onOpenCommit(revision.sha) },
            }, '← ' + t('label.commit')),
            h('span', { key: 'path', className: 'dshgit-previewpath', title: revision.path,
              onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, { path: revision.path }) } : undefined,
            }, revision.path),
            h('button', { key: 'diff', type: 'button', className: 'dshgit-btn',
              onClick: function () { props.setFileDisplay('diff') },
            }, t('action.viewDiff')),
            h('button', { key: 'before', type: 'button', className: 'dshgit-btn',
              onClick: function () { props.viewRevisionSide('before') },
            }, t('action.viewBefore')),
            h('button', { key: 'after', type: 'button', className: 'dshgit-btn',
              onClick: function () { props.viewRevisionSide('after') },
            }, t('action.viewAfter')),
          ]),
          props.fileDisplay === 'content'
            ? h(FilePreview, { key: 'content', blob: props.fileView,
              path: props.revisionSide === 'before' ? revision.oldPath : revision.path, t: t })
            : props.diff === null
              ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
              : h(DiffBody, { key: 'diffbody', path: revision.path, hunks: revisionDiff?.hunks || props.diff.hunks,
                emptyText: t('state.emptyDiff') }),
        ])
      }

      if (props.tab === 'graph') {
        return h(GraphView, {
          graph: props.graph,
          selection: props.selection,
          onOpenCommit: props.onOpenCommit,
          t: t,
        })
      }

      if (props.tab === 'history') {
        // Selecting a commit replaces the list, so the diff for what was just
        // clicked appears where the click happened. Leaving the list up and
        // rendering the diff behind another tab made "show me this commit" a
        // no-op, which is the single most common thing a history view is for.
        if (props.selection !== null && props.selection.kind === 'commit') {
          return h(CommitDiffView, {
            commit: props.commitDetail,
            selection: props.selection,
            diff: props.diff,
            onBack: function () { props.clearSelection() },
            onOpenRevisionFile: props.onOpenRevisionFile,
            t: t,
          })
        }
        return h(HistoryView, {
          commits: props.commits,
          selection: props.selection,
          query: props.query,
          setQuery: props.setQuery,
          historyPath: props.historyPath,
          historyRef: props.historyRef,
          onResetHistory: props.onResetHistory,
          hasMore: props.commits.length >= props.historyLimit,
          onLoadMore: props.loadMoreHistory,
          clearHistoryPath: props.clearHistoryPath,
          onOpenCommit: props.onOpenCommit,
          t: t,
        })
      }

      // The changes editor shows only the current file preview.
      var parts = []
      if (props.selection !== null && props.selection.kind === 'file') {
        parts.push(h('div', { key: 'file-head', className: 'dshgit-card dshgit-previewhead' }, [
          h('span', { key: 'path', className: 'dshgit-previewpath', title: props.selection.path,
            onContextMenu: props.onFileMenu ? function (event) { props.onFileMenu(event, props.selection.file) } : undefined,
          },
            props.selection.path + ' · ' + (props.selection.rev === 'HEAD' ? 'HEAD'
              : t(props.selection.section === 'staged' ? 'commit.stagedSection' : 'commit.unstagedSection'))),
          h('button', {
            key: 'toggle', type: 'button', className: 'dshgit-btn',
            onClick: function () {
              if (props.selection.rev === 'HEAD') props.onOpenFile(props.selection.file, 'diff', props.selection.section)
              else props.setFileDisplay(props.fileDisplay === 'content' ? 'diff' : 'content')
            },
          }, props.fileDisplay === 'content' ? t('action.viewDiff') : t('action.viewFile')),
        ]))
        if (props.fileDisplay === 'content') {
          parts.push(h(FilePreview, { key: 'file-content', blob: props.fileView, path: props.selection.path, t: t }))
          return h(Fragment, null, parts)
        }
      }

      if (props.diff === null) {
        parts.push(h('div', {
          key: 'empty',
          className: 'dshgit-empty',
        }, t(props.selection === null && props.status !== null ? 'state.noChanges' : 'state.loading')))
      } else {
        var files = props.diff.files || []
        var diffNodes = []
        for (var i = 0; i < files.length; i++) {
          diffNodes.push(h(FileDiffCard, { key: (props.selection?.section || '') + ':' + files[i].path,
            file: files[i], onFileMenu: props.onFileMenu, t: t }))
        }
        parts.push(h('div', { key: 'diff' }, diffNodes.length > 0
          ? diffNodes
          : h(DiffBody, { path: props.selection?.path, hunks: props.diff.hunks, emptyText: t('state.emptyDiff') })))
      }

      return h(Fragment, null, parts)
    }

    /**
     * One commit's full diff, shown where its row was clicked.
     *
     * The commit list is reached from two tabs (History and Graph), so the view
     * owns only the diff plus a way back — it deliberately does not reload the
     * list, which keeps "back" instant and preserves the scroll position the
     * user returns to.
     */
    function CommitDiffView(props) {
      var t = props.t
      var detail = props.commit
      var diff = props.diff
      var header = h('div', { key: 'head', className: 'dshgit-card' }, [
        h('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
          h(
            'button',
            { key: 'back', type: 'button', className: 'dshgit-btn', onClick: props.onBack },
            '← ' + t('tab.history'),
          ),
          detail === null
            ? h('span', { key: 'sha', className: 'dshgit-muted' }, props.selection.sha.slice(0, 12))
            : h('span', { key: 'sha', className: 'dshgit-muted', style: { fontFamily: 'ui-monospace, monospace' } },
                detail.shortSha ?? detail.sha.slice(0, 7)),
        ]),
        detail === null
          ? null
          : h('div', { key: 'subject', style: { fontWeight: 600, marginTop: '4px' } }, detail.subject),
        detail === null
          ? null
          : h('div', { key: 'meta', className: 'dshgit-meta' }, [
              h('span', { key: 'a' }, detail.author),
              h('span', { key: 'd', className: 'dshgit-muted' }, formatTime(detail.authorDate)),
              h('span', { key: 'f', className: 'dshgit-muted' }, t('count.files', { count: (detail.files || []).length })),
            ]),
        detail !== null && detail.message !== detail.subject
          ? h('div', { key: 'message', className: 'dshgit-hint', style: { whiteSpace: 'pre-wrap' } }, detail.message)
          : null,
      ])

      if (diff === null) {
        return h(Fragment, null, [header, h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))])
      }

      var files = diff.files || []
      if (files.length === 0) {
        return h(Fragment, null, [
          header,
          h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff')),
        ])
      }

      var nodes = []
      for (var i = 0; i < files.length; i++) {
        var file = files[i]
        nodes.push(
          h('div', { key: 'f' + i }, [
            h('div', { key: 'h', className: 'dshgit-card', style: { marginBottom: '0', cursor: 'pointer' },
              onClick: function () { props.onOpenRevisionFile(props.selection.sha, file.path, file.from) },
            }, [
              h('div', { key: 'top', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
                h('span', { key: 's', className: 'dshgit-badge' }, file.status),
                h('span', { key: 'p', className: 'dshgit-name' }, file.path),
                file.from !== null && file.from !== undefined
                  ? h('span', { key: 'f', className: 'dshgit-muted' }, '← ' + file.from)
                  : null,
              ]),
            ]),
            h(DiffBody, {
              key: 'body',
              path: file.path,
              hunks: file.hunks,
              emptyText: file.binary === true ? '（二进制文件）' : t('state.emptyDiff'),
            }),
          ]),
        )
      }
      return h(Fragment, null, [header, h('div', { key: 'files-and-diff', className: 'dshgit-commitfiles' }, [
        h('div', { key: 'nav', className: 'dshgit-commitfiles-nav' },
          (detail?.files || files).map(function (file) {
            return h('button', { key: file.path, type: 'button', className: 'dshgit-treerow',
              style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left' },
              onClick: function () { props.onOpenRevisionFile(props.selection.sha, file.path, file.from) },
            }, [h('span', { key: 'status', className: 'dshgit-status' }, file.status || 'M'), ' ', file.path])
          })),
        h('div', { key: 'diff', className: 'dshgit-commitfiles-main' }, nodes),
      ])])
    }

    /** History keeps commit navigation visible while previewing one file. */
    function HistoryCommitDetails(props) {
      var t = props.t
      var detailState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
      var pathState = React.useState(props.initialPath || null), searchState = React.useState(''), limitState = React.useState(100)
      var cacheRef = React.useRef(new Map())
      React.useEffect(function () {
        var active = true
        detailState[1](null); errorState[1](null); cacheRef.current.clear()
        props.run('commit', { root: props.repo.root, sha: props.sha }, { silentError: true })
          .then(function (value) {
            if (!active) return
            var files = (value.files || []).map(function (file) { return Object.assign({}, file, { from: file.from || file.originalPath || null }) })
            value = Object.assign({}, value, { files: files })
            detailState[1](value)
            pathState[1](function (path) { return files.some(function (file) { return file.path === path }) ? path : files[0]?.path || null })
          }).catch(function (failure) { if (active) errorState[1](failure.message) })
        return function () { active = false }
      }, [props.repo.root, props.sha, retryState[0]])
      var detail = detailState[0], files = detail?.files || []
      React.useEffect(function () {
        if (props.initialPath && files.some(function (file) { return file.path === props.initialPath })) pathState[1](props.initialPath)
      }, [props.initialPath, detail])
      var loadFile = React.useCallback(function (file, mode) {
        var key = mode + ':' + file.path, cache = cacheRef.current
        if (cache.has(key)) return cache.get(key)
        var parent = detail?.parents?.[0]
        var promise = mode === 'before' && !parent ? Promise.resolve({ exists: false, text: '', binary: false })
          : mode === 'diff' ? props.run('diff', { root: props.repo.root, commit: props.sha,
              from: parent || props.sha + '^', to: props.sha, path: file.path, originalPath: file.from }, { silentError: true })
            : props.run('fileContent', { root: props.repo.root,
                path: mode === 'before' ? file.from || file.path : file.path,
                rev: mode === 'before' ? parent : props.sha }, { silentError: true })
        cache.set(key, promise)
        promise.then(function () { while (cache.size > 64) cache.delete(cache.keys().next().value) }, function () { cache.delete(key) })
        return promise
      }, [props.repo.root, props.sha, props.run, detail])
      if (errorState[0]) return h('div', { className: 'dshgit-card', role: 'alert' }, [
        h('div', { key: 'message' }, t('history.detailFailed', { message: errorState[0] })),
        h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, t('stash.retry')),
      ])
      if (detail === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))
      var query = searchState[0].trim().toLowerCase()
      var matched = files.filter(function (file) { return !query || file.path.toLowerCase().indexOf(query) !== -1 || (file.from || '').toLowerCase().indexOf(query) !== -1 })
      var visible = matched.slice(0, limitState[0]), selected = files.find(function (file) { return file.path === pathState[0] })
      var fileMenu = props.onFileMenu ? function (event, file) { props.onFileMenu(event, file, props.sha) } : undefined
      return h('div', { className: 'dshgit-stash-details dshgit-history-details', 'data-history-commit': props.sha }, [
        h('div', { key: 'header', className: 'dshgit-card' }, [
          h('div', { key: 'heading', className: 'dshgit-history-heading' }, [
            h('div', { key: 'subject', className: 'dshgit-history-subject' }, detail.subject),
            props.onMenu ? h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn', title: t('menu.actions'), 'aria-label': t('menu.actions'),
              onClick: function (event) { props.onMenu(event, props.sha) } }, h(IconMore, { size: 16 })) : null,
          ]),
          h('div', { key: 'meta', className: 'dshgit-history-meta', title: detail.sha }, [
            h('span', { key: 'sha' }, detail.shortSha || props.sha.slice(0, 8)),
            h('span', { key: 'author' }, detail.author),
            h('span', { key: 'date' }, formatTime(detail.authorDate)),
          ]),
          (detail.parents || []).length ? h('div', { key: 'parents', className: 'dshgit-history-meta' }, [t('wb.parent') + ': ',
            detail.parents.map(function (sha) { return h('span', { key: sha, title: sha, style: { marginRight: '8px' } }, sha.slice(0, 10)) })]) : null,
          detail.message && detail.message !== detail.subject ? h('details', { key: 'message' }, [
            h('summary', { key: 'toggle' }, t('label.message')),
            h('div', { key: 'body', className: 'dshgit-hint', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, detail.message),
          ]) : null,
        ]),
        h('div', { key: 'body', className: 'dshgit-stash-detailbody' }, [
          h('div', { key: 'nav', className: 'dshgit-stash-filenav' }, [
            h('div', { key: 'count', className: 'dshgit-sidebar-head' }, t('count.files', { count: files.length })),
            h(StashFileNavigation, { key: 'files', files: visible, selected: pathState[0], onSelect: pathState[1], onFileMenu: fileMenu, t: t,
              search: h('input', { key: 'search', type: 'search', className: 'dshgit-input', value: searchState[0],
                placeholder: t('list.searchFiles'), 'aria-label': t('list.searchFiles'),
                onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) },
              }) }),
            matched.length === 0 ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, t(query ? 'list.noMatches' : 'state.emptyDiff')) : null,
            matched.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
              onClick: function () { limitState[1](limitState[0] + 100) },
            }, t('action.loadMore') + ' (' + visible.length + '/' + matched.length + ')') : null,
          ]),
          h('div', { key: 'preview', className: 'dshgit-stash-preview' }, selected
            ? h(HistoryFilePreview, { key: selected.path, file: selected, loadFile: loadFile, onFileMenu: fileMenu,
                onRestore: props.onFileRestore ? function () { props.onFileRestore(props.sha, selected.path) } : null, t: t })
            : h('div', { className: 'dshgit-empty' }, t('state.emptyDiff'))),
        ]),
      ])
    }

    function HistoryFilePreview(props) {
      var modeState = React.useState('diff'), valueState = React.useState(null), errorState = React.useState(null), retryState = React.useState(0)
      React.useEffect(function () {
        var active = true
        valueState[1](null); errorState[1](null)
        props.loadFile(props.file, modeState[0]).then(function (value) { if (active) valueState[1](value) })
          .catch(function (failure) { if (active) errorState[1](failure.message) })
        return function () { active = false }
      }, [props.file.path, props.loadFile, modeState[0], retryState[0]])
      var value = valueState[0], patch = (value?.files || []).find(function (file) { return file.path === props.file.path })
      var tools = h('div', { key: 'tools', className: 'dshgit-history-filetools' }, [
        h('div', { key: 'views', className: 'dshgit-history-viewmodes', role: 'group', 'aria-label': props.t('action.viewDiff') },
          ['diff', 'before', 'after'].map(function (mode) { return h('button', {
            key: mode, type: 'button', className: 'dshgit-iconbtn',
            title: props.t(mode === 'diff' ? 'action.viewDiff' : mode === 'before' ? 'action.viewBefore' : 'action.viewAfter'),
            'aria-label': props.t(mode === 'diff' ? 'action.viewDiff' : mode === 'before' ? 'action.viewBefore' : 'action.viewAfter'),
            'aria-pressed': modeState[0] === mode, 'data-history-view': mode, onClick: function () { modeState[1](mode) },
          }, h(IconChangeAction, { kind: mode, size: 16 })) })),
        props.onRestore ? h('div', { key: 'actions', className: 'dshgit-history-fileactions' }, h('button', {
            key: 'restore', type: 'button', className: 'dshgit-iconbtn dshgit-history-restore', title: props.t('wb.restoreRevision'), 'aria-label': props.t('wb.restoreRevision'), onClick: props.onRestore,
          }, h(IconStashApply, { size: 16 }))) : null,
      ])
      return h(Fragment, null, [
        h('div', { key: 'diff', className: 'dshgit-stash-diff' }, h(FileDiffCard, {
          file: Object.assign({}, props.file, modeState[0] === 'diff' ? patch || {} : {}), onFileMenu: props.onFileMenu, tools: tools, t: props.t,
        }, errorState[0] ? h('div', { className: 'dshgit-card', role: 'alert' }, [
          h('span', { key: 'message' }, errorState[0]),
          h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, props.t('stash.retry')),
        ]) : value === null ? h('div', { className: 'dshgit-empty' }, props.t('state.loading'))
          : modeState[0] === 'diff' ? h(DiffBody, { path: props.file.path, hunks: patch?.hunks || [], emptyText: patch?.binary || props.file.binary ? props.t('state.fileBinary') : props.t('state.emptyDiff') })
            : h(FilePreview, { blob: value, path: modeState[0] === 'before' ? props.file.from || props.file.path : props.file.path, t: props.t }))),
      ])
    }

    /** The commit message box with AI assist. */
    function CommitComposer(props) {
      var config = usePluginConfig(props.run)
      var aiEnabled = config !== null && config.aiEnabled !== false
      var t = props.t
      var lists = props.changelists?.mode === 'lists'
      var submitting = React.useState(false), submittingRef = React.useRef(false)
      // `changelists.pending` is deliberately NOT part of `blocked`. It counts
      // changelist METADATA writes — ticking a file, folding a list — and the
      // commit already serializes behind them via `flush()`. Folding it in made
      // the button grey out and snap back on every checkbox click, so the primary
      // action flickered while the user was only choosing what to commit.
      var blocked = props.busy || submitting[0] || (lists && (props.changelists.loading || !!props.status?.operation || props.status?.files?.some(function (file) { return file.kind === 'unmerged' })))
      var aiState = React.useState(false)
      var aiBusy = aiState[0]
      var setAiBusy = aiState[1]
      var aiRef = React.useRef({ busy: false, id: 0 })
      var draftRef = React.useRef(props.message)
      draftRef.current = props.message
      React.useEffect(function () {
        if (!aiEnabled) { aiRef.current.id++; aiRef.current.busy = false; setAiBusy(false) }
      }, [aiEnabled])
      React.useEffect(function () {
        return function () { aiRef.current.id++; aiRef.current.busy = false }
      }, [props.repo.root])
      var validationState = React.useState(null)
      var validation = validationState[0]
      var setValidation = validationState[1]
      var messageRef = React.useRef(null)
      var changedFiles = props.status === null ? [] : (props.status.files || [])
      var selectedPaths = lists ? props.changelists.paths : null
      var commitCount = lists ? selectedPaths.length : changedFiles.length
      var stagedCount = changedFiles.filter(isStaged).length
      var commitLabel = t(lists || changedFiles.length === 0 ? 'action.commit'
        : stagedCount > 0 ? 'action.commitStaged' : 'commit.all')
      var progressKey = { push: 'sync.pushing', pull: 'sync.pulling', fetch: 'sync.fetching', commit: 'commit.inProgress', commitPaths: 'commit.inProgress', stage: 'commit.inProgress' }[props.busyMethod] || 'state.loading'
      var upstream = props.status?.branch?.upstream
      var publish = !props.sidebar && changedFiles.length === 0 && upstream === null &&
        props.status?.branch?.head !== null && props.status?.branch?.detached !== true
      var canSync = !props.sidebar && props.status !== null && changedFiles.length === 0 && !publish &&
        (props.tracking?.ahead || 0) > 0 && (props.tracking?.behind || 0) === 0

      var sync = function () {
        props.onWrite('push', publish ? { setUpstream: true } : {}, { after: props.afterWrite })
      }

      var afterCommit = function (mode) {
        aiRef.current.id++
        aiRef.current.busy = false
        setAiBusy(false)
        props.setMessage('')
        props.afterWrite()
        setWindowState({ refreshToken: getWindowState().refreshToken + 1 })
        if (mode === 'push') {
          props.onWrite('push', upstream ? {} : { setUpstream: true }, { after: props.afterWrite })
        } else if (mode === 'sync') {
          props.onWrite('pull', { ffOnly: true }, { after: function () {
            props.onWrite('push', {}, { after: props.afterWrite })
          } })
        }
      }
      var commitStaged = function (mode) {
        props.onWrite('commit', { message: props.message }, {
          after: function () { afterCommit(mode) },
        })
      }
      var commitAll = function (mode) {
        if (changedFiles.length === 0) return
        props.onWrite('stage', {}, { after: function () { commitStaged(mode) } })
      }
      var commit = function (mode) {
        if (props.status === null) return
        if (changedFiles.length === 0) return
        if (lists) {
          if (submittingRef.current || !selectedPaths.length) return
          submittingRef.current = true; submitting[1](true)
          // `flush()` queues behind any selection write still in flight, so the
          // scope and its version come back consistent. Both are taken from the
          // RESULT: the closure's `selectedPaths` can predate that write.
          props.changelists.flush().then(function (data) {
            var paths = props.changelists.pathsFor(data)
            if (!paths.length) { setValidation(t('commit.nothing')); return null }
            return props.onWrite('commitPaths', { message: props.message, paths: paths, changelistVersion: data.version }, { after: function () { afterCommit(mode) } })
          }).catch(function (error) { setValidation(error.message) })
            .finally(function () { submittingRef.current = false; submitting[1](false) })
          return
        }
        if (stagedCount > 0) commitStaged(mode)
        else commitAll(mode)
      }
      var submit = function (mode) {
        if (blocked || commitCount === 0) return
        if (props.message.trim() === '') {
          setValidation(t('commit.requiredMessage'))
          messageRef.current?.focus?.()
          return
        }
        setValidation(null)
        commit(mode)
      }
      // The trigger for the pill: the same Smart Commit the keyboard shortcut
      // runs, so the two paths can never diverge in what they stage.
      var submitPrimary = function () { submit('commit') }

      var generate = function () {
        if (!aiEnabled || aiRef.current.busy || blocked || (lists && !commitCount)) return
        aiRef.current.busy = true
        setAiBusy(true)
        var id = ++aiRef.current.id
        var draft = draftRef.current
        props.run('ai.commitMessage', Object.assign({ root: props.repo.root }, lists ? { paths: selectedPaths, changelistVersion: props.changelists.data.version } : {}), { silentError: true })
          .then(function (value) {
            if (id !== aiRef.current.id) return
            if (value.available === false) {
              props.setAiNotice(value.message)
              return
            }
            if (value.empty === true) {
              props.setAiNotice(value.reason || '没有可提交的改动')
              return
            }
            if (draftRef.current === draft) props.setMessage(value.message)
            props.setAiNotice(null)
          })
          .catch(function (failure) {
            if (id === aiRef.current.id) props.setAiNotice(failure.message)
          })
          .finally(function () {
            if (id !== aiRef.current.id) return
            aiRef.current.busy = false
            setAiBusy(false)
          })
      }

      return h('div', { className: 'dshgit-card dshgit-commit-composer' }, [
        // The AI trigger lives inside the field's top-right corner, so it reads
        // as "fill this box" instead of as a second commit-adjacent action.
        h('div', { key: 'field', className: 'dshgit-commit-field', 'data-ai': aiEnabled }, [
          h('textarea', {
            key: 'msg',
            ref: messageRef,
            className: 'dshgit-textarea',
            value: props.message,
            placeholder: t('commit.placeholderMessage'),
            onKeyDown: function (event) {
              if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault(); event.stopPropagation?.()
                if (!event.repeat) submitPrimary()
              }
            },
            readOnly: blocked,
            onChange: function (event) { draftRef.current = event.currentTarget.value; props.setMessage(event.currentTarget.value); setValidation(null) },
          }),
          aiEnabled ? h(
            'button',
            {
              key: 'ai',
              disabled: aiBusy || blocked || (lists && !commitCount),
              'aria-busy': aiBusy,
              type: 'button',
              className: 'dshgit-commit-ai',
              onClick: generate,
              title: t('action.generateMessage'), 'aria-label': t('action.generateMessage'),
            },
            aiBusy ? h('span', { key: 'busy', className: 'dshgit-spinner', 'aria-hidden': true })
              : h('span', { key: 'icon', 'aria-hidden': true }, '✨'),
          ) : null,
        ]),
        validation !== null
          ? h('div', { key: 'validation', className: 'dshgit-commit-validation', role: 'alert' }, validation)
          : null,
        // Scope and action share one row: "2 个文件" is the answer to "what will
        // this commit?", so it belongs beside the button that commits it rather
        // than on a line of its own.
        h('div', { key: 'row', className: 'dshgit-commit-meta' }, [
          h('span', { key: 'info', className: 'dshgit-muted', title: lists ? t('cl.fullFile') : undefined }, t(lists ? 'cl.selected' : 'window.staged', { count: lists ? commitCount : stagedCount })),
          h(CommitActions, {
            key: 'commit', t: t, shortcut: !publish && !canSync,
            // The spinner and the progress label are two halves of one fact — that
            // THIS button's action is running — so they share one condition. It is
            // deliberately not `blocked`: that also covers a changelist metadata
            // write (ticking a file), which is not a commit.
            pending: props.busy || submitting[0],
            label: props.busy || submitting[0] ? t(progressKey)
              : publish ? t('next.publish') : canSync ? t('action.sync') : commitLabel,
            disabled: blocked || (!publish && !canSync && commitCount === 0),
            hint: !publish && !canSync ? t(lists ? 'cl.fullFile' : stagedCount > 0 ? 'commit.stagedHint' : 'commit.smartHint') : undefined,
            onPrimary: publish || canSync ? sync : submitPrimary,
            options: publish || canSync ? [] : [
              { id: 'commit', label: t('action.commit'),
                disabled: blocked || commitCount === 0, run: submitPrimary },
              { separator: true },
              { id: 'push', label: t('action.commitAndPush'),
                disabled: blocked || commitCount === 0 || props.status?.branch?.detached === true,
                run: function () { submit('push') } },
              { id: 'sync', label: t('action.commitAndSync'),
                disabled: blocked || commitCount === 0 || !upstream,
                run: function () { submit('sync') } },
            ],
          }),
        ]),
        props.aiNotice !== null && props.aiNotice !== undefined
          ? h('div', { key: 'notice', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
              t('state.aiUnavailable') + '：' + props.aiNotice)
          : null,
      ])
    }

    /**
     * The history module's sidebar: the searchable commit list.
     *
     * This is the old full-page history view minus its own padding assumptions —
     * the list was always the navigational half of that screen, so it moves into
     * the sidebar unchanged while the diff moves to the editor.
     */
    function HistoryScope(props) {
      var ref = props.historyRef || 'HEAD'
      return h('div', { className: 'dshgit-sidebar-hint dshgit-history-scope' }, [
        h('span', { key: 'ref', className: 'dshgit-name', title: ref }, props.t('tree.commits') + ' · ' + ref.replace(/^refs\/(heads|remotes|tags)\//, '')),
        ref !== 'HEAD' && props.onResetHistory ? h('button', {
          key: 'reset', type: 'button', className: 'dshgit-iconbtn',
          title: props.t('wb.returnHead'), 'aria-label': props.t('wb.returnHead'),
          onClick: props.onResetHistory,
        }, svg({ size: 16 }, h('path', { d: 'M7 3L2 8l5 5M2 8h12', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))) : null,
      ])
    }

    function HistorySidebar(props) {
      var t = props.t
      return h(Fragment, null, [
        h(HistoryScope, { key: 'ref', historyRef: props.historyRef, onResetHistory: props.onResetHistory, t: t }),
        h('div', { key: 'search', className: 'dshgit-sidebar-search' }, [
          h('input', {
            key: 'q',
            type: 'search', 'aria-label': t('placeholder.search'),
            className: 'dshgit-input',
            value: props.query,
            placeholder: t('placeholder.search'),
            onChange: function (event) { props.setQuery(event.currentTarget.value) },
          }),
        ]),
        // A path filter is active only after "File history" was chosen, so the
        // chip is shown only then rather than as a permanent empty row.
        props.historyPath
          ? h('div', { key: 'path', className: 'dshgit-filterchip', title: props.historyPath }, [
              h('span', { key: 'n', className: 'dshgit-name' }, props.historyPath),
              h('button', {
                key: 'x', type: 'button', className: 'dshgit-iconbtn',
                title: t('action.close'), 'aria-label': t('action.close'),
                onClick: props.clearHistoryPath,
              }, '×'),
            ])
          : null,
        props.error ? h('div', { key: 'error', className: 'dshgit-sidebar-hint', role: 'alert' }, [
          h('div', { key: 'message' }, t('history.loadFailed', { message: props.error })),
          h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: props.onRetry }, t('stash.retry')),
        ]) : props.loading && props.commits.length === 0
          ? h('div', { key: 'loading', className: 'dshgit-empty' }, t('state.loading'))
          : props.commits.length === 0
          ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits'))
          : h('div', { key: 'list', className: 'dshgit-history-list', 'aria-busy': props.loading }, props.commits.map(function (commit) {
              var selected = props.selection !== null && (props.selection.kind === 'commit' || props.selection.kind === 'revisionFile') && props.selection.sha === commit.sha
              return h(
                'button',
                {
                  key: commit.sha,
                  type: 'button', 'aria-pressed': selected,
                  className: 'dshgit-commitrow',
                  'data-selected': selected,
                  title: commit.sha + '\n' + commit.subject + '\n' + commit.author + ' · ' + formatTime(commit.authorDate) + ((commit.tips || []).length ? '\n' + commit.tips.join(', ') : ''),
                  onClick: function () { props.onOpenCommit(commit.sha) },
                  onContextMenu: props.onMenu ? function (event) { props.onMenu(event, commit.sha) } : undefined,
                },
                [
                  h('div', { key: 's', className: 'dshgit-subject' }, commit.subject),
                  h('div', { key: 'm', className: 'dshgit-meta' }, [
                    h('span', { key: 'a' }, commit.author),
                    h('span', { key: 'd' }, formatRelative(commit.authorDate)),
                  ]),
                ],
              )
            })),
        props.hasMore ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn',
          disabled: props.loading, 'aria-busy': props.loading,
          style: { margin: '8px 10px' },
          onClick: props.onLoadMore,
        }, props.loading ? t('state.loading') : t('action.loadMore')) : null,
      ])
    }

    /**
     * The graph module's sidebar: what the lanes mean.
     *
     * A graph with no legend is unreadable — the reader cannot tell a branch tip
     * from a merge. These counts plus the branch-tip list are the minimum needed
     * to interpret the lanes in the editor.
     */
    function readWorkbenchStorage(key, fallback) {
      try {
        var value = JSON.parse(localStorage.getItem('dshgit:wb:' + key))
        if (value === null || (Array.isArray(fallback) && !Array.isArray(value))) return fallback
        if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && (typeof value !== 'object' || Array.isArray(value))) return fallback
        return value
      }
      catch (error) { return fallback }
    }
    function writeWorkbenchStorage(key, value) { try { localStorage.setItem('dshgit:wb:' + key, JSON.stringify(value)) } catch (error) {} }

    function workbenchUpstream(branch) {
      return branch.upstreamRef || (branch.upstream ? (branch.upstream.startsWith('refs/') ? branch.upstream : 'refs/remotes/' + branch.upstream) : '')
    }

    function workbenchBranchItems(branch, api) {
      var remote = branch.ref.startsWith('refs/remotes/'), current = !remote && branch.name === api.current
      var commands = {
        checkout: 'checkout', createBranch: 'branch / checkout', createTag: 'tag', merge: 'merge', rebase: 'rebase',
        renameBranch: 'branch', push: 'push', pull: current ? 'pull' : 'fetch', setUpstream: 'branch', deleteBranch: remote ? 'push' : 'branch', fetch: 'fetch', addWorktree: 'worktree add',
      }
      var op = function (action, disabled) { return { id: action, label: api.t('wb.' + action), command: commands[action],
        hint: action === 'addWorktree' && disabled ? api.t('wb.worktreeUnsupported') : (action === 'pull' || action === 'fetch') && disabled ? api.t(action === 'pull' && branch.occupied ? 'wb.occupied' : 'wb.pullNeedsUpstream') : undefined, disabled: api.busy || disabled,
        run: function () { api.workflow(action, branch) } } }
      return [
        { id: 'history', label: api.t('wb.history'), command: 'log', run: function () { api.history(branch) } },
        { id: 'incoming', label: api.t('wb.incoming'), command: 'log', run: function () { api.history(branch, true) } },
        { id: 'outgoing', label: api.t('wb.outgoing'), command: 'log', run: function () { api.history(branch, 'outgoing') } },
        { id: 'compare', label: api.t('wb.compare'), command: 'diff', run: function () { api.compare(branch) } },
        { separator: true }, op('checkout', current || branch.occupied), op('createBranch'), op('createTag'), op('merge', current),
        op('rebase', current), op('addWorktree', api.worktreesSupported === false),
        { separator: true },
      ].concat(remote ? [{ id: 'fetch', label: api.t('wb.fetchBranch'), command: 'fetch', disabled: api.busy, run: function () { api.workflow('fetch', branch) } },
        { id: 'fetchPrune', label: api.t('wb.fetchPrune'), command: 'fetch', hint: api.t('wb.fetchPruneHint'), disabled: api.busy, run: function () { api.workflow('fetch', branch, { prune: true }) } }]
        : [op('renameBranch', branch.occupied && !current), op('push'), op('pull', !!branch.occupied || !(branch.upstreamRef || branch.upstream)),
          op('fetch', !/^refs\/remotes\//.test(workbenchUpstream(branch))), op('setUpstream')]).concat([
        { id: 'favorite', label: api.t('wb.favorite'), run: api.favorite },
        { id: 'copy', label: api.t('wb.copy'), run: function () { api.copy(branch.name) } },
        { separator: true }, op('deleteBranch', current || branch.occupied),
      ])
    }

    function workbenchCommitItems(sha, api) {
      var latest = sha === api.head
      var commands = { createBranch: 'branch / checkout', createTag: 'tag', cherryPick: 'cherry-pick', revert: 'revert', undoCommit: 'reset', commit: 'commit', resetTo: 'reset' }
      var op = function (action, disabled, hint) { return { id: action, label: api.t('wb.' + action), command: commands[action], disabled: api.busy || disabled, hint: hint,
        run: function () { api.workflow(action, { sha: sha }) } } }
      return [{ id: 'copy', label: api.t('wb.copy'), run: function () { api.copy(sha) } },
        { id: 'compare', label: api.t('wb.compare'), command: 'diff', run: api.compare }, { separator: true },
        op('createBranch'), op('createTag'), op('cherryPick', api.detached || api.commit?.parents.length > 1, api.t('wb.parent')), op('revert', api.detached), { separator: true },
        op('undoCommit', !latest || api.detached || (api.commit && !api.commit.parents.length), api.t('wb.rootUndo')),
        op('commit', !latest || api.detached), op('resetTo', api.detached)]
    }

    function WorkbenchBranchSidebar(props) {
      var t = props.t, search = React.useState('')
      var mergeFilter = React.useState('all')
      var refreshing = React.useState(false), refreshPending = React.useRef(false)
      var refreshBranches = function () {
        if (refreshPending.current || props.busy || props.refreshing) return
        refreshPending.current = true; refreshing[1](true)
        Promise.resolve().then(function () { return props.onRefresh() }).catch(function () {}).finally(function () {
          refreshPending.current = false; refreshing[1](false)
        })
      }
      var folded = React.useState({})
      var favorites = [readWorkbenchStorage('favorites:' + props.root, [])]
      var query = search[0].trim().toLowerCase(), all = [].concat(props.refs?.branches || [], props.refs?.remotes || []).filter(function (branch, index, list) {
        // Older hosts omit symref and shorten origin/HEAD to just origin.
        return !branch.symbolic && /^refs\/(heads|remotes)\/[^/]+(?:\/[^/]+)*$/.test(branch.ref || '') && !/^refs\/remotes\/.+\/HEAD$/.test(branch.ref)
          && list.findIndex(function (other) { return other.ref === branch.ref }) === index
      })
      var branches = all.map(function (branch) {
        var normalizedRoot = props.root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
        var occupied = (props.worktrees || []).find(function (tree) { return tree.branch === branch.ref && tree.path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() !== normalizedRoot })
        var remote = (props.remotes || []).filter(function (remote) { return branch.ref.startsWith('refs/remotes/' + remote.name + '/') })
          .sort(function (a, b) { return b.name.length - a.name.length })[0]
        return Object.assign({}, branch, { name: branch.ref.replace(/^refs\/(heads|remotes)\//, ''), remoteName: remote?.name, occupied: occupied?.path || null })
      })
      var matches = branches.filter(function (branch) { return (!query || branch.name.toLowerCase().includes(query))
        && (mergeFilter[0] === 'all' || branch.merged === (mergeFilter[0] === 'merged')) })
      var matchedTags = mergeFilter[0] === 'all' ? (props.refs?.tags || []).filter(function (tag) { return !query || tag.name.toLowerCase().includes(query) }) : []
      var branchGroup = function (branch) {
        if (branch.ref.startsWith('refs/heads/')) return 'local'
        var remote = (props.remotes || []).filter(function (remote) { return branch.ref.startsWith('refs/remotes/' + remote.name + '/') })
          .sort(function (a, b) { return b.name.length - a.name.length })[0]
        return 'remote:' + (remote ? remote.name : branch.name.split('/')[0])
      }
      var folder = function (key, label, children, prefix) {
        var defaultOpen = key === 'locals' || key === 'remotes' || (props.remotes || []).some(function (remote) { return key === 'remote:' + remote.name })
        var remote = (props.remotes || []).find(function (entry) { return key === 'remote:' + entry.name })
        var menu = function (event) { event.preventDefault(); event.stopPropagation?.(); props.onMenu(event, { name: label, folder: true, prefix: prefix || '', remoteName: remote?.name }) }
        return h('details', { key: key, className: 'dshgit-branch-folder', open: query ? true : folded[0][key] === undefined ? defaultOpen : folded[0][key] === true,
          onToggle: function (event) { if (query) return; var open = event.currentTarget.open
            folded[1](function (value) { if (value[key] === open) return value; var next = Object.assign({}, value); next[key] = open; return next }) },
        }, [h('summary', { key: 'label', onContextMenu: menu }, [h('span', { key: 'caret', className: 'dshgit-branch-caret', 'aria-hidden': true }, h(IconChevron, { size: 12 })),
          h('span', { key: 'name', className: 'dshgit-name', title: label }, label),
          remote ? h('span', { key: 'actions', className: 'dshgit-remote-actions dshgit-branch-actions',
            'data-busy': props.busyAction === 'fetch' && props.busyRef === key,
          }, ['fetch', 'prune'].map(function (action) {
            var prune = action === 'prune', label = t(prune ? 'wb.pruneRemote' : 'wb.fetch')
            var command = 'git fetch ' + (prune ? '--prune ' : '') + remote.name
            return h('button', { key: action, type: 'button', className: 'dshgit-iconbtn',
              title: label + ' · ' + command, 'aria-label': label + ' · ' + remote.name,
              'data-remote-action': action, 'data-remote-target': remote.name, disabled: props.busy,
              onClick: function (event) { event.preventDefault(); event.stopPropagation(); props.onFetch(remote.name, prune) },
            }, h(prune ? IconSweep : IconBranchSync, { size: 16, kind: 'fetch', horizontal: true }))
          })) : null,
        ]), h('div', { key: 'children', className: 'dshgit-branch-children' }, children)])
      }
      var leaf = function (branch, name) {
        var current = branch.head === true, selected = props.selected === branch.ref
        var upstream = branch.ref.startsWith('refs/heads/') ? workbenchUpstream(branch).replace(/^refs\/(remotes|heads)\//, '') : ''
        return h('div', { key: branch.ref, className: 'dshgit-branch-item', 'data-selected': selected,
          'data-busy': props.busyAction && props.busyRef === branch.ref,
          onContextMenu: function (event) { props.onMenu(event, branch) },
        }, [h('button', { key: 'select', type: 'button', className: 'dshgit-branch-select', 'data-branch-ref': branch.ref, 'aria-pressed': selected,
          title: branch.name + (upstream ? '\n' + t('wb.upstream') + ': ' + upstream : '') + (branch.occupied ? '\n' + t('wb.occupied') + ': ' + branch.occupied : ''),
          onClick: function () { props.onSelect(branch) }, onDoubleClick: function () { if (!current && !branch.occupied && !props.busy) props.onWorkflow('checkout', branch) },
        }, [current ? h('span', { key: 'current', className: 'dshgit-tipdot', 'aria-label': t('wb.current') }) : h(IconBranch, { key: 'icon', size: 12 }),
          h('span', { key: 'name', className: 'dshgit-name' }, name),
          branch.ahead || branch.behind ? h('span', { key: 'tracking', className: 'dshgit-muted dshgit-branch-tracking' }, (branch.ahead ? '↑' + branch.ahead : '') + (branch.behind ? ' ↓' + branch.behind : '')) : null,
          upstream ? h('span', { key: 'upstream', className: 'dshgit-muted dshgit-branch-upstream', title: t('wb.upstream') + ': ' + upstream }, '↔ ' + upstream) : null,
        ]), h('div', { key: 'actions', className: 'dshgit-branch-actions' }, (branch.ref.startsWith('refs/remotes/') ? ['checkout', 'fetch', 'createBranch', 'more'] : ['checkout', 'push', 'pull', 'fetch', 'more']).map(function (action) {
          var unavailable = action === 'pull' && (!!branch.occupied || !(branch.upstreamRef || branch.upstream))
          if (action === 'checkout') unavailable = current || !!branch.occupied
          if (action === 'fetch' && branch.ref.startsWith('refs/heads/')) unavailable = !/^refs\/remotes\//.test(workbenchUpstream(branch))
          var label = t(action === 'more' ? 'menu.actions' : action === 'fetch' ? (branch.ref.startsWith('refs/remotes/') ? 'wb.fetchBranch' : branch.upstreamRef || branch.upstream ? 'wb.fetchLocal' : 'wb.fetch') : 'wb.' + action)
          var hint = unavailable ? t(action === 'pull' && branch.occupied ? 'wb.occupied' : 'wb.pullNeedsUpstream') : label
          if (action === 'checkout' && unavailable) hint = t(current ? 'wb.current' : 'wb.occupied')
          return h('button', { key: action, type: 'button', className: 'dshgit-iconbtn', title: hint,
            'aria-label': label, 'data-branch-action': action, 'data-branch-target': branch.ref,
            'aria-busy': props.busyAction === action && props.busyRef === branch.ref,
            disabled: action !== 'more' && (props.busy || unavailable),
            onClick: function (event) { if (action === 'more') props.onMenu(event, branch); else props.onWorkflow(action, branch) },
          }, props.busyAction === action && props.busyRef === branch.ref ? h('span', { className: 'dshgit-spinner' })
            : h(action === 'more' ? IconMore : action === 'checkout' || action === 'createBranch' ? IconBranchAction : IconBranchSync, { size: 16, kind: action, horizontal: true }))
        }))])
      }
      var tree = function (items, prefix) {
        var node = { dirs: Object.create(null), files: [] }
        items.forEach(function (branch) {
          var name = branch.ref.slice((prefix ? 'refs/remotes/' + prefix + '/' : 'refs/heads/').length)
          if (!name || name.split('/').some(function (part) { return !part })) return
          var parts = name.split('/'), current = node
          parts.slice(0, -1).forEach(function (part) { if (!current.dirs[part]) current.dirs[part] = { dirs: Object.create(null), files: [] }; current = current.dirs[part] })
          current.files.push({ branch: branch, name: parts[parts.length - 1] })
        })
        var render = function (entry, path) {
          return Object.keys(entry.dirs).sort().map(function (name) {
            var child = entry.dirs[name], label = name, full = path ? path + '/' + name : name
            while (!child.files.length && Object.keys(child.dirs).length === 1) { var next = Object.keys(child.dirs)[0]; label += '/' + next; full += '/' + next; child = child.dirs[next] }
            return folder((prefix ? 'remote:' + prefix : 'local:') + ':' + full, label, render(child, full), full)
          }).concat(entry.files.sort(function (a, b) { return a.name.localeCompare(b.name) }).map(function (entry) { return leaf(entry.branch, entry.name) }))
        }
        return render(node, '')
      }
      var favorited = matches.filter(function (branch) { return favorites[0].includes(branch.ref) })
      var selectCurrent = function () {
        var branch = branches.find(function (branch) { return branch.head })
        if (!branch) return
        search[1](''); mergeFilter[1]('all')
        var next = { locals: true }, parts = branch.name.split('/')
        parts.slice(0, -1).forEach(function (_, index) { next['local::' + parts.slice(0, index + 1).join('/')] = true })
        folded[1](next); props.onSelect(branch)
      }
      React.useEffect(function () {
        var node = document.querySelector?.('[data-branch-ref="' + String(props.selected || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]')
        node?.scrollIntoView?.({ block: 'nearest' })
      }, [props.selected, search[0]])
      return h(Fragment, null, [
        h('div', { key: 'tools', className: 'dshgit-branch-tools dshgit-branch-toolbar' }, [
          h('button', { key: 'new', type: 'button', className: 'dshgit-iconbtn', title: t('wb.createBranch'), 'aria-label': t('wb.createBranch'), disabled: props.busy,
            onClick: function () { props.onWorkflow('createBranch') } }, h(IconChangeAction, { kind: 'stage' })),
          h('button', { key: 'refresh', type: 'button', className: 'dshgit-iconbtn', title: t('wb.refreshBranches'), 'aria-label': t('wb.refreshBranches'),
            disabled: props.busy || props.refreshing || refreshing[0], 'aria-busy': refreshing[0] || props.refreshing,
            onClick: refreshBranches }, refreshing[0] || props.refreshing ? h('span', { className: 'dshgit-spinner', 'aria-hidden': true }) : h(IconChangeAction, { kind: 'refresh' })),
          h('button', { key: 'locate', type: 'button', className: 'dshgit-iconbtn', title: t('wb.locate'), 'aria-label': t('wb.locate'), onClick: selectCurrent }, h(IconBranch, { size: 16 })),
          h('button', { key: 'reflog', type: 'button', className: 'dshgit-iconbtn', title: t('wb.reflogHint'), 'aria-label': t('wb.reflog'), onClick: props.onReflog }, h(IconHistory, { size: 18 })),
        ]),
        h('div', { key: 'search', className: 'dshgit-sidebar-search dshgit-branch-search' }, [
          h('input', { key: 'input', type: 'search', className: 'dshgit-input', value: search[0], placeholder: t('wb.search'), 'aria-label': t('wb.search'),
            onChange: function (event) { search[1](event.currentTarget.value) } }),
          h(Menu, { key: 'filter', t: t, portal: true, align: 'right', title: t('wb.branchFilter'), triggerClass: 'dshgit-iconbtn',
            rootClass: mergeFilter[0] !== 'all' ? 'dshgit-branch-filter-active' : undefined,
            label: svg({ size: 16 }, h('path', { d: 'M2 3h12M4 8h8M6 13h4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
            items: ['all', 'merged', 'unmerged'].map(function (value) { return {
              id: value, label: (mergeFilter[0] === value ? '✓ ' : '') + t('wb.' + (value === 'all' ? 'allBranches' : value === 'merged' ? 'mergedBranches' : 'unmergedBranches')),
              run: function () { mergeFilter[1](value) },
            } }),
          }),
        ]),
        mergeFilter[0] !== 'all' ? h('div', { key: 'mergeFilter', className: 'dshgit-filterchip' }, [
          h('span', { key: 'label', className: 'dshgit-name' }, t('wb.' + (mergeFilter[0] === 'merged' ? 'mergedBranches' : 'unmergedBranches'))),
          h('button', { key: 'clear', type: 'button', className: 'dshgit-iconbtn', title: t('action.close'), 'aria-label': t('action.close'),
            onClick: function () { mergeFilter[1]('all') } }, '×'),
        ]) : null,
        mergeFilter[0] !== 'all' && branches.some(function (branch) { return typeof branch.merged !== 'boolean' }) ? h('div', { key: 'mergeUnknown', className: 'dshgit-sidebar-hint' }, t('wb.mergedUnknown')) : null,
        readWorkbenchStorage('fetch:' + props.root, null) ? h('div', { key: 'lastFetch', className: 'dshgit-sidebar-hint' }, t('wb.fetched') + ' · ' + new Date(readWorkbenchStorage('fetch:' + props.root, null)).toLocaleString()) : null,
        h('div', { key: 'tree', className: 'dshgit-branch-tree' }, props.refs === null ? h('div', { className: 'dshgit-empty' }, t('state.loading')) : [
          favorited.length ? folder('favorites', t('wb.favorites'), favorited.map(function (branch) { return leaf(branch, branch.name) })) : null,
          folder('locals', t('wb.local') + ' (' + (query || mergeFilter[0] !== 'all' ? matches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }).length + '/' : '') + branches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }).length + ')',
            tree(matches.filter(function (branch) { return branch.ref.startsWith('refs/heads/') }), '')),
          folder('remotes', t('wb.remote'), (props.remotes || []).map(function (remote) {
            var group = 'remote:' + remote.name
            var items = matches.filter(function (branch) { return branchGroup(branch) === group })
            return folder(group, remote.name, items.length ? tree(items, remote.name)
              : h('div', { className: 'dshgit-sidebar-hint' }, [t(query || mergeFilter[0] !== 'all' ? 'list.noMatches' : 'wb.emptyRemote'),
                query || mergeFilter[0] !== 'all' ? null : h('button', { type: 'button', className: 'dshgit-iconbtn', disabled: props.busy, onClick: function () { props.onFetch(remote.name) } }, t('action.fetch'))]))
          })),
          mergeFilter[0] === 'all' ? folder('tags', t('wb.tags'), matchedTags.map(function (tag) {
            return h('button', { key: tag.ref, type: 'button', className: 'dshgit-rowbtn dshgit-row', onClick: function () { props.onSelect(tag) }, title: tag.ref }, tag.name)
          })) : null,
          matches.length === 0 && matchedTags.length === 0 && (query || mergeFilter[0] !== 'all') ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, t('list.noMatches')) : null,
        ]),
      ])
    }

    /** Reviewed operations share the same snapshot and confirmation surface. */
    function WorkbenchDialog(props) {
      var t = props.t, request = props.request, subject = request.subject || {}, action = request.action
      var remoteBranch = /^refs\/remotes\//.test(subject.ref || '')
      var fixedRemoteStart = remoteBranch && action === 'createBranch'
      var remoteName = remoteBranch ? subject.remoteName || subject.ref.slice(13).split('/')[0] : ''
      var localName = remoteBranch ? subject.ref.slice(14 + remoteName.length) : (subject.name || '')
      var upstreamRef = subject.upstreamRef || (subject.upstream ? (subject.upstream.startsWith('refs/') ? subject.upstream : 'refs/remotes/' + subject.upstream) : '')
      var worktreeNeedsBranch = remoteBranch || subject.head || subject.occupied
      var valuesState = React.useState({ name: action === 'addWorktree' ? localName + '-worktree' : action === 'createTag' ? '' : action === 'renameBranch' ? localName : remoteBranch ? localName : (request.extras || {}).prefix || '',
        directory: '', newBranch: !!worktreeNeedsBranch,
        startPoint: subject.ref || subject.sha || 'HEAD', checkout: true, track: remoteBranch, existing: '',
        mode: 'soft', pullStrategy: 'ff', backup: ['resetTo', 'undoCommit', 'rebase', 'commit'].indexOf(action) >= 0,
        stash: false, acknowledge: false, force: false, noFf: false, noCommit: false, mainline: '1',
        message: '', remote: remoteName || (request.extras || {}).remote || '', targetBranch: localName, upstream: upstreamRef, prune: false })
      var values = valuesState[0], previewState = React.useState(null), preview = previewState[0]
      var errorState = React.useState(''), loadingState = React.useState(true), busyState = React.useState(false)
      var remotesState = React.useState([]), retryState = React.useState(0), panel = React.useRef(null)
      var pending = React.useRef(false)
      var close = function () { if (!pending.current) props.onClose() }
      useDialogFocus(panel, close)
      var set = function (key, value) { valuesState[1](function (old) {
        var next = Object.assign({}, old); next[key] = value
        if (key === 'startPoint' && /^refs\/remotes\//.test(value)) {
          next.track = true
          if (!old.name) next.name = value.slice(13).split('/').slice(1).join('/')
        }
        return next
      }) }
      var refs = props.refs || {}, locals = refs.branches || [], remotes = (refs.remotes || []).filter(function (ref) { return !ref.symbolic })
      var proposedName = values.name.trim(), nameError = ''
      var needsName = action === 'renameBranch' || action === 'createBranch' || action === 'createTag' || (action === 'addWorktree' && values.newBranch) || (action === 'checkout' && remoteBranch && !values.existing)
      var directoryValid = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(values.directory.trim()) && !/[\0\r\n]/.test(values.directory)
      if (needsName && proposedName) {
        var nameRefs = action === 'createTag' ? refs.tags || [] : locals
        if (/^[\-\/]|\/$|\/\/|\.\.|@\{|[\s\x00-\x1f\x7f~^:?*\[\\]/.test(proposedName) || proposedName === '@' || (action !== 'createTag' && proposedName === 'HEAD') || proposedName.endsWith('.') || proposedName.split('/').some(function (part) { return part.startsWith('.') || part.endsWith('.lock') })) nameError = t(action === 'createTag' ? 'wb.invalidTagName' : 'wb.invalidName')
        else if (nameRefs.some(function (ref) { return ref.name !== (action === 'renameBranch' ? subject.name : null) && (ref.name === proposedName || ref.name.startsWith(proposedName + '/') || proposedName.startsWith(ref.name + '/')) })) nameError = t(action === 'createTag' ? 'wb.tagNameConflict' : 'wb.nameConflict')
      }
      var target = action === 'createBranch' || (action === 'checkout' && remoteBranch) ? values.startPoint : subject.ref || subject.sha
      var previewKey = JSON.stringify([target, values.upstream, values.existing, values.mainline])
      var ready = preview && preview.reviewKey === previewKey
      var branchFiles = props.status?.files || preview?.files || []
      var branchDirty = props.status ? branchFiles.length > 0 : !!preview?.dirty
      var otherBranchPull = action === 'pull' && preview && preview.branch !== subject.ref && preview.branch !== subject.name
      React.useEffect(function () {
        var active = true
        if (action === 'createBranch') return
        props.run('remotes', { root: props.repo.root }, { silentError: true }).then(function (result) {
          if (!active) return
          var list = Array.isArray(result) ? result : result.remotes || []
          remotesState[1](list)
          var upstreamRemote = list.filter(function (remote) { return upstreamRef.startsWith('refs/remotes/' + remote.name + '/') }).sort(function (a, b) { return b.name.length - a.name.length })[0]
          if (!values.remote && list.length) {
            set('remote', upstreamRemote ? upstreamRemote.name : list[0].name)
            if (action === 'push' && upstreamRemote) set('targetBranch', upstreamRef.slice(14 + upstreamRemote.name.length))
          }
        }).catch(function () {})
        return function () { active = false }
      }, [props.repo.root])
      React.useEffect(function () {
        var active = true
        loadingState[1](true); errorState[1](''); previewState[1](null)
        var references = values.upstream ? [values.upstream] : []
        if (values.existing) references.push('refs/heads/' + values.existing)
        props.run('workbenchPreview', { root: props.repo.root, target: target, refs: references, action: action, path: subject.path, mainline: Number(values.mainline) }, { silentError: true }).then(function (result) {
          if (!active) return
          previewState[1](Object.assign({}, result, { reviewKey: previewKey })); loadingState[1](false)
          if ((action === 'commit' || action === 'undoCommit') && result.commit && !values.message) set('message', result.commit.message || result.commit.subject)
          if (action === 'revert' && result.commit && !values.message) set('message', 'Revert "' + result.commit.subject + '"\n\nThis reverts commit ' + result.commit.sha + '.')
        }).catch(function (failure) { if (active) { errorState[1](failure.message); loadingState[1](false) } })
        return function () { active = false }
      }, [props.repo.root, target, values.upstream, values.existing, values.mainline, retryState[0]])
      var field = function (key, label, options) {
        return h('label', { key: key, className: 'dshgit-workbench-field' }, [h('span', { key: 'label' }, label),
          options ? h(ComboBox, { key: 'input', value: values[key], disabled: busyState[0], options: options, t: t, label: label,
            onChange: function (value) { set(key, value) } }) : h(key === 'message' ? 'textarea' : 'input', { key: 'input', value: values[key], disabled: busyState[0], autoFocus: action === 'createBranch' && key === 'name', 'aria-label': label, name: key, onChange: function (event) { set(key, event.target.value) } })])
      }
      var check = function (key, label) { return h('label', { key: key, className: 'dshgit-check' }, [
        h('input', { key: 'input', type: 'checkbox', checked: values[key], disabled: busyState[0], onChange: function (event) { set(key, event.target.checked) } }), label]) }
      var allRefs = [{ value: 'HEAD', label: t('label.startPointHead') }].concat(locals.concat(remotes).map(function (ref) { return { value: ref.ref, label: ref.name } }))
      if (target && !allRefs.some(function (ref) { return ref.value === target })) allRefs.unshift({ value: target, label: target })
      var fields = []
      if (action === 'createBranch' || (action === 'checkout' && remoteBranch)) {
        fields.push(field('name', t('wb.name')), fixedRemoteStart ? h('div', { key: 'startPoint', className: 'dshgit-workbench-field' }, [
          h('span', { key: 'label' }, t('wb.start')), h('span', { key: 'value', className: 'dshgit-name', title: subject.ref }, subject.name || subject.ref.replace(/^refs\/remotes\//, '')),
        ]) : field('startPoint', t('wb.start'), allRefs))
        if (action === 'checkout' && remoteBranch && locals.length) fields.push(field('existing', t('wb.existingBranch'), [{ value: '', label: t('wb.createBranch') }].concat(locals.map(function (ref) { return { value: ref.name, label: ref.name } }))))
        if (locals.some(function (ref) { return ref.name === values.name.trim() }) && !values.existing) fields.push(h('div', { key: 'exists', role: 'status', className: 'dshgit-muted' }, t('wb.branchExists')))
        if (action === 'createBranch') fields.push(check('checkout', t('wb.switchAfter')))
        if (/^refs\/remotes\//.test(values.startPoint)) fields.push(check('track', t('wb.track')))
      }
      if (action === 'renameBranch') fields.push(field('name', t('wb.name')))
      if (action === 'createTag') fields.push(field('name', t('wb.tagName')), field('message', t('wb.tagMessage')),
        h('div', { key: 'tagHint', className: 'dshgit-muted' }, t('wb.tagHint')))
      if (action === 'addWorktree') {
        fields.push(field('directory', t('wb.worktreeDirectory')), h('div', { key: 'worktreeHint', className: 'dshgit-muted' }, t('wb.worktreeHint')))
        if (worktreeNeedsBranch) fields.push(h('div', { key: 'worktreeOccupied', className: 'dshgit-muted' }, t(remoteBranch ? 'wb.track' : 'wb.worktreeOccupied')))
        else fields.push(check('newBranch', t('wb.worktreeNewBranch')))
        if (values.newBranch) fields.push(field('name', t('wb.name')))
        if (remoteBranch) fields.push(check('track', t('wb.track')))
      }
      if (nameError) fields.push(h('div', { key: 'nameError', role: 'alert', className: 'dshgit-error' }, nameError))
      if (action === 'push' || action === 'fetch') {
        if (action !== 'fetch' || !remoteBranch) fields.push(field('remote', t('wb.remote'), (action === 'fetch' ? [{ value: '', label: t('wb.all') }] : []).concat(remotesState[0].map(function (remote) { return { value: remote.name, label: remote.name } }))))
        if (action === 'push') fields.push(field('targetBranch', t('wb.target')))
        else fields.push(check('prune', t('wb.prune')))
      }
      if (action === 'setUpstream') fields.push(field('upstream', t('wb.upstream'), [{ value: '', label: t('wb.noUpstream') }].concat(remotes.map(function (ref) { return { value: ref.ref, label: ref.name } }))))
      if (action === 'pull') fields.push(h('div', { key: 'upstream', className: 'dshgit-muted' }, t('wb.upstream') + ': ' + (subject.upstream || upstreamRef)),
        otherBranchPull ? h('div', { key: 'pullHint', className: 'dshgit-muted' }, t('wb.pullOtherBranch')) : field('pullStrategy', t('wb.pullStrategy'), [{ value: 'ff', label: t('wb.pullFf') }, { value: 'merge', label: t('wb.pullMerge') }, { value: 'rebase', label: t('wb.pullRebase') }]))
      if (action === 'resetTo') fields.push(field('mode', 'Reset', ['soft', 'mixed', 'hard'].map(function (mode) { return { value: mode, label: t('wb.' + mode) } })))
      if (action === 'merge') fields.push(check('noFf', t('wb.noFf')))
      if (action === 'revert' || action === 'cherryPick') fields.push(check('noCommit', t('wb.noCommit')))
      if (action === 'commit') fields.push(field('message', t('wb.message')))
      if (action === 'revert' && !values.noCommit) fields.push(field('message', t('wb.message')))
      if (action === 'revert' && preview && preview.commit && preview.commit.parents.length > 1) fields.push(field('mainline', t('wb.parent'), preview.commit.parents.map(function (sha, index) { return { value: String(index + 1), label: String(index + 1) + ' · ' + sha.slice(0, 10) } })))
      if (action === 'deleteBranch' && !remoteBranch) fields.push(check('force', t('wb.force')))
      if (['resetTo', 'undoCommit', 'rebase', 'commit'].indexOf(action) >= 0) fields.push(check('backup', t('wb.backup')))
      if ((action === 'createBranch' ? branchDirty : preview?.dirty) && !otherBranchPull && ['checkout', 'createBranch', 'merge', 'pull', 'rebase', 'cherryPick', 'revert', 'resetTo'].indexOf(action) >= 0) fields.push(check('stash', t('wb.stash') + (action === 'createBranch' ? ' (' + branchFiles.length + ')' : '')))
      if (action === 'resetTo' && values.mode === 'hard') fields.push(check('acknowledge', t('wb.understand')))
      var submit = function (event) {
        if (event) event.preventDefault()
        if (!ready || pending.current) return
        if (nameError) { errorState[1](nameError); return }
        var parameters = {}, operation = action, upstream = null
        var fail = function (message) { errorState[1](message) }
        if (preview.operation && ['fetch', 'push', 'setUpstream'].indexOf(action) < 0) return fail(t('wb.busyOperation'))
        if (['merge', 'pull', 'rebase', 'revert', 'cherryPick'].indexOf(action) >= 0 && !otherBranchPull && preview.dirty && !values.stash) return fail(t('wb.cleanFirst'))
        if (action === 'resetTo' && values.mode === 'hard' && !values.acknowledge) return fail(t('wb.understand'))
        if (action === 'undoCommit' && (!preview.commit || !preview.commit.parents.length)) return fail(t('wb.rootUndo'))
        if (action === 'cherryPick' && preview.commit && preview.commit.parents.length > 1) return fail(t('wb.parent'))
        if (action === 'createBranch' || (action === 'checkout' && remoteBranch && !values.existing)) {
          if (!values.name.trim()) return fail(t('error.branchName'))
          if (locals.some(function (branch) { return branch.name === values.name.trim() })) return fail(t('wb.branchExists'))
          operation = 'createBranch'; parameters = { name: values.name.trim(), startPoint: values.startPoint, checkout: action === 'checkout' || values.checkout, track: false }
          if (values.track && /^refs\/remotes\//.test(values.startPoint)) upstream = values.startPoint
        } else if (action === 'checkout') parameters = { ref: values.existing || subject.ref, detached: /^refs\/tags\//.test(subject.ref || '') }
        else if (action === 'createTag') {
          if (!proposedName || !preview.target) return
          parameters = { name: proposedName, ref: preview.target, message: values.message.trim() }
        }
        else if (action === 'renameBranch') parameters = { from: subject.name, to: values.name.trim() }
        else if (action === 'deleteBranch') parameters = { name: remoteBranch ? localName : subject.name, remote: remoteBranch, remoteName: remoteName, force: values.force }
        else if (action === 'push') parameters = { remote: values.remote, sourceBranch: subject.name, targetBranch: values.targetBranch.trim(), setUpstream: true }
        else if (action === 'fetch') parameters = { remote: values.remote || undefined, all: !values.remote, prune: values.prune,
          branch: remoteBranch ? localName : values.remote && upstreamRef.startsWith('refs/remotes/' + values.remote + '/') ? upstreamRef.slice(14 + values.remote.length) : undefined }
        else if (action === 'pull') {
          if (!upstreamRef) return fail(t('wb.pullNeedsUpstream'))
          parameters = { name: subject.name, upstream: upstreamRef, ffOnly: otherBranchPull || values.pullStrategy === 'ff', rebase: !otherBranchPull && values.pullStrategy === 'rebase', merge: !otherBranchPull && values.pullStrategy === 'merge' }
        }
        else if (action === 'addWorktree') {
          if (!directoryValid) return fail(t('wb.worktreePathRequired'))
          if (values.newBranch && !proposedName) return fail(t('error.branchName'))
          parameters = { directory: values.directory.trim(), ref: subject.ref, name: values.newBranch ? proposedName : undefined, track: remoteBranch && values.track }
        }
        else if (action === 'setUpstream') parameters = { name: subject.name, upstream: values.upstream }
        else if (action === 'resetTo') parameters = { ref: preview.target, mode: values.mode }
        else if (action === 'undoCommit') parameters = { originalMessage: values.message, expectedHead: preview.target }
        else if (action === 'merge' || action === 'rebase') parameters = { ref: preview.target, noFf: values.noFf }
        else if (action === 'revert' || action === 'cherryPick') parameters = { sha: preview.target, noCommit: values.noCommit, mainline: Number(values.mainline), message: values.message }
        else if (action === 'commit') parameters = { amend: true, message: values.message, expectedHead: preview.target }
        else if (action === 'restoreRevision') parameters = { ref: preview.target, path: subject.path }
        pending.current = true; busyState[1](true); errorState[1]('')
        props.execute({ action: operation, parameters: parameters, upstream: upstream, guard: preview.guard, backup: values.backup, stashFirst: values.stash }).then(function (result) {
          if (!result) throw new Error(t('action.failed'))
          if (action === 'addWorktree' && props.onWorktreeOpen) props.onWorktreeOpen(values.directory.trim())
          pending.current = false; props.onClose()
        }).catch(function (failure) { pending.current = false; busyState[1](false); errorState[1](failure.message); previewState[1](null) })
      }
      return h('div', { className: 'dshgit-modal', onClick: close }, h('form', {
        className: 'dshgit-dialog dshgit-workbench-dialog' + (action === 'createBranch' ? ' dshgit-createbranch-dialog' : ''), role: 'dialog', 'aria-modal': true, 'aria-label': t('wb.' + action), ref: panel, tabIndex: -1,
        onClick: function (event) { event.stopPropagation() }, onSubmit: submit,
      }, [h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wb.' + action)),
        action === 'createBranch' ? null : h('div', { key: 'direction', className: 'dshgit-muted' }, ['rebase', 'resetTo', 'checkout'].indexOf(action) >= 0 && preview
          ? (preview.branch || 'HEAD') + ' → ' + (subject.name || subject.sha || subject.ref || '')
          : (subject.name || subject.path || subject.sha || '') + (['merge', 'cherryPick', 'revert'].indexOf(action) >= 0 && preview ? ' → ' + (preview.branch || 'HEAD') : '')),
        loadingState[0] && action !== 'createBranch' ? h('div', { key: 'loading', role: 'status' }, h('span', { className: 'dshgit-spinner' })) : null,
        preview && action !== 'createBranch' ? h('div', { key: 'preview', className: 'dshgit-workbench-preview' }, [
          action === 'createTag' ? h('div', { key: 'tagTarget' }, t('wb.tagTarget') + ': ' + (subject.name || subject.sha || subject.ref || '') + ' · ' + (preview.target || '').slice(0, 10)) : null,
          action === 'createBranch' ? null : h('div', { key: 'head' }, (otherBranchPull ? subject.name : preview.branch || 'HEAD') + ' · ' + (otherBranchPull ? preview.target || '' : preview.head || '').slice(0, 10)),
          action !== 'createBranch' && preview.commit ? h('div', { key: 'commit' }, preview.commit.sha.slice(0, 10) + ' · ' + preview.commit.subject) : null,
          preview.dirty && !otherBranchPull ? h('div', { key: 'dirty' }, t('wb.dirty') + ': ' + preview.files.length) : null,
          action === 'checkout' && /^refs\/tags\//.test(subject.ref || '') ? h('div', { key: 'detached' }, t('wb.detachedNotice')) : null,
          ['resetTo', 'undoCommit', 'commit', 'rebase'].indexOf(action) >= 0 ? h('div', { key: 'published', className: 'dshgit-muted' }, preview.publishedRefs.length ? t('wb.published') : t('wb.unknown')) : null,
          action === 'resetTo' ? h('details', { key: 'lost' }, [h('summary', { key: 'summary' }, t('wb.lost') + ': ' + preview.lostCount), preview.lost.map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
          action === 'deleteBranch' && remoteBranch ? h('div', { key: 'warning' }, t('wb.remoteDelete')) : null,
          ['merge', 'rebase', 'deleteBranch'].indexOf(action) >= 0 ? h('details', { key: 'incoming' }, [h('summary', { key: 'summary' }, t('merge.incoming') + ': ' + (preview.incomingCount || 0)), (preview.incoming || []).map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
          action === 'undoCommit' && preview.commit ? h('div', { key: 'parent' }, t('wb.target') + ': ' + (preview.commit.parents[0] || t('wb.rootUndo'))) : null,
          action === 'commit' ? h('div', { key: 'amend' }, t('wb.amendNotice')) : null,
          action === 'rebase' ? h('details', { key: 'replay' }, [h('summary', { key: 'summary' }, t('wb.replay') + ': ' + preview.lostCount), preview.lost.map(function (commit) { return h('div', { key: commit.sha }, commit.sha.slice(0, 8) + ' ' + commit.subject) })]) : null,
          action === 'revert' && preview.commit?.parents.length > 1 ? h('div', { key: 'mergeNotice' }, t('wb.revertMergeNotice')) : null,
          action === 'resetTo' && values.mode === 'hard' ? h('details', { key: 'paths' }, [h('summary', { key: 'summary' }, t('wb.dirty') + ': ' + preview.files.length), preview.files.map(function (file) { return h('div', { key: file.path }, file.path) })]) : null,
          ['resetTo', 'undoCommit', 'revert', 'commit', 'rebase'].indexOf(action) >= 0 ? h('div', { key: 'local', className: 'dshgit-muted' }, t('wb.noAutoPush')) : null,
        ]) : null,
      ].concat(fields).concat([
        preview?.coordinates && ['resetTo', 'revert', 'cherryPick', 'restoreRevision', 'commit', 'merge', 'rebase'].indexOf(action) >= 0 ? h(WorkbenchPatchPreview, { key: JSON.stringify(preview.coordinates), preview: preview, repo: props.repo, run: props.run, t: t, label: action === 'merge' ? t('wb.sourceChanges') : null }) : null,
        errorState[0] ? h('div', { key: 'error', role: 'alert', className: 'dshgit-error' }, errorState[0]) : null,
        h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [
          action !== 'createBranch' || errorState[0] ? h('button', { key: 'refresh', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: function () { retryState[1](function (value) { return value + 1 }) } }, t('action.refresh')) : null,
          h('button', { key: 'cancel', type: 'button', className: 'dshgit-btn', disabled: busyState[0], onClick: close }, t('action.cancel')),
          h('button', { key: 'submit', type: 'submit', className: 'dshgit-btn ' + (action === 'deleteBranch' || (action === 'resetTo' && values.mode === 'hard') ? 'dshgit-btn-danger' : 'dshgit-btn-primary'), disabled: !ready || !!nameError || (needsName && !proposedName) || (action === 'addWorktree' && !directoryValid) || loadingState[0] || busyState[0] || (action === 'undoCommit' && !preview?.commit?.parents.length) }, busyState[0] ? h('span', { className: 'dshgit-spinner' }) : t('wb.' + action)),
        ]),
      ])))
    }

    function WorkbenchPatchPreview(props) {
      var fileState = React.useState(props.preview.diffFiles?.[0]?.path || ''), searchState = React.useState(''), limitState = React.useState(100)
      var valueState = React.useState(null), errorState = React.useState(''), retryState = React.useState(0)
      var coordinates = props.preview.coordinates
      var files = (props.preview.diffFiles || []).filter(function (file) { return file.path.toLowerCase().includes(searchState[0].toLowerCase()) })
      React.useEffect(function () {
        if (!fileState[0]) return
        var active = true; valueState[1](null); errorState[1]('')
        var original = (props.preview.diffFiles || []).find(function (file) { return file.path === fileState[0] })
        props.run('diff', Object.assign({ root: props.repo.root }, coordinates, { path: fileState[0], originalPath: original?.originalPath }), { silentError: true }).then(function (value) { if (active) valueState[1](value) }).catch(function (error) { if (active) errorState[1](error.message) })
        return function () { active = false }
      }, [fileState[0], retryState[0]])
      var patch = valueState[0]?.files?.[0]
      return h('details', null, [h('summary', { key: 'summary' }, (props.label || props.t('wb.preview')) + ' (' + (props.preview.diffFiles || []).length + ')'),
        h('input', { key: 'search', type: 'search', value: searchState[0], placeholder: props.t('list.searchFiles'), 'aria-label': props.t('list.searchFiles'), onChange: function (event) { searchState[1](event.currentTarget.value); limitState[1](100) } }),
        h('div', { key: 'files', className: 'dshgit-workbench-preview' }, files.slice(0, limitState[0]).map(function (file) { return h('button', { key: file.path, type: 'button', className: 'dshgit-rowbtn dshgit-row', 'aria-pressed': fileState[0] === file.path, onClick: function () { fileState[1](file.path) } }, file.path) })),
        files.length > limitState[0] ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn', onClick: function () { limitState[1](limitState[0] + 100) } }, props.t('action.loadMore')) : null,
        errorState[0] ? h('div', { key: 'error', role: 'alert' }, [errorState[0], h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { retryState[1](retryState[0] + 1) } }, props.t('stash.retry'))]) : null,
        h('div', { key: 'patch', className: 'dshgit-workbench-preview' }, patch ? h(FileDiffCard, { file: patch, t: props.t }, h(DiffBody, { path: patch.path, hunks: patch.hunks, emptyText: props.t(patch.binary ? 'state.fileBinary' : 'state.emptyDiff') })) : props.t(fileState[0] && valueState[0] === null ? 'state.loading' : 'state.emptyDiff')),
      ])
    }

    function WorkbenchRecovery(props) {
      var t = props.t, panel = React.useRef(null), recordsState = React.useState([]), errorState = React.useState(''), retryState = React.useState(0), loadingState = React.useState(true)
      useDialogFocus(panel, props.onClose)
      React.useEffect(function () {
        var active = true; loadingState[1](true); errorState[1]('')
        props.run('reflog', { root: props.repo.root, limit: 100 }, { silentError: true }).then(function (result) { if (active) { recordsState[1](result); loadingState[1](false) } }).catch(function (error) { if (active) { errorState[1](error.message); loadingState[1](false) } })
        return function () { active = false }
      }, [props.repo.root, retryState[0]])
      var restore = function (sha) { props.onWorkflow('createBranch', { sha: sha }, { prefix: 'recovery/' }) }
      return h('div', { className: 'dshgit-modal', onClick: props.onClose }, h('div', { className: 'dshgit-dialog dshgit-workbench-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('wb.reflog'), ref: panel, tabIndex: -1, onClick: function (event) { event.stopPropagation() } }, [
        h('div', { key: 'title', className: 'dshgit-dialogtitle' }, t('wb.reflog')),
        h('div', { key: 'description', className: 'dshgit-muted' }, t('wb.reflogDescription')),
        (props.recovery || []).map(function (record, index) { return h('div', { key: 'recovery' + index, className: 'dshgit-workbench-preview' }, [
          h('div', { key: 'title' }, t('wb.' + record.kind) + ' · ' + new Date(record.at).toLocaleString()),
          record.backup ? h('div', { key: 'backup' }, record.backup) : null,
          record.stash ? h('div', { key: 'stash' }, t('wb.protectedStash') + ' · ' + record.stash.slice(0, 10)) : null,
          record.stash && props.onStash ? h('button', { key: 'viewStash', className: 'dshgit-btn', onClick: function () { props.onStash(record.stash) } }, t('wb.savedChanges')) : null,
          record.head ? h('button', { key: 'recover', className: 'dshgit-btn', onClick: function () { restore(record.head) } }, t('wb.recoverBranch')) : null,
        ]) }),
        loadingState[0] ? h('span', { key: 'loading', className: 'dshgit-spinner' }) : null,
        errorState[0] ? h('div', { key: 'error', role: 'alert' }, [errorState[0], h('button', { key: 'retry', className: 'dshgit-btn', onClick: function () { retryState[1](function (value) { return value + 1 }) } }, t('stash.retry'))]) : null,
        h('div', { key: 'records', className: 'dshgit-workbench-preview' }, recordsState[0].map(function (record, index) { return h('div', { key: record.ref + index, className: 'dshgit-recovery-record' }, [
          h('span', { key: 'message', title: record.sha }, record.sha.slice(0, 8) + ' · ' + record.message),
          h('div', { key: 'actions', className: 'dshgit-dialogactions' }, [h('button', { key: 'branch', className: 'dshgit-btn', onClick: function () { restore(record.sha) } }, t('wb.createBranch')), h('button', { key: 'reset', className: 'dshgit-btn', onClick: function () { props.onWorkflow('resetTo', { sha: record.sha }) } }, t('wb.resetTo'))]),
        ]) })),
        h('div', { key: 'actions', className: 'dshgit-dialogactions' }, h('button', { className: 'dshgit-btn', onClick: props.onClose }, t('action.close'))),
      ]))
    }

    function WorkbenchGraph(props) {
      var t = props.t, size = React.useState(40), panel = React.useRef(null), drag = React.useRef(null)
      React.useEffect(function () { return function () { if (drag.current) { document.removeEventListener('pointermove', drag.current.move); document.removeEventListener('pointerup', drag.current.end) } } }, [])
      var resize = function (event) {
        event.preventDefault(); var start = event.clientY, height = panel.current?.getBoundingClientRect?.().height || 600, original = size[0]
        var move = function (event) { size[1](Math.max(25, Math.min(75, original + (start - event.clientY) / height * 100))) }
        var end = function () { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); drag.current = null }
        drag.current = { move: move, end: end }; document.addEventListener('pointermove', move); document.addEventListener('pointerup', end)
      }
      var rows = props.graph?.rows || [], incoming = new Set(), width = Math.max(1, props.graph?.laneCount || 1) * 16 + 12
      var selected = props.selection?.kind === 'commit' ? props.selection.sha : null
      var records = rows.map(function (row) {
        var tips = [].concat(props.refs?.branches || [], props.refs?.remotes || [], props.refs?.tags || []).filter(function (ref) {
          return !ref.symbolic && (ref.commitSha || ref.sha) === row.sha && (props.config.scope !== 'all' || props.config.showRemote || !ref.ref.startsWith('refs/remotes/'))
        })
        if (!tips.length) tips = (row.tips || []).map(function (tip) { return { ref: tip, name: tip } })
        var x = row.lane * 16 + 8, paths = (row.through || []).map(function (lane) { return h('path', { key: 'through' + lane,
          d: 'M' + (lane * 16 + 8) + ' 0V32', stroke: laneColor(lane), strokeWidth: 1.5 }) })
        if (incoming.has(row.sha)) paths.push(h('path', { key: 'incoming', d: 'M' + x + ' 0V16', stroke: laneColor(row.lane), strokeWidth: 1.5 }))
        ;(row.edges || []).forEach(function (edge, index) {
          var target = edge.to * 16 + 8
          paths.push(h('path', { key: 'edge' + index, d: 'M' + x + ' 16C' + x + ' 25 ' + target + ' 25 ' + target + ' 32', fill: 'none', stroke: laneColor(edge.to), strokeWidth: 1.5 }))
          incoming.add(edge.parent)
        })
        paths.push(h('circle', { key: 'dot', cx: x, cy: 16, r: (row.parents || []).length > 1 ? 4 : 3.5, fill: laneColor(row.lane) }))
        return h('div', { key: row.sha, className: 'dshgit-graph-record', 'data-selected': selected === row.sha,
          onContextMenu: function (event) { props.onMenu(event, row.sha) } }, [
          h('button', { key: 'select', type: 'button', className: 'dshgit-graph-select', 'data-graph-sha': row.sha, 'aria-pressed': selected === row.sha,
            title: row.sha + '\n' + row.subject, onClick: function () { props.onOpenCommit(row.sha) },
          }, [h('svg', { key: 'lanes', width: width, height: 32, viewBox: '0 0 ' + width + ' 32', 'aria-hidden': true, style: { flex: 'none' } }, paths),
            h('span', { key: 'sha', className: 'dshgit-muted' }, row.shortSha),
            h('span', { key: 'subject', className: 'dshgit-subject' }, row.subject),
            h('span', { key: 'author', className: 'dshgit-muted dshgit-graph-author' }, row.author),
            h('span', { key: 'time', className: 'dshgit-muted dshgit-graph-time' }, formatRelative(row.authorDate)),
            tips.slice(0, 2).map(function (tip, index) { var kind = tip.ref.startsWith('refs/tags/') ? 'tag' : tip.ref.startsWith('refs/remotes/') ? 'remote' : 'local'
              return h('span', { key: 'tip' + index, className: 'dshgit-graph-tip', 'data-kind': kind, title: tip.ref }, tip.name) }),
          ]), tips.length > 2 ? h(Menu, { key: 'moreTips', t: t, portal: true, menuClass: 'dshgit-graph-refs', title: t('wb.branches'), label: '+' + (tips.length - 2), items: tips.map(function (tip) {
            return { label: tip.name, hint: tip.ref, run: function () { props.onConfig({ scope: 'selected', selected: tip.ref, limit: 200 }) } }
          }) }) : null, h('button', { key: 'more', type: 'button', className: 'dshgit-iconbtn', title: t('menu.actions'), 'aria-label': t('menu.actions'),
            onClick: function (event) { props.onMenu(event, row.sha) } }, h(IconMore, { size: 16 })),
        ])
      })
      return h('div', { ref: panel, className: 'dshgit-graph-workbench' }, [
        h('div', { key: 'tools', className: 'dshgit-graph-tools' }, [
          h(ComboBox, { key: 'scope', style: { width: '160px' }, value: props.config.scope, t: t, label: t('wb.viewing'),
            onChange: function (value) { props.onConfig({ scope: value, limit: 200 }) }, options: ['all', 'current', 'selected'].filter(function (scope) { return scope !== 'selected' || props.config.selected }).map(function (scope) {
              return { value: scope, label: t('wb.' + (scope === 'current' ? 'currentScope' : scope)) } }) }),
          h('label', { key: 'remote', className: 'dshgit-commit-check' }, [h('input', { type: 'checkbox', checked: props.config.showRemote, disabled: props.config.scope !== 'all',
            onChange: function (event) { props.onConfig({ showRemote: event.currentTarget.checked, limit: 200 }) } }), t('wb.showRemote')]),
          h(ComboBox, { key: 'order', style: { width: '130px' }, value: props.config.ordering, t: t, label: t('wb.date'),
            onChange: function (value) { props.onConfig({ ordering: value, limit: 200 }) }, options: ['date', 'topo'].map(function (order) { return { value: order, label: t('wb.' + order) } }) }),
          props.loading ? h('span', { key: 'loading', className: 'dshgit-spinner', role: 'status', 'aria-label': t('state.loading') }) : null,
          h('span', { key: 'count', className: 'dshgit-muted' }, String(rows.length)),
          props.config.scope === 'selected' ? h('span', { key: 'viewing', className: 'dshgit-muted' }, props.config.selected.replace(/^refs\/(heads|remotes|tags)\//, '')) : null,
        ]),
        h('div', { key: 'graph', className: 'dshgit-graph-scroll' }, [
          props.error ? h('div', { key: 'error', className: 'dshgit-card', role: 'alert' }, [props.error,
            h('button', { type: 'button', className: 'dshgit-btn', onClick: function () { props.onConfig({ refresh: props.config.refresh + 1 }) } }, t('stash.retry'))]) : null,
          rows.length ? records : h('div', { key: 'empty', className: 'dshgit-empty' }, t(props.loading ? 'state.loading' : 'state.noCommits')),
          props.graph?.hasMore && props.config.limit < 2000 ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more', disabled: props.loading,
            onClick: function () { props.onConfig({ limit: Math.min(2000, props.config.limit + 200) }) } }, props.loading ? t('state.loading') : t('action.loadMore')) : null,
          props.graph?.hasMore && props.config.limit >= 2000 ? h('div', { key: 'maximum', className: 'dshgit-sidebar-hint' }, t('wb.maximum')) : null,
        ]),
        selected ? h('button', { key: 'divider', type: 'button', className: 'dshgit-graph-divider', role: 'separator', 'aria-orientation': 'horizontal',
          'aria-valuenow': size[0], 'aria-valuemin': 25, 'aria-valuemax': 75, 'aria-label': t('wb.details'), onPointerDown: resize,
          onKeyDown: function (event) { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); size[1](Math.max(25, Math.min(75, size[0] + (event.key === 'ArrowUp' ? 5 : -5)))) } } }) : null,
        selected ? h('div', { key: 'detail', className: 'dshgit-graph-detail', style: { height: size[0] + '%' } }, [
          h('div', { key: 'head', className: 'dshgit-branch-tools' }, [h('span', { key: 'label', style: { flex: 1 } }, t('wb.details')),
            h('button', { key: 'close', type: 'button', className: 'dshgit-iconbtn', title: t('action.close'), 'aria-label': t('action.close'), onClick: props.onCloseDetail }, '×')]),
          h(HistoryCommitDetails, { key: props.repo.root + ':' + selected, sha: selected, repo: props.repo, run: props.run, onMenu: props.onMenu, onFileMenu: props.onFileMenu, onFileRestore: props.onFileRestore, t: t }),
        ]) : null,
        props.recovery ? h('div', { key: 'recovery', className: 'dshgit-workbench-recovery' }, [h('span', { key: 'kind', className: 'dshgit-muted' }, t('wb.' + props.recovery.kind)),
          h('button', { key: 'open', type: 'button', className: 'dshgit-btn', onClick: props.onRecovery }, t('wb.recovery'))]) : null,
      ])
    }

    function GraphSidebar(props) {
      var t = props.t
      var graph = props.graph
      if (graph === null) {
        return h('div', { className: 'dshgit-empty' }, t('state.loading'))
      }
      var rows = graph.rows || []
      var tips = []
      for (var i = 0; i < rows.length; i++) {
        for (var k = 0; k < (rows[i].tips || []).length; k++) {
          if (tips.indexOf(rows[i].tips[k]) === -1) tips.push(rows[i].tips[k])
        }
      }
      return h(Fragment, null, [
        h('div', { key: 'stats', className: 'dshgit-section' }, [
          h('div', { key: 'l', className: 'dshgit-kvrow' }, [
            h('span', { key: 'k', className: 'dshgit-muted' }, t('graph.lanesLabel')),
            h('span', { key: 'v' }, String(graph.laneCount)),
          ]),
          h('div', { key: 'c', className: 'dshgit-kvrow' }, [
            h('span', { key: 'k', className: 'dshgit-muted' }, t('label.commits')),
            h('span', { key: 'v' }, String(rows.length)),
          ]),
        ]),
        tips.length === 0
          ? null
          : h('div', { key: 'tips', className: 'dshgit-section' }, [
              h('div', { key: 'h', className: 'dshgit-subgroup' }, t('graph.tips')),
              h('div', { key: 'l' }, tips.map(function (tip) {
                return h('div', { key: tip, className: 'dshgit-row' }, [
                  h('span', { key: 'i', className: 'dshgit-tipdot', 'aria-hidden': 'true' }),
                  h('span', { key: 'n', className: 'dshgit-name' }, tip),
                ])
              })),
            ]),
      ])
    }

    /** Changed files for the temporary comparison view. */
    function CompareSidebar(props) {
      var search = React.useState(''), limit = React.useState(100)
      var query = search[0].trim().toLowerCase()
      var files = props.files.filter(function (file) { return file.path.toLowerCase().includes(query) }), visible = files.slice(0, limit[0])
      // Hoisted so the search box survives the loading state: it used to be a
      // sibling of the navigation, and folding it into that row would otherwise
      // make it vanish while the file list is still being fetched.
      var searchInput = h('input', {
        key: 'search', type: 'search', className: 'dshgit-input', value: search[0], placeholder: props.t('list.searchFiles'), 'aria-label': props.t('list.searchFiles'),
        onChange: function (event) { search[1](event.currentTarget.value); limit[1](100) },
      })
      return h(Fragment, null, [
        h('div', { key: 'count', className: 'dshgit-sidebar-hint' }, props.t('count.files', { count: props.files.length })),
        props.loading
          ? h('div', { key: 'searchrow', className: 'dshgit-stash-searchrow' }, searchInput)
          : h(StashFileNavigation, { key: 'files', files: visible, selected: props.selected, onSelect: props.onSelect, onFileMenu: props.onFileMenu, t: props.t,
              search: searchInput }),
        props.loading ? h('div', { key: 'loading', className: 'dshgit-empty', role: 'status' }, props.t('state.loading')) : null,
        !props.loading && !props.error && files.length === 0 ? h('div', { key: 'empty', className: 'dshgit-sidebar-hint' }, props.t(query ? 'list.noMatches' : 'state.emptyDiff')) : null,
        files.length > visible.length ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn dshgit-list-more',
          onClick: function () { limit[1](limit[0] + 100) },
        }, props.t('action.loadMore') + ' (' + visible.length + '/' + files.length + ')') : null,
      ])
    }

    /**
     * The output module's sidebar: how much is logged, and the controls.
     *
     * The filter is here rather than above the list because filtering is a
     * navigation decision ("show me only what failed"), and it keeps the editor
     * a pure reading surface.
     */
    function OutputSidebar(props) {
      var t = props.t
      var entries = props.entries || []
      var failed = entries.filter(function (entry) { return entry.code !== 0 }).length
      var filters = [
        { id: 'all', label: t('output.filterAll'), count: entries.length },
        { id: 'failed', label: t('output.filterFailed'), count: failed },
      ]
      return h(Fragment, null, [
        h('div', { key: 'filters', className: 'dshgit-section' }, filters.map(function (item) {
          return h('button', {
            key: item.id,
            type: 'button',
            className: 'dshgit-row dshgit-rowbtn',
            'data-selected': props.filter === item.id,
            onClick: function () { props.onFilter(item.id) },
          }, [
            h('span', { key: 'n', className: 'dshgit-name' }, item.label),
            h('span', { key: 'c', className: 'dshgit-sectioncount' }, String(item.count)),
          ])
        })),
        h('div', { key: 'actions', className: 'dshgit-sidebar-actions' }, [
          h('button', { key: 'r', type: 'button', className: 'dshgit-btn',
            onClick: props.onRefresh }, t('action.refresh')),
          h('button', { key: 'c', type: 'button', className: 'dshgit-btn',
            onClick: props.onClear }, t('action.clearOutput')),
        ]),
      ])
    }

    /**
     * The settings module's sidebar: which group of settings is showing.
     *
     * Three groups, because the settings page had grown into one long scroll of
     * unrelated concerns (paths, blame tuning, AI, diagnostics).
     */
    function SettingsNav(props) {
      var t = props.t
      var sections = [
        { id: 'general', label: t('settings.general') },
        { id: 'ai', label: t('settings.ai') },
        { id: 'diagnostics', label: t('settings.diagnostics') },
      ]
      return h('div', { className: 'dshgit-section' }, sections.map(function (section) {
        return h('button', {
          key: section.id,
          type: 'button',
          className: 'dshgit-row dshgit-rowbtn',
          'data-selected': props.section === section.id,
          onClick: function () { props.onSelect(section.id) },
        }, h('span', { key: 'n', className: 'dshgit-name' }, section.label))
      }))
    }

    /** The commit list with a search box. */
    function HistoryView(props) {
      var t = props.t
      return h(Fragment, null, [
        h(HistoryScope, { key: 'ref', historyRef: props.historyRef, onResetHistory: props.onResetHistory, t: t }),
        props.historyPath
          ? h('div', { key: 'path', className: 'dshgit-card dshgit-previewhead' }, [
              h('span', { key: 'name', className: 'dshgit-previewpath' }, props.historyPath),
              h('button', { key: 'clear', type: 'button', className: 'dshgit-iconbtn',
                title: t('action.close'), onClick: props.clearHistoryPath }, '×'),
            ])
          : null,
        h('div', { key: 'search', className: 'dshgit-card' }, [
          h('input', {
            key: 'q',
            className: 'dshgit-input',
            value: props.query,
            placeholder: t('placeholder.search'),
            onChange: function (event) { props.setQuery(event.currentTarget.value) },
          }),
        ]),
        props.commits.length === 0
          ? h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.noCommits'))
          : h('div', { key: 'list' }, props.commits.map(function (commit) {
              var selected = props.selection !== null && props.selection.kind === 'commit' && props.selection.sha === commit.sha
              return h(
                'div',
                {
                  key: commit.sha,
                  className: 'dshgit-commitrow',
                  'data-selected': selected,
                  onClick: function () { props.onOpenCommit(commit.sha) },
                },
                [
                  h('div', { key: 's', className: 'dshgit-subject' }, commit.subject),
                  h('div', { key: 'm', className: 'dshgit-meta' }, [
                    commit.files.some(function (file) { return file.status === 'R' })
                      ? h('span', { key: 'rename', className: 'dshgit-badge' }, 'R') : null,
                    h('span', { key: 'sha' }, commit.shortSha),
                    h('span', { key: 'a' }, commit.author),
                    h('span', { key: 'd' }, formatRelative(commit.authorDate)),
                    commit.tips.length > 0 ? h('span', { key: 't' }, commit.tips.join(', ')) : null,
                    commit.files.length > 0
                      ? h('span', { key: 'f' }, t('count.files', { count: commit.files.length }))
                      : null,
                  ]),
                ],
              )
            })),
        props.hasMore ? h('button', { key: 'more', type: 'button', className: 'dshgit-btn',
          onClick: props.onLoadMore,
        }, t('action.loadMore')) : null,
      ])
    }

    /** The commit graph with lane rendering. */
    function GraphView(props) {
      var t = props.t
      var graph = props.graph
      if (graph === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))

      var rows = graph.rows || []
      if (rows.length === 0) return h('div', { className: 'dshgit-empty' }, t('state.noCommits'))

      var laneWidth = 14
      return h(Fragment, null, [
        h('div', { key: 'head', className: 'dshgit-card' },
          t('graph.lanes', { count: graph.laneCount }) + ' · ' + rows.length),
        h('div', { key: 'rows' }, rows.map(function (row) {
          var selected = props.selection !== null && props.selection.kind === 'commit' && props.selection.sha === row.sha
          var lanes = []
          for (var lane = 0; lane < row.laneCount; lane++) {
            var isOwn = lane === row.lane
            var isThrough = row.through.indexOf(lane) !== -1
            lanes.push(
              h('span', {
                key: 'l' + lane,
                className: 'dshgit-dot' + (isOwn ? '' : ''),
                style: {
                  background: isOwn || isThrough ? laneColor(lane) : 'transparent',
                  opacity: isOwn ? 1 : 0.35,
                  width: isOwn ? '8px' : '2px',
                  borderRadius: isOwn ? '50%' : '1px',
                  height: isOwn ? '8px' : '14px',
                },
              }),
            )
          }
          return h(
            'div',
            {
              key: row.sha,
              className: 'dshgit-graphrow',
              'data-selected': selected,
              onClick: function () { props.onOpenCommit(row.sha) },
              title: row.sha,
            },
            [
              h('span', {
                key: 'lanes',
                className: 'dshgit-lanes',
                style: { width: (row.laneCount * laneWidth + 6) + 'px' },
              }, lanes),
              row.parents.length > 1 ? h('span', { key: 'merge', className: 'dshgit-badge' }, 'M') : null,
              h('span', { key: 'sha', className: 'dshgit-muted', style: { fontFamily: 'ui-monospace, monospace' } }, row.shortSha),
              h('span', { key: 's', className: 'dshgit-subject' }, row.subject),
              row.tips.length > 0
                ? h('span', { key: 'tips', className: 'dshgit-badge' }, row.tips.slice(0, 3).join(', '))
                : null,
            ],
          )
        })),
      ])
    }

    /** A temporary comparison opened from a branch or commit. */
    function CompareTab(props) {
      var t = props.t, fromState = React.useState(props.from), toState = React.useState(props.to), cacheRef = React.useRef(new Map())
      var data = props.data, selected = (data?.files || []).find(function (file) { return file.path === props.selected })
      var submit = function (event) {
        event?.preventDefault()
        var from = fromState[0].trim(), to = toState[0].trim()
        if (from && to) props.onCompare(from, to)
      }
      var options = [{ value: 'HEAD', label: 'HEAD' }].concat((props.refs || []).map(function (ref) { return { value: ref.ref, label: ref.name } }))
      var loadFile = React.useCallback(function (file, mode) {
        var key = mode + ':' + file.path, cache = cacheRef.current
        if (cache.has(key)) return cache.get(key)
        var promise = mode === 'diff'
          ? props.run('diff', { root: props.repo.root, from: data.from, to: data.to, path: file.path, originalPath: file.from }, { silentError: true })
          : props.run('fileContent', { root: props.repo.root, rev: mode === 'before' ? data.from : data.to, path: mode === 'before' ? file.from || file.path : file.path }, { silentError: true })
        cache.set(key, promise)
        promise.then(function () { while (cache.size > 64) cache.delete(cache.keys().next().value) }, function () { cache.delete(key) })
        return promise
      }, [props.repo.root, data])
      var fileMenu = function (event, file) { props.onFileMenu?.(event, file, data?.to || props.to) }
      return h(Fragment, null, [
        h('form', { key: 'form', className: 'dshgit-card', onSubmit: submit }, [
          h('div', { key: 'row', className: 'dshgit-tools', style: { flexWrap: 'wrap' } }, [
            h('button', { key: 'back', type: 'button', className: 'dshgit-btn', 'data-compare-action': 'back', onClick: props.onBack }, t('compare.back')),
            h('input', { key: 'from', className: 'dshgit-input', list: 'dshgit-compare-refs', value: fromState[0],
              'aria-label': t('compare.from'), placeholder: t('compare.from'), style: { flex: 1, minWidth: '140px' },
              onChange: function (event) { fromState[1](event.currentTarget.value) } }),
            h('button', { key: 'swap', type: 'button', className: 'dshgit-iconbtn', title: t('compare.swap'), 'aria-label': t('compare.swap'), 'data-compare-action': 'swap',
              disabled: !fromState[0].trim() || !toState[0].trim(), onClick: function () { props.onCompare(toState[0].trim(), fromState[0].trim()) },
            }, h(IconCompare, { size: 16 })),
            h('input', { key: 'to', className: 'dshgit-input', list: 'dshgit-compare-refs', value: toState[0],
              'aria-label': t('compare.to'), placeholder: t('compare.to'), style: { flex: 1, minWidth: '140px' },
              onChange: function (event) { toState[1](event.currentTarget.value) } }),
            h('button', { key: 'go', type: 'submit', className: 'dshgit-btn', 'data-compare-action': 'compare',
              disabled: !fromState[0].trim() || !toState[0].trim() }, t('tab.compare')),
          ]),
          h('datalist', { key: 'refs', id: 'dshgit-compare-refs' }, options.map(function (option) {
            return h('option', { key: option.value, value: option.value }, option.label)
          })),
          h('div', { key: 'direction', className: 'dshgit-meta', style: { marginTop: '8px' } },
            props.from.replace(/^refs\/(heads|remotes|tags)\//, '') + ' → ' + props.to.replace(/^refs\/(heads|remotes|tags)\//, '')),
        ]),
        props.error ? h('div', { key: 'error', className: 'dshgit-card', role: 'alert' }, [
          h('span', { key: 'message' }, props.error),
          h('button', { key: 'retry', type: 'button', className: 'dshgit-btn', onClick: function () { props.onCompare(props.from, props.to) } }, t('stash.retry')),
        ]) : !data ? h('div', { key: 'loading', className: 'dshgit-empty', role: 'status' }, t('state.loading')) : null,
        data ? h('details', { key: 'history', className: 'dshgit-card' }, [
          h('summary', { key: 'summary' }, t('compare.commits') + (props.history?.commits ? ' (' + props.history.commits.length + ')' : '')),
          !props.history ? h('div', { key: 'loading', role: 'status' }, t('state.loading'))
            : props.history.error ? h('div', { key: 'error', role: 'alert' }, props.history.error)
              : !props.history.commits?.length ? h('div', { key: 'empty', className: 'dshgit-muted' }, t('state.noCommits'))
                : (props.history.commits || []).map(function (commit) { return h('div', { key: commit.sha, className: 'dshgit-meta' }, [
                  h('span', { key: 'sha' }, commit.shortSha), h('span', { key: 'subject' }, commit.subject),
                ]) }),
        ]) : null,
        data ? selected ? h(HistoryFilePreview, { key: data.from + ':' + data.to + ':' + selected.path, file: selected, loadFile: loadFile, onFileMenu: fileMenu, t: t })
          : h('div', { key: 'empty', className: 'dshgit-empty' }, t('state.emptyDiff')) : null,
      ])
    }

    /* ------------------------------------------------------------------ *
     * Right pane: blame and commit details
     * ------------------------------------------------------------------ */

    /** Render per-line attribution or commit metadata. */
    function RightPane(props) {
      var t = props.t

      if (props.selection !== null && props.selection.kind === 'commit' && props.commitDetail !== null) {
        var detail = props.commitDetail
        return h(Fragment, null, [
          h('div', { key: 'card', className: 'dshgit-card' }, [
            h('div', { key: 'sha', style: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } }, detail.sha),
            h('dl', { key: 'kv', className: 'dshgit-kv' }, [
              h('dt', { key: 'a' }, t('label.author')),
              h('dd', { key: 'av' }, detail.author + ' <' + detail.authorEmail + '>'),
              h('dt', { key: 'd' }, t('label.date')),
              h('dd', { key: 'dv' }, formatTime(detail.authorDate)),
              h('dt', { key: 'p' }, t('label.parents')),
              h('dd', { key: 'pv' }, detail.parents.length === 0
                ? '—'
                : detail.parents.map(function (parent) {
                    return h(
                      'button',
                      {
                        key: parent,
                        type: 'button',
                        className: 'dshgit-btn',
                        style: { marginRight: '4px', fontFamily: 'ui-monospace, monospace' },
                        onClick: function () { props.onOpenCommit(parent) },
                      },
                      parent.slice(0, 7),
                    )
                  })),
            ]),
            h('div', { key: 'msg', className: 'dshgit-code', style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, detail.message),
            h('div', { key: 'actions', style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
              h(
                'button',
                {
                  key: 'explain',
                  type: 'button',
                  className: 'dshgit-btn',
                  onClick: function () {
                    props.run('ai.explainCommit', { root: props.repo.root, sha: detail.sha }, { silentError: true })
                      .then(function (value) {
                        if (value.available === false) {
                          alert(value.message)
                          return
                        }
                        alert(value.text)
                      })
                      .catch(function (failure) { alert(failure.message) })
                  },
                },
                '✨ ' + t('action.explain'),
              ),
              h(
                'button',
                {
                  key: 'copy',
                  type: 'button',
                  className: 'dshgit-btn',
                  onClick: function () {
                    try {
                      navigator.clipboard.writeText(detail.sha)
                    } catch (error) {
                      // Clipboard access can be denied; the sha is on screen anyway.
                    }
                  },
                },
                t('action.copySha'),
              ),
            ]),
          ]),
          h('div', { key: 'files', className: 'dshgit-section' }, [
            h('div', { key: 'h', className: 'dshgit-sectionhead' }, t('label.files') + ' · ' + detail.files.length),
            h('div', { key: 'list' }, detail.files.map(function (file) {
              return h(
                'div',
                {
                  key: file.path,
                  className: 'dshgit-row',
                  onClick: function () { props.onOpenFile({ path: file.path, kind: 'ordinary', staged: false, index: 'M', worktree: 'M' }) },
                },
                [
                  h('span', { key: 's', className: 'dshgit-status' }, file.status !== undefined ? file.status : (file.added === null ? 'B' : 'M')),
                  h('span', { key: 'n', className: 'dshgit-name' }, file.path),
                  h('span', { key: 'c', className: 'dshgit-muted' }, [
                    h('span', { key: 'a', className: 'dshgit-add' }, '+' + (file.added === null ? '?' : file.added)),
                    ' ',
                    h('span', { key: 'd', className: 'dshgit-del' }, '−' + (file.deleted === null ? '?' : file.deleted)),
                  ]),
                ],
              )
            })),
          ]),
        ])
      }

      if (props.blameData === null || props.blameData === undefined) {
        return h('div', { className: 'dshgit-empty' }, t('state.noBlame'))
      }

      var blame = props.blameData
      var lineMap = {}
      for (var i = 0; i < blame.lines.length; i++) lineMap[blame.lines[i].line] = blame.lines[i]

      var blob = props.fileView
      var totalLines = blob !== null && blob !== undefined && typeof blob.text === 'string'
        ? blob.text.replace(/\n$/, '').split('\n')
        : null

      var header = h('div', { key: 'head', className: 'dshgit-card' }, [
        h('div', { key: 'p', className: 'dshgit-name' }, blame.path + '@' + blame.rev),
        h('div', { key: 'm', className: 'dshgit-meta' }, [
          h('span', { key: 'n' }, t('blame.lines', { count: blame.fileLines })),
          blame.cacheable === false ? h('span', { key: 't', className: 'dshgit-del' }, t('state.blameTruncated')) : null,
        ]),
        h('div', { key: 'authors', style: { marginTop: '6px' } }, (blame.authors || []).slice(0, 8).map(function (author) {
          return h('div', { key: author.name, className: 'dshgit-row' }, [
            h('span', { key: 'n', className: 'dshgit-name' }, author.name),
            h('span', { key: 'c', className: 'dshgit-muted' }, t('blame.lines', { count: author.lines })),
          ])
        })),
      ])

      var rows = []
      if (totalLines !== null) {
        for (var ln = 1; ln <= totalLines.length; ln++) {
          var entry = lineMap[ln]
          rows.push(
            h('div', { key: 'l' + ln, className: 'dshgit-coderow' }, [
              h('span', { key: 'g', className: 'dshgit-gutter' }, String(ln)),
              h(
                'span',
                {
                  key: 'b',
                  className: 'dshgit-blamecol',
                  title: entry === undefined
                    ? ''
                    : entry.sha + '\n' + entry.author + '\n' + formatTime(entry.authorTime) + '\n' + entry.summary,
                },
                entry === undefined
                  ? '·'
                  : entry.sha.slice(0, 7) + '  ' + entry.author + '  ' + formatRelative(entry.authorTime),
              ),
              h('span', { key: 't', className: 'dshgit-codetext' }, totalLines[ln - 1]),
            ]),
          )
        }
      } else {
        for (var k = 0; k < blame.lines.length; k++) {
          var item = blame.lines[k]
          rows.push(
            h('div', { key: 'b' + item.line, className: 'dshgit-coderow' }, [
              h('span', { key: 'g', className: 'dshgit-gutter' }, String(item.line)),
              h('span', { key: 'b', className: 'dshgit-blamecol' },
                item.sha.slice(0, 7) + '  ' + item.author + '  ' + formatRelative(item.authorTime)),
            ]),
          )
        }
      }

      return h(Fragment, null, [header, h('div', { key: 'code', className: 'dshgit-code' }, rows)])
    }

    /* ------------------------------------------------------------------ *
     * Settings tab
     * ------------------------------------------------------------------ */

    /** Render the plugin settings page. */
    function SettingsTab(props) {
      var t = props.t
      var configState = React.useState(null)
      var config = configState[0]
      var setConfig = configState[1]
      var diagState = React.useState(null)
      var diagnostics = diagState[0]
      var setDiagnostics = diagState[1]
      var savedState = React.useState(false)
      var saved = savedState[0]
      var setSaved = savedState[1]

      React.useEffect(
        function () {
          props.run('config', {}, { silentError: true }).then(function (value) { setConfig(value); publishPluginConfig(value) }).catch(function () {})
          props.run('diagnostics', {}, { silentError: true }).then(setDiagnostics).catch(function () {})
        },
        [],
      )

      if (config === null) return h('div', { className: 'dshgit-empty' }, t('state.loading'))

      /** Patch and persist one setting. */
      var update = function (key, value) {
        var patch = {}
        patch[key] = value
        setConfig(Object.assign({}, config, patch))
        props.run('setConfig', { patch: patch }, { silentError: true })
          .then(function (next) {
            setConfig(next)
            publishPluginConfig(next)
            setSaved(true)
            setTimeout(function () { setSaved(false) }, 1600)
            if (props.onChanged !== undefined) props.onChanged()
          })
          .catch(function (failure) { props.onToast(failure.message) })
      }

      /** One text field bound to a config key. */
      var field = function (key, label, placeholder, type) {
        return h('div', { key: key, className: 'dshgit-field' }, [
          h('label', { key: 'l', className: 'dshgit-fieldlabel' }, label),
          h('input', {
            key: 'i',
            className: 'dshgit-input',
            type: type === undefined ? 'text' : type,
            value: config[key],
            placeholder: placeholder,
            onChange: function (event) { setConfig(Object.assign({}, config, { [key]: event.currentTarget.value })) },
            onBlur: function (event) { update(key, event.currentTarget.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter') update(key, event.currentTarget.value)
            },
          }),
        ])
      }

      /** One checkbox bound to a config key. */
      var toggle = function (key, label) {
        return h('label', { key: key, className: 'dshgit-checkrow' }, [
          h('input', {
            key: 'i',
            type: 'checkbox',
            checked: config[key] === true,
            onChange: function (event) { update(key, event.currentTarget.checked) },
          }),
          h('span', { key: 'l' }, label),
        ])
      }

      // The three groups the sidebar navigates between. Rendering only the
      // selected one is what turns a single long scroll of unrelated settings
      // (paths, blame tuning, AI, diagnostics) into three scannable pages.
      var section = props.section === undefined ? 'general' : props.section

      var generalCard = h('div', { key: 'git', className: 'dshgit-card' }, [
        h('div', { key: 'h', style: { fontWeight: 600 } }, t('settings.gitFound', { path: props.gitPath || '—' })),
        diagnostics !== null
          ? h('div', { key: 'v', className: 'dshgit-muted', style: { fontSize: 'var(--dshgit-font-small)' } },
              t('settings.version', { version: (diagnostics.sessions[0] && diagnostics.sessions[0].version) || '—' }))
          : null,
        field('gitPath', t('label.gitPath'), t('placeholder.gitPath')),
        field('defaultRepo', t('label.defaultRepo'), t('placeholder.path')),
      ])

      var behaviourCard = h('div', { key: 'behaviour', className: 'dshgit-card' }, [
        field('similarityThreshold', t('label.similarity') + '（1–100）', '50', 'number'),
        field('blameChunkLines', t('label.blameChunk'), '2000', 'number'),
        field('historyLimit', t('label.historyLimit'), '300', 'number'),
        toggle('enableWriteTools', t('label.writeTools')),
        saved ? h('div', { key: 'saved', className: 'dshgit-add', style: { fontSize: 'var(--dshgit-font-small)' } }, t('settings.saved')) : null,
      ])

      var aiCard = h('div', { key: 'ai', className: 'dshgit-card' }, [
        toggle('aiEnabled', t('label.aiEnabled')),
        h('p', { key: 'privacy', className: 'dshgit-dim', style: { margin: 0, fontSize: 'var(--dshgit-font-small)', lineHeight: 1.6 } }, t('settings.aiPrivacy')),
        field('aiProvider', t('label.aiProvider'), ''),
        field('aiModel', t('label.aiModel'), ''),
      ])

      var diagnosticsCard = diagnostics !== null
        ? h('div', { key: 'diag', className: 'dshgit-card' }, [
            h('div', { key: 'h', style: { fontWeight: 600 } }, t('settings.cache')),
            h('dl', { key: 'kv', className: 'dshgit-kv' }, [
              h('dt', { key: 'n' }, 'node'),
              h('dd', { key: 'nv' }, diagnostics.node),
              h('dt', { key: 'p' }, 'platform'),
              h('dd', { key: 'pv' }, diagnostics.platform),
              h('dt', { key: 'r' }, t('settings.repo')),
              h('dd', { key: 'rv' }, diagnostics.sessions.length === 0
                ? t('settings.noRepo')
                : diagnostics.sessions.map(function (session) {
                    var parts = Object.keys(session.cache || {}).map(function (kind) {
                      return kind + ':' + session.cache[kind].size
                    })
                    return session.root + '  (' + parts.join(', ') + ')'
                  }).join(' | ')),
            ]),
          ])
        : h('div', { key: 'diag', className: 'dshgit-card' },
            h('div', { key: 'l', className: 'dshgit-muted' }, t('state.loading')))

      var groups = {
        general: [generalCard, behaviourCard],
        ai: [aiCard],
        diagnostics: [diagnosticsCard],
      }

      return h('div', { className: 'dshgit-scroll', style: { padding: '8px 0 24px' } },
        groups[section] === undefined ? groups.general : groups[section])
    }

    /* ------------------------------------------------------------------ *
     * Registration
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(function () {
        return installStyles()
      }, 'git: styles')

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'git: dictionaries')

      // Soft injection: a profile without `connection` simply does not render
      // this window, instead of failing client activation.
      ctx.inject(['slots', 'connection'], function (scope) {
        var connection = scope.connection
        var t = scope.locale ? scope.locale.bind(NS) : function (key) { return key }

        // The top-right corner of the session header. `utilities` is the
        // right-aligned cluster there, so the button sits with the session's own
        // controls instead of at the sidebar foot.
        //
        // Registered via a soft injection because `conversation.session.header`
        // is session-scoped: on the blank-session screen the seat does not
        // exist, and a hard dependency would fail client activation there.
        scope.slots.inject('conversation.session.header.utilities', function () {
          return scope.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'git',
              order: 40,
              label: function () { return t('panel.title') },
              locale: NS,
            },
            function HeaderGitAction(actionProps) {
              return h(HeaderGitCluster, {
                // The session this cluster belongs to. `conversation.session.header.*`
                // is a session-scoped slot, so the renderer injects `sessionId` from
                // the built-in session source; the window needs it because it lives
                // in a root-scoped slot with no session binding of its own.
                sessionId: actionProps.sessionId,
                connection: connection,
                t: actionProps.t || t,
              })
            },
          )
        })

        scope.slots.inject('shell.overlay', function () {
          return scope.slots.register(
            {
              name: 'shell.overlay',
              id: 'git-window',
              order: 40,
              locale: NS,
            },
            function OverlayWindow(overlayProps) {
              return h(GitWindow, {
                connection: connection,
                t: overlayProps.t || t,
              })
            },
          )
        })

        scope.slots.inject('settings.section', function () {
          return scope.slots.register(
            {
              name: 'settings.section',
              id: 'git-plugin',
              order: 60,
              label: function () { return t('panel.title') },
              locale: NS,
              inject: function () { return { connection: connection } },
            },
            function SettingsSection(sectionProps) {
              return h(SettingsTab, {
                run: function (method, payload) {
                  return callRpc(connection, method, payload, undefined)
                },
                gitPath: null,
                repo: null,
                onChanged: function () {},
                onToast: function () {},
                t: sectionProps.t || t,
              })
            },
          )
        })
      })
    }

    exports.name = 'git-client'
    exports.inject = ['slots', 'locale']
    exports.apply = apply

    return module.exports
  },
})
