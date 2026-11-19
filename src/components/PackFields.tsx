import { Layers } from 'lucide-react'

export interface PackValue {
  enabled: boolean
  size: string
  unitName: string
}

export const EMPTY_PACK: PackValue = { enabled: false, size: '', unitName: '' }

export function packFromProduct(p?: { packSize?: number | null; unitName?: string | null } | null): PackValue {
  return p?.packSize && p.packSize > 1
    ? { enabled: true, size: String(p.packSize), unitName: p.unitName ?? '' }
    : EMPTY_PACK
}

/** Converts the form value to the API fields. */
export function packToApi(v: PackValue): { packSize: number | null; unitName: string | null } {
  const size = parseInt(v.size, 10)
  if (!v.enabled || !Number.isInteger(size) || size < 2) return { packSize: null, unitName: null }
  return { packSize: size, unitName: v.unitName.trim() || null }
}

export function isPackValid(v: PackValue) {
  if (!v.enabled) return true
  const size = Number(v.size)
  return Number.isInteger(size) && size >= 2 && size <= 10000
}

/**
 * "This is a multipack" toggle with contents count and unit name.
 * `convertNote` is shown when switching an item with stock into a multipack.
 */
export function PackFields({ value, onChange, convertNote }: {
  value: PackValue
  onChange: (v: PackValue) => void
  convertNote?: string | null
}) {
  const inputCls = 'rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary'
  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-foreground select-none">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="accent-primary"
        />
        <Layers size={14} className="text-muted-foreground" />
        Package contains multiple items
      </label>
      {value.enabled && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Contains</span>
            <input
              type="number"
              min={2}
              max={10000}
              step={1}
              value={value.size}
              onChange={(e) => onChange({ ...value, size: e.target.value })}
              placeholder="18"
              className={`${inputCls} w-20`}
              aria-label="Items per package"
            />
            <input
              value={value.unitName}
              onChange={(e) => onChange({ ...value, unitName: e.target.value })}
              placeholder="sleeve"
              maxLength={40}
              className={`${inputCls} flex-1 min-w-0`}
              aria-label="What one item is called"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Scanning the package adds all {value.size || 'N'}; you can then remove them one at a time.
          </p>
          {convertNote && <p className="text-xs text-amber-500">{convertNote}</p>}
        </>
      )}
    </div>
  )
}
