

// One sequence keeps controls in all open plugin surfaces uniquely labelled.
let controlSequence = 0
function nextControlId(prefix) { return prefix + (++controlSequence) }

export { nextControlId }
