/** Visible, editable defaults shared by Host settings and the AI settings card. */
export const DEFAULT_AI_EXCLUDE_PATTERNS = [
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.tsbuildinfo',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
].join('\n')
