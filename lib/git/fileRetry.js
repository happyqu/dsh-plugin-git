import { setTimeout as delay } from 'node:timers/promises'

// Only for plugin-owned temporary files and atomic publication. Never retry
// acquiring a lock: an existing lock may belong to another Git process.
export async function retryFileOperation(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      if (attempt >= 4 || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error
      await delay(100 * (attempt + 1))
    }
  }
}
