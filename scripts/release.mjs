/** Bump the version and push its commit and tag together; CI handles publishing. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(capture ? result.stderr.trim() || `${command} failed` : `${command} failed`)
  }
  return capture ? result.stdout.trim() : ''
}

let releaseTag
try {
  const args = process.argv.slice(2)
  const bump = args[0] || 'patch'
  if (args.length > 1 || !['patch', 'minor', 'major'].includes(bump)) {
    throw new Error('用法：npm run release [-- patch|minor|major]')
  }
  if (!process.env.npm_execpath) throw new Error('请通过 npm run release 执行。')
  const branch = run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], true)) {
    throw new Error('工作区有未提交的修改，请先提交代码，再执行 npm run release。')
  }
  run('git', ['remote', 'get-url', 'origin'], true)
  // Check remote access and branch divergence before creating a version commit.
  run('git', ['push', '--dry-run', 'origin', 'HEAD'])
  console.log(`发布 ${branch} 的 ${bump} 版本…`)
  run(process.execPath, [process.env.npm_execpath, 'version', bump, '--tag-version-prefix=v', '--git-tag-version=true'])
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  releaseTag = `v${pkg.version}`
  // Push only this release tag, and require the branch and tag to update together.
  run('git', ['push', '--atomic', 'origin', 'HEAD', `refs/tags/${releaseTag}`])
  console.log(`已推送 ${releaseTag}。GitHub Actions 将自动构建、发布 npm 和创建 Release。`)
} catch (error) {
  console.error(error.message)
  if (releaseTag) {
    console.error(`本地版本 ${releaseTag} 已生成。解决推送问题后执行以下命令重试，不要再次升级版本：`)
    console.error(`git push --atomic origin HEAD refs/tags/${releaseTag}`)
  }
  process.exitCode = 1
}
