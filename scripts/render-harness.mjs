/**
 * A minimal React-alike renderer, enough to mount this plugin's Client half
 * outside a browser.
 *
 * The component uses a small set of React entry points (`createElement`, `Fragment`,
 * `useState`, `useRef`, `useEffect`, `useCallback`, `useMemo`), so a faithful shim is small
 * and — crucially — a real mount is the only check that catches the failure mode
 * that matters: a component that throws or loops blanks its slot entry, and the
 * user sees an empty panel with no error.
 *
 * Rendering is synchronous. Effects are queued during a pass and drained by
 * `flush()`; re-renders caused by a `setState` inside an effect are then visible
 * to assertions after the next `flush()`.
 */

/** The hook slot store, keyed by component identity. */
const hookStore = new Map()

/** The current component's hook frame. */
let frame = null

/** Monotonic component-path counter, reset per mount. */
let pathCounter = 0

/** Effects queued during the current pass. */
let pendingEffects = []

/** Components mounted since the last pathCounter reset. */
let mountPaths = []

/**
 * Run a component function with a fresh hook cursor for its path.
 * @param path - stable per-mount component path.
 * @param component - the function component.
 * @param props - its props.
 * @returns the rendered node.
 */
function withFrame(path, component, props) {
  const saved = frame
  const next = {
    path,
    cursor: 0,
    slots: hookStore.get(path) ?? { values: [], refs: [], deps: [] },
    // Effects declared by THIS component during THIS render. They are collected
    // per frame rather than appended to the global queue immediately, because
    // React commits a child's passive effects BEFORE its parent's.
    effects: [],
  }
  frame = next
  hookStore.set(path, next.slots)
  try {
    return { node: component(props), effects: next.effects }
  } finally {
    frame = saved
  }
}

/** Allocate the next hook index in the current frame. */
function nextSlot() {
  return frame.cursor++
}

/**
 * `useState`.
 * @param initial - initial value or lazy initializer.
 * @returns `[value, setValue]`.
 */
function useState(initial) {
  const index = nextSlot()
  const slots = frame.slots
  if (slots.values.length <= index) {
    slots.values[index] = typeof initial === 'function' ? initial() : initial
  }
  const path = frame.path
  const setValue = (next) => {
    const slotsAfterUnmount = hookStore.get(path)
    // A state update after the tree was unmounted (a timer that outlived its
    // component) is a no-op, exactly as it is in React. Crashing here would turn
    // a benign late callback into a suite failure.
    if (slotsAfterUnmount === undefined) return
    const current = slotsAfterUnmount.values[index]
    const resolved = typeof next === 'function' ? next(current) : next
    if (Object.is(resolved, current)) return
    slotsAfterUnmount.values[index] = resolved
    // A state change marks the tree dirty; the caller re-renders by calling
    // mount() again, which this harness does inside flush().
    dirtyPaths.add(path)
  }
  return [slots.values[index], setValue]
}

/**
 * `useRef`.
 * @param initial - initial `.current`.
 * @returns a stable ref object.
 */
function useRef(initial) {
  const index = nextSlot()
  const slots = frame.slots
  if (slots.refs.length <= index) {
    slots.refs[index] = { current: initial }
  }
  return slots.refs[index]
}

/**
 * `useEffect`. Effects are queued and drained by `flush()`.
 * @param effect - the effect body.
 * @param deps - dependency list.
 */
function useEffect(effect, deps) {
  const index = nextSlot()
  const slots = frame.slots
  const previous = slots.deps[index]
  const changed =
    previous === undefined ||
    deps === undefined ||
    deps.length !== previous.length ||
    deps.some((value, i) => !Object.is(value, previous[i]))
  if (!changed) return
  slots.deps[index] = deps === undefined ? undefined : [...deps]
  frame.effects.push(effect)
}

/**
 * `useCallback`.
 * @param callback - the callback.
 * @param deps - dependency list.
 * @returns a stable callback while deps are unchanged.
 */
