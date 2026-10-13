import { h } from '../core/runtime.js'
import { baseName } from '../core/files.js'

// Shared by changes, commit history, comparisons and stash file lists.
var FILE_ICONS = {
  js: ['JS', '#f7d64a', '#332b00'], ts: ['TS', '#3178c6', '#fff'],
  jsx: ['jsx', '#202a35', '#61dafb'], tsx: ['tsx', '#213b55', '#61dafb'],
  php: ['php', '#777bb3', '#fff'], go: ['GO', '#00add8', '#002d38'],
  java: ['java', '#f89820', '#382000'], css: ['CSS', '#2965f1', '#fff'],
  scss: ['S', '#cc6699', '#fff'], less: ['LESS', '#294e80', '#fff'],
  vue: ['V', 'transparent', '#41b883'], svelte: ['S', '#ff3e00', '#fff'],
  html: ['<>', '#e44d26', '#fff'], json: ['{}', '#e8ba42', '#302200'],
  md: ['M↓', '#36a8e8', '#072336'], yaml: ['Y', '#df6868', '#350b0b'],
  python: ['PY', '#3776ab', '#ffe873'], ruby: ['Rb', '#b52b32', '#fff'],
  rust: ['RS', '#ce9178', '#302016'], c: ['C', '#659ad2', '#fff'],
  cpp: ['C++', '#00599c', '#fff'], cs: ['C#', '#68217a', '#fff'],
  kotlin: ['Kt', '#a97bff', '#24163a'], swift: ['Sw', '#f05138', '#fff'],
  dart: ['D', '#0175c2', '#fff'], shell: ['$_', '#4eaa25', '#102900'],
  powershell: ['>_', '#2671be', '#fff'], sql: ['SQL', '#e5b04c', '#342500'],
  xml: ['</>', '#e49b49', '#342000'], config: ['⚙', '#687c96', '#fff'],
  git: ['git', '#f05032', '#fff'], docker: ['D', '#2496ed', '#fff'],
  image: ['▧', '#a78bda', '#24183b'], archive: ['ZIP', '#ba965c', '#2c210f'],
  text: ['≡', '#8795a6', '#172331'], file: ['•', null, null],
}


var FILE_EXTENSIONS = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
  php: 'php', phtml: 'php', go: 'go', java: 'java', class: 'java', jar: 'java',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', vue: 'vue', svelte: 'svelte',
  html: 'html', htm: 'html', json: 'json', jsonc: 'json', json5: 'json',
  md: 'md', mdx: 'md', markdown: 'md', yml: 'yaml', yaml: 'yaml',
  py: 'python', pyw: 'python', rb: 'ruby', rs: 'rust', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'cs', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', dart: 'dart', sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell', bat: 'shell', cmd: 'shell', sql: 'sql',
  xml: 'xml', svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  webp: 'image', ico: 'image', avif: 'image', zip: 'archive', gz: 'archive',
  tar: 'archive', rar: 'archive', '7z': 'archive', txt: 'text', log: 'text',
  ini: 'config', conf: 'config', cfg: 'config', toml: 'config', properties: 'config',
}



function fileIcon(name) {
  var lower = name.toLowerCase()
  var extension = lower.includes('.') ? lower.split('.').pop() : ''
  var kind = /^dockerfile(?:\.|$)/.test(lower) || lower === '.dockerignore' ? 'docker'
    : /^\.git(?:ignore|attributes|modules|keep)$/.test(lower) ? 'git'
      : /^\.env(?:\.|$)/.test(lower) ? 'config'
        : lower === 'go.mod' || lower === 'go.sum' ? 'go'
          : Object.prototype.hasOwnProperty.call(FILE_EXTENSIONS, extension) ? FILE_EXTENSIONS[extension] : 'file'
  var icon = FILE_ICONS[kind]
  var artwork = icon[0]
  if (kind === 'vue') {
    artwork = h('svg', { viewBox: '0 0 24 24', fill: 'none' }, [
      h('path', { key: 'outer', d: 'M1 3h5l6 10 6-10h5L12 22Z', fill: '#41b883' }),
      h('path', { key: 'inner', d: 'M6 3h4l2 3 2-3h4l-6 10Z', fill: '#35495e' }),
    ])
  } else if (kind === 'java') {
    artwork = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, [
      h('path', { key: 'steam', d: 'M12 2c-5 4 5 4 0 8M16 4c-3 2 2 3 0 5' }),
      h('path', { key: 'cup', d: 'M5 12h12v4a6 6 0 0 1-12 0ZM17 12h2a2 2 0 0 1 0 4h-2M4 22h15' }),
    ])
  }
  return h('span', {
    key: 'icon', className: 'dshgit-fileicon', 'data-kind': kind,
    'data-long': icon[0].length > 2 ? 'true' : undefined, 'aria-hidden': 'true',
    style: { '--dshgit-file-bg': icon[1] || undefined, '--dshgit-file-fg': icon[2] || undefined },
  }, artwork)
}



/** A compact file icon and split path, as in the Source Control list. */
function changeFileLabel(path, lfs) {
  var name = baseName(path)
  var directory = String(path || '').slice(0, Math.max(0, String(path || '').length - name.length)).replace(/\/$/, '')
  return [
    fileIcon(name),
    h('span', { key: 'label', className: 'dshgit-filelabel' }, [
      h('span', { key: 'name', className: 'dshgit-filename' }, name),
      lfs ? h('span', { key: 'lfs', className: 'dshgit-lfs-badge', title: 'Git LFS' }, 'LFS') : null,
      directory ? h('span', { key: 'dir', className: 'dshgit-filedir' }, directory) : null,
    ]),
  ]
}

export { changeFileLabel }
