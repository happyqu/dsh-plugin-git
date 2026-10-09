import { readFile, writeFile, open, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readChunks, reconcileChunks } from './changeChunks.js'

const queues = new Map()
const locations = new WeakMap()
const fresh = () => ({ version: 0, mode: 'lists', fileLayout: 'tree', active: 'default', draftList: 'default',
  lists: [{ id: 'default', name: '默认', description: '', draft: '', expanded: true }],
  assignments: {}, selected: [], chunks: {}, stashLists: {} })

export function captureChangelistSnapshots(state, paths) {
  const scope = paths ? new Set(paths) : null
  return state.lists.map(list => {
    const snapshot = { list: { ...list }, assignments: Object.create(null), chunks: Object.create(null) }
    for (const [path, id] of Object.entries(state.assignments)) if (id === list.id && !state.chunks?.[path] && (!scope || scope.has(path))) snapshot.assignments[path] = id
    for (const [path, record] of Object.entries(state.chunks || {})) if (!scope || scope.has(path)) {
      const parts = record.parts.filter(part => part.list === list.id)
      if (parts.length) snapshot.chunks[path] = { parts }
    }
    return snapshot
  }).filter(snapshot => Object.keys(snapshot.assignments).length || Object.keys(snapshot.chunks).length)
}

async function location(repo, options) {
  if (!locations.has(repo)) {
    const pending = repo.run(['rev-parse', '--git-path', 'dsh-changelists.json'], options).then(result => {
      if (result.code !== 0) throw new Error('无法定位改动列表存储目录')
      return resolve(repo.root, result.stdout.trim())
    }).catch(error => { locations.delete(repo); throw error })
    locations.set(repo, pending)
  }
  return locations.get(repo)
}

function reconcile(state, files) {
  const ids = new Set(state.lists.map(list => list.id))
  if (!ids.has(state.active)) state.active = state.lists[0].id
  if (!ids.has(state.draftList)) state.draftList = state.active
  const paths = new Set(files.map(file => file.path))
  const assignments = Object.create(null)
  const selected = new Set(state.selected.filter(path => paths.has(path)))
  for (const file of files) {
    const previous = Object.prototype.hasOwnProperty.call(state.assignments, file.path) ? state.assignments[file.path]
      : file.originalPath && Object.prototype.hasOwnProperty.call(state.assignments, file.originalPath) ? state.assignments[file.originalPath] : null
    if (previous && ids.has(previous)) assignments[file.path] = previous
    else if (file.kind !== 'untracked') {
      assignments[file.path] = state.active
      if (state.mode === 'lists' && state.draftList === state.active) selected.add(file.path)
    }
    if (file.originalPath && state.selected.includes(file.originalPath)) selected.add(file.path)
  }
  state.assignments = assignments
  state.selected = Array.from(selected)
  return state
}

