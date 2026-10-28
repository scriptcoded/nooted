// One capture in the report window: thumbnail, what it shows, and an icon-only remove button.
// The row opens the large view by click, Enter or Space.
import type { Capture } from '@nooted/shared'
import type { ReplayApi } from '../../replay/types.ts'
import { useState } from 'preact/hooks'
import { CapturePreview } from './CapturePreview.tsx'
import { PlaceholderTile } from './icons.tsx'
import { captureDetail, captureLabel } from './capture-info.ts'

export interface CaptureRowProps {
  capture: Capture
  /** The replay player, or null when it isn't loaded (yet, or at all): the row then shows a placeholder tile. */
  api: ReplayApi | null
  disabled: boolean
  onOpen: () => void
  onRemove: () => void
  onStyleViolation: () => void
}

export function CaptureRow({ capture, api, disabled, onOpen, onRemove, onStyleViolation }: CaptureRowProps) {
  const [failed, setFailed] = useState(false)
  const label = captureLabel(capture)
  const detail = captureDetail(capture)
  return (
    <li class="row" data-nooted-card={capture.n}>
      <div
        class="row-main"
        role="button"
        tabIndex={0}
        aria-label={`Open capture ${capture.n}: ${label}${detail ? `, ${detail}` : ''}`}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
        }}
      >
        {api && !failed ? (
          <CapturePreview capture={capture} api={api} onStyleViolation={onStyleViolation} onFail={() => setFailed(true)} />
        ) : (
          <PlaceholderTile demo={capture.demo} />
        )}
        <div class="row-text">
          <div class="row-line1">
            <span class="row-n">[{capture.n}]</span>
            <span class="row-label">{label}</span>
          </div>
          <div class={capture.demo ? 'row-line2 muted' : 'row-line2'}>{detail}</div>
        </div>
      </div>
      <button type="button" class="row-remove" aria-label={`Remove capture ${capture.n}`} disabled={disabled} onClick={onRemove}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </li>
  )
}
