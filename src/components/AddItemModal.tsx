import { useState, useMemo } from 'react'
import { Button } from '@blinkdotnew/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Search, Package } from 'lucide-react'
import type { Product } from '../types'

interface AddItemModalProps {
  open: boolean
  products: Product[]
  onAdd: (product: Product, quantity: number) => void
  onClose: () => void
}

export function AddItemModal({ open, products, onAdd, onClose }: AddItemModalProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return products
    return products.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? '').toLowerCase().includes(q) ||
        p.barcode.includes(q)
    )
  }, [products, search])

  const handleClose = () => {
    setSearch('')
    setSelected(null)
    setQuantity('1')
    onClose()
  }

  const handleConfirm = () => {
    if (!selected) return
    const qty = parseFloat(quantity)
    if (isNaN(qty) || qty <= 0) return
    onAdd(selected, qty)
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>

        {/* Step 1: pick a product */}
        {!selected ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, brand, or barcode…"
                className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
            </div>

            <div className="max-h-64 overflow-y-auto -mx-1 rounded-lg border border-border divide-y divide-border">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Package size={24} className="text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No products found</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Scan a barcode to add a new product</p>
                </div>
              ) : (
                filtered.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-8 h-8 rounded object-cover shrink-0 bg-muted" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                        <Package size={13} className="text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.brand ? `${p.brand} · ` : ''}{p.barcode}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
          </div>
        ) : (
          /* Step 2: set quantity */
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              {selected.imageUrl ? (
                <img src={selected.imageUrl} alt={selected.name} className="w-9 h-9 rounded object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                  <Package size={14} className="text-muted-foreground/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{selected.name}</p>
                {selected.brand && <p className="text-xs text-muted-foreground">{selected.brand}</p>}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                Change
              </button>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Quantity</label>
              <input
                autoFocus
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setSelected(null)}>Back</Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={!quantity || parseFloat(quantity) <= 0}
              >
                Add to Location
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
