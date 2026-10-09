import { execFile } from 'node:child_process'
const accountCache = new WeakMap()

// Credential output stays inside this module; it never enters Git command logs.
function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, {
      cwd: options.cwd, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      signal: options.signal,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    }, (error, stdout) => error ? reject(new Error('无法读取本机账户或仓库，请检查登录状态与网络')) : resolve(stdout))
    child.stdin?.on?.('error', () => {})
    child.stdin?.end(options.input || '')
  })
}

/** Existing active CLI accounts and GitHub accounts known to GCM, without tokens. */
export async function hostingAccounts(repo, options = {}) {
  const cached = accountCache.get(repo)
  if (!options.force && cached && cached.until > Date.now()) return cached.value
  const [cli, manager] = await Promise.allSettled([
    command('gh', ['auth', 'status', '--json', 'hosts'], { cwd: repo.root, ...options }),
    command(repo.gitPath, ['credential-manager', 'github', 'list', '--no-ui'], { cwd: repo.root, ...options }),
  ])
  const accounts = []
  if (cli.status === 'fulfilled') {
    try {
      for (const [host, entries] of Object.entries(JSON.parse(cli.value).hosts || {})) {
        for (const entry of entries) {
          if (entry.active && entry.state === 'success' && entry.login) accounts.push({
            id: `gh:${host}:${entry.login}`, source: 'gh', host, login: entry.login, protocol: entry.gitProtocol || 'https',
          })
        }
      }
    } catch { /* Older CLI versions can fall back to manual addresses. */ }
  }
  if (manager.status === 'fulfilled') {
    for (const line of manager.value.split(/\r?\n/)) {
      const login = line.trim()
      if (/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login) && !accounts.some(account => account.host === 'github.com' && account.login === login)) {
        accounts.push({ id: `gcm:github.com:${login}`, source: 'gcm', host: 'github.com', login, protocol: 'https' })
      }
    }
  }
  const value = { accounts }
  accountCache.set(repo, { value, until: Date.now() + 60_000 })
  return value
}

async function selectedAccount(repo, request, options) {
  const { accounts } = await hostingAccounts(repo, options)
  const account = accounts.find(entry => entry.id === request.account)
  if (!account) throw new Error('账户已不可用，请刷新账户列表或直接填写仓库地址')
  return account
}

async function githubRequest(repo, account, endpoint, body, options = {}) {
  if (account.source === 'gh') {
    const args = ['api', '--hostname', account.host, endpoint]
    if (body) args.push('--method', 'POST', '--input', '-')
    return JSON.parse(await command('gh', args, { cwd: repo.root, ...options, input: body ? JSON.stringify(body) : undefined }))
  }
  const output = await command(repo.gitPath, ['-c', 'credential.interactive=false', 'credential', 'fill'], {
    cwd: repo.root, ...options, input: `protocol=https\nhost=github.com\nusername=${account.login}\n\n`,
  })
  const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9)
  if (!token) throw new Error('该账户没有可用凭据，请重新登录或直接填写仓库地址')
  const response = await fetch(`https://api.github.com/${endpoint}`, {
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-git', 'Content-Type': 'application/json' },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`GitHub 请求失败（${response.status}），请检查账户权限、仓库名称与网络`)
  return response.json()
}

function repositoryUrl(account, row) {
  if (account.protocol === 'ssh') return row.ssh_url
  const address = new URL(row.clone_url)
  address.username = account.login
  return address.toString()
}

/** Create an empty repository only after the user chooses its name and visibility. */
export async function createHostingRepository(repo, request, options = {}) {
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  if (!/^[a-z\d_.-]{1,100}$/i.test(name) || /^\.+$/.test(name)) throw new Error('GitHub 仓库名称不合法')
  const remoteName = typeof request.remoteName === 'string' ? request.remoteName.trim() : 'origin'
  const validRemote = await repo.run(['check-ref-format', `refs/remotes/${remoteName}/validation`], options)
  if (!remoteName || remoteName.startsWith('-') || validRemote.code !== 0) throw new Error('远端名称不合法')
  const remotes = await repo.remotes(options)
  if (remotes.some(remote => remote.name === remoteName)) throw new Error('远端名称已存在，请换一个名称')
  if (request.branch) {
    const branch = await repo.run(['show-ref', '--verify', '--quiet', `refs/heads/${request.branch}`], options)
    if (branch.code !== 0) throw new Error('请先完成一次提交，再发布当前分支')
  }
  const account = await selectedAccount(repo, request, { ...options, force: true })
  const row = await githubRequest(repo, account, 'user/repos', { name, private: request.private !== false, auto_init: false }, options)
  return { ok: true, message: '已创建 GitHub 仓库', repository: { name: row.full_name, url: repositoryUrl(account, row), private: row.private } }
}

/** Use CLI authentication for this push without changing local or global helpers. */
export async function hostingPushArgs(repo, request, args, options = {}) {
  if (!request.hostingAccount) return args
  const account = await selectedAccount(repo, { account: request.hostingAccount }, options)
  const remote = await repo.run(['remote', 'get-url', '--push', request.remote], options)
  if (remote.code !== 0) throw new Error('远端地址不可用')
  const address = remote.stdout.trim()
  if (account.source !== 'gh' || !address.startsWith('https://')) return args
  if (new URL(address).hostname !== account.host) throw new Error('该账户与推送目标不匹配')
  return ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args]
}

/** Paginated writable repositories, using credentials only on the Host. */
export async function hostingRepositories(repo, request, options = {}) {
  const account = await selectedAccount(repo, request, options)
  const page = Math.max(1, Math.min(100, Number.isInteger(request.page) ? request.page : 1))
  const endpoint = `user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
  const rows = await githubRequest(repo, account, endpoint, null, options)
  if (!Array.isArray(rows)) throw new Error('未能读取仓库列表')
  return { repositories: rows.filter(row => row.permissions?.push && !row.archived).map(row => {
    return { name: row.full_name, url: repositoryUrl(account, row), private: row.private === true }
  }), hasMore: rows.length === 100, page }
}
