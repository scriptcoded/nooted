import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ReplayApi } from '../../replay/types.ts'
import { projectKey, startSignIn } from '../auth/sign-in.ts'
import type { SignInSession } from '../auth/sign-in.ts'
import { clearToken } from '../auth/token.ts'
import { getState, setState } from '../state.ts'
import { removeCapture, startPoint, startRecord } from '../capture/controller.ts'
import { MAX_CAPTURES } from '../capture/tokens.ts'
import { unknownTokens } from '@nooted/shared/note'
import { loadReplay } from '../preview/load-replay.ts'
import { close } from '../trigger.ts'
import { requestFabFocus } from './focus-return.ts'
import { sendReport } from '../upload/send.ts'
import { useAppState } from './state-hook.ts'
import { useDictation } from './dictation.ts'
import { CaptureRow } from './CaptureRow.tsx'
import { captureTitle, pointedNames } from './capture-info.ts'
import { BackIcon, PlaceholderTile } from './icons.tsx'
import { CapturePreview } from './CapturePreview.tsx'
import { MAX_NOTE } from './limits.ts'

export { MAX_NOTE }

type Phase = 'idle' | 'sending' | 'sent' | 'queued'

function signInErrorText(reason: string): string {
  if (reason === 'not_member') {
    return "You're not a member of this project, so you can't send reports for it. Ask a project admin to add you, then try again."
  }
  return `Sign-in failed (${reason}). Try again.`
}

