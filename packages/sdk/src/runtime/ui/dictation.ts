import { useEffect, useRef, useState } from 'preact/hooks'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function ctor(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition || w.webkitSpeechRecognition
}

/** Voice input through the Web Speech API. `supported` is false where it doesn't exist. Stops on unmount or when `enabled` turns false. */
export function useDictation(onText: (text: string) => void, enabled: boolean) {
  const supported = !!ctor()
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const sink = useRef(onText)
  sink.current = onText

  const stop = () => {
    const r = recognition.current
    recognition.current = null
    setListening(false)
    if (!r) return
    r.onresult = r.onerror = r.onend = null
    try {
      r.abort()
    } catch {
      // Already stopped.
    }
  }

  useEffect(() => stop, [])
  useEffect(() => {
    if (!enabled) stop()
  }, [enabled])

  const toggle = () => {
    if (recognition.current) return stop()
    const Ctor = ctor()
    if (!Ctor) return
    setMessage(null)
    try {
      const r = new Ctor()
      r.continuous = true
      r.interimResults = false
      r.lang = document.documentElement.lang || navigator.language
      r.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]!
          const text = result.isFinal ? result[0]?.transcript.trim() : ''
          if (text) sink.current(text)
        }
      }
      r.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setMessage('Microphone access was blocked. Allow it in your browser to dictate.')
        } else if (event.error && event.error !== 'no-speech' && event.error !== 'aborted') {
          setMessage('Voice input stopped working. You can keep typing.')
        }
      }
      r.onend = () => {
        recognition.current = null
        setListening(false)
      }
      recognition.current = r
      r.start()
      setListening(true)
    } catch {
      recognition.current = null
      setListening(false)
      setMessage('Voice input could not start. You can keep typing.')
    }
  }

  return { supported, listening, message, toggle }
}
