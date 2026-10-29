/** A rebase must explicitly identify a replay stop before offering to drop it. */
export function canSkipOperation(operation) {
  if (operation?.kind === 'rebase') return operation.canSkip === true
  return ['am', 'cherry-pick', 'revert'].includes(operation?.kind)
}
