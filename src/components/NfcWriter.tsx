import { useEffect, useRef, useState } from 'react'
import { Nfc, Check, Loader2, X, Lock } from 'lucide-react'
import { Button } from '@blinkdotnew/ui'
import { nfcSupport, writeNfcUrl, nfcErrorMessage } from '../lib/nfc'

type Status = 'idle' | 'waiting' | 'done' | 'error'

/** Explains how to unlock Web NFC when the page isn't on a secure origin. */
export function NfcUnavailable({ reason }: { reason: 'insecure' | 'unsupported' }) {
  if (reason === 'unsupported') {
    return (
      <p className="text-xs text-muted-foreground">
        Writing NFC tags works in <strong className="text-foreground">Chrome on Android</strong>. Open this page there to write a tag.
      </p>
    )
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="text-xs text-muted-foreground space-y-1.5">
      <p>
        Chrome only allows NFC on secure (HTTPS) pages. To enable it for ScanBin on your phone:
      </p>
      <ol className="list-decimal ml-4 space-y-0.5">
        <li>In Chrome, open <code className="font-mono text-foreground">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
        <li>Enter <code className="font-mono text-foreground">{origin}</code> and set it to <strong className="text-foreground">Enabled</strong></li>
        <li>Tap <strong className="text-foreground">Relaunch</strong>, then come back here</li>
      </ol>
    </div>
  )
}

/** Writes a location's short link onto an NFC sticker. */
export function NfcWriter({ url }: { url: string }) {
  const support = nfcSupport()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [lock, setLock] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Stop listening for tags if the panel closes mid-write
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!support.ok) return <NfcUnavailable reason={support.reason} />

  const start = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('waiting')
    setError('')
    try {
      await writeNfcUrl(url, { lock, signal: ctrl.signal })
      setStatus('done')
      if (navigator.vibrate) navigator.vibrate(80)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') { setStatus('idle'); return }
      setError(nfcErrorMessage(e))
      setStatus('error')
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setStatus('idle')
  }

  return (
    <div className="flex flex-col gap-2">
      {status === 'waiting' ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5">
          <Loader2 size={16} className="animate-spin text-primary shrink-0" />
          <span className="text-sm text-foreground flex-1">Hold the sticker against the back of your phone…</span>
          <button onClick={cancel} className="text-muted-foreground hover:text-foreground" aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={start} className="self-start">
          <Nfc size={14} className="mr-1.5" />
          {status === 'done' ? 'Write another tag' : 'Write NFC tag'}
        </Button>
      )}

      {status === 'done' && (
        <p className="flex items-center gap-1.5 text-xs text-green-500">
          <Check size={13} /> Tag written{lock ? ' and locked' : ''}. Tap it with any phone to open this location.
        </p>
      )}
      {status === 'error' && <p className="text-xs text-destructive">{error}</p>}

      <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={lock}
          onChange={(e) => setLock(e.target.checked)}
          disabled={status === 'waiting'}
          className="accent-primary"
        />
        <Lock size={12} />
        Lock tag after writing <span className="text-muted-foreground/60">(permanent — can't be rewritten)</span>
      </label>
    </div>
  )
}