export function ReportWindow() {
  const state = useAppState()
  const panel = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const signInButton = useRef<HTMLButtonElement>(null)
  const session = useRef<SignInSession | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('idle')
  const [signingIn, setSigningIn] = useState(false)
  // Message under the sign-in button (popup blocked, not a member, expired token).
  const [notice, setNotice] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  // The replay player, loaded on demand once a capture exists (null while loading and when it failed).
  const [replay, setReplay] = useState<ReplayApi | null>(null)
  const [styleNotice, setStyleNotice] = useState(false)
  // The capture shown in the larger view (replaces the form).
  const [viewing, setViewing] = useState<number | null>(null)
  const viewingRef = useRef<number | null>(null)
  viewingRef.current = viewing
  const hasCaptures = (state.draft?.captures.length ?? 0) > 0
  const signedIn = state.token !== null
  const dictation = useDictation(
    (text) => {
      const current = getState().note
      const joined = current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`
      setState({ note: joined.slice(0, MAX_NOTE) })
    },
    signedIn && phase === 'idle',
  )

  // Remember what had focus (the floating button, or a page element) and give it back on close.
  useLayoutEffect(() => {
    const root = panel.current?.getRootNode() as ShadowRoot | Document | undefined
    const previous = (root && 'activeElement' in root ? root.activeElement : null) ?? document.activeElement
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  // Focus the textarea when the form shows, the sign-in button otherwise.
  useLayoutEffect(() => {
    const target = signedIn ? textarea.current : signInButton.current
    ;(target ?? panel.current)?.focus()
  }, [signedIn, viewing])

  // Back from capture mode: put the caret where the token ended (Done) or where it was (Cancel).
  useLayoutEffect(() => {
    const at = state.editorCaret
    const field = textarea.current
    if (!at || !field) return
    field.focus()
    const end = Math.min(at.end, field.value.length)
    field.setSelectionRange(Math.min(at.start, end), end)
    setState({ editorCaret: undefined })
  }, [state.editorCaret, signedIn])

  // Load the player the first time a capture exists. loadReplay shares one request across calls.
  useEffect(() => {
    if (!hasCaptures || replay) return
    let live = true
    loadReplay().then(
      (api) => live && setReplay(api),
      () => {},
    )
    return () => {
      live = false
    }
  }, [hasCaptures, replay])

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // In the larger view, Escape goes back to the form.
      if (viewingRef.current !== null) return setViewing(null)
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      session.current?.stop()
      clearTimeout(closeTimer.current)
    }
  }, [])

  // The click handler must reach window.open without awaiting anything first.
  const onSignIn = () => {
    session.current?.stop()
    const started = startSignIn({
      onToken: (token) => {
        session.current = null
        setSigningIn(false)
        setNotice(null)
        setState({ token })
      },
      onError: (reason) => {
        session.current = null
        setSigningIn(false)
        setNotice(signInErrorText(reason))
      },
      onClosed: () => {
        session.current = null
        setSigningIn(false)
      },
    })
    session.current = started
    if (!started) {
      setSigningIn(false)
      setNotice('The sign-in window was blocked. Allow popups for this site, then try again.')
      return
    }
    setNotice(null)
    setSigningIn(true)
  }

  const note = state.note
  const captures = state.draft?.captures ?? []
  const atLimit = captures.length >= MAX_CAPTURES
  const viewed = viewing === null ? undefined : captures.find((c) => c.n === viewing)
  // The server rejects a report whose note mentions a capture it doesn't have, so don't send one.
  const unknown = unknownTokens(note, captures.map((c) => c.n))
  const canSend = phase === 'idle' && note.trim().length > 0 && unknown.length === 0

  const onSend = async () => {
    const { draft, token } = getState()
    if (!canSend || !draft || !token) return
    draft.note = note.trim()
    setPhase('sending')
    setSendError(null)
    let outcome: Awaited<ReturnType<typeof sendReport>>
    try {
      outcome = await sendReport({ draft, token: token.token })
    } catch {
      outcome = 'failed'
    }
    // Cancelled or closed while sending: nothing left to update.
    if (getState().draft !== draft) return
    if (outcome === 'delivered' || outcome === 'queued') {
      setPhase(outcome === 'delivered' ? 'sent' : 'queued')
      closeTimer.current = setTimeout(close, outcome === 'delivered' ? 1200 : 2200)
    } else if (outcome === 'unauthorized') {
      clearToken(projectKey())
      setPhase('idle')
      setNotice('Your sign-in expired. Sign in again to send this report. Your note is kept.')
      setState({ token: null })
    } else {
      setPhase('idle')
      setSendError("The report couldn't be sent. Try again later.")
    }
  }

  const caretNow = (): { start: number; end: number } | undefined => {
    const field = textarea.current
    return field ? { start: field.selectionStart, end: field.selectionEnd } : undefined
  }
  // Tapping the dimmed area minimizes the window. Only a press that starts and ends on the backdrop counts,
  // so a text selection that ends outside doesn't. Not while sending or showing the result.
  const pressedBackdrop = useRef(false)
  const minimize = () => {
    const field = textarea.current
    setState({ editorCaret: field ? { start: field.selectionStart, end: field.selectionEnd } : undefined })
    requestFabFocus() // the bubble takes focus when it appears
    setState({ minimized: true })
  }
  const stylesMessage = styleNotice ? "Previews may look unstyled because of this site's security policy." : null

  return (
    <div
      class="backdrop"
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        const pressed = pressedBackdrop.current
        pressedBackdrop.current = false
        if (pressed && event.target === event.currentTarget && phase === 'idle') minimize()
      }}
    >
      <div class={signedIn && viewed && phase === 'idle' ? 'panel wide' : 'panel'} role="dialog" aria-modal="true" aria-label="Request a change" tabIndex={-1} ref={panel}>
        <h2>Request a change</h2>
        {phase === 'sent' || phase === 'queued' ? (
          <p class="status" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8.5l3.2 3.2L13 4.5" />
            </svg>
            <span>{phase === 'sent' ? 'Sent' : 'Saved — it will be sent automatically'}</span>
          </p>
        ) : signedIn && viewed ? (
          <div class="large">
            <div class="large-head">
              <button type="button" class="btn back" onClick={() => setViewing(null)}>
                <BackIcon />
                Back
              </button>
              <div class="large-title">
                <span class="row-n">[{viewed.n}]</span>
                <span class="row-label" title={viewed.demo ? undefined : pointedNames(viewed)}>{captureTitle(viewed)}</span>
              </div>
            </div>
            {replay ? (
              <CapturePreview capture={viewed} api={replay} large onStyleViolation={() => setStyleNotice(true)} />
            ) : (
              <>
                <PlaceholderTile demo={viewed.demo} large />
                <p class="msg" role="status">Preview unavailable</p>
              </>
            )}
            {stylesMessage && <p class="msg" role="status">{stylesMessage}</p>}
          </div>
        ) : signedIn ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void onSend()
            }}
          >
            <label class="label" for="nooted-note">What should change?</label>
            <textarea
              id="nooted-note"
              class="note"
              ref={textarea}
              rows={5}
              maxLength={MAX_NOTE}
              required
              value={note}
              disabled={phase === 'sending'}
              placeholder="Describe the change. Take screenshots or record a demo to show what you mean."
              onInput={(event) => setState({ note: (event.currentTarget as HTMLTextAreaElement).value })}
            />
            <div class="toolbar">
              <button
                type="button"
                class="btn tool"
                aria-label="Take a screenshot"
                disabled={atLimit || phase === 'sending'}
                onClick={() => startPoint(caretNow())}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" class="stroke">
                  <circle cx="8" cy="8" r="4.5" />
                  <path d="M8 1v4M8 11v4M1 8h4M11 8h4" />
                </svg>
                Screenshot
              </button>
              <button
                type="button"
                class="btn tool"
                aria-label="Record a demo"
                disabled={atLimit || phase === 'sending'}
                onClick={() => startRecord(caretNow())}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" class="rec">
                  <circle cx="8" cy="8" r="5.5" />
                </svg>
                Record
              </button>
              {dictation.supported && (
                <button
                  type="button"
                  class={dictation.listening ? 'btn tool icon mic on' : 'btn tool icon mic'}
                  aria-label={dictation.listening ? 'Stop voice input' : 'Start voice input'}
                  aria-pressed={dictation.listening}
                  onClick={dictation.toggle}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="stroke">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              )}
            </div>
            {atLimit ? (
              <p class="hint">Up to {MAX_CAPTURES} captures per report</p>
            ) : (
              captures.length === 0 && <p class="hint">Screenshot: tap the parts of the page you mean. Record: show it in action. Tap outside this window to go to another page.</p>
            )}
            {captures.length > 0 && (
              <ul class="cards">
                {captures.map((capture) => (
                  <CaptureRow
                    key={capture.n}
                    capture={capture}
                    api={replay}
                    disabled={phase === 'sending'}
                    onOpen={() => setViewing(capture.n)}
                    onRemove={() => removeCapture(capture.n)}
                    onStyleViolation={() => setStyleNotice(true)}
                  />
                ))}
              </ul>
            )}
            {(sendError || unknown.length > 0 || state.captureNotice || stylesMessage || dictation.message) && (
              <div class="messages">
                {sendError && <p class="msg error" role="alert">{sendError}</p>}
                {unknown.length > 0 && (
                  <p class="msg error" role="alert">
                    The note mentions {unknown.map((n) => `[${n}]`).join(', ')}, but there's no capture with that number. Remove
                    it from the note or add a capture.
                  </p>
                )}
                {state.captureNotice && <p class="msg" role="status">{state.captureNotice}</p>}
                {stylesMessage && <p class="msg" role="status">{stylesMessage}</p>}
                {dictation.message && <p class="msg" role="status">{dictation.message}</p>}
              </div>
            )}
            <div class="actions">
              <button type="button" class="btn" onClick={close}>Cancel</button>
              <button type="submit" class="btn primary" disabled={!canSend}>
                {phase === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p class="intro">Sign in with your Nooted account to send this request.</p>
            <button type="button" class="btn primary block" ref={signInButton} onClick={onSignIn}>Sign in to Nooted</button>
            {(signingIn || notice) && (
              <div class="messages">
                {signingIn && <p class="msg" role="status">Waiting for the sign-in window…</p>}
                {notice && <p class="msg error" role="alert">{notice}</p>}
              </div>
            )}
            <div class="actions">
              <button type="button" class="btn" onClick={close}>Cancel</button>
            </div>
          </div>
        )}
        {signedIn && (
          <div class="footer">
            <span class="who">Signed in as {state.token?.user.email}</span>
          </div>
        )}
      </div>
    </div>
  )
}
