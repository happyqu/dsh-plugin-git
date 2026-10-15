function operationReviewText(t, review) {
  var files = review.files || []
  return t('conflict.reviewHint', { count: files.length }) + '\n\n' + (files.length ? files.slice(0, 100).map(function (file) { return file.status + '  ' + file.path }).join('\n') : t('conflict.noStaged')) + (files.length > 100 ? '\n…' : '')
}
export { operationReviewText }