function useCallback(callback, deps) {
  const index = nextSlot()
  const slots = frame.slots
  const previous = slots.refs[index]
  const previousDeps = slots.deps[index]
  const changed =
    previous === undefined ||
    deps === undefined ||
    previousDeps === undefined ||
    deps.length !== previousDeps.length ||
    deps.some((value, i) => !Object.is(value, previousDeps[i]))
  if (changed) {
    slots.refs[index] = callback
    slots.deps[index] = deps === undefined ? undefined : [...deps]
  }
  return slots.refs[index]
}

/** Paths whose state changed, forcing a re-render on the next pass. */
const dirtyPaths = new Set()

/** Compute a value once while the hook's dependencies remain unchanged. */
function useMemo(compute, deps) {
  const cached = useRef(null)
  if (cached.current === null || deps === undefined ||
      cached.current.deps === undefined || deps.length !== cached.current.deps.length ||
      deps.some((value, index) => !Object.is(value, cached.current.deps[index]))) {
    cached.current = { value: compute(), deps: deps === undefined ? undefined : [...deps] }
  }
  return cached.current.value
}

/** React-alike namespace handed to the plugin factory. */
export const React = {
  createElement: (type, props, ...children) => ({
    $$kind: 'element',
    type,
    props: { ...(props ?? {}), children: normalizeChildren(children) },
  }),
  Fragment: Symbol('Fragment'),
  /**
   * `memo` is a render optimisation, not a semantic one: it only lets React skip
   * a re-render when props are shallow-equal. This harness re-renders eagerly, so
   * handing back the component itself is faithful for every assertion made here —
   * while still being required, because the Client half calls `React.memo` at
   * module scope and a missing shim throws before any test can run.
   */
  memo: (component) => component,
  /**
   * `useLayoutEffect` differs from `useEffect` only in WHEN React flushes it
   * (before paint, synchronously). This harness has no paint, and both are
   * drained by `flush()`, so aliasing them is faithful for these assertions
   * while still being required: the Client half calls it during render, and a
   * missing shim throws before any test can run.
   */
  useLayoutEffect: useEffect,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
}

/** Flatten nested children arrays, matching React's behaviour. */
function normalizeChildren(children) {
  const out = []
  const walk = (value) => {
    if (value === null || value === undefined || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    out.push(value)
  }
  walk(children)
  return out
}

/**
 * Render a node tree, invoking function components.
 *
 * @param node - an element, string, or number.
 * @param path - the path prefix for this node.
 * @returns a frozen-ish plain tree of `{ type, props, children }`.
 */
function renderNode(node, path) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return { $$kind: 'text', text: String(node) }
  if (Array.isArray(node)) {
    return node.map((child, index) => renderNode(child, `${path}.${index}`)).filter((child) => child !== null)
  }
  if (node.$$kind !== 'element') return null

  const { type, props } = node
  const childPath = `${path}>${typeof type === 'string' ? type : typeName(type)}`
  if (type === React.Fragment) {
    return { $$kind: 'fragment', children: renderChildren(props.children, childPath) }
  }
  if (typeof type === 'function') {
    // Component identity is POSITION-INDEPENDENT: name plus, when present, the
    // React key. An index-based path looks fine until a list reorders or an
    // element is conditionally omitted — then two different components trade
    // hook slots, and state appears to jump between unrelated parts of the UI.
    // That is a harness bug that reads exactly like a plugin bug, so identity is
    // explicit here.
    const key = elementKey(node)
    const pathKey = `fn:${typeName(type)}${key === null ? '' : `#${key}`}`
    const rendered = withFrame(pathKey, type, props)
    const children = renderChildren([rendered.node], childPath)
    // React drains passive effects deepest-first: a child's effect runs before
    // its parent's. Pushing a component's own effects only after its children
    // have rendered is what reproduces that order here. Getting it wrong hides
    // real bugs — a parent effect that publishes "which session is on screen"
    // must not be assumed to run before the child that reads it.
    pendingEffects.push(...rendered.effects)
    return {
      $$kind: 'component',
      name: typeName(type),
      props,
      children,
    }
  }
  return {
    $$kind: 'host',
    type: String(type),
    props: bindRef(props, hostRefs),
    children: renderChildren(props.children, childPath),
  }
}

