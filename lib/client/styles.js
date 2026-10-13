

var STYLES = [
  '.dshgit-lfs-badge{flex:none;padding:1px 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-imageview{display:flex;flex-direction:column;gap:0;align-items:stretch;min-height:0;height:100%;overflow:hidden}.dshgit-imageview-stage{flex:1;min-height:0;overflow:auto;display:flex;padding:16px}.dshgit-image{max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;margin:auto;background:repeating-conic-gradient(var(--dsw-alias-bg-base) 0% 25%,var(--dsw-alias-bg-layer-2) 0% 50%) 50%/16px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px}.dshgit-imagemeta{flex:none;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dshgit-font-small);max-width:100%}.dshgit-imagemeta>.dshgit-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40ch}.dshgit-imagecontrols{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center}',
  '.dshgit-imagediff{display:flex;flex-direction:column;gap:8px;min-height:0}.dshgit-imagegrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:12px;align-items:start}.dshgit-imageside{display:flex;flex-direction:column;gap:6px;min-width:0}.dshgit-imageside .dshgit-image{max-height:calc(100vh - 300px);margin:0 auto}.dshgit-imagesidehead{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:var(--dshgit-font-small)}.dshgit-imagesidehead>.dshgit-name{font-weight:600}',
  '.dshgit-image-zoomable{cursor:zoom-in}.dshgit-image-zoomable:focus-visible{outline:2px solid var(--dsw-alias-state-focus-primary, var(--dsw-alias-label-primary));outline-offset:2px}',
  '.dshgit-lightbox{background:var(--dshgit-lightbox-mask,rgba(0,0,0,.72));padding:0;align-items:stretch;justify-content:stretch}',
  '.dshgit-lightbox-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}',
  '.dshgit-lightbox-stage{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:20px}',
  '.dshgit-lightbox-image{max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;margin:auto;background:repeating-conic-gradient(var(--dsw-alias-bg-base) 0% 25%,var(--dsw-alias-bg-layer-2) 0% 50%) 50%/16px 16px;border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,.5)}',
  '.dshgit-lightbox-bar{flex:none;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 14px;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1));border-top:1px solid var(--dsw-alias-border-l1);min-width:0}',
  '.dshgit-lightbox-bar>.dshgit-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40ch}',
  '.dshgit-lightbox-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center}',
  '.dshgit-lightbox-bar .dshgit-iconbtn{width:28px;height:28px;flex:none;font-size:var(--dshgit-font-lead);line-height:1}',
  '.dshgit-lightbox-zoom{min-width:56px;font-variant-numeric:tabular-nums;justify-content:center}',
  '.dshgit-imagemeta,.dshgit-lightbox-bar{justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-top:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}.dshgit-imagemeta>.dshgit-name,.dshgit-lightbox-bar>.dshgit-name{flex:1;min-width:80px;max-width:none;text-align:left}.dshgit-imagecontrols,.dshgit-lightbox-controls{flex:none;gap:4px;justify-content:flex-end}.dshgit-imagemeta>.dshgit-muted,.dshgit-lightbox-bar>.dshgit-muted{flex:none;color:var(--dsw-alias-label-secondary)}.dshgit-imagecontrols .dshgit-btn,.dshgit-lightbox-controls .dshgit-btn{padding:4px 8px;min-height:28px}.dshgit-imagecontrols .dshgit-lightbox-zoom,.dshgit-lightbox-controls .dshgit-lightbox-zoom{min-width:56px}.dshgit-imagecontrols .dshgit-iconbtn{width:28px;height:28px}',
  '.dshgit-lfs-panel{display:flex;flex-direction:column;gap:12px}.dshgit-lfs-panel .dshgit-card{margin:0;display:flex;flex-direction:column;gap:10px}.dshgit-lfs-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.dshgit-lfs-report{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;margin:0;font-size:var(--dshgit-font-small)}.dshgit-lfs-row{display:flex;gap:8px;align-items:center;min-width:0}.dshgit-lfs-row>.dshgit-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshgit-lfs-panel .dshgit-field{margin:0}.dshgit-lfs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}',
  // Sections, not floating cards: each one owns a title, a "when would I use
  // this" line, and its own controls, so the panel reads top-to-bottom as
  // status → rules → transfers → files → migration → backups.
  '.dshgit-lfs-section{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1,transparent)}',
  '.dshgit-lfs-sectionhead{display:flex;flex-direction:column;gap:3px;min-width:0}',
  '.dshgit-lfs-sectionhead>strong{font-size:var(--dshgit-font-body);font-weight:600}',
  '.dshgit-lfs-scenario{font-size:var(--dshgit-font-small);line-height:1.55;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-lfs-statusrow{display:flex;gap:10px;align-items:baseline;min-width:0;font-size:var(--dshgit-font-small)}',
  '.dshgit-lfs-statuskey{flex:none;min-width:5.5em;color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-lfs-statusval{min-width:0;overflow-wrap:anywhere}',
  '.dshgit-lfs-statusval.dshgit-lfs-bad{color:var(--dshgit-warning-text)}',
  '.dshgit-lfs-advice{font-size:var(--dshgit-font-small);line-height:1.55;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));color:var(--dsw-alias-label-secondary)}',
  '.dshgit-lfs-advice.dshgit-lfs-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dshgit-warning-text)}',
  '.dshgit-lfs-danger{font-size:var(--dshgit-font-small);line-height:1.55;padding:8px 10px;border-radius:6px;border-left:3px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);color:var(--dsw-alias-label-secondary)}',
  '.dshgit-lfs-step{display:flex;flex-direction:column;gap:8px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l1);min-width:0}',
  '.dshgit-lfs-steplabel{font-size:var(--dshgit-font-small);font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-lfs-inline{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;min-width:0}',
  '.dshgit-lfs-grow{flex:1;min-width:min(220px,100%)}',
  '.dshgit-lfs-listlabel{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-lfs-rules{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;margin:0;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small)}',
  '.dshgit-lfs-code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small)}',
  '.dshgit-lfs-disclosure{align-self:flex-start}',
  '.dshgit-lfs-advanced{display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));min-width:0}',
  '.dshgit-lfs-preview{display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));min-width:0}',
  '.dshgit-lfs-files{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.dshgit-lfs-filelist{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}',
  '.dshgit-lfs-tag{flex:none;padding:1px 6px;border-radius:3px;font-size:var(--dshgit-font-micro);line-height:15px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));color:var(--dsw-alias-label-secondary)}',
  '.dshgit-lfs-tag-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent);color:var(--dshgit-success-text)}',
  '.dshgit-lfs-branchpick{display:flex;flex-direction:column;gap:2px;max-height:160px;overflow:auto}',
  '.dshgit-lfs-backups{display:flex;flex-direction:column;gap:8px}',
  '.dshgit-lfs-backup{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
  '.dshgit-rewrite-dialog{width:min(560px,100%)}',
  '.dshgit-rewrite-list{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}',
  '.dshgit-rewrite-commit{display:flex;gap:8px;align-items:baseline;min-width:0;font-size:var(--dshgit-font-small)}',
  '.dshgit-rewrite-sha{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-rewrite-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-rewrite-message{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical}',
  // Tick column + action row. The column only renders when the list contains
  // an unpushed commit, so a fully-pushed history looks untouched.
  '.dshgit-commitwrap{display:flex;align-items:stretch;gap:6px;min-width:0}',
  '.dshgit-commitwrap>.dshgit-commitrow{flex:1;min-width:0}',
  '.dshgit-commitwrap[data-ticked="true"]{background:var(--dshgit-selected-bg);border-radius:5px}',
  '.dshgit-rwtick{flex:none;align-self:center;width:18px;height:18px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid var(--dsw-alias-border-l1);border-radius:4px;background:transparent;color:var(--dsw-alias-state-business-primary);cursor:pointer}',
  '.dshgit-rwtick:hover{border-color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-rwtick:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
  '.dshgit-rwtick[aria-checked="true"]{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse, #fff)}',
  '.dshgit-rwtick-pad{border-color:transparent;pointer-events:none}',
  '.dshgit-rwbar{margin:0 0 8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
  '.dshgit-rwbar-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0;font-size:var(--dshgit-font-small)}',
  '.dshgit-rwbar-count{font-weight:600;flex:none}',
  '.dshgit-rwbar-note{color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}',
  '.dshgit-rwbar-spacer{flex:1}',
  'body{--dshgit-success-text:color-mix(in srgb,var(--dsw-alias-file-diff-added-marker,var(--dsw-alias-state-success-primary)) 75%,var(--dsw-alias-label-primary));--dshgit-warning-text:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-label-primary))}',
  '.dshgit-branch-item[data-push-pending="true"] .dshgit-branch-select .dshgit-name,.dshgit-branch-item[data-push-pending="true"] .dshgit-branch-tracking,.dshgit-chip[data-push-pending="true"],.dshgit-winbtn[data-push-pending="true"],.dshgit-branch-actions button[data-push-pending="true"],.dshgit-next-ahead{color:var(--dshgit-success-text)}.dshgit-push-indicator{display:inline-flex;align-items:center;gap:4px;flex:none;color:var(--dshgit-success-text);font-size:var(--dshgit-font-small);white-space:nowrap}.dshgit-commitrow[data-unpublished="true"] .dshgit-subject,.dshgit-graph-record[data-unpublished="true"] .dshgit-subject{color:var(--dshgit-success-text)}.dshgit-commit-subject{display:flex;gap:8px;align-items:center;min-width:0}.dshgit-commit-subject>.dshgit-subject{flex:1;min-width:0}.dshgit-winbtn[data-push-pending="true"]:hover:not(:disabled){background:color-mix(in srgb,var(--dshgit-success-text) 12%,transparent)}',
  '.dshgit-cl-toolbar{display:flex;gap:4px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-cl-modebar{gap:8px;justify-content:space-between}',
  '.dshgit-sidebar-head>.dshgit-cl-modebar{flex:1;min-width:0;padding:0;border:0}',
  '.dshgit-sidebar-head>.dshgit-iconbtn{width:28px;height:28px}',
  '.dshgit-cl-mode{display:inline-flex;align-items:center;gap:6px;min-width:0;height:28px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}',
  '.dshgit-cl-mode:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary)}',
  '.dshgit-cl-modebar>.dshgit-iconbtn{width:28px;height:28px;box-sizing:border-box;padding:0;border-radius:4px}',
  '.dshgit-cl-modebar svg{flex:none;width:16px;height:16px}',
  '.dshgit-cl-mode:focus-visible,.dshgit-cl-modebar>.dshgit-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  '.dshgit-cl-group{margin:0 8px 6px;min-width:0}',
  '.dshgit-cl-pane{flex:1;min-height:100%;min-width:0;box-sizing:border-box;padding-bottom:12px}',
  '.dshgit-cl-head{display:flex;align-items:center;gap:4px;min-height:30px;padding:2px 7px 2px 6px;border-radius:3px;background:transparent;box-sizing:border-box}',
  '.dshgit-cl-head>.dshgit-iconbtn{width:24px;height:24px;padding:0;flex:none;display:inline-flex;align-items:center;justify-content:center}',
  '.dshgit-cl-head[data-active="true"] .dshgit-name{font-weight:600}',
  '.dshgit-cl-head[data-drop-target="true"]{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px;background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2))}',
  '.dshgit-cl-toggle[draggable="true"]{cursor:grab}.dshgit-cl-toggle[draggable="true"]:active{cursor:grabbing}.dshgit-cl-head[data-reorder-position="before"]{box-shadow:inset 0 2px var(--dsw-alias-state-business-primary)}.dshgit-cl-head[data-reorder-position="after"]{box-shadow:inset 0 -2px var(--dsw-alias-state-business-primary)}',
  '.dshgit-cl-group[data-commit-blocked="true"]>.dshgit-cl-head,.dshgit-cl-group[data-commit-blocked="true"] .dshgit-change{opacity:.55;filter:grayscale(1)}',
  '.dshgit-cl-head .dshgit-name{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}.dshgit-cl-title{overflow:hidden;text-overflow:ellipsis}.dshgit-cl-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshgit-cl-toggle{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:4px 0}',
  '.dshgit-cl-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}',
  '.dshgit-cl-count{flex:0 0 auto;min-width:12px;text-align:right;font-size:var(--dshgit-font-small);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-cl-search{display:flex;align-items:center;gap:8px;padding:8px 10px 4px}.dshgit-cl-search>.dshgit-input{flex:1;min-width:0;width:100%;box-sizing:border-box}',
  '.dshgit-cl-layout{display:flex;gap:2px;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px}',
  '.dshgit-cl-layout>.dshgit-iconbtn{width:26px;height:26px;border-radius:3px}',
  '.dshgit-cl-layout>.dshgit-iconbtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary)}',
  '.dshgit-cl-active{color:var(--dsw-alias-brand-primary);font-size:var(--dshgit-font-micro)}',
  '.dshgit-cl-checkbox{width:14px;height:14px;flex:0 0 14px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
  '.dshgit-cl-error{padding:8px 10px;color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-cl-viewport{position:relative;overflow:visible;contain:layout;margin:0 0 0 14px;border-left:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-file-filters{display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:6px 10px;flex:none}.dshgit-file-filters .dshgit-btn{padding:3px 7px;font-size:var(--dshgit-font-small)}.dshgit-file-filters [aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}.dshgit-commit-fold{flex:none}.dshgit-commit-fold>.dshgit-btn{margin:6px 10px}.dshgit-sidebar,.dshgit-fileviewernav{position:relative}.dshgit-pane-grip{position:absolute;right:0;top:0;bottom:0;width:6px;z-index:3;cursor:col-resize;touch-action:none}.dshgit-pane-grip:hover{background:var(--dsw-alias-state-business-primary)}@media(max-width:640px){.dshgit-pane-grip{display:none}}',
  // The row's gap matches the group header's (6px), so the file's leading
  // label lands in the same column as the header's label — the same column the
  // header's NAME occupies. With an 8px gap the icon sat 2px right of it, which
  // kept the list looking almost aligned even once the checkboxes matched.
  '.dshgit-cl-viewport .dshgit-change{margin-left:4px;padding-left:6px;gap:4px;border-radius:4px}',
  '.dshgit-cl-viewport .dshgit-change .dshgit-filedir{font-size:var(--dshgit-font-small);opacity:.75}',
  '.dshgit-cl-directory{display:flex;align-items:center;gap:8px;margin-left:6px;padding-right:7px;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-cl-directory-name{display:flex;align-items:center;gap:4px;flex:1;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dshgit-cl-folder-toggle{display:inline-flex;align-items:center;justify-content:center;width:16px;height:22px;flex:0 0 16px;border:0;padding:0;background:transparent;color:inherit;cursor:pointer}',
  '.dshgit-cl-directory-name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-cl-directory-name>svg{flex:none}',
  '.dshgit-cl-directory-name:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:4px}',
  '.dshgit-branch-tools,.dshgit-graph-tools{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-wrap:wrap;flex:none}',
  '.dshgit-branch-toolbar{gap:2px}',
  '.dshgit-branch-toolbar>.dshgit-iconbtn{width:28px;height:28px;box-sizing:border-box;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center}',
  '.dshgit-branch-toolbar>.dshgit-iconbtn>svg{width:16px;height:16px;flex:none}',
  '.dshgit-branch-tree{padding:4px 8px}',
  '.dshgit-branch-folder{min-width:0}',
  '.dshgit-branch-children{padding-left:16px;min-width:0}',
  '.dshgit-branch-folder>summary{display:flex;align-items:center;gap:6px;min-height:32px;padding:4px;box-sizing:border-box;list-style:none;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-branch-folder>summary::-webkit-details-marker{display:none}',
  '.dshgit-branch-folder>summary .dshgit-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-remote-actions{display:none;margin-left:auto;flex:none}',
  '.dshgit-branch-folder>summary:hover .dshgit-remote-actions,.dshgit-branch-folder>summary:focus-within .dshgit-remote-actions,.dshgit-remote-actions[data-busy="true"]{display:flex}',
  '@media(hover:none){.dshgit-remote-actions{display:flex}}',
  '.dshgit-remote-actions>.dshgit-iconbtn{width:24px;height:24px;padding:0}',
  '.dshgit-branch-caret{display:flex;flex:none;width:12px;align-items:center;justify-content:center}',
  '.dshgit-branch-folder[open]>summary .dshgit-branch-caret{transform:rotate(90deg)}',
  '.dshgit-branch-item{display:flex;align-items:center;gap:4px;min-width:0;min-height:32px;padding-right:2px;box-sizing:border-box;border-radius:4px}',
  '.dshgit-branch-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}',
  '.dshgit-branch-item[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
  '.dshgit-branch-select{display:grid;grid-template-columns:14px minmax(0,max-content) max-content minmax(0,1fr);align-items:center;gap:6px;flex:1;min-width:0;min-height:32px;padding:4px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dshgit-branch-select .dshgit-name{grid-column:2;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-branch-select>svg,.dshgit-branch-select>.dshgit-tipdot{flex:none}',
  '.dshgit-branch-tracking{grid-column:3;flex:none;white-space:nowrap}',
  '.dshgit-branch-upstream{grid-column:4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-branch-item[data-upstream-updates="true"] .dshgit-branch-select .dshgit-name,.dshgit-branch-item[data-upstream-updates="true"] .dshgit-branch-tracking{color:var(--dshgit-warning-text)}',
  '.dshgit-branch-statusicon{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px}',
  '.dshgit-branch-update-dot{position:absolute;right:-2px;bottom:-2px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1);pointer-events:none}',
  '.dshgit-branch-actions{display:none;flex:none;align-items:center;gap:2px}',
  '.dshgit-branch-actions .dshgit-iconbtn{width:24px;height:24px;box-sizing:border-box;padding:0;border-radius:4px;display:flex;align-items:center;justify-content:center}',
  '.dshgit-branch-actions .dshgit-iconbtn>svg{width:16px;height:16px;flex:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}',
  '.dshgit-branch-actions .dshgit-iconbtn:hover:enabled{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
  '.dshgit-branch-actions .dshgit-iconbtn:disabled{opacity:.35;cursor:default;background:transparent}',
  '.dshgit-branch-actions .dshgit-iconbtn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
  '.dshgit-branch-actions .dshgit-spinner{width:12px;height:12px;flex:none}',
  '.dshgit-branch-item:hover .dshgit-branch-actions,.dshgit-branch-item:focus-within .dshgit-branch-actions,.dshgit-branch-item[data-busy="true"] .dshgit-branch-actions{display:flex}',
  '.dshgit-branch-item:hover .dshgit-branch-upstream,.dshgit-branch-item:focus-within .dshgit-branch-upstream,.dshgit-branch-item[data-busy="true"] .dshgit-branch-upstream,.dshgit-branch-item:hover .dshgit-branch-tracking,.dshgit-branch-item:focus-within .dshgit-branch-tracking,.dshgit-branch-item[data-busy="true"] .dshgit-branch-tracking{display:none}',
  '.dshgit-branch-item:hover .dshgit-branch-select,.dshgit-branch-item:focus-within .dshgit-branch-select,.dshgit-branch-item[data-busy="true"] .dshgit-branch-select{grid-template-columns:14px minmax(0,1fr)}',
  '@media(hover:none){.dshgit-branch-actions{display:flex}.dshgit-branch-upstream,.dshgit-branch-tracking{display:none}.dshgit-branch-select{grid-template-columns:14px minmax(0,1fr)}}',
  '.dshgit-graph-workbench{display:flex;flex-direction:column;height:100%;min-height:0}',
  '.dshgit-graph-scroll{flex:1;min-height:0;overflow:auto}',
  '.dshgit-graph-record{display:flex;align-items:center;min-width:0;height:32px}',
  '.dshgit-graph-record[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2))}',
  '.dshgit-graph-select{display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:32px;box-sizing:border-box;overflow:hidden;white-space:nowrap;padding:0 8px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dshgit-graph-select .dshgit-subject{flex:1;min-width:0}',
  '.dshgit-graph-sha{flex:none;width:9ch;white-space:nowrap}',
  '.dshgit-graph-author{flex:0 1 96px;min-width:0;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-graph-time{flex:none;white-space:nowrap}',
  '.dshgit-graph-tips{display:flex;gap:6px;flex:0 1 auto;min-width:0;max-width:min(35%,320px);overflow:hidden}',
  '.dshgit-graph-record>.dshgit-iconbtn,.dshgit-graph-record>.dshgit-menubox{flex:none}',
  '.dshgit-graph-tip{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;padding:1px 5px;border-radius:3px;font-size:var(--dshgit-font-small);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));white-space:nowrap}',
  '.dshgit-graph-tip[data-kind="remote"]{border-left:2px solid var(--dsw-alias-state-success-primary,#3b9b65)}',
  '.dshgit-graph-tip[data-kind="local"]{border-left:2px solid var(--dsw-alias-brand-primary)}',
  '.dshgit-graph-tip[data-kind="tag"]{border-left:2px solid var(--dsw-alias-state-warn-primary,#bd923f)}',
  '.dshgit-graph-refs{max-height:min(360px,50vh);overflow:auto}',
  '.dshgit-graph-refs .dshgit-menuitem{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-graph-detail{display:flex;flex-direction:column;min-height:0;overflow:hidden;flex:1}',
  '.dshgit-graph-detail>.dshgit-stash-details{flex:1;min-height:0}',
  '.dshgit-graph-detailtools{display:flex;align-items:center;gap:6px;padding:4px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshgit-graph-detailtools>.dshgit-muted{margin-left:auto;font-size:var(--dshgit-font-small);white-space:nowrap}.dshgit-graph-detail-more{display:inline-flex;align-items:center;margin-left:2px;padding-left:6px;border-left:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-history-files-resizer{grid-column:2;grid-row:1/-1;width:6px;height:100%;min-height:0;border:0;padding:0;background:transparent;cursor:col-resize;touch-action:none}.dshgit-history-files-resizer:hover,.dshgit-history-files-resizer:focus-visible,.dshgit-history-files-resizer[data-dragging="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}',
  '.dshgit-graph-workbench[data-browse-files="true"]{display:grid;grid-template-columns:minmax(0,1fr) 6px clamp(160px,var(--dshgit-history-files-width,clamp(220px,32%,300px)),max(160px,calc(100% - 186px)));grid-template-rows:auto minmax(0,1fr) auto}.dshgit-graph-workbench[data-browse-files="true"]>.dshgit-graph-tools{grid-column:1;grid-row:1}.dshgit-graph-workbench[data-browse-files="true"]>.dshgit-graph-scroll{grid-column:1;grid-row:2;border-right:1px solid var(--dsw-alias-border-l1)}.dshgit-graph-workbench[data-browse-files="true"]>.dshgit-graph-detail{grid-column:3;grid-row:1/-1;min-width:0;border-left:1px solid var(--dsw-alias-border-l1)}.dshgit-graph-workbench[data-browse-files="true"]>.dshgit-workbench-recovery{grid-column:1;grid-row:3}.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-author,.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-time,.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-tips{display:none}.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-select{gap:6px}.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-sha{width:7ch;font-size:var(--dshgit-font-small)}.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-tools .dshgit-combo{max-width:100%}',
  '.dshgit-workbench-dialog{width:min(640px,100%);max-height:calc(100vh - 48px);overflow:auto}',
  '.dshgit-workbench-fields{display:flex;flex-direction:column;gap:10px}',
  '.dshgit-workbench-field{display:flex;flex-direction:column;gap:6px;margin:12px 0}',
  '.dshgit-workbench-dialog .dshgit-check{display:flex;align-items:center;gap:8px;margin:10px 0}',
  '.dshgit-workbench-dialog .dshgit-dialogactions{flex-wrap:wrap}',
  '.dshgit-workbench-dialog .dshgit-dialogactions .dshgit-btn{white-space:normal}',
  '.dshgit-workbench-dialog.dshgit-createbranch-dialog{width:min(440px,100%);padding:20px;gap:14px;font-size:var(--dshgit-font-body)}',
  '.dshgit-createbranch-dialog .dshgit-workbench-field{margin:0;gap:6px;min-width:0}',
  '.dshgit-createbranch-dialog .dshgit-workbench-field>span{font-size:var(--dshgit-font-body);line-height:1.5}',
  '.dshgit-createbranch-dialog .dshgit-workbench-field>.dshgit-name{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-createbranch-dialog .dshgit-check{margin:0;gap:8px;font-size:var(--dshgit-font-small);line-height:1.5}',
  '.dshgit-createbranch-dialog .dshgit-check input{margin:0;width:14px;height:14px;flex:none;accent-color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-createbranch-dialog .dshgit-dialogactions{margin-top:2px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);gap:8px}',
  '.dshgit-workbench-dialog input:not([type=checkbox]),.dshgit-workbench-dialog textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;min-height:32px;padding:5px 10px;font:inherit;line-height:20px}',
  '.dshgit-workbench-preview{padding:10px 0;margin:8px 0;line-height:1.7}',
  '.dshgit-recovery-record{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-workbench-preview{max-height:240px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-workbench-recovery{padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '@media(max-width:760px){.dshgit-graph-author,.dshgit-graph-time{display:none}.dshgit-graph-workbench[data-browse-files="true"]{grid-template-columns:minmax(0,1fr) 6px clamp(160px,var(--dshgit-history-files-width,220px),max(160px,calc(100% - 186px)))}.dshgit-graph-workbench[data-browse-files="true"] .dshgit-graph-tools{padding:6px;gap:4px}}',
  // The type ramp, derived from DSH's own content font size.
  //
  // DSH's Settings → Font size writes `--dsh-content-font-size` (12–17px,
  // default 14) onto `body`, and the shipped UI sizes its conversation
  // surfaces from it. Declaring the ramp on `body` means every plugin
  // surface inherits it — including the portalled popovers, the file viewer
  // and the confirm bar, which are appended to `body` rather than nested in
  // the window they came from.
  //
  // The offsets follow the host's size preference with readable minimums.
  'body{--dshgit-font-base:var(--dsh-content-font-size, 14px);' +
    '--dshgit-font-micro:max(10px, calc(var(--dshgit-font-base) - 4px));' +
    '--dshgit-font-meta:max(12px, calc(var(--dshgit-font-base) - 2px));' +
    '--dshgit-font-small:max(12px, calc(var(--dshgit-font-base) - 2px));' +
    '--dshgit-font-body:max(13px, var(--dshgit-font-base));' +
    '--dshgit-font-lead:max(13px, var(--dshgit-font-base));' +
    '--dshgit-font-title:max(16px, calc(var(--dshgit-font-base) + 2px));' +
    '--dshgit-font-glyph:calc(var(--dshgit-font-base) + 2px);' +
    '--dshgit-font-glyph-lg:calc(var(--dshgit-font-base) + 3px);--dshgit-control-height:32px;--dshgit-icon-size:28px;--dshgit-control-radius:6px;--dshgit-selected-bg:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-1));--dshgit-focus-ring:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}',
  '.dshgit{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dshgit-font-body);font-weight:400;line-height:1.5}',
  // ---- workbench shell ----
  // A large CENTRED window, not a full-viewport one. It opened filling the
  // viewport and the first thing anyone said was "the window is too big":
  // a tool window should sit over the conversation, not replace it. 1180×780
  // keeps the four regions (title bar / activity bar / sidebar + editor /
  // status bar) distinguishable on a 1440×900 screen while leaving the
  // session visible around it; both dimensions shrink with the viewport.
  //
  // The fill is OPAQUE, unlike the floating menu material it borrows its
  // elevation from. `--dsw-menu-surface-fill` is ~45% alpha and is designed
  // to be read through a 40px backdrop blur at menu size; at this size that
  // much transparency turns the conversation behind it into visible noise
  // under 11px status text, and the blur cannot be relied on (it is
  // unavailable on some GPU paths). An opaque raised layer keeps the dense
  // small text legible in both themes.
  '.dshgit-workbench{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1150;display:flex;flex-direction:column;width:min(1180px,94vw);height:min(780px,88vh);pointer-events:auto;overflow:hidden;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.28));isolation:isolate}',
  // The hairline stroke the shipped elevations use, drawn as an inset ring so
  // it survives the translucent fill.
  '.dshgit-workbench::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
  // Leave the host title bar accessible; this only expands the plugin surface.
  '.dshgit-workbench[data-maximized="true"]{left:12px;right:12px;top:56px;bottom:12px;transform:none;width:auto;height:auto}',
  '.dshgit-workbench:not([data-maximized="true"]){max-width:calc(100vw - 24px);max-height:calc(100vh - 72px)}',
  '.dshgit-titlebar[data-draggable="true"]{cursor:grab;touch-action:none;user-select:none}',
  // Title and status strips are opaque too: they sit directly over whatever
  // is behind the panel's rounded corners.
  '.dshgit-titlebar,.dshgit-statusbar{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}',
  // The title bar is identity + actions only. Everything merely informational
  // moved to the status bar, which is what let this row stop wrapping.
  '.dshgit-titlebar{display:flex;align-items:center;gap:8px;flex:none;min-height:44px;padding:0 8px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-titlebar>*{position:relative;z-index:2}',
  '.dshgit-brand{display:flex;align-items:center;gap:6px;flex:none;font-weight:600;font-size:var(--dshgit-font-title)}',
  // Repository identity: the full path, allowed to shrink with an ellipsis.
  // It keeps `flex:0 1 auto` so it yields space before the sync controls do —
  // the controls are actions, the path is a label.
  '.dshgit-crumbs{display:flex;align-items:center;min-width:0;flex:0 1 auto;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-body)}',
  '.dshgit-crumb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dshgit-crumb-sep{opacity:.55;flex:none}',
  '.dshgit-crumb-strong{color:var(--dsw-alias-label-primary);flex:none;font-weight:600}',
  '.dshgit-spacer{flex:1;min-width:0}',
  '.dshgit-tools{display:flex;align-items:center;gap:4px;flex:none}',
  // Window controls. 26px hit area with a 15px glyph, per the 44px touch
  // guidance scaled down for a pointer-only desktop surface.
  '.dshgit-winbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:var(--dshgit-font-lead);line-height:1;flex:none}',
  '.dshgit-winbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
  '.dshgit-winbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.dshgit-title-tools,.dshgit-window-controls{display:flex;align-items:center;gap:2px;flex:none}',
  '.dshgit-window-controls{border-left:1px solid var(--dsw-alias-border-l1);padding-left:8px}',
  '.dshgit-titlebar .dshgit-winbtn{width:28px;height:28px;box-sizing:border-box}',
  '.dshgit-titlebar .dshgit-winbtn>svg{width:16px;height:16px;flex:none}',
  '.dshgit-titlebar .dshgit-spinner{width:16px;height:16px;box-sizing:border-box;flex:none}',
  '.dshgit-titlebar .dshgit-winbtn:disabled{opacity:.4;cursor:default}',
  '.dshgit-window-controls .dshgit-window-close:hover{background:var(--dsw-alias-state-error-primary);color:#fff}',
  '.dshgit-body{display:flex;flex:1;min-height:0}',
  // ---- activity bar ----
  '.dshgit-activitybar{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none;width:48px;padding:6px 0;border-right:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-activity-item{position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color .15s ease, background-color .15s ease}',
  '.dshgit-activity-item:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
  // The active marker is a left accent bar plus the label colour. `aria-pressed`
  // drives it so the visual state cannot drift from the announced state.
  //
  // The bar is offset by exactly the item's own gutter (-4px), which puts it
  // flush against the rail's left edge — i.e. the panel's edge, where VS Code
  // draws it. A larger negative offset would paint OUTSIDE the workbench and
  // be silently cut off by its `overflow:hidden`, which is how this marker was
  // invisible the first time it was written.
  //
  // The bar uses the accent fill (not `brand-primary`, which is a label
  // token) so it reads as the app's accent colour in both themes.
  '.dshgit-activity-item[aria-pressed="true"]{color:var(--dsw-alias-label-primary)}',
  '.dshgit-activity-item[aria-pressed="true"]::before{content:"";position:absolute;left:-4px;top:8px;bottom:8px;width:2px;border-radius:0 2px 2px 0;background:var(--dsw-alias-state-business-primary)}',
  '.dshgit-activity-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  // The badge is an ACCENT FILL, so it uses the accent fill token paired with
  // `label-primary-foreground` — the same pairing DSH's own primary button
  // uses for text on an accent surface. `--dsw-alias-brand-primary` is NOT a
  // fill: it is a label colour (near-white in dark, near-black in light), so
  // using it as a background produced an invisible white-on-white badge.
  '.dshgit-activity-badge{position:absolute;right:2px;bottom:2px;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);font-size:var(--dshgit-font-micro);line-height:15px;text-align:center;font-weight:600}',
  // ---- sidebar ----
  '.dshgit-sidebar{display:flex;flex-direction:column;flex:none;width:288px;min-width:180px;max-width:60%;border-right:1px solid var(--dsw-alias-border-l1);overflow:hidden}',
  '.dshgit-changes-list{padding:0 8px 8px;min-height:100%;box-sizing:border-box}',
  '.dshgit-changes-list .dshgit-changegroup + .dshgit-changegroup{margin-top:12px}',
  '.dshgit-changes-list .dshgit-changegroupbar{background:transparent;padding:3px 0}',
  '.dshgit-group-primary{opacity:1}',
  '.dshgit-changegroupbar .dshgit-group-primary .dshgit-iconbtn{width:auto;padding:2px 4px;font-size:var(--dshgit-font-small);white-space:nowrap}',
  '.dshgit-sidebar-composer{flex:none;max-height:50%;overflow:auto;padding:10px;border-top:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-sidebar-composer .dshgit-card{padding:0;margin:0;border:0;background:transparent}',
  '.dshgit-sidebar-composer .dshgit-textarea{height:72px;min-height:52px;resize:vertical}',
  '.dshgit-sidebar-composer .dshgit-commit-split{margin-top:0}',
  '.dshgit-changes-list .dshgit-change:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.dshgit-stash-list{display:flex;flex-direction:column;gap:4px;padding:4px 8px}',
  '.dshgit-stash-row{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:9px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dshgit-stash-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
  '.dshgit-stash-item:has(.dshgit-stash-row[aria-pressed="true"]){background:var(--dshgit-selected-bg);box-shadow:inset 2px 0 var(--dsw-alias-state-business-primary)}',
  '.dshgit-stash-row .dshgit-name{width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
  '.dshgit-stash-details{height:100%;min-height:0;display:flex;flex-direction:column}',
  '.dshgit-stash-details > .dshgit-card{flex:none;margin-bottom:0}',
  '.dshgit-stash-detailbody{display:flex;flex:1;min-height:0}',
  '.dshgit-stash-filenav{width:220px;min-width:0;flex:none;display:flex;flex-direction:column;padding:8px;border-right:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-stash-filelist{flex:1;min-height:0;overflow:auto;margin-top:8px}',
  '.dshgit-stash-diff{flex:1;min-width:0;overflow:auto}',
  '.dshgit-filediff{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;overflow:hidden;margin:10px}',
  '.dshgit-filediff-head{display:flex;align-items:center;gap:8px;padding:9px 12px;min-height:42px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08))}',
  '.dshgit-diff-pathcopy{display:flex;align-items:center;gap:5px;flex:1;min-width:0}',
  '.dshgit-diff-pathcopy .dshgit-previewpath{flex:none;min-width:0;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
  '.dshgit-diffstats{display:inline-flex;align-items:center;gap:7px;flex:none;font-size:var(--dshgit-font-small);white-space:nowrap}',
  '.dshgit-diff-added{color:var(--dshgit-success-text)}',
  '.dshgit-diff-deleted{color:var(--dsw-alias-state-error-primary, #d24b40)}',
  '.dshgit-stash-preview{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}',
  '.dshgit-stash-previewtools{display:flex;align-items:center;gap:10px;padding:6px 10px;flex:none}',
  '.dshgit-fileview-switch{display:flex;gap:4px;padding:6px 0;flex:none}',
  '.dshgit-fileview-switch .dshgit-iconbtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
  // The list/tree toggle rides ON the search row, the way every other file
  // list in this plugin arranges it (`.dshgit-cl-search`). On a row of its own
  // it was two small icons alone across the full column width with the list
  // starting underneath — a toolbar that looked detached from what it governs.
  // The row carries no padding of its own: the file column already pads.
  '.dshgit-stash-searchrow{display:flex;align-items:center;gap:8px}',
  '.dshgit-stash-searchrow>.dshgit-input{flex:1;min-width:0}',
  '.dshgit-stash-searchrow .dshgit-fileview-switch{padding:0}',
  '.dshgit-filefolder{padding-left:16px;box-shadow:inset 1px 0 var(--dsw-alias-border-l1)}',
  '.dshgit-filefolder > summary{display:grid;grid-template-columns:16px 17px minmax(0,1fr);align-items:center;gap:6px;min-height:32px;padding:2px 8px;box-sizing:border-box;cursor:pointer;list-style:none;overflow:hidden;white-space:nowrap;margin-left:-16px}.dshgit-filefolder>summary::-webkit-details-marker{display:none}.dshgit-filefolder>summary>svg:first-child{width:16px;height:16px}.dshgit-filefolder>summary>svg:nth-child(2){width:17px;height:17px}.dshgit-filefolder>summary>span{min-width:0;overflow:hidden;text-overflow:ellipsis}.dshgit-filefolder>summary>.dshgit-folder-chevron{transform:rotate(-90deg)}.dshgit-filefolder[open]>summary>.dshgit-folder-chevron{transform:none}',
  '.dshgit-stash-filelist[data-layout="tree"] .dshgit-rowbtn{display:grid;grid-template-columns:16px 17px minmax(0,1fr) auto;gap:6px;padding:2px 8px;min-height:32px}.dshgit-stash-filelist .dshgit-diffstats{font-variant-numeric:tabular-nums}.dshgit-stash-filelist .dshgit-diff-added,.dshgit-stash-filelist .dshgit-diff-deleted{min-width:3ch;text-align:right}',
  '.dshgit-stash-filelist .dshgit-diffstats{margin-left:auto;font-size:var(--dshgit-font-small)}',
  '.dshgit-list-more{display:block;margin:8px auto}',
  '.dshgit-changes-list > .dshgit-input{margin:6px 0}',
  '@media(max-width:760px){.dshgit-stash-detailbody{flex-direction:column}.dshgit-stash-filenav{width:auto;max-height:180px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}}',
  '.dshgit-stash-item{display:flex;flex-direction:column;align-items:stretch;min-width:0;border-radius:4px;overflow:hidden}',
  '.dshgit-stash-item .dshgit-stash-row{width:100%;min-width:0;border-radius:0;padding:8px 10px 4px}',
  '.dshgit-stash-footer{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;padding:0 8px 6px 10px}',
  '.dshgit-stash-meta{flex:1 1 90px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dshgit-font-small);text-align:left;cursor:pointer}',
  '.dshgit-stash-row-actions{display:flex;flex:none;align-items:center;gap:4px;margin-left:auto;opacity:0;pointer-events:none}',
  '.dshgit-stash-item:hover .dshgit-stash-row-actions,.dshgit-stash-item:focus-within .dshgit-stash-row-actions,.dshgit-stash-row-actions:has([aria-busy="true"]){opacity:1;pointer-events:auto}',
  '@media(hover:none){.dshgit-stash-row-actions{opacity:1;pointer-events:auto}}',
  '.dshgit-stash-row-action{display:flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.dshgit-stash-row-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
  '.dshgit-stash-row-action svg,.dshgit-stash-row-action .dshgit-spinner{flex:none}',
  '.dshgit-stash-row-action[data-stash-action="drop"]:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-stash-row-action:disabled{opacity:.45;cursor:default}',
  '.dshgit-stash-row-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
  '.dshgit-stash-row .dshgit-muted{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-sidebar-head{display:flex;align-items:center;gap:6px;flex:none;padding:8px 12px;min-height:40px;box-sizing:border-box;font-size:var(--dshgit-font-body);font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-sidebar-body{flex:1;min-height:0;overflow:auto}',
  '.dshgit-file-list-tools{position:sticky;top:0;z-index:4;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}',
  '.dshgit-sidebar-search{padding:8px 10px 4px}',
  '.dshgit-branch-search{display:flex;align-items:center;gap:6px}',
  '.dshgit-branch-search>.dshgit-input{flex:1;min-width:0}',
  '.dshgit-branch-search .dshgit-iconbtn{width:28px;height:28px;padding:0;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center}',
  '.dshgit-branch-filter-active>.dshgit-iconbtn{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-brand-primary)}',
  '.dshgit-sidebar-hint{padding:8px 10px;font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-history-scope{display:flex;align-items:center;gap:8px;min-width:0}',
  '.dshgit-history-scope>.dshgit-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-history-scope>.dshgit-iconbtn{flex:none;width:28px;height:28px;padding:0}',
  '.dshgit-sidebar-actions{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1)}',
  // A sidebar row that is a real control (not a div with a click handler):
  // keyboard reachable for free, and announced as a button.
  '.dshgit-rowbtn{width:100%;border:0;background:transparent;color:inherit;font-family:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
  '.dshgit-visibility-options{display:flex;flex-direction:column;gap:8px;margin-top:10px}',
  '.dshgit-visibility-option{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dshgit-visibility-option:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}',
  '.dshgit-visibility-option[aria-checked="true"]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}',
  '.dshgit-visibility-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  '.dshgit-visibility-option:disabled{opacity:.55;cursor:default}',
  '.dshgit-visibility-radio{display:grid;place-items:center;flex:none;width:16px;height:16px;box-sizing:border-box;border:2px solid var(--dsw-alias-label-tertiary,#888);border-radius:50%}',
  '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-radio{border-color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}',
  '.dshgit-visibility-label{display:flex;flex-direction:column;gap:3px;min-width:0}',
  '.dshgit-visibility-label>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-visibility-title{font-weight:600}',
  '.dshgit-visibility-option[aria-checked="true"] .dshgit-visibility-title{color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-filterchip{display:flex;align-items:center;gap:6px;margin:0 10px 6px;padding:3px 4px 3px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16));font-size:var(--dshgit-font-small)}',
  '.dshgit-kvrow{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:var(--dshgit-font-body)}',
  '.dshgit-tipdot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary)}',
  '.dshgit-loglist{display:flex;flex-direction:column}',
  // ---- settings ----
  '.dshgit-settings-group{margin-bottom:18px}',
  '.dshgit-settings-grouphead{font-size:var(--dshgit-font-small);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:0 0 8px}',
  // A module with nothing to list drops the sidebar entirely rather than
  // showing an empty column: an empty 272px gutter reads as a failed load.
  '.dshgit-sidebar[data-empty="true"]{display:none}',
  // ---- editor ----
  '.dshgit-editor{display:flex;flex-direction:column;flex:1;min-width:0;overflow:hidden}',
  '.dshgit-editor-head{display:flex;align-items:center;gap:8px;flex:none;min-height:40px;padding:4px 12px;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-editor-body{flex:1;min-height:0;overflow:auto}',
  // ---- status bar ----
  '.dshgit-statusbar{display:flex;align-items:center;gap:12px;flex:none;height:28px;padding:0 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden}',
  '.dshgit-statusbar>*{flex:none}',
  '.dshgit-statusitem{display:inline-flex;align-items:center;gap:4px}',
  '.dshgit-statusbranch{color:var(--dsw-alias-label-secondary)}',
  '.dshgit-pane{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
  '.dshgit-left{width:290px;max-width:36%;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto}',
  '.dshgit-center{flex:1;overflow:auto}',
  '.dshgit-right{width:min(320px,32%);flex:none;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto}',
  '.dshgit-treechildren{margin-left:12px;border-left:1px solid var(--dsw-alias-border-l1);padding-left:5px}',
  '.dshgit-repotree>.dshgit-sectionbar{font-size:var(--dshgit-font-body);font-weight:400;line-height:1.5}',
  '.dshgit-repotree .dshgit-section{padding:5px 2px 5px 8px;border-bottom:0}',
  '.dshgit-treerow{display:flex;align-items:center;gap:5px;min-height:27px;min-width:0;padding:2px 4px;border-radius:4px;cursor:pointer}',
  '.dshgit-treerow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
  '.dshgit-treerow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.2))}',
  '.dshgit-treerow .dshgit-name{font-size:var(--dshgit-font-body)}',
  '.dshgit-treeactions{display:flex;gap:1px;flex:none;opacity:0}',
  '.dshgit-treerow:hover .dshgit-treeactions,.dshgit-treerow:focus-within .dshgit-treeactions{opacity:1}',
  '.dshgit-commitfiles{display:flex;gap:10px;min-height:0}',
  '.dshgit-commitfiles-nav{width:220px;max-width:32%;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto}',
  '.dshgit-commitfiles-main{flex:1;min-width:0;overflow:auto}',
  '.dshgit-section{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-sectionbar{display:flex;align-items:center;gap:4px}',
  '.dshgit-sectionbar .dshgit-sectionhead{flex:1;min-width:0}',
  '.dshgit-sectionactions{display:flex;align-items:center;gap:2px;flex:none}',
  '.dshgit-sectionbar .dshgit-iconbtn{width:24px;height:24px;font-size:var(--dshgit-font-glyph-lg)}',
  '.dshgit-sectionbar .dshgit-iconbtn:disabled{opacity:.35;cursor:default}',
  '.dshgit-changes-section .dshgit-sectionbar{padding:3px 5px;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18))}',
  '.dshgit-changes-section .dshgit-sectionhead{font-size:var(--dshgit-font-lead);text-transform:none;letter-spacing:0;color:var(--dsw-alias-label-primary)}',
  '.dshgit-sectionbar .dshgit-sectioncount{margin-left:2px}',
  '.dshgit-changegroup{min-width:0}',
  '.dshgit-changegroupbar{display:flex;align-items:center;gap:3px;min-height:28px;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14))}',
  '.dshgit-changegrouphead{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:2px 3px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
  '.dshgit-changegrouphead .dshgit-caret{width:14px;flex:none}',
  '.dshgit-changegrouphead span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-changegroupactions{display:flex;align-items:center;gap:1px;opacity:0;flex:none}',
  '.dshgit-changegroupbar:hover .dshgit-changegroupactions,.dshgit-changegroupbar:focus-within .dshgit-changegroupactions{opacity:1}',
  '.dshgit-changegroupbar .dshgit-iconbtn{width:25px;height:25px}',
  '.dshgit-changegroupbar .dshgit-sectioncount{margin-left:2px;flex:none}',
  '.dshgit-commitlists .dshgit-changegroup{margin-top:5px}',
  '.dshgit-subgroup{padding:7px 6px 3px;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-small);font-weight:600}',
  '.dshgit-remoteurl{padding:0 6px 3px;font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-sectionhead{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:var(--dshgit-font-small);text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);padding:4px 2px;background:0 0;border:none;font-family:inherit;width:100%;text-align:left}',
  '.dshgit-sectionhead:hover{color:var(--dsw-alias-label-secondary)}',
  '.dshgit-sectioncount{margin-left:auto;min-width:18px;padding:1px 6px;border-radius:999px;text-align:center;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.22));color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
  '.dshgit-caret{width:10px;display:inline-block;font-size:var(--dshgit-font-micro);opacity:.7}',
  '.dshgit-row{display:flex;align-items:center;gap:8px;min-height:32px;box-sizing:border-box;padding:4px 8px;border-radius:5px;cursor:pointer;min-width:0}',
  '.dshgit-row:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
  '.dshgit-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
  '.dshgit-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-muted{color:var(--dsw-alias-label-secondary)}',
  '.dshgit-dim{color:var(--dsw-alias-label-secondary)}',
  '.dshgit-add{color:var(--dshgit-success-text)}',
  '.dshgit-del{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-badge{font-size:var(--dshgit-font-meta);padding:0 4px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);flex:none}',
  '.dshgit-status{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small);width:20px;flex:none;text-align:center}',
  '.dshgit-change{position:relative;min-height:28px;gap:8px;padding:2px 7px}',
  '.dshgit-change[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(0,120,215,.25))}',
  '.dshgit-fileicon{width:17px;height:17px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;font-size:var(--dshgit-font-micro);font-weight:700;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  '.dshgit-tree-spacer{width:16px;height:16px;flex:0 0 16px}.dshgit-cl-directory-name>svg{width:16px;height:16px}.dshgit-cl-viewport .dshgit-fileicon{width:16px;height:16px}.dshgit-cl-viewport .dshgit-filename{max-width:100%}.dshgit-cl-viewport .dshgit-status{flex:0 0 24px;width:24px;text-align:right}',
  '.dshgit-fileicon{background:var(--dshgit-file-bg,var(--dsw-alias-bg-layer-2));color:var(--dshgit-file-fg,var(--dsw-alias-label-primary));font-family:Arial,sans-serif;line-height:1}',
  '.dshgit-fileicon[data-long="true"]{font-size:calc(var(--dshgit-font-micro) * .8);letter-spacing:-.3px}',
  '.dshgit-fileicon>svg{width:17px;height:17px;display:block}',
  '.dshgit-filelabel{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}',
  '.dshgit-filename{overflow:hidden;text-overflow:ellipsis;flex:none;max-width:70%;font-size:var(--dshgit-font-body);line-height:1.45}',
  '.dshgit-filedir{overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
  '.dshgit-change .dshgit-status{margin-left:auto;color:var(--dshgit-success-text);font-weight:600}.dshgit-cl-viewport .dshgit-change .dshgit-status{margin-left:0}.dshgit-cl-viewport .dshgit-status[data-staging="unstaged"]{width:12px;flex:0 0 12px}',
  '.dshgit-change[data-status="D"] .dshgit-status,.dshgit-change[data-status="!"] .dshgit-status{color:var(--dsw-alias-state-error-primary)}',
  // Reveal on hover or focus. `opacity`, not `display:none`: an element with
  // `display:none` cannot receive focus, so `:focus-within` could never be
  // satisfied by these buttons and Tab skipped them entirely. They are
  // absolutely positioned, so hiding them this way costs no layout.
  '.dshgit-change-actions{position:absolute;right:calc(var(--dshgit-status-width,24px) + 14px);top:50%;transform:translateY(-50%);opacity:0;pointer-events:none;display:flex;align-items:center;gap:2px;padding:0;background:transparent;box-shadow:none}',
  '.dshgit-cl-viewport .dshgit-status[data-staging]{width:12px;min-width:12px;flex:0 0 12px}.dshgit-cl-viewport .dshgit-change[data-staging="staged"] .dshgit-filename{color:var(--dshgit-success-text)}.dshgit-cl-viewport .dshgit-change[data-staging="partial"] .dshgit-filename{color:var(--dshgit-warning-text)}',
  '.dshgit-change:hover .dshgit-change-actions,.dshgit-change:focus-within .dshgit-change-actions{opacity:1;pointer-events:auto}',
  '.dshgit-cl-directory:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshgit-change-actions [data-file-action="discard"]{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-change-action{display:inline-flex;align-items:center;justify-content:center;flex:none;font:inherit;font-size:var(--dshgit-font-glyph);line-height:1;width:22px;height:22px;padding:0;border:none;border-radius:3px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}.dshgit-change-action>svg,.dshgit-changegroupactions .dshgit-iconbtn>svg{display:block;flex:none}',
  '.dshgit-change-action:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.18))}',
  '.dshgit-change-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
  '.dshgit-cl-head{position:relative}.dshgit-cl-head .dshgit-change-actions,.dshgit-cl-viewport .dshgit-change-actions{position:static;transform:none;flex:none;width:0;overflow:hidden}.dshgit-cl-head:hover .dshgit-change-actions,.dshgit-cl-head:focus-within .dshgit-change-actions,.dshgit-cl-viewport .dshgit-change:hover .dshgit-change-actions,.dshgit-cl-viewport .dshgit-change:focus-within .dshgit-change-actions{width:auto;overflow:visible}.dshgit-cl-head .dshgit-cl-active{flex:none}.dshgit-cl-head:hover .dshgit-change-actions,.dshgit-cl-head:focus-within .dshgit-change-actions{opacity:1;pointer-events:auto}',
  // Partially staged rows are flagged so the reason they appear twice is
  // visible without hovering.
  '.dshgit-partial .dshgit-status{color:var(--dshgit-warning-text);font-weight:600}',
  '.dshgit-iconbtn:focus-visible,.dshgit-btn:focus-visible,.dshgit-menuitem:focus-visible,.dshgit-rowbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #007acc);outline-offset:2px}',
  '@media(pointer:coarse){.dshgit-iconbtn,.dshgit-branch-actions .dshgit-iconbtn,.dshgit-branch-toolbar>.dshgit-iconbtn{min-width:32px;min-height:32px}}',
  '.dshgit-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;min-height:var(--dshgit-control-height);font:inherit;font-weight:400;font-size:var(--dshgit-font-body);line-height:20px;padding:5px 12px;border-radius:var(--dshgit-control-radius);border:1px solid var(--dsw-alias-border-l2);background:0 0;color:inherit;cursor:pointer;white-space:nowrap}',
  '.dshgit-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshgit-btn:disabled{opacity:1;cursor:default;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l1)}',
  // A toggle (`aria-pressed`) has to look different when it is on, or the
  // only feedback is the tooltip — which is invisible on touch and easy to
  // miss with a mouse. Brand colour + a filled tint reads as "on" at a
  // glance without relying on hover.
  '.dshgit-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)}',
  '.dshgit-btn[aria-pressed="true"]:hover{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)}',
  '.dshgit-btn-primary:not(:disabled){border-color:transparent;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground)}',
  '.dshgit-btn-primary:hover:not(:disabled){border-color:transparent;background:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground)}',
  '.dshgit-commit-actions{display:flex;flex-direction:column;gap:8px}',
  '.dshgit-commit-checks{display:flex;flex-direction:column;gap:6px}',
  '.dshgit-commit-check{display:flex;align-items:center;gap:7px;font-size:var(--dshgit-font-small);cursor:pointer}',
  '.dshgit-commit-check[data-disabled="true"]{opacity:.45;cursor:default}',
  '.dshgit-commit-check input{flex:none;margin:0;width:14px;height:14px;accent-color:var(--dsw-alias-state-business-primary, #007acc)}',
  // The commit control is one joined split button: the label runs the action,
  // the chevron holds the alternate remote steps. Both halves use the host's
  // blue button fill and hover tokens, with theme-aware foreground colours.
  '.dshgit-commit-split{position:relative;display:inline-flex;align-items:stretch;width:auto;max-width:100%;min-width:0}',
  '.dshgit-commit-primary{display:flex;align-items:center;justify-content:center;gap:6px;flex:0 1 auto;min-width:0;min-height:32px;padding:6px 12px;border:0;border-radius:6px 0 0 6px;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground);font-size:var(--dshgit-font-body);font-weight:500;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
  '.dshgit-commit-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary)}',
  // Without a menu the label owns both corners, or the flat right edge reads
  // as a rendering bug.
  '.dshgit-commit-split[data-has-menu="false"] .dshgit-commit-primary{border-radius:6px}',
  '.dshgit-btn.dshgit-commit-primary:disabled{opacity:1;cursor:default}',
  '.dshgit-commit-primary svg{flex:none}',
  '.dshgit-commit-menu-root{position:relative;display:block!important;flex:none;width:32px}',
  // The seam follows the button foreground, including dark-on-light buttons.
  '.dshgit-commit-arrow{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:32px;padding:0;border:0;border-left:1px solid color-mix(in srgb,var(--dsw-alias-label-primary-foreground) 32%,transparent);border-radius:0 6px 6px 0;background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-foreground);cursor:pointer}',
  '.dshgit-commit-arrow:hover:not(:disabled),.dshgit-commit-arrow[aria-expanded="true"]{background:var(--dsw-alias-button-info-hover,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary)}',
  '.dshgit-commit-arrow:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  // ---- unavailable split button ----
  // The two halves are one control, so an unavailable state must grey BOTH.
  // Keyed off the container rather than each `:disabled` so a future change to
  // one half cannot leave the other looking live — which is exactly how the
  // chevron ended up saturated blue beside a greyed-out label. The seam is
  // dropped too, since there is no fill left for it to divide.
  //
  // The fill is a translucent TINT, not `bg-layer-2`: that layer is opaque and
  // equals the panel it sits on (white on white in the light theme), so the
  // button dissolved into the background and only its text remained. The tint
  // darkens or lightens whatever is behind it and is therefore visible on every
  // surface, and the ring gives the shape an edge so it still reads as a
  // control. The ring is a pseudo-element OVERLAY rather than a per-half
  // border: a border would add 2px to each half's box and shift the layout,
  // and two per-half rings would double up along the seam.
  '.dshgit-commit-split[data-disabled="true"] .dshgit-commit-primary,.dshgit-commit-split[data-disabled="true"] .dshgit-commit-arrow{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);cursor:default}',
  // The seam STAYS: it is what tells the user the chevron is a separate hit
  // area, and that is still true when the control is unavailable. It cannot
  // keep the enabled rule's white, though — that was tuned for the blue fill
  // and is invisible on a pale tint in the light theme — so it switches to the
  // theme's own border colour, which adapts to whatever it is drawn over.
  '.dshgit-commit-split[data-disabled="true"] .dshgit-commit-arrow{border-left-color:var(--dsw-alias-border-l3)}',
  '.dshgit-commit-split[data-disabled="true"]::after{content:"";position:absolute;inset:0;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);pointer-events:none}',
  '.dshgit-commit-arrow:disabled{opacity:1;cursor:default}',
  // Portalled commit options sit above the file viewer (1500), below dialogs (1600).
  '.dshgit-menu.dshgit-commit-options{min-width:190px;z-index:1550}',
  '.dshgit-commit-validation{color:var(--dsw-alias-state-error-primary);font-size:var(--dshgit-font-small)}',
  '.dshgit-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
  '.dshgit-input,.dshgit-textarea{font:inherit;font-size:var(--dshgit-font-body);line-height:20px;min-height:var(--dshgit-control-height);padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;outline:none;width:100%;box-sizing:border-box}',
  '.dshgit-input:focus,.dshgit-textarea:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dshgit-focus-ring)}',
  '.dshgit-input:focus-visible,.dshgit-textarea:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dshgit-focus-ring);border-color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-input::placeholder,.dshgit-textarea::placeholder,.dshgit-pickerinput::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}',
  // ---- filterable combobox ----
  // The list is portalled to `body`, not nested: the workbench header sits in
  // a shell with `overflow:hidden` and a `backdrop-filter`, and a fixed
  // descendant of either is clipped or re-attached to that box. Portalling
  // sidesteps both, and it lets the list escape the dialog's own bounds.
  '.dshgit-combolist{position:fixed;z-index:1450;max-height:min(300px,46vh);overflow-y:auto;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3));box-sizing:border-box}',
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-combolist{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-combooption{display:flex;align-items:center;gap:6px;width:100%;padding:5px 7px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dshgit-font-body);text-align:left;cursor:pointer}',
  // The highlighted row needs a visible state even without hover: the pointer
  // sits still while the arrow keys move the selection.
  '.dshgit-combooption[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
  '.dshgit-combooptioncurrent{font-weight:600;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-1))}',
  '.dshgit-combocheck{flex:none;width:14px;order:2;color:var(--dsw-alias-state-business-primary)}',
  '.dshgit-combolabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-combogroup{padding:5px 7px 2px;font-size:var(--dshgit-font-meta);letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-comboempty{padding:8px 7px;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-combo{position:relative;display:block;min-width:0;box-sizing:border-box}',
  '.dshgit-combo .dshgit-comboinput{width:100%;box-sizing:border-box;padding-right:30px;cursor:pointer}',
  '.dshgit-combo[data-open="true"] .dshgit-comboinput:not([readonly]){cursor:text}',
  '.dshgit-combovalue{position:absolute;left:9px;right:30px;top:50%;transform:translateY(-50%);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font:inherit}',
  '.dshgit-combo[data-open="true"] .dshgit-combovalue{color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-comboarrow{position:absolute;top:0;bottom:0;right:0;width:28px;display:flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
  '.dshgit-comboarrow:disabled{cursor:default;opacity:.5}',
  '.dshgit-comboarrow svg{transition:transform .12s ease}',
  '.dshgit-combo[data-open="true"] .dshgit-comboarrow svg{transform:rotate(180deg)}',
  '.dshgit-combolist{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));backdrop-filter:none;-webkit-backdrop-filter:none}',
  '.dshgit-comboinput::placeholder{color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}',
  '.dshgit-commit-composer{box-sizing:border-box;gap:6px;padding:10px;border-radius:6px}',
  '.dshgit-commit-composer .dshgit-textarea{height:60px;min-height:52px;max-height:180px;padding:7px 9px;font-family:inherit;resize:vertical}',
  // Scope text on the left, commit action on the right, ONE line. `baseline`
  // would misalign a bordered control against plain text, so the row centres.
  '.dshgit-commit-meta{display:flex;align-items:center;gap:8px;min-width:0}',
  // The scope text yields to the button rather than pushing it onto a second
  // line: a wrapped row leaves the button stranded at the right of an empty
  // line under left-aligned text, which is what "not neat" looked like. It
  // ellipsizes instead, so the row keeps its shape at any sidebar width.
  '.dshgit-commit-meta>.dshgit-muted{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);line-height:1.5}',
  // `margin-left:auto` pins the action to the right edge, so the row reads as
  // "what + do it" and the button lines up with the panel's other right-hand
  // controls instead of floating in the middle of the row.
  '.dshgit-commit-meta>.dshgit-commit-actions{flex:0 0 auto;min-width:0;margin-left:auto}',
  // The message box is the field; the AI trigger is pinned to ITS top-right
  // corner rather than sitting in a row underneath. Below the box it read as
  // a second action competing with Commit, and it cost a whole row of height
  // in a sidebar that is already the shortest thing on screen. Inside the
  // corner it is unambiguously "fills this box".
  '.dshgit-commit-field{position:relative;display:flex;min-width:0}',
  // Reserve the glyph's lane so a long first line never runs underneath it.
  '.dshgit-commit-field[data-ai="true"] .dshgit-textarea{padding-right:34px}',
  '.dshgit-commit-ai{position:absolute;top:6px;right:6px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dshgit-font-body);line-height:1;cursor:pointer}',
  '.dshgit-commit-ai:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary)}',
  '.dshgit-commit-ai:disabled{opacity:.45;cursor:default}',
  '.dshgit-commit-ai:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
  '.dshgit-commit-composer .dshgit-commit-actions{flex-direction:row;align-items:center;flex-wrap:wrap;gap:6px 10px}',
  // The popover is a wide panel, so its commit button is an ordinary primary
  // action: right-aligned with a comfortable basis. It deliberately does NOT
  // reuse the sidebar's tuning — that exists to fit a 272px column.
  '.dshgit-commit-composer .dshgit-commit-split{flex:0 1 auto;width:auto;max-width:100%;margin-left:auto}',
  '.dshgit-commit-composer .dshgit-commit-primary{flex:0 1 auto;min-width:0;padding:4px 16px}',
  // ---- sidebar-sized commit row ----
  // A measured 150px basis gives the button the presence of a primary action
  // at normal widths, while `flex-shrink:1` + `min-width:0` lets it give room
  // back to the scope text. A hard `min-width` is what breaks here: it stops
  // the button shrinking, so a long label ("12345 files selected") plus a
  // narrow sidebar pushes the chevron off the right edge where it cannot be
  // clicked at all. The label ellipsizes, so the row always fits instead.
  // The scope text yields first: it is the secondary information and it has a
  // tooltip, so capping it at half the row guarantees the action keeps its
  // room. The button gets NO hard `min-width` — any floor large enough to keep
  // the label legible is also large enough to push the chevron off the edge of
  // the narrowest sidebar, where it cannot be clicked at all. Its width comes
  // from the 150px basis, which is what actually sets its size in practice.
  '.dshgit-sidebar-composer .dshgit-commit-meta>.dshgit-muted{flex:0 1 auto;max-width:50%}',
  '.dshgit-sidebar-composer .dshgit-commit-actions{flex:0 1 auto;min-width:0}',
  '.dshgit-sidebar-composer .dshgit-commit-split{flex:0 1 150px;min-width:0}',
  '.dshgit-sidebar-composer .dshgit-commit-primary{box-sizing:border-box;min-width:0;padding:4px 12px;line-height:18px}',
  '.dshgit-sidebar-composer .dshgit-commit-composer .dshgit-textarea{height:60px}',
  '.dshgit-empty{padding:20px 14px;color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-body);line-height:1.7}',
  '.dshgit-setup{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
  '.dshgit-setup-card{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin:auto;color:var(--dsw-alias-label-primary)}',
  '.dshgit-setup-icon{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
  '.dshgit-setup-title{font-size:var(--dshgit-font-title);font-weight:600;line-height:1.5}',
  '.dshgit-setup-hint{font-size:var(--dshgit-font-body);line-height:1.7;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-setup-path{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:var(--dshgit-font-small);line-height:1.6;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-setup-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}',
  '.dshgit-setup-actions .dshgit-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 12px;box-sizing:border-box}',
  '.dshgit-setup-error{font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
  '.dshgit-err{color:var(--dsw-alias-state-error-primary);font-size:var(--dshgit-font-body);padding:6px 10px;line-height:1.6}',
  '.dshgit-preview-more{position:sticky;left:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small)}',
  '.dshgit-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body);line-height:1.55;white-space:pre;overflow-x:auto}',
  '.dshgit-file-content{min-width:0;outline:none}.dshgit-findbar{position:sticky;top:8px;height:0;z-index:5}.dshgit-findpanel{position:absolute;top:0;right:8px;width:min(480px,calc(100% - 16px));box-sizing:border-box;display:flex;align-items:center;gap:4px;padding:6px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base)));border:1px solid var(--dsw-alias-border-l1);border-radius:6px;box-shadow:0 3px 10px #0003}.dshgit-findbar .dshgit-input{flex:1;min-width:60px;padding:4px 8px}.dshgit-find-count{flex:none;min-width:48px;font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary);text-align:center}.dshgit-findbar .dshgit-iconbtn{flex:none;width:26px;height:26px}.dshgit-findbar [aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.dshgit-find-hit{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d6a228) 30%,transparent);color:inherit}.dshgit-find-active{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d6a228) 55%,transparent);outline:1px solid var(--dsw-alias-state-warning-primary,#d6a228)}',
  '.dshgit-preview-with-overview{display:grid;grid-template-columns:minmax(0,1fr) var(--dshgit-overview-width,36px);gap:4px;position:relative;min-width:0}.dshgit-preview-with-overview>.dshgit-code{min-width:0}.dshgit-overview{position:sticky;top:8px;align-self:start;height:min(240px,60vh);margin:8px 2px;width:calc(100% - 4px);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 6%,transparent);border-radius:2px;cursor:pointer;overflow:hidden;touch-action:none}.dshgit-overview:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dshgit-overview-mark{position:absolute;left:3px;right:2px;min-height:2px;background:var(--dsw-alias-state-business-primary);pointer-events:none}.dshgit-overview-mark[data-kind="add"]{left:50%;right:4px;background:var(--dsw-alias-state-success-primary)}.dshgit-overview-mark[data-kind="del"]{left:4px;right:50%;background:var(--dsw-alias-state-error-primary)}.dshgit-overview-viewport{position:absolute;inset-inline:0;border:1px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);min-height:20px;box-sizing:border-box;pointer-events:none}',
  '.dshgit-coderow{display:flex;min-width:max-content}',
  // Word wrap. `min-width:max-content` on the row is what makes the code
  // pane scroll horizontally instead of wrapping; turning it off (and letting
  // the text break) is the whole feature. The gutter stays aligned because
  // the number is its own column either way.
  '.dshgit-code[data-wrap="true"]{white-space:pre-wrap;overflow-x:hidden}',
  '.dshgit-code[data-wrap="true"] .dshgit-coderow{min-width:0}',
  '.dshgit-code[data-wrap="true"] .dshgit-codetext{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}',
  '.dshgit-gutter{flex:none;width:48px;text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary);user-select:none;border-right:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-coderow .dshgit-gutter{position:sticky;left:0;z-index:1;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:inset -3px 0 transparent}.dshgit-coderow[data-line-change="add"] .dshgit-gutter{box-shadow:inset -3px 0 var(--dshgit-success-text)}.dshgit-coderow[data-line-change="modified"] .dshgit-gutter{box-shadow:inset -3px 0 var(--dsw-alias-state-business-primary)}.dshgit-coderow[data-line-deleted="true"] .dshgit-gutter:after{content:"";position:absolute;right:0;bottom:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-right:6px solid var(--dsw-alias-state-error-primary)}',
  '.dshgit-blamecol{flex:none;width:230px;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-right:1px solid var(--dsw-alias-border-l1);user-select:none}',
  '.dshgit-codetext{flex:1;padding-left:10px;padding-right:16px}',
  '.dshgit-previewhead{display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0;flex-wrap:nowrap}',
  '.dshgit-card.dshgit-previewhead{flex-direction:row}',
  '.dshgit-previewpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.dshgit-previewactions{display:flex;align-items:center;gap:6px;flex:none}',
  // Code colouring comes from Shiki's `css-variables` theme, which reads the
  // `--shiki-token-*` custom properties the DSH theme package defines. There
  // is deliberately no palette here: a second one would drift from the rest
  // of the app and would not follow light/dark.
  '.dshgit-coderow[data-hover="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))}',
  '.dshgit-diffrow{display:flex;min-width:max-content;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body);line-height:1.55}',
  '.dshgit-diffrow[data-kind="add"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}',
  '.dshgit-diffrow[data-kind="del"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}',
  '.dshgit-diffrow[data-kind="hunk"]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08))}',
  // Two independently aligned number columns. Right-aligning each within its
  // own fixed box is what keeps the old-line numbers in the old column and
  // the new-line numbers in the new one on every row kind — including a
  // deletion, where the new column is empty.
  '.dshgit-diffgutter{flex:none;display:flex;gap:6px;padding-right:10px;color:var(--dsw-alias-label-tertiary);user-select:none}',
  '.dshgit-diffnum{flex:none;width:36px;text-align:right;font-variant-numeric:tabular-nums}',
  '.dshgit-diffmarker{flex:none;width:18px;text-align:center;font-weight:700;user-select:none}',
  '.dshgit-diffrow[data-kind="add"] .dshgit-diffmarker{color:var(--dshgit-success-text)}',
  '.dshgit-diffrow[data-kind="del"] .dshgit-diffmarker{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-diffcode>[data-diff-page]{width:max-content;min-width:100%}.dshgit-diffcode .dshgit-diffrow{min-width:0;--dshgit-row-bg:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));background:var(--dshgit-row-bg)}.dshgit-diffcode .dshgit-diffrow[data-kind="add"]{--dshgit-row-bg:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base)))}.dshgit-diffcode .dshgit-diffrow[data-kind="del"]{--dshgit-row-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base)))}.dshgit-diffcode .dshgit-diffgutter{position:sticky;left:0;z-index:1;background:var(--dshgit-row-bg)}.dshgit-diffcode .dshgit-diffnum{width:5ch}.dshgit-diffcode .dshgit-diffmarker{position:sticky;left:calc(10ch + 16px);z-index:1;background:var(--dshgit-row-bg)}.dshgit-diffcode[data-wrap="true"]>[data-diff-page]{width:100%;min-width:0}.dshgit-diffcode[data-wrap="true"] .dshgit-codetext{min-width:0}.dshgit-diffcode>.dshgit-preview-more{position:sticky;left:0}',
  '.dshgit-hunkhead{padding:6px 10px;font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-history-heading{display:flex;align-items:flex-start;gap:12px;min-width:0}',
  '.dshgit-history-subject{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600;font-size:var(--dshgit-font-title);line-height:1.5}',
  '.dshgit-history-heading>.dshgit-iconbtn{flex:none;width:28px;height:28px;padding:0}',
  '.dshgit-history-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:var(--dshgit-font-small);line-height:1.6;overflow-wrap:anywhere}',
  '.dshgit-history-details>.dshgit-card{margin:0;padding:12px 16px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;gap:6px;max-height:35%;overflow:auto}',
  '.dshgit-history-details .dshgit-stash-filenav{box-sizing:border-box;width:clamp(150px,28%,240px);padding:12px;overflow:hidden}',
  '.dshgit-history-details .dshgit-sidebar-head{padding:0 0 8px}',
  '.dshgit-history-details .dshgit-sidebar-head>[data-history-action="copy-paths"]{margin-left:auto}',
  '.dshgit-file-filters{flex-wrap:nowrap}.dshgit-file-filters>[data-file-action="copy-paths"]{margin-left:auto;flex:none}',
  '.dshgit-history-details .dshgit-filediff{margin:12px}',
  '.dshgit-history-filetools{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06))}',
  '.dshgit-history-viewmodes,.dshgit-history-fileactions{display:flex;align-items:center;gap:4px}',
  '.dshgit-history-fileactions{border-left:1px solid var(--dsw-alias-border-l1);padding-left:12px}',
  '.dshgit-history-details .dshgit-iconbtn{box-sizing:border-box;flex:none;width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center}',
  '.dshgit-history-viewmodes .dshgit-iconbtn[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary,#3989e9)}',
  '@media(max-width:760px){.dshgit-history-details .dshgit-stash-filenav{width:100%;max-height:180px}.dshgit-history-details .dshgit-filediff{margin:8px}}',
  '@media(pointer:coarse){.dshgit-history-details .dshgit-iconbtn{width:32px;height:32px}}',
  '.dshgit-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin:8px 10px;display:flex;flex-direction:column;gap:5px}',
  '.dshgit-graphrow{display:flex;align-items:center;gap:8px;padding:2px 8px;cursor:pointer;border-radius:4px;white-space:nowrap}',
  '.dshgit-graphrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
  '.dshgit-graphrow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
  '.dshgit-lanes{flex:none;display:flex;align-items:center}',
  '.dshgit-dot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 3px}',
  '.dshgit-commitrow{display:flex;flex-direction:column;gap:4px;padding:8px;cursor:pointer;border-radius:5px;min-width:0}',
  '.dshgit-commitrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))}',
  '.dshgit-commitrow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))}',
  'button.dshgit-commitrow{width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left}',
  'button.dshgit-commitrow:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.dshgit-history-list{padding:4px 8px}',
  '.dshgit-history-list .dshgit-subject{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;overflow-wrap:anywhere}',
  '.dshgit-history-list .dshgit-meta{flex-wrap:nowrap;overflow:hidden}',
  '.dshgit-history-list .dshgit-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-meta{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary);display:flex;gap:8px;flex-wrap:wrap}',
  '.dshgit-spinner{display:inline-block;box-sizing:border-box;flex:0 0 12px;width:12px;height:12px;aspect-ratio:1;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:dshgit-spin .7s linear infinite;vertical-align:-1px}',
  '@keyframes dshgit-spin{to{transform:rotate(360deg)}}',
  '@media (prefers-reduced-motion: reduce){.dshgit-spinner{animation:none}.dshgit-activity-item,.dshgit-winbtn,.dshgit-treerow,.dshgit-row{transition:none}}',
  '.dshgit-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:1406;box-sizing:border-box;max-width:min(480px,calc(100vw - 32px));padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:var(--dshgit-font-body);line-height:1.5;overflow-wrap:anywhere;pointer-events:none}.dshgit-workbench .dshgit-toast{position:absolute;top:56px;max-width:calc(100% - 32px)}',
  '.dshgit-split{display:flex;gap:8px;align-items:center}',
  '.dshgit-split>*{flex:1;min-width:0}',
  '.dshgit-checkrow{display:flex;align-items:center;gap:7px;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-secondary);padding:3px 0}',
  '.dshgit-field{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;min-width:0}',
  '.dshgit-fieldlabel{font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-primary);line-height:1.5}',
  '.dshgit-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:var(--dshgit-font-body)}',
  '.dshgit-kv dt{color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-kv dd{margin:0;word-break:break-all}',
  '.dshgit-icon{display:inline-flex;align-items:center;justify-content:center}',
  '.dshgit-scroll{overflow:auto;min-height:0}',
  // Dropdown menu: opaque surface, theme-token colors, above the panes.
  '.dshgit-menu{z-index:1200;min-width:180px;max-width:280px;padding:4px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 6px 24px rgba(0,0,0,.35));display:flex;flex-direction:column;gap:1px}',
  '.dshgit-menuitem{font:inherit;font-size:var(--dshgit-font-body);text-align:left;padding:5px 9px;border-radius:5px;border:none;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshgit-menuitem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16))}',
  '.dshgit-menuitem:disabled{opacity:.45;cursor:default}',
  '.dshgit-menudanger{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-menusep{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1)}',
  '.dshgit-contextmenu{position:fixed;z-index:2000;display:flex;flex-direction:column;box-sizing:border-box;width:min(360px,calc(100vw - 8px));max-height:80vh;overflow-y:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter,none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.35));pointer-events:auto}',
  '.dshgit-contextmenu>.dshgit-menuitem{display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;width:100%;min-width:0;padding:7px 9px;white-space:normal}',
  '.dshgit-contextmenu>.dshgit-menuitem>span{min-width:0;overflow-wrap:anywhere}',
  '.dshgit-menucommand{flex:none;font-family:var(--dshgit-font-mono,monospace);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-secondary);white-space:nowrap}',

  // ---- header chips ----
  // The chips live in the session header's utilities cluster, which is a
  // row of the session's own controls. They are deliberately the same height
  // and radius as those controls so the row reads as one strip rather than
  // a plugin bolted on.
  '.dshgit-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));font-size:var(--dshgit-font-small);font-family:inherit;line-height:1;white-space:nowrap;max-width:180px}',
  '.dshgit-chipaction{cursor:pointer}',
  '.dshgit-chipaction:hover,.dshgit-chipaction[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
  '.dshgit-chipname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
  // A dirty working tree is the one chip state worth colouring: it is the
  // fact that changes what the user should do next.
  '.dshgit-chipdirty{color:var(--dsw-alias-label-primary);font-weight:600}',
  '.dshgit-chipdirty svg{color:var(--dsw-alias-state-warn-primary, currentColor)}',
  '.dshgit-chipmuted{color:var(--dsw-alias-label-tertiary);font-size:var(--dshgit-font-small)}',
  '.dshgit-chipbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));font-size:var(--dshgit-font-body);font-family:inherit;cursor:pointer}',
  '.dshgit-chipbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
  '.dshgit-chipbtn:disabled{opacity:.45;cursor:default}',
  '.dshgit-chipnotice{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);color:var(--dsw-alias-state-error-primary)}',
  // ---- action-outcome banner ----
  // Anchored to the chip row it belongs to, but taken OUT of flow so a long
  // message can never push the chips around (which the old inline span did).
  // It is a card, not a toast: an error stays until dismissed, because a
  // failure the user never read is one they will hit again.
  '.dshgit-chipcluster{position:relative;display:flex;align-items:center;gap:4px}',
  '.dshgit-notice{position:absolute;top:calc(100% + 6px);right:0;z-index:1300;display:flex;align-items:flex-start;gap:8px;width:max-content;max-width:min(420px,80vw);padding:9px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.28));font-size:var(--dshgit-font-small);line-height:1.5;text-align:left}',
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-notice{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-noticeicon{flex:none;display:inline-flex;margin-top:1px;color:var(--dsw-alias-label-secondary)}',
  // Tone drives BOTH the colour and the icon, so a success cannot be painted
  // like a failure (the old span was unconditionally red).
  '.dshgit-notice[data-tone="success"] .dshgit-noticeicon{color:var(--dsw-alias-state-success-primary)}',
  '.dshgit-notice[data-tone="error"] .dshgit-noticeicon{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-noticebody{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
  '.dshgit-noticetext{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
  '.dshgit-noticehint{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
  // The raw git text, only shown on demand: monospace, scrollable, bounded.
  '.dshgit-noticedetail{margin:2px 0 0;padding:6px 8px;max-height:160px;overflow:auto;border-radius:6px;background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-meta);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
  // Buttons pin to the TOP of the banner, not its vertical centre: with the
  // raw text expanded the banner grows tall, and centred buttons would drift
  // down away from the summary they act on.
  '.dshgit-noticebtn{flex:none;align-self:flex-start;margin-top:1px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary, inherit);font:inherit;font-size:var(--dshgit-font-meta);cursor:pointer;white-space:nowrap}',
  '.dshgit-noticebtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
  '.dshgit-noticebtn:focus-visible,.dshgit-noticeclose:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.dshgit-noticebtn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
  '.dshgit-noticeclose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
  '.dshgit-noticeclose:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16));color:var(--dsw-alias-label-primary)}',
  // Remote action follows the branch's tracking state. The separate changes
  // and merge chips own their respective flows.
  '.dshgit-chipnext{font-weight:600}',
  '.dshgit-chipaction:disabled{cursor:default;opacity:.55}',
  '.dshgit-chipaction:focus-visible,.dshgit-pickrow:focus-visible,.dshgit-pickinline:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.dshgit-chipname{min-width:0}',
  // The counts are the amount, the label is the verb. Tinting them apart lets
  // one chip read as a sentence ("Pull ↓2") without a second control.
  '.dshgit-chipcounts{display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;opacity:.75;margin-left:1px}',
  '.dshgit-chipcluster>.dshgit-chip[data-chip]{box-sizing:border-box;flex:none}.dshgit-chip[data-chip="sync-menu"]{width:22px}.dshgit-chip[data-chip="changes"]>span{font-variant-numeric:tabular-nums}.dshgit-chip[data-chip="sync-menu"] .dshgit-spinner{width:12px;height:12px;box-sizing:border-box}',
  '.dshgit-next-ahead,.dshgit-next-behind{color:var(--dsw-alias-brand-primary)}',
  '.dshgit-next-ahead:hover:not(:disabled),.dshgit-next-behind:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)}',
  // A blocked state (conflicts, diverged) must not look like an ordinary
  // suggestion: it is the only thing standing between the user and a stuck
  // repository, so it is coloured as a warning.
  '.dshgit-next-warn{color:var(--dshgit-warning-text)}',
  '.dshgit-next-warn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-error-primary)) 14%, transparent)}',
  // In sync is a status. The adjacent chevron owns the alternate actions.
  '.dshgit-next-clean{color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-chipmore{padding:0 4px;min-width:20px;justify-content:center}',
  '@media(max-width:620px){.dshgit-chip[data-chip="branch"]{max-width:100px;min-width:0}.dshgit-chip[data-chip="merge"]{padding:0 4px}.dshgit-chipcluster{gap:2px}}',
  // The force-with-lease row is the one destructive entry in the sync menu;
  // it must not sit visually level with the safe ones.
  '.dshgit-pickdanger{color:var(--dsw-alias-state-error-primary)}',
  '.dshgit-pickdanger:hover{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}',
  '.dshgit-mergehead{font-size:var(--dshgit-font-body);font-weight:600;overflow-wrap:anywhere}',
  '.dshgit-merge-remote{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-merge-remote>.dshgit-muted{flex:1 1 200px;font-size:var(--dshgit-font-small);line-height:1.5}',
  '.dshgit-merge-remote>.dshgit-btn{flex:none;display:inline-flex;align-items:center;gap:6px;margin-left:auto}',
  '.dshgit-mergecolumns{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}',
  '.dshgit-mergecolumn{min-width:0;max-height:220px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}',
  '.dshgit-mergecolumn h3{margin:0 0 5px;font-size:var(--dshgit-font-small)}',
  '.dshgit-mergecommit{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-small);padding:2px 0}',
  '@media(max-width:620px){.dshgit-mergecolumns{grid-template-columns:1fr}}',

  // ---- in-progress operation panel ----
  // Bottom-left rather than centred: it must not cover the changes list the
  // user is working through, and it is not a question that blocks the app.
  '.dshgit-oppanel{position:fixed;left:16px;bottom:16px;z-index:1405;width:min(420px,92vw);display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-warn-primary, var(--dsw-alias-border-l1));background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-oppanel{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-ophead{display:flex;align-items:center;gap:8px}',
  '.dshgit-opbadge{flex:none;color:var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-error-primary));font-size:var(--dshgit-font-title)}',
  '.dshgit-optitle{flex:1;min-width:0;font-weight:600;font-size:var(--dshgit-font-body)}',
  '.dshgit-opactions{display:flex;gap:8px;justify-content:flex-end}',
  '.dshgit-progress{position:fixed;right:16px;bottom:16px;z-index:1405;box-sizing:border-box;width:min(320px,calc(100vw - 32px));display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:var(--dshgit-font-small);pointer-events:auto}',
  '.dshgit-workbench .dshgit-progress{position:absolute;bottom:auto;top:56px;right:12px;max-width:calc(100% - 24px)}',
  '.dshgit-progress-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dshgit-progress-spinner{flex:none;width:12px;height:12px;box-sizing:border-box;border:2px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dshgit-progress-spin .9s linear infinite}.dshgit-progress-cancel{flex:none;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.dshgit-progress-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dshgit-progress-cancel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}@keyframes dshgit-progress-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.dshgit-progress-spinner{animation:none}}',
  '.dshgit-progress,.dshgit-toast,.dshgit-notice{position:fixed;top:16px;right:16px;bottom:auto;left:auto;transform:none;box-sizing:border-box;max-width:calc(100vw - 32px);z-index:1405;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:0 4px 16px rgba(0,0,0,.12);backdrop-filter:none;-webkit-backdrop-filter:none}.dshgit-toast,.dshgit-notice{width:max-content;max-width:min(420px,calc(100vw - 32px));font-size:var(--dshgit-font-small)}.dshgit-toast{display:flex;align-items:center;gap:8px}.dshgit-toast>span{min-width:0;overflow-wrap:anywhere}.dshgit-workbench .dshgit-toast,.dshgit-workbench .dshgit-notice{position:absolute;top:56px;right:12px;left:auto;transform:none;max-width:min(420px,calc(100% - 24px))}',
  '.dshgit-notice{align-items:center;gap:8px;padding:8px 10px}.dshgit-noticeicon{display:flex;align-items:center;justify-content:center;width:18px;height:20px;margin:0}.dshgit-noticeicon svg{display:block}.dshgit-noticeclose{align-self:center;width:24px;height:24px;margin:0}.dshgit-noticebtn{align-self:center;margin:0}.dshgit-noticetext{line-height:20px}.dshgit-toast .dshgit-spinner{flex:none;align-self:center;margin:0}.dshgit-progress{line-height:20px}',

  // ---- choice dialog ----
  '.dshgit-choice{display:flex;flex-direction:column;gap:2px;width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dshgit-choice:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));border-color:var(--dsw-alias-brand-primary)}',
  '.dshgit-choicelabel{font-size:var(--dshgit-font-body);font-weight:600}',
  '.dshgit-choicehint{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary)}',

  // ---- popovers ----
  // A scrim rather than a document listener: a click anywhere outside closes
  // the panel without racing React's own event handling, and it gives the
  // popover a click target that is unambiguous.
  '.dshgit-scrim{position:fixed;inset:0;z-index:1400}',
  '.dshgit-fileviewer{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1500;display:flex;flex-direction:column;width:min(980px,92vw);height:min(680px,86vh);pointer-events:auto;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3));isolation:isolate;overflow:hidden}',
  '.dshgit-fileviewer{width:min(1180px,94vw);height:min(740px,86vh);max-width:calc(100vw - 24px);max-height:calc(100vh - 72px);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dshgit-font-body);line-height:1.5;backdrop-filter:none;-webkit-backdrop-filter:none}',
  '.dshgit-fileviewer[data-maximized="true"]{left:12px;right:12px;top:56px;bottom:12px;transform:none;width:auto;height:auto;max-width:none;max-height:none}',
  '.dshgit-fileviewerhead[data-draggable="true"]{cursor:grab;touch-action:none;user-select:none}',
  '.dshgit-fileviewerhead[data-draggable="true"]:active{cursor:grabbing}',
  '.dshgit-fileviewerlayout{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}',
  '.dshgit-fileviewernav{display:flex;flex-direction:column;flex:none;box-sizing:border-box;width:340px;min-width:0;padding:12px;border-right:1px solid var(--dsw-alias-border-l1);overflow:hidden}',
  '.dshgit-fileviewernav>.dshgit-commitpanel{flex:1;min-height:0;max-height:none;overflow:hidden}',
  '.dshgit-fileviewernav .dshgit-commit-composer{margin:0 0 12px}',
  '.dshgit-fileviewernav .dshgit-commitlists{scrollbar-gutter:stable}',
  '.dshgit-fileviewerbody{min-width:0}',
  '@media(max-width:640px){.dshgit-fileviewerlayout{flex-direction:column}.dshgit-fileviewernav{width:100%;height:48%;flex:none;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px}.dshgit-fileviewerhead{gap:4px;padding:6px}.dshgit-fileviewerhead>.dshgit-btn{font-size:var(--dshgit-font-small);padding:4px 6px}}',
  '.dshgit-fileviewer::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-fileviewer{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-fileviewerhead{display:flex;align-items:center;gap:8px;flex:none;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}',
  '.dshgit-fileviewerpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-body)}',
  '.dshgit-fileviewerbody{flex:1;min-height:0;overflow:auto}',
  '.dshgit-fileviewerfoot{flex:none;display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary)}',
  '.dshgit-viewerscrim{position:fixed;inset:0;z-index:1499;background:rgba(0,0,0,.28)}',
  '.dshgit-fileviewer .dshgit-diffrow{min-width:0}',
  '.dshgit-popover{position:fixed;z-index:1401;max-height:min(560px,80vh);display:flex;flex-direction:column;overflow:hidden;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
  '.dshgit-popover[data-popover="commit"]{overflow:hidden}',
  '.dshgit-popover[data-popover="branch"],.dshgit-popover[data-popover="merge"]{box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:8px}',
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-popover{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-confirmbar{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:1402;width:min(460px,92vw);padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.3))}',
  '.dshgit-confirmbar-centered{top:50%;transform:translate(-50%,-50%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box}',
  '.dshgit-confirm-scrim{background:rgba(0,0,0,.28);pointer-events:auto}',
  '.dshgit-confirmbar-centered .dshgit-hint{overflow-wrap:anywhere;white-space:pre-wrap;margin:10px 0 16px}',
  '.dshgit-confirmbar-centered .dshgit-headline{justify-content:flex-end}',

  // ---- branch picker ----
  '.dshgit-picker{display:flex;flex-direction:column;min-height:0}',
  '.dshgit-pickerinput{flex:none;margin:8px;padding:7px 9px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:var(--dshgit-font-body);font-family:inherit}',
  '.dshgit-pickerinput:focus{outline:none;border-color:var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))}',
  '.dshgit-pickactions{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-picklist{flex:1;min-height:0;overflow-y:auto;padding:2px 0 6px}',
  // Flat sibling group headings scroll with their rows. Pinning every heading
  // at top:0 stacks them on top of each other as the list scrolls.
  '.dshgit-pickgroup{position:static;padding:12px 10px 4px;font-size:var(--dshgit-font-meta);font-weight:500;line-height:1.5;color:var(--dsw-alias-label-tertiary);background:transparent;display:flex;align-items:center;gap:8px}',
  '.dshgit-pickgroup:first-child{padding-top:6px}',
  // Rows are separated by a hairline only — no band, no card. A full border on
  // all ~50 rows turned the list into a grid; a translucent hairline gives the
  // same "which lines belong together" cue at a fraction of the ink.
  '.dshgit-pickrow{display:flex;flex-direction:column;gap:2px;width:100%;padding:6px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
  '.dshgit-pickrow:last-child{border-bottom:0}',
  '.dshgit-popover[data-popover="branch"] .dshgit-pickrow,.dshgit-popover[data-popover="merge"] .dshgit-pickrow{border-bottom:0;padding:7px 10px}',
  '.dshgit-pickrow:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14))}',
  // The current branch is a state, not an ordinary row, but it is marked with
  // the accent bar plus a restrained tint rather than a filled band: at full
  // hover strength it competed with the rows the user is trying to pick.
  '.dshgit-pickrowcurrent{font-weight:600;background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary);cursor:default}',
  '.dshgit-picker .dshgit-branch-item{padding-right:8px}.dshgit-picker .dshgit-branch-item>.dshgit-pickrow{flex:1;min-width:0;width:auto}.dshgit-picker .dshgit-branch-item:hover .dshgit-pickdate,.dshgit-picker .dshgit-branch-item:focus-within .dshgit-pickdate{display:none}',
  '.dshgit-picker .dshgit-branch-item>.dshgit-pickrow{background:transparent}.dshgit-picker .dshgit-branch-item:hover,.dshgit-picker .dshgit-branch-item:focus-within,.dshgit-picker .dshgit-branch-item[data-current="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}.dshgit-picker .dshgit-branch-actions{background:transparent}.dshgit-picker .dshgit-branch-actions .dshgit-iconbtn:not([data-push-pending="true"]){color:var(--dsw-alias-label-secondary)}.dshgit-picker .dshgit-branch-actions .dshgit-iconbtn:hover:enabled{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}',
  '.dshgit-pickrowtop{display:flex;align-items:baseline;gap:0;min-width:0}',
  '.dshgit-pickname{font-size:var(--dshgit-font-body);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshgit-pickdate{margin-left:auto;flex:none;padding-left:8px;font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-tertiary)}',
  // The metadata line is deliberately lighter and indented to the same column
  // as the name, so it reads as subordinate detail rather than a second name.
  '.dshgit-pickmeta{font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  // A remote ref shows its remote as a muted prefix INSIDE the name line, so
  // `origin/feature/x` beside a local `feature/x` is distinguishable at a
  // glance. It is inline rather than a separate chip: as a chip it sat at its
  // own gap and read as two unrelated fields instead of one ref.
  '.dshgit-pickremote{flex:none;font-size:var(--dshgit-font-meta);color:var(--dsw-alias-label-tertiary);font-weight:400}',
  '.dshgit-pickinline{padding:1px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary, inherit);font-size:var(--dshgit-font-meta);font-family:inherit;cursor:pointer}',
  '.dshgit-pickinline:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));color:var(--dsw-alias-label-primary)}',
  '.dshgit-pickfoot{flex:none;display:flex;align-items:center;gap:6px;padding:5px 8px;border-top:1px solid var(--dsw-alias-border-l1)}',

  // ---- commit panel ----
  '.dshgit-commitpanel{display:flex;flex-direction:column;min-height:0}',
  '.dshgit-cl-commitpanel{max-height:min(560px,80vh);overflow:hidden}',
  '.dshgit-cl-commitpanel>.dshgit-card,.dshgit-cl-commitpanel>.dshgit-commitbox{flex:none;max-height:45vh;overflow:auto}',
  '.dshgit-cl-commitpanel>.dshgit-cl-search,.dshgit-cl-commitpanel>.dshgit-cl-error,.dshgit-cl-commitpanel>.dshgit-pickfoot{flex:none}',
  '.dshgit-cl-commitpanel>.dshgit-commitlists{overscroll-behavior:contain;scrollbar-gutter:stable}',
  '.dshgit-commitbox{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-commitlists{flex:1;min-height:0;overflow-y:auto;padding-bottom:4px}',
  '.dshgit-pickfile{min-height:26px;padding:2px 8px}',

  // ---- file viewer ----
  // A modal window, not a popover: it is for reading, so it needs the room
  // and it must survive the commit popover closing behind it. It is centred
  // and resizable like the workbench window, and it reuses that surface
  // material so the two dialogs read as the same family.
  // The scrim sits under the dialog and above everything else, so a click
  // outside closes the viewer without a document listener racing React.
  // Diff rows inside the viewer wrap their content, but the line-number
  // gutter must never wrap away from its line.

  // ---- floating window ----
  // Surface material copied from the shipped theme rather than invented:
  // DSH defines `--dsw-menu-surface-fill` (#f8f9fa94 light / #43454a73 dark)
  // and `--dsw-menu-backdrop-filter: blur(40px) saturate(150%)` for exactly
  // this kind of translucent panel. An opaque gray would ignore the theme
  // and sit wrong against every background, which is what a hand-rolled
  // surface always does.
  //
  // The overlay layer is click-through by design, so the window opts back
  // into pointer events. Nothing here covers the frame: a Git tool window
  // must not make the rest of the app unusable.
  '.dshgit-float{position:fixed;right:16px;bottom:16px;z-index:1150;display:flex;flex-direction:column;width:min(420px,94vw);max-height:min(640px,88vh);pointer-events:auto;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.16));isolation:isolate;overflow:hidden}',
  // The hairline stroke the shipped elevations use, drawn as an inset ring so
  // it survives the translucent fill.
  '.dshgit-float::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));z-index:1}',
  '.dshgit-floatfull{left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);width:min(1180px,94vw);height:min(780px,90vh);max-height:90vh}',
  // The resize grip. A native `resize:both` handle is a ~14px corner triangle
  // drawn by the browser *under* our own border-radius and stroke ring, so it
  // reads as a rendering artifact rather than a control. An explicit grip can
  // be themed, given a hit area bigger than its paint, and — the reason it
  // exists at all — routed through the same pointer-capture path as the drag,
  // so a resize keeps tracking when the pointer leaves the window.
  '.dshgit-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;z-index:3;cursor:nwse-resize;touch-action:none;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 3px 3px 0;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);opacity:.55}',
  '.dshgit-resize:hover,.dshgit-resize:focus-visible{opacity:1;color:var(--dsw-alias-label-primary)}',
  '.dshgit-floathead{display:flex;align-items:center;gap:8px;padding:7px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;user-select:none}',
  // The workspace name in the title bar: muted, one line, clipped with an
  // ellipsis because a deep path must not push the window controls out.
  '.dshgit-floatworkspace{min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))}',
  // `grabbing` during the gesture is the only feedback that the drag took.
  '.dshgit-floathead:active{cursor:grabbing}',
  '.dshgit-floatfull .dshgit-floathead{cursor:default}',
  '.dshgit-floatbody{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden}',
  // The window's own controls must sit above the stroke ring.
  '.dshgit-floathead>*{position:relative;z-index:2}',
  // If backdrop-filter is unavailable the translucent fill would let the
  // conversation show through the window, which reads as a rendering bug.
  // Fall back to the opaque raised-surface token instead.
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.dshgit-float{background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))}}',
  '.dshgit-headline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--dshgit-font-body)}',
  '.dshgit-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:var(--dshgit-icon-size);height:var(--dshgit-icon-size);padding:0;border:none;border-radius:5px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
  '.dshgit-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16));color:var(--dsw-alias-label-primary)}',
  '.dshgit-iconbtn:disabled{opacity:.4;cursor:default}',
  '.dshgit-hint{font-size:var(--dshgit-font-small);line-height:1.6;color:var(--dsw-alias-label-secondary)}',
  '.dshgit-pill{position:fixed;right:16px;bottom:16px;z-index:1150;pointer-events:auto;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #1e1e1e));box-shadow:var(--dsw-shadow-lv2, 0 6px 20px rgba(0,0,0,.3));font-size:var(--dshgit-font-body);color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.dshgit-pill:hover{border-color:var(--dsw-alias-label-secondary)}',
  // A tiny dot marking "the window is open", sized for an icon-only button.
  '.dshgit-dotbadge{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary);align-self:flex-start;margin-left:-10px;margin-top:1px}',
  // Toolbar cluster: sync buttons sit together and stay on one line.
  '.dshgit-tools{display:flex;align-items:center;gap:4px;flex:none}',
  '.dshgit-aheadbehind{font-size:var(--dshgit-font-small);color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
  // Output view rows.
  '.dshgit-logrow{border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 10px;display:flex;flex-direction:column;gap:3px}',
  '.dshgit-loghead{display:flex;gap:8px;align-items:center;font-size:var(--dshgit-font-body);flex-wrap:wrap}',
  '.dshgit-logcmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}',
  '.dshgit-logout{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dshgit-font-small);line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);margin:0;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l1)}',
  '.dshgit-logerr{color:var(--dsw-alias-state-error-primary)}',
  // A modal dialog for small forms (clone, new branch, new tag).
  '.dshgit-modal{position:fixed;inset:0;background:var(--dshgit-modal-mask,rgba(0,0,0,.28));z-index:1300;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
  '.dshgit-dialog{background:var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter, none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter, none);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-lg,16px);padding:16px;box-sizing:border-box;width:min(480px,100%);max-height:calc(100dvh - 48px);overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px;box-shadow:var(--dsw-elevation-prominent, 0 12px 48px rgba(0,0,0,.4))}',
  // Dialogs use the same opaque surface as the workbench, including over a scrim.
  '.dshgit-dialog,.dshgit-popover,.dshgit-confirmbar{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));backdrop-filter:none;-webkit-backdrop-filter:none}',
  '.dshgit-dialog.dshgit-dialog-compact{width:min(360px,calc(100vw - 32px));box-sizing:border-box}',
  '.dshgit-dialogtitle{font-weight:600;font-size:var(--dshgit-font-title)}',
  '.dshgit-workbench,.dshgit-popover,.dshgit-menu,.dshgit-contextmenu,.dshgit-combolist,.dshgit-confirmbar,.dshgit-toast{color:var(--dsw-alias-label-primary)}',
  '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.dshgit-menu,.dshgit-contextmenu,.dshgit-dialog,.dshgit-toast,.dshgit-confirmbar{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}}',
  '.dshgit-dialogactions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}',
  '.dshgit-bar+.dshgit-bar{border-top:none}',
  // Shared visual rhythm: host surfaces and accent, compact desktop controls.
  'body{--dshgit-modal-mask:rgba(0,0,0,.28)}body[data-ds-dark-theme]{--dshgit-modal-mask:rgba(0,0,0,.48)}',
  '.dshgit-workbench,.dshgit-dialog,.dshgit-popover,.dshgit-confirmbar{font-family:inherit;font-size:var(--dshgit-font-body);line-height:1.5}',
  '.dshgit-btn,.dshgit-iconbtn,.dshgit-winbtn,.dshgit-input,.dshgit-textarea,.dshgit-combooption{transition:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease}',
  '.dshgit-input:disabled,.dshgit-textarea:disabled{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);cursor:default}',
  '.dshgit-dialog{padding:20px;gap:16px}',
  '.dshgit-dialogtitle{line-height:1.5;margin:0 0 4px}',
  '.dshgit-workbench-field{margin:0;gap:8px}',
  '.dshgit-checkrow,.dshgit-check{gap:8px;line-height:1.5}',
  '.dshgit-dialog input[type=checkbox],.dshgit-settings-form input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);flex:none}',
  '.dshgit-sidebar-search,.dshgit-cl-search{padding:8px 12px}',
  '.dshgit-sidebar-body,.dshgit-editor-body,.dshgit-scroll{scrollbar-gutter:stable}',
  '.dshgit-card{gap:8px}',
  '.dshgit-row .dshgit-iconbtn,.dshgit-treerow .dshgit-iconbtn{width:24px;height:24px}',
  '.dshgit-settings-form{box-sizing:border-box;width:100%;max-width:800px;padding:16px 16px 32px}',
  '.dshgit-settings-form>.dshgit-card{margin:0 0 16px;padding:16px;gap:12px}',
  '.dshgit-settings-form .dshgit-field:last-child{margin-bottom:0}',
  '.dshgit-settings-form .dshgit-kv{overflow-wrap:anywhere}',
  '.dshgit-activity-item[aria-pressed="true"],.dshgit-history-viewmodes .dshgit-iconbtn[aria-pressed="true"],.dshgit-cl-layout>.dshgit-iconbtn[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);background:var(--dshgit-selected-bg)}',
  '.dshgit-row[data-selected="true"],.dshgit-treerow[data-selected="true"],.dshgit-branch-item[data-selected="true"],button.dshgit-commitrow[data-selected="true"],.dshgit-stash-row[data-selected="true"],.dshgit-graphrow[data-selected="true"],.dshgit-graph-record[data-selected="true"]{background:var(--dshgit-selected-bg)}',
  '.dshgit-btn[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dshgit-selected-bg)}',
  '.dshgit-titlebar .dshgit-winbtn,.dshgit-history-details .dshgit-iconbtn{width:28px;height:28px}',
  '.dshgit-combooption{min-height:32px;box-sizing:border-box;padding:6px 10px}',
  '.dshgit-combolist{padding:4px;border-radius:8px}',
  '.dshgit-combovalue{left:11px}',
  '.dshgit-menuitem,.dshgit-contextmenuitem{min-height:32px;box-sizing:border-box;line-height:1.5}',
  '.dshgit-contextmenu,.dshgit-menu,.dshgit-toast{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));backdrop-filter:none;-webkit-backdrop-filter:none}',
  '.dshgit-toast.dshgit-toast-message{padding:0;border:0;background:transparent;box-shadow:none;max-width:min(360px,calc(100% - 32px))}.dshgit-toast-message .dshgit-toast-content{display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:0 6px 20px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.08);font-size:var(--dshgit-font-body);line-height:1.4;animation:dshgit-message-in .16s ease-out both;transition:opacity .16s ease,transform .16s ease}.dshgit-toast-message .dshgit-toast-icon{flex:none;display:flex;color:var(--dsw-alias-state-success-primary)}.dshgit-toast-message[data-tone="error"] .dshgit-toast-icon{color:var(--dsw-alias-state-error-primary)}.dshgit-toast-message[data-tone="warning"] .dshgit-toast-icon{color:var(--dshgit-warning-text)}.dshgit-toast-message.dshgit-toast-leaving .dshgit-toast-content{animation:none;opacity:0;transform:translateY(-4px) scale(.98)}@keyframes dshgit-message-in{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.dshgit-toast-message .dshgit-toast-content{animation:none;transition:none}}',
  '.dshgit-history-details>.dshgit-card{gap:3px;padding:8px 12px}.dshgit-history-subject{font-size:var(--dshgit-font-body);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dshgit-history-heading{align-items:center;gap:8px}.dshgit-history-meta{line-height:1.4;gap:2px 12px}.dshgit-history-message{font-size:var(--dshgit-font-small);min-width:0}.dshgit-history-message[open]{flex-basis:100%}.dshgit-history-message summary{cursor:pointer}.dshgit-history-message-body{white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto;margin-top:4px;color:var(--dsw-alias-label-primary)}',
  '.dshgit-history-meta{gap:2px 12px}',
  '.dshgit-history-details[data-compact="true"]>.dshgit-card{padding:4px 10px;gap:0;overflow:visible;max-height:none}.dshgit-history-details[data-compact="true"] .dshgit-history-heading{flex-wrap:wrap;min-height:28px}.dshgit-history-details[data-compact="true"] .dshgit-history-subject{display:block;white-space:nowrap;text-overflow:ellipsis}.dshgit-history-details[data-compact="true"] .dshgit-history-message{flex:none}.dshgit-history-details[data-compact="true"] .dshgit-history-message[open]{flex-basis:100%;order:2}.dshgit-history-details[data-compact="true"] .dshgit-stash-preview{width:100%}',
  '.dshgit-history-heading>.dshgit-graph-detailtools{padding:0;border:0;margin-left:auto;flex:none}.dshgit-history-details[data-compact="true"][data-preview-open="false"] .dshgit-history-subject,.dshgit-history-details[data-compact="true"][data-preview-open="false"] .dshgit-history-heading>.dshgit-muted,.dshgit-history-details[data-compact="true"][data-preview-open="false"] .dshgit-history-message{display:none}.dshgit-history-details[data-compact="true"] .dshgit-stash-diff{padding:0}.dshgit-filediff[data-compact="true"]{margin:0;border:0;border-radius:0}.dshgit-filediff[data-compact="true"] .dshgit-filediff-head{padding:4px 10px;gap:6px;flex-wrap:nowrap}.dshgit-filediff[data-compact="true"] .dshgit-history-filetools{flex:none;padding:0;border:0;gap:6px;background:transparent}.dshgit-history-details[data-compact="true"] .dshgit-history-heading{gap:6px}.dshgit-history-details[data-compact="true"] .dshgit-history-heading>.dshgit-muted{flex:none}',
  '.dshgit-history-filesbar{display:flex;align-items:center;gap:6px;padding:4px 10px;flex:none;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshgit-history-filesbar>.dshgit-history-filetools{flex:none;padding:0;border:0;gap:6px;background:transparent}.dshgit-history-filepicker{position:relative;flex:1;min-width:0}.dshgit-history-filepicker>summary{display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;min-height:28px}.dshgit-history-filepicker>summary::-webkit-details-marker{display:none}.dshgit-history-filepicker>summary>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshgit-history-filepicker>summary>svg{flex:none}.dshgit-history-filepicker[open]>summary>svg{transform:rotate(90deg)}.dshgit-history-filemenu{position:absolute;left:0;top:calc(100% + 4px);z-index:20;width:min(560px,calc(100% + 112px));max-height:min(360px,45vh);display:flex;flex-direction:column;overflow:auto;padding:8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.2))}.dshgit-history-filesbar>.dshgit-muted{flex:none;font-size:var(--dshgit-font-small)}',
  '.dshgit-history-files-list{flex:1;min-height:0;overflow:auto;padding:8px 10px;box-sizing:border-box}.dshgit-history-files-list>.dshgit-sidebar-head{padding:0 0 8px}.dshgit-history-files-list>.dshgit-sidebar-head>[data-history-action="copy-paths"]{margin-left:auto}',
  '.dshgit-filediff-head{padding:8px 12px;min-height:40px;box-sizing:border-box}',
  '.dshgit-commit-composer{padding:12px;gap:8px}',
  '.dshgit-sidebar-composer{padding:12px}',
  '@media(max-width:900px){.dshgit-sidebar{width:240px}.dshgit-settings-form{padding:12px}}',
  '@media(max-width:640px){.dshgit-sidebar{width:200px;min-width:160px}.dshgit-titlebar{padding-left:12px;gap:4px}.dshgit-crumbs{display:none}.dshgit-modal{padding:16px}.dshgit-dialog{max-height:calc(100dvh - 32px);padding:16px}.dshgit-settings-form{padding:12px}}',
  '@media(max-width:480px){.dshgit-body{flex-direction:column}.dshgit-activitybar{flex-direction:row;width:auto;padding:4px 8px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshgit-activity-item{width:32px;height:32px}.dshgit-sidebar{width:100%;min-width:0;max-width:none;max-height:44%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dshgit-sidebar-composer{padding:8px}.dshgit-crumb-strong{max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshgit-title-tools{gap:0}.dshgit-window-controls{padding-left:4px}.dshgit-history-details>.dshgit-card{padding:8px 10px}.dshgit-history-files{min-height:0}}',
  '@media(prefers-reduced-motion:reduce){.dshgit-btn,.dshgit-iconbtn,.dshgit-winbtn,.dshgit-input,.dshgit-textarea,.dshgit-combooption,.dshgit-comboarrow svg{transition:none}}',
].join('\n')


var stylesInjected = false


/** Inject this plugin's stylesheet once. */
function installStyles() {
  if (stylesInjected) return function () {}
  stylesInjected = true
  var el = document.createElement('style')
  el.dataset.plugin = 'dsh-plugin-git'
  el.textContent = STYLES
  document.head.appendChild(el)
  return function () {
    el.remove()
    stylesInjected = false
  }
}

export { installStyles }
