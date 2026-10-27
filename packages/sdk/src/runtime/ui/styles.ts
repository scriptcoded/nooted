// Styles for the shadow root. Every control is styled explicitly: nothing is inherited from the page
// (the host sets `all: initial`, and the page's own CSS cannot reach into the shadow tree).
export const css = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
button { all: unset; box-sizing: border-box; cursor: pointer; font: 600 14px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.fab { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: #1f2937; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,.35); touch-action: none; user-select: none; -webkit-user-select: none; pointer-events: auto; }
.fab.dragging { cursor: grabbing; opacity: .85; }
.fab svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #dc2626; color: #fff; font: 700 12px/20px system-ui, sans-serif; text-align: center; pointer-events: none; }
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; pointer-events: auto; }
.panel { width: min(420px, 100%); max-height: 100%; overflow: auto; background: #fff; color: #111827; border-radius: 12px; padding: 20px; box-shadow: 0 10px 40px rgba(0,0,0,.4); font: 400 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.panel:focus { outline: none; }
.panel h2 { all: unset; display: block; font: 700 18px/1.3 system-ui, sans-serif; margin-bottom: 12px; }
.panel { min-width: 0; }
.panel p { all: unset; display: block; margin: 0 0 10px; overflow-wrap: anywhere; }
.panel form { display: block; margin: 0; }
.label { display: block; font-weight: 600; margin-bottom: 6px; }
.note { all: unset; box-sizing: border-box; display: block; width: 100%; min-height: 110px; max-height: 40vh; padding: 8px 10px; border: 1px solid #9ca3af; border-radius: 8px; background: #fff; color: #111827; font: 400 16px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; resize: vertical; cursor: text; }
.note:focus { border-color: #2563eb; outline: 2px solid #93c5fd; }
.note:disabled { opacity: .6; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; min-width: 0; }
.hint { color: #6b7280; font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.msg { color: #374151; font-size: 13px; }
.msg.error { color: #b91c1c; }
.status { font-weight: 600; padding: 16px 0; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 14px; min-height: 40px; border-radius: 8px; background: #e5e7eb; color: #111827; text-align: center; }
.btn.primary { background: #1d4ed8; color: #fff; }
.btn.block { display: flex; width: 100%; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn.mic { padding: 0; width: 40px; flex: none; }
.btn.mic.on { background: #dc2626; color: #fff; }
.btn.mic svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.review-entry { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; }
.review-summary { color: #374151; font-size: 13px; }
.panel h2:focus { outline: none; }
.preview-slot { margin: 0 0 12px; min-width: 0; }
.preview-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.preview-player { position: relative; overflow: hidden; margin-top: 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #f3f4f6; min-width: 0; max-width: 100%; }
.preview-player .replayer-wrapper { transform-origin: 0 0; }
.timeline { margin: 0 12px 12px; min-width: 0; }
.tl-track { position: relative; height: 36px; touch-action: none; user-select: none; -webkit-user-select: none; }
.tl-rail { position: absolute; left: 0; right: 0; top: 16px; height: 4px; border-radius: 2px; background: #d1d5db; }
.tl-band { position: absolute; top: 14px; height: 8px; border-radius: 3px; background: #93c5fd; }
.tl-marker { position: absolute; top: 6px; width: 3px; height: 24px; margin-left: -1px; border-radius: 2px; background: #dc2626; pointer-events: none; }
.tl-handle { position: absolute; top: 6px; width: 24px; height: 24px; margin-left: -12px; border-radius: 50%; background: #1d4ed8; border: 3px solid #fff; box-shadow: 0 0 0 1px #1d4ed8, 0 1px 4px rgba(0,0,0,.4); cursor: grab; touch-action: none; }
.tl-handle.end { background: #1e3a8a; }
.tl-handle:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.tl-times { display: flex; justify-content: space-between; color: #6b7280; font-size: 12px; margin: 0 -12px; }
.switch { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 12px; cursor: pointer; min-width: 0; }
.switch input { appearance: none; -webkit-appearance: none; flex: none; position: relative; width: 40px; height: 24px; margin: 0; border-radius: 12px; background: #9ca3af; cursor: pointer; }
.switch input::before { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .12s; }
.switch input:checked { background: #1d4ed8; }
.switch input:checked::before { left: 19px; }
.switch input:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.switch-text { display: block; min-width: 0; }
.switch-label { display: block; font-weight: 600; }
.switch-hint { display: block; color: #6b7280; font-size: 12px; overflow-wrap: anywhere; }
.preview-status { color: #374151; font-size: 13px; }
.footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
.link { display: inline; color: #4b5563; font: 400 12px/1.4 system-ui, sans-serif; text-decoration: underline; }
.intro { color: #374151; }
`