/**
 * A registry of fake DOM nodes for host elements that received a `ref`.
 *
 * Component code that attaches a ref to a host element and later reads
 * `ref.current` is common and worth exercising; without this the ref stays null
 * and such code silently takes a different branch under test than in a browser.
 */
const hostRefs = new Map()

/**
 * Attach a fake node to a host element's `ref`, when one was supplied.
 *
 * The fake node carries the handful of properties real component code reads
 * (`style`, `getBoundingClientRect`, `offsetWidth`), so geometry-dependent logic
 * is exercisable and observable.
 *
 * @param props - the element's props.
 * @returns the props, unchanged (the ref object is mutated in place).
 */
function bindRef(props, registry) {
  const ref = props.ref
  if (ref === null || ref === undefined || typeof ref !== 'object') return props
  /** The stand-in node, with its measured size adjustable by tests. */
  const node = {
    style: {},
    offsetWidth: 420,
    offsetHeight: 480,
    /**
     * Report a stable rectangle so drag math has real numbers to work with.
     * @returns a DOMRect-like object.
     */
    getBoundingClientRect() {
      return {
        left: Number.parseFloat(node.style.left ?? '0') || 0,
        top: Number.parseFloat(node.style.top ?? '0') || 0,
        width: node.offsetWidth,
        height: node.offsetHeight,
        right: (Number.parseFloat(node.style.left ?? '0') || 0) + node.offsetWidth,
        bottom: (Number.parseFloat(node.style.top ?? '0') || 0) + node.offsetHeight,
      }
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    /**
     * Ancestor lookup.
     *
     * The harness renders to a plain tree with no parent links, so a real
     * `closest` walk is impossible. Returning null is the honest answer for a
     * detached fake node, and it is the branch real code must already handle —
     * the element may legitimately have been unmounted by the time an effect
     * runs. Tests that need an ancestor use `refNode()` instead.
     *
     * @returns null, always.
     */
    closest() {
      return null
    },
    /**
     * Descendant lookup, likewise absent on a fake node.
     * @returns null, always.
     */
    querySelector() {
      return null
    },
    /**
     * Descendant lookup, likewise absent on a fake node.
     * @returns an empty list, always.
     */
    querySelectorAll() {
      return []
    },
  }
  ref.current = node
  registry.set(props.className, node)
  return props
}

/**
 * Read the fake node bound to a host element's ref, for assertions.
 * @param className - the element's class.
 * @returns the node, or undefined.
 */
export function refNode(className) {
  return hostRefs.get(className)
}

/**
 * The React key of an element, when one was supplied.
 *
 * The plugin passes `key` inside the props object (`h('div', { key: 'x' })`),
 * which is where `createElement` receives it, so it is read from there.
 *
 * @param element - the element.
 * @returns the key as a string, or null.
 */
function elementKey(element) {
  const key = element.props === undefined ? undefined : element.props.key
  if (key === undefined || key === null) return null
  return String(key)
}

/** Render a children array, preserving index-based paths. */
function renderChildren(children, path) {
  const out = []
  for (let i = 0; i < children.length; i++) {
    const rendered = renderNode(children[i], `${path}[${i}]`)
    if (rendered === null) continue
    if (Array.isArray(rendered)) out.push(...rendered)
    else out.push(rendered)
  }
  return out
}

/** Best-effort component name for paths and assertions. */
function typeName(type) {
  return type.displayName || type.name || 'Anonymous'
}

/**
 * Mount a component and return its rendered tree.
 *
 * @param component - the root function component.
 * @param props - root props.
 * @returns `{ tree, remount }`.
 */
export function mount(component, props) {
  pathCounter = 0
  mountPaths = []
  // A fresh mount must not inherit the previous mount's hook state, otherwise a
  // test would silently pass on stale state from the previous one.
  hookStore.clear()
  dirtyPaths.clear()
  pendingEffects = []
  const tree = renderNode(React.createElement(component, props), 'root')
  return { tree }
}

/**
 * Re-render the last mounted tree in place, running queued effects.
 *
 * @param component - the same root component.
 * @param props - the same root props.
 * @returns a fresh tree.
 */
export function rerender(component, props) {
  const effects = pendingEffects
  pendingEffects = []
  for (const effect of effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  mountPaths = []
  return { tree: renderNode(React.createElement(component, props), 'root') }
}

/** Effect cleanups, retained so unmount-like checks can run them. */
const cleanups = []

/**
 * Drain microtasks and effect chains until the tree stops changing.
 *
 * @param component - the root component.
 * @param props - root props.
 * @param options - `{ maxPasses }`.
 * @returns the final tree.
 */
export async function flush(component, props, options = {}) {
  const maxPasses = options.maxPasses ?? 25
  let tree = null
  for (let pass = 0; pass < maxPasses; pass++) {
    // Let promise callbacks (RPC stubs) and their setStates land.
    for (let i = 0; i < 30; i++) await Promise.resolve()
    const hadEffects = pendingEffects.length > 0
    const hadDirty = dirtyPaths.size > 0
    const result = rerender(component, props)
    tree = result.tree
    if (!hadEffects && !hadDirty) break
  }
  return tree
}

/** Run all retained effect cleanups (used to prove disposers exist). */
export function runCleanups() {
  for (const cleanup of cleanups.splice(0, cleanups.length)) cleanup()
}

/* ------------------------------------------------------------------ *
 * Tree queries
 * ------------------------------------------------------------------ */

/**
 * Walk every node in a rendered tree.
 * @param tree - a rendered node.
 * @returns a flat array of nodes.
 */
export function walk(tree) {
  const out = []
  const visit = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    out.push(node)
    if (node.children !== undefined) visit(node.children)
  }
  visit(tree)
  return out
}

/**
 * Collect every text node, concatenated.
 * @param tree - a rendered node.
 * @param separator - placed between text segments.
 * @returns the concatenated text.
 */
export function textOf(tree, separator = ' ') {
  return walk(tree)
    .filter((node) => node.$$kind === 'text')
    .map((node) => node.text)
    .join(separator)
}

/**
 * Find host elements by tag name.
 * @param tree - a rendered node.
 * @param tag - the tag, e.g. `'button'`.
 * @returns matching host nodes.
 */
export function findAll(tree, tag) {
  return walk(tree).filter((node) => node.$$kind === 'host' && node.type === tag)
}

/**
 * Find host elements whose props match a predicate.
 * @param tree - a rendered node.
 * @param predicate - receives the node's props.
 * @returns matching host nodes.
 */
export function findWhere(tree, predicate) {
  return walk(tree).filter((node) => node.$$kind === 'host' && predicate(node.props ?? {}, node))
}

/**
 * Find one node by an exact text match.
 * @param tree - a rendered node.
 * @param text - the text to look for.
 * @returns the matching node or undefined.
 */
export function findByText(tree, text) {
  return walk(tree).find((node) => node.$$kind === 'text' && node.text === text)
}

/**
 * Whether the tree contains a text fragment.
 * @param tree - a rendered node.
 * @param fragment - the substring.
 * @returns true when present.
 */
export function hasText(tree, fragment) {
  return textOf(tree).includes(fragment)
}

/**
 * Extract the plugin module from `lib/client.js` by running its
 * `__ModuleLoader__.load` call against a stub table.
 *
 * @param source - the file's source text.
 * @param options - `{ require }` module table overrides.
 * @returns the plugin exports (`names`, `inject`, `apply`).
 */
export function loadClientModule(source, options = {}) {
  const captured = { id: null, factory: null }
  const moduleTable = {
    react: React,
    'react-dom': {
      createPortal: (element) => element,
    },
    ...(options.require ?? {}),
  }
  const sandboxWindow = {
    __ModuleLoader__: {
      /**
       * Capture the plugin factory instead of evaluating it.
       * @param entry - the registration.
       */
      load(entry) {
        captured.id = entry.id
        captured.factory = entry.factory
      },
    },
    /** Window-level listener bookkeeping (resize, online/offline, storage). */
    listeners: new Map(),
    /**
     * Register a window-level listener.
     *
     * `window` is a distinct event target from `document` in a browser, and the
     * Client half uses both, so the harness has to keep them separate rather
     * than aliasing one onto the other.
     *
     * @param type - the event type.
     * @param handler - the listener.
     */
    addEventListener(type, handler) {
      const list = sandboxWindow.listeners.get(type) ?? []
      list.push(handler)
      sandboxWindow.listeners.set(type, list)
    },
    /**
     * Remove a window-level listener.
     * @param type - the event type.
     * @param handler - the listener.
     */
    removeEventListener(type, handler) {
      const list = sandboxWindow.listeners.get(type) ?? []
      sandboxWindow.listeners.set(type, list.filter((entry) => entry !== handler))
    },
  }

  // The plugin body references `window` and `document`; provide just enough for
  // style installation and clipboard/confirm paths to be exercisable.
  const appendedStyles = []
  const sandboxDocument = {
    /** Listener bookkeeping, so the menu component can register and remove. */
    listeners: new Map(),
    head: {
      /**
       * Record one injected stylesheet.
       * @param element - the style element.
       */
      appendChild(element) {
        appendedStyles.push(element)
      },
    },
    /**
     * Register a document-level listener (the menu's outside-click closer).
     * @param type - the event type.
     * @param handler - the listener.
     */
    addEventListener(type, handler) {
      const list = sandboxDocument.listeners.get(type) ?? []
      list.push(handler)
      sandboxDocument.listeners.set(type, list)
    },
    /**
     * Remove a document-level listener.
     * @param type - the event type.
     * @param handler - the listener.
     */
    removeEventListener(type, handler) {
      const list = sandboxDocument.listeners.get(type) ?? []
      sandboxDocument.listeners.set(type, list.filter((entry) => entry !== handler))
    },
    createElement() {
      return {
        dataset: {},
        textContent: '',
        /**
         * Remove this element (no-op in the harness, but the disposer must exist).
         */
        remove() {},
      }
    },
    /**
     * Document-level lookup.
     *
     * The harness tree is not attached to the fake document, so nothing is ever
     * found. Null is the honest answer and the branch real code already handles
     * (a panel may not be mounted yet). Tests inspect the rendered tree through
     * `walk`/`findWhere` instead.
     *
     * @returns null, always.
     */
    querySelector() {
      return null
    },
    /**
     * Document-level lookup.
     * @returns an empty list, always.
     */
    querySelectorAll() {
      return []
    },
  }

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousGlobalAdd = globalThis.addEventListener
  const previousGlobalRemove = globalThis.removeEventListener
  // These stay installed for the whole session rather than being restored after
  // the factory returns. The plugin's effects call `document.createElement` and
  // register `resize`/`scroll` handlers when they RUN, which is long after the
  // factory has returned — restoring the globals here would make style
  // installation and listener registration fail in a way that looks like a
  // plugin bug.
  globalThis.window = sandboxWindow
  globalThis.document = sandboxDocument
  // The Client half registers `resize`/`scroll` on `globalThis` directly, so
  // those names must exist on the global object itself and not only on the
  // `window` shim.
  globalThis.addEventListener = (type, handler, options) => sandboxWindow.addEventListener(type, handler, options)
  globalThis.removeEventListener = (type, handler, options) => sandboxWindow.removeEventListener(type, handler, options)
  sandboxWindow.__previous = { previousWindow, previousDocument, previousGlobalAdd, previousGlobalRemove }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', `${source}\n`)
  run(sandboxWindow, sandboxDocument)

  return {
    id: captured.id,
    ...captured.factory((name) => {
      if (moduleTable[name] === undefined) throw new Error(`unexpected require("${name}")`)
      return moduleTable[name]
    }),
    appendedStyles,
  }
}

/**
 * Build a fake Cordis client context that records slot registrations.
 *
 * @param options - `{ connection, locale }` overrides.
 * @returns `{ ctx, registrations, effects }`.
 */
export function createClientContext(options = {}) {
  const registrations = []
  const effects = []
  const connection = options.connection ?? {
    rpc: {
      async call() {
        throw new Error('no rpc stub configured')
      },
    },
  }
  const dictionaries = new Map()

  const locale = options.locale ?? {
    /**
     * Record one dictionary registration.
     * @param ns - namespace.
     * @param dicts - per-locale dictionaries.
     * @returns a disposer.
     */
    register(ns, dicts) {
      dictionaries.set(ns, dicts)
      return () => {}
    },
    /**
     * Bind a namespace to a translator.
     * @param ns - namespace.
     * @returns the translate function.
     */
    bind(ns) {
      return (key, values) => {
        const dict = dictionaries.get(ns)
        const table = (dict && (dict.zh || dict.en)) ?? {}
        let text = table[key] ?? key
        for (const [name, value] of Object.entries(values ?? {})) {
          text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }
    },
  }

  const slots = {
    /**
     * Register a slot entry, recording it for assertions.
     * @param declaration - the slot declaration.
     * @param Component - the rendered component.
     * @returns a disposer.
     */
    register(declaration, Component) {
      registrations.push({ declaration, Component })
      return () => {}
    },
    /**
     * Run an injection callback, as the real slot service does when the target
     * slot exists. Names are treated as present unless listed in `missing`.
     * @param _key - the slot key.
     * @param callback - the injection body.
     * @returns the effect the body returned.
     */
    inject(_key, callback) {
      const effect = callback()
      effects.push(effect)
      return () => {}
    },
  }

  const ctx = {
    locale,
    slots,
    connection,
    /**
     * Record one effect.
     * @param callback - the effect body.
     * @param label - the label.
     * @returns the body's result.
     */
    effect(callback, label) {
      const result = callback()
      effects.push({ label, result })
      return result
    },
    /**
     * Run a dynamic injection when its services are present.
     * @param names - required service names.
     * @param callback - the body.
     */
    inject(names, callback) {
      const scope = { ...ctx, slots, locale, connection }
      for (const name of names) {
        if (scope[name] === undefined) return
      }
      callback(scope)
    },
  }

  return { ctx, registrations, effects, dictionaries, connection }
}

/**
 * Build a Connection RPC stub driven by a method table.
 *
 * @param handlers - a map of method name to `(payload) => value` (throwing
 *   rejects the call, mirroring the Host's error envelope).
 * @returns `{ rpc: { call }, calls }`.
 */
export function createRpcStub(handlers) {
  const calls = []
  return {
    calls,
    rpc: {
      /**
       * Answer one RPC call.
       * @param channel - the channel.
       * @param endpoint - the endpoint.
       * @param request - `{ method, payload }`.
       * @returns the envelope the Host would produce.
       */
      async call(channel, endpoint, request) {
        calls.push({ channel, endpoint, method: request.method, payload: request.payload })
        const handler = handlers[request.method]
        if (handler === undefined) {
          return { ok: false, error: { code: 'git/unknown-method', message: `no stub for ${request.method}` } }
        }
        try {
          const value = await handler(request.payload)
          return { ok: true, value }
        } catch (error) {
          return {
            ok: false,
            error: {
              code: error.code ?? 'git/failed',
              message: error.message ?? String(error),
              details: error.details ?? {},
            },
          }
        }
      },
    },
  }
}
