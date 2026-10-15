/**
 * dsh-plugin-git — the Git index lock, acquired with a recoverable owner.
 *
 * Why this exists: `git` treats `.git/index.lock` as a lock purely by its
 * EXISTENCE — nothing inspects whether a process still holds it open. So if this
 * plugin's Host process is killed, or the machine loses power, while a commit
 * holds the lock, the file survives and every later Git operation in that
 * repository fails with "Another git process seems to be running". That state is
 * permanent: the plugin used to answer only "请稍后重试", which is advice the user
 * can follow forever without it ever becoming true.
 *
 * The recovery rule is deliberately narrow. A lock is removed ONLY when this
 * module can prove the process that created it is gone, which it knows because
 * it wrote that process's id into the file. A lock with no readable owner — Git's
 * own empty lock, or a file we did not create — is NEVER removed, because a live
 * Git process holding it would then be racing a second writer, which corrupts the
 * index. Being conservative here costs the user a manual `rm`; being wrong costs
 * them their staged work.
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { retryFileOperation } from './fileRetry.js'

/** Reported when the lock is held by something we must not disturb. */
export const INDEX_BUSY_MESSAGE = 'Git 暂存区正在被其他操作使用，请稍后重试。'
  + '\n如果确认没有其他 Git 进程正在运行，请删除仓库中的 .git/index.lock 后重试。'

/**
 * Is a process id still running?
 *
 * `EPERM` counts as alive: it means the process exists but belongs to another
 * user, and treating a live process as dead is the one answer we must never give.
 *
 * @param pid - a candidate process id.
 * @returns true when the process appears to be running.
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Read the owner id this module recorded in a lock file.
 * @param path - the lock path.
 * @returns the pid, or null when the file has no readable owner.
 */
async function readOwner(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  const value = text.trim()
  // Only a bare decimal id counts. Git's own lock is empty, and a partially
  // written or foreign file must not be mistaken for one of ours.
  if (!/^[1-9][0-9]*$/.test(value)) return null
  return Number(value)
}

/**
 * Create the index lock, taking over a lock this plugin left behind after a crash.
 *
 * @param path - the `.git/index.lock` path.
 * @throws {Error} with {@link INDEX_BUSY_MESSAGE} when another writer holds it.
 */
export async function acquireIndexLock(path) {
  const claim = () => writeFile(path, String(process.pid) + '\n', { encoding: 'utf8', flag: 'wx' })
  try {
    await claim()
    return
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const owner = await readOwner(path)
  // No owner, or a live one: this is somebody else's lock. Refuse.
  if (owner === null || isProcessAlive(owner)) throw new Error(INDEX_BUSY_MESSAGE)
  // The owner is provably gone, so this is our own abandoned lock. Reclaim it.
  await retryFileOperation(() => unlink(path))
  try {
    await claim()
  } catch (error) {
    // Another process claimed it in the meantime; that one is live, so defer.
    if (error.code === 'EEXIST') throw new Error(INDEX_BUSY_MESSAGE)
    throw error
  }
}

/**
 * Replace the real index with a prepared one, atomically, while holding the lock.
 *
 * The lock file IS the staging area for the rename — the prepared bytes are
 * written over the claim and then renamed onto the index, so a crash at any
 * point leaves either the old index or the new one, never a half-written file.
 *
 * @param lockPath - the `.git/index.lock` path.
 * @param indexPath - the real index path it will replace.
 * @param content - the prepared index bytes.
 */
export async function publishIndexLock(lockPath, indexPath, content) {
  await writeFile(lockPath, content)
  await retryFileOperation(() => rename(lockPath, indexPath))
}

/** Drop a lock this process holds, ignoring one that is already gone. */
export async function releaseIndexLock(path) {
  try {
    await retryFileOperation(() => unlink(path))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/**
 * Clear an index lock this plugin abandoned, before an ordinary Git write runs.
 *
 * Every Git write takes the index lock itself, so a lock left behind by a killed
 * Host makes `git add`, `git reset` and `git commit` all fail with Git's own
 * "Another git process seems to be running" — text that names neither the cause
 * nor a fix. Rather than have every caller translate that, the RPC layer reclaims
 * once before each write, so the repository heals itself.
 *
 * The safety rule matches {@link acquireIndexLock}: a lock is removed ONLY when it
 * names an owner that is provably gone. Git's own lock is empty and a live
 * writer's lock names a live pid, so neither is ever touched.
 *
 * @param repo - the repository session.
 * @param options - cancellation.
 * @returns true when an abandoned lock was removed.
 */
export async function reclaimAbandonedIndexLock(repo, options = {}) {
  const located = await repo.run(['rev-parse', '--git-path', 'index'], options)
  if (located.code !== 0) return false
  const path = resolve(repo.root, located.stdout.trim()) + '.lock'
  const owner = await readOwner(path)
  if (owner === null || isProcessAlive(owner)) return false
  await retryFileOperation(() => unlink(path))
  return true
}
