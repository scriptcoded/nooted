// Styles for the shadow root. Every control is styled explicitly: nothing is inherited from the page
// (the host sets `all: initial`, and the page's own CSS cannot reach into the shadow tree).
export const css = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
button { all: unset; box-sizing: border-box; cursor: pointer; font: 600 14px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.fab { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: #1f2937; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,.35); touch-action: none; user-select: none; -webkit-user-select: none; pointer-events: auto; }
.fab.dragging { cursor: grabbing; opacity: .85; }
.fab svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #dc2626; color: #fff; font: 700 12px/20px system-ui, sans-serif; text-align: center; pointer-events: none; }
.backdrop { position: fixed; inset: 0; background: rgba(17,24,39,.45); display: flex; align-items: center; justify-content: center; padding: 16px; pointer-events: auto; }
.panel { width: min(440px, 100%); max-height: 100%; overflow-x: hidden; overflow-y: auto; min-width: 0; background: #fff; color: #111827; border-radius: 8px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,.35); font: 400 14px/20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: left; letter-spacing: normal; text-transform: none; }
.panel.wide { width: min(960px, 100%); }
.panel:focus { outline: none; }
:where(.panel) h2 { all: unset; display: block; font: 600 18px/24px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; margin: 0 0 16px; }
:where(.panel) h2:focus { outline: none; }
:where(.panel) p { all: unset; display: block; margin: 0; overflow-wrap: anywhere; font: inherit; }
.panel form { display: block; margin: 0; }
.label { display: block; font: 600 14px/20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; margin: 0 0 8px; }
.note { all: unset; box-sizing: border-box; display: block; width: 100%; min-height: 112px; max-height: 40vh; padding: 8px 12px; border: 1px solid #9ca3af; border-radius: 8px; background: #fff; color: #111827; font: 400 16px/24px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; resize: vertical; cursor: text; }
.note::placeholder { color: #6b7280; opacity: 1; }
.note:focus { border-color: #2563eb; outline: 2px solid #bfdbfe; }
.note:disabled { opacity: .6; }
.toolbar { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; min-width: 0; }
.toolbar .mic { margin-left: auto; }
.hint { display: block; margin: 8px 0 0; color: #6b7280; font-size: 13px; line-height: 18px; }
.messages { display: flex; flex-direction: column; gap: 4px; margin: 12px 0 0; }
.msg { color: #374151; font-size: 13px; line-height: 18px; }
.msg.error { color: #b91c1c; }
.status { display: flex; align-items: center; gap: 8px; font-weight: 600; padding: 16px 0; }
.status svg { width: 20px; height: 20px; flex: none; fill: none; stroke: #15803d; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.intro { color: #374151; margin: 0 0 16px; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; min-height: 40px; border-radius: 8px; background: #e5e7eb; color: #111827; text-align: center; transition: background-color .12s; }
.btn:hover:not([disabled]) { background: #d1d5db; }
.btn.primary { background: #1d4ed8; color: #fff; }
.btn.primary:hover:not([disabled]) { background: #1e40af; }
.btn.block { display: flex; width: 100%; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn.tool { min-height: 36px; padding: 0 12px; background: #fff; border: 1px solid #d1d5db; gap: 6px; }
.btn.tool:hover:not([disabled]) { background: #f3f4f6; border-color: #9ca3af; }
.btn.tool.icon { width: 36px; padding: 0; flex: none; }
.btn.tool.mic.on { background: #dc2626; border-color: #dc2626; color: #fff; }
.btn svg { width: 16px; height: 16px; flex: none; }
.btn svg.stroke { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.btn.mic svg { width: 18px; height: 18px; stroke-width: 2; }
.btn svg.rec { fill: #dc2626; }
.footer { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; line-height: 16px; }
.who { min-width: 0; overflow-wrap: anywhere; }
.cards { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.row { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 8px 8px 8px 8px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; transition: background-color .12s, border-color .12s; }
.row:hover { background: #f9fafb; border-color: #d1d5db; }
.row-main { display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; border-radius: 6px; cursor: pointer; }
.row-main:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.row-text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.row-line1 { display: flex; flex-wrap: nowrap; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; }
.row-n { flex: none; font: 700 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #111827; }
.row-label { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; line-height: 20px; color: #6b7280; }
.row-line2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 500; color: #111827; }
.row-line2.muted { font-weight: 400; color: #6b7280; }
.row-remove { display: flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border-radius: 6px; color: #6b7280; }
.row-remove:hover:not([disabled]) { background: #e5e7eb; color: #111827; }
.row-remove[disabled] { opacity: .45; cursor: not-allowed; }
.row-remove svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; }
.icon { width: 20px; height: 20px; flex: none; }
.icon.stroke { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.icon.fill { fill: currentColor; }
.icon.rec { fill: #dc2626; }
.cp { min-width: 0; flex: none; }
.cp.large-view { flex: 1 1 auto; }
.frame { position: relative; overflow: hidden; min-width: 0; background: #f3f4f6; border-radius: 8px; isolation: isolate; }
.frame::after { content: ''; position: absolute; inset: 0; border-radius: 8px; box-shadow: inset 0 0 0 1px rgba(17,24,39,.14); pointer-events: none; }
.frame.thumb { width: 96px; height: 64px; flex: none; }
.frame.placeholder { display: flex; align-items: center; justify-content: center; color: #6b7280; }
.cp-player { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.cp-player .replayer-wrapper { transform-origin: 0 0; }
.frame.thumb .replayer-mouse, .frame.thumb .replayer-mouse-tail, .cp:not(.playing) .replayer-mouse { display: none; }
.cp-marks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cp-mark { position: absolute; border: 2px solid #2563eb; background: rgba(37,99,235,.12); border-radius: 3px; box-sizing: border-box; }
.cp-badge { position: absolute; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
.cp-badge svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.tile-play { position: absolute; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%; background: rgba(17,24,39,.62); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.tile-play svg { width: 16px; height: 16px; fill: #fff; }
.tile-dur { position: absolute; right: 4px; bottom: 4px; padding: 0 4px; border-radius: 4px; background: rgba(17,24,39,.78); color: #fff; font: 600 11px/16px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-variant-numeric: tabular-nums; pointer-events: none; }
.large { min-width: 0; }
.large-head { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 0 12px; }
.large-title { display: flex; flex: 1 1 auto; align-items: baseline; gap: 6px; min-width: 0; font-size: 14px; line-height: 20px; }
.large-title .row-n { font-size: 14px; }
.large-title .row-label { font-size: 14px; color: #374151; }
.large .frame { width: 100%; }
.frame.placeholder.tall { height: 160px; }
.large-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; min-width: 0; }
.large-foot .btn.play { min-height: 36px; }
.foot-note { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 18px; color: #6b7280; }
.btn.back { min-height: 36px; padding: 0 12px 0 8px; gap: 4px; background: transparent; margin-left: -8px; }
.btn.back:hover:not([disabled]) { background: #f3f4f6; }
.hl-layer { position: fixed; inset: 0; pointer-events: none; }
.hl { position: fixed; pointer-events: none; border-radius: 3px; box-sizing: border-box; }
.hl.marked { background: rgba(37,99,235,.12); border: 2px solid #2563eb; }
.hl.hover { border: 2px dashed #2563eb; }
.hl-badge { position: absolute; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
.hl-badge svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.cbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); background: #111827; color: #fff; font: 400 14px/20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 -2px 12px rgba(0,0,0,.3); pointer-events: auto; }
.cbar-text { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.cbar-title { font-weight: 600; font-size: 14px; line-height: 20px; }
.cbar-sub { color: #9ca3af; font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clock { font-variant-numeric: tabular-nums; }
.timer { white-space: nowrap; }
.timer.ending { color: #fbbf24; }
.rec-dot { flex: none; width: 10px; height: 10px; margin-right: 4px; border-radius: 50%; background: #ef4444; animation: nooted-pulse 1.2s ease-in-out infinite; }
@keyframes nooted-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .rec-dot { animation: none; } }
.cbtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; min-height: 40px; flex: none; border-radius: 8px; background: #374151; color: #fff; text-align: center; }
.cbtn svg { width: 14px; height: 14px; fill: currentColor; flex: none; }
.cbtn.ghost { background: transparent; color: #e5e7eb; padding: 0 12px; }
.cbtn.ghost:hover { background: rgba(255,255,255,.12); }
.cbtn.primary { background: #2563eb; }
.cbtn.primary:hover { background: #1d4ed8; }
.cbtn.stop { background: #dc2626; }
.cbtn.stop:hover { background: #b91c1c; }
.cbtn:focus-visible { outline-color: #bfdbfe; }
@media (max-width: 360px) { .cbar { padding-left: 12px; padding-right: 12px; gap: 4px; } .cbtn { padding: 0 12px; } .cbtn.ghost { padding: 0 8px; } .rec-dot { margin-right: 0; } }
@media (max-width: 360px) { .panel { padding: 16px; } .row { padding: 6px 4px 6px 6px; } .row-main { gap: 8px; } .row-line1, .row-line2 { line-height: 18px; } .row-label { font-size: 12px; } }
`
