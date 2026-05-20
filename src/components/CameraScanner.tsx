import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser'
import { X, Camera, Loader2 } from 'lucide-react'

interface CameraScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export function CameraScanner({ onScan, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Deduplicate rapid repeated scans of the same code with a 2-second cooldown
  const lastScanRef = useRef('')
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleScan = useCallback((text: string) => {
    if (text === lastScanRef.current) return
    lastScanRef.current = text
    if (cooldownRef.current) clearTimeout(cooldownRef.current)
    cooldownRef.current = setTimeout(() => { lastScanRef.current = '' }, 2000)
    onScan(text)
  }, [onScan])

  useEffect(() => {
    if (!videoRef.current) return
    let stopped = false

    const start = async () => {
      try {
        const reader = new BrowserMultiFormatReader()

        // Prefer a rear/environment-facing camera when available
        let deviceId: string | undefined
        try {
          const devices = await BrowserCodeReader.listVideoInputDevices()
          const back = devices.find(d => /back|rear|environment/i.test(d.label))
          deviceId = back?.deviceId
        } catch {
          // Fall back to the default camera if enumeration fails
        }

        if (stopped) return

        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current!,
          (result) => { if (result) handleScan(result.getText()) }
        )

        if (stopped) {
          controls.stop()
        } else {
          controlsRef.current = controls
          setLoading(false)
        }
      } catch {
        if (!stopped) {
          setLoading(false)
          setError('Camera access denied. Please allow camera access and try again.')
        }
      }
    }

    start()

    return () => {
      stopped = true
      controlsRef.current?.stop()
      if (cooldownRef.current) clearTimeout(cooldownRef.current)
    }
  }, [handleScan])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-primary" />
          <span className="text-sm font-medium text-foreground">Scan Barcode or QR Code</span>
        </div>
        <button
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Camera viewport */}
      <div className="flex-1 relative bg-black overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <Camera size={48} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground max-w-xs">{error}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              playsInline
            />
            {/* Spinner shown until the camera stream is live */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 size={32} className="text-primary animate-spin" />
              </div>
            )}
            {/* Targeting reticle */}
            {!loading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-60 h-60">
                  <span className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-primary" />
                  <span className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-primary" />
                  <span className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-primary" />
                  <span className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-primary" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background text-center">
        <p className="text-xs text-muted-foreground">
          {loading ? 'Starting camera…' : 'Point camera at a product barcode or location QR code'}
        </p>
      </div>
    </div>
  )
}
