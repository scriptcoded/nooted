import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { projectKey, startSignIn } from '../auth/sign-in.ts'
import type { SignInSession } from '../auth/sign-in.ts'
import { clearToken } from '../auth/token.ts'
import { getState, setState } from '../state.ts'
import { close } from '../trigger.ts'
import { sendReport } from '../upload/send.ts'
import { Preview } from './Preview.tsx'
import { Timeline } from './Timeline.tsx'
import { formatClock, timelineSpan } from './timeline.ts'
import { turnOffNooted } from './turn-off.ts'
import { useAppState } from './state-hook.ts'
import { useDictation } from './dictation.ts'

export const MAX_NOTE = 10_000

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
  const [view, setView] = useState<'form' | 'review'>('form')
  const [resetKey, setResetKey] = useState(0)
  const viewRef = useRef(view)
  viewRef.current = view
  const reviewButton = useRef<HTMLButtonElement>(null)
  const reviewTitle = useRef<HTMLHeadingElement>(null)
  const seekRef = useRef<((t: number) => void) | undefined>(undefined)
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
  }, [signedIn])

  // Moving between views: the review title takes focus, the "Review recording" button gets it back.
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    ;(view === 'review' ? reviewTitle.current : reviewButton.current)?.focus()
  }, [view])

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (viewRef.current === 'review') {
        event.stopPropagation()
        setView('form')
      } else {
        close()
      }
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
  const canSend = phase === 'idle' && note.trim().length > 0

  const onSend = async () => {
    const { frozen, token, focus, includeRecording } = getState()
    if (!canSend || !frozen || !token) return
    setPhase('sending')
    setSendError(null)
    let outcome: Awaited<ReturnType<typeof sendReport>>
    try {
      outcome = await sendReport({ note: note.trim(), frozen, token: token.token, focus, includeRecording })
    } catch {
      outcome = 'failed'
    }
    // Cancelled or closed while sending: nothing left to update.
    if (getState().frozen !== frozen) return
    if (outcome === 'delivered' || outcome === 'queued') {
      setPhase(outcome === 'delivered' ? 'sent' : 'queued')
      closeTimer.current = setTimeout(close, outcome === 'delivered' ? 1200 : 2200)
    } else if (outcome === 'unauthorized') {
      clearToken(projectKey())
      setPhase('idle')
      setView('form')
      setNotice('Your sign-in expired. Sign in again to send this report. Your note is kept.')
      setState({ token: null })
    } else {
      setPhase('idle')
      setSendError("The report couldn't be sent. Try again later.")
    }
  }

  return (
    <div class="backdrop">
      <div class="panel" role="dialog" aria-modal="true" aria-label="Report a problem" tabIndex={-1} ref={panel}>
        <h2 tabIndex={view === 'review' ? -1 : undefined} ref={reviewTitle}>
          {view === 'review' && signedIn && state.frozen ? 'Highlight what matters' : 'Report a problem'}
        </h2>
        {phase === 'sent' || phase === 'queued' ? (
          <p class="status" role="status">
            {phase === 'sent' ? 'Sent' : 'Saved — it will be sent automatically'}
          </p>
        ) : signedIn && view === 'review' && state.frozen ? (
          <div class="review">
            <p class="hint">The whole recording is sent. The highlight marks the part that matters.</p>
            <Preview frozen={state.frozen} focus={state.focus} seekRef={seekRef} />
            <Timeline key={resetKey} frozen={state.frozen} focus={state.focus} onSeek={(t) => seekRef.current?.(t)} />
            <div class="actions">
              <button
                type="button"
                class="btn"
                onClick={() => {
                  setState({ focus: undefined })
                  setResetKey((k) => k + 1)
                  seekRef.current?.(Number.MAX_SAFE_INTEGER)
                }}
              >
                Reset
              </button>
              <button type="button" class="btn primary" onClick={() => setView('form')}>Done</button>
            </div>
          </div>
        ) : signedIn ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void onSend()
            }}
          >
            {state.includeRecording && state.frozen && (
              <div class="review-entry">
                <button type="button" class="btn" ref={reviewButton} onClick={() => setView('review')}>Review recording</button>
                <span class="review-summary">
                  {state.focus
                    ? `Highlighted ${formatClock(timelineSpan(state.frozen), state.focus.start)}–${formatClock(timelineSpan(state.frozen), state.focus.end)}`
                    : 'Whole recording'}
                </span>
              </div>
            )}
            <label class="switch">
              <input
                type="checkbox"
                role="switch"
                checked={state.includeRecording}
                disabled={phase === 'sending'}
                onChange={(event) => setState({ includeRecording: (event.currentTarget as HTMLInputElement).checked })}
              />
              <span class="switch-text">
                <span class="switch-label">Include recording</span>
                <span class="switch-hint">Errors and the page address are still sent</span>
              </span>
            </label>
            <label class="label" for="nooted-note">What went wrong?</label>
            <textarea
              id="nooted-note"
              class="note"
              ref={textarea}
              rows={5}
              maxLength={MAX_NOTE}
              required
              value={note}
              disabled={phase === 'sending'}
              placeholder="Describe what you were doing and what happened"
              onInput={(event) => setState({ note: (event.currentTarget as HTMLTextAreaElement).value })}
            />
            <div class="row">
              <span class="hint">Signed in as {state.token?.user.email}</span>
              {dictation.supported && (
                <button
                  type="button"
                  class={dictation.listening ? 'btn mic on' : 'btn mic'}
                  aria-label={dictation.listening ? 'Stop voice input' : 'Start voice input'}
                  aria-pressed={dictation.listening}
                  onClick={dictation.toggle}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              )}
            </div>
            {dictation.message && <p class="msg" role="status">{dictation.message}</p>}
            {sendError && <p class="msg error" role="alert">{sendError}</p>}
            <div class="actions">
              <button type="button" class="btn" onClick={close}>Cancel</button>
              <button type="submit" class="btn primary" disabled={!canSend}>
                {phase === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p class="intro">Sign in with your Nooted account to send this report.</p>
            <button type="button" class="btn primary block" ref={signInButton} onClick={onSignIn}>Sign in to Nooted</button>
            {signingIn && <p class="msg" role="status">Waiting for the sign-in window…</p>}
            {notice && <p class="msg error" role="alert">{notice}</p>}
            <div class="actions">
              <button type="button" class="btn" onClick={close}>Cancel</button>
            </div>
          </div>
        )}
        <div class="footer">
          <button type="button" class="link" onClick={turnOffNooted}>Turn off Nooted on this device</button>
        </div>
      </div>
    </div>
  )
}
