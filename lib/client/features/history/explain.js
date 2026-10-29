/**
 * dsh-plugin-git — the commit explanation panel.
 *
 * `ai.explainCommit` was implemented and reachable over RPC from the first version,
 * but its only caller rendered the answer through `alert()`: unselectable,
 * unscrollable, line breaks collapsed into one paragraph. An explanation is a
 * document people read and copy into a review, so it gets a real surface.
 *
 * Two decisions matter:
 *
 * 1. **The answer is bound to the commit it explains.** Switching commits while a
 *    request is in flight must not paint the previous answer under the new commit —
 *    an explanation that is confident and about the wrong thing is worse than none.
 * 2. **The scope is stated.** "Explain this commit" and "explain my working tree" are
 *    different questions, so the panel says which one it answered.
 */
import { React, h } from '../../core/runtime.js'
import { Spinner } from '../../ui/spinner.js'

/**
 * The explanation panel for one commit.
 *
 * @param props - `{ repo, sha, run, t }`.
 */
function ExplainPanel(props) {
  var t = props.t
  // Keyed by sha: the state's identity IS the commit, so a stale answer can never be
  // shown under a different commit even for one render.
  var state = React.useState({ sha: props.sha, text: '', error: '', busy: false })
  var current = state[0].sha === props.sha ? state[0] : { sha: props.sha, text: '', error: '', busy: false }
  var request = React.useRef(null)
  var alive = React.useRef(true)
  React.useEffect(function () {
    alive.current = true
    return function () { alive.current = false; request.current?.abort() }
  }, [])

  var explain = function () {
    if (current.busy) return
    var controller = new AbortController()
    request.current = controller
    state[1]({ sha: props.sha, text: '', error: '', busy: true })
    // A read: `silent`, so asking for an explanation never disables the commit form.
    props.run('ai.explainCommit', { root: props.repo.root, sha: props.sha },
      { silent: true, silentError: true, signal: controller.signal })
      .then(function (value) {
        if (!alive.current || request.current !== controller) return
        // "No model configured" is an ordinary state, not a failure: it is reported as
        // the answer's absence with the Host's own reason.
        if (value.available === false) {
          state[1]({ sha: props.sha, text: '', error: value.message, busy: false })
          return
        }
        state[1]({ sha: props.sha, text: value.text || '', error: '', busy: false })
      })
      .catch(function (failure) {
        if (!alive.current || request.current !== controller || controller.signal.aborted) return
        state[1]({ sha: props.sha, text: '', error: failure.message, busy: false })
      })
      .finally(function () { if (request.current === controller) request.current = null })
  }

  var copy = function () {
    if (current.text === '') return
    // Clipboard access can be denied; the text is on screen and selectable anyway, so
    // a failure here must not look like a failed explanation.
    try { navigator.clipboard?.writeText(current.text)?.catch(function () {}) } catch (error) {}
  }

  var clear = function () { state[1]({ sha: props.sha, text: '', error: '', busy: false }) }

  return h('div', { key: 'explain', className: 'dshgit-explainpanel', 'data-explain-for': props.sha }, [
    h('div', { key: 'actions', className: 'dshgit-explainactions' }, [
      h('button', {
        key: 'go', type: 'button', className: 'dshgit-btn dshgit-explaintoggle',
        'data-explain-run': props.sha, disabled: current.busy, onClick: explain,
      }, current.busy
        ? h(Spinner, { className: 'dshgit-spinner', 'aria-hidden': true })
        : '✨ ' + t('action.explain')),
      current.text !== '' ? h('button', { key: 'copy', type: 'button', className: 'dshgit-btn', onClick: copy }, t('explain.copy')) : null,
      current.text !== '' ? h('button', { key: 'clear', type: 'button', className: 'dshgit-btn', onClick: clear }, t('explain.clear')) : null,
    ]),
    current.error !== '' ? h('div', { key: 'error', role: 'alert', className: 'dshgit-muted' }, current.error) : null,
    current.text !== ''
      // `pre-wrap` because the model's line breaks ARE the structure the prompt asks
      // for; collapsing them turns four labelled sections into one paragraph.
      ? h('pre', {
        key: 'text', className: 'dshgit-explaintext', tabIndex: 0,
        'data-explain-text': props.sha,
      }, current.text)
      : null,
  ])
}

export { ExplainPanel }
