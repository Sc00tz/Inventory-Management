import { CornerDownRight } from 'lucide-react'
import type { Product, SubItemInput } from '../types'

export interface SubItemValue {
  enabled: boolean
  name: string
  barcode: string
  perParent: string
}

export const EMPTY_SUB_ITEM: SubItemValue = { enabled: false, name: '', barcode: '', perParent: '' }

/** Form value for a product being edited (its current sub-item, if any). */
export function subItemFromProduct(p: Product | null | undefined, child: Product | null | undefined): SubItemValue {
  if (!p?.childProductId || !child) return EMPTY_SUB_ITEM
  return { enabled: true, name: child.name, barcode: child.barcode ?? '', perParent: String(p.packSize ?? '') }
}

export function isSubItemValid(v: SubItemValue) {
  if (!v.enabled) return true
  const n = Number(v.perParent)
  return v.name.trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= 10000
}

/** API value: the sub-item, or null when switched off. */
export function subItemToApi(v: SubItemValue): SubItemInput | null {
  if (!v.enabled) return null
  return { name: v.name.trim(), barcode: v.barcode.trim() || null, perParent: Number(v.perParent) }
}

/**
 * "Contains sub-items" section: how many of what are inside one of this product.
 * `note` shows under the fields (e.g. what happens to existing stock).
 */
export function SubItemFields({ value, onChange, parentName, note }: {
  value: SubItemValue
  onChange: (v: SubItemValue) => void
  /** Name of the product being edited, for the helper text */
  parentName?: string
  note?: string | null
}) {
  const inputCls = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary'
  const what = parentName?.trim() || 'this product'
  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-foreground select-none">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="accent-primary"
        />
        <CornerDownRight size={14} className="text-muted-foreground" />
        Contains sub-items
      </label>
      {value.enabled && (
        <>
          <div className="flex items-end gap-2">
            <div className="w-20 shrink-0">
              <label className="text-xs text-muted-foreground mb-1 block">How many</label>
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={value.perParent}
                onChange={(e) => onChange({ ...value, perParent: e.target.value })}
                placeholder="18"
                className={inputCls}
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block">Sub-item name</label>
              <input
                value={value.name}
                onChange={(e) => onChange({ ...value, name: e.target.value })}
                placeholder="e.g. Ritz sleeve"
                maxLength={200}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Sub-item barcode (optional)</label>
            <input
              value={value.barcode}
              onChange={(e) => onChange({ ...value, barcode: e.target.value })}
              placeholder="Only if the single item has its own barcode"
              className={`${inputCls} font-mono`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Scanning {what} adds 1 of it and {value.perParent || 'N'} {value.name.trim() || 'sub-items'}. Use them one at a
            time; the {what} count drops each time a full one is used up.
          </p>
          {note && <p className="text-xs text-amber-500">{note}</p>}
        </>
      )}
    </div>
  )
}
