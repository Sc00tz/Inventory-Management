import { useRef, useEffect, useState } from 'react'
import { ScanBarcode, X, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CameraScanner } from './CameraScanner'

interface ScanInputProps {
  onScan: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  disabled?: boolean
  /** Close the camera overlay automatically after a successful scan */
  closeOnScan?: boolean
}

export function ScanInput({
  onScan,
  placeholder = 'Scan or type barcode…',
  autoFocus = false,
  className,
  disabled,
  closeOnScan = false,
}: ScanInputProps) {
  const [value, setValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Hardware scanners typically terminate with Enter
    if (e.key === 'Enter' && value.trim()) {
      onScan(value.trim())
      setValue('')
    }
  }

  const handleClear = () => {
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <>
      <div className={cn('relative flex items-center', className)}>
        <ScanBarcode className="absolute left-4 text-primary shrink-0" size={20} />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border border-border bg-card px-12 py-3 text-base font-mono text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
            'transition-all duration-150',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
        {/* Show clear button when there's input, camera button otherwise */}
        {value ? (
          <button
            onClick={handleClear}
            className="absolute right-3 p-1 text-muted-foreground hover:text-foreground transition-colors"
            type="button"
          >
            <X size={16} />
          </button>
        ) : (
          <button
            onClick={() => setCameraOpen(true)}
            disabled={disabled}
            className="absolute right-3 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
            title="Scan with camera"
          >
            <Camera size={18} />
          </button>
        )}
      </div>

      {cameraOpen && (
        <CameraScanner
          onScan={(val) => { onScan(val); if (closeOnScan) setCameraOpen(false) }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  )
}
