// Per-page upload settings that main.ts can override.
let release: string | undefined

export function setRelease(value: string | undefined): void {
  release = value
}

/** `init({ release })` wins over the release in the loader snippet. */
export function getRelease(): string | undefined {
  return release || window.nooted?.r || undefined
}
