import { Replayer } from '@rrweb/replay'
import replayCss from '@rrweb/replay/dist/style.css?inline'
import { checkpointTimes, seekSteps } from '@nooted/shared/seek'
import type { ReplayApi, ReplayHandle, ReplayOptions } from './types.ts'

// Loaded on demand by the runtime. Registers the replay API on window.nooted.p.
// Never throws into the page.
function createReplayer(root: HTMLElement, events: unknown[], options: ReplayOptions = {}): ReplayHandle {
  const replayer = new Replayer(events as ConstructorParameters<typeof Replayer>[0], {
    root,
    mouseTail: false,
    UNSAFE_replayCanvas: false,
    triggerFocus: false,
    speed: options.speed ?? 1,
  })
  const duration = replayer.getMetaData().totalTime
  const checkpoints = checkpointTimes(events)
  return {
    play: (t) => replayer.play(t),
    pause: (t) => replayer.pause(t),
    seek: (t) => {
      for (const step of seekSteps(checkpoints, t, duration)) replayer.pause(step)
    },
    getCurrentTime: () => replayer.getCurrentTime(),
    duration,
    iframe: replayer.iframe,
    wrapper: replayer.wrapper,
    nodeRect: (id) => {
      try {
        const node = replayer.getMirror().getNode(id)
        if (!node || node.nodeType !== 1) return null
        const r = (node as Element).getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      } catch {
        return null
      }
    },
    destroy: () => replayer.destroy(),
  }
}

try {
  const stub = window.nooted
  if (stub) {
    const api: ReplayApi = { css: replayCss, createReplayer }
    stub.p = api
  }
} catch {
  // Nothing to do; the page must not see our failures.
}
