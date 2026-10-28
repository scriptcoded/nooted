// Small inline icons for the rows and the large view (currentColor, aria-hidden).
export const CrosshairIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" class="icon stroke">
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1v4M8 11v4M1 8h4M11 8h4" />
  </svg>
)

export const RecordDotIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" class="icon rec">
    <circle cx="8" cy="8" r="5.5" />
  </svg>
)

export const BackIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" class="icon stroke">
    <path d="M13 8H3M7 3.5L2.5 8 7 12.5" />
  </svg>
)

export const PlayIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" class="icon fill">
    <path d="M4.5 2.5v11l9-5.5z" />
  </svg>
)

export const PauseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" class="icon fill">
    <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
  </svg>
)

/** The neutral tile shown in place of a thumbnail when the player isn't available. */
export function PlaceholderTile({ demo, large }: { demo: boolean; large?: boolean }) {
  return (
    <div class={large ? 'frame placeholder tall' : 'frame thumb placeholder'} aria-hidden="true">
      {demo ? <RecordDotIcon /> : <CrosshairIcon />}
    </div>
  )
}
