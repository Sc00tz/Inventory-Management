import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Globe, Nfc } from 'lucide-react'
import { Button, toast } from '@blinkdotnew/ui'
import { updateSettings } from '../lib/api'
import { useSettings, isLocalOnly } from '../lib/settings'
import { nfcSupport } from '../lib/nfc'
import { NfcUnavailable } from '../components/NfcWriter'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: settings } = useSettings()
  const [baseUrl, setBaseUrl] = useState('')

  useEffect(() => { if (settings) setBaseUrl(settings.publicBaseUrl) }, [settings?.publicBaseUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (publicBaseUrl: string) => updateSettings({ publicBaseUrl }),
    onSuccess: (s) => {
      queryClient.setQueryData(['settings'], s)
      setBaseUrl(s.publicBaseUrl)
      toast.success('Saved')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const origin = window.location.origin
  const effective = settings?.publicBaseUrl || origin
  const nfc = nfcSupport()
  const dirty = settings !== undefined && baseUrl.trim().replace(/\/+$/, '') !== settings.publicBaseUrl

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Settings</h1>
      </div>

      <section className="rounded-xl border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe size={15} className="text-primary" />
          <h2 className="text-sm font-medium text-foreground">Public address</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          The address your phone uses to reach ScanBin. It's built into every QR label and NFC tag, so it must
          work from other devices — use this computer's network IP or hostname, not <code className="font-mono">localhost</code>.
          Example: <code className="font-mono">http://192.168.1.20:4001</code>
        </p>
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => { e.preventDefault(); save.mutate(baseUrl) }}
        >
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={origin}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>Save</Button>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {!isLocalOnly(origin) && origin !== settings?.publicBaseUrl && (
            <button className="text-primary hover:text-primary/80" onClick={() => save.mutate(origin)}>
              Use the address I'm on now ({origin})
            </button>
          )}
          <span className="text-muted-foreground ml-auto">
            Labels currently use: <code className="font-mono text-foreground">{effective}</code>
            {isLocalOnly(effective) ? <span className="text-amber-500"> — phones can't open this</span> : <Check size={12} className="inline ml-1 text-green-500" />}
          </span>
        </div>
        <p className="text-xs text-muted-foreground/70">
          Already-printed labels and written tags keep the address they were made with, so set this before printing.
        </p>
      </section>

      <section className="rounded-xl border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Nfc size={15} className="text-primary" />
          <h2 className="text-sm font-medium text-foreground">NFC tags</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Open a location, tap the QR button, and use <strong className="text-foreground">Write NFC tag</strong>. The tag stores
          the same link as the QR code, so tapping it with any phone (Android or iPhone) opens the location — no app needed.
        </p>
        {nfc.ok
          ? <p className="flex items-center gap-1.5 text-xs text-green-500"><Check size={13} /> NFC is available in this browser.</p>
          : <NfcUnavailable reason={nfc.reason} />}
      </section>
    </div>
  )
}