/** Worktree-local, atomic metadata updates; never changes Git's index or files. */
async function transaction(repo, request, options) {
  const path = await location(repo, options)
  let lock, published = false
  try { lock = await open(path + '.lock', 'wx') }
  catch (error) { if (error.code === 'EEXIST') throw new Error('改动列表正在更新，请稍后重试'); throw error }
  try {
    let state
    try { state = JSON.parse(await readFile(path, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('改动列表数据无法读取，原文件已保留'); state = fresh() }
    if (!Array.isArray(state.lists) || !state.lists.length || !Array.isArray(state.selected) || !state.assignments) throw new Error('改动列表数据格式无效')
    const before = JSON.stringify(state)
    const metadataOnly = ['draft', 'rename', 'description', 'expand', 'mode', 'layout', 'select', 'scope', 'active', 'selectChunk', 'create', 'move', 'delete', 'moveChunk'].includes(request.action)
    const preferenceOnly = request.action === 'mode' || request.action === 'layout'
    // A version check precedes reconciliation: callers cannot overwrite another window's edits.
    if (request.action && !request.internal && request.version !== state.version) throw new Error('改动列表已在其他窗口更新，请刷新后重试')
    // View preferences need only a metadata write, even when the status cache
    // has expired. Switching views must not wait for Git or reconcile files.
    const files = preferenceOnly ? [] : (await repo.status({ ...options, force: request.action && !metadataOnly ? true : options.force })).files || []
    if (!preferenceOnly) reconcile(state, files)
    state.chunks = Object.assign(Object.create(null), state.chunks || {})
    for (const [path, record] of metadataOnly ? [] : Object.entries(state.chunks)) {
      const file = files.find(entry => entry.path === path)
      if (!file) { delete state.chunks[path]; continue }
      try { state.chunks[path] = reconcileChunks(record, await readChunks(repo, file, options)) }
      catch { state.chunks[path] = { ...record, invalid: true }; state.selected = state.selected.filter(entry => entry !== path) }
    }
    const list = state.lists.find(entry => entry.id === request.id)
    const name = () => {
      const value = String(request.name || '').trim()
      if (!value || value.length > 100 || /[\0\r\n]/.test(value)) throw new Error('请输入有效的列表名称（最多 100 字）')
      if (state.lists.some(entry => entry.id !== request.id && entry.name === value)) throw new Error('列表名称已存在')
      return value
    }
    const validPaths = () => {
      if (!Array.isArray(request.paths) || request.paths.some(path => !files.some(file => file.path === path))) throw new Error('文件状态已变化，请刷新列表')
      return request.paths
    }
    switch (request.action) {
      case 'create': {
        const id = randomUUID()
        state.lists.push({ id, name: name(), description: '', draft: '', expanded: true })
        if (request.paths) for (const path of validPaths()) {
          if (request.from && state.chunks[path]) { for (const part of state.chunks[path].parts) if (part.list === request.from) part.list = id }
          else { state.assignments[path] = id; delete state.chunks[path] }
        }
        if (request.makeActive) { state.active = id; state.draftList = id; state.selected = files.filter(file => state.assignments[file.path] === id).map(file => file.path) }
        break
      }
      case 'rename': if (!list) throw new Error('列表不存在'); list.name = name(); break
      case 'description': if (!list) throw new Error('列表不存在'); list.description = String(request.text || '').slice(0, 10000); if (!list.draft) list.draft = list.description; break
      case 'draft': if (!list) throw new Error('列表不存在'); list.draft = String(request.text || '').slice(0, 20000); break
      case 'expand': if (!list) throw new Error('列表不存在'); list.expanded = request.expanded === true; break
      case 'active':
        if (!list) throw new Error('列表不存在')
        state.active = list.id
        state.draftList = list.id
        state.selected = files.filter(file => state.assignments[file.path] === list.id).map(file => file.path)
        for (const record of Object.values(state.chunks)) for (const part of record.parts) part.selected = part.list === list.id
        break
      case 'move':
        if (!list) throw new Error('目标列表不存在')
        for (const path of validPaths()) {
          if (request.from && state.chunks[path]) { for (const part of state.chunks[path].parts) if (part.list === request.from) part.list = list.id }
          else { state.assignments[path] = list.id; delete state.chunks[path] }
        }
        break
      case 'select': {
        const selected = new Set(state.selected)
        for (const path of validPaths()) request.checked ? selected.add(path) : selected.delete(path)
        for (const path of request.paths) if (state.chunks[path]) {
          for (const part of state.chunks[path].parts) if (!request.id || part.list === request.id) part.selected = request.checked === true && !!part.list
        }
        state.selected = Array.from(selected)
        break
      }
      case 'scope':
        state.selected = validPaths()
        for (const record of Object.values(state.chunks)) for (const part of record.parts) part.selected = part.list === request.id
        if (list) state.draftList = list.id
        break
      case 'split': {
        const file = files.find(entry => entry.path === request.path)
        const current = await readChunks(repo, file, options)
        state.chunks[file.path] = { parts: current.parts.map(part => ({ id: part.id, hash: part.hash, list: state.assignments[file.path] || state.active, selected: state.selected.includes(file.path) })) }
        break
      }
      case 'moveChunk':
      case 'selectChunk': {
        const record = state.chunks[request.path], part = record?.parts.find(entry => entry.id === request.chunk)
        if (!part || record.invalid) throw new Error('代码块已变化，请刷新并重新分配')
        if (request.action === 'moveChunk') { if (!list) throw new Error('目标列表不存在'); part.list = list.id }
        else { if (!part.list) throw new Error('请先为代码块分配列表'); part.selected = request.checked === true }
        break
      }
      case 'delete':
        if (!list || state.lists.length === 1) throw new Error('至少需要保留一个改动列表')
        if (!state.lists.some(entry => entry.id === request.target && entry.id !== list.id)) throw new Error('请选择接收改动的列表')
        for (const [path, id] of Object.entries(state.assignments)) if (id === list.id) state.assignments[path] = request.target
        for (const record of Object.values(state.chunks)) for (const part of record.parts) if (part.list === list.id) part.list = request.target
        state.lists = state.lists.filter(entry => entry.id !== list.id)
        if (state.active === list.id) state.active = request.target
        if (state.draftList === list.id) state.draftList = request.target
        break
      case 'mode': if (!['lists', 'staging'].includes(request.mode)) throw new Error('无效的改动模式'); state.mode = request.mode; break
      case 'layout': if (!['tree', 'flat'].includes(request.layout)) throw new Error('无效的文件布局'); state.fileLayout = request.layout; break
      case 'stashCapture': {
        if (!request.internal || !list || !/^[a-f0-9]{40,64}$/.test(request.sha)) throw new Error('无效的储藏列表记录')
        state.stashLists = { ...state.stashLists, [request.sha]: { kind: 'changelist', snapshots: captureChangelistSnapshots(state).filter(snapshot => snapshot.list.id === list.id) } }
        break
      }
      case 'stashImport':
        if (!request.internal || !/^[a-f0-9]{40,64}$/.test(request.sha)) throw new Error('无效的储藏列表记录')
        state.stashLists = { ...state.stashLists, [request.sha]: request.snapshots }
        break
      case 'stashRestore': {
        if (!request.internal) throw new Error('无效的储藏列表操作')
        const savedSnapshots = state.stashLists?.[request.sha]
        if (!savedSnapshots) break
        for (const snapshot of Array.isArray(savedSnapshots) ? savedSnapshots : savedSnapshots.snapshots || [savedSnapshots]) {
        if (!state.lists.some(entry => entry.id === snapshot.list.id)) {
          const restored = { ...snapshot.list }
          if (state.lists.some(entry => entry.name === restored.name)) restored.name += ' (恢复)'
          state.lists.push(restored)
        }
        for (const [path, id] of Object.entries(snapshot.assignments)) if (files.some(file => file.path === path)) state.assignments[path] = id
        for (const [path, saved] of Object.entries(snapshot.chunks)) {
          const file = files.find(entry => entry.path === path)
          if (!file || file.kind === 'unmerged') continue
          try {
            const current = await readChunks(repo, file, options)
            let record = state.chunks[path] || { parts: current.parts.map(part => ({ id: part.id, hash: part.hash, list: state.assignments[path] || state.active, selected: false })) }
            record = reconcileChunks(record, current)
            for (const part of record.parts) {
              const matches = saved.parts.filter(entry => entry.hash === part.hash)
              if (matches.length === 1 && record.parts.filter(entry => entry.hash === part.hash).length === 1) part.list = snapshot.list.id
            }
            state.chunks[path] = record
          } catch {}
        }
        }
        break
      }
      case 'stashForget': if (!request.internal) throw new Error('无效的储藏列表操作'); if (state.stashLists) delete state.stashLists[request.sha]; break
      case undefined: break
      default: throw new Error('未知的改动列表操作')
    }
    for (const [path, record] of preferenceOnly ? [] : Object.entries(state.chunks)) {
      state.selected = state.selected.filter(entry => entry !== path)
      if (!record.invalid && record.parts.some(part => part.selected)) state.selected.push(path)
    }
    if (JSON.stringify(state) !== before) {
      state.version++
      await writeFile(path + '.lock', JSON.stringify(state, null, 2), 'utf8')
      await lock.close(); lock = null
      await rename(path + '.lock', path)
      published = true
    }
    return state
  } finally { await lock?.close(); if (!published) await unlink(path + '.lock').catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export function changelists(repo, request = {}, options = {}) {
  const key = repo.root
  const previous = queues.get(key) || Promise.resolve()
  const result = previous.catch(() => {}).then(() => transaction(repo, request, options))
  queues.set(key, result)
  result.finally(() => { if (queues.get(key) === result) queues.delete(key) }).catch(() => {})
  return result
}
