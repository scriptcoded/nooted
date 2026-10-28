// The replay player is heavy, so it is only imported the first time a capture needs it.
// This is the only module that imports `@rrweb/replay`, and only through dynamic imports.
export type ReplayerCtor = typeof import('@rrweb/replay').Replayer

let loading: Promise<ReplayerCtor> | undefined

export function loadReplayer(): Promise<ReplayerCtor> {
  loading ??= (async () => {
    const [mod] = await Promise.all([import('@rrweb/replay'), import('@rrweb/replay/dist/style.css')])
    return mod.Replayer
  })().catch((error: unknown) => {
    loading = undefined
    throw error
  })
  return loading
}
