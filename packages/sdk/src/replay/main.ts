import { Replayer } from '@rrweb/replay'
import replayCss from '@rrweb/replay/dist/style.css?inline'
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
  return {
    play: (t) => replayer.play(t),
    pause: (t) => replayer.pause(t),
    getCurrentTime: () => replayer.getCurrentTime(),
    duration: replayer.getMetaData().totalTime,
    iframe: replayer.iframe,
    wrapper: replayer.wrapper,
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
