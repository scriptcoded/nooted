// Shared between the replay bundle (dist/replay.js) and the runtime. Type-only.

export interface ReplayOptions {
  /** Replay speed multiplier. Defaults to 1. */
  speed?: number
}

export interface ReplayHandle {
  /** Starts playing from `timeOffsetMs` (relative to the first event), or resumes. */
  play(timeOffsetMs?: number): void
  /** Pauses, optionally seeking to `timeOffsetMs` first. */
  pause(timeOffsetMs?: number): void
  /** Current position in ms from the first event. */
  getCurrentTime(): number
  /** Total span of the events in ms. */
  duration: number
  /** rrweb's sandboxed iframe (allow-same-origin only, no scripts). */
  iframe: HTMLIFrameElement
  /** rrweb's `.replayer-wrapper` element, a child of the root passed to createReplayer. */
  wrapper: HTMLElement
  destroy(): void
}

export interface ReplayApi {
  /** rrweb's replay stylesheet as a string, for adopting into a shadow root. */
  css: string
  createReplayer(root: HTMLElement, events: unknown[], options?: ReplayOptions): ReplayHandle
}
