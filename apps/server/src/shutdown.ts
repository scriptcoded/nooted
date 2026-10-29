export type ShutdownServer = {
  close(callback?: (error?: Error) => void): unknown
  closeIdleConnections(): void
  closeAllConnections(): void
}

export type ShutdownOptions = {
  server: ShutdownServer
  /** Run in order once the server has stopped; a failing closer doesn't skip the rest. */
  closers: Array<() => Promise<void>>
  /** How long in-flight requests get before they are cut off. Default 10 seconds. */
  deadlineMs?: number
  exit: (code: number) => void
  log: (line: string) => void
}

/** Returns the SIGTERM/SIGINT handler: drain, close the closers, exit 0; exit 1 on the deadline or a second signal. */
export function createShutdown(options: ShutdownOptions): (signal: string) => void {
  const { server, closers, exit, log } = options
  const deadlineMs = options.deadlineMs ?? 10_000
  let started = false
  let timedOut = false

  return (signal) => {
    if (started) {
      log(`Received ${signal} again, exiting immediately`)
      exit(1)
      return
    }
    started = true
    log(`Received ${signal}, shutting down (waiting up to ${deadlineMs / 1000}s for open requests)`)

    const deadline = setTimeout(() => {
      timedOut = true
      log('Open requests did not finish in time, closing them')
      server.closeAllConnections()
      exit(1)
    }, deadlineMs)
    deadline.unref()

    // A keep-alive socket turns idle once its request finishes, after the close began, so sweep until closed.
    const sweep = setInterval(() => server.closeIdleConnections(), 100)
    sweep.unref()

    server.close(async () => {
      clearInterval(sweep)
      if (timedOut) return
      clearTimeout(deadline)
      let failed = false
      for (const close of closers) {
        try {
          await close()
        } catch (error) {
          failed = true
          log(`Shutdown step failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      log(failed ? 'Shutdown finished with errors' : 'Shutdown complete')
      exit(failed ? 1 : 0)
    })
    server.closeIdleConnections()
  }
}
