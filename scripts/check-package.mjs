/** Validate distributable entry points and syntax without mounting DSH. */
import { readFile, readdir, access } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const entries = [manifest.main, manifest.exports?.['.']?.default,
  manifest.exports?.['./client'], manifest.dsh?.bundle?.patch,
  'README.md', 'docs/screenshot.png']
for (const entry of entries) {
  if (typeof entry !== 'string' || relative(root, resolve(root, entry)).startsWith('..')) {
    throw new Error('Invalid package entry: ' + String(entry))
  }
  await access(resolve(root, entry))
}
if (resolve(root, manifest.main) !== resolve(root, manifest.exports['.'].default)) {
  throw new Error('main and exports must reference the same Host entry')
}
const patch = await readFile(resolve(root, manifest.dsh.bundle.patch), 'utf8')
if (!patch.includes(manifest.name)) throw new Error('Bundle patch does not register this package')
const client = await readFile(resolve(root, manifest.exports['./client']), 'utf8')
if (!client.includes("id: '" + manifest.name + "'")) throw new Error('Client module id does not match the package name')
async function checkSyntax(directory) {
  let checked = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) checked += await checkSyntax(path)
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true })
      if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr)
      checked++
    }
  }
  return checked
}
const checked = await checkSyntax(join(root, 'lib'))
const host = await import(pathToFileURL(resolve(root, manifest.main)))
if (typeof host.apply !== 'function') throw new Error('Host entry must export apply()')
console.log(`Package check passed: ${checked} modules, Host/Client entries, bundle patch and screenshot`)
